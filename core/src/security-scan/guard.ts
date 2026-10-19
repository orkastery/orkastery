/**
 * Cleanup of a scan round that dies on a signal, and the process-group launcher of native tools.
 *
 * Why not SIGTERM/SIGINT handlers in the round: `runScan` is synchronous (spawnSync), and a JS signal handler only runs
 * on the event loop. Measured on Node 22: with a SIGTERM handler installed, a SIGTERM sent while spawnSync waits is
 * swallowed (the handler never runs, the process does not exit and the child keeps its full timeout). Without a
 * handler the process dies at once with 128+signal (the conventional code `ork verify`'s timeout(1) expects), but
 * skips every `finally`. So the round keeps the default signal behaviour and the cleanup lives in a REAPER: a detached
 * process (its own session, out of the group timeout(1) signals) started with the round, that watches the round's pid.
 * The round records in a state file what must not outlive it (worktrees, raw output dirs, the current container, the
 * group of the current native tool); when the round ends normally it cleans up itself and removes the state, and the
 * reaper exits; when the round's pid disappears first, the reaper does the cleanup.
 *
 * Native tools run through the LAUNCHER mode of this file: the tool starts as the leader of its own process group, and
 * the launcher kills the whole group on the timeout, on a signal to itself, and when the tool exits (no `sh` wrapper
 * grandchild survives). It writes the group id next to the reaper state so the reaper can kill it too.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface GuardState { mainRoot: string; worktrees: string[]; outDirs: string[]; containers: string[] }

const STATE = 'state.json';
const POLL_MS = 200;

/** Parent side: the state file the reaper reads, kept current by the round. */
export class RoundGuard {
  readonly dir: string;
  private readonly state: GuardState;

  constructor(mainRoot: string) {
    this.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-security-scan-guard-')));
    this.state = { mainRoot, worktrees: [], outDirs: [], containers: [] };
    this.save();
    const reaper = spawn(process.execPath, [__filename, 'reap', this.dir, String(process.pid)], { detached: true, stdio: 'ignore', env: process.env });
    reaper.unref();
  }

  private save(): void {
    const tmp = path.join(this.dir, `${STATE}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(tmp, path.join(this.dir, STATE));
  }

  add(kind: keyof Omit<GuardState, 'mainRoot'>, value: string): void { this.state[kind].push(value); this.save(); }
  remove(kind: keyof Omit<GuardState, 'mainRoot'>, value: string): void {
    this.state[kind] = this.state[kind].filter(v => v !== value); this.save();
  }
  /** File where the launcher of a native tool writes its process group id. */
  pgidFile(): string { return path.join(this.dir, `native-${process.hrtime.bigint()}.pgid`); }

  /** The round ended (normally or by an exception): everything is cleaned here, and the reaper exits on its own. */
  close(): void {
    cleanup(this.dir, this.state);
  }
}

function git(cwd: string, args: string[]): void { spawnSync('git', args, { cwd, stdio: 'ignore', timeout: 60000 }); }

function cleanup(dir: string, state: GuardState): void {
  for (const name of state.containers) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 30000 });
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.pgid')) : []) {
    const pgid = Number(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (pgid > 1) try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
  }
  for (const wt of state.worktrees) {
    git(state.mainRoot, ['worktree', 'remove', '--force', wt]);
    fs.rmSync(path.dirname(wt), { recursive: true, force: true });
  }
  if (state.worktrees.length) git(state.mainRoot, ['worktree', 'prune']);
  for (const out of state.outDirs) fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function reap(dir: string, pid: number): void {
  const timer = setInterval(() => {
    const file = path.join(dir, STATE);
    if (!fs.existsSync(file)) { clearInterval(timer); return; } // the round cleaned up itself
    if (alive(pid)) return;
    clearInterval(timer);
    let state: GuardState;
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')) as GuardState; } catch { return; }
    cleanup(dir, state);
  }, POLL_MS);
}

/** Exit code of the launcher when it killed the tool on its timeout (the parent reads it with the marker file). */
export const LAUNCH_TIMEOUT_SUFFIX = '.timeout';

function launch(pgidFile: string, timeoutMs: number, bin: string, args: string[]): void {
  const child = spawn(bin, args, { detached: true, stdio: 'inherit' });
  const kill = (): void => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } };
  child.on('error', e => { process.stderr.write(`${(e as Error).message}\n`); process.exit(127); });
  if (child.pid) fs.writeFileSync(pgidFile, String(child.pid));
  const timer = setTimeout(() => { fs.writeFileSync(`${pgidFile}${LAUNCH_TIMEOUT_SUFFIX}`, ''); kill(); }, timeoutMs);
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(s, () => { kill(); process.exit(128 + (os.constants.signals[s] ?? 15)); });
  }
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    kill(); // background processes the tool left in its group
    fs.rmSync(pgidFile, { force: true });
    process.exit(code ?? 128 + (signal ? os.constants.signals[signal] ?? 9 : 9));
  });
}

/** argv for the launcher of one native tool run. */
export function launcherArgs(pgidFile: string, timeoutMs: number, bin: string, args: string[]): string[] {
  return [__filename, 'launch', pgidFile, String(timeoutMs), bin, ...args];
}

if (require.main === module) {
  const [mode, a, b, ...rest] = process.argv.slice(2);
  if (mode === 'reap') reap(a, Number(b));
  else if (mode === 'launch') launch(a, Number(b), rest[0], rest.slice(1));
}
