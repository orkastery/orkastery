import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dirTemporario } from './apoio';
import { installFakeTools, type FakeTools } from './security-scan-docker-falso';
import { argumentosDeCpuDoDocker, chooseExecutor, defaultProbe, type Probe } from '../src/security-scan/executor';
import { runScan } from '../src/security-scan/run';
import { loadTools } from '../src/security-scan/tools';
import type { ScanReport, ToolSpec } from '../src/security-scan/types';
import { ENV_CPUS_DOCKER } from '../src/agendador-cpu';

const FIXTURE_JS = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan', 'js');
const JS_TOOLS = ['gitleaks', 'semgrep', 'trivy-vuln', 'npm-audit', 'trivy-config', 'zizmor', 'actionlint', 'eslint', 'trivy-license'];
const FAKE_SECRET = /apiKey: '([^']+)'/.exec(fs.readFileSync(path.join(FIXTURE_JS, 'src', 'config.js'), 'utf8'))![1];

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const CLEAN_JS = {
  'package.json': '{ "name": "clean-js", "version": "1.0.0", "private": true, "license": "MIT" }\n',
  'package-lock.json': '{ "name": "clean-js", "version": "1.0.0", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "clean-js", "version": "1.0.0" } } }\n',
};

interface Repo { dir: string; base: string; head: string; cleanup: () => void }

/**
 * A git repository whose `main` is a clean JS project and whose `feat` branch (checked out) replaces it with the
 * vulnerable JS fixture plus the `.fake-case` marker that makes the fake answer with the recorded `js` outputs.
 */
