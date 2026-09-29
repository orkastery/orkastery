/**
 * K3.1: dossiê de decisão. Só leitura: compõe o que o núcleo já grava (o ledger da thread, o objetivo
 * do K1 e o escopo vinculado) com o pacote de contexto do Brain, sem registrar nada. Decidir continua
 * sendo `ork decisao registrar` (decisão delegada) ou a resposta do dono pelo ingresso autenticado.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ManifestoCarregado } from './manifest';
import { BRAIN_API, BrainResponse, BrainTransport } from './company-brain-client';
import { BrainEvent, CONTRACT_HASH, digest, validateContract } from './company-brain-contract';
import { buildContext, Citacao, PacoteDeContexto } from './company-brain-context';
import { readCycle, readSourceFile, SourceScope } from './company-brain-source';
import { rastroDaDecisao } from './decisao-autonoma';
import { reciboHumanoConfere } from './gates';
import { alvoDoPedido, DecisaoInformada, PedidoHitl, PedidoHitlQualquer, PerguntaAoDono, validarPedidoHitl, validarPedidoHitlV2 } from './hitl-contract';
import { listObjectives, Objective, readObjective } from './objective';
import { findEntity } from './portfolio';
import { dirThread, lerThread } from './thread';
import { EventoLedger, Thread } from './types';

export const DOSSIE_SCHEMA = 'ork.dossie-de-decisao/v1' as const;
/** O id que o dossiê aceita para uma decisão: o do pedido ou o que o Brain dá ao fato. */
export const ID_DE_DECISAO = /^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|fact-[a-f0-9]{64})$/;
export type FrescorDoFato = 'confere' | 'divergente' | 'ausente-no-brain' | 'retido';
export type CodigoDeLacunaDoDossie = 'objetivo.ausente' | 'objetivo.indisponivel' | 'projeto.ausente' | 'vinculo.divergente'
  | 'alternativas.nao-registradas' | 'resposta.pendente' | 'resposta.sem-prova' | 'decisao.fora-do-contrato'
  | 'decisao.humana-sem-ingresso' | 'decisao.desconhecida' | 'citacao.incompleta' | 'brain.ausente' | 'fonte.divergente' | 'brain.retido';
export interface LacunaDoDossie { id: string; codigo: CodigoDeLacunaDoDossie; }
/** Os ids do fato no Brain, os mesmos que `readCycle` grava ao capturar a linha. */
export interface IdsNoBrain { assertion_id: string; event_id: string; source_event_id: string; }
export interface FatoCitado { brain: IdsNoBrain; citacao: Citacao; frescor: Exclude<FrescorDoFato, 'retido'>; }
/** BR-030-05: retido pelo Brain sai só com o id do fato no Brain e o frescor, como no pacote de contexto. */
export interface FatoRetido { id: string; frescor: 'retido'; }
export type ClasseDeDecisao = 'decidido' | 'pergunta' | 'legado';
export interface Alternativa {
  numero: number; letra: string | null; texto: string; acao: string; consequencia: string | null; recomendada: boolean; porque: string | null;
}
export type RespostaDoDono = FatoRetido | (FatoCitado & {
  opcao: number | null; letra: string | null; texto: string | null; veredito: string | null; quem: string; origem: string;
  canal: string | null; recebidoEm: string | null; recibo: string | null; evidencia: string | null; evidenciaSha256: string | null;
});
interface Comum extends FatoCitado { id: string; fase: string | null; em: string; }
export type ItemDeDecisao = FatoRetido
  | (Comum & { classe: 'decidido'; contrato: string; autoria: 'autonoma'; decidido: string; porque: string; comoMudar: string;
    custoDeReverter: { agora: string; depois: string }; criterio: { tipo: string; referencia: string };
    quemDecidiu: string; evidencia: string; razao: string; reverte: string | null; revertidaPor: string | null })
  | (Comum & { classe: 'pergunta'; contrato: string; autoria: 'dono' | null; pergunta: string; sobre: string;
    alternativas: Alternativa[]; recomendacao: string | null; prazo: string | null;
    estado: 'decidida' | 'retida' | 'sem-prova' | 'aguardando'; resposta: RespostaDoDono | null })
  | (Comum & { classe: 'legado'; contrato: 'legado'; autoria: 'autonoma'; decidido: string; quemDecidiu: string | null;
    evidencia: string | null; razao: string | null; rastroCompleto: boolean });
