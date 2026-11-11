/** RM-089 F2: acordo autenticado pela autoria que a API da forja devolve. */
import { createHash } from 'node:crypto';

export const CONTRATO_ATESTACAO_ACORDO = 'ork.rede-empresa-atestacao/v1' as const;

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

export function ehCorpoDaAtestacao(v: unknown): v is CorpoDaAtestacao {
  return obj(v) && Object.keys(v).length === chaves.length && chaves.every((k) => k in v)
    && v.contrato === CONTRATO_ATESTACAO_ACORDO
    && texto(v.projectKey, /^(github|gitlab):[^\s/]+\/[a-z0-9][a-z0-9._/-]*$/)
    && texto(v.itemId, /^RM-[0-9]{3,}$/) && id(v.reservaVersao)
    && texto(v.reservaFingerprint, /^[a-f0-9]{64}$/, 64) && id(v.emissorAccountId) && id(v.destinatarioAccountId)
    && iso(v.emitidoEm) && iso(v.expiraEm) && texto(v.nonce, /^[A-Za-z0-9._:-]{16,128}$/, 128);
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
