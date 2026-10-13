/**
 * RM-058, fatia N3 (D10 a D14 da ork-rm058n3): o passo de uma máquina num arco #Noctum entre máquinas.
 *
 * Com o envelope `v1` ou `v2`, o passo é o da N2, como está. Com a `v3`, sob a trava `.orkastery/noctum/maquina.lock` (um
 * passo de máquina por raiz de estado), a máquina:
 *
 * 1. reconcilia o que é dela: primeiro a vez de integrar (o merge que chegou à base vira entrega, sem integrar de novo),
 *    depois as ordens (conclui pela thread local, encerra a vencida sem sessão viva) e as vagas (pelo desfecho local do
 *    despacho), e solta a reserva do arco nos itens sem ordem viva dela;
 * 2. assume a autoridade quando o arco ainda não tem uma (a primeira vence pela troca atômica), bate e, sendo a
 *    autoridade, distribui as ordens dos trabalhos livres;
 * 3. responde as ordens emitidas para ela (aceita ou recusa, com o motivo) e toma a reserva da RM-047 de cada ordem aceita,
 *    revalidada com leitura nova; reserva de outra máquina encerra a ordem que nunca despachou;
 * 4. chama o passo da N2 só com os trabalhos das ordens aceitas e vivas, a reserva revalidada agora e a vaga global tomada
 *    no gancho `reservar`, depois da reserva local: a sessão só começa se a máquina e a soma das máquinas admitirem.
 *
 * Sem leitura nova do ramo, nada disso acontece e o passo espera (D7). Ninguém chama este passo ainda: o vigia é da N4,
 * que usa a mesma interface para a retomada em outra máquina.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exigirEstadoSemLink, raizDoEstado } from './estado-thread';
import { kernelDisponivel, tentarTravaExclusiva } from './fila-pesada';
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { ManifestoCarregado } from './manifest';
import { nomeDaMaquina } from './maquina';
import { concluirDespacho, lerArco, reservarDespacho } from './noctum-arco';
import { fatosDeCapacidade, LeituraDeSessoes } from './noctum-capacidade';
import {
  assumirAutoridade, AutoridadeDerivada, encerrarOrdem, entreguesNaRede, EstadoDaCoordenacao, FatosLocaisDaMaquina, lerCoordenacao,
  notaDaReserva, OpcoesDaCoordenacao, PlanoDeReconciliacao, reconciliarCoordenacao, registrosDaDistribuicao, registrosDasRespostas,
  soltarReservaDoArco, tomarReservaDoTrabalho, tomarVagaGlobal, derivarCoordenacao,
} from './noctum-coordenacao';
import { envelopeMultimaquina, RecusaDoArco, shaDoPedido, Trabalho } from './noctum-envelope';
import { OpcoesDoPasso, passoDoArco, ResultadoDoPasso } from './noctum-execucao';
import { reconciliarIntegracao, ReconciliacaoDaIntegracao } from './noctum-integracao';
import { gravarNoRamo } from './noctum-transporte';
import { listarReservas, quemSouEu } from './roadmap-reservas';
import { dirThread, lerThread, listarIds } from './thread';
import { Thread } from './types';

/** Quanto o passo espera a vez de outro passo desta máquina antes de devolver `aguardar`. */
const ESPERA_DA_VEZ_DA_MAQUINA_MS = 30_000;

export interface OpcoesDoPassoDaMaquina extends OpcoesDaCoordenacao {
  /**
   * As opções do passo da N2: dependências dos testes e a espera da vez de despachar. Com o envelope `v3`, a leitura das
   * reservas e a reserva do despacho são as da coordenação, e as daqui não valem.
   */
  n2?: Omit<OpcoesDoPasso, 'coordenacao' | 'quando' | 'maquina'>;
  /** A leitura das sessões, para a reconciliação das vagas; em produção, a mesma do passo da N2. */
  consultarSessoes?: () => LeituraDeSessoes;
}

export interface RelatorioDaMaquina {
  maquina: string;
  autoridade: AutoridadeDerivada | null;
  integracao: ReconciliacaoDaIntegracao | null;
  reconciliacao: PlanoDeReconciliacao | null;
  reservasSoltas: string[];
  ordensEmitidas: string[];
  respostas: Array<{ ordem: string; recibo: string; motivo: string }>;
  reservas: Array<{ ordem: string; item: string; ok: boolean; motivo: string | null }>;
  /** Os trabalhos que o passo da N2 pode despachar daqui: ordem aceita e viva, e a reserva do item revalidada agora. */
  trabalhos: string[];
}