export interface VinculoDoDossie {
  objetivo: { id: string; titulo: string; estado: string; envelopeHash: string; origem: 'ticket' | 'lista-de-threads' } | null;
  projeto: { productId: string | null; projectId: string; initiativeIds: string[]; origem: 'escopo-vinculado' | 'objetivo' } | null;
  /**
   * O vínculo com os nomes do `cycle` dos eventos do Brain. A captura de hoje só preenche `project_id` e
   * `initiative_ids`, pelo escopo vinculado, e grava `objective_id` nulo (FEAT-030, fora deste corte).
   */
  brain: { thread_id: string; objective_id: string | null; project_id: string | null; initiative_ids: string[] };
}
export interface Dossie {
  schema: typeof DOSSIE_SCHEMA; state: BrainResponse['state']; error?: string; tenant: string; contrato: string; thread: string;
  decisao: string | null; vinculo: VinculoDoDossie; contexto: PacoteDeContexto | null; decisoes: ItemDeDecisao[];
  lacunas: LacunaDoDossie[]; digest: string | null; consultadoEm: string;
}

/** Os mesmos números do pacote de contexto: lote da seleção e teto de `get` no caso misto. */
const LIMITE = 1000;
const LIMITE_DE_GET = 100;
const comparar = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const falha = (state: string) => ['forbidden', 'unavailable', 'conflict'].includes(state);
const texto = (v: unknown): string | null => typeof v === 'string' ? v : null;

/**
 * D10: a mesma conferência do ramo `context` de `ork brain`, repetida aqui para não tocar aquele
 * comando enquanto outra thread o muda. O escopo vale só se for desta thread e do formato do bind.
 */
function escopoVinculado(raiz: string, thread: string): { projectId: string; initiativeIds: string[] } | null {
  const file = path.join(dirThread(raiz, thread), 'brain-scope.json');
  if (!fs.existsSync(file)) return null;
  let binding: any;
  try { binding = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('brain.scope.invalid'); }
  if (binding?.schema !== 'ork.brain-cycle-scope/v1' || binding.version !== 1 || binding.thread !== thread || typeof binding.projectId !== 'string' ||
    !Array.isArray(binding.initiativeIds) || binding.initiativeIds.some((i: unknown) => typeof i !== 'string')) throw Error('brain.scope.invalid');
  return { projectId: binding.projectId, initiativeIds: binding.initiativeIds };
}

/**
 * D3: o objetivo é o ticket do K1 (`creationOrigin.ticketId`) e, sem ele, o objetivo cuja lista de
 * threads contém esta; o projeto é o escopo vinculado (o que a captura grava no `cycle`) e, sem ele, o
 * `portfolio` do objetivo. Fonte faltando ou discordando vira lacuna, nunca escolha silenciosa.
 */
function vinculoDaThread(raiz: string, t: Thread, lacuna: (id: string, codigo: CodigoDeLacunaDoDossie) => void): VinculoDoDossie {
  let achado: { o: Objective; origem: 'ticket' | 'lista-de-threads' } | null = null, semObjetivo = true;
  const ticket = t.creationOrigin?.ticketId;
  try {
    if (ticket) {
      const o = readObjective(raiz, ticket);
      if (!o.threads.some(x => x.id === t.id)) { lacuna(t.id, 'vinculo.divergente'); semObjetivo = false; }
      else achado = { o, origem: 'ticket' };
    } else {
      const comEla = listObjectives(raiz).filter(o => o.threads.some(x => x.id === t.id));
      if (comEla.length > 1) { lacuna(t.id, 'vinculo.divergente'); semObjetivo = false; }
      else if (comEla.length === 1) achado = { o: comEla[0], origem: 'lista-de-threads' };
    }
  } catch { lacuna(ticket ?? t.id, 'objetivo.indisponivel'); semObjetivo = false; }
  if (!achado && semObjetivo) lacuna(t.id, 'objetivo.ausente');

  const escopo = escopoVinculado(raiz, t.id), doObjetivo = achado?.o.envelope.portfolio ?? null;
  const ordenados = (ids: string[]) => [...new Set(ids)].sort(comparar);
  let projeto: VinculoDoDossie['projeto'] = null;
  if (escopo) {
    const entidade = findEntity(raiz, escopo.projectId);
    projeto = { productId: entidade?.kind === 'project' ? entidade.productId : null, projectId: escopo.projectId,
      initiativeIds: ordenados(escopo.initiativeIds), origem: 'escopo-vinculado' };
    if (doObjetivo && (doObjetivo.projectId !== projeto.projectId ||
      JSON.stringify(ordenados(doObjetivo.initiativeIds)) !== JSON.stringify(projeto.initiativeIds))) lacuna(t.id, 'vinculo.divergente');
  } else if (doObjetivo) {
    projeto = { productId: doObjetivo.productId, projectId: doObjetivo.projectId, initiativeIds: ordenados(doObjetivo.initiativeIds), origem: 'objetivo' };
  } else lacuna(t.id, 'projeto.ausente');

  // Título e estado ficam fora do envelope com hash: o que faltar sai vazio, nunca `undefined` no digest.
  const objetivo = achado ? { id: achado.o.id, titulo: texto(achado.o.title) ?? '', estado: texto(achado.o.status) ?? '',
    envelopeHash: achado.o.envelope.hash, origem: achado.origem } : null;
  return { objetivo, projeto, brain: { thread_id: t.id, objective_id: objetivo?.id ?? null, project_id: projeto?.projectId ?? null,
    initiative_ids: projeto?.initiativeIds ?? [] } };
}

