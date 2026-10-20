import type { RawFinding } from '../types';
import { mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface ActionlintError { message?: string; filepath: string; line?: number; kind?: string; snippet?: string }

/** actionlint JSON: paths are relative to the repository root (it runs from there). The snippet is its first source line (the rest is the caret ruler, which moves with the column). */
export function actionlint(output: string, ctx: NormalizeContext): RawFinding[] {
  const list = parseReport('actionlint', output) as ActionlintError[];
  return list.map(e => ({
    tool: 'actionlint', rule: `actionlint/${e.kind ?? 'error'}`, category: 'workflow', severity: mapSeverity('actionlint', 'any'),
    file: repoPath(e.filepath, ctx), line: e.line, message: e.message ?? '', snippet: (e.snippet ?? e.message ?? '').split('\n')[0],
  }));
}