function scanRepo(name: string, opts: { origin?: boolean; mainBranch?: string } = {}): Repo {
  const dir = dirTemporario(name);
  const extra: string[] = [];
  git(dir, 'init', '-q', '-b', opts.mainBranch ?? 'main');
  for (const [f, body] of Object.entries(CLEAN_JS)) fs.writeFileSync(path.join(dir, f), body);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  if (opts.origin) {
    const remote = dirTemporario(`${name}-origin`);
    extra.push(remote);
    git(remote, 'init', '-q', '--bare', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', remote);
    git(dir, 'push', '-q', 'origin', 'main');
  }
  git(dir, 'checkout', '-q', '-b', 'feat');
  fs.cpSync(FIXTURE_JS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.fake-case'), 'js\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'head');
  const head = git(dir, 'rev-parse', 'HEAD');
  return { dir, base, head, cleanup: () => { for (const d of [dir, ...extra]) fs.rmSync(d, { recursive: true, force: true }); } };
}

const tool = (r: ScanReport, name: string) => {
  const t = r.tools.find(x => x.name === name);
  assert.ok(t, `tool ${name} in the report`);
  return t;
};
const total = (counts: ScanReport['tools'][number]['counts']): number =>
  Object.values(counts).reduce((n, bySev) => n + Object.values(bySev).reduce((a, b) => a + b, 0), 0);

const NO_DOCKER_NO_BINARY: Probe = { dockerCli: () => false, dockerDaemon: () => false, nativeVersion: () => null };

let cache: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['XDG_CACHE_HOME', 'ORK_FAKE_DOCKER_MODE', 'ORK_FAKE_DOCKER_SLEEP', 'ORK_FAKE_DOCKER_FAIL', 'ORK_FAKE_DOCKER_GARBAGE',
  'ORK_FAKE_DOCKER_ZERO_COMMITS', ENV_CPUS_DOCKER];
let fake: FakeTools | undefined;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  cache = dirTemporario('secscan-cache');
  process.env.XDG_CACHE_HOME = cache;
});
afterEach(() => {
  fake?.restore(); fake = undefined;
  for (const c of cleanups.splice(0)) c();
  fs.rmSync(cache, { recursive: true, force: true });
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
const repo = (name: string, opts?: Parameters<typeof scanRepo>[1]): Repo => { const r = scanRepo(name, opts); cleanups.push(r.cleanup); return r; };

test('chooseExecutor: Docker first, then the native binary with the accepted version, else unavailable with the reason', () => {
  const gitleaks = loadTools().find(t => t.name === 'gitleaks')!;
  const eslint = loadTools().find(t => t.name === 'eslint')!;
  const probe = (p: Partial<Probe>): Probe => ({ ...NO_DOCKER_NO_BINARY, ...p });
  assert.deepEqual(chooseExecutor(gitleaks, probe({ dockerCli: () => true, dockerDaemon: () => true })), { kind: 'docker' });
  assert.deepEqual(chooseExecutor(gitleaks, probe({ nativeVersion: () => 'v8.30.1' })), { kind: 'native' });
  assert.deepEqual(chooseExecutor(gitleaks, probe({ nativeVersion: () => '8.24.0' })), { kind: 'unavailable', reason: 'binary-version-mismatch' });
  assert.deepEqual(chooseExecutor(gitleaks, NO_DOCKER_NO_BINARY), { kind: 'unavailable', reason: 'docker-missing' });
  assert.deepEqual(chooseExecutor(gitleaks, probe({ dockerCli: () => true })), { kind: 'unavailable', reason: 'docker-daemon-down' });
  assert.deepEqual(chooseExecutor(eslint, NO_DOCKER_NO_BINARY), { kind: 'unavailable', reason: 'docker-missing' });
  assert.deepEqual(chooseExecutor(eslint, probe({ dockerCli: () => true })), { kind: 'unavailable', reason: 'docker-daemon-down' });
  const pipAudit = loadTools().find(t => t.name === 'pip-audit')!;
  assert.equal(pipAudit.native, undefined, 'a tool that installs packages has no native entry');
});

test('CPU limit: o Docker do grupo Agile recebe --cpus e o Classic sem cota preserva o argv', () => {
  assert.deepEqual(argumentosDeCpuDoDocker({ [ENV_CPUS_DOCKER]: '1' }), ['--cpus', '1']);
  assert.deepEqual(argumentosDeCpuDoDocker({ [ENV_CPUS_DOCKER]: '0.5' }), ['--cpus', '0.5']);
  assert.deepEqual(argumentosDeCpuDoDocker({}), []);
  assert.deepEqual(argumentosDeCpuDoDocker({ [ENV_CPUS_DOCKER]: 'invalido' }), []);
});

test('without Docker and without binaries every tool is unavailable and the report has no finding', () => {
  const r = repo('secscan-none', { origin: true });
  const report = runScan({ root: r.dir, stateRoot: r.dir, probe: NO_DOCKER_NO_BINARY, now: () => new Date('2026-10-19T12:00:00Z') });
  assert.equal(report.schema, 'ork.security-scan/v1');
  assert.equal(report.base, r.base);
  assert.equal(report.head, r.head);
  assert.equal(report.generatedAt, '2026-10-19T12:00:00.000Z');
  assert.deepEqual(report.stacks, ['js']);
  assert.deepEqual(report.tools.map(t => t.name), JS_TOOLS);
  for (const t of report.tools) {
    assert.equal(t.state, 'unavailable', t.name);
    assert.equal(t.executor, null, t.name);
    assert.equal(t.reason, 'docker-missing', t.name);
    assert.equal(total(t.counts), 0, t.name);
  }
  assert.deepEqual(report.findings, []);
});

test('with Docker every tool runs in a hardened container, the fixture findings are new and the base worktree is gone', () => {
  const r = repo('secscan-docker', { origin: true });
  fake = installFakeTools();
  process.env[ENV_CPUS_DOCKER] = '1';
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  for (const t of report.tools) {
    assert.equal(t.state, 'ran', `${t.name}: ${t.reason}`);
    assert.equal(t.executor, 'docker', t.name);
    assert.equal(t.version, loadTools().find(x => x.name === t.name)!.version);
  }
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every(f => f.status === 'new'));
  const secrets = report.findings.filter(f => f.tool === 'gitleaks');
  assert.equal(secrets.length, 1, 'dir and git scans of the same secret merge into one finding');
  assert.equal(secrets[0].loop, true);
  assert.equal(secrets[0].file, 'src/config.js');
  assert.ok(!JSON.stringify(report).includes(FAKE_SECRET), 'the secret value never reaches the report');
  assert.equal(tool(report, 'gitleaks').counts.new.critical, 1);
  assert.equal(total(tool(report, 'npm-audit').counts), report.findings.filter(f => f.tool === 'npm-audit').length);

  const runs = fake.calls().filter(c => c.as === 'docker' && c.args[0] === 'run').map(c => c.args);
  // HEAD and base per tool plus the Gitleaks git scan; the clean base has no workflow, so zizmor and actionlint skip it.
  assert.equal(runs.length, JS_TOOLS.length * 2 + 1 - 2);
  const uid = `${process.getuid!()}:${process.getgid!()}`;
  for (const a of runs) {
    const image = a.find(x => x.includes('@sha256:'));
    assert.ok(image, 'image by digest');
    assert.ok(a.includes('--rm'));
    assert.equal(a[a.indexOf('--user') + 1], process.getuid!() === 0 ? '65534:65534' : uid);
    assert.ok(a.some(x => /:\/src:ro$/.test(x)), 'repository mounted read-only');
    assert.ok(a.some(x => x.startsWith('/tmp:')) && a.includes('--tmpfs'), 'writable /tmp');
    assert.ok(a.includes('--name'));
    assert.equal(a[a.indexOf('--cpus') + 1], '1', 'a cota do grupo chega a todo conteiner da varredura');
    const spec = loadTools().find(t => t.image === image && JSON.stringify(a).includes(t.expect.files[0].replace(/\.json$/, '')))
      ?? loadTools().find(t => t.image === image)!;
    assert.equal(a.includes('--network') && a[a.indexOf('--network') + 1] === 'none', spec.network === 'none', spec.name);
    const envs = a.flatMap((x, i) => (x === '-e' ? [a[i + 1].split('=')[0]] : []));
    for (const e of envs) assert.ok(Object.keys(spec.env ?? {}).includes(e), `${spec.name}: only catalog env (${e})`);
  }
  const wts = git(r.dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
  assert.equal(wts.length, 1, 'the temporary base worktree is removed');

  // Second run: the base comes from the cache ($XDG_CACHE_HOME), only the HEAD runs again.
  const cacheDir = path.join(cache, 'orkastery', 'security-scan', r.base);
  assert.ok(fs.readdirSync(cacheDir).some(f => /^gitleaks-[0-9a-f]{12}\.json$/.test(f)));
  assert.ok(fs.readdirSync(cacheDir).some(f => /^npm-audit-[0-9a-f]{12}-js-root\.json$/.test(f)));
  assert.ok(!fs.readdirSync(cacheDir).some(f => fs.readFileSync(path.join(cacheDir, f), 'utf8').includes(FAKE_SECRET)));
  const before = fake.calls().length;
  const again = runScan({ root: r.dir, stateRoot: r.dir });
  const runs2 = fake.calls().slice(before).filter(c => c.as === 'docker' && c.args[0] === 'run');
  assert.equal(runs2.length, JS_TOOLS.length + 1);
  assert.deepEqual(again.findings.map(f => [f.fingerprint, f.status]), report.findings.map(f => [f.fingerprint, f.status]));
});

test('base equal to HEAD: every finding is existing (the baseline of an adopting project)', () => {
  const r = repo('secscan-same', { origin: true });
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir, base: 'HEAD' });
  assert.equal(report.base, r.head);
  assert.ok(report.tools.every(t => t.state === 'ran'), JSON.stringify(report.tools.map(t => [t.name, t.state, t.reason])));
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every(f => f.status === 'existing' && !f.loop));
});