type EstadoNoBrain = { ok: Map<string, any>; retidos: Set<string> };
/**
 * Uma seleção por lote de ids `fact-…`; retido chega sem id, e só o caso misto pede `get`, como no contexto.
 * Seleção que não responde `ok` nem `empty` fecha o dossiê: sem estado conhecido, nada local vira conteúdo.
 */
function consultarFatos(transport: BrainTransport, tenant: string, ids: string[]): EstadoNoBrain | BrainResponse {
  const ok = new Map<string, any>(), retidos = new Set<string>();
  let gets = 0;
  for (let inicio = 0; inicio < ids.length; inicio += LIMITE) {
    const lote = ids.slice(inicio, inicio + LIMITE), doLote = new Set(lote);
    const r = transport({ schema: BRAIN_API, operation: 'query', payload: validateContract({ schema: 'orkmind.company-brain-selection/v1',
      tenant_id: tenant, facets: { ids: lote, kinds: [], workspace_ids: [], source_instances: [] }, mode: 'selection', limit: lote.length, offset: 0 }) });
    if (r.state !== 'ok' && r.state !== 'empty') return r;
    const itens = Array.isArray(r.items) ? r.items : [];
    for (const item of itens) if (item?.state === 'ok' && doLote.has(item.entity?.id)) ok.set(item.entity.id, item.entity);
    const faltantes = lote.filter(id => !ok.has(id)), retidosNoLote = itens.filter((i: any) => i?.state === 'withheld').length;
    if (retidosNoLote && retidosNoLote === faltantes.length) faltantes.forEach(id => retidos.add(id));
    else if (retidosNoLote) for (const id of faltantes) {
      if (++gets > LIMITE_DE_GET) return { schema: BRAIN_API, state: 'unavailable', error: 'brain.dossie.get-limit' };
      const g = transport({ schema: BRAIN_API, operation: 'get', payload: { tenant_id: tenant, id } });
      if (falha(g.state)) return g;
      if (g.state === 'withheld') retidos.add(id);
      else if (g.state === 'ok' && (g.entity as any)?.id === id) ok.set(id, g.entity);
    }
  }
  return { ok, retidos };
}

interface Linha { n: number; e: EventoLedger; evento: BrainEvent | null; }
const TIPOS_DO_DOSSIE = new Set(['autonomous_decision', 'hitl_requested', 'human_gate', 'human_decision']);

/**
 * P2: o ledger é lido pela `readCycle`, a mesma leitura da captura. Uma linha que o contrato do Brain não
 * representa (horário fora do formato, em ledgers antigos) derruba a leitura inteira; então a faixa que
 * recusa é partida ao meio até isolar a linha, que fica sem id no Brain. Qualquer outro erro (linha
 * corrompida, de outra thread) continua recusando o dossiê, como recusa a captura.
 */
