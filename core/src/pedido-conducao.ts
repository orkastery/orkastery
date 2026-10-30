/**
 * Pedido estreito da sessao de fase para a conducao. A sessao nao executa o comando,
 * nao aprova gate e nao assume o dono: ela apenas registra por que parou e o passo exato.
 */
import { registrarGateBloqueado } from './gates';
import { lerLedger } from './ledger';
import { dirThread, lerThread } from './thread';
import { MotivoGate } from './types';

export const MOTIVOS_DE_PEDIDO_A_CONDUCAO = [
  'concurrency.lease-indeterminado',
  'conducao.acao-necessaria',
] as const satisfies readonly MotivoGate[];

export type MotivoDoPedidoAConducao = typeof MOTIVOS_DE_PEDIDO_A_CONDUCAO[number];

export interface EntradaDoPedidoAConducao {
  despacho: string;
  motivo: MotivoDoPedidoAConducao;
  detalhe: string;
  comando: string;
  host: 'claude-code' | 'codex' | 'grok';
}

function comandoSeguro(comando: string): boolean {
  return comando.length <= 1000 && /^ork [^\s]/u.test(comando) && !/[\p{Cc}\p{Cf};|&<>`$\\()]/u.test(comando) &&
    !/\s{2,}/.test(comando) && comando.trim() === comando;
}

/** Registra uma vez, sempre correlacionado ao despacho que originou o servidor MCP filho. */
export function registrarPedidoAConducao(raiz: string, threadId: string, entrada: EntradaDoPedidoAConducao) {
  if (!MOTIVOS_DE_PEDIDO_A_CONDUCAO.includes(entrada.motivo)) throw Error('conducao.request.reason.invalid');
  if (!comandoSeguro(entrada.comando)) {
    throw Error('conducao.request.command.invalid: informe um comando ork de uma linha, sem operadores de shell');
  }
  const thread = lerThread(raiz, threadId), dir = dirThread(raiz, threadId), eventos = lerLedger(dir);
  const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' &&
    (e.identidade as { dispatchId?: unknown } | undefined)?.dispatchId === entrada.despacho).at(-1);
  if (!despacho || despacho.thread !== threadId || typeof despacho.sessionId !== 'string' || typeof despacho.fase !== 'string') {
    throw Error('conducao.request.dispatch.invalid: o servidor nao corresponde a um despacho provado desta thread');
  }
  const sessao = thread.sessoes.find(s => s.sessionId === despacho.sessionId && s.fase === despacho.fase);
  if (!sessao) throw Error('conducao.request.session.invalid: o despacho nao esta vinculado a sessao ativa da thread');
  const existente = eventos.filter(e => e.tipo === 'gate_blocked' && e.origem === 'mcp.request_conduction' &&
    e.despacho === entrada.despacho && e.motivo === entrada.motivo && e.comando === entrada.comando).at(-1);
  if (existente) return { ok: true, criado: false, eventId: existente.eventId, motivo: entrada.motivo,
    comando: entrada.comando, fase: despacho.fase, sessionId: despacho.sessionId, despacho: entrada.despacho };
  const evento = registrarGateBloqueado(dir, threadId, {
    gate: 'phase.dispatch', motivo: entrada.motivo, modo: thread.modo,
    detalhe: entrada.detalhe, correcao: entrada.comando,
    evidencia: `despacho ${entrada.despacho} da sessao ${despacho.sessionId}`,
    fase: despacho.fase, sessionId: despacho.sessionId, despachoEm: sessao.despachadaEm,
    despacho: entrada.despacho, comando: entrada.comando, origem: 'mcp.request_conduction',
    pedidoConducao: { contrato: 'ork.pedido-conducao/v1', host: entrada.host, estado: 'aberto' },
  });
  return { ok: true, criado: true, eventId: evento.eventId, motivo: entrada.motivo,
    comando: entrada.comando, fase: despacho.fase, sessionId: despacho.sessionId, despacho: entrada.despacho };
}
