import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, test } from 'node:test';
import { dirTemporario } from './apoio';
import { installFakeTools, type FakeTools } from './security-scan-docker-falso';
import { comLocale } from '../src/locale';
import { executarSecurityScan } from '../src/security-scan/cli';
import { exitCodeOf, readReport, renderMarkdown, reportDir, writeReport } from '../src/security-scan/report';
import type { Category, Finding, ScanReport, ToolRun, ToolState } from '../src/security-scan/types';

const FIXTURE_JS = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan', 'js');
const FAKE_SECRET = /apiKey: '([^']+)'/.exec(fs.readFileSync(path.join(FIXTURE_JS, 'src', 'config.js'), 'utf8'))![1];

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const counts = (): ToolRun['counts'] => {
  const sev = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  return { new: sev(), existing: sev(), dismissed: sev() };
};
const toolRun = (name: string, category: Category, state: ToolState, reason?: string): ToolRun =>
  ({ name, category, version: '1', executor: state === 'unavailable' ? null : 'docker', state, ...(reason === undefined ? {} : { reason }), counts: counts() });
const finding = (over: Partial<Finding>): Finding => ({
  tool: 'semgrep', rule: 'r', category: 'sast', severity: 'high', file: 'a.js', message: 'm', fingerprint: 'fp', status: 'new', loop: true, ...over,
});
const report = (tools: ToolRun[], findings: Finding[] = []): ScanReport => ({
  schema: 'ork.security-scan/v1', base: 'b'.repeat(40), head: 'a'.repeat(40), generatedAt: '2026-10-19T00:00:00.000Z',
  stacks: ['js'], tools, excluded: ['dist/x.js'], findings,
});

