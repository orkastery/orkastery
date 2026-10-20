import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, stackFile, type NormalizeContext } from './util';

interface PipVuln { id: string; aliases?: string[]; description?: string }
interface PipDependency { name: string; version?: string; vulns?: PipVuln[] }

/**
 * pip-audit gives no severity and no file. The catalog severityMap is `{"*": "high"}` (as govulncheck's): the safe side
 * is to let a known vulnerable dependency reach the loop, never to hide it as medium.
 * The file is the stack's `requirements.txt`, the only manifest the catalog command audits.
 */
export function pipAudit(output: string, ctx: NormalizeContext): RawFinding[] {
  const report = parseReport('pip-audit', output) as { dependencies: PipDependency[] };
  return asArray(report.dependencies).flatMap(d => asArray(d.vulns).map(v => ({
    tool: 'pip-audit', rule: v.id, category: 'dependency' as const, severity: mapSeverity('pip-audit', 'any'), stack: 'python' as const,
    file: stackFile('requirements.txt', ctx), message: v.description?.split('\n')[0] ?? v.id, snippet: d.name,
  })));
}
