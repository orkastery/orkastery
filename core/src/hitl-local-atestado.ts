/**
 * Capacidade de uso único do ingresso MCP local, num módulo sem dependência de fluxo.
 *
 * Isto morava em `hitl-local.ts`. Quando o ingresso local passou a atender também pergunta
 * de sessão (D12), `hitl-local` precisou chamar `hitl-sessions`, que já chamava
 * `hitl-local` para consumir o atestado: um ciclo em tempo de execução, do tipo que só
 * aparece como `undefined is not a function` na ordem errada de carga. O atestado não
 * depende de gate nem de sessão, então ele fica aqui e os dois fluxos importam daqui.
 */
import { createHash } from 'node:crypto';
import { PedidoHitlQualquer } from './hitl-contract';
import type { AtestacaoLocal } from './hitl-local-receipt';

/** Chave é o próprio token congelado: quem não tem a referência não consome a capacidade. */
const atestados = new WeakMap<object, AtestacaoLocal>();

/** I-41: o hash e dos BYTES do pedido, e por isso nao depende da versao do contrato. */
export const hashPedidoLocal = (p: PedidoHitlQualquer): string =>
  createHash('sha256').update(JSON.stringify(p)).digest('hex');

/**
 * D12: o recibo entregue ao receptor amarra o conteúdo, não só a conexão.
 *
 * O envelope do Telegram já fazia isso: o `prova` é um HMAC sobre um corpo que inclui a
 * resposta, então o recibo derivado dele muda se o conteúdo mudar. Um recibo local sobre
 * `[conexão, solicitação, pedido]` provaria apenas QUE alguém respondeu daquela conexão,
 * nunca O QUE o receptor recebeu. Com o hash da resposta dentro, o recibo que o controller
 * confirma é específico daquele conteúdo.
 */
export function reciboDoMaterial(connectionId: string, requestId: string, pedidoSha256: string, respostaSha256: string): string {
  return createHash('sha256')
    .update(JSON.stringify([connectionId, requestId, pedidoSha256, respostaSha256]))
    .digest('hex');
}

export function reciboDoAtestado(a: Pick<AtestacaoLocal, 'connectionId' | 'requestId' | 'pedidoSha256' | 'opcao'>): string {
  return reciboDoMaterial(a.connectionId, a.requestId, a.pedidoSha256,
    createHash('sha256').update(a.opcao).digest('hex'));
}

export function registrarAtestadoLocal(token: object, dados: AtestacaoLocal): void {
  atestados.set(token, dados);
}

export function descartarAtestadoLocal(token: object): void {
  atestados.delete(token);
}

/** Só consome capacidades emitidas nesta instância após resposta protocolar viva. */
export function consumirAtestadoLocal(token: unknown, raiz: string, thread: string, pedidoId: string): AtestacaoLocal {
  if (!token || typeof token !== 'object') throw new Error('hitl.local.atestado-invalido');
  const dados = atestados.get(token);
  atestados.delete(token);
  if (!dados || dados.raiz !== raiz || dados.thread !== thread || dados.pedidoId !== pedidoId) {
    throw new Error('hitl.local.atestado-invalido');
  }
  return dados;
}