test('native binary with the accepted version runs without Docker; a wrong version is binary-version-mismatch', () => {
  const r = repo('secscan-native', { origin: true });
  fake = installFakeTools(['gitleaks', 'trivy']);
  const versions: Record<string, string> = { gitleaks: '8.30.1', trivy: 'Version: 0.70.0' };
  const probe: Probe = { dockerCli: () => false, dockerDaemon: () => false, nativeVersion: bin => versions[bin] ?? null };
  const report = runScan({ root: r.dir, stateRoot: r.dir, probe });
  const gl = tool(report, 'gitleaks');
  assert.equal(gl.state, 'ran', gl.reason);
  assert.equal(gl.executor, 'native');
  assert.equal(gl.version, '8.30.1');
  const secrets = report.findings.filter(f => f.tool === 'gitleaks');
  assert.deepEqual(secrets.map(f => [f.file, f.status]), [['src/config.js', 'new']]);
  for (const name of ['trivy-vuln', 'trivy-config', 'trivy-license']) {
    assert.equal(tool(report, name).state, 'unavailable');
    assert.equal(tool(report, name).reason, 'binary-version-mismatch');
  }
  assert.ok(fake.calls().every(c => c.as !== 'docker'));
});

test('Review Focus 1: Gitleaks reading 0 commits of a non-empty base..HEAD fails (zero-commits-scanned), in a worktree with the main .git mounted', () => {
  const r = repo('secscan-zero', { origin: true });
  git(r.dir, 'checkout', '-q', 'main');
  const wt = path.join(dirTemporario('secscan-zero-wt'), 'wt');
  cleanups.push(() => fs.rmSync(path.dirname(wt), { recursive: true, force: true }));
  git(r.dir, 'worktree', 'add', '-q', wt, 'feat');
  fake = installFakeTools();
  const ok = runScan({ root: wt, stateRoot: r.dir });
  assert.equal(tool(ok, 'gitleaks').state, 'ran', tool(ok, 'gitleaks').reason);
  const gitRun = fake.calls().find(c => c.args[0] === 'run' && c.args.includes('git') && c.args.some(a => a.endsWith('gitleaks-git.json')))!;
  const mainGit = path.join(r.dir, '.git');
  assert.ok(gitRun.args.includes(`${mainGit}:${mainGit}:ro`), 'the .git of the main repository is mounted read-only at its own path');
  assert.ok(gitRun.args.includes(`${r.base}..HEAD`));

  process.env.ORK_FAKE_DOCKER_ZERO_COMMITS = '1';
  const zero = runScan({ root: wt, stateRoot: r.dir });
  const gl = tool(zero, 'gitleaks');
  assert.equal(gl.state, 'failed');
  assert.equal(gl.reason, 'zero-commits-scanned');
  assert.equal(total(gl.counts), 0);
  assert.ok(zero.findings.every(f => f.tool !== 'gitleaks'), 'a failed tool contributes no finding');
  assert.equal(tool(zero, 'semgrep').state, 'ran');
  const wts = git(r.dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
  assert.equal(wts.length, 2, 'only the main checkout and the test worktree remain');
});

test('zero commits scanned is tolerated when base..HEAD has no patch content (empty commits and merges only)', () => {
  const r = repo('secscan-zero-sem-patch', { origin: true });
  git(r.dir, 'commit', '-q', '--allow-empty', '-m', 'empty');
  git(r.dir, 'checkout', '-q', '-b', 'side');
  git(r.dir, 'commit', '-q', '--allow-empty', '-m', 'side empty');
  git(r.dir, 'checkout', '-q', 'feat');
  git(r.dir, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  assert.equal(git(r.dir, 'log', '-p', '--format=', `${r.head}..HEAD`), '', 'the range has commits but no patch');
  fake = installFakeTools();
  process.env.ORK_FAKE_DOCKER_ZERO_COMMITS = '1';
  const report = runScan({ root: r.dir, stateRoot: r.dir, base: r.head });
  assert.equal(tool(report, 'gitleaks').state, 'ran', tool(report, 'gitleaks').reason);
  // The same fake with patch content in the range still fails.
  const strict = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.equal(tool(strict, 'gitleaks').reason, 'zero-commits-scanned');
});

test('Review Focus 3: without origin/<base> nor a local base branch every tool fails with base-unresolved', () => {
  const r = repo('secscan-nobase', { mainBranch: 'trunk' });
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  assert.equal(report.base, '');
  for (const t of report.tools) {
    assert.equal(t.state, 'failed', t.name);
    assert.equal(t.reason, 'base-unresolved', t.name);
  }
  assert.deepEqual(report.findings, []);
  assert.ok(!fake.calls().some(c => c.args[0] === 'run'), 'nothing runs without a base');

  const bad = runScan({ root: r.dir, stateRoot: r.dir, base: 'no-such-ref' });
  assert.ok(bad.tools.every(t => t.state === 'failed' && t.reason === 'base-unresolved'));
});

test('a local base branch is the fallback when there is no remote; a scan from a subdirectory scans the repository', () => {
  const r = repo('secscan-local');
  fake = installFakeTools();
  const report = runScan({ root: path.join(r.dir, 'src'), stateRoot: r.dir });
  assert.equal(report.base, r.base);
  assert.deepEqual(report.stacks, ['js']);
  assert.ok(report.tools.every(t => t.state === 'ran'));
  assert.ok(report.findings.some(f => f.tool === 'gitleaks' && f.file === 'src/config.js'));
});

test('Review Focus 5: a tool that hangs past timeoutMs fails with timeout, its container is removed and the run returns', () => {
  const r = repo('secscan-timeout', { origin: true });
  fake = installFakeTools();
  process.env.ORK_FAKE_DOCKER_SLEEP = 'gitleaks';
  const tools: ToolSpec[] = loadTools().map(t => (t.name === 'gitleaks' ? { ...t, timeoutMs: 1500 } : t));
  const started = Date.now();
  const report = runScan({ root: r.dir, stateRoot: r.dir, tools });
  assert.ok(Date.now() - started < 20000, `returned in ${Date.now() - started} ms`);
  const gl = tool(report, 'gitleaks');
  assert.equal(gl.state, 'failed');
  assert.equal(gl.reason, 'timeout');
  assert.equal(tool(report, 'semgrep').state, 'ran');
  const calls = fake.calls();
  const name = calls.find(c => c.args[0] === 'run' && c.args.some(a => a.includes('zricethezav/gitleaks')))!.args;
  const container = name[name.indexOf('--name') + 1];
  assert.ok(calls.some(c => c.args[0] === 'rm' && c.args.includes('-f') && c.args.includes(container)), 'the container is removed');
});

test('config.tools.<name>.disabled makes the tool unavailable/disabled', () => {
  const r = repo('secscan-disabled', { origin: true });
  fs.mkdirSync(path.join(r.dir, '.ork-security'));
  fs.writeFileSync(path.join(r.dir, '.ork-security', 'config.json'), JSON.stringify({ tools: { eslint: { disabled: 'lint runs in CI' } } }));
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'config');
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  const eslint = tool(report, 'eslint');
  assert.equal(eslint.state, 'unavailable');
  assert.equal(eslint.reason, 'disabled');
  assert.equal(eslint.executor, null);
  assert.ok(report.findings.every(f => f.tool !== 'eslint'));
  assert.ok(!fake.calls().some(c => c.args.some(a => a.endsWith('eslint.json'))));
});

test('workflow tools: .gitlab-ci.yml without .github/workflows is unavailable/unsupported-ci; no CI at all is ran with nothing', () => {
  const r = repo('secscan-gitlab', { origin: true });
  fs.rmSync(path.join(r.dir, '.github'), { recursive: true });
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'no workflows');
  fake = installFakeTools();
  const none = runScan({ root: r.dir, stateRoot: r.dir });
  for (const name of ['zizmor', 'actionlint']) {
    assert.equal(tool(none, name).state, 'ran', name);
    assert.equal(total(tool(none, name).counts), 0, name);
  }
  fs.writeFileSync(path.join(r.dir, '.gitlab-ci.yml'), 'test:\n  script: [echo ok]\n');
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'gitlab ci');
  const gl = runScan({ root: r.dir, stateRoot: r.dir });
  for (const name of ['zizmor', 'actionlint']) {
    assert.equal(tool(gl, name).state, 'unavailable', name);
    assert.equal(tool(gl, name).reason, 'unsupported-ci', name);
  }
});

