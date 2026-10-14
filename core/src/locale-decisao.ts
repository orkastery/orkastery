/**
 * RM-061, fatia F3b: a familia `decisao` do catalogo de mensagens (`ork decisao placar` e o uso do comando). O pt-BR e
 * a fonte; o ingles e tipado por ele. Sem import do nucleo.
 *
 * `ork decisao registrar` segue em pt-BR nesta fatia (G5): o resultado ja e JSON, e as recusas vem da validacao do
 * pedido HITL v2 (`hitl-contract.ts`), compartilhada com o MCP e os gates. A fase da linha do placar e dado e sai igual.
 */

export const DECISAO_PT_BR = {
  uso: 'uso: ork decisao registrar|placar <thread-id>',
  usoRegistrar: 'uso: ork decisao registrar <thread-id> --decidido D --porque P ...',
  usoPlacar: 'uso: ork decisao placar <thread-id> [--json]',
  exigeFlag: (nome: string) => `decisao registrar exige --${nome}`,
  criterioUso: 'decisao registrar: --criterio manifesto:CHAVE, ledger:REF ou medicao:COMANDO',
  linhaFalta: (campo: string) => `falta ${campo}`,
  linhaQuebrada: (campo: string) => `${campo} tem quebra de linha; cada campo é uma linha só`,
  linhaControle: (campo: string) => `${campo} tem caractere de controle`,
  linhaLonga: (campo: string, tamanho: number, teto: number) => `${campo} tem ${tamanho} caracteres; o teto é ${teto}`,
  contratoCampoDeGate: (campo: string) => `pedido HITL v2: decisão informada não pode trazer ${campo}`,
  contratoCamposObrigatorios: (problema: string) =>
    `pedido HITL v2: decisão informada exige o que foi decidido, o porquê e como mudar (${problema})`,
  contratoCampoInvalido: (problema: string) => `pedido HITL v2: decisão informada: ${problema}`,
  contratoCustoObrigatorio: 'pedido HITL v2: custo de reverter exige agora e depois, os dois presentes',
  contratoCustoInvalido: (problema: string) => `pedido HITL v2: custo de reverter: ${problema}`,
  contratoCriterioObrigatorio: 'pedido HITL v2: decisão informada exige critério citado e resolvível',
  contratoCriterioInvalido: (problema: string) => `pedido HITL v2: critério: ${problema}`,
  contratoIrreversivel: 'pedido HITL v2: ato irreversível nunca é decisão informada',
  threadFechada: 'decisão informada: thread fechada não decide mais nada',
  criterioNaoResolve: (detalhe: string) => `decisão informada: critério não resolve (${detalhe})`,
  faseMudou: 'decisão informada: a fase mudou enquanto ela era registrada',
  revertidaNaoExiste: 'decisão informada: a decisão revertida não existe nesta thread',
  colunasDoPlacar: ['FASE', 'DECIDIDAS', 'INFORMADAS', 'PERGUNTAS', 'REVERTIDAS', 'SEM RASTRO', 'LIMIAR'],
  acimaDoLimiar: (limiar: number) => `acima de ${limiar}: revisar`,
  dentroDoLimiar: 'ok',
  taxaDeReversao: (taxa: number | null) =>
    `\ntaxa de reversão das decisões informadas: ${taxa === null ? 'sem decisão informada ainda' : `${Math.round(taxa * 100)}%`}`,
};

export type MensagensDeDecisao = typeof DECISAO_PT_BR;

export const DECISAO_EN: MensagensDeDecisao = {
  uso: 'usage: ork decisao registrar|placar <thread-id>',
  usoRegistrar: 'usage: ork decisao registrar <thread-id> --decidido D --porque P ...',
  usoPlacar: 'usage: ork decisao placar <thread-id> [--json]',
  exigeFlag: (nome) => `decisao registrar requires --${nome}`,
  criterioUso: 'decisao registrar: --criterio manifesto:KEY, ledger:REF or medicao:COMMAND',
  linhaFalta: (campo) => `missing ${campo}`,
  linhaQuebrada: (campo) => `${campo} has a line break; each field must be one line`,
  linhaControle: (campo) => `${campo} has a control character`,
  linhaLonga: (campo, tamanho, teto) => `${campo} has ${tamanho} characters; the limit is ${teto}`,
  contratoCampoDeGate: (campo) => `HITL v2 request: an informed decision cannot include ${campo}`,
  contratoCamposObrigatorios: (problema) =>
    `HITL v2 request: an informed decision requires what was decided, why and how to change it (${problema})`,
  contratoCampoInvalido: (problema) => `HITL v2 request: informed decision: ${problema}`,
  contratoCustoObrigatorio: 'HITL v2 request: reversal cost requires both now and later',
  contratoCustoInvalido: (problema) => `HITL v2 request: reversal cost: ${problema}`,
  contratoCriterioObrigatorio: 'HITL v2 request: an informed decision requires a cited, resolvable criterion',
  contratoCriterioInvalido: (problema) => `HITL v2 request: criterion: ${problema}`,
  contratoIrreversivel: 'HITL v2 request: an irreversible act is never an informed decision',
  threadFechada: 'informed decision: a closed thread cannot decide anything else',
  criterioNaoResolve: (detalhe) => `informed decision: the criterion does not resolve (${detalhe})`,
  faseMudou: 'informed decision: the phase changed while it was being recorded',
  revertidaNaoExiste: 'informed decision: the reversed decision does not exist in this thread',
  colunasDoPlacar: ['PHASE', 'DECIDED', 'INFORMED', 'QUESTIONS', 'REVERTED', 'NO TRAIL', 'THRESHOLD'],
  acimaDoLimiar: (limiar) => `above ${limiar}: review`,
  dentroDoLimiar: 'ok',
  taxaDeReversao: (taxa) => `\nreversal rate of informed decisions: ${taxa === null ? 'no informed decision yet' : `${Math.round(taxa * 100)}%`}`,
};
