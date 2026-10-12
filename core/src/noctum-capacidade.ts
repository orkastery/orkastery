/**
 * RM-058, fatia N2 (D7 da ork-rm058n2): a capacidade de sessões do arco.
 *
 * Ocupação são as sessões que trabalham agora: as conduções `exec:<thread>` de sessão desta raiz de estado, pela mesma
 * regra de vaga do `ork phase run` (`sessaoLivreDaVaga`), mais os despachos em curso, unidas às sessões vivas do runtime
 * em todas as contas que o `ork` conhece (inclusive de outros projetos desta máquina), sem repetir sessão. A sessão que
 * o runtime prova encerrada na própria conta sai da conta, mesmo com o lease de pé (aprendizado 2 de 12/10). Fonte que
 * falha não vira zero: vira lacuna, e com lacuna nada é admitido.
 *
 * `admitir` é puro: o projeto (o mesmo portão de vaga do `phase run`), a máquina, a conta, o runtime e a margem de
 * revisão do envelope ao mesmo tempo. Nada aqui despacha nem grava.
 */
import { VagaRecusada } from './board';
import { conducaoDaThread } from './conducao';
import { lerLedger } from './ledger';
import { ManifestoCarregado } from './manifest';
import { Capacidade } from './noctum-envelope';
import { sessaoLivreDaVaga } from './ocupacao';
import { consultarContas, ContaDeSessoes, FonteDeSessoes, SessaoDaConta } from './sessoes-contas';
import { dirThread, listarIds } from './thread';

/** Quem trabalha agora, com o que a vaga de cada limite precisa saber. */
export interface SessaoOcupante {
  sessionId: string | null;
  thread: string | null;
  /** `null` no despacho em curso, que ainda não abriu sessão: conta só na máquina. */
  runtime: string | null;
  /** O id do perfil da conta; `null` é a conta do processo ou o despacho em curso. */
  conta: string | null;
  /** Sessão de CHECK, que pode usar os slots reservados à revisão. */
  revisao: boolean;
  origem: 'conducao' | 'despacho' | 'runtime';
}

export interface FatosDeCapacidade {
  quando: string;
  ocupantes: SessaoOcupante[];
  /** Fontes de sessões que não responderam. Com alguma, a ocupação não é conhecida e nada é admitido. */
  lacunas: string[];
  /** Sessões que o lease ainda dava como vivas e o runtime provou encerradas. */
  encerradasPeloRuntime: string[];
}

export type MotivoDaCapacidade =
  | 'capacidade.fonte-indisponivel' | 'capacidade.runtime-nao-autorizado' | 'capacidade.conta-nao-autorizada'
  | 'capacidade.projeto' | 'capacidade.maquina' | 'capacidade.revisao' | 'capacidade.conta' | 'capacidade.runtime';

/** O pedido de uma vaga para um despacho do arco. */
export interface PedidoDeVaga { runtime: string; conta: string; revisao: boolean }

export type Admissao = { ok: true } | { ok: false; motivo: MotivoDaCapacidade; detalhe: string };

/** O que a leitura do runtime devolve; os testes injetam a deles no lugar de `consultarContas`. */
export interface LeituraDeSessoes { sessoes: SessaoDaConta[]; fontes: FonteDeSessoes[]; contas: Pick<ContaDeSessoes, 'runtime' | 'perfil'>[] }

const TERMINAIS = ['done', 'completed', 'exited', 'stopped', 'failed'];
const estadoDe = (s: SessaoDaConta): string => String(s.state ?? s.status ?? '').trim().toLowerCase();

/**
 * O runtime prova que a sessão do lease acabou? Presente com estado terminal ou fantasma, sim. Ausente, só no
 * claude-bg (o `claude agents` lista as sessões que o daemon da conta mantém), com todas as fontes lidas e a conta
 * dela entre as consultadas. O codex lista só rollouts recentes: ausência lá não prova nada.
 */
function encerradaPeloRuntime(dono: { sessionId: string; runtime: string; perfil: string | null }, leitura: LeituraDeSessoes,
  porSessao: Map<string, SessaoDaConta>, semLacuna: boolean): boolean {
  const vista = porSessao.get(dono.sessionId);
  if (vista) return vista.fantasma || TERMINAIS.includes(estadoDe(vista));
  if (!semLacuna || dono.runtime !== 'claude-bg') return false;
  return leitura.contas.some(c => c.runtime === 'claude-bg' && (c.perfil?.id ?? null) === dono.perfil);
}

/**
 * A ocupação desta máquina agora, relida a cada chamada. `consultar` é dependência dos testes; sem ela, as sessões de
 * todas as contas pelo `consultarContas`, a mesma leitura do escalonador.
 */
