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
import { runScanAgil } from '../src/security-scan/agil';
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

const leftovers = (tmpdir = os.tmpdir()): string[] => fs.readdirSync(tmpdir).filter(n => /^ork-security-scan-(tree|out)-/.test(n)).sort();

/** Cada caso responde somente pelas pastas que a propria varredura criou. */
function emTmpdirDoCaso<T>(nome: string, executar: (tmpdir: string) => T): T {
  const tmpdir = dirTemporario(nome);
  const salvo = process.env.TMPDIR;
  process.env.TMPDIR = tmpdir;
  try {
    assert.equal(fs.realpathSync(os.tmpdir()), fs.realpathSync(tmpdir), 'o caso usa seu proprio TMPDIR');
    return executar(tmpdir);
  } finally {
    if (salvo === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = salvo;
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

let cache: string;
let savedCache: string | undefined;
const dirs: string[] = [];
beforeEach(() => { savedCache = process.env.XDG_CACHE_HOME; cache = dirTemporario('secscan-int-cache'); process.env.XDG_CACHE_HOME = cache; });
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(cache, { recursive: true, force: true });
  if (savedCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = savedCache;
});

const semDocker = (): string | false => semAmbiente(['docker']);

for (const stack of ['js', 'python', 'go'] as const) {
  test(`real Docker: the ${stack} fixture yields new loop findings in secret, dependency, sast and workflow`,
    { skip: semDocker(), timeout: DEADLINE_MS + 60000 }, () => emTmpdirDoCaso(`secscan-int-tmp-${stack}`, (tmpdir) => {
      const { dir, base } = fixtureRepo(stack);
      dirs.push(dir);
      const before = leftovers(tmpdir);
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

      assert.deepEqual(leftovers(tmpdir), before, 'no leftover worktree or out dir created by this case');
      const wts = git(dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
      assert.equal(wts.length, 1, 'no registered worktree is left');
    }));
}

// RM-074 (F4): o mesmo caso com o Docker real pela varredura do Agile (um trabalhador por ferramenta, a imagem de lint, o
// cache do Trivy por usuario), na fixture js, na lane de integracao. A parede vai ao stderr, para a medida do custo.
test('Docker real (Agile, RM-074 F4): o runScanAgil na fixture js roda toda ferramenta e acha o novo do loop em secret, dependency, sast e workflow',
  { skip: semDocker(), timeout: DEADLINE_MS + 60000 }, () => emTmpdirDoCaso('secscan-int-tmp-agile-js', (tmpdir) => {
    const { dir, base } = fixtureRepo('js');
    dirs.push(dir);
    const sobras = (): string[] => fs.readdirSync(tmpdir).filter(n => /^ork-security-scan-(tree|out|agil)-/.test(n)).sort();
    const antes = sobras();
    const inicio = Date.now();
    const report: ScanReport = runScanAgil({ root: dir, stateRoot: dir, base, deadlineMs: DEADLINE_MS });
    const ms = Date.now() - inicio;
    const counts = Object.fromEntries(LOOP_CATEGORIES.map(c =>
      [c, report.findings.filter(f => f.category === c && f.status === 'new' && f.loop).length]));
    process.stderr.write(`[security-scan-integracao] agile js: ${ms} ms, new loop findings ${JSON.stringify(counts)}, `
      + `pecas ${(report.check?.pecas ?? []).map(p => `${p.peca}=${p.estado}`).join(' ')}\n`);
    assert.equal(report.check?.modo, 'agile');
    for (const t of report.tools) assert.equal(t.state, 'ran', `js: ${t.name}: ${t.reason}`);
    for (const c of LOOP_CATEGORIES) assert.ok(counts[c] > 0, `js: a new loop finding in ${c}`);
    assert.ok(report.findings.every(f => f.status === 'new'), 'a base e limpa: nada existente');
    const src = SECRET_SOURCE.js;
    const secret = src.pattern.exec(fs.readFileSync(path.join(FIXTURES, 'js', src.file), 'utf8'))![1];
    assert.ok(!JSON.stringify(report).includes(secret), 'o valor do segredo nunca chega ao relatorio');
    assert.deepEqual(sobras(), antes, 'nenhuma worktree, saida ou pasta dos trabalhadores sobra no temporario');
    assert.equal(git(dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).length, 1);
  }));

test('without docker in PATH and without native binaries every tool is unavailable', () => {
  emTmpdirDoCaso('secscan-int-tmp-sem-docker', () => {
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
});
