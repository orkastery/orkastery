/** RM-089 F2: acordo autenticado pela autoria que a API da forja devolve. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import type { ChamadorDaApi } from './forja/api';
import { chamadorDaApi } from './forja/api';
import { rodarCli, type ChamadaDaCli } from './forja/executor';
import { forjaPorNome } from './rede-forja';
import type { ReferenciaDaForja } from './rede-empresa-contrato';

export const CONTRATO_ATESTACAO_ACORDO = 'ork.rede-empresa-atestacao/v1' as const;
export const CONTRATO_ATESTACAO_EXCECAO = 'ork.rede-empresa-excecao/v1' as const;
/** RM-089 F6: atestação da origem da policy, sem reutilizar a exceção de coordenação da F2. */
export const CONTRATO_ATESTACAO_POLITICA_EXCECAO = 'ork.excecao-recibo-policy-attestation/v1' as const;

export interface CorpoDaAtestacao {
  contrato: typeof CONTRATO_ATESTACAO_ACORDO;
  projectKey: string;
  itemId: string;
  reservaVersao: number;
  reservaFingerprint: string;
  emissorAccountId: number;
  destinatarioAccountId: number;
  emitidoEm: string;
  expiraEm: string;
  nonce: string;
}

export interface ReferenciaDaAtestacao {
  forja: 'github' | 'gitlab';
  id: number;
  endpoint: string;
  sha256: string;
}