test('Docker daemon down, image pull failure, tool failure and output that breaks the contract', () => {
  const r = repo('secscan-failures', { origin: true });
  fake = installFakeTools();
  process.env.ORK_FAKE_DOCKER_MODE = 'daemon-down';
  // The real probe asks the fake `docker`; native versions are pinned to "absent" so host binaries do not count.
  const down = runScan({ root: r.dir, stateRoot: r.dir, probe: { ...defaultProbe(), nativeVersion: () => null } });
  assert.ok(down.tools.every(t => t.state === 'unavailable' && t.reason === 'docker-daemon-down'), JSON.stringify(down.tools.map(t => t.reason)));

  process.env.ORK_FAKE_DOCKER_MODE = 'pull-fails';
  const pull = runScan({ root: r.dir, stateRoot: r.dir, probe: { ...defaultProbe(), nativeVersion: () => null } });
  assert.ok(pull.tools.every(t => t.state === 'unavailable' && t.reason === 'image-pull-failed'));

  delete process.env.ORK_FAKE_DOCKER_MODE;
  process.env.ORK_FAKE_DOCKER_FAIL = 'semgrep';
  process.env.ORK_FAKE_DOCKER_GARBAGE = 'gitleaks';
  const broken = runScan({ root: r.dir, stateRoot: r.dir });
  const sg = tool(broken, 'semgrep');
  assert.equal(sg.state, 'failed');
  assert.match(sg.reason!, /^exit-2: fake failure$/);
  const gl = tool(broken, 'gitleaks');
  assert.equal(gl.state, 'failed');
  assert.match(gl.reason!, /^security-scan\.parse: gitleaks: invalid JSON$/);
  assert.ok(broken.findings.every(f => f.tool !== 'semgrep' && f.tool !== 'gitleaks'));
  assert.equal(tool(broken, 'trivy-vuln').state, 'ran');
});

