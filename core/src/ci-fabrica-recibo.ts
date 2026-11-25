/** RM-089 F7: porta exclusiva da fábrica para assinar e verificar o recibo forte. */
import { createPublicKey, verify } from 'node:crypto';
import type { ReciboRunnerCi } from './ci-recibo-basico';
import { CONTRATO_ASSINATURA_RECIBO_FORTE_CI, criarPayloadDoReciboForteCi,
  payloadDoReciboForteCiValido, preImagemDoReciboForteCi, principalNativoDoReciboForteCiValido,
  type AssinaturaDoReciboForteCi,
  type ContextoDoReciboForteCi } from './ci-recibo-forte';

export const CONTRATO_POLITICA_RECIBO_FORTE_CI = 'ork.ci-recibo-forte-politica/v1' as const;
export const CONTRATO_PORTA_ASSINATURA_RECIBO_FORTE_CI = 'ork.ci-recibo-forte-signing-port/v1' as const;

export interface ChavePublicaDoReciboForteCi {
  id: string;
  algoritmo: 'Ed25519';
  materialPublicoPem: string | null;
  validaDesde: string;
  validaAte: string;
  revogadaEm?: string;
}

export interface PoliticaDoReciboForteCi {
  contrato: typeof CONTRATO_POLITICA_RECIBO_FORTE_CI;
  versao: string;
  emissor: string;
  chaves: ChavePublicaDoReciboForteCi[];
}

/** A implementação real pertence ao plano de controle; o produto conhece somente esta porta. */
export interface PortaDeAssinaturaDoReciboForteCi {
  contrato: typeof CONTRATO_PORTA_ASSINATURA_RECIBO_FORTE_CI;
  operacao: 'assinar-recibo-forte';
  emissor: string;
  chaveId: string;
  exclusiva: true;
  assinar(preImagem: string): string;
}

export type CodigoDoReciboForteCi = 'ci.recibo-forte.contexto-invalido'
  | 'ci.recibo-forte.assinatura-invalida'
  | 'ci.recibo-forte.emissor-invalido'
  | 'ci.recibo-forte.chave-ausente'
  | 'ci.recibo-forte.chave-revogada'
  | 'ci.recibo-forte.chave-fora-da-validade'
  | 'ci.recibo-forte.material-publico-indisponivel';

export type ResultadoDoReciboForteCi = { ok: true; recibo: ReciboRunnerCi } |
  { ok: false; code: CodigoDoReciboForteCi };

/** Somente a projeção canônica reobtida da forja pode abrir a porta de assinatura. */
export interface EvidenciaCanonicaParaAssinaturaDoReciboForteCi {
  forja: ContextoDoReciboForteCi['forja'];
  head: string;
  operation: 'ci.run';
  execucaoId: string;
  principalNativo: string;
  construtor: string;
  veredito: 'PASSOU';
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const objeto = (valor: unknown): valor is Record<string, unknown> =>
  !!valor && typeof valor === 'object' && !Array.isArray(valor);
const exatas = (valor: Record<string, unknown>, esperadas: readonly string[]): boolean => {
  const chaves = Object.keys(valor).sort(), alvo = [...esperadas].sort();
  return chaves.length === alvo.length && chaves.every((chave, indice) => chave === alvo[indice]);
};
const iso = (valor: unknown): valor is string => typeof valor === 'string' && Number.isFinite(Date.parse(valor))
  && new Date(valor).toISOString() === valor;
const id = (valor: unknown): valor is string => typeof valor === 'string' && ID.test(valor);
const CHAVES_ASSINATURA = ['contrato', 'payload', 'emissor', 'chaveId', 'algoritmo', 'assinatura'] as const;

function estadoDaChave(chave: ChavePublicaDoReciboForteCi | undefined, agora: string): CodigoDoReciboForteCi | null {
  if (!chave) return 'ci.recibo-forte.chave-ausente';
  if (chave.revogadaEm && Date.parse(chave.revogadaEm) <= Date.parse(agora)) return 'ci.recibo-forte.chave-revogada';
  if (Date.parse(agora) < Date.parse(chave.validaDesde) || Date.parse(agora) >= Date.parse(chave.validaAte)) {
    return 'ci.recibo-forte.chave-fora-da-validade';
  }
  if (!chave.materialPublicoPem) return 'ci.recibo-forte.material-publico-indisponivel';
  return null;
}

function politicaValida(politica: PoliticaDoReciboForteCi): boolean {
  return politica.contrato === CONTRATO_POLITICA_RECIBO_FORTE_CI && id(politica.versao) && id(politica.emissor)
    && Array.isArray(politica.chaves) && politica.chaves.length > 0 && politica.chaves.every((chave) =>
      id(chave.id) && chave.algoritmo === 'Ed25519' && iso(chave.validaDesde) && iso(chave.validaAte)
      && Date.parse(chave.validaDesde) < Date.parse(chave.validaAte)
      && (chave.revogadaEm === undefined || iso(chave.revogadaEm))
      && (chave.materialPublicoPem === null || typeof chave.materialPublicoPem === 'string'));
}

export function assinarReciboForteNaFabrica(recibo: ReciboRunnerCi, contexto: ContextoDoReciboForteCi,
  politica: PoliticaDoReciboForteCi, porta: PortaDeAssinaturaDoReciboForteCi | null): ResultadoDoReciboForteCi {
  if (!principalNativoDoReciboForteCiValido(contexto.forja, contexto.principalNativo)
      || contexto.principalNativo === contexto.construtor) {
    return { ok: false, code: 'ci.recibo-forte.contexto-invalido' };
  }
  if (!politicaValida(politica) || !porta || porta.contrato !== CONTRATO_PORTA_ASSINATURA_RECIBO_FORTE_CI
      || porta.operacao !== 'assinar-recibo-forte'
      || porta.exclusiva !== true || porta.emissor !== politica.emissor) {
    return { ok: false, code: 'ci.recibo-forte.emissor-invalido' };
  }
  const chave = politica.chaves.find((item) => item.id === porta.chaveId);
  const estado = estadoDaChave(chave, contexto.emitidoEm);
  if (estado) return { ok: false, code: estado };
  let payload;
  try { payload = criarPayloadDoReciboForteCi(recibo, contexto); }
  catch { return { ok: false, code: 'ci.recibo-forte.contexto-invalido' }; }
  let assinatura: string;
  try { assinatura = porta.assinar(preImagemDoReciboForteCi(payload)); }
  catch { return { ok: false, code: 'ci.recibo-forte.assinatura-invalida' }; }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(assinatura)) return { ok: false, code: 'ci.recibo-forte.assinatura-invalida' };
  return { ok: true, recibo: { ...recibo, assinatura: { contrato: CONTRATO_ASSINATURA_RECIBO_FORTE_CI,
    payload, emissor: politica.emissor, chaveId: porta.chaveId, algoritmo: 'Ed25519', assinatura } } };
}