const cleanups: Array<() => void> = [];
let fake: FakeTools | undefined;
const savedEnv = { cache: process.env.XDG_CACHE_HOME, required: process.env.ORK_SECURITY_SCAN_REQUIRED };
afterEach(() => {
  fake?.restore(); fake = undefined;
  for (const c of cleanups.splice(0)) c();
  for (const [k, v] of [['XDG_CACHE_HOME', savedEnv.cache], ['ORK_SECURITY_SCAN_REQUIRED', savedEnv.required]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const tmp = (name: string): string => { const d = dirTemporario(name); cleanups.push(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('exitCodeOf: new loop finding is 1, warn only is 0', () => {
  const t = [toolRun('semgrep', 'sast', 'ran')];
  assert.equal(exitCodeOf(report(t, [finding({})]), false), 1);
  assert.equal(exitCodeOf(report(t, [finding({ loop: false, severity: 'medium' })]), false), 0);
  assert.equal(exitCodeOf(report(t, [finding({ status: 'existing' }), finding({ status: 'dismissed' })]), true), 0);
});

test('exitCodeOf: unavailable or failed loop-category tool is 1 only when required; quality and license never', () => {
  const secret = report([toolRun('gitleaks', 'secret', 'unavailable', 'no-docker')]);
  assert.equal(exitCodeOf(secret, false), 0);
  assert.equal(exitCodeOf(secret, true), 1);
  assert.equal(exitCodeOf(report([toolRun('semgrep', 'sast', 'failed', 'timeout')]), true), 1);
  assert.equal(exitCodeOf(report([toolRun('eslint', 'quality', 'unavailable'), toolRun('trivy-license', 'license', 'failed')]), true), 0);
  assert.equal(exitCodeOf(report([toolRun('gitleaks', 'secret', 'ran')]), true), 0);
});

test('writeReport and readReport round trip under <state>/security-scan/<sha>; unknown sha is null', () => {
  const state = tmp('secscan-report');
  const r = report([toolRun('semgrep', 'sast', 'ran')], [finding({})]);
  const files = writeReport(state, r);
  assert.equal(path.dirname(files.json), reportDir(state, r.head));
  assert.equal(files.md, path.join(reportDir(state, r.head), 'report.md'));
  assert.ok(reportDir(state, r.head).startsWith(path.join(state, '.orkastery', 'security-scan')));
  assert.deepEqual(readReport(state, r.head), r);
  assert.equal(readReport(state, 'c'.repeat(40)), null);
  assert.deepEqual(fs.readdirSync(reportDir(state, r.head)).sort(), ['report.json', 'report.md'], 'no tmp file left');
});

test('report.md: execution table, then new loop findings, then new warn findings, then existing total and excluded', () => {
  const md = renderMarkdown(report(
    [toolRun('gitleaks', 'secret', 'ran'), toolRun('trivy-vuln', 'dependency', 'unavailable', 'no-docker')],
    [finding({ rule: 'warn-rule', loop: false, severity: 'medium', fingerprint: 'w1' }), finding({ rule: 'loop-rule', fingerprint: 'l1' }),
      finding({ status: 'existing', fingerprint: 'e1' }), finding({ status: 'existing', fingerprint: 'e2' })]));
  assert.match(md, /\| Ferramenta \| Executado por \| Estado \| Motivo \|/);
  assert.match(md, /\| trivy-vuln \| nenhum \| indisponível \| no-docker \|/);
  const at = (s: string): number => { const i = md.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('| gitleaks |') < at('loop-rule') && at('loop-rule') < at('warn-rule') && at('warn-rule') < at('Existentes na base: 2') && at('Existentes na base: 2') < at('dist/x.js'));
  assert.ok(!md.includes('—'));
});

/** A repository whose `main` is clean and whose `feat` head holds the vulnerable JS fixture (fake docker answers). */
function fixtureRepo(): string {
  const dir = tmp('secscan-cli');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "clean-js", "version": "1.0.0", "private": true, "license": "MIT" }\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{ "name": "clean-js", "version": "1.0.0", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "clean-js", "version": "1.0.0" } } }\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'feat');
  fs.cpSync(FIXTURE_JS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.fake-case'), 'js\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'head');
  process.env.XDG_CACHE_HOME = tmp('secscan-cli-cache');
  fake = installFakeTools();
  return dir;
}

test('Review Focus 2: the fake secret is in no report file and not in stdout; stdout ends with the report.md path', () => {
  const dir = fixtureRepo();
  const out: string[] = [];
  const code = executarSecurityScan(['--base', 'main'], { raiz: dir, estado: dir, escrever: t => out.push(t) });
  assert.equal(code, 1, 'a new secret is in the loop');
  const head = git(dir, 'rev-parse', 'HEAD');
  const md = path.join(reportDir(dir, head), 'report.md');
  assert.equal(out[out.length - 1], md);
  const json = fs.readFileSync(path.join(reportDir(dir, head), 'report.json'), 'utf8');
  for (const [name, text] of [['report.json', json], ['report.md', fs.readFileSync(md, 'utf8')], ['stdout', out.join('\n')]]) {
    assert.ok(!text.includes(FAKE_SECRET), `${name} must not carry the secret`);
  }
  assert.ok(readReport(dir, head)!.findings.some(f => f.tool === 'gitleaks' && f.status === 'new'));
  assert.match(out[0], /^security-scan: \d+ novo\(s\)/);
});

test('stdout in en; --json prints the ScanReport and still writes the files; unknown flag is a usage error (2)', () => {
  const dir = fixtureRepo();
  const out: string[] = [];
  comLocale('en', () => executarSecurityScan(['--base=main'], { raiz: dir, estado: dir, escrever: t => out.push(t) }));
  assert.match(out[0], /^security-scan: \d+ new, \d+ existing, \d+ dismissed; \d+ in the loop$/);
  assert.ok(fs.existsSync(out[out.length - 1]));
  const enMd = fs.readFileSync(out[out.length - 1], 'utf8');
  assert.match(enMd, /\| Tool \| Executor \| State \| Reason \|/);

  const json: string[] = [];
  executarSecurityScan(['--base', 'main', '--json'], { raiz: dir, estado: dir, escrever: t => json.push(t) });
  const parsed = JSON.parse(json.join('\n')) as ScanReport;
  assert.equal(parsed.schema, 'ork.security-scan/v1');
  assert.ok(readReport(dir, parsed.head));

  const err = console.error; const seen: string[] = [];
  console.error = (...a: unknown[]) => { seen.push(a.join(' ')); };
  try { assert.equal(executarSecurityScan(['--nope'], { raiz: dir, estado: dir, escrever: () => {} }), 2); } finally { console.error = err; }
  assert.match(seen.join('\n'), /--nope/);
});

test('invalid dismissal exits 1 naming the entry, without a report', () => {
  const dir = fixtureRepo();
  fs.mkdirSync(path.join(dir, '.ork-security'));
  fs.writeFileSync(path.join(dir, '.ork-security', 'dismissals.json'), JSON.stringify([{ fingerprint: 'abc123' }]));
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'bad dismissal');
  const err = console.error; const seen: string[] = [];
  console.error = (...a: unknown[]) => { seen.push(a.join(' ')); };
  let code: number;
  try { code = executarSecurityScan(['--base', 'main'], { raiz: dir, estado: dir, escrever: () => {} }); } finally { console.error = err; }
  assert.equal(code, 1);
  assert.match(seen.join('\n'), /security-scan\.dismissal-invalid: abc123/);
  assert.ok(!fs.existsSync(path.join(dir, '.orkastery', 'security-scan')));
});
