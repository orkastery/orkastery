import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface EslintFile { filePath: string; messages?: { ruleId?: string | null; severity?: number; message?: string; line?: number }[] }

/** ESLint JSON: `filePath` is absolute inside the container. A message without a rule is a parse error. */
export function eslint(output: string, ctx: NormalizeContext): RawFinding[] {
  const files = parseReport('eslint', output) as EslintFile[];
  return files.flatMap(f => asArray(f.messages).map(m => ({
    tool: 'eslint', rule: m.ruleId ?? 'parse-error', category: 'quality' as const, severity: mapSeverity('eslint', m.severity), stack: 'js' as const,
    file: repoPath(f.filePath, ctx), line: m.line, message: m.message ?? '', snippet: m.message ?? '',
  })));
}
