import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface SemgrepResult {
  check_id: string; path: string; start?: { line?: number };
  extra: { message?: string; severity?: string; metavars?: Record<string, { abstract_content?: string }> };
}

/**
 * Semgrep JSON. `extra.lines` needs a login in the OSS CLI, so the snippet is the text bound to the rule's
 * metavariables when there are any, else the rule message: both survive a line shift. Paths are relative to the
 * directory Semgrep ran from, the repository root.
 */
export function semgrep(output: string, ctx: NormalizeContext): RawFinding[] {
  const report = parseReport('semgrep', output) as { results: SemgrepResult[] };
  return asArray(report.results).map(r => {
    const bound = Object.values(r.extra.metavars ?? {}).map(m => m.abstract_content ?? '').join(' ').trim();
    const message = r.extra.message ?? r.check_id;
    return {
      tool: 'semgrep', rule: r.check_id, category: 'sast', severity: mapSeverity('semgrep', r.extra.severity),
      file: repoPath(r.path, ctx), line: r.start?.line, message, snippet: bound || message,
    };
  });
}
