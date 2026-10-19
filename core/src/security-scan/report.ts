/**
 * The report of a scan round (spec section 5.4) and the exit code (section 5.5). The files live under
 * `<state>/security-scan/<head-sha>/` of the main tree, so a scan inside a thread worktree and `ork ship` read the same
 * place. A finding carries no snippet (see `Finding`), and nothing here prints raw tool output: no secret value reaches
 * `report.json` or `report.md`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { msg } from '../locale';
import { dirEstado } from '../manifest';
import { LOOP_CATEGORIES_ANY, LOOP_CATEGORIES_HIGH, type Finding, type ScanReport } from './types';

export function reportDir(stateRoot: string, sha: string): string {
  return path.join(dirEstado(stateRoot), 'security-scan', sha);
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function writeReport(stateRoot: string, report: ScanReport): { json: string; md: string } {
  const dir = reportDir(stateRoot, report.head);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = path.join(dir, 'report.json');
  const md = path.join(dir, 'report.md');
  atomicWrite(json, `${JSON.stringify(report, null, 2)}\n`);
  atomicWrite(md, renderMarkdown(report));
  return { json, md };
}

/** The stored report of `sha`, or null when absent or not a report of this schema. */
export function readReport(stateRoot: string, sha: string): ScanReport | null {
  let raw: string;
  try { raw = fs.readFileSync(path.join(reportDir(stateRoot, sha), 'report.json'), 'utf8'); } catch { return null; }
  try {
    const r = JSON.parse(raw) as ScanReport;
    return r && r.schema === 'ork.security-scan/v1' && Array.isArray(r.tools) && Array.isArray(r.findings) ? r : null;
  } catch { return null; }
}

const LOOP_CATEGORIES: readonly string[] = [...LOOP_CATEGORIES_ANY, ...LOOP_CATEGORIES_HIGH];

/**
 * 1 when a `new` finding is in the loop, or when `required` and a tool of a loop category (secret, dependency, sast, iac,
 * workflow) is unavailable or failed (never clean); `quality` and `license` tools never drive the code. Invalid
 * dismissals or config never reach a report: the command fails before.
 */
export function exitCodeOf(report: ScanReport, required: boolean): 0 | 1 {
  if (report.findings.some(f => f.status === 'new' && f.loop)) return 1;
  if (required && report.tools.some(t => t.state !== 'ran' && LOOP_CATEGORIES.includes(t.category))) return 1;
  return 0;
}

export interface Tally { new: number; existing: number; dismissed: number; loop: number }
export function tally(report: ScanReport): Tally {
  const t: Tally = { new: 0, existing: 0, dismissed: 0, loop: 0 };
  for (const f of report.findings) {
    t[f.status]++;
    if (f.status === 'new' && f.loop) t.loop++;
  }
  return t;
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const bySeverity = (a: Finding, b: Finding): number =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0);

function findingLine(f: Finding): string {
  const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
  return `- \`${f.severity}\` ${f.tool} \`${f.rule}\` ${where}: ${f.message.replace(/[\r\n]+/g, ' ')} (\`${f.fingerprint}\`)`;
}

export function renderMarkdown(report: ScanReport): string {
  const m = msg().securityScan;
  const t = tally(report);
  const out: string[] = [`# ${m.title}`, '', m.headBase(report.head, report.base), '', m.generatedAt(report.generatedAt), '',
    m.stacks(report.stacks.length ? report.stacks.join(', ') : m.noStacks), '', `## ${m.executionHeading}`, ''];
  if (report.tools.length === 0) out.push(m.noTools);
  else {
    out.push(`| ${m.tableTool} | ${m.tableExecutor} | ${m.tableState} | ${m.tableReason} |`, '| --- | --- | --- | --- |');
    for (const r of report.tools) {
      out.push(`| ${cell(r.name)} | ${r.executor ?? m.noExecutor} | ${m.states[r.state] ?? r.state} | ${cell(r.reason ?? '')} |`);
    }
  }
  const news = report.findings.filter(f => f.status === 'new');
  const loop = news.filter(f => f.loop).sort(bySeverity);
  const warn = news.filter(f => !f.loop).sort(bySeverity);
  out.push('', `## ${m.countsHeading}`, '', m.counts(t.new, t.existing, t.dismissed, t.loop), '',
    `## ${m.newLoopHeading}`, '', ...(loop.length ? loop.map(findingLine) : [m.none]), '',
    `## ${m.newWarnHeading}`, '', ...(warn.length ? warn.map(findingLine) : [m.none]), '',
    m.existingTotal(t.existing), '', m.dismissedTotal(t.dismissed));
  if (report.excluded.length) out.push('', `## ${m.excludedHeading}`, '', ...report.excluded.map(e => `- ${e}`));
  return `${out.join('\n')}\n`;
}
