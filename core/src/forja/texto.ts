import { redigirSegredos } from '../hitl';

/** Texto curto: uma linha, sem controle, com teto. */
export function umaLinha(texto: string, teto = 200): string {
  return Array.from(texto.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('') || '-';
}

/** Texto de fora (stderr do git ou do gh): sem segredo, numa linha e com teto, antes de ir ao `--json` e ao ledger. */
export function deFora(texto: string, teto = 200): string {
  return umaLinha(redigirSegredos(texto), teto);
}