export type ResultadoDoPassoDaMaquina =
  | { acao: 'uma-maquina'; passo: ResultadoDoPasso }
  | { acao: 'aguardar'; motivo: string; detalhe: string; relatorio: RelatorioDaMaquina }
  | { acao: 'passo'; passo: ResultadoDoPasso; relatorio: RelatorioDaMaquina };

const primeiraLinha = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300);
const pausa = new Int32Array(new SharedArrayBuffer(4));

/** A trava do passo da máquina: um passo por raiz de estado, para duas reconciliações não soltarem a mesma coisa. */
function vezDaMaquina(raiz: string, esperarMs: number): number | null {
  const principal = raizDoEstado(raiz);
  exigirEstadoSemLink(principal, ['.orkastery', 'noctum']);
  const dir = path.join(principal, '.orkastery', 'noctum');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const prazo = Date.now() + esperarMs;
  for (;;) {
    const fd = tentarTravaExclusiva(path.join(dir, 'maquina.lock'));
    if (fd !== null || Date.now() >= prazo) return fd;
    Atomics.wait(pausa, 0, 0, 200);
  }
}

/** A thread local de um trabalho: a do `thread`, ou a única que casa com o item e o sha256 do pedido. */
function threadDoTrabalho(raiz: string, t: Trabalho): Thread | null {
  try {
    if (t.thread) return lerThread(raiz, t.thread);
    const sha = shaDoPedido(t.pedido ?? '');
    const casam: Thread[] = [];
    for (const id of listarIds(raiz)) {
      try { const th = lerThread(raiz, id); if (th.roadmap === t.item && th.pedido?.sha256 === sha) casam.push(th); } catch { /* ilegível não decide */ }
    }
    return casam.length === 1 ? casam[0] : null;
  } catch { return null; }
}

/**
 * O que esta máquina sabe de si para reconciliar: a janela do arco, o desfecho local de cada reserva de despacho, as
 * sessões que ocupam agora (com lacuna, `null`: incerta é viva) e a thread local de cada trabalho.
 */
export function fatosLocaisDaMaquina(carregado: ManifestoCarregado, arco: string, estado: EstadoDaCoordenacao, quando: string,
  consultar?: () => LeituraDeSessoes): FatosLocaisDaMaquina {
  const { raiz } = carregado;
  const local = lerArco(raiz, arco, quando);
  let sessoesVivas: Set<string> | null;
  try {
    const cap = fatosDeCapacidade(carregado, { quando, consultar });
    sessoesVivas = cap.lacunas.length ? null : new Set(cap.ocupantes.map(o => o.sessionId).filter((x): x is string => !!x));
  } catch { sessoesVivas = null; }
  const threads = new Map<string, { id: string; entregue: boolean; fechada: boolean }>();
  for (const t of estado.vigente.conteudo.trabalhos ?? []) {
    const th = threadDoTrabalho(raiz, t);
    if (!th) continue;
    let entregue = false;
    try { entregue = lerLedger(dirThread(raiz, th.id)).some(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido); } catch { continue; }
    threads.set(t.id, { id: th.id, entregue, fechada: th.status === 'fechada' });
  }
  return { arcoVigente: local?.situacao === 'vigente', sessoesVivas, threads,
    despachos: new Map((local?.despachos ?? []).map(d => [d.seq, { desfecho: d.desfecho, sessionId: d.sessionId }])) };
}

/**
 * A reconciliação desta máquina, na volta ou a cada passo: a integração primeiro (o merge que chegou à base vira entrega
 * sem integrar de novo, e só então a ordem dela pode encerrar), depois as ordens e as vagas, e por fim as reservas do arco
 * nos itens sem ordem viva desta máquina. Lança a recusa tipada da leitura (sem remoto, adulterado).
 */
