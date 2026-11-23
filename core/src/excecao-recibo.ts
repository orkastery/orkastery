/** RM-089 F6: exceção do recibo da CI, separada da exceção de coordenação da F2. */
import { createHash } from 'node:crypto';

export const CONTRATO_EXCECAO_RECIBO = 'ork.excecao-recibo/v1' as const;
export const CONTRATO_AUTORIZACAO_EXCECAO_RECIBO = 'ork.excecao-recibo-autorizacao/v1' as const;
export const CONTRATO_POLITICA_EXCECAO_RECIBO = 'ork.excecao-recibo-policy/v1' as const;

export type NivelDaExcecaoDeRecibo = 'observar' | 'avisar' | 'exigir';

export interface AtorDaPoliticaDeExcecao {
  principalRef: string;
  actorId: string | null;
  authorityId: string | null;
  groups: string[];
}

export interface EmissorDaNotificacaoDeExcecao {
  id: string;
  keyId: string;
  publicKey: string;
}

export interface PoliticaDaExcecaoDeRecibo {
  schema: typeof CONTRATO_POLITICA_EXCECAO_RECIBO;
  version: string;
  level: NivelDaExcecaoDeRecibo;
  project: string;
  target: string;
  recipientRef: string;
  maxValidityMs: number | null;
  notificationPort: { id: string; issuerId: string; timeoutMs: number };
  actors: AtorDaPoliticaDeExcecao[];
  issuers: EmissorDaNotificacaoDeExcecao[];
}

export interface AutorizacaoDaExcecaoDeRecibo {
  schema: typeof CONTRATO_AUTORIZACAO_EXCECAO_RECIBO;
  authorizationRef: string;
  justification: string;
  scope: string[];
  waivedReceipt: string;
  project: string;
  source: string;
  target: string;
  head: string;
  operation: string;
  policyVersion: string;
  policySha256: string;
  builderPrincipal: string;
  authorizerPrincipal: string;
  issuedAt: string;
  expiresAt: string;
  reviewRef: string;
  reviewResponsibleRef: string;
  reviewDueAt: string;
  decision: 'waived';
  reason: string;
}

export type OrigemProtegidaDaPolitica =
  | { type: 'protected-target'; target: string; targetHead: string; protected: true }
  | { type: 'signed-authority'; authorityId: string; keyId: string; proofHash: string; attestationVerified: true };

export interface RegistroProtegidoDaExcecao {
  authorization: AutorizacaoDaExcecaoDeRecibo;
  policy: PoliticaDaExcecaoDeRecibo;
  policySha256: string;
  origin: OrigemProtegidaDaPolitica;
}

/** A implementação desta porta lê target protegido ou autoridade assinada; o payload só fornece a referência opaca. */
export interface FonteProtegidaDaExcecao {
  read(authorizationRef: string): RegistroProtegidoDaExcecao | null;
}

export interface IdentidadeRedigidaDaExcecao {
  principalHash: string;
  identityHash: string;
  groupsHash: string;
}

export interface ExcecaoDeRecibo {
  schema: typeof CONTRATO_EXCECAO_RECIBO;
  exceptionId: string;
  authorizationRef: string;
  justification: string;
  scope: string[];
  waivedReceipt: string;
  project: string;
  source: string;
  target: string;
  head: string;
  operation: string;
  policyVersion: string;
  policySha256: string;
  policyOrigin: { type: OrigemProtegidaDaPolitica['type']; referenceHash: string };
  builder: IdentidadeRedigidaDaExcecao;
  authorizer: IdentidadeRedigidaDaExcecao;
  responsibleRef: string;
  issuedAt: string;
  expiresAt: string;
  review: { reference: string; responsibleRef: string; dueAt: string };
  decision: 'waived';
  reason: string;
  notification: { state: 'pending' | 'delivered'; receiptId: string | null; receiptHash: string | null };
}

