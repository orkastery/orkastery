import type { RawFinding } from '../types';
import { mapSeverity, parseReport, stackFile, type NormalizeContext } from './util';

interface NpmVia { source?: number; name?: string; title?: string; url?: string; severity?: string }
interface NpmVuln { name: string; via: (string | NpmVia)[] }

/**
 * npm audit v2: one finding per advisory (the `via` objects), deduplicated per package. A `via` that is a string only
 * says the package is affected through another one, whose own entry carries the advisory. The report names no file,
 * so the finding is on the stack's `package-lock.json` (the audit runs with `--package-lock-only`).
 */
export function npmAudit(output: string, ctx: NormalizeContext): RawFinding[] {
  const report = parseReport('npm-audit', output) as { vulnerabilities: Record<string, NpmVuln> };
  const seen = new Set<string>();
  const out: RawFinding[] = [];
  for (const [pkg, v] of Object.entries(report.vulnerabilities)) {
    for (const via of v.via ?? []) {
      if (typeof via === 'string') continue;
      const rule = /GHSA-[0-9a-z-]+/i.exec(via.url ?? '')?.[0] ?? `npm:${via.source ?? via.title ?? 'unknown'}`;
      const key = `${pkg}|${rule}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        tool: 'npm-audit', rule, category: 'dependency', severity: mapSeverity('npm-audit', via.severity), stack: 'js',
        file: stackFile('package-lock.json', ctx), message: via.title ?? rule, snippet: via.name ?? pkg,
      });
    }
  }
  return out;
}
