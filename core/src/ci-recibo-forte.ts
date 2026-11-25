/** RM-089 F7: âncora canônica do recibo forte emitido pela fábrica. */
import { createHash } from 'node:crypto';
import { estadoDoReciboRunnerCi, type ReciboRunnerCi } from './ci-recibo-basico';

export const CONTRATO_PAYLOAD_RECIBO_FORTE_CI = 'ork.ci-recibo-forte-payload/v1' as const;
export const CONTRATO_EVIDENCIA_CHECK_CI = 'ork.ci-check-evidencia/v1' as const;
export const CONTRATO_ASSINATURA_RECIBO_FORTE_CI = 'ork.ci-recibo-forte-assinatura/v1' as const;

export type ForjaDoReciboForteCi = 'github' | 'gitlab';
export type VereditoDoReciboForteCi = 'PASSOU';

export interface ContextoDoReciboForteCi {
  tagConducao: string;
  rodadaId: string;
  checkSha256: string;
  forja: ForjaDoReciboForteCi;
  principalNativo: string;
  construtor: string;
  execucaoId: string;
  emitidoEm: string;
}

export interface PayloadDoReciboForteCi {
  contrato: typeof CONTRATO_PAYLOAD_RECIBO_FORTE_CI;
  reciboSha256: string;
  head: string;
  thread: string;
  tagConducao: string;
  veredito: VereditoDoReciboForteCi;
  rodadaId: string;
  check: ReciboRunnerCi['check'];
  evidencia: { contrato: typeof CONTRATO_EVIDENCIA_CHECK_CI; sha256: string };
  forja: ForjaDoReciboForteCi;
  produtor: { principalNativo: string; construtor: string; execucaoId: string };
  emitidoEm: string;
}

export interface AssinaturaDoReciboForteCi {
  contrato: typeof CONTRATO_ASSINATURA_RECIBO_FORTE_CI;
  payload: PayloadDoReciboForteCi;
  emissor: string;
  chaveId: string;
  algoritmo: 'Ed25519';
  assinatura: string;
}

const HASH = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const CHAVES_PAYLOAD = ['contrato', 'reciboSha256', 'head', 'thread', 'tagConducao', 'veredito', 'rodadaId',
  'check', 'evidencia', 'forja', 'produtor', 'emitidoEm'] as const;
const CHAVES_EVIDENCIA = ['contrato', 'sha256'] as const;
const CHAVES_PRODUTOR = ['principalNativo', 'construtor', 'execucaoId'] as const;

const objeto = (valor: unknown): valor is Record<string, unknown> =>
  !!valor && typeof valor === 'object' && !Array.isArray(valor);
const chavesExatas = (valor: Record<string, unknown>, chaves: readonly string[]): boolean => {
  const recebidas = Object.keys(valor).sort();
  return recebidas.length === chaves.length && recebidas.every((chave, indice) => chave === [...chaves].sort()[indice]);
};
const instante = (valor: unknown): valor is string =>
  typeof valor === 'string' && Number.isFinite(Date.parse(valor)) && new Date(valor).toISOString() === valor;
const identificador = (valor: unknown): valor is string => typeof valor === 'string' && ID.test(valor);

/** A ordem abaixo é parte do contrato assinado; nenhum campo opcional entra na pré-imagem. */
export function preImagemDoReciboForteCi(payload: PayloadDoReciboForteCi): string {
  return JSON.stringify({
    contrato: payload.contrato,
    reciboSha256: payload.reciboSha256,
    head: payload.head,
    thread: payload.thread,
    tagConducao: payload.tagConducao,
    veredito: payload.veredito,
    rodadaId: payload.rodadaId,
    check: payload.check,
    evidencia: { contrato: payload.evidencia.contrato, sha256: payload.evidencia.sha256 },
    forja: payload.forja,
    produtor: { principalNativo: payload.produtor.principalNativo, construtor: payload.produtor.construtor,
      execucaoId: payload.produtor.execucaoId },
    emitidoEm: payload.emitidoEm,
  });
}

export const sha256DoPayloadDoReciboForteCi = (payload: PayloadDoReciboForteCi): string =>
  createHash('sha256').update(preImagemDoReciboForteCi(payload)).digest('hex');

export function criarPayloadDoReciboForteCi(recibo: ReciboRunnerCi,
  contexto: ContextoDoReciboForteCi): PayloadDoReciboForteCi {
  if (estadoDoReciboRunnerCi(recibo, recibo.head) !== 'presente' || recibo.resultado.ok !== true) {
    throw new Error('ci.recibo-forte.recibo-invalido');
  }
  const payload: PayloadDoReciboForteCi = {
    contrato: CONTRATO_PAYLOAD_RECIBO_FORTE_CI,
    reciboSha256: recibo.sha256,
    head: recibo.head,
    thread: recibo.thread,
    tagConducao: contexto.tagConducao,
    veredito: 'PASSOU',
    rodadaId: contexto.rodadaId,
    check: recibo.check,
    evidencia: { contrato: CONTRATO_EVIDENCIA_CHECK_CI, sha256: contexto.checkSha256 },
    forja: contexto.forja,
    produtor: { principalNativo: contexto.principalNativo, construtor: contexto.construtor,
      execucaoId: contexto.execucaoId },
    emitidoEm: contexto.emitidoEm,
  };
  if (!payloadDoReciboForteCiValido(payload, recibo)) throw new Error('ci.recibo-forte.contexto-invalido');
  return payload;
}

/** Validação estrutural e da âncora F5; a assinatura e o ciclo de vida da chave são conferidos pela fábrica. */
export function payloadDoReciboForteCiValido(valor: unknown, recibo: ReciboRunnerCi): valor is PayloadDoReciboForteCi {
  if (!objeto(valor) || !chavesExatas(valor, CHAVES_PAYLOAD)
      || valor.contrato !== CONTRATO_PAYLOAD_RECIBO_FORTE_CI
      || typeof valor.reciboSha256 !== 'string' || !HASH.test(valor.reciboSha256)
      || typeof valor.head !== 'string' || !HEAD.test(valor.head)
      || !identificador(valor.thread) || !identificador(valor.tagConducao) || valor.veredito !== 'PASSOU'
      || !identificador(valor.rodadaId) || (valor.check !== 'agile' && valor.check !== 'classic')
      || (valor.forja !== 'github' && valor.forja !== 'gitlab') || !instante(valor.emitidoEm)
      || !objeto(valor.evidencia) || !chavesExatas(valor.evidencia, CHAVES_EVIDENCIA)
      || valor.evidencia.contrato !== CONTRATO_EVIDENCIA_CHECK_CI
      || typeof valor.evidencia.sha256 !== 'string' || !HASH.test(valor.evidencia.sha256)
      || !objeto(valor.produtor) || !chavesExatas(valor.produtor, CHAVES_PRODUTOR)
      || !identificador(valor.produtor.principalNativo) || !identificador(valor.produtor.construtor)
      || !identificador(valor.produtor.execucaoId)) return false;
  return estadoDoReciboRunnerCi(recibo, recibo.head) === 'presente' && recibo.resultado.ok === true
    && valor.reciboSha256 === recibo.sha256 && valor.head === recibo.head && valor.thread === recibo.thread
    && valor.check === recibo.check;
}