export type CodigoDaExcecaoInvalida =
  | 'ci.excecao.input-invalido'
  | 'ci.excecao.autorizacao-ausente'
  | 'ci.excecao.autorizacao-invalida'
  | 'ci.excecao.origem-nao-comprovada'
  | 'ci.excecao.policy-invalida'
  | 'ci.excecao.policy-hash-divergente'
  | 'ci.excecao.policy-version-divergente'
  | 'ci.excecao.escopo-divergente'
  | 'ci.excecao.ator-nao-comprovado'
  | 'ci.excecao.autoautorizacao'
  | 'ci.excecao.grupo-sobreposto'
  | 'ci.excecao.prazo-invalido'
  | 'ci.excecao.prazo-excedido'
  | 'ci.excecao.revisao-invalida';

export type ResultadoDaExcecao = { ok: true; exception: ExcecaoDeRecibo; policy: PoliticaDaExcecaoDeRecibo }
  | { ok: false; code: CodigoDaExcecaoInvalida };

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown, teto = 300): v is string => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= teto
  && !/[\u0000-\u001f\u007f]/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const hash = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const REF_OPACA = /^auth_[A-Za-z0-9_-]{16,160}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;

function canonico(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('numero-invalido');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (obj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  throw new Error('tipo-invalido');
}

export const hashCanonicoDaExcecao = (v: unknown): string => hash(canonico(v));
export const hashDaPoliticaDeExcecao = (policy: PoliticaDaExcecaoDeRecibo): string => hashCanonicoDaExcecao(policy);

const exatas = (v: Record<string, unknown>, chaves: readonly string[]): boolean => {
  const atuais = Object.keys(v).sort();
  const esperadas = [...chaves].sort();
  return atuais.length === esperadas.length && atuais.every((k, i) => k === esperadas[i]);
};

const CHAVES_ATOR = ['principalRef', 'actorId', 'authorityId', 'groups'] as const;
function atorValido(v: unknown): v is AtorDaPoliticaDeExcecao {
  if (!obj(v) || !exatas(v, CHAVES_ATOR) || !texto(v.principalRef) || !ID.test(v.principalRef)) return false;
  if (v.actorId !== null && (!texto(v.actorId) || !ID.test(v.actorId))) return false;
  if (v.authorityId !== null && (!texto(v.authorityId) || !ID.test(v.authorityId))) return false;
  return (!!v.actorId || !!v.authorityId) && Array.isArray(v.groups) && v.groups.length <= 64
    && v.groups.every((g) => texto(g, 200) && ID.test(g)) && new Set(v.groups).size === v.groups.length;
}

const CHAVES_EMISSOR = ['id', 'keyId', 'publicKey'] as const;
function emissorValido(v: unknown): v is EmissorDaNotificacaoDeExcecao {
  return obj(v) && exatas(v, CHAVES_EMISSOR) && texto(v.id) && ID.test(v.id)
    && texto(v.keyId) && ID.test(v.keyId) && texto(v.publicKey, 4096) && /^[A-Za-z0-9+/=]+$/.test(v.publicKey);
}

const CHAVES_PORTA = ['id', 'issuerId', 'timeoutMs'] as const;
const CHAVES_POLICY = ['schema', 'version', 'level', 'project', 'target', 'recipientRef', 'maxValidityMs',
  'notificationPort', 'actors', 'issuers'] as const;
export function politicaDaExcecaoValida(v: unknown): v is PoliticaDaExcecaoDeRecibo {
  if (!obj(v) || !exatas(v, CHAVES_POLICY) || v.schema !== CONTRATO_POLITICA_EXCECAO_RECIBO
      || !texto(v.version) || !ID.test(v.version) || !['observar', 'avisar', 'exigir'].includes(String(v.level))
      || !texto(v.project) || !texto(v.target) || !texto(v.recipientRef) || !ID.test(v.recipientRef)) return false;
  if (v.maxValidityMs !== null && (!Number.isSafeInteger(v.maxValidityMs) || Number(v.maxValidityMs) <= 0)) return false;
  const port = v.notificationPort;
  if (!obj(port) || !exatas(port, CHAVES_PORTA)
      || !texto(port.id) || !ID.test(port.id)
      || !texto(port.issuerId) || !ID.test(port.issuerId)
      || !Number.isSafeInteger(port.timeoutMs) || Number(port.timeoutMs) < 100) return false;
  if (!Array.isArray(v.actors) || !v.actors.length || !v.actors.every(atorValido)
      || new Set(v.actors.map((a) => a.principalRef)).size !== v.actors.length) return false;
  if (!Array.isArray(v.issuers) || !v.issuers.length || !v.issuers.every(emissorValido)
      || new Set(v.issuers.map((a) => `${a.id}\u0000${a.keyId}`)).size !== v.issuers.length) return false;
  return v.issuers.some((i) => i.id === port.issuerId);
}

const CHAVES_AUTORIZACAO = ['schema', 'authorizationRef', 'justification', 'scope', 'waivedReceipt', 'project',
  'source', 'target', 'head', 'operation', 'policyVersion', 'policySha256', 'builderPrincipal', 'authorizerPrincipal',
  'issuedAt', 'expiresAt', 'reviewRef', 'reviewResponsibleRef', 'reviewDueAt', 'decision', 'reason'] as const;
function autorizacaoValida(v: unknown): v is AutorizacaoDaExcecaoDeRecibo {
  if (!obj(v) || !exatas(v, CHAVES_AUTORIZACAO) || v.schema !== CONTRATO_AUTORIZACAO_EXCECAO_RECIBO
      || !texto(v.authorizationRef) || !REF_OPACA.test(v.authorizationRef) || !texto(v.justification, 1000)
      || !Array.isArray(v.scope) || !v.scope.length || v.scope.length > 32 || !v.scope.every((s) => texto(s, 200))
      || new Set(v.scope).size !== v.scope.length || !texto(v.waivedReceipt) || !texto(v.project)
      || !texto(v.source) || !texto(v.target) || !texto(v.head) || !HEAD.test(v.head)
      || !texto(v.operation) || !ID.test(v.operation) || !texto(v.policyVersion) || !ID.test(v.policyVersion)
      || !texto(v.policySha256) || !HASH.test(v.policySha256) || !texto(v.builderPrincipal)
      || !texto(v.authorizerPrincipal) || !iso(v.issuedAt) || !iso(v.expiresAt) || !texto(v.reviewRef)
      || !texto(v.reviewResponsibleRef) || !iso(v.reviewDueAt) || v.decision !== 'waived' || !texto(v.reason, 1000)) return false;
  return true;
}

function origemValida(origem: unknown, auth: AutorizacaoDaExcecaoDeRecibo): origem is OrigemProtegidaDaPolitica {
  if (!obj(origem) || typeof origem.type !== 'string') return false;
  if (origem.type === 'protected-target') return exatas(origem, ['type', 'target', 'targetHead', 'protected'])
    && origem.protected === true && origem.target === auth.target && texto(origem.targetHead) && HEAD.test(origem.targetHead);
  return origem.type === 'signed-authority' && exatas(origem, ['type', 'authorityId', 'keyId', 'proofHash', 'attestationVerified'])
    && origem.attestationVerified === true && texto(origem.authorityId) && ID.test(origem.authorityId)
    && texto(origem.keyId) && ID.test(origem.keyId) && texto(origem.proofHash) && HASH.test(origem.proofHash);
}

const identidade = (ator: AtorDaPoliticaDeExcecao): string => ator.actorId ? `actor:${ator.actorId}` : `authority:${ator.authorityId}`;
const redigida = (ator: AtorDaPoliticaDeExcecao): IdentidadeRedigidaDaExcecao => ({
  principalHash: hash(`principal\u0000${ator.principalRef}`),
  identityHash: hash(`identity\u0000${identidade(ator)}`),
  groupsHash: hashCanonicoDaExcecao([...ator.groups].sort()),
});

function hashDaOrigem(origem: OrigemProtegidaDaPolitica): string {
  return hashCanonicoDaExcecao(origem.type === 'protected-target'
    ? [origem.type, origem.target, origem.targetHead]
    : [origem.type, origem.authorityId, origem.keyId, origem.proofHash]);
}

export function resolverExcecaoDeRecibo(input: unknown, fonte: FonteProtegidaDaExcecao,
  agora = new Date().toISOString()): ResultadoDaExcecao {
  if (!obj(input) || !exatas(input, ['threadId', 'authorizationRef']) || !texto(input.threadId, 100)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.threadId)
      || !texto(input.authorizationRef) || !REF_OPACA.test(input.authorizationRef)) {
    return { ok: false, code: 'ci.excecao.input-invalido' };
  }
  let registro: RegistroProtegidoDaExcecao | null;
  try { registro = fonte.read(input.authorizationRef); } catch { registro = null; }
  if (!registro) return { ok: false, code: 'ci.excecao.autorizacao-ausente' };
  const auth = registro.authorization;
  if (!autorizacaoValida(auth) || auth.authorizationRef !== input.authorizationRef) {
    return { ok: false, code: 'ci.excecao.autorizacao-invalida' };
  }
  if (!origemValida(registro.origin, auth)) return { ok: false, code: 'ci.excecao.origem-nao-comprovada' };
  if (!politicaDaExcecaoValida(registro.policy)) return { ok: false, code: 'ci.excecao.policy-invalida' };
  const policy = registro.policy;
  const policyHash = hashDaPoliticaDeExcecao(policy);
  if (registro.policySha256 !== policyHash || auth.policySha256 !== policyHash) {
    return { ok: false, code: 'ci.excecao.policy-hash-divergente' };
  }
  if (auth.policyVersion !== policy.version) return { ok: false, code: 'ci.excecao.policy-version-divergente' };
  if (auth.project !== policy.project || auth.target !== policy.target) return { ok: false, code: 'ci.excecao.escopo-divergente' };
  const builder = policy.actors.find((a) => a.principalRef === auth.builderPrincipal);
  const authorizer = policy.actors.find((a) => a.principalRef === auth.authorizerPrincipal);
  if (!builder || !authorizer) return { ok: false, code: 'ci.excecao.ator-nao-comprovado' };
  if (auth.builderPrincipal === auth.authorizerPrincipal || identidade(builder) === identidade(authorizer)) {
    return { ok: false, code: 'ci.excecao.autoautorizacao' };
  }
  if (builder.groups.some((g) => authorizer.groups.includes(g))) return { ok: false, code: 'ci.excecao.grupo-sobreposto' };
  const now = Date.parse(agora), issued = Date.parse(auth.issuedAt), expires = Date.parse(auth.expiresAt);
  if (!Number.isFinite(now) || issued > now || expires <= now || expires <= issued) {
    return { ok: false, code: 'ci.excecao.prazo-invalido' };
  }
  if (policy.maxValidityMs !== null && expires - issued > policy.maxValidityMs) {
    return { ok: false, code: 'ci.excecao.prazo-excedido' };
  }
  const reviewDue = Date.parse(auth.reviewDueAt);
  if (reviewDue <= issued || !auth.reviewRef || !auth.reviewResponsibleRef) {
    return { ok: false, code: 'ci.excecao.revisao-invalida' };
  }
  const exception: ExcecaoDeRecibo = {
    schema: CONTRATO_EXCECAO_RECIBO,
    exceptionId: `exc-${hashCanonicoDaExcecao([auth.authorizationRef, auth.head, auth.operation]).slice(0, 32)}`,
    authorizationRef: auth.authorizationRef,
    justification: auth.justification,
    scope: [...auth.scope],
    waivedReceipt: auth.waivedReceipt,
    project: auth.project,
    source: auth.source,
    target: auth.target,
    head: auth.head,
    operation: auth.operation,
    policyVersion: policy.version,
    policySha256: policyHash,
    policyOrigin: { type: registro.origin.type, referenceHash: hashDaOrigem(registro.origin) },
    builder: redigida(builder),
    authorizer: redigida(authorizer),
    responsibleRef: policy.recipientRef,
    issuedAt: auth.issuedAt,
    expiresAt: auth.expiresAt,
    review: { reference: auth.reviewRef, responsibleRef: auth.reviewResponsibleRef, dueAt: auth.reviewDueAt },
    decision: auth.decision,
    reason: auth.reason,
    notification: { state: 'pending', receiptId: null, receiptHash: null },
  };
  return { ok: true, exception, policy };
}
