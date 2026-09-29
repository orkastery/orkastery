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
const kindDe = (id: string) => id.slice(0, 4);
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
  const pedido = [...new Set(ids)].sort();
  if (!pedido.length) throw Error('brain.context.ids-required');
  if (pedido.some(id => !ID.test(id))) throw Error('brain.context.id-invalid');
  const fonte = new Map(portfolioEntities(readPortfolio(c.raiz),
    { tenant, instance: c.manifesto.project.name, thread, aclRef: 'ork-factory' }).map(e => [e.id, e]));
  const base = { schema: CONTEXT_SCHEMA, tenant, contrato: CONTRACT_HASH, thread, pedido };
  const encerrar = (r: BrainResponse): PacoteDeContexto =>
    ({ ...base, state: r.state, ...(r.error ? { error: r.error } : {}), itens: [], lacunas: [], digest: null, consultadoEm: new Date().toISOString() });

  const escopo = new Set<string>(), brain = new Map<string, any>(), retidos = new Set<string>();
  const incluir = (id: string | null | undefined) => { for (let atual = id; atual && !escopo.has(atual); atual = fonte.get(atual)?.parent_id) escopo.add(atual); };
  pedido.forEach(incluir);
  // O pai de um id que só o Brain conhece vem do próprio Brain; prod-init-proj termina em três voltas.
  for (let pendentes = [...escopo], volta = 0; pendentes.length && volta < 3; volta++) {
    if (escopo.size > LIMITE) throw Error('brain.context.too-many');
    const r = transport({ schema: BRAIN_API, operation: 'query', payload: validateContract({ schema: 'orkmind.company-brain-selection/v1',
      tenant_id: tenant, facets: { ids: pendentes, kinds: [], workspace_ids: [], source_instances: [] }, mode: 'selection',
      limit: Math.min(LIMITE, pendentes.length), offset: 0 }) });
    if (falha(r.state)) return encerrar(r);
    const pedidos = new Set(pendentes);
    for (const item of Array.isArray(r.items) ? r.items : [])
      if (item?.state === 'ok' && pedidos.has(item.entity?.id)) brain.set(item.entity.id, item.entity);
    // Retido chega sem id na seleção; só o `get` atribui a retenção a um id.
    for (const id of pendentes) if (!brain.has(id)) {
      const g = transport({ schema: BRAIN_API, operation: 'get', payload: { tenant_id: tenant, id } });
      if (falha(g.state)) return encerrar(g);
      if (g.state === 'withheld') retidos.add(id);
      else if (g.state === 'ok' && (g.entity as any)?.id === id) brain.set(id, g.entity);
    }
    const antes = new Set(escopo);
    for (const id of pendentes) incluir(brain.get(id)?.parent_id);
    pendentes = [...escopo].filter(id => !antes.has(id));
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
  itens.sort((a, b) => ORDEM[kindDe(a.id)] - ORDEM[kindDe(b.id)] || a.id.localeCompare(b.id));
  lacunas.sort((a, b) => a.id.localeCompare(b.id) || a.codigo.localeCompare(b.codigo));
  // O digest cobre o que foi dito e de onde veio; o horário da consulta fica fora para o pacote ser reproduzível.
  const corpo = { ...base, state: (itens.length ? 'ok' : 'empty') as BrainResponse['state'], itens, lacunas };
  return { ...corpo, digest: digest(corpo), consultadoEm: new Date().toISOString() };
}