test('pip-audit without a requirements file is unavailable/no-requirements-file', () => {
  const r = repo('secscan-poetry', { origin: true });
  fs.writeFileSync(path.join(r.dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "0.1.0"\n');
  fs.writeFileSync(path.join(r.dir, 'poetry.lock'), '');
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'python');
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  assert.deepEqual(report.stacks, ['js', 'python']);
  const pa = tool(report, 'pip-audit');
  assert.equal(pa.state, 'unavailable');
  assert.equal(pa.reason, 'no-requirements-file');
  assert.equal(tool(report, 'ruff').state, 'ran');
});

test('only committed content is scanned: an untracked or ignored file in the working directory is not a finding', () => {
  const r = repo('secscan-untracked', { origin: true });
  // HEAD without the fixture marker: the committed tree answers with the clean recordings.
  git(r.dir, 'rm', '-q', '.fake-case');
  fs.writeFileSync(path.join(r.dir, '.gitignore'), '.fake-case\n');
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'ignore the marker');
  // The marker (and a copy of the secret) only in the working directory: ignored first, then untracked.
  fs.writeFileSync(path.join(r.dir, '.fake-case'), 'js\n');
  fs.writeFileSync(path.join(r.dir, 'leak.js'), `const apiKey = '${FAKE_SECRET}';\n`);
  fake = installFakeTools();
  const ignored = runScan({ root: r.dir, stateRoot: r.dir });
  assert.ok(ignored.tools.every(t => t.state === 'ran'));
  assert.deepEqual(ignored.findings.filter(f => f.tool === 'gitleaks'), []);
  fs.writeFileSync(path.join(r.dir, '.gitignore'), '');
  const untracked = runScan({ root: r.dir, stateRoot: r.dir });
  assert.deepEqual(untracked.findings.filter(f => f.tool === 'gitleaks'), []);
  assert.ok(!untracked.findings.some(f => f.status === 'new' && f.loop));
});

