/** Ingresso do cliente MCP confiável. Não é uma API de resposta do modelo.
 * A instalação/perfil do cliente pertence à fronteira de confiança: não autentica
 * uma pessoa contra comprometimento do próprio cliente ou da conta local.
 */
import { randomUUID } from 'node:crypto';
import { PedidoHitl, validarPedidoHitl, estadoDoPedido } from './hitl-contract';
import { comLockHitl, contextoHitl, responderGateLocal } from './hitl-gates';
import { responderSessaoLocal, ResultadoEntregaSessao } from './hitl-sessions';
import type { ControleSessao } from './hitl-sessions';
import { lerLedger, registrar } from './ledger';
import { selecaoDeCanal } from './hitl-canais';
import { reservarDialogoHitl } from './hitl-lock';
import { dirThread, lerThread } from './thread';
import { descartarAtestadoLocal, hashPedidoLocal, registrarAtestadoLocal } from './hitl-local-atestado';
export { consumirAtestadoLocal, hashPedidoLocal, reciboDoAtestado } from './hitl-local-atestado';
export type { AtestacaoLocal } from './hitl-local-receipt';

export interface RespostaElicitation {
  action: 'accept' | 'decline' | 'cancel';
  content?: { opcao: string };
}
export interface ResultadoDecisaoLocal {
  ok: boolean; pedidoId: string; estado: string; repetida: boolean;
  publicacaoMemoria?: { estado: 'publicada'|'pendente'; motivo: string|null; recuperar: string };
}

/** D12: o mesmo ingresso serve gate e sessão; o alvo do pedido decide o caminho. */
export type ResultadoIngressoLocal = ResultadoDecisaoLocal | ResultadoEntregaSessao;
const idValido = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(s);

