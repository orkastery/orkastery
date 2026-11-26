/** RM-089 F7: resultado forte v2 da fábrica, separado do recibo emitido pelo runner F5. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import type { ProvaDosRegistrosDaFabrica } from './ci-fabrica-registros';

export const CONTRATO_PAYLOAD_RESULTADO_FORTE = 'ork.ci-recibo-forte-payload/v2' as const;
export const CONTRATO_ASSINATURA_RESULTADO_FORTE = 'ork.ci-recibo-forte-assinatura/v2' as const;
export const CONTRATO_PORTA_RESULTADO_FORTE = 'ork.ci-recibo-forte-signing-port/v2' as const;

export interface ExcecaoF6DaFabrica {
  operation: 'ci.run';
  projeto: string;
  origem: string;
  destino: string;
  head: string;
}

export interface PayloadDoResultadoForte {
  contrato: typeof CONTRATO_PAYLOAD_RESULTADO_FORTE;
  projeto: string;
  origem: string;
  destino: string;
  head: string;
  commitAvaliado: string;
  verify: { commit: string; rodadaId: string; chaveDeProva: string };
  check: { sessionId: string; parecerSha256: string; shaRevisado: string };
  tag: { conducaoId: string };
  emitidoEm: string;
  validoAte: string;
  excecao?: ExcecaoF6DaFabrica;
}

export interface ResultadoForteDaFabrica {
  contrato: typeof CONTRATO_ASSINATURA_RESULTADO_FORTE;
  payload: PayloadDoResultadoForte;
  emissor: string;
  chaveId: string;
  algoritmo: 'Ed25519';
  assinatura: string;
  sha256: string;
}

export interface ChavePublicaDoResultadoForte {
  id: string;
  materialPublicoPem: string | null;
  validaDesde: string;
  validaAte: string;
  revogadaEm?: string;
}

export interface PoliticaDoResultadoForte {
  emissor: string;
  chaves: ChavePublicaDoResultadoForte[];
}

export interface PortaDeAssinaturaDoResultadoForte {
  contrato: typeof CONTRATO_PORTA_RESULTADO_FORTE;
  emissor: string;
  chaveId: string;
  exclusiva: true;
  assinar(preImagem: string): string;
}

export type CodigoDoResultadoForte = 'ci.fabrica.prova-ausente';
export type VerificacaoDoResultadoForte = { ok: true; resultado: ResultadoForteDaFabrica } |
  { ok: false; codigo: CodigoDoResultadoForte };

const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const iso = (valor: string): boolean => Number.isFinite(Date.parse(valor)) && new Date(valor).toISOString() === valor;
const sha256 = (texto: string): string => createHash('sha256').update(texto).digest('hex');

export function preImagemDoResultadoForte(payload: PayloadDoResultadoForte): string {
  return JSON.stringify({ contrato: payload.contrato, projeto: payload.projeto, origem: payload.origem,
    destino: payload.destino, head: payload.head, commitAvaliado: payload.commitAvaliado, verify: payload.verify,
    check: payload.check, tag: payload.tag, emitidoEm: payload.emitidoEm, validoAte: payload.validoAte,
    ...(payload.excecao ? { excecao: payload.excecao } : {}) });
}

function excecaoValida(excecao: ExcecaoF6DaFabrica | undefined, prova: ProvaDosRegistrosDaFabrica): boolean {
  return !excecao || (excecao.operation === 'ci.run' && excecao.projeto === prova.projeto
    && excecao.origem === prova.origem && excecao.destino === prova.destino && excecao.head === prova.head);
}

export function emitirResultadoForteDaFabrica(prova: ProvaDosRegistrosDaFabrica, emitidoEm: string, validoAte: string,
  porta: PortaDeAssinaturaDoResultadoForte, excecao?: ExcecaoF6DaFabrica): ResultadoForteDaFabrica {
  if (!SHA.test(prova.head) || !SHA.test(prova.verify.commit) || !HASH.test(prova.verify.chaveDeProva)
      || !HASH.test(prova.check.parecerSha256) || prova.check.shaRevisado !== prova.verify.commit
      || !iso(emitidoEm) || !iso(validoAte) || Date.parse(validoAte) <= Date.parse(emitidoEm)
      || !excecaoValida(excecao, prova) || porta.contrato !== CONTRATO_PORTA_RESULTADO_FORTE
      || !porta.exclusiva || !porta.emissor || !porta.chaveId) throw new Error('ci.fabrica.prova-ausente');
  const payload: PayloadDoResultadoForte = { contrato: CONTRATO_PAYLOAD_RESULTADO_FORTE, projeto: prova.projeto,
    origem: prova.origem, destino: prova.destino, head: prova.head, commitAvaliado: prova.head,
    verify: { commit: prova.verify.commit, rodadaId: prova.verify.rodadaId, chaveDeProva: prova.verify.chaveDeProva },
    check: { sessionId: prova.check.sessionId, parecerSha256: prova.check.parecerSha256,
      shaRevisado: prova.check.shaRevisado }, tag: { conducaoId: prova.tag.conducaoId }, emitidoEm, validoAte,
    ...(excecao ? { excecao } : {}) };
  const assinatura = porta.assinar(preImagemDoResultadoForte(payload));
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(assinatura)) throw new Error('ci.fabrica.prova-ausente');
  const corpo = { contrato: CONTRATO_ASSINATURA_RESULTADO_FORTE, payload, emissor: porta.emissor,
    chaveId: porta.chaveId, algoritmo: 'Ed25519' as const, assinatura };
  return { ...corpo, sha256: sha256(JSON.stringify(corpo)) };
}

function chaveValida(chave: ChavePublicaDoResultadoForte | undefined, agora: string): boolean {
  return !!chave?.materialPublicoPem && iso(chave.validaDesde) && iso(chave.validaAte)
    && Date.parse(agora) >= Date.parse(chave.validaDesde) && Date.parse(agora) < Date.parse(chave.validaAte)
    && (!chave.revogadaEm || Date.parse(chave.revogadaEm) > Date.parse(agora));
}

export function verificarResultadoForteDaFabrica(resultado: ResultadoForteDaFabrica, politica: PoliticaDoResultadoForte,
  esperado: { projeto: string; origem: string; destino: string; head: string }, agora: string): VerificacaoDoResultadoForte {
  const p = resultado.payload;
  const corpo = { contrato: resultado.contrato, payload: resultado.payload, emissor: resultado.emissor,
    chaveId: resultado.chaveId, algoritmo: resultado.algoritmo, assinatura: resultado.assinatura };
  if (resultado.contrato !== CONTRATO_ASSINATURA_RESULTADO_FORTE || p.contrato !== CONTRATO_PAYLOAD_RESULTADO_FORTE
      || resultado.algoritmo !== 'Ed25519' || resultado.emissor !== politica.emissor
      || resultado.sha256 !== sha256(JSON.stringify(corpo)) || p.projeto !== esperado.projeto
      || p.origem !== esperado.origem || p.destino !== esperado.destino || p.head !== esperado.head
      || p.commitAvaliado !== esperado.head || p.check.shaRevisado !== p.verify.commit
      || !SHA.test(p.verify.commit) || !HASH.test(p.verify.chaveDeProva) || !HASH.test(p.check.parecerSha256)
      || !iso(agora) || !iso(p.emitidoEm) || !iso(p.validoAte) || Date.parse(agora) < Date.parse(p.emitidoEm)
      || Date.parse(agora) >= Date.parse(p.validoAte)
      || (p.excecao && (p.excecao.operation !== 'ci.run' || p.excecao.projeto !== p.projeto
        || p.excecao.origem !== p.origem || p.excecao.destino !== p.destino || p.excecao.head !== p.head))) {
    return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
  }
  const chave = politica.chaves.find((item) => item.id === resultado.chaveId);
  if (!chaveValida(chave, agora)) return { ok: false, codigo: 'ci.fabrica.prova-ausente' };
  try {
    const publica = createPublicKey(chave!.materialPublicoPem!);
    const ok = publica.asymmetricKeyType === 'ed25519' && verify(null,
      Buffer.from(preImagemDoResultadoForte(p), 'utf8'), publica, Buffer.from(resultado.assinatura, 'base64'));
    return ok ? { ok: true, resultado } : { ok: false, codigo: 'ci.fabrica.prova-ausente' };
  } catch { return { ok: false, codigo: 'ci.fabrica.prova-ausente' }; }
}
