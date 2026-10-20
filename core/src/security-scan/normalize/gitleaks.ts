import type { RawFinding } from '../types';
import { mapSeverity, parseReport, repoPath, sha256, type NormalizeContext } from './util';

interface GitleaksLeak { RuleID?: string; Description?: string; StartLine?: number; File?: string; Secret?: string; Match?: string }

/** The secret value never leaves this function: the snippet is its sha256, and Match/Secret/commit data are dropped. */
export function gitleaks(output: string, ctx: NormalizeContext): RawFinding[] {
  const leaks = parseReport('gitleaks', output) as GitleaksLeak[];
  return leaks.map(l => ({
    tool: 'gitleaks', rule: l.RuleID ?? 'unknown', category: 'secret', severity: mapSeverity('gitleaks', 'any'),
    file: repoPath(l.File ?? '', ctx), line: l.StartLine, message: l.Description ?? l.RuleID ?? 'secret',
    snippet: sha256(l.Secret ?? l.Match ?? ''),
  }));
}
