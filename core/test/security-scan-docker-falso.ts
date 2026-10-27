/**
 * A fake `docker` (and fake native tool binaries) for the security-scan executor tests, on the PATH of the test
 * process like the `claude` stub of apoio.ts. Each shim execs this compiled file with ORK_FAKE_AS=<name>.
 *
 * As `docker` it answers `--version`, `info`, `image inspect`, `pull`, `rm`/`kill` and `run`. A `run` is dispatched by
 * image digest and by the report file named in the args to the recorded real output of Task 5
 * (test/fixtures/security-scan/<report>.<case>.json), written into the host directory mounted at /out, or to stdout for
 * a catalog tool with `stdoutFile`. The case is the content of `.fake-case` at the root of the scanned tree (mounted at
 * /src), `empty` when the file is absent; a report with no recording for that case falls back to `empty`.
 * Gitleaks `git` prints "N commits scanned." on stderr as the real one does, N from `git rev-list --count` of the range.
 *
 * As a native binary (any other name) it runs the same emulation with the host paths of the args and the cwd as the
 * scanned tree, and rewrites the recorded `/src/` paths to that tree.
 *
 * Control (environment of the test process, inherited by the shims):
 *   ORK_FAKE_DOCKER_LOG             file where each call is appended as a JSON line {as, args}
 *   ORK_FAKE_DOCKER_MODE            `daemon-down` (info fails) or `pull-fails` (image absent and pull fails)
 *   ORK_FAKE_DOCKER_SLEEP           catalog tool name that sleeps 60 s before answering
 *   ORK_FAKE_DOCKER_SLEEP_MS        every tool run sleeps this many ms first (RM-072: proves the Agile scan overlaps runs)
 *   ORK_FAKE_DOCKER_FAIL            catalog tool name that exits 2 without output; `<tool>@<case>` only for that case
 *                                   (`semgrep@empty` fails on the clean base and runs on the fixture HEAD)
 *   ORK_FAKE_DOCKER_GARBAGE         catalog tool name whose report file is not JSON
 *   ORK_FAKE_DOCKER_ZERO_COMMITS=1  Gitleaks `git` reports 0 commits scanned whatever the range holds
 *   ORK_FAKE_DOCKER_BUILD=fails     `docker build` exits 1 (RM-072: the Agile lint image cannot be built)
 *   ORK_FAKE_DOCKER_BUILD_STDERR    the last stderr line of that failing build, in place of the npm network error
 *                                   (RM-074 F4: a registry URL with a login must reach the ledger redacted)
 *   ORK_FAKE_DOCKER_FAIL_COM_CACHE  catalog tool name that exits 1 with the real Trivy cache-lock message (it ends in
 *                                   `timeout`) only when the run mounts the Trivy cache (RM-072: the Agile run of the tool
 *                                   fails, the Classic run without the cache works)
 *   ORK_FAKE_NATIVE_WRONG_VERSION   catalog tool name whose native shim answers a version outside the catalog pattern
 *
 * RM-072 (Agile Check): `docker build -t <tag> -` reads the Dockerfile from stdin, keeps it in `ultimo-dockerfile` next to
 * the call log and records the tag in `imagens-construidas`; `image inspect` of an `orkastery-eslint-agil:` tag answers
 * only after that build, and `run` of that tag is the eslint tool. A native shim called with the tool's `versionArgs`
 * prints the catalog version (the probe of the Agile native-first choice).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ToolSpec } from '../src/security-scan/types';

export const RECORDED = path.resolve(__dirname, '../../test/fixtures/security-scan');
const CATALOG = path.resolve(__dirname, '../../assets/security-scan/tools.json');
/** RM-072 (D13): the Agile-only catalog (osv-scanner, oxlint), answered like the main one. */
const CATALOGO_DO_AGILE = path.resolve(__dirname, '../../assets/security-scan/tools-agil.json');

export interface FakeTools {
  dir: string;
  /** Every call received, in order. */
  calls: () => Array<{ as: string; args: string[] }>;
  restore: () => void;
}

