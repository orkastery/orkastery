/**
 * I-42 (D7): fronteira dura de contrato publico.
 *
 * O `#Fast` e a edicao rapida, sem GOAL, PLAN nem CHECK. Mudar um contrato publico (as unioes
 * `Fase`, `Modo` e `MotivoGate`, os contratos versionados `ork.*`, o formato do ledger e os
 * esquemas MCP e JSON) e iniciativa por definicao: pede plano e verificacao independente. Por
 * isso uma thread `fast` nao commita nenhum destes caminhos.
 *
 * A regra e por caminho, nao por simbolo, e grossa de proposito: quando erra, erra mandando a
 * mudanca para um modo com PLAN e CHECK. A lista e contrato sobre contratos: qualquer item que
 * entre ou saia dela precisa de ratificacao.
 */

/** Domicilio unico da lista. Diretorio termina em `/`. */
export const PATHS_DE_CONTRATO_PUBLICO: readonly string[] = [
  'core/src/types.ts',
  'core/src/modos.ts',
  'core/src/ledger.ts',
  'core/src/hitl-contract.ts',
  'core/src/pulse.ts',
  'core/src/master.ts',
  'core/src/setup.ts',
  'core/src/mcp-server.ts',
  'core/src/contrato-publico.ts',
  'core/schemas/',
];

/** O caminho (relativo a raiz do repositorio) e contrato publico? */
export function ehContratoPublico(caminho: string): boolean {
  const normalizado = caminho.replace(/\\/g, '/').replace(/^\.\//, '');
  return PATHS_DE_CONTRATO_PUBLICO.some((p) => (p.endsWith('/') ? normalizado.startsWith(p) : normalizado === p));
}

/** Os caminhos do commit que uma thread `fast` nao pode tocar. */
export function contratosTocados(caminhos: readonly string[]): string[] {
  return caminhos.filter(ehContratoPublico);
}
