/**
 * How one catalog tool runs on this machine (spec section 5.2): its Docker image by digest when Docker answers, else
 * the native binary when its version matches `native.versionPattern`, else `unavailable` with the reason. The run of
 * one argv, in a hardened container or natively, is here too; the scan round that calls it is run.ts.
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launcherArgs, LAUNCH_TIMEOUT_SUFFIX, type RoundGuard } from './guard';
import type { Executor, ToolSpec } from './types';
import { ENV_CPUS_DOCKER, registrarContainerDaLane } from '../agendador-cpu';

export type UnavailableReason = 'docker-missing' | 'docker-daemon-down' | 'image-pull-failed' | 'binary-missing'
  | 'binary-version-mismatch' | 'disabled' | 'unsupported-ci' | 'no-requirements-file';

/** What the machine offers; `nativeVersion` is the output of `<bin> <args>` (stdout and stderr), null when it does not run. */
export interface Probe { dockerCli(): boolean; dockerDaemon(): boolean; nativeVersion(bin: string, args: string[]): string | null }

const PROBE_TIMEOUT_MS = 20000;

/** The probe of this machine, through the PATH. Each answer is computed once per probe. */
export function defaultProbe(): Probe {
  const memo = new Map<string, unknown>();
  const once = <T>(key: string, f: () => T): T => { if (!memo.has(key)) memo.set(key, f()); return memo.get(key) as T; };
  const ok = (cmd: string, args: string[]): boolean => {
    const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS });
    return !r.error && r.status === 0;
  };
  return {
    dockerCli: () => once('cli', () => ok('docker', ['--version'])),
    dockerDaemon: () => once('daemon', () => ok('docker', ['info', '--format', '{{.ServerVersion}}'])),
    nativeVersion: (bin, args) => once(`native:${bin} ${args.join(' ')}`, () => {
      const r = spawnSync(bin, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
      return r.error || r.status !== 0 ? null : `${r.stdout ?? ''}${r.stderr ?? ''}`;
    }),
  };
}

/**
 * Docker → native → unavailable. Without a usable Docker, the native binary runs when its version matches
 * `native.versionPattern`; a binary answering another version is `binary-version-mismatch`; otherwise (no native entry,
 * or the binary absent) the reason is Docker's own, `docker-missing` or `docker-daemon-down`: Docker is the path the
 * catalog pins. A tool whose wrapper installs pinned packages (`install`) never runs natively: nothing installs on the
 * host. `binary-missing` stays in the type for the doctor (Task 9) and is not produced here.
 */
export function chooseExecutor(tool: ToolSpec, probe: Probe): { kind: Executor } | { kind: 'unavailable'; reason: UnavailableReason } {
  const cli = probe.dockerCli();
  if (cli && probe.dockerDaemon()) return { kind: 'docker' };
  const dockerReason: UnavailableReason = cli ? 'docker-daemon-down' : 'docker-missing';
  if (!tool.native || tool.install) return { kind: 'unavailable', reason: dockerReason };
  const out = probe.nativeVersion(tool.native.bin, tool.native.versionArgs);
  if (out === null) return { kind: 'unavailable', reason: dockerReason };
  return new RegExp(tool.native.versionPattern, 'm').test(out) ? { kind: 'native' } : { kind: 'unavailable', reason: 'binary-version-mismatch' };
}

/** The version string the native binary reports (the `versionPattern` match). */
export function nativeVersionOf(tool: ToolSpec, probe: Probe): string {
  const out = tool.native ? probe.nativeVersion(tool.native.bin, tool.native.versionArgs) : null;
  return (out && tool.native && new RegExp(tool.native.versionPattern, 'm').exec(out)?.[0]) || tool.version;
}

/** Embedded tool configs (`{config}`), next to the catalog; dist/security-scan or dist-test/src/security-scan. */
export function defaultsDir(): string {
  const dir = [path.join(__dirname, '..', '..', 'assets', 'security-scan', 'defaults'),
    path.join(__dirname, '..', '..', '..', 'assets', 'security-scan', 'defaults')].find(fs.existsSync);
  if (!dir) throw Error('security-scan.catalog.unavailable');
  return dir;
}

/** Config file name per tool; the project's `.ork-security/<name>` wins over the embedded default. */
export const CONFIG_FILES: Record<string, string> = { gitleaks: 'gitleaks.toml', eslint: 'eslint.config.mjs', ruff: 'ruff.toml', 'golangci-lint': '.golangci.yml' };

/** One argv to run: the tree to mount at {src}, the output dir, the placeholder values, and extra read-only mounts. */
export interface Invocation {
  tool: ToolSpec; argv: string[]; srcHost: string; outHost: string;
  base: string; stackDir: string;
  /** Host path of the tool config, or undefined when the tool takes none. */
  configHost?: string;
  /** Host paths mounted read-only at the same path in the container (the main `.git` of a worktree). */
  sameMounts?: string[];
  /** Time limit of this run: the tool `timeoutMs` capped by what is left of the round deadline. */
  timeoutMs: number;
  /** The round guard: records the container name and the native process group while they live. */
  guard?: RoundGuard;
}
export interface InvocationResult { status: number | null; timedOut: boolean; stdout: string; stderr: string }