/** Puts shims named `names` (default only `docker`) first on the PATH of this process. */
export function installFakeTools(names: string[] = ['docker']): FakeTools {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ork-test-fake-docker-')));
  for (const name of names) {
    const shim = `#!/bin/sh\nORK_FAKE_AS='${name}' exec '${process.execPath}' '${__filename}' "$@"\n`;
    fs.writeFileSync(path.join(dir, name), shim, { mode: 0o755 });
  }
  const log = path.join(dir, 'calls.jsonl');
  const previous = { PATH: process.env.PATH, ORK_FAKE_DOCKER_LOG: process.env.ORK_FAKE_DOCKER_LOG };
  process.env.PATH = `${dir}:${process.env.PATH ?? ''}`;
  process.env.ORK_FAKE_DOCKER_LOG = log;
  return {
    dir,
    calls: () => fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { as: string; args: string[] })
      : [],
    restore: () => {
      for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const VALUE_FLAGS = new Set(['--name', '--user', '-u', '--network', '--tmpfs', '-v', '--volume', '-w', '--workdir', '-e', '--env',
  '--entrypoint', '--security-opt', '--cap-drop', '--pull', '--stop-timeout', '--memory', '--pids-limit']);

interface Run { image: string; args: string[]; mounts: Map<string, string>; }

function parseRun(argv: string[]): Run {
  const mounts = new Map<string, string>();
  let i = 0;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) break;
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (a === '-v' || a === '--volume') { const [host, ctr] = v.split(':'); mounts.set(ctr, host); }
    }
  }
  return { image: argv[i], args: argv.slice(i + 1), mounts };
}

/** Container path to host path through the mounts (longest prefix). */
function toHost(p: string, mounts: Map<string, string>): string {
  const ctr = [...mounts.keys()].filter(c => p === c || p.startsWith(`${c}/`)).sort((a, b) => b.length - a.length)[0];
  return ctr === undefined ? p : mounts.get(ctr) + p.slice(ctr.length);
}

function sleep(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function identify(candidates: ToolSpec[], args: string[]): { tool: ToolSpec; file: string; outArg?: string } | null {
  for (const tool of candidates) {
    for (const file of tool.expect.files) {
      const outArg = args.find(a => a.endsWith(`/${file}`));
      if (outArg) return { tool, file, outArg };
    }
  }
  const withStdout = candidates.filter(t => t.stdoutFile);
  return withStdout.length === 1 ? { tool: withStdout[0], file: withStdout[0].stdoutFile! } : null;
}

/** Emulates one tool run; `src` is the host path of the scanned tree, `out` maps an out arg to a host path. */
function emulate(tool: ToolSpec, file: string, outHost: string | undefined, args: string[], src: string, native: boolean): number {
  if (process.env.ORK_FAKE_DOCKER_SLEEP === tool.name) sleep(60000);
  const espera = Number(process.env.ORK_FAKE_DOCKER_SLEEP_MS);
  if (Number.isFinite(espera) && espera > 0) sleep(espera);
  const stackDir = (() => {
    // Per-stack wrappers pass {stackDir} as a positional parameter; Semgrep and Ruff as the last argument.
    const last = args[args.length - 1];
    return last && !last.startsWith('-') && !last.includes('/') && fs.existsSync(path.join(src, last)) ? last : '.';
  })();
  if (tool.name === 'actionlint' && !fs.existsSync(path.join(src, '.github', 'workflows'))) { process.stderr.write('no-workflows\n'); return 4; }
  if (tool.name === 'pip-audit' && !fs.readdirSync(path.join(src, stackDir)).some(f => /^requirements.*\.txt$/.test(f))) {
    process.stderr.write('no-requirements-file\n'); return 3;
  }
  const caseFile = path.join(src, '.fake-case');
  const kase = fs.existsSync(caseFile) ? fs.readFileSync(caseFile, 'utf8').trim() : 'empty';
  const fail = process.env.ORK_FAKE_DOCKER_FAIL;
  if (fail === tool.name || fail === `${tool.name}@${kase}`) { process.stderr.write('fake failure\n'); return 2; }
  const ext = path.extname(file);
  const recorded = [kase, 'empty'].map(k => path.join(RECORDED, `${path.basename(file, ext)}.${k}${ext}`)).find(fs.existsSync);
  if (!recorded) { process.stderr.write(`no recording for ${file}\n`); return 9; }
  let body = fs.readFileSync(recorded, 'utf8');
  if (native) body = body.replaceAll('"/src/', `"${src}/`);
  if (process.env.ORK_FAKE_DOCKER_GARBAGE === tool.name) body = 'not json at all';
  if (tool.name === 'gitleaks' && args.includes('git')) {
    const range = args[args.indexOf('--log-opts') + 1];
    const r = spawnSync('git', ['rev-list', '--count', range], { cwd: src, encoding: 'utf8' });
    const n = process.env.ORK_FAKE_DOCKER_ZERO_COMMITS === '1' || r.status !== 0 ? 0 : Number(r.stdout.trim());
    if (n === 0) body = '[]\n';
    process.stderr.write(`8:00PM INF ${n} commits scanned.\n8:00PM INF no leaks found\n`);
  }
  if (outHost) fs.writeFileSync(outHost, body);
  else process.stdout.write(body);
  return 0;
}

/** The tags `docker build` made in this fake (RM-072). */
function construidas(): string[] {
  const arquivo = path.join(path.dirname(process.env.ORK_FAKE_DOCKER_LOG ?? ''), 'imagens-construidas');
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean) : [];
}