export function reconciliarMaquina(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoPassoDaMaquina = {}):
  { integracao: ReconciliacaoDaIntegracao; reconciliacao: PlanoDeReconciliacao; reservasSoltas: string[] } {
  const quando = opcoes.quando ?? new Date().toISOString();
  const integracao = reconciliarIntegracao(carregado, arco, opcoes);
  const estado = lerCoordenacao(carregado, arco, opcoes);
  const fatos = fatosLocaisDaMaquina(carregado, arco, estado, quando, opcoes.consultarSessoes);
  const reconciliacao = reconciliarCoordenacao(carregado, arco, fatos, opcoes);
  const reservasSoltas: string[] = [];
  const eu = quemSouEu(carregado.raiz, { maquina: opcoes.maquina });
  let painel;
  try { painel = listarReservas(carregado.raiz, { remoto: opcoes.remoto ?? carregado.manifesto.fabrica.remoto, rede: opcoes.rede }); }
  catch { painel = null; }
  if (painel?.atualizado) {
    const soltar = painel.reservas.filter(r => r.maquina === eu.maquina && r.por === eu.por && r.nota === notaDaReserva(arco) &&
      reconciliacao.itensSemOrdemViva.includes(r.item));
    for (const r of soltar) {
      try { if (soltarReservaDoArco(carregado, arco, r.item, opcoes)) reservasSoltas.push(r.item); } catch { /* fica para o passo seguinte */ }
    }
  }
  return { integracao, reconciliacao, reservasSoltas };
}

const aguardar = (motivo: string, detalhe: string, relatorio: RelatorioDaMaquina): ResultadoDoPassoDaMaquina =>
  ({ acao: 'aguardar', motivo, detalhe, relatorio });

/**
 * Um passo desta máquina no arco. Com o envelope `v3`, coordena pelo ramo e chama o passo da N2 com a ordem, a reserva e a
 * vaga global; com `v1` ou `v2`, é o passo da N2 como está. Toda recusa tipada da coordenação volta como `aguardar`.
 */
