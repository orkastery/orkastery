/**
 * RM-061, fatia F3b: a familia `decisao` do catalogo de mensagens (`ork decisao placar` e o uso do comando). O pt-BR e
 * a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * `ork decisao registrar` segue em pt-BR nesta fatia (G5): o resultado ja e JSON, e as recusas vem da validacao do
 * pedido HITL v2 (`hitl-contract.ts`), compartilhada com o MCP e os gates. A fase da linha do placar e dado e sai igual.
 */

export const DECISAO_PT_BR = {
  uso: 'uso: ork decisao registrar|placar <thread-id>',
  usoPlacar: 'uso: ork decisao placar <thread-id> [--json]',
  colunasDoPlacar: ['FASE', 'DECIDIDAS', 'INFORMADAS', 'PERGUNTAS', 'REVERTIDAS', 'SEM RASTRO', 'LIMIAR'],
  acimaDoLimiar: (limiar: number) => `acima de ${limiar}: revisar`,
  dentroDoLimiar: 'ok',
  taxaDeReversao: (taxa: number | null) =>
    `\ntaxa de reversão das decisões informadas: ${taxa === null ? 'sem decisão informada ainda' : `${Math.round(taxa * 100)}%`}`,
};

export type MensagensDeDecisao = typeof DECISAO_PT_BR;

export const DECISAO_EN: MensagensDeDecisao = {
  uso: 'usage: ork decisao registrar|placar <thread-id>',
  usoPlacar: 'usage: ork decisao placar <thread-id> [--json]',
  colunasDoPlacar: ['PHASE', 'DECIDED', 'INFORMED', 'QUESTIONS', 'REVERTED', 'NO TRAIL', 'THRESHOLD'],
  acimaDoLimiar: (limiar) => `above ${limiar}: review`,
  dentroDoLimiar: 'ok',
  taxaDeReversao: (taxa) => `\nreversal rate of informed decisions: ${taxa === null ? 'no informed decision yet' : `${Math.round(taxa * 100)}%`}`,
};
