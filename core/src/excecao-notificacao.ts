/** RM-089 F6: pedido e recibo da porta gerida de notificação; o ledger é uma etapa posterior. */
import { createPublicKey, verify } from 'node:crypto';
import { type ExcecaoDeRecibo, type PoliticaDaExcecaoDeRecibo, hashCanonicoDaExcecao } from './excecao-recibo';

export const CONTRATO_PEDIDO_NOTIFICACAO_EXCECAO = 'ork.excecao-notificacao-pedido/v1' as const;
export const CONTRATO_RECIBO_NOTIFICACAO_EXCECAO = 'ork.excecao-notificacao-recibo/v1' as const;
export const CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO = 'ork.excecao-notificacao-capability/v1' as const;
export const CONTRATO_PORTA_NOTIFICACAO_EXCECAO = 'ork.excecao-notificacao-port/v1' as const;

export type ResultadoDaEntregaDaExcecao = 'delivered' | 'rejected' | 'timeout' | 'unavailable' | 'ambiguous';

export interface PedidoDeNotificacaoDaExcecao {
  schema: typeof CONTRATO_PEDIDO_NOTIFICACAO_EXCECAO;
  requestId: string;
  threadId: string;
  idempotencyKey: string;
  authorizationRef: string;
  policyVersion: string;
  policySha256: string;
  project: string;
  source: string;
  target: string;
  head: string;
  operation: string;
  recipientRef: string;
  requestedAt: string;
  expiresAt: string;
  requestHash: string;
}

export interface ReciboDeNotificacaoDaExcecao {
  schema: typeof CONTRATO_RECIBO_NOTIFICACAO_EXCECAO;
  receiptId: string;
  requestId: string;
  requestHash: string;
  idempotencyKey: string;
  issuer: { id: string; keyId: string };
  authorizationRef: string;
  policyVersion: string;
  policySha256: string;
  project: string;
  source: string;
  target: string;
  head: string;
  operation: string;
  recipientRef: string;
  requestedAt: string;
  attemptedAt: string;
  issuedAt: string;
  deliveredAt: string | null;
  result: ResultadoDaEntregaDaExcecao;
  providerProofRef: string;
  providerProofHash: string;
  receiptHash: string;
  signature: string;
}

export interface CapacidadeDaNotificacaoDaExcecao {
  schema: typeof CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO;
  portId: string;
  policySha256: string;
  operation: 'notify-receipt-exception';
  expiresAt: string;
  verified: true;
}

export interface PortaGeridaDaNotificacaoDaExcecao {
  schema: typeof CONTRATO_PORTA_NOTIFICACAO_EXCECAO;
  id: string;
  issuerId: string;
  independent: true;
  send(request: PedidoDeNotificacaoDaExcecao, timeoutMs: number): unknown;
}

export type CodigoDaNotificacaoDaExcecao =
  | 'ci.excecao.porta-nao-comprovada'
  | 'ci.excecao.capacidade-ausente'
  | 'ci.excecao.capacidade-invalida'
  | 'ci.excecao.notificacao-indisponivel'
  | 'ci.excecao.recibo-invalido'
  | 'ci.excecao.recibo-replay'
  | 'ci.excecao.recibo-destinatario-divergente'
  | 'ci.excecao.recibo-emissor-divergente'
  | 'ci.excecao.recibo-assinatura-invalida'
  | 'ci.excecao.notificacao-rejeitada'
  | 'ci.excecao.notificacao-timeout'
  | 'ci.excecao.notificacao-ambigua';

export type ResultadoDaNotificacao = {
  ok: true;
  request: PedidoDeNotificacaoDaExcecao;
  receipt: ReciboDeNotificacaoDaExcecao;
  exception: ExcecaoDeRecibo;
} | {
  ok: false;
  code: CodigoDaNotificacaoDaExcecao;
  request: PedidoDeNotificacaoDaExcecao;
};

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown, teto = 500): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= teto
  && !/[\u0000-\u001f\u007f]/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const exatas = (v: Record<string, unknown>, chaves: readonly string[]): boolean => {
  const atuais = Object.keys(v).sort(), esperadas = [...chaves].sort();
  return atuais.length === esperadas.length && atuais.every((k, i) => k === esperadas[i]);
};

const dadosDoPedido = (p: Omit<PedidoDeNotificacaoDaExcecao, 'requestHash'>): unknown => p;