function linhasDoLedger(bytes: Buffer, scope: SourceScope): Linha[] {
  const brutas = bytes.subarray(0, bytes.lastIndexOf(10) + 1).toString('utf8').split('\n').slice(0, -1);
  const inicios = [0];
  for (const raw of brutas) inicios.push(inicios[inicios.length - 1] + Buffer.byteLength(raw) + 1);
  const linhas: Linha[] = [];
  const faixa = (de: number, ate: number): void => {
    try {
      readCycle(bytes.subarray(0, inicios[ate]), scope, inicios[de]).records
        .forEach((r, i) => linhas.push({ n: de + i + 1, e: JSON.parse(brutas[de + i]) as EventoLedger, evento: r.event }));
    } catch (erro) {
      if ((erro as Error).message !== 'brain.contract.invalid') throw erro;
      if (ate - de === 1) { linhas.push({ n: de + 1, e: JSON.parse(brutas[de]) as EventoLedger, evento: null }); return; }
      const meio = de + Math.floor((ate - de) / 2);
      faixa(de, meio); faixa(meio, ate);
    }
  };
  if (brutas.length) faixa(0, brutas.length);
  return linhas.filter(l => TIPOS_DO_DOSSIE.has(l.e.tipo));
}

/**
 * Monta o dossiê de uma thread ou de uma decisão dela. A fonte canônica da decisão é o ledger; o Brain
 * é projeção, e a diferença entre os dois sai como frescor e lacuna. Item sem citação, resposta sem
 * recibo conferido e decisão fora do contrato viram lacuna, nunca conteúdo.
 */
