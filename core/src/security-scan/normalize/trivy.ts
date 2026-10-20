import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface TrivyVuln { VulnerabilityID: string; PkgName?: string; Title?: string; Description?: string; Severity?: string }
interface TrivyMisconf {
  ID: string; Title?: string; Message?: string; Severity?: string; Status?: string;
  CauseMetadata?: { StartLine?: number; Code?: { Lines?: { Content?: string; IsCause?: boolean }[] } };
}
interface TrivyLicense { Severity?: string; PkgName?: string; FilePath?: string; Name?: string; Category?: string }
interface TrivyResult { Target: string; Vulnerabilities?: TrivyVuln[]; Misconfigurations?: TrivyMisconf[]; Licenses?: TrivyLicense[] }

const results = (tool: string, output: string): TrivyResult[] => asArray((parseReport(tool, output) as { Results?: TrivyResult[] }).Results);

/** Trivy fs `--scanners vuln`: one finding per advisory and package; the snippet is the package name (no version, so a bump that keeps the CVE stays `existing`). */
export function trivyVuln(output: string, ctx: NormalizeContext): RawFinding[] {
  return results('trivy-vuln', output).flatMap(r => asArray(r.Vulnerabilities).map(v => ({
    tool: 'trivy-vuln', rule: v.VulnerabilityID, category: 'dependency' as const, severity: mapSeverity('trivy-vuln', v.Severity),
    file: repoPath(r.Target, ctx), message: v.Title ?? v.Description ?? v.VulnerabilityID, snippet: v.PkgName ?? '',
  })));
}

/** Trivy config: failed checks only; the snippet is the offending source line, else the check message. */
export function trivyConfig(output: string, ctx: NormalizeContext): RawFinding[] {
  return results('trivy-config', output).flatMap(r => asArray(r.Misconfigurations).filter(m => m.Status === undefined || m.Status === 'FAIL').map(m => {
    const cause = asArray(m.CauseMetadata?.Code?.Lines).filter(l => l.IsCause).map(l => l.Content ?? '').join('\n').trim();
    return {
      tool: 'trivy-config', rule: m.ID, category: 'iac' as const, severity: mapSeverity('trivy-config', m.Severity),
      file: repoPath(r.Target, ctx), line: m.CauseMetadata?.StartLine, message: m.Message ?? m.Title ?? m.ID,
      snippet: cause || (m.Message ?? m.ID),
    };
  }));
}

/** Trivy license: one finding per package and license name. */
export function trivyLicense(output: string, ctx: NormalizeContext): RawFinding[] {
  return results('trivy-license', output).flatMap(r => asArray(r.Licenses).map(l => ({
    tool: 'trivy-license', rule: l.Name ?? 'unknown', category: 'license' as const, severity: mapSeverity('trivy-license', l.Severity),
    file: repoPath(l.FilePath || r.Target, ctx), message: `${l.PkgName ?? ''} ${l.Name ?? ''} (${l.Category ?? 'license'})`.trim(),
    snippet: l.PkgName ?? '',
  })));
}