export function criarPedidoDeNotificacao(exception: ExcecaoDeRecibo, threadId: string,
  requestedAt = new Date().toISOString()): PedidoDeNotificacaoDaExcecao {
  const stable = [exception.authorizationRef, exception.policySha256, exception.project, exception.source,
    exception.target, exception.head, exception.operation, exception.responsibleRef];
  const idempotencyKey = `idem-${hashCanonicoDaExcecao(stable)}`;
  const requestId = `req-${hashCanonicoDaExcecao([idempotencyKey, threadId]).slice(0, 32)}`;
  const base: Omit<PedidoDeNotificacaoDaExcecao, 'requestHash'> = {
    schema: CONTRATO_PEDIDO_NOTIFICACAO_EXCECAO,
    requestId,
    threadId,
    idempotencyKey,
    authorizationRef: exception.authorizationRef,
    policyVersion: exception.policyVersion,
    policySha256: exception.policySha256,
    project: exception.project,
    source: exception.source,
    target: exception.target,
    head: exception.head,
    operation: exception.operation,
    recipientRef: exception.responsibleRef,
    requestedAt,
    expiresAt: exception.expiresAt,
  };
  return { ...base, requestHash: hashCanonicoDaExcecao(dadosDoPedido(base)) };
}

const CHAVES_ISSUER = ['id', 'keyId'] as const;
const CHAVES_RECIBO = ['schema', 'receiptId', 'requestId', 'requestHash', 'idempotencyKey', 'issuer',
  'authorizationRef', 'policyVersion', 'policySha256', 'project', 'source', 'target', 'head', 'operation',
  'recipientRef', 'requestedAt', 'attemptedAt', 'issuedAt', 'deliveredAt', 'result', 'providerProofRef',
  'providerProofHash', 'receiptHash', 'signature'] as const;

export function dadosAssinadosDoRecibo(receipt: Omit<ReciboDeNotificacaoDaExcecao, 'receiptHash' | 'signature'>): unknown {
  return receipt;
}

export function hashDoReciboDeNotificacao(receipt: Omit<ReciboDeNotificacaoDaExcecao, 'receiptHash' | 'signature'>): string {
  return hashCanonicoDaExcecao(dadosAssinadosDoRecibo(receipt));
}

function reciboEstrutural(v: unknown): v is ReciboDeNotificacaoDaExcecao {
  if (!obj(v) || !exatas(v, CHAVES_RECIBO) || v.schema !== CONTRATO_RECIBO_NOTIFICACAO_EXCECAO
      || !texto(v.receiptId) || !ID.test(v.receiptId) || !texto(v.requestId) || !ID.test(v.requestId)
      || !texto(v.requestHash) || !HASH.test(v.requestHash) || !texto(v.idempotencyKey) || !ID.test(v.idempotencyKey)
      || !obj(v.issuer) || !exatas(v.issuer, CHAVES_ISSUER) || !texto(v.issuer.id) || !ID.test(v.issuer.id)
      || !texto(v.issuer.keyId) || !ID.test(v.issuer.keyId) || !texto(v.authorizationRef)
      || !texto(v.policyVersion) || !texto(v.policySha256) || !HASH.test(v.policySha256) || !texto(v.project)
      || !texto(v.source) || !texto(v.target) || !texto(v.head) || !/^[a-f0-9]{40}$/.test(v.head)
      || !texto(v.operation) || !texto(v.recipientRef) || !iso(v.requestedAt) || !iso(v.attemptedAt)
      || !iso(v.issuedAt) || (v.deliveredAt !== null && !iso(v.deliveredAt))
      || !['delivered', 'rejected', 'timeout', 'unavailable', 'ambiguous'].includes(String(v.result))
      || !texto(v.providerProofRef) || !texto(v.providerProofHash) || !HASH.test(v.providerProofHash)
      || !texto(v.receiptHash) || !HASH.test(v.receiptHash) || !texto(v.signature, 4096)
      || !/^[A-Za-z0-9+/=]+$/.test(v.signature)) return false;
  return v.result === 'delivered' ? v.deliveredAt !== null : v.deliveredAt === null;
}

function codigoDoResultado(result: ResultadoDaEntregaDaExcecao): CodigoDaNotificacaoDaExcecao | null {
  if (result === 'delivered') return null;
  if (result === 'rejected') return 'ci.excecao.notificacao-rejeitada';
  if (result === 'timeout') return 'ci.excecao.notificacao-timeout';
  if (result === 'ambiguous') return 'ci.excecao.notificacao-ambigua';
  return 'ci.excecao.notificacao-indisponivel';
}

