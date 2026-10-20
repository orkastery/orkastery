/**
 * RM-058, integração (N4 do CHECK 2 da ork-rm058integra): as sessões do arco que podem estar em voo, numa conta só para o
 * fechamento (que pede a parada delas) e para a guarda das threads do arco (que não deixa a sessão do arco terminal entregar
 * por fora). O módulo só lê o log do arco, os ledgers e as threads: a guarda o importa sem o ciclo
 * `ship` -> `noctum-guarda` -> `noctum-fechamento` -> `master` -> `ship`, que deixava constantes do `ship` sem valor no
 * carregamento.
 */
import { lerLedger, TIPOS_DE_EVENTO } from './ledger';
import { DespachoDoArco, EstadoDoArco } from './noctum-arco';
import { envelopeComTrabalhos, shaDoPedido } from './noctum-envelope';
import { dirThread, lerThread, listarIds } from './thread';

/** A sessão em voo que o fechamento manda parar. */
export interface SessaoEmVoo {
  seq: number; sessionId: string | null; trabalho: string; thread: string | null; runtime: string; conta: string;
  /** Veio de uma reserva pendente (o id, quando há, é o que a falha do runtime disse no ledger da thread). */
  daReservaPendente?: boolean;
}

const FIM_DA_SESSAO: readonly string[] = ['phase_result', 'sessao_morta', 'session_superseded'];

/**
 * A thread de uma reserva: a do log do arco ou, no trabalho de pedido que o arco abriu depois de reservar, a única que
 * casa com o item e o sha256 do pedido (a mesma regra da fila). Ambígua ou ilegível: nenhuma.
 */
function threadDaReserva(raiz: string, estado: EstadoDoArco, d: DespachoDoArco): string | null {
  const gravada = d.threadDespachada ?? d.thread;
  if (gravada) return gravada;
  const t = estado.conteudo && envelopeComTrabalhos(estado.conteudo) ? estado.conteudo.trabalhos.find(x => x.id === d.trabalho) : undefined;
  if (!t?.pedido) return null;
  const sha = shaDoPedido(t.pedido);
  const casam: string[] = [];
  for (const id of listarIds(raiz)) {
    try { const th = lerThread(raiz, id); if (th.roadmap === t.item && th.pedido?.sha256 === sha) casam.push(id); }
    catch { return null; }
  }
  return casam.length === 1 ? casam[0] : null;
}

/**
 * As sessões do arco que podem estar em voo: a sessão concluída sem resultado no ledger e a reserva pendente. A reserva
 * pendente leva o id que a falha do runtime disse depois dela (o `claude --bg` que diz o id e sai com erro deixa a sessão
 * aberta), e fica sem id quando nada foi dito.
 */
export function sessoesEmVooDoArco(raiz: string, estado: EstadoDoArco): SessaoEmVoo[] {
  const vistas = new Set<string>();
  const emVoo: SessaoEmVoo[] = [];
  const ledgers = new Map<string, ReturnType<typeof lerLedger> | null>();
  const eventosDe = (thread: string | null): ReturnType<typeof lerLedger> | null => {
    if (!thread) return null;
    if (!ledgers.has(thread)) {
      let e: ReturnType<typeof lerLedger> | null;
      try { e = lerLedger(dirThread(raiz, thread)); } catch { e = null; }
      ledgers.set(thread, e);
    }
    return ledgers.get(thread)!;
  };
  // Ledger que não se lê: a sessão pode estar em voo; o fechamento pede a parada em vez de presumir o fim.
  const acabou = (eventos: ReturnType<typeof lerLedger> | null, sid: string) =>
    !!eventos?.some(e => FIM_DA_SESSAO.includes(e.tipo) && e.sessionId === sid);
  for (const d of estado.despachos) {
    if (d.desfecho === 'recusado') continue;
    if (d.desfecho === 'pendente') {
      const thread = threadDaReserva(raiz, estado, d);
      const eventos = eventosDe(thread);
      const dita = eventos?.filter(e => (e.tipo === TIPOS_DE_EVENTO.despachoFalhou || e.tipo === TIPOS_DE_EVENTO.faseDespachada) &&
        typeof e.sessionId === 'string' && Date.parse(e.ts) >= Date.parse(d.reservadoEm)).at(-1);
      const sessionId = typeof dita?.sessionId === 'string' ? dita.sessionId : null;
      if (sessionId && (vistas.has(sessionId) || acabou(eventos, sessionId))) { vistas.add(sessionId); continue; }
      if (sessionId) vistas.add(sessionId);
      emVoo.push({ seq: d.seq, sessionId, trabalho: d.trabalho, thread, runtime: d.runtime, conta: d.conta, daReservaPendente: true });
      continue;
    }
    if (!d.sessionId || vistas.has(d.sessionId)) continue;
    vistas.add(d.sessionId);
    const thread = d.threadDespachada ?? d.thread;
    if (!acabou(eventosDe(thread), d.sessionId)) {
      emVoo.push({ seq: d.seq, sessionId: d.sessionId, trabalho: d.trabalho, thread, runtime: d.runtime, conta: d.conta });
    }
  }
  return emVoo;
}
