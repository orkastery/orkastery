/**
 * Task 13a: `runScan` with REAL Docker over the three vulnerable fixtures. Local only (listed in
 * TESTES_DE_INTEGRACAO_LOCAL): the hermetic CI has neither Docker nor the pulled images. Without Docker the tests skip
 * (typed skip); with ORK_TESTE_EXIGE_AMBIENTE=1 they run and fail on the real absence.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dirTemporario } from './apoio';
import { semAmbiente } from './ambiente-de-teste';
import { runScan } from '../src/security-scan/run';
import type { Category, ScanReport, Stack } from '../src/security-scan/types';

const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan');
const DEADLINE_MS = 40 * 60 * 1000;
const LOOP_CATEGORIES: Category[] = ['secret', 'dependency', 'sast', 'workflow'];

/** The fake secret of each fixture, read from its source (never written in this test). */
const SECRET_SOURCE: Record<Stack, { file: string; pattern: RegExp }> = {
  js: { file: 'src/config.js', pattern: /apiKey: '([^']+)'/ },
  python: { file: 'app/config.py', pattern: /API_KEY = "([^"]+)"/ },
  go: { file: 'config.go', pattern: /apiKey = "([^"]+)"/ },
};

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** Base commit: a README only. HEAD commit: the fixture added. */
function fixtureRepo(stack: Stack): { dir: string; base: string } {
  const dir = dirTemporario(`secscan-int-${stack}`);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), '# clean base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  fs.cpSync(path.join(FIXTURES, stack), dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  return { dir, base };
}

const leftovers = (): string[] => fs.readdirSync(os.tmpdir()).filter(n => /^ork-security-scan-(tree|out)-/.test(n)).sort();

let cache: string;
let savedCache: string | undefined;
const dirs: string[] = [];
beforeEach(() => { savedCache = process.env.XDG_CACHE_HOME; cache = dirTemporario('secscan-int-cache'); process.env.XDG_CACHE_HOME = cache; });
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
  if (savedCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = savedCache;
});

// The probe repeats what the scan needs: the docker CLI and a reachable daemon (typed skip, RM-037).
const dockerOk = (): boolean => spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 20000 }).status === 0;
const semDocker = (): string | false => semAmbiente(['postgres'], { sonda: () => dockerOk() });

for (const stack of ['js', 'python', 'go'] as const) {
  test(`real Docker: the ${stack} fixture yields new loop findings in secret, dependency, sast and workflow`,
    { skip: semDocker(), timeout: DEADLINE_MS + 60000 }, () => {
      const { dir, base } = fixtureRepo(stack);
      dirs.push(dir);
      const before = leftovers();
      const started = Date.now();
      const report: ScanReport = runScan({ root: dir, stateRoot: dir, base, deadlineMs: DEADLINE_MS });
      const seconds = Math.round((Date.now() - started) / 1000);
      const counts = Object.fromEntries(LOOP_CATEGORIES.map(c =>
        [c, report.findings.filter(f => f.category === c && f.status === 'new' && f.loop).length]));
      process.stderr.write(`[security-scan-integracao] ${stack}: ${seconds}s, new loop findings ${JSON.stringify(counts)}, `
        + `tools ${report.tools.map(t => `${t.name}=${t.state}${t.reason ? `(${t.reason})` : ""}`).join(' ')}\n`);
      for (const t of report.tools) assert.equal(t.state, 'ran', `${stack}: ${t.name}: ${t.reason}`);
      for (const c of LOOP_CATEGORIES) assert.ok(counts[c] > 0, `${stack}: a new loop finding in ${c}`);
      assert.ok(report.findings.every(f => f.status === 'new'), 'the base is clean: nothing existing');

      const src = SECRET_SOURCE[stack];
      const secret = src.pattern.exec(fs.readFileSync(path.join(FIXTURES, stack, src.file), 'utf8'))![1];
      assert.ok(!JSON.stringify(report).includes(secret), 'the secret value never reaches the report');

      assert.deepEqual(leftovers(), before, 'no leftover worktree or out dir in the temp dir');
      const wts = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
      assert.equal(wts.length, 1, 'no registered worktree is left');
    });
}

test('without docker in PATH and without native binaries every tool is unavailable', () => {
  const { dir, base } = fixtureRepo('js');
  dirs.push(dir);
  const bin = dirTemporario('secscan-int-pathless');
  dirs.push(bin);
  const gitPath = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.symlinkSync(gitPath, path.join(bin, 'git'));
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  let report: ScanReport;
  try { report = runScan({ root: dir, stateRoot: dir, base, deadlineMs: 120000 }); } finally { process.env.PATH = savedPath; }
  assert.ok(report.tools.length > 0);
  for (const t of report.tools) assert.equal(t.state, 'unavailable', `${t.name}: ${t.reason}`);
  assert.deepEqual(report.findings, []);
});