function conferirRecibo(v: unknown, request: PedidoDeNotificacaoDaExcecao, policy: PoliticaDaExcecaoDeRecibo,
  now: string): { ok: true; receipt: ReciboDeNotificacaoDaExcecao } | { ok: false; code: CodigoDaNotificacaoDaExcecao } {
  if (!reciboEstrutural(v)) return { ok: false, code: 'ci.excecao.recibo-invalido' };
  if (v.idempotencyKey !== request.idempotencyKey || v.requestId !== request.requestId || v.requestHash !== request.requestHash) {
    return { ok: false, code: 'ci.excecao.recibo-replay' };
  }
  if (v.recipientRef !== request.recipientRef) return { ok: false, code: 'ci.excecao.recibo-destinatario-divergente' };
  const campos = ['authorizationRef', 'policyVersion', 'policySha256', 'project', 'source', 'target', 'head', 'operation',
    'requestedAt'] as const;
  if (campos.some((campo) => v[campo] !== request[campo])) return { ok: false, code: 'ci.excecao.recibo-invalido' };
  const emissor = policy.issuers.find((i) => i.id === v.issuer.id && i.keyId === v.issuer.keyId);
  if (!emissor || v.issuer.id !== policy.notificationPort.issuerId) {
    return { ok: false, code: 'ci.excecao.recibo-emissor-divergente' };
  }
  const semHash = Object.fromEntries(CHAVES_RECIBO.filter((k) => k !== 'receiptHash' && k !== 'signature')
    .map((k) => [k, v[k]])) as unknown as Omit<ReciboDeNotificacaoDaExcecao, 'receiptHash' | 'signature'>;
  if (hashDoReciboDeNotificacao(semHash) !== v.receiptHash) return { ok: false, code: 'ci.excecao.recibo-invalido' };
  try {
    const key = createPublicKey({ key: Buffer.from(emissor.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519'
        || !verify(null, Buffer.from(v.receiptHash, 'utf8'), key, Buffer.from(v.signature, 'base64'))) {
      return { ok: false, code: 'ci.excecao.recibo-assinatura-invalida' };
    }
  } catch { return { ok: false, code: 'ci.excecao.recibo-assinatura-invalida' }; }
  const requested = Date.parse(v.requestedAt), attempted = Date.parse(v.attemptedAt), issued = Date.parse(v.issuedAt);
  const delivered = v.deliveredAt === null ? null : Date.parse(v.deliveredAt), current = Date.parse(now), expires = Date.parse(request.expiresAt);
  if (![requested, attempted, issued, current, expires].every(Number.isFinite) || attempted < requested || issued < attempted
      || issued > current || issued >= expires || (delivered !== null && (delivered < attempted || delivered > issued))) {
    return { ok: false, code: 'ci.excecao.recibo-invalido' };
  }
  const resultCode = codigoDoResultado(v.result);
  return resultCode ? { ok: false, code: resultCode } : { ok: true, receipt: v };
}

function capacidadeValida(capability: unknown, policy: PoliticaDaExcecaoDeRecibo, now: string): capability is CapacidadeDaNotificacaoDaExcecao {
  return obj(capability) && exatas(capability, ['schema', 'portId', 'policySha256', 'operation', 'expiresAt', 'verified'])
    && capability.schema === CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO && capability.verified === true
    && capability.operation === 'notify-receipt-exception' && capability.portId === policy.notificationPort.id
    && capability.policySha256 === hashCanonicoDaExcecao(policy) && iso(capability.expiresAt)
    && Date.parse(capability.expiresAt) > Date.parse(now);
}

export function notificarExcecaoDeRecibo(exception: ExcecaoDeRecibo, policy: PoliticaDaExcecaoDeRecibo,
  threadId: string, port: PortaGeridaDaNotificacaoDaExcecao | null, capability: unknown,
  now = new Date().toISOString()): ResultadoDaNotificacao {
  const request = criarPedidoDeNotificacao(exception, threadId, now);
  if (!port || port.schema !== CONTRATO_PORTA_NOTIFICACAO_EXCECAO || port.independent !== true
      || port.id !== policy.notificationPort.id || port.issuerId !== policy.notificationPort.issuerId) {
    return { ok: false, code: 'ci.excecao.porta-nao-comprovada', request };
  }
  if (capability === null || capability === undefined) return { ok: false, code: 'ci.excecao.capacidade-ausente', request };
  if (!capacidadeValida(capability, policy, now)) return { ok: false, code: 'ci.excecao.capacidade-invalida', request };
  let raw: unknown;
  try { raw = port.send(request, policy.notificationPort.timeoutMs); }
  catch { return { ok: false, code: 'ci.excecao.notificacao-indisponivel', request }; }
  const checked = conferirRecibo(raw, request, policy, now);
  if (!checked.ok) return { ok: false, code: checked.code, request };
  return { ok: true, request, receipt: checked.receipt,
    exception: { ...exception, notification: { state: 'delivered', receiptId: checked.receipt.receiptId,
      receiptHash: checked.receipt.receiptHash } } };
}