/** O callback é fornecido pelo servidor, nunca pelos argumentos de tools/call. */
export function criarIngressoLocal(
  raiz: string,
  origem: { host: 'claude-code' | 'codex'; connectionId: string },
  elicitar: (pedido: PedidoHitl, signal: AbortSignal) => Promise<RespostaElicitation>,
  /** Vinculo do adapter para resposta de SESSAO, fornecido pelo servidor. E o mesmo ponto
   *  de injecao que `responderSessao` ja tem; ausente, vale o controle nativo do runtime. */
  opcoes: { controle?: ControleSessao } = {}
): { solicitar: (threadId: string, pedidoId: string, signal?: AbortSignal) => Promise<ResultadoIngressoLocal>; fechar: () => void } {
  if (!['claude-code', 'codex'].includes(origem.host) || !idValido(origem.connectionId)) throw new Error('hitl.local.origem-invalida');
  const conexao = { ...origem }, ativos = new Map<string, AbortController>();
  let fechada = false;
  return {
    fechar() { fechada = true; for (const c of ativos.values()) c.abort(); },
    async solicitar(threadId, pedidoId, signal) {
      if (fechada) throw new Error('hitl.local.conexao-fechada');
      if (!idValido(threadId) || !idValido(pedidoId)) throw new Error('hitl.local.identificador-invalido');
      if (signal?.aborted) return { ok: false, pedidoId, estado: 'pendente', repetida: false };
      const key = `${threadId}:${pedidoId}`;
      if (ativos.has(key)) throw new Error('hitl.local.solicitacao-em-curso');
      lerThread(raiz, threadId);
      const eventos = lerLedger(dirThread(raiz, threadId));
      const evento = eventos.find(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl)?.id === pedidoId);
      validarPedidoHitl(evento?.pedido);
      const pedido = evento!.pedido as PedidoHitl;
      if (pedido.thread !== threadId) throw new Error('hitl.local.pedido-de-outra-thread');
      // D12: gate e sessão são os dois alvos do contrato HITL, e os dois atendem aqui.
      const alvo = pedido.alvo.tipo;
      const respondido = alvo === 'gate'
        ? eventos.find(e => e.tipo === 'human_gate' && e.pedidoId === pedidoId)
        : eventos.find(e => e.tipo === 'session_answered' && e.pedidoId === pedidoId);
      if (respondido) {
        return alvo === 'gate'
          ? { ok: true, pedidoId, estado: String(respondido.estado), repetida: true }
          : { ok: true, pedidoId, sessionId: String(respondido.sessionId), estado: 'entregue', repetida: true };
      }
      const contexto = contextoHitl(raiz, threadId);
      if (evento!.contexto !== contexto) throw new Error('hitl.local.pedido-antigo');
      if (estadoDoPedido(pedido) !== 'aberto') throw new Error('hitl.local.pedido-expirado');
      const pedidoSha256 = hashPedidoLocal(pedido), requestId = randomUUID(), controller = new AbortController();
      let liberarReserva: (() => void) | undefined;
      comLockHitl(raiz, threadId, () => {
        const current = lerLedger(dirThread(raiz, threadId));
        if (current.some(e => e.tipo === 'session_answer_sending' && e.pedidoId === pedidoId)) throw Error('hitl.channel.delivery-uncertain');
        const selected = selecaoDeCanal(current, pedidoId);
        if (selected) {
          if (selected.transporte !== 'mcp-local' || selected.reserva !== 'ork.hitl-dialogue/v1' ||
              typeof selected.requestId !== 'string' || typeof selected.connectionId !== 'string')
            throw Error('hitl.channel.in-use: seleção sem prova de abandono');
          const release = reservarDialogoHitl(dirThread(raiz, threadId), selected.requestId, selected.connectionId, true);
          try {
            registrar(dirThread(raiz, threadId), threadId, 'hitl_channel_released', { pedidoId, requestId: selected.requestId,
              reason: 'abandoned-dialogue', evidence: 'kernel-exclusive-lock', connectionId: conexao.connectionId });
          } finally { release(); }
        }
        liberarReserva = reservarDialogoHitl(dirThread(raiz, threadId), requestId, conexao.connectionId);
        try {
          registrar(dirThread(raiz, threadId), threadId, 'hitl_channel_selected', { pedidoId,
            canal: conexao.host, transporte: 'mcp-local', connectionId: conexao.connectionId, requestId, contexto, pedidoSha256,
            reserva: 'ork.hitl-dialogue/v1' });
        } catch (e) { liberarReserva(); throw e; }
      });
      ativos.set(key, controller);
      const abortar = () => controller.abort();
      signal?.addEventListener('abort', abortar, { once: true });
      const cancelar = new Promise<RespostaElicitation>(resolve => controller.signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true }));
      const timer = setTimeout(() => controller.abort(), Math.min(300000, Date.parse(pedido.prazo) - Date.now()));
      try {
        // Copia isolada: o cliente não altera o snapshot usado na conferência final.
        const resposta = await Promise.race([elicitar(JSON.parse(JSON.stringify(pedido)), controller.signal), cancelar]);
        if (fechada || controller.signal.aborted || resposta?.action === 'cancel' || resposta?.action === 'decline') {
          return { ok: false, pedidoId, estado: 'pendente', repetida: false };
        }
        if (resposta?.action !== 'accept' || !resposta.content ||
            Object.keys(resposta.content).length !== 1 || typeof resposta.content.opcao !== 'string' ||
            resposta.content.opcao.length > pedido.respostaAceita.maxCaracteres) {
          throw new Error('hitl.local.resposta-invalida');
        }
        const token = Object.freeze({});
        registrarAtestadoLocal(token, { raiz, thread: threadId, pedidoId, contexto, pedidoSha256, ...conexao,
          requestId, opcao: resposta.content.opcao, recebidoEm: new Date().toISOString(), alvo });
        try {
          return alvo === 'gate'
            ? responderGateLocal(raiz, threadId, pedidoId, token)
            : responderSessaoLocal(raiz, threadId, pedidoId, token, opcoes.controle);
        }
        finally { descartarAtestadoLocal(token); }
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abortar); ativos.delete(key);
        try { comLockHitl(raiz, threadId, () => {
          const current = lerLedger(dirThread(raiz, threadId)), selected = selecaoDeCanal(current, pedidoId);
          if (selected?.requestId === requestId && !current.some(e =>
              ['human_gate', 'session_answer_sending', 'session_answered'].includes(e.tipo) && e.pedidoId === pedidoId))
            registrar(dirThread(raiz, threadId), threadId, 'hitl_channel_released', { pedidoId, requestId, reason: 'dialogue-ended-without-effect' });
        }); } finally { liberarReserva?.(); }
      }
    }
  };
}