export function fatosDeCapacidade(carregado: ManifestoCarregado, opcoes: { quando?: string; consultar?: () => LeituraDeSessoes } = {}):
  FatosDeCapacidade {
  const quando = opcoes.quando ?? new Date().toISOString();
  const { raiz, manifesto } = carregado;
  const staleMin = manifesto.concurrency.stale_after_min;
  const leitura = (opcoes.consultar ?? (() => consultarContas(raiz, { staleMin })))();
  const lacunas = leitura.fontes.filter(f => !f.ok).map(f => `${f.origem}: ${f.detalhe}`);
  const porSessao = new Map(leitura.sessoes.map(s => [s.sessionId, s] as const));
  const ocupantes: SessaoOcupante[] = [];
  const encerradasPeloRuntime: string[] = [];
  const contadas = new Set<string>();
  // A sessão que a regra da vaga solta (turno encerrado, espera do dono, parada) não volta pela lista do runtime.
  const soltas = new Set<string>();
  for (const id of listarIds(raiz)) {
    let atual: ReturnType<typeof conducaoDaThread> = null;
    try { atual = conducaoDaThread(raiz, id); } catch { continue; }
    if (!atual) continue;
    if (atual.dono.tipo === 'processo' && (atual.operacao === 'phase.run' || atual.operacao === 'retry.run')) {
      ocupantes.push({ sessionId: null, thread: id, runtime: null, conta: null, revisao: atual.fase === 'CHECK', origem: 'despacho' });
      continue;
    }
    if (atual.dono.tipo !== 'sessao') continue;
    const dono = atual.dono;
    try {
      if (sessaoLivreDaVaga(lerLedger(dirThread(raiz, id)), atual.desde, quando, staleMin, dono.sessionId)) { soltas.add(dono.sessionId); continue; }
    }
    catch { /* ledger ilegível: a condução viva continua contando, como no portão do phase run */ }
    if (encerradaPeloRuntime(dono, leitura, porSessao, lacunas.length === 0)) { encerradasPeloRuntime.push(dono.sessionId); continue; }
    contadas.add(dono.sessionId);
    ocupantes.push({ sessionId: dono.sessionId, thread: id, runtime: dono.runtime, conta: dono.perfil, revisao: atual.fase === 'CHECK',
      origem: 'conducao' });
  }
  for (const s of leitura.sessoes) {
    if (!s.viva || contadas.has(s.sessionId) || soltas.has(s.sessionId) || encerradasPeloRuntime.includes(s.sessionId)) continue;
    contadas.add(s.sessionId);
    ocupantes.push({ sessionId: s.sessionId, thread: null, runtime: s.runtime, conta: s.perfil, revisao: false, origem: 'runtime' });
  }
  return { quando, ocupantes, lacunas, encerradasPeloRuntime };
}

const limiteDe = <K extends 'conta' | 'runtime'>(lista: Array<Record<K, string> & { sessoes: number }>, chave: K, nome: string): number | null =>
  lista.find(x => x[chave] === nome)?.sessoes ?? null;

/**
 * Cabe mais esta sessão? Todos os limites ao mesmo tempo, na ordem: leitura completa, conta e runtime autorizados,
 * o projeto (o portão do `phase run`, que o chamador consulta para a thread), a máquina, a margem de revisão (a
 * execução não usa os slots reservados ao CHECK), a conta e o runtime.
 */
export function admitir(pedido: PedidoDeVaga, limites: Capacidade, fatos: FatosDeCapacidade, vagaDoProjeto: VagaRecusada | null): Admissao {
  if (fatos.lacunas.length) {
    return { ok: false, motivo: 'capacidade.fonte-indisponivel', detalhe: `sessões sem leitura: ${fatos.lacunas.join('; ')}` };
  }
  const limiteDoRuntime = limiteDe(limites.porRuntime, 'runtime', pedido.runtime);
  if (limiteDoRuntime === null) {
    return { ok: false, motivo: 'capacidade.runtime-nao-autorizado', detalhe: `o runtime ${pedido.runtime} não está no envelope` };
  }
  const limiteDaConta = limiteDe(limites.porConta, 'conta', pedido.conta);
  if (limiteDaConta === null) {
    return { ok: false, motivo: 'capacidade.conta-nao-autorizada', detalhe: `a conta ${pedido.conta} não está no envelope` };
  }
  if (vagaDoProjeto) return { ok: false, motivo: 'capacidade.projeto', detalhe: vagaDoProjeto.detalhe };
  const total = fatos.ocupantes.length;
  if (total >= limites.maquina) {
    return { ok: false, motivo: 'capacidade.maquina', detalhe: `${total} sessão(ões) nesta máquina e o limite do envelope é ${limites.maquina}` };
  }
  const execucao = fatos.ocupantes.filter(o => !o.revisao).length;
  if (!pedido.revisao && execucao >= limites.maquina - limites.revisao) {
    return { ok: false, motivo: 'capacidade.revisao', detalhe: `${execucao} sessão(ões) de execução e ${limites.revisao} slot(s) ` +
      `reservado(s) à revisão de ${limites.maquina}: só o CHECK usa o que sobra` };
  }
  const naConta = fatos.ocupantes.filter(o => o.conta === pedido.conta).length;
  if (naConta >= limiteDaConta) {
    return { ok: false, motivo: 'capacidade.conta', detalhe: `${naConta} sessão(ões) na conta ${pedido.conta} e o limite é ${limiteDaConta}` };
  }
  const noRuntime = fatos.ocupantes.filter(o => o.runtime === pedido.runtime).length;
  if (noRuntime >= limiteDoRuntime) {
    return { ok: false, motivo: 'capacidade.runtime', detalhe: `${noRuntime} sessão(ões) no ${pedido.runtime} e o limite é ${limiteDoRuntime}` };
  }
  return { ok: true };
}

/**
 * A conta do despacho: entre as do envelope que são perfis do runtime (`perfisDoRuntime`, do store de contas), a com
 * mais folga no limite dela; empate pela ordem do envelope. `null` quando nenhuma tem vaga.
 */
export function escolherConta(limites: Capacidade, fatos: FatosDeCapacidade, perfisDoRuntime: readonly string[]): string | null {
  let melhor: { conta: string; folga: number } | null = null;
  for (const { conta, sessoes } of limites.porConta) {
    if (!perfisDoRuntime.includes(conta)) continue;
    const folga = sessoes - fatos.ocupantes.filter(o => o.conta === conta).length;
    if (folga > 0 && (!melhor || folga > melhor.folga)) melhor = { conta, folga };
  }
  return melhor?.conta ?? null;
}
