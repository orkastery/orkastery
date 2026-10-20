import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, stackFile, type NormalizeContext } from './util';

interface Frame { module: string; version?: string; function?: string }
interface GoMessage {
  SBOM?: { modules?: { path: string }[] };
  osv?: { id: string; summary?: string };
  finding?: { osv: string; trace?: Frame[] };
}

/**
 * govulncheck `-format json` is a stream. One finding per advisory and vulnerable module; `reachable` is true when
 * some trace of it has a function frame in the user's own module (the first SBOM module, the one without version).
 */
export function govulncheck(output: string, ctx: NormalizeContext): RawFinding[] {
  const messages = parseReport('govulncheck', output) as GoMessage[];
  const main = messages.find(m => m.SBOM)?.SBOM?.modules?.[0]?.path;
  const summaries = new Map<string, string>();
  for (const m of messages) if (m.osv) summaries.set(m.osv.id, m.osv.summary ?? m.osv.id);
  const byKey = new Map<string, RawFinding>();
  for (const m of messages) {
    if (!m.finding) continue;
    const trace = asArray(m.finding.trace);
    const module = trace[0]?.module ?? 'unknown';
    const calledFromMain = main !== undefined && trace.some(fr => fr.module === main && fr.function !== undefined);
    const key = `${m.finding.osv}|${module}`;
    const known = byKey.get(key);
    if (known) { if (calledFromMain) known.reachable = true; continue; }
    byKey.set(key, {
      tool: 'govulncheck', rule: m.finding.osv, category: 'dependency', severity: mapSeverity('govulncheck', 'any'), stack: 'go',
      file: stackFile('go.mod', ctx), message: summaries.get(m.finding.osv) ?? m.finding.osv, snippet: module, reachable: calledFromMain,
    });
  }
  return [...byKey.values()];
}
