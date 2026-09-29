/** B4.1: pacote de contexto citável. Só leitura (`query` e `get`), sem ativação nem escrita. */
import { ManifestoCarregado } from './manifest';
import { readPortfolio } from './portfolio';
import { BRAIN_API, BrainResponse, BrainTransport } from './company-brain-client';
import { BrainEntity, CONTRACT_HASH, digest, validateContract } from './company-brain-contract';
import { portfolioEntities } from './company-brain-source';

export const CONTEXT_SCHEMA = 'ork.brain-context/v1' as const;
export type Frescor = 'confere' | 'divergente' | 'ausente-no-brain' | 'ausente-na-fonte' | 'retido';
export type CodigoDeLacuna = 'dono.sem-principal' | 'observado.desconhecido' | 'registrado.desconhecido' | 'brain.ausente'
  | 'fonte.ausente' | 'fonte.divergente' | 'brain.retido' | 'citacao.incompleta' | 'entidade.desconhecida';
export interface Citacao { instance: string; source_ref: string; source_hash: string; source_version: number; location: string; }
export type ItemDeContexto = { id: string; estado: 'retido'; frescor: 'retido'; origem: 'brain' } | {
  id: string; kind: BrainEntity['kind']; estado: 'ok'; frescor: Exclude<Frescor, 'retido'>; origem: 'brain' | 'fonte';
  titulo: string; status: string; parent_id: string | null; depends_on: string[]; owner: { raw: string | null; state: string };
  versao: number; citacao: Citacao; fonte: { source_hash: string; version: number } | null;
};
export interface Lacuna { id: string; codigo: CodigoDeLacuna; }
export interface PacoteDeContexto {
  schema: typeof CONTEXT_SCHEMA; state: BrainResponse['state']; error?: string; tenant: string; contrato: string; thread: string;
  pedido: string[]; itens: ItemDeContexto[]; lacunas: Lacuna[]; digest: string | null; consultadoEm: string;
}

const ID = /^(prod|proj|init)-[a-z0-9][a-z0-9-]{2,47}$/;
const ORDEM: Record<string, number> = { prod: 0, proj: 1, init: 2 };
const LIMITE = 1000;
/** Teto de `get` por pacote: só o caso misto (alguns retidos, alguns ausentes) precisa deles. */
const LIMITE_DE_GET = 100;
const kindDe = (id: string) => id.slice(0, 4);
/** Por code point: o digest é identidade citável e não pode depender do locale do processo. */
const comparar = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Além do que o D7 lista, `conflict` também encerra: resposta de conflito não é conteúdo citável.
const falha = (state: string) => ['forbidden', 'unavailable', 'conflict'].includes(state);

/** A citação só vale inteira: sem um dos campos, o item sai do conteúdo e vira lacuna. */
function citacaoDe(source: any): Citacao | null {
  if (!source || typeof source !== 'object') return null;
  const { instance, source_ref, source_hash, source_version, location } = source;
  if ([instance, source_ref, location].some(v => typeof v !== 'string' || !v) || typeof source_hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source_hash) || !Number.isInteger(source_version)) return null;
  return { instance, source_ref, source_hash, source_version, location };
}

/**
 * Monta o pacote dos ids pedidos mais a cadeia de pais. A fonte canônica é o portfólio local;
 * o Brain é projeção, e a diferença entre os dois sai como frescor e lacuna, nunca é corrigida aqui.
 */
