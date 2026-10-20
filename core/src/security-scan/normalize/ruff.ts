import type { RawFinding } from '../types';
import { mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface RuffDiagnostic { code?: string | null; filename: string; location?: { row?: number }; message?: string }

/** Ruff JSON: `filename` is absolute inside the container. */
export function ruff(output: string, ctx: NormalizeContext): RawFinding[] {
  const list = parseReport('ruff', output) as RuffDiagnostic[];
  return list.map(d => ({
    tool: 'ruff', rule: d.code ?? 'syntax-error', category: 'quality', severity: mapSeverity('ruff', 'any'), stack: 'python',
    file: repoPath(d.filename, ctx), line: d.location?.row, message: d.message ?? '', snippet: d.message ?? '',
  }));
}
