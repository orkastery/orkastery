/**
 * The `securityScan` family of the message catalog: `ork security-scan` output (stdout summary, `report.md`) and its
 * usage error. pt-BR is the source; English is typed by it. No import from the core. Values that are data (tool names,
 * states, reasons, rule ids, paths) remain unchanged in report.json. The human render translates the known reason
 * vocabulary without rewriting the stored data.
 */

const motivoEmPtBR = (reason: string): string => {
  const exact = new Map<string, string>([
    ['not in the catalog', 'não está no catálogo'], ['unbalanced JSON', 'JSON desbalanceado'],
    ['truncated JSON', 'JSON truncado'], ['empty stream', 'fluxo vazio'], ['invalid JSON', 'JSON inválido'],
    ['expected a JSON array', 'era esperado um array JSON'], ['expected a JSON object', 'era esperado um objeto JSON'],
    ['unreadable output', 'saída ilegível'], ['commit-range-unresolved', 'intervalo de commits não resolvido'],
    ['timeout', 'tempo esgotado'], ['no-requirements-file', 'nenhum arquivo requirements'],
    ['zero-commits-scanned', 'nenhum commit varrido'], ['disabled', 'desabilitada'], ['unsupported-ci', 'CI não suportada'],
  ]);
  const conhecida = exact.get(reason);
  if (conhecida !== undefined) return conhecida;
  return reason
    .replace(/not in the catalog/g, 'não está no catálogo')
    .replace(/unbalanced JSON/g, 'JSON desbalanceado')
    .replace(/truncated JSON/g, 'JSON truncado')
    .replace(/empty stream/g, 'fluxo vazio')
    .replace(/invalid JSON/g, 'JSON inválido')
    .replace(/expected a JSON array/g, 'era esperado um array JSON')
    .replace(/expected a JSON object/g, 'era esperado um objeto JSON')
    .replace(/unexpected "([^"]+)" outside a JSON value/g, '"$1" inesperado fora de um valor JSON')
    .replace(/missing key "([^"]+)"/g, 'chave "$1" ausente')
    .replace(/tool reported "([^"]+)"/g, 'a ferramenta relatou "$1"')
    .replace(/must be a list of strings/g, 'deve ser uma lista de strings')
    .replace(/expected an object/g, 'era esperado um objeto')
    .replace(/expected a list/g, 'era esperada uma lista')
    .replace(/\(no fingerprint\)/g, '(sem fingerprint)')
    .replace(/missing-output/g, 'saída-ausente');
};

export const SECURITY_SCAN_PT_BR = {
  usage: 'uso: ork security-scan [--base <ref>] [--json] [--check classic|agile]',
  // RM-072 (D9): o modo da varredura aceita so os dois valores.
  checkInvalido: (valor: string | null) => `--check inválido: ${valor === null ? '(sem valor)' : JSON.stringify(valor)} (aceitos: classic, agile)`,
  unknownFlag: (flag: string) => `opção desconhecida: ${flag}`,
  error: (message: string) => motivoEmPtBR(message),
  reason: (reason: string) => motivoEmPtBR(reason),
  // report.md
  title: 'Varredura de segurança',
  headBase: (head: string, base: string) => `HEAD \`${head.slice(0, 12)}\`, base \`${base ? base.slice(0, 12) : '(não resolvida)'}\``,
  generatedAt: (iso: string) => `Gerado em ${iso}`,
  stacks: (list: string) => `Stacks: ${list}`,
  noStacks: 'nenhuma detectada',
  executionHeading: 'Execução',
  tableTool: 'Ferramenta',
  tableExecutor: 'Executado por',
  tableState: 'Estado',
  tableReason: 'Motivo',
  noExecutor: 'nenhum',
  states: { ran: 'executou', failed: 'falhou', unavailable: 'indisponível' } as Record<string, string>,
  noTools: 'Nenhuma ferramenta se aplica às stacks detectadas.',
  countsHeading: 'Contagem',
  counts: (n: number, existing: number, dismissed: number, loop: number) =>
    `${n} novo(s), ${existing} existente(s), ${dismissed} dispensado(s); ${loop} no laço`,
  newLoopHeading: 'Novos que entram no laço',
  newWarnHeading: 'Novos em aviso',
  none: 'nenhum',
  existingTotal: (n: number) => `Existentes na base: ${n}`,
  dismissedTotal: (n: number) => `Dispensados: ${n}`,
  excludedHeading: 'Caminhos excluídos',
  // stdout
  summary: (n: number, existing: number, dismissed: number, loop: number) =>
    `security-scan: ${n} novo(s), ${existing} existente(s), ${dismissed} dispensado(s); ${loop} no laço`,
  notRun: (tool: string, state: string, reason: string) => `  ${tool}: ${state}${reason ? ` (${reason})` : ''}`,
  notRunHeading: 'Ferramentas que não rodaram por completo:',
};

export type MensagensDeSecurityScan = typeof SECURITY_SCAN_PT_BR;

export const SECURITY_SCAN_EN: MensagensDeSecurityScan = {
  usage: 'usage: ork security-scan [--base <ref>] [--json] [--check classic|agile]',
  checkInvalido: (valor) => `invalid --check: ${valor === null ? '(no value)' : JSON.stringify(valor)} (accepted: classic, agile)`,
  unknownFlag: (flag) => `unknown option: ${flag}`,
  error: (message) => message,
  reason: (reason) => reason,
  title: 'Security scan',
  headBase: (head, base) => `HEAD \`${head.slice(0, 12)}\`, base \`${base ? base.slice(0, 12) : '(unresolved)'}\``,
  generatedAt: (iso) => `Generated at ${iso}`,
  stacks: (list) => `Stacks: ${list}`,
  noStacks: 'none detected',
  executionHeading: 'Execution',
  tableTool: 'Tool',
  tableExecutor: 'Executor',
  tableState: 'State',
  tableReason: 'Reason',
  noExecutor: 'none',
  states: { ran: 'ran', failed: 'failed', unavailable: 'unavailable' },
  noTools: 'No tool applies to the detected stacks.',
  countsHeading: 'Counts',
  counts: (n, existing, dismissed, loop) => `${n} new, ${existing} existing, ${dismissed} dismissed; ${loop} in the loop`,
  newLoopHeading: 'New findings that enter the loop',
  newWarnHeading: 'New findings (warning)',
  none: 'none',
  existingTotal: (n) => `Existing on the base: ${n}`,
  dismissedTotal: (n) => `Dismissed: ${n}`,
  excludedHeading: 'Excluded paths',
  summary: (n, existing, dismissed, loop) => `security-scan: ${n} new, ${existing} existing, ${dismissed} dismissed; ${loop} in the loop`,
  notRun: (tool, state, reason) => `  ${tool}: ${state}${reason ? ` (${reason})` : ''}`,
  notRunHeading: 'Tools that did not run to completion:',
};