export function buildContext(c: ManifestoCarregado, ids: string[], transport: BrainTransport, thread: string): PacoteDeContexto {
  const tenant = c.manifesto.memory.tenant;
  const pedido = [...new Set(ids)].sort(comparar);
  if (!pedido.length) throw Error('brain.context.ids-required');
  if (pedido.some(id => !ID.test(id))) throw Error('brain.context.id-invalid');
  if (pedido.length > LIMITE) throw Error('brain.context.too-many');
  const fonte = new Map(portfolioEntities(readPortfolio(c.raiz),
    { tenant, instance: c.manifesto.project.name, thread, aclRef: 'ork-factory' }).map(e => [e.id, e]));
  const base = { schema: CONTEXT_SCHEMA, tenant, contrato: CONTRACT_HASH, thread, pedido };
  const encerrar = (r: { state: BrainResponse['state']; error?: string }): PacoteDeContexto =>
    ({ ...base, state: r.state, ...(r.error ? { error: r.error } : {}), itens: [], lacunas: [], digest: null, consultadoEm: new Date().toISOString() });

  const escopo = new Set<string>(pedido), brain = new Map<string, any>(), retidos = new Set<string>();
  // O pai só entra por um filho visível e tem kind acima dele: init, proj e prod fecham em três voltas.
  const pai = (id: string, parent: unknown) =>
    typeof parent === 'string' && ID.test(parent) && ORDEM[kindDe(parent)] < ORDEM[kindDe(id)] ? parent : null;
  let gets = 0;
  for (let pendentes = pedido; pendentes.length;) {
    for (let inicio = 0; inicio < pendentes.length; inicio += LIMITE) {
      const lote = pendentes.slice(inicio, inicio + LIMITE), doLote = new Set(lote);
      const r = transport({ schema: BRAIN_API, operation: 'query', payload: validateContract({ schema: 'orkmind.company-brain-selection/v1',
        tenant_id: tenant, facets: { ids: lote, kinds: [], workspace_ids: [], source_instances: [] }, mode: 'selection',
        limit: lote.length, offset: 0 }) });
      if (falha(r.state)) return encerrar(r);
      const itens = Array.isArray(r.items) ? r.items : [];
      for (const item of itens) if (item?.state === 'ok' && doLote.has(item.entity?.id)) brain.set(item.entity.id, item.entity);
      // Retido chega sem id na seleção. Sem retido no lote, o que faltou é desconhecido; com todos os
      // faltantes retidos, não há o que atribuir. Só no caso misto o `get` diz qual id é qual.
      const faltantes = lote.filter(id => !brain.has(id)), retidosNoLote = itens.filter((i: any) => i?.state === 'withheld').length;
      if (retidosNoLote && retidosNoLote === faltantes.length) faltantes.forEach(id => retidos.add(id));
      else if (retidosNoLote) for (const id of faltantes) {
        if (++gets > LIMITE_DE_GET) return encerrar({ state: 'unavailable', error: 'brain.context.get-limit' });
        const g = transport({ schema: BRAIN_API, operation: 'get', payload: { tenant_id: tenant, id } });
        if (falha(g.state)) return encerrar(g);
        if (g.state === 'withheld') retidos.add(id);
        else if (g.state === 'ok' && (g.entity as any)?.id === id) brain.set(id, g.entity);
      }
    }
    const novos: string[] = [];
    for (const id of pendentes) if (!retidos.has(id))
      for (const parent of [pai(id, fonte.get(id)?.parent_id), pai(id, brain.get(id)?.parent_id)])
        if (parent && !escopo.has(parent)) { escopo.add(parent); novos.push(parent); }
    pendentes = novos.sort(comparar);
  }

  const itens: ItemDeContexto[] = [], lacunas: Lacuna[] = [];
  const lacuna = (id: string, codigo: CodigoDeLacuna) => lacunas.push({ id, codigo });
  for (const id of escopo) {
    if (retidos.has(id)) { itens.push({ id, estado: 'retido', frescor: 'retido', origem: 'brain' }); lacuna(id, 'brain.retido'); continue; }
    const b = brain.get(id), f = fonte.get(id);
    if (!b && !f) { lacuna(id, 'entidade.desconhecida'); continue; }
    const entidade = b ?? f, citacao = citacaoDe(entidade.source);
    if (!citacao) { lacuna(id, 'citacao.incompleta'); continue; }
    const frescor = !b ? 'ausente-no-brain' : !f ? 'ausente-na-fonte'
      : b.source?.source_hash === f.source.source_hash && b.version === f.version ? 'confere' : 'divergente';
    itens.push({ id, kind: entidade.kind, estado: 'ok', frescor, origem: b ? 'brain' : 'fonte', titulo: entidade.title ?? '',
      status: entidade.status ?? '', parent_id: entidade.parent_id ?? null, depends_on: entidade.depends_on ?? [],
      owner: { raw: entidade.owner?.raw ?? null, state: entidade.owner?.state ?? 'unknown' }, versao: entidade.version, citacao,
      fonte: f ? { source_hash: f.source.source_hash, version: f.version } : null });
    if (frescor === 'ausente-no-brain') lacuna(id, 'brain.ausente');
    if (frescor === 'ausente-na-fonte') lacuna(id, 'fonte.ausente');
    if (frescor === 'divergente') lacuna(id, 'fonte.divergente');
    if ((entidade.owner?.principal ?? null) === null) lacuna(id, 'dono.sem-principal');
    if ((entidade.observed_at ?? null) === null) lacuna(id, 'observado.desconhecido');
    if ((entidade.recorded_at ?? null) === null) lacuna(id, 'registrado.desconhecido');
  }
  itens.sort((a, b) => ORDEM[kindDe(a.id)] - ORDEM[kindDe(b.id)] || comparar(a.id, b.id));
  lacunas.sort((a, b) => comparar(a.id, b.id) || comparar(a.codigo, b.codigo));
  // O digest cobre o que foi dito e de onde veio; o horário da consulta fica fora para o pacote ser reproduzível.
  const corpo = { ...base, state: (itens.length ? 'ok' : 'empty') as BrainResponse['state'], itens, lacunas };
  return { ...corpo, digest: digest(corpo), consultadoEm: new Date().toISOString() };
}