test('the base cache misses when the tool spec (install) or the tool config content changes', () => {
  const r = repo('secscan-cache-key', { origin: true });
  fake = installFakeTools();
  const baseRuns = (from: number, tool: string): number => fake!.calls().slice(from)
    .filter(c => c.args[0] === 'run' && c.args.some(a => a.endsWith(`/${tool}.json`) || a.endsWith(`/${tool}-dir.json`))).length;
  runScan({ root: r.dir, stateRoot: r.dir });
  let mark = fake.calls().length;
  runScan({ root: r.dir, stateRoot: r.dir });
  assert.equal(baseRuns(mark, 'eslint'), 1, 'cached: only the HEAD run');
  assert.equal(baseRuns(mark, 'gitleaks'), 1);

  mark = fake.calls().length;
  const tools = loadTools().map(t => (t.name === 'eslint' ? { ...t, install: [...(t.install ?? []), 'eslint-plugin-x@1.0.0'] } : t));
  runScan({ root: r.dir, stateRoot: r.dir, tools });
  assert.equal(baseRuns(mark, 'eslint'), 2, 'install changed: the base runs again');

  fs.mkdirSync(path.join(r.dir, '.ork-security'));
  fs.writeFileSync(path.join(r.dir, '.ork-security', 'gitleaks.toml'), '[extend]\nuseDefault = true\n');
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'project gitleaks config');
  mark = fake.calls().length;
  runScan({ root: r.dir, stateRoot: r.dir });
  assert.equal(baseRuns(mark, 'gitleaks'), 2, 'config content changed: the base runs again');
  assert.equal(baseRuns(mark, 'semgrep'), 1, 'other tools still come from the cache');
});

