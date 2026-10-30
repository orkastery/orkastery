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
import { LOOP_CATEGORIES, type Finding, type ScanReport, type ToolRun } from './types';

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

/**
 * "Nothing this tool can scan", declared in the report but not counted as an unscanned loop category: `unsupported-ci`
 * (a GitLab CI file and no GitHub workflow: no analyzer for it, a known product gap) and `no-requirements-file`
 * (pip-audit without `requirements*.txt`) when another tool of the same category ran in the round. Counted, either one
 * would keep every such project red under REQUIRED and every ship asking for authorization.
 */
export function isExcusedUnscanned(tool: ToolRun, tools: readonly ToolRun[]): boolean {
  if (tool.state !== 'unavailable') return false;
  if (tool.reason === 'unsupported-ci') return true;
  if (tool.reason === 'no-requirements-file') return tools.some(o => o !== tool && o.category === tool.category && o.state === 'ran');
  return false;
}

/** Loop-category tools that did not run and are not excused (`isExcusedUnscanned`): the single rule of exit code and ship gate. */
export function unscannedLoopTools(report: ScanReport): ToolRun[] {
  return report.tools.filter(t => t.state !== 'ran' && LOOP_CATEGORIES.includes(t.category) && !isExcusedUnscanned(t, report.tools));
}

/**
 * 1 when a `new` finding is in the loop, or when `required` and a tool of a loop category (secret, dependency, sast, iac,
 * workflow) is unavailable or failed (never clean), unless excused by `isExcusedUnscanned`; `quality` and `license`
 * tools never drive the code. Invalid dismissals or config never reach a report: the command fails before.
 */
export function exitCodeOf(report: ScanReport, required: boolean): 0 | 1 {
  if (report.findings.some(f => f.status === 'new' && f.loop)) return 1;
  if (required && unscannedLoopTools(report).length > 0) return 1;
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
      out.push(`| ${cell(r.name)} | ${r.executor ?? m.noExecutor} | ${m.states[r.state] ?? r.state} | ${cell(m.reason(r.reason ?? ''))} |`);
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