function main(): number {
  const as = process.env.ORK_FAKE_AS ?? 'docker';
  const argv = process.argv.slice(2);
  if (process.env.ORK_FAKE_DOCKER_LOG) fs.appendFileSync(process.env.ORK_FAKE_DOCKER_LOG, `${JSON.stringify({ as, args: argv })}\n`);
  const tools = [...JSON.parse(fs.readFileSync(CATALOG, 'utf8')) as ToolSpec[], ...JSON.parse(fs.readFileSync(CATALOGO_DO_AGILE, 'utf8')) as ToolSpec[]];
  const mode = process.env.ORK_FAKE_DOCKER_MODE ?? '';
  if (as !== 'docker') {
    const declarada = tools.find(t => t.native?.bin === as && JSON.stringify(t.native.versionArgs) === JSON.stringify(argv));
    if (declarada) {
      process.stdout.write(`${as} ${process.env.ORK_FAKE_NATIVE_WRONG_VERSION === declarada.name ? '0.0.1' : declarada.version}\n`);
      return 0;
    }
    const found = identify(tools.filter(t => t.native?.bin === as || t.args[0] === as), argv);
    if (!found) { process.stderr.write(`fake ${as}: unknown call\n`); return 9; }
    return emulate(found.tool, found.file, found.outArg, argv, process.cwd(), true);
  }
  switch (argv[0]) {
    case '--version': process.stdout.write('Docker version 29.0.0-fake\n'); return 0;
    case 'info':
      if (mode === 'daemon-down') { process.stderr.write('Cannot connect to the Docker daemon\n'); return 1; }
      process.stdout.write('29.0.0-fake\n'); return 0;
    case 'image': {
      const ref = argv[argv.length - 1] ?? '';
      if (ref.startsWith('orkastery-eslint-agil:')) return construidas().includes(ref) ? 0 : 1;
      return mode === 'pull-fails' ? 1 : 0;
    }
    case 'build': {
      const tag = argv[argv.indexOf('-t') + 1];
      const dockerfile = fs.readFileSync(0, 'utf8');
      if (process.env.ORK_FAKE_DOCKER_BUILD === 'fails') {
        process.stderr.write(`${process.env.ORK_FAKE_DOCKER_BUILD_STDERR ?? 'npm ERR! network unreachable'}\n`);
        return 1;
      }
      const dir = path.dirname(process.env.ORK_FAKE_DOCKER_LOG ?? '');
      fs.writeFileSync(path.join(dir, 'ultimo-dockerfile'), dockerfile);
      fs.appendFileSync(path.join(dir, 'imagens-construidas'), `${tag}\n`);
      process.stdout.write('sha256:fake\n');
      return 0;
    }
    case 'pull': if (mode === 'pull-fails') { process.stderr.write('pull access denied\n'); return 1; } return 0;
    case 'rm': case 'kill': return 0;
    case 'run': {
      const run = parseRun(argv.slice(1));
      const found = identify(tools.filter(t => t.image === run.image || (run.image.startsWith('orkastery-eslint-agil:') && t.name === 'eslint')), run.args);
      if (!found) { process.stderr.write(`fake docker: no catalog tool for ${run.image}\n`); return 125; }
      const src = run.mounts.get('/src');
      if (!src) { process.stderr.write('fake docker: /src not mounted\n'); return 125; }
      if (process.env.ORK_FAKE_DOCKER_FAIL_COM_CACHE === found.tool.name && run.mounts.has('/tmp/trivy-cache')) {
        // N2 do CHECK 2: a ultima linha do Trivy real na trava do cache termina em `timeout`, sem ser estouro do prazo.
        process.stderr.write('FATAL\tFatal error\tinit error: cache error: unable to initialize fs cache: cache may be in use by another process: timeout\n');
        return 1;
      }
      return emulate(found.tool, found.file, found.outArg && toHost(found.outArg, run.mounts), run.args, src, false);
    }
    default: process.stderr.write(`fake docker: unknown command ${argv[0]}\n`); return 1;
  }
}

if (require.main === module) process.exit(main());