test('config.tools.<name>.version other than the catalog version is a config error', () => {
  const r = repo('secscan-version', { origin: true });
  fs.mkdirSync(path.join(r.dir, '.ork-security'));
  fs.writeFileSync(path.join(r.dir, '.ork-security', 'config.json'), JSON.stringify({ tools: { semgrep: { version: '1.0.0' } } }));
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', 'version');
  fake = installFakeTools();
  assert.throws(() => runScan({ root: r.dir, stateRoot: r.dir }), /security-scan\.config-invalid: tools\.semgrep\.version/);
  const wts = git(r.dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree '));
  assert.equal(wts.length, 1, 'the HEAD worktree is removed on the error path too');
});

test('an image that cannot be pulled falls back to the native binary', () => {
  const r = repo('secscan-pull-native', { origin: true });
  fake = installFakeTools(['docker', 'gitleaks']);
  process.env.ORK_FAKE_DOCKER_MODE = 'pull-fails';
  const report = runScan({ root: r.dir, stateRoot: r.dir, probe: { ...defaultProbe(), nativeVersion: bin => (bin === 'gitleaks' ? 'v8.30.1' : null) } });
  const gl = tool(report, 'gitleaks');
  assert.equal(gl.state, 'ran', gl.reason);
  assert.equal(gl.executor, 'native');
  assert.equal(gl.version, 'v8.30.1');
  assert.equal(tool(report, 'semgrep').reason, 'image-pull-failed');
});

/** A repository whose HEAD answers with the fake recordings of `kase` (the clean base answers `empty`). */
function caseRepo(name: string, kase: string): Repo {
  const r = repo(name, { origin: true });
  fs.writeFileSync(path.join(r.dir, '.fake-case'), `${kase}\n`);
  git(r.dir, 'add', '-A');
  git(r.dir, 'commit', '-q', '-m', kase);
  return { ...r, head: git(r.dir, 'rev-parse', 'HEAD') };
}

test('Semgrep with only warn-level Timeout/PartialParsing errors is ran with partial-* and its findings count', () => {
  const r = caseRepo('secscan-semgrep-partial', 'partial');
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  const sg = tool(report, 'semgrep');
  assert.equal(sg.state, 'ran');
  assert.equal(sg.reason, 'partial-timeout: 2, partial-parsing: 1');
  const found = report.findings.filter(f => f.tool === 'semgrep');
  assert.equal(found.length, 1);
  assert.equal(found[0].status, 'new');
  assert.equal(found[0].loop, true, 'a high SAST finding of a partial run still enters the loop');
});

test('Semgrep with a fatal error next to tolerated ones is failed and contributes no finding', () => {
  const r = caseRepo('secscan-semgrep-fatal', 'fatal');
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  const sg = tool(report, 'semgrep');
  assert.equal(sg.state, 'failed');
  assert.match(sg.reason!, /^security-scan\.parse: semgrep: tool reported "errors": .*Rule parse error/);
  assert.doesNotMatch(sg.reason!, /Timeout/, 'the tolerated entries are not quoted as the cause');
  assert.ok(report.findings.every(f => f.tool !== 'semgrep'));
});

test('a failure on the base side carries the base- prefix', () => {
  const r = repo('secscan-base-fail', { origin: true });
  fake = installFakeTools();
  process.env.ORK_FAKE_DOCKER_FAIL = 'semgrep@empty';
  const report = runScan({ root: r.dir, stateRoot: r.dir });
  const sg = tool(report, 'semgrep');
  assert.equal(sg.state, 'failed');
  assert.equal(sg.reason, 'base-exit-2: fake failure');
  assert.ok(report.findings.every(f => f.tool !== 'semgrep'));
});

test('deadlineMs bounds the whole round: the hanging tool and every tool after it fail with timeout', () => {
  const r = repo('secscan-deadline', { origin: true });
  fake = installFakeTools();
  process.env.ORK_FAKE_DOCKER_SLEEP = 'gitleaks';
  const started = Date.now();
  const report = runScan({ root: r.dir, stateRoot: r.dir, deadlineMs: 2500 });
  const took = Date.now() - started;
  assert.ok(took < 2500 + 6000, `returned in ${took} ms`);
  assert.ok(report.tools.every(t => t.state === 'failed' && t.reason === 'timeout'), JSON.stringify(report.tools.map(t => [t.name, t.reason])));
  assert.equal(fake.calls().filter(c => c.args[0] === 'run').length, 1, 'nothing starts once the deadline is spent');
});

test('a round killed by SIGTERM leaves no worktree, no raw output dir and no container behind', async () => {
  const r = repo('secscan-sigterm', { origin: true });
  fake = installFakeTools();
  const tmp = dirTemporario('secscan-sigterm-tmp');
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const runner = path.join(tmp, 'runner.cjs');
  fs.writeFileSync(runner, `require(${JSON.stringify(path.resolve(__dirname, '..', 'src', 'security-scan', 'run.js'))})`
    + `.runScan({ root: process.argv[2], stateRoot: process.argv[2] });\n`);
  const scratch = path.join(tmp, 'scratch');
  fs.mkdirSync(scratch);
  const child = spawn(process.execPath, [runner, r.dir], {
    detached: true, stdio: 'ignore', env: { ...process.env, ORK_FAKE_DOCKER_SLEEP: 'gitleaks', TMPDIR: scratch },
  });
  const exited = new Promise<NodeJS.Signals | number | null>(res => child.on('exit', (code, sig) => res(sig ?? code)));
  const wait = async (cond: () => boolean, ms: number): Promise<boolean> => {
    for (const end = Date.now() + ms; Date.now() < end;) { if (cond()) return true; await new Promise(res => setTimeout(res, 100)); }
    return cond();
  };
  const sleeping = () => fake!.calls().some(c => c.args[0] === 'run' && c.args.some(a => a.includes('zricethezav/gitleaks')));
  assert.ok(await wait(sleeping, 20000), 'the round reached the hanging tool');
  const leftovers = () => fs.readdirSync(scratch).filter(n => n.startsWith('ork-security-scan-'));
  assert.ok(leftovers().some(n => n.includes('-tree-')) && leftovers().some(n => n.includes('-out-')), 'mid-round state exists');
  process.kill(-child.pid!, 'SIGTERM');
  assert.equal(await exited, 'SIGTERM', 'the runner dies on the signal (conventional 128+15)');
  const worktrees = () => git(r.dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).length;
  assert.ok(await wait(() => worktrees() === 1 && leftovers().length === 0, 15000), `left behind: ${leftovers().join(', ')}; worktrees ${worktrees()}`);
  const run = fake.calls().find(c => c.args[0] === 'run' && c.args.some(a => a.includes('zricethezav/gitleaks')))!.args;
  const container = run[run.indexOf('--name') + 1];
  assert.ok(fake.calls().some(c => c.args[0] === 'rm' && c.args.includes(container)), 'the running container is removed');
});

/** A repo with explicit base and HEAD file sets (paths relative to the root); `.fake-case` selects the recorded outputs. */
function twoCommitRepo(name: string, baseFiles: Record<string, string>, headFiles: Record<string, string>, removed: string[] = []): Repo {
  const dir = dirTemporario(name);
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (files: Record<string, string>) => {
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), body);
    }
  };
  git(dir, 'init', '-q', '-b', 'main');
  put(baseFiles);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  for (const f of removed) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  put(headFiles);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'head');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD'), cleanup: () => {} };
}