export function buildDossie(c: ManifestoCarregado, thread: string, decisao: string | undefined, transport: BrainTransport): Dossie {
  // Filtro vazio é erro, não a thread inteira: quem pede uma decisão recebe essa ou a recusa.
  if (decisao !== undefined && !ID_DE_DECISAO.test(decisao)) throw Error('brain.dossie.decisao-invalida');
  const filtro = decisao ?? null;
  const t = lerThread(c.raiz, thread), tenant = c.manifesto.memory.tenant;
  const lacunas: LacunaDoDossie[] = [];
  const lacuna = (id: string, codigo: CodigoDeLacunaDoDossie) => { lacunas.push({ id, codigo }); };
  const vinculo = vinculoDaThread(c.raiz, t, lacuna);
  const base = { schema: DOSSIE_SCHEMA, tenant, contrato: CONTRACT_HASH, thread: t.id, decisao: filtro };
  const encerrar = (r: { state: BrainResponse['state']; error?: string }): Dossie => ({ ...base, state: r.state, ...(r.error ? { error: r.error } : {}),
    vinculo, contexto: null, decisoes: [], lacunas: [], digest: null, consultadoEm: new Date().toISOString() });

  const arquivo = path.join(dirThread(c.raiz, t.id), 'ledger.jsonl');
  const bytes = fs.existsSync(arquivo) ? readSourceFile(arquivo) : Buffer.alloc(0);
  const linhas = linhasDoLedger(bytes, { tenant, instance: c.manifesto.project.name, thread: t.id, aclRef: 'ork-factory' });

  // Cada linha é classificada uma vez, pelo validador do contrato; o que não valida é formato anterior.
  const classe = new Map<Linha, ClasseDeDecisao>(), respostas = new Map<string, Linha[]>(), revertidaPor = new Map<string, Linha>();
  const semIngresso: Linha[] = [];
  const pedidoDe = (l: Linha) => l.e.pedido as PedidoHitlQualquer;
  for (const l of linhas) {
    const p = l.e.pedido;
    if (l.e.tipo === 'autonomous_decision') {
      let decidido = false;
      try { validarPedidoHitlV2(p); decidido = p.classe === 'decidido'; } catch { decidido = false; }
      classe.set(l, decidido ? 'decidido' : 'legado');
      if (decidido && typeof l.e.reverte === 'string') revertidaPor.set(l.e.reverte, l);
    } else if (l.e.tipo === 'hitl_requested') {
      try { validarPedidoHitl(p); if (alvoDoPedido(p)?.tipo === 'gate') classe.set(l, 'pergunta'); } catch { /* fora do contrato: não é pergunta */ }
    } else if (l.e.tipo === 'human_gate' && typeof l.e.pedidoId === 'string') respostas.set(l.e.pedidoId, [...(respostas.get(l.e.pedidoId) ?? []), l]);
    else if (l.e.tipo === 'human_decision') semIngresso.push(l);
  }
  const candidatas = [...classe.keys()];
  const referencia = (l: Linha) => `threads/${t.id}/ledger.jsonl#L${l.n}`;
  const idDe = (l: Linha) => classe.get(l) !== 'legado' ? String(pedidoDe(l).id) : l.evento?.aggregate_id ?? referencia(l);
  const escolhidas = filtro === null ? candidatas : candidatas.filter(l => idDe(l) === filtro || l.evento?.aggregate_id === filtro);
  if (filtro !== null && !escolhidas.length) lacuna(filtro, 'decisao.desconhecida');
  // D8: `human_decision` é o relato de alguém sobre o dono, sem recibo: nunca vira decisão do dono.
  if (filtro === null) for (const l of semIngresso) lacuna(referencia(l), 'decisao.humana-sem-ingresso');

  // D4: a resposta só entra com o recibo reconferido pelas validadoras do núcleo, qualquer que seja o veredito.
  const provadas = new Map<string, Linha>();
  for (const l of escolhidas) if (classe.get(l) === 'pergunta') {
    const gates = respostas.get(idDe(l)) ?? [];
    if (gates.length === 1 && gates[0].evento && reciboHumanoConfere(c.raiz, t.id, gates[0].e)) provadas.set(idDe(l), gates[0]);
  }

  let contexto: PacoteDeContexto | null = null;
  if (vinculo.projeto) {
    contexto = buildContext(c, [vinculo.projeto.projectId, ...vinculo.projeto.initiativeIds], transport, t.id);
    if (falha(contexto.state)) return encerrar(contexto);
  }
  // A decisão que desfaz outra também é conferida: a relação é conteúdo dela, e some se ela estiver retida.
  const reversoras = escolhidas.flatMap(l => classe.get(l) === 'decidido' ? [revertidaPor.get(idDe(l))].filter((x): x is Linha => !!x) : []);
  const fatos = [...new Set([...escolhidas, ...provadas.values(), ...reversoras].flatMap(l => l.evento ? [l.evento.aggregate_id] : []))].sort(comparar);
  let noBrain: EstadoNoBrain = { ok: new Map(), retidos: new Set() };
  if (fatos.length) {
    const r = consultarFatos(transport, tenant, fatos);
    if ('state' in r) return encerrar(r);
    noBrain = r;
  }

  const ids = (evento: BrainEvent): IdsNoBrain => ({ assertion_id: evento.aggregate_id, event_id: evento.id, source_event_id: evento.source_event_id });
  const fato = (evento: BrainEvent): FatoCitado | FatoRetido => {
    const id = evento.aggregate_id;
    if (noBrain.retidos.has(id)) { lacuna(id, 'brain.retido'); return { id, frescor: 'retido' }; }
    const { instance, source_ref, source_hash, source_version, location } = evento.source, b = noBrain.ok.get(id);
    const frescor = !b ? 'ausente-no-brain' : b.source?.source_hash === source_hash && b.source?.source_ref === source_ref ? 'confere' : 'divergente';
    if (frescor === 'ausente-no-brain') lacuna(id, 'brain.ausente');
    if (frescor === 'divergente') lacuna(id, 'fonte.divergente');
    return { brain: ids(evento), citacao: { instance, source_ref, source_hash, source_version, location }, frescor };
  };

  const visivel = (l: Linha | undefined) => !!l?.evento && !noBrain.retidos.has(l.evento.aggregate_id);
  const decisoes: ItemDeDecisao[] = [];
  for (const l of escolhidas) {
    // Sem id no Brain não há citação: a decisão vira lacuna, nunca conteúdo.
    if (!l.evento) { lacuna(idDe(l), 'citacao.incompleta'); continue; }
    const id = idDe(l), f = fato(l.evento), e = l.e, tipo = classe.get(l)!;
    // D6: retido pelo Brain não mostra nem o conteúdo local (BR-024-03).
    if (f.frescor === 'retido') { decisoes.push(f); continue; }
    const comum = { id, fase: texto(e.fase), em: e.ts, ...f };
    if (tipo === 'decidido') {
      const p = pedidoDe(l) as DecisaoInformada;
      decisoes.push({ ...comum, classe: tipo, contrato: p.contrato, autoria: 'autonoma', decidido: p.decidido, porque: p.porque, comoMudar: p.comoMudar,
        custoDeReverter: { agora: p.custoDeReverter.agora, depois: p.custoDeReverter.depois }, criterio: { tipo: p.criterio.tipo, referencia: p.criterio.referencia },
        quemDecidiu: String(e.quemDecidiu ?? ''), evidencia: String(e.evidencia ?? ''), razao: String(e.razao ?? ''),
        reverte: texto(e.reverte), revertidaPor: visivel(revertidaPor.get(p.id)) ? String(pedidoDe(revertidaPor.get(p.id)!).id) : null });
      // D-G3: o contrato do `decidido` não guarda alternativas; o `comoMudar` é o caminho de volta.
      lacuna(id, 'alternativas.nao-registradas');
    } else if (tipo === 'pergunta') {
      const p = pedidoDe(l);
      const alternativas: Alternativa[] = p.contrato === 'ork.hitl/v2'
        ? (p as PerguntaAoDono).alternativas.map((a, i) => ({ numero: i + 1, letra: a.letra, texto: a.texto, acao: a.acao,
          consequencia: a.consequencia, recomendada: a.recomendada === true, porque: a.porque ?? null }))
        : (p as PedidoHitl).opcoes.map(o => ({ numero: o.numero, letra: null, texto: o.texto, acao: o.acao, consequencia: null, recomendada: false, porque: null }));
      const provada = provadas.get(id), gates = respostas.get(id) ?? [];
      let resposta: RespostaDoDono | null = null, estado: 'decidida' | 'retida' | 'sem-prova' | 'aguardando' = 'aguardando';
      if (provada) {
        const r = fato(provada.evento!), g = provada.e, escolha = alternativas.find(a => a.numero === g.opcao);
        // Resposta retida: nem a escolha nem a autoria saem da linha local.
        estado = r.frescor === 'retido' ? 'retida' : 'decidida';
        resposta = r.frescor === 'retido' ? r : { ...r, opcao: Number.isInteger(g.opcao) ? g.opcao as number : null, letra: escolha?.letra ?? null,
          texto: escolha?.texto ?? null, veredito: texto(g.estado), quem: String(g.autorizadoPor ?? ''), origem: String(g.origem ?? ''),
          canal: texto(g.canal), recebidoEm: texto(g.recebidoEm), recibo: texto(g.recibo), evidencia: texto(g.evidencia), evidenciaSha256: texto(g.evidenciaSha256) };
      } else if (gates.length) { estado = 'sem-prova'; lacuna(id, 'resposta.sem-prova'); }
      else lacuna(id, 'resposta.pendente');
      // O prazo vai como está no pedido; vencido ou não é leitura de quem consulta, e o digest não depende do relógio.
      decisoes.push({ ...comum, classe: tipo, contrato: p.contrato, autoria: estado === 'decidida' ? 'dono' : null, pergunta: String((p as { pergunta: string }).pergunta),
        sobre: alvoDoPedido(p)?.tipo === 'gate' ? String((alvoDoPedido(p) as { sobre: string }).sobre) : '', alternativas,
        recomendacao: p.contrato === 'ork.hitl/v2' ? null : texto((p as PedidoHitl).recomendacao), prazo: texto((p as { prazo?: unknown }).prazo),
        estado, resposta });
    } else {
      const rastro = rastroDaDecisao(e);
      decisoes.push({ ...comum, classe: tipo, contrato: 'legado', autoria: 'autonoma', decidido: texto(e.decisao) ?? '',
        quemDecidiu: rastro.quemDecidiu ?? null, evidencia: rastro.evidencia ?? null, razao: rastro.razao ?? null, rastroCompleto: rastro.completa });
      lacuna(id, 'decisao.fora-do-contrato');
      lacuna(id, 'alternativas.nao-registradas');
    }
  }

  const unicas = [...new Map(lacunas.map(x => [`${x.id} ${x.codigo}`, x])).values()]
    .sort((a, b) => comparar(a.id, b.id) || comparar(a.codigo, b.codigo));
  // D7: o digest cobre o digest do pacote de contexto, não o pacote inteiro; o horário fica fora.
  const corpo = { ...base, state: (decisoes.length ? 'ok' : 'empty') as BrainResponse['state'], vinculo, contexto: contexto?.digest ?? null,
    decisoes, lacunas: unicas };
  return { ...corpo, contexto, digest: digest(corpo), consultadoEm: new Date().toISOString() };
}