export function passoDaMaquina(carregado: ManifestoCarregado, arco: string, opcoes: OpcoesDoPassoDaMaquina = {}): ResultadoDoPassoDaMaquina {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz } = carregado;
  const local = lerArco(raiz, arco, quando);
  if (!local?.conteudo || !envelopeMultimaquina(local.conteudo)) {
    return { acao: 'uma-maquina', passo: passoDoArco(carregado, arco, { ...opcoes.n2, quando, maquina: opcoes.maquina }) };
  }
  const eu = nomeDaMaquina(opcoes.maquina);
  const relatorio: RelatorioDaMaquina = { maquina: eu, autoridade: null, integracao: null, reconciliacao: null, reservasSoltas: [],
    ordensEmitidas: [], respostas: [], reservas: [], trabalhos: [] };
  if (!kernelDisponivel()) return aguardar('sem-trava-do-kernel', 'o arco entre máquinas só anda com /usr/bin/flock', relatorio);
  const trava = vezDaMaquina(raiz, ESPERA_DA_VEZ_DA_MAQUINA_MS);
  if (trava === null) return aguardar('noctum.coordenacao.concorrencia', 'outro passo desta máquina está em curso', relatorio);
  const op: OpcoesDaCoordenacao = { remoto: opcoes.remoto, maquina: opcoes.maquina, quando, rede: opcoes.rede };
  try {
    // 1. A reconciliação do que é desta máquina.
    const rec = reconciliarMaquina(carregado, arco, { ...op, consultarSessoes: opcoes.consultarSessoes ?? opcoes.n2?.consultarSessoes });
    Object.assign(relatorio, { integracao: rec.integracao, reconciliacao: rec.reconciliacao, reservasSoltas: rec.reservasSoltas });
    // 2. A autoridade vaga, a batida e a distribuição.
    let estado = lerCoordenacao(carregado, arco, op);
    if (!estado.autoridade && local.situacao === 'vigente') {
      try { assumirAutoridade(carregado, arco, op); }
      catch (e) { if (!(e instanceof RecusaDoArco) || e.motivo !== 'noctum.coordenacao.autoridade-ativa') throw e; }
    }
    const distribuicao = gravarNoRamo(carregado, arco, op, (leitura) => {
      const e = derivarCoordenacao(leitura);
      const ordens = local.situacao === 'vigente' ? registrosDaDistribuicao(e, eu, quando) : [];
      return { novos: [{ tipo: 'batida' }, ...ordens], resultado: ordens.map(o => String(o.ordem)) };
    });
    relatorio.ordensEmitidas = distribuicao.resultado;
    // 3. As respostas às ordens desta máquina e as reservas das aceitas.
    const threadsLocais = new Map<string, { roadmap: string | null; modo: string }>();
    for (const id of listarIds(raiz)) {
      try { const th = lerThread(raiz, id); threadsLocais.set(id, { roadmap: th.roadmap ?? null, modo: th.modo }); } catch { /* ilegível não é aceita */ }
    }
    const respostas = gravarNoRamo(carregado, arco, op, (leitura) => {
      const novos = registrosDasRespostas(derivarCoordenacao(leitura), eu, { arcoVigente: local.situacao === 'vigente', threadsLocais });
      return { novos, resultado: novos.map(r => ({ ordem: String(r.ordem), recibo: String(r.recibo), motivo: String(r.motivo) })) };
    });
    relatorio.respostas = respostas.resultado;
    estado = lerCoordenacao(carregado, arco, op);
    relatorio.autoridade = estado.autoridade;
    const minhas = [...estado.ordens.values()].filter(o => o.maquina === eu && o.estado === 'aceita' && o.envelopeSha256 === estado.vigente.envelopeSha256);
    const reservadas: Array<{ item: string; thread: string | null }> = [];
    const permitidos = new Set<string>();
    // Uma leitura nova das reservas por passo: a reserva que já é desta máquina está revalidada por ela, sem renovar.
    const quem = quemSouEu(raiz, { maquina: opcoes.maquina });
    let painel;
    try { painel = minhas.length ? listarReservas(raiz, { remoto: op.remoto ?? carregado.manifesto.fabrica.remoto, rede: op.rede }) : null; }
    catch { painel = null; }
    for (const o of minhas) {
      const t = estado.vigente.conteudo.trabalhos!.find(x => x.id === o.trabalho)!;
      const thread = threadDoTrabalho(raiz, t)?.id ?? null;
      const atual = painel?.atualizado ? painel.reservas.find(x => x.item === o.item) : undefined;
      // A thread da reserva é informativa: renovar a cada passo por ela só faria commit novo no ramo de reservas.
      const jaMinha = !!atual && atual.maquina === quem.maquina && atual.por === quem.por;
      const r = !painel?.atualizado ? { ok: false as const, motivo: 'noctum.coordenacao.sem-remoto' as const, detalhe: 'as reservas não se leram agora' }
        : jaMinha ? { ok: true as const, acao: 'revalidada' } : tomarReservaDoTrabalho(carregado, arco, o.ordem, thread, op);
      relatorio.reservas.push({ ordem: o.ordem, item: o.item, ok: r.ok, motivo: r.ok ? null : r.motivo });
      if (r.ok) {
        permitidos.add(o.trabalho);
        if (!reservadas.some(x => x.item === o.item)) reservadas.push({ item: o.item, thread });
        continue;
      }
      // A reserva com outra máquina ou pessoa: a ordem que nunca despachou acaba aqui, com o motivo; a que tem vaga fica.
      if (r.motivo === 'noctum.reserva.de-outra-maquina' && !estado.vagas.some(v => v.ordem === o.ordem)) {
        encerrarOrdem(carregado, arco, o.ordem, { motivo: `${r.motivo}: ${r.detalhe}`, checkpoint: { thread, vagasSoltas: [] } }, op);
      }
    }
    relatorio.trabalhos = [...permitidos].sort();
    // 4. O passo da N2, só com o que o ramo deu a esta máquina, e a vaga global no gancho da reserva.
    const ordemDoTrabalho = new Map(minhas.filter(o => permitidos.has(o.trabalho)).map(o => [o.trabalho, o.ordem]));
    const reservar: typeof reservarDespacho = (raizDoPasso, pedido, q) => {
      const ordem = ordemDoTrabalho.get(pedido.trabalho);
      if (!ordem) throw new RecusaDoArco('noctum.coordenacao.ordem-vencida', `o trabalho ${pedido.trabalho} não tem ordem aceita desta máquina`);
      const r = reservarDespacho(raizDoPasso, pedido, q);
      try { tomarVagaGlobal(carregado, arco, { ordem, conta: pedido.conta, runtime: pedido.runtime, reserva: r.seq }, { ...op, quando: q }); }
      catch (e) {
        const recusa = e instanceof RecusaDoArco ? e : new RecusaDoArco('noctum.coordenacao.sem-remoto', primeiraLinha(e));
        concluirDespacho(raizDoPasso, arco, r.seq, { motivo: recusa.motivo });
        throw recusa;
      }
      return r;
    };
    const passo = passoDoArco(carregado, arco, { ...opcoes.n2, quando, maquina: opcoes.maquina, reservar,
      lerReservas: () => ({ leitura: 'copia-local', reservas: reservadas.map(x => ({ item: x.item, maquina: eu, thread: x.thread })) }),
      coordenacao: { trabalhos: permitidos, entregues: entreguesNaRede(estado) } });
    return { acao: 'passo', passo, relatorio };
  } catch (e) {
    if (!(e instanceof RecusaDoArco)) throw e;
    return aguardar(e.motivo, e.message, relatorio);
  } finally { fs.closeSync(trava); }
}