const runsWith = (f: FakeTools, file: string): number =>
  f.calls().filter(c => c.as === 'docker' && c.args[0] === 'run' && c.args.some(a => a.includes(file))).length;

test('base without the stack manifest: the base side is an empty ran (not failed) and the HEAD findings are new', () => {
  const r = twoCommitRepo('secscan-nomanifest', { 'README.md': '# base\n' },
    { ...CLEAN_JS, 'src/a.js': 'x\n', '.fake-case': 'js\n' });
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  const npm = tool(report, 'npm-audit');
  assert.equal(npm.state, 'ran', npm.reason);
  assert.ok(report.findings.filter(f => f.tool === 'npm-audit').every(f => f.status === 'new'));
  assert.equal(runsWith(fake, 'npm-audit.json'), 1, 'only the HEAD runs: the base has nothing to scan');
});

test('base with the manifest: the base side is scanned as before', () => {
  const r = twoCommitRepo('secscan-manifest', CLEAN_JS, { 'src/a.js': 'x\n', '.fake-case': 'js\n' });
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.equal(tool(report, 'npm-audit').state, 'ran');
  assert.equal(runsWith(fake, 'npm-audit.json'), 2, 'HEAD and base');
});

test('manifest moved from a/ to b/ (b/ exists on the base without it): the base unit is empty, so the findings of b/ are new', () => {
  const r = twoCommitRepo('secscan-moved', { 'a/package.json': CLEAN_JS['package.json'], 'a/package-lock.json': CLEAN_JS['package-lock.json'], 'b/README.md': '# b\n' },
    { 'b/package.json': CLEAN_JS['package.json'], 'b/package-lock.json': CLEAN_JS['package-lock.json'], '.fake-case': 'js\n' }, ['a']);
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.deepEqual(report.stacks, ['js']);
  assert.equal(tool(report, 'npm-audit').state, 'ran');
  const f = report.findings.filter(x => x.tool === 'npm-audit');
  assert.ok(f.length > 0 && f.every(x => x.status === 'new'), 'moving a manifest makes its findings new (conservative, pinned)');
  assert.equal(runsWith(fake, 'npm-audit.json'), 1);
});

test('a stack forced by config.stacks.add has no manifest and its base is still scanned', () => {
  const config = { '.ork-security/config.json': JSON.stringify({ stacks: { add: ['go'] } }) };
  const r = twoCommitRepo('secscan-forced', { 'README.md': '# base\n', ...config }, { '.fake-case': 'go\n' });
  fake = installFakeTools();
  const report = runScan({ root: r.dir, stateRoot: r.dir, base: r.base });
  assert.deepEqual(report.stacks, ['go']);
  assert.equal(tool(report, 'govulncheck').state, 'ran', tool(report, 'govulncheck').reason);
  assert.equal(runsWith(fake, 'govulncheck.json'), 2, 'HEAD and base');
});
