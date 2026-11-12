/** RM-089 F2: acordo autenticado pela autoria que a API da forja devolve. */
import { createHash } from 'node:crypto';
import type { ChamadorDaApi } from './forja/api';
import { chamadorDaApi } from './forja/api';
import { rodarCli, type ChamadaDaCli } from './forja/executor';
import { forjaPorNome } from './rede-forja';
import type { ReferenciaDaForja } from './rede-empresa-contrato';

export const CONTRATO_ATESTACAO_ACORDO = 'ork.rede-empresa-atestacao/v1' as const;
export const CONTRATO_ATESTACAO_EXCECAO = 'ork.rede-empresa-excecao/v1' as const;

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