export interface ArtefatoAtestado {
  id: number;
  authorId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortaDeAtestacao {
  ler(referencia: ReferenciaDaAtestacao, timeoutMs: number): ArtefatoAtestado | null;
}

export interface CorpoDaExcecaoAutenticada {
  contrato: typeof CONTRATO_ATESTACAO_EXCECAO;
  projectKey: string;
  itemId: string;
  responsavelAccountId: number;
  justificativaId: string;
  emitidoEm: string;
  expiraEm: string;
  nonce: string;
}

export interface CorpoDaAtestacaoDaPoliticaDeExcecao {
  contrato: typeof CONTRATO_ATESTACAO_POLITICA_EXCECAO;
  authorizationRef: string;
  project: string;
  target: string;
  targetHead: string;
  policyVersion: string;
  policySha256: string;
  authorityId: string;
  authorityAccountId: number;
  keyId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
}

export type ResultadoDaAtestacao = { ok: true; corpo: CorpoDaAtestacao }
  | { ok: false; codigo: 'rede-empresa.acordo-ausente' | 'rede-empresa.acordo-invalido' | 'rede-empresa.acordo-editado'
    | 'rede-empresa.acordo-autor-divergente' | 'rede-empresa.acordo-destinatario-divergente'
    | 'rede-empresa.acordo-escopo-divergente' | 'rede-empresa.acordo-reserva-divergente' | 'rede-empresa.acordo-expirado' };

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const iso = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const texto = (v: unknown, re: RegExp, teto = 500): v is string => typeof v === 'string' && v.length <= teto && re.test(v);
const chaves = ['contrato', 'projectKey', 'itemId', 'reservaVersao', 'reservaFingerprint', 'emissorAccountId',
  'destinatarioAccountId', 'emitidoEm', 'expiraEm', 'nonce'];
const chavesExcecao = ['contrato', 'projectKey', 'itemId', 'responsavelAccountId', 'justificativaId',
  'emitidoEm', 'expiraEm', 'nonce'];
const chavesAtestacaoDaPolitica = ['contrato', 'authorizationRef', 'project', 'target', 'targetHead', 'policyVersion',
  'policySha256', 'authorityId', 'authorityAccountId', 'keyId', 'issuedAt', 'expiresAt', 'nonce', 'signature'];

export function ehCorpoDaAtestacao(v: unknown): v is CorpoDaAtestacao {
  return obj(v) && Object.keys(v).length === chaves.length && chaves.every((k) => k in v)
    && v.contrato === CONTRATO_ATESTACAO_ACORDO
    && texto(v.projectKey, /^(github|gitlab):[^\s/]+\/[a-z0-9][a-z0-9._/-]*$/)
    && texto(v.itemId, /^RM-[0-9]{3,}$/) && id(v.reservaVersao)
    && texto(v.reservaFingerprint, /^[a-f0-9]{64}$/, 64) && id(v.emissorAccountId) && id(v.destinatarioAccountId)
    && iso(v.emitidoEm) && iso(v.expiraEm) && texto(v.nonce, /^[A-Za-z0-9._:-]{16,128}$/, 128);
}

export function ehCorpoDaExcecao(v: unknown): v is CorpoDaExcecaoAutenticada {
  return obj(v) && Object.keys(v).length === chavesExcecao.length && chavesExcecao.every((k) => k in v)
    && v.contrato === CONTRATO_ATESTACAO_EXCECAO
    && texto(v.projectKey, /^(github|gitlab):[^\s/]+\/[a-z0-9][a-z0-9._/-]*$/)
    && texto(v.itemId, /^RM-[0-9]{3,}$/) && id(v.responsavelAccountId)
    && texto(v.justificativaId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, 128)
    && iso(v.emitidoEm) && iso(v.expiraEm) && texto(v.nonce, /^[A-Za-z0-9._:-]{16,128}$/, 128);
}

export function ehCorpoDaAtestacaoDaPolitica(v: unknown): v is CorpoDaAtestacaoDaPoliticaDeExcecao {
  return obj(v) && Object.keys(v).length === chavesAtestacaoDaPolitica.length
    && chavesAtestacaoDaPolitica.every((k) => k in v) && v.contrato === CONTRATO_ATESTACAO_POLITICA_EXCECAO
    && texto(v.authorizationRef, /^auth_[A-Za-z0-9_-]{16,160}$/, 165) && texto(v.project, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/)
    && texto(v.target, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/) && texto(v.targetHead, /^[a-f0-9]{40}$/, 40)
    && texto(v.policyVersion, /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/)
    && texto(v.policySha256, /^[a-f0-9]{64}$/, 64) && texto(v.authorityId, /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/)
    && id(v.authorityAccountId) && texto(v.keyId, /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/)
    && iso(v.issuedAt) && iso(v.expiresAt) && texto(v.nonce, /^[A-Za-z0-9._:-]{16,128}$/, 128)
    && texto(v.signature, /^[A-Za-z0-9+/=]+$/, 4096);
}

export function dadosAssinadosDaAtestacaoDaPolitica(v: Omit<CorpoDaAtestacaoDaPoliticaDeExcecao, 'signature'>): unknown[] {
  return [v.contrato, v.authorizationRef, v.project, v.target, v.targetHead, v.policyVersion, v.policySha256,
    v.authorityId, v.authorityAccountId, v.keyId, v.issuedAt, v.expiresAt, v.nonce];
}

const inteiro = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : null;
const string = (v: unknown): string | null => typeof v === 'string' ? v : null;

/** Converte a resposta autenticada da API oficial da forja no artefato fechado do domínio. */
export function portaDeAtestacaoDaApi(projeto: ReferenciaDaForja, api: ChamadorDaApi): PortaDeAtestacao {
  return { ler(referencia, timeoutMs) {
    if (referencia.forja !== projeto.forja || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return null;
    const endpoint = referencia.endpoint.replace(/^\/+/, '');
    const caminho = projeto.caminho.split('/').map(encodeURIComponent).join('%2F');
    const github = projeto.forja === 'github'
      && endpoint === `repos/${projeto.caminho}/issues/comments/${referencia.id}`;
    const gitlab = projeto.forja === 'gitlab'
      && new RegExp(`^projects/${caminho}/issues/[1-9][0-9]*/notes/${referencia.id}$`).test(endpoint);
    if (!github && !gitlab) return null;
    const r = api({ metodo: 'GET', caminho: endpoint, prazoMs: timeoutMs });
    if (!r.ok || !obj(r.valor.corpo)) return null;
    const c = r.valor.corpo;
    const author = projeto.forja === 'github' && obj(c.user) ? inteiro(c.user.id)
      : projeto.forja === 'gitlab' && obj(c.author) ? inteiro(c.author.id) : null;
    const criado = string(projeto.forja === 'github' ? c.created_at : c.created_at);
    const atualizado = string(projeto.forja === 'github' ? c.updated_at : c.updated_at);
    const artefato = { id: inteiro(c.id), authorId: author, body: string(c.body), createdAt: criado, updatedAt: atualizado };
    return artefato.id && artefato.authorId && artefato.body !== null && artefato.createdAt && artefato.updatedAt
      ? artefato as ArtefatoAtestado : null;
  } };
}

/** Adaptador de produção: usa a CLI já autenticada para o host exato, sem token em argumento ou estado. */
export function portaDeAtestacaoDaForja(projeto: ReferenciaDaForja,
  env: NodeJS.ProcessEnv = process.env): PortaDeAtestacao {
  const local = forjaPorNome(projeto.forja, { env }, projeto.host);
  if (!local) return { ler: () => null };
  const host = /^(.*?)(?::([1-9][0-9]{0,4}))?$/.exec(projeto.host)!;
  const rodar = (c: ChamadaDaCli) => rodarCli({ ...c, binario: local.binario });
  const api = chamadorDaApi({ tipo: projeto.forja, host: host[1].toLowerCase(), porta: host[2] ? Number(host[2]) : null,
    caminhoBase: '', ca: null }, { rodar });
  return portaDeAtestacaoDaApi(projeto, api);
}

export function verificarAtestacao(porta: PortaDeAtestacao, referencia: ReferenciaDaAtestacao, esperado: {
  projectKey: string; itemId: string; reservaVersao: number; reservaFingerprint: string;
  emissorAccountId: number; destinatarioAccountId: number; agora: string; timeoutMs: number;
}): ResultadoDaAtestacao {
  let artefato: ArtefatoAtestado | null;
  try { artefato = porta.ler(referencia, esperado.timeoutMs); } catch { artefato = null; }
  if (!artefato || artefato.id !== referencia.id) return { ok: false, codigo: 'rede-empresa.acordo-ausente' };
  if (artefato.updatedAt !== artefato.createdAt) return { ok: false, codigo: 'rede-empresa.acordo-editado' };
  if (createHash('sha256').update(artefato.body, 'utf8').digest('hex') !== referencia.sha256) {
    return { ok: false, codigo: 'rede-empresa.acordo-editado' };
  }
  let corpo: unknown;
  try { corpo = JSON.parse(artefato.body) as unknown; } catch { return { ok: false, codigo: 'rede-empresa.acordo-invalido' }; }
  if (!ehCorpoDaAtestacao(corpo)) return { ok: false, codigo: 'rede-empresa.acordo-invalido' };
  if (artefato.authorId !== esperado.emissorAccountId || corpo.emissorAccountId !== esperado.emissorAccountId) {
    return { ok: false, codigo: 'rede-empresa.acordo-autor-divergente' };
  }
  if (corpo.destinatarioAccountId !== esperado.destinatarioAccountId) {
    return { ok: false, codigo: 'rede-empresa.acordo-destinatario-divergente' };
  }
  if (corpo.projectKey !== esperado.projectKey || corpo.itemId !== esperado.itemId) {
    return { ok: false, codigo: 'rede-empresa.acordo-escopo-divergente' };
  }
  if (corpo.reservaVersao !== esperado.reservaVersao || corpo.reservaFingerprint !== esperado.reservaFingerprint) {
    return { ok: false, codigo: 'rede-empresa.acordo-reserva-divergente' };
  }
  const agora = Date.parse(esperado.agora);
  if (!Number.isFinite(agora) || Date.parse(corpo.emitidoEm) > agora || Date.parse(corpo.expiraEm) <= agora
    || Date.parse(corpo.expiraEm) <= Date.parse(corpo.emitidoEm)) return { ok: false, codigo: 'rede-empresa.acordo-expirado' };
  return { ok: true, corpo };
}

export function verificarExcecaoAutenticada(porta: PortaDeAtestacao, referencia: ReferenciaDaAtestacao, esperado: {
  projectKey: string; itemId: string; responsavelAccountId: number; justificativaId: string;
  expiraEm: string; agora: string; timeoutMs: number;
}): boolean {
  const artefato = porta.ler(referencia, esperado.timeoutMs);
  if (!artefato || artefato.id !== referencia.id || artefato.updatedAt !== artefato.createdAt
    || createHash('sha256').update(artefato.body, 'utf8').digest('hex') !== referencia.sha256
    || artefato.authorId !== esperado.responsavelAccountId) return false;
  let corpo: unknown;
  try { corpo = JSON.parse(artefato.body) as unknown; } catch { return false; }
  if (!ehCorpoDaExcecao(corpo) || corpo.projectKey !== esperado.projectKey || corpo.itemId !== esperado.itemId
    || corpo.responsavelAccountId !== esperado.responsavelAccountId || corpo.justificativaId !== esperado.justificativaId
    || corpo.expiraEm !== esperado.expiraEm) return false;
  const agora = Date.parse(esperado.agora);
  return Number.isFinite(agora) && Date.parse(corpo.emitidoEm) <= agora && Date.parse(corpo.expiraEm) > agora
    && Date.parse(corpo.expiraEm) > Date.parse(corpo.emitidoEm);
}

/**
 * A policy F6 pode vir de autoridade organizacional, mas só com autoria da API e assinatura Ed25519
 * conferidas contra a chave que o chamador obteve da autoridade protegida. A chave nunca vem do artefato.
 */
export function verificarAtestacaoDaPoliticaDeExcecao(porta: PortaDeAtestacao, referencia: ReferenciaDaAtestacao,
  esperado: {
    authorizationRef: string; project: string; target: string; targetHead: string; policyVersion: string;
    policySha256: string; authorityId: string; authorityAccountId: number; keyId: string; publicKey: string;
    agora: string; timeoutMs: number;
  }): boolean {
  let artefato: ArtefatoAtestado | null;
  try { artefato = porta.ler(referencia, esperado.timeoutMs); } catch { artefato = null; }
  if (!artefato || artefato.id !== referencia.id || artefato.updatedAt !== artefato.createdAt
      || artefato.authorId !== esperado.authorityAccountId
      || createHash('sha256').update(artefato.body, 'utf8').digest('hex') !== referencia.sha256) return false;
  let corpo: unknown;
  try { corpo = JSON.parse(artefato.body) as unknown; } catch { return false; }
  if (!ehCorpoDaAtestacaoDaPolitica(corpo) || corpo.authorizationRef !== esperado.authorizationRef
      || corpo.project !== esperado.project || corpo.target !== esperado.target || corpo.targetHead !== esperado.targetHead
      || corpo.policyVersion !== esperado.policyVersion || corpo.policySha256 !== esperado.policySha256
      || corpo.authorityId !== esperado.authorityId || corpo.authorityAccountId !== esperado.authorityAccountId
      || corpo.keyId !== esperado.keyId) return false;
  const agora = Date.parse(esperado.agora), issued = Date.parse(corpo.issuedAt), expires = Date.parse(corpo.expiresAt);
  if (!Number.isFinite(agora) || issued > agora || expires <= agora || expires <= issued) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(esperado.publicKey, 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' && verify(null,
      Buffer.from(JSON.stringify(dadosAssinadosDaAtestacaoDaPolitica({
        contrato: corpo.contrato,
        authorizationRef: corpo.authorizationRef,
        project: corpo.project,
        target: corpo.target,
        targetHead: corpo.targetHead,
        policyVersion: corpo.policyVersion,
        policySha256: corpo.policySha256,
        authorityId: corpo.authorityId,
        authorityAccountId: corpo.authorityAccountId,
        keyId: corpo.keyId,
        issuedAt: corpo.issuedAt,
        expiresAt: corpo.expiresAt,
        nonce: corpo.nonce,
      })), 'utf8'), key, Buffer.from(corpo.signature, 'base64'));
  } catch { return false; }
}