const CONTAINER = { src: '/src', out: '/out', config: '/config' };
const MAX_BUFFER = 512 * 1024 * 1024;

/** A cota so existe no grupo Agile; sem a variavel, o Classic continua com o argv de sempre. */
export function argumentosDeCpuDoDocker(ambiente: NodeJS.ProcessEnv = process.env): string[] {
  const limite = Number(ambiente[ENV_CPUS_DOCKER]);
  return Number.isFinite(limite) && limite > 0 ? ['--cpus', String(limite)] : [];
}

export function expand(arg: string, values: Record<string, string>): string {
  return arg.replace(/\{(src|out|base|config|install|stackDir)\}/g, (_, k: string) => values[k]);
}

/** {stackDir} as an argument: a directory named `-x` would read as an option, so it goes as `./-x`. */
const stackDirArg = (dir: string): string => (dir.startsWith('-') ? `./${dir}` : dir);

/** uid:gid of the container user: the caller's (so the output dir it writes is the caller's), never root. */
function containerUser(): string {
  const uid = process.getuid?.() ?? 65534;
  return uid === 0 ? '65534:65534' : `${uid}:${process.getgid?.() ?? 65534}`;
}

/** Image present locally, else pulled within `timeoutMs`; memoized per image by the caller. */
export function ensureImage(image: string, timeoutMs: number): boolean {
  if (timeoutMs <= 0) return false;
  const present = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: Math.min(PROBE_TIMEOUT_MS, timeoutMs) });
  if (!present.error && present.status === 0) return true;
  const pull = spawnSync('docker', ['pull', '--quiet', image], { stdio: 'ignore', timeout: timeoutMs, killSignal: 'SIGKILL' });
  return !pull.error && pull.status === 0;
}

/**
 * Runs one argv in the tool's image: digest, `--rm`, non-root `--user`, repository at /src read-only, the output dir at
 * /out, embedded or project config read-only, a tmpfs /tmp, `--network none` when catalogued, only the catalog `env`
 * (nothing of the host environment), and a `--name` so a timed-out container is removed (`docker rm -f`), since killing
 * the CLI leaves the container running.
 */
export function runDocker(inv: Invocation): InvocationResult {
  const { tool } = inv;
  const name = `ork-security-scan-${tool.name}-${crypto.randomBytes(6).toString('hex')}`;
  const configCtr = inv.configHost ? `${CONTAINER.config}/${path.basename(inv.configHost)}` : '';
  if (process.getuid?.() === 0) fs.chmodSync(inv.outHost, 0o777);
  const values = { src: CONTAINER.src, out: CONTAINER.out, base: inv.base, config: configCtr, install: (tool.install ?? []).join(' '), stackDir: stackDirArg(inv.stackDir) };
  const args = ['run', '--rm', '--name', name, '--pull', 'never', '--user', containerUser(),
    ...argumentosDeCpuDoDocker(),
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    ...(tool.network === 'none' ? ['--network', 'none'] : []),
    '--tmpfs', '/tmp:exec,mode=1777',
    '-v', `${inv.srcHost}:${CONTAINER.src}:ro`, '-v', `${inv.outHost}:${CONTAINER.out}`,
    ...(inv.configHost ? ['-v', `${inv.configHost}:${configCtr}:ro`] : []),
    ...(inv.sameMounts ?? []).flatMap(m => ['-v', `${m}:${m}:ro`]),
    ...(tool.cacheMounts ?? []).flatMap(m => ['-v', `${m.host}:${m.container}`]),
    '-w', CONTAINER.src,
    ...Object.entries(tool.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '--entrypoint', tool.containerBin ?? inv.argv[0], tool.image,
    ...inv.argv.slice(1).map(a => expand(a, values))];
  registrarContainerDaLane(name);
  inv.guard?.add('containers', name);
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: inv.timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, env: process.env });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (timedOut || r.error) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS });
  inv.guard?.remove('containers', name);
  return { status: r.status, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Runs one argv with the native binary, in the scanned tree, with the host paths in the placeholders. The host
 * environment is kept (it is the user's own binary), with the catalog `env` on top except HOME. The tool runs through
 * the launcher of guard.ts as the leader of its own process group, so the timeout kills the whole group (an `sh`
 * wrapper's grandchildren included), not only the direct child.
 */
export function runNative(inv: Invocation): InvocationResult {
  const { tool } = inv;
  const values = { src: inv.srcHost, out: inv.outHost, base: inv.base, config: inv.configHost ?? '', install: '', stackDir: stackDirArg(inv.stackDir) };
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(tool.env ?? {})) if (k !== 'HOME') env[k] = v;
  const [bin, ...rest] = inv.argv.map(a => expand(a, values));
  const pgidFile = inv.guard?.pgidFile() ?? path.join(inv.outHost, '.native.pgid');
  const marker = `${pgidFile}${LAUNCH_TIMEOUT_SUFFIX}`;
  try {
    const r = spawnSync(process.execPath, launcherArgs(pgidFile, inv.timeoutMs, bin, rest),
      { cwd: inv.srcHost, encoding: 'utf8', timeout: inv.timeoutMs + 10000, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, env });
    const timedOut = fs.existsSync(marker) || (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    return { status: r.status, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  } finally {
    fs.rmSync(marker, { force: true });
    fs.rmSync(pgidFile, { force: true });
  }
}
