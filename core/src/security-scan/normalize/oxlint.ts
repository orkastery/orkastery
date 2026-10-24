import * as path from 'node:path';
import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, type NormalizeContext } from './util';

interface OxlintDiagnostico { message?: string; code?: string; severity?: string; filename?: string; labels?: { span?: { line?: number } }[] }

/**
 * RM-072 (D13): oxlint `--format json`, so no Agile Check e atras de `check.agile.oxlint`, como primeiro passe antes do
 * `eslint` (nao tira regra dele). O `filename` e relativo ao diretorio da stack, onde o wrapper roda; a regra e o
 * `code` (`eslint(no-eval)`, `unicorn(...)`), e o trecho e a mensagem, como no `eslint`.
 */
export function oxlint(output: string, ctx: NormalizeContext): RawFinding[] {
  const report = parseReport('oxlint', output) as { diagnostics: OxlintDiagnostico[] };
  return asArray(report.diagnostics).map(d => ({
    tool: 'oxlint', rule: d.code ?? 'oxlint', category: 'quality' as const, severity: mapSeverity('oxlint', d.severity), stack: 'js' as const,
    file: path.posix.normalize(path.posix.join(ctx.stackDir, d.filename ?? '')), line: asArray(d.labels)[0]?.span?.line,
    message: d.message ?? '', snippet: d.message ?? '',
  }));
}
