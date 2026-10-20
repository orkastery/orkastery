import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface GolangciIssue { FromLinter?: string; Text?: string; SourceLines?: string[]; Pos?: { Filename?: string; Line?: number } }

/** golangci-lint JSON: runs inside the stack directory, so `Pos.Filename` is relative to it (or `../src/..` from the root mount). */
export function golangciLint(output: string, ctx: NormalizeContext): RawFinding[] {
  const report = parseReport('golangci-lint', output) as { Issues?: GolangciIssue[] | null };
  return asArray(report.Issues).map(i => ({
    tool: 'golangci-lint', rule: i.FromLinter ?? 'unknown', category: 'quality' as const, severity: mapSeverity('golangci-lint', i.FromLinter), stack: 'go' as const,
    file: repoPath(i.Pos?.Filename ?? '', ctx, 'stack'), line: i.Pos?.Line, message: i.Text ?? '',
    snippet: asArray(i.SourceLines).join('\n') || (i.Text ?? ''),
  }));
}