export function assinarReciboForteComEvidenciaCanonica(recibo: ReciboRunnerCi, contexto: ContextoDoReciboForteCi,
  evidencia: EvidenciaCanonicaParaAssinaturaDoReciboForteCi | null,
  politica: PoliticaDoReciboForteCi, porta: PortaDeAssinaturaDoReciboForteCi | null): ResultadoDoReciboForteCi {
  if (!evidencia || evidencia.veredito !== 'PASSOU' || evidencia.operation !== 'ci.run'
      || evidencia.forja !== contexto.forja || evidencia.head !== recibo.head
      || evidencia.execucaoId !== contexto.execucaoId || evidencia.principalNativo !== contexto.principalNativo
      || evidencia.construtor !== contexto.construtor) {
    return { ok: false, code: 'ci.recibo-forte.contexto-invalido' };
  }
  return assinarReciboForteNaFabrica(recibo, contexto, politica, porta);
}

export function verificarReciboForteDaFabrica(recibo: ReciboRunnerCi, politica: PoliticaDoReciboForteCi | null,
  esperado: ContextoDoReciboForteCi, agora = esperado.emitidoEm): ResultadoDoReciboForteCi {
  const assinatura = recibo.assinatura as AssinaturaDoReciboForteCi | undefined;
  if (!iso(agora)) return { ok: false, code: 'ci.recibo-forte.contexto-invalido' };
  if (!politica || !politicaValida(politica)) return { ok: false, code: 'ci.recibo-forte.material-publico-indisponivel' };
  if (!objeto(assinatura) || !exatas(assinatura, CHAVES_ASSINATURA)
      || assinatura.contrato !== CONTRATO_ASSINATURA_RECIBO_FORTE_CI || assinatura.algoritmo !== 'Ed25519'
      || !id(assinatura.emissor) || !id(assinatura.chaveId) || typeof assinatura.assinatura !== 'string'
      || !payloadDoReciboForteCiValido(assinatura.payload, recibo)) {
    return { ok: false, code: 'ci.recibo-forte.assinatura-invalida' };
  }
  if (assinatura.emissor !== politica.emissor) return { ok: false, code: 'ci.recibo-forte.emissor-invalido' };
  const contexto = assinatura.payload;
  if (contexto.tagConducao !== esperado.tagConducao || contexto.rodadaId !== esperado.rodadaId
      || contexto.evidencia.sha256 !== esperado.checkSha256 || contexto.forja !== esperado.forja
      || contexto.produtor.principalNativo !== esperado.principalNativo
      || contexto.produtor.construtor !== esperado.construtor || contexto.produtor.execucaoId !== esperado.execucaoId
      || contexto.emitidoEm !== esperado.emitidoEm) return { ok: false, code: 'ci.recibo-forte.contexto-invalido' };
  const chave = politica.chaves.find((item) => item.id === assinatura.chaveId);
  const estado = estadoDaChave(chave, agora);
  if (estado) return { ok: false, code: estado };
  try {
    const publica = createPublicKey(chave!.materialPublicoPem!);
    if (publica.asymmetricKeyType !== 'ed25519') return { ok: false, code: 'ci.recibo-forte.assinatura-invalida' };
    const ok = verify(null, Buffer.from(preImagemDoReciboForteCi(assinatura.payload), 'utf8'), publica,
      Buffer.from(assinatura.assinatura, 'base64'));
    return ok ? { ok: true, recibo } : { ok: false, code: 'ci.recibo-forte.assinatura-invalida' };
  } catch { return { ok: false, code: 'ci.recibo-forte.assinatura-invalida' }; }
}
