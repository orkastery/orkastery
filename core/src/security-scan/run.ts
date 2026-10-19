/**
 * The scan round of `ork security-scan` (spec section 5.2): resolve the base, detect the stacks of the HEAD tree, run
 * every applicable catalog tool on the HEAD tree and on the base (a temporary detached worktree, or the cache), make
 * each output a list of RawFinding, and classify HEAD against the base. Reports are written by Task 8 (report.ts).
 *
 * Rules that hold for every tool:
 * - `unavailable` and `failed` contribute no finding and are never clean: their counts are zero and the state says why.
 * - A tool runs once per detected (stack, dir) when its command uses {stackDir} (or has `argsByStack`), else once at
 *   the root. The per-pair outcomes combine as failed > unavailable > ran.
 * - The base is the `--base` ref, else `git merge-base HEAD <remote>/<worktree.base_branch>`, else the merge-base with
 *   the local branch; unresolved, every tool is `failed`/`base-unresolved`. Base equal to HEAD is valid: the HEAD
 *   results are the base ones and every finding is `existing` (the baseline of a project adopting the scan).
 * - Gitleaks: HEAD = mergeByFingerprint(dir scan of the HEAD tree, git scan of base..HEAD); base = dir scan of the base
 *   tree. The git scan of a linked worktree mounts the main `.git` (read-only, at its own path) so that the worktree's
 *   `.git` file resolves in the container; base..HEAD with commits and "0 commits scanned" is `zero-commits-scanned`.
 * - The base results are cached as normalized RawFindings (never raw output) in
 *   `$XDG_CACHE_HOME/orkastery/security-scan/<base-sha>/<tool>-<id>[-<stack>-<dir>].json`.
 */
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { raizDoEstado } from '../estado-thread';
import { carregarManifesto } from '../manifest';
import { classify, mergeByFingerprint } from './compare';
import { loadConfig, loadDismissals, type ScanConfig } from './config';
import { detectStacks, type StackDir } from './detect';
import {
  chooseExecutor, CONFIG_FILES, defaultProbe, defaultsDir, ensureImage, nativeVersionOf, runDocker, runNative,
  type InvocationResult, type Probe, type UnavailableReason,
} from './executor';
import { NORMALIZERS } from './normalize';
import { loadTools, toolsFor } from './tools';
import type { Executor, FindingStatus, RawFinding, ScanReport, Severity, Stack, ToolRun, ToolSpec } from './types';

export type { Probe, UnavailableReason } from './executor';
export { chooseExecutor, defaultProbe } from './executor';

export interface RunScanOptions {
  root: string; stateRoot: string; base?: string; now?: () => Date; probe?: Probe;
  /** Catalog override (tests shorten `timeoutMs`); the embedded tools.json otherwise. */
  tools?: ToolSpec[];
}

type Outcome = { kind: 'ran'; findings: RawFinding[] } | { kind: 'failed' | 'unavailable'; reason: string };
interface Unit { stack?: Stack; dir: string }

const STATUSES: FindingStatus[] = ['new', 'existing', 'dismissed'];
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const GIT_TIMEOUT_MS = 60000;

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
}

function emptyCounts(): ToolRun['counts'] {
  return Object.fromEntries(STATUSES.map(s => [s, Object.fromEntries(SEVERITIES.map(v => [v, 0]))])) as ToolRun['counts'];
}

/** Base sha: `--base`, else merge-base with `<remote>/<base_branch>`, else with the local branch; null when unresolved. */
function resolveBase(root: string, stateRoot: string, ref: string | undefined): string | null {
  const commit = (r: string): string | null => git(root, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`]);
  if (ref !== undefined) return commit(ref);
  let branch = 'main'; let remote = 'origin';
  try {
    const m = carregarManifesto(stateRoot) ?? carregarManifesto(root);
    if (m) { branch = m.manifesto.worktree.base_branch || branch; remote = m.manifesto.fabrica.remoto || remote; }
  } catch { /* an invalid manifest leaves the defaults; `ork verify` reports it on its own */ }
  for (const target of [`${remote}/${branch}`, branch]) {
    if (!commit(target)) continue;
    const mb = git(root, ['merge-base', 'HEAD', target]);
    if (mb) return mb;
  }
  return null;
}

/** Detected (stack, dir) pairs adjusted by `config.stacks`: `remove` drops a stack, `add` forces it at the root. */
function stackPairs(root: string, config: ScanConfig): StackDir[] {
  const pairs = detectStacks(root).filter(p => !config.stacks.remove.includes(p.stack));
  for (const s of config.stacks.add) if (!pairs.some(p => p.stack === s)) pairs.push({ stack: s, dir: '.' });
  return pairs;
}

const usesStackDir = (t: ToolSpec): boolean => !!t.argsByStack || t.args.some(a => a.includes('{stackDir}'));
const argvFor = (t: ToolSpec, stack?: Stack): string[] => (stack && t.argsByStack?.[stack]) || t.args;

function unitsOf(t: ToolSpec, pairs: StackDir[]): Unit[] {
  if (!usesStackDir(t)) return [{ dir: '.' }];
  return pairs.filter(p => (t.stacks === 'all' || t.stacks.includes(p.stack)) && argvFor(t, p.stack).length > 0)
    .map(p => ({ stack: p.stack, dir: p.dir }));
}

const hasWorkflows = (tree: string): boolean => {
  const dir = path.join(tree, '.github', 'workflows');
  try { return fs.readdirSync(dir).some(f => /\.ya?ml$/.test(f)); } catch { return false; }
};

/** The report files one argv produces: those named in it as `{out}/<file>`, or the `stdoutFile`. */
const filesOf = (t: ToolSpec, argv: string[]): string[] =>
  t.expect.files.filter(f => argv.some(a => a.includes(`{out}/${f}`)) || t.stdoutFile === f);

const firstLine = (text: string): string => (text.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 200);
/** The last non-empty stderr line: wrappers print install noise first and the fatal message last. */
const lastLine = (text: string): string => (text.split('\n').filter(l => l.trim()).pop() ?? '').trim().slice(0, 200);
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

/** Commits Gitleaks says it read ("N commits scanned."); null when the line is absent. */
export function commitsScanned(stderr: string): number | null {
  const m = /(\d+) commits? scanned/.exec(stripAnsi(stderr));
  return m ? Number(m[1]) : null;
}

/** The temporary detached worktree of the base, created on first use and removed by `dispose`. */
class BaseTree {
  private tmp: string | null = null;
  constructor(private readonly mainRoot: string, private readonly base: string) {}
  path(): string {
    if (this.tmp) return path.join(this.tmp, 'tree');
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-security-scan-base-')));
    this.tmp = tmp;
    const tree = path.join(tmp, 'tree');
    const r = spawnSync('git', ['worktree', 'add', '--detach', tree, this.base], { cwd: this.mainRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS * 5 });
    if (r.error || r.status !== 0) throw Error(`base-worktree-failed: ${firstLine(r.stderr ?? '')}`);
    return tree;
  }
  dispose(): void {
    if (!this.tmp) return;
    git(this.mainRoot, ['worktree', 'remove', '--force', path.join(this.tmp, 'tree')]);
    git(this.mainRoot, ['worktree', 'prune']);
    fs.rmSync(this.tmp, { recursive: true, force: true });
    this.tmp = null;
  }
}

function cacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.cache'), 'orkastery', 'security-scan');
}

const sha256 = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
const slug = (dir: string): string => (dir === '.' ? 'root' : dir.replace(/[^A-Za-z0-9._-]/g, '_'));

interface Context {
  root: string; mainRoot: string; base: string; head: string; rangeCommits: number;
  probe: Probe; baseTree: BaseTree; images: Map<string, boolean>;
}

/** The scan of one tool on one tree for one unit; `extra` adds the `extraArgs` (Gitleaks git scan, HEAD only). */
function scanTree(t: ToolSpec, executor: Executor, tree: string, unit: Unit, ctx: Context, extra: boolean): { outcome: Outcome; lists: RawFinding[][] } {
  const fail = (kind: 'failed' | 'unavailable', reason: string) => ({ outcome: { kind, reason } as Outcome, lists: [] });
  const projectConfig = CONFIG_FILES[t.name] && path.join(ctx.root, '.ork-security', CONFIG_FILES[t.name]);
  const configHost = projectConfig ? (fs.existsSync(projectConfig) ? projectConfig : path.join(defaultsDir(), CONFIG_FILES[t.name])) : undefined;
  const argvs = [argvFor(t, unit.stack), ...(extra && ctx.rangeCommits > 0 ? t.extraArgs ?? [] : [])];
  const lists: RawFinding[][] = [];
  for (const argv of argvs) {
    const isGitScan = argv !== argvs[0] && t.baseMode === 'commit-range';
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-security-scan-out-'));
    try {
      const inv = {
        tool: t, argv, srcHost: tree, outHost: out, base: ctx.base, stackDir: unit.dir, configHost,
        sameMounts: isGitScan && ctx.mainRoot !== tree ? [path.join(ctx.mainRoot, '.git')] : [],
      };
      const r: InvocationResult = executor === 'docker' ? runDocker(inv) : runNative(inv);
      if (r.timedOut) return fail('failed', 'timeout');
      // actionlint exits 4 when there is no workflow to read (the HEAD precheck already caught .gitlab-ci.yml).
      if (r.status === 4 && t.category === 'workflow') { lists.push([]); continue; }
      if (r.status === 3 && /no-requirements-file/.test(r.stderr)) return fail('unavailable', 'no-requirements-file');
      if (r.status !== 0) {
        // A secret scanner's stderr is never quoted: it could carry the value.
        const detail = t.category === 'secret' ? '' : lastLine(stripAnsi(r.stderr));
        return fail('failed', `exit-${r.status ?? 'signal'}${detail ? `: ${detail}` : ''}`);
      }
      if (isGitScan) {
        const n = commitsScanned(r.stderr);
        if (!n) return fail('failed', 'zero-commits-scanned');
      }
      if (t.stdoutFile) fs.writeFileSync(path.join(out, t.stdoutFile), r.stdout, { mode: 0o600 });
      const findings: RawFinding[] = [];
      for (const file of filesOf(t, argv)) {
        const f = path.join(out, file);
        if (!fs.existsSync(f)) return fail('failed', `missing-output: ${file}`);
        const nctx = { root: executor === 'docker' ? '/src' : tree, stackDir: unit.dir };
        try {
          findings.push(...NORMALIZERS[t.name](fs.readFileSync(f, 'utf8'), nctx));
        } catch (e) {
          const msg = (e as Error).message;
          return fail('failed', msg.startsWith('security-scan.parse') || t.category !== 'secret' ? msg : 'security-scan.parse: unreadable output');
        }
      }
      lists.push(findings);
    } finally {
      // The raw output (Gitleaks keeps the secret value) never outlives the run.
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  return { outcome: { kind: 'ran', findings: lists.length > 1 ? mergeByFingerprint(lists) : lists.flat() }, lists };
}

/** Base findings of one unit: cache, else the base worktree; "nothing to scan" on the base is an empty list. */
function scanBase(t: ToolSpec, executor: Executor, unit: Unit, ctx: Context, headMain: RawFinding[]): Outcome {
  if (ctx.base === ctx.head) return { kind: 'ran', findings: headMain };
  const id = executor === 'docker' ? (t.image.split('@sha256:')[1] ?? sha256(t.image)).slice(0, 12) : sha256(nativeVersionOf(t, ctx.probe)).slice(0, 12);
  const file = path.join(cacheRoot(), ctx.base, `${t.name}-${id}${unit.stack ? `-${unit.stack}-${slug(unit.dir)}` : ''}.json`);
  const configFile = CONFIG_FILES[t.name] && path.join(ctx.root, '.ork-security', CONFIG_FILES[t.name]);
  const key = sha256(JSON.stringify({ argv: argvFor(t, unit.stack), executor, config: configFile && fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null }));
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { key?: string; findings?: RawFinding[] };
    if (cached.key === key && Array.isArray(cached.findings)) return { kind: 'ran', findings: cached.findings };
  } catch { /* absent or unreadable: scan again */ }
  const tree = ctx.baseTree.path();
  if (unit.dir !== '.' && !fs.existsSync(path.join(tree, unit.dir))) return { kind: 'ran', findings: [] };
  if (t.category === 'workflow' && !hasWorkflows(tree)) return { kind: 'ran', findings: [] };
  const { outcome } = scanTree(t, executor, tree, unit, ctx, false);
  if (outcome.kind === 'unavailable') return { kind: 'ran', findings: [] };
  if (outcome.kind === 'ran') {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, JSON.stringify({ key, findings: outcome.findings }), { mode: 0o600 });
    } catch { /* a cache that cannot be written only costs time */ }
  }
  return outcome;
}

interface ToolResult { run: ToolRun; head: RawFinding[]; base: RawFinding[] }

function scanTool(t: ToolSpec, units: Unit[], config: ScanConfig, ctx: Context): ToolResult {
  const result = (state: ToolRun['state'], executor: Executor | null, reason?: string, head: RawFinding[] = [], base: RawFinding[] = []): ToolResult => ({
    run: { name: t.name, category: t.category, version: executor === 'native' ? nativeVersionOf(t, ctx.probe) : t.version, executor, state, ...(reason ? { reason } : {}), counts: emptyCounts() },
    head, base,
  });
  if (config.tools[t.name]?.disabled) return result('unavailable', null, 'disabled' satisfies UnavailableReason);
  const choice = chooseExecutor(t, ctx.probe);
  if (choice.kind === 'unavailable') return result('unavailable', null, choice.reason);
  const executor = choice.kind;
  if (executor === 'docker') {
    if (!ctx.images.has(t.image)) ctx.images.set(t.image, ensureImage(t.image, t.timeoutMs));
    if (!ctx.images.get(t.image)) return result('unavailable', null, 'image-pull-failed' satisfies UnavailableReason);
  }
  if (t.category === 'workflow' && !hasWorkflows(ctx.root)) {
    if (fs.existsSync(path.join(ctx.root, '.gitlab-ci.yml'))) return result('unavailable', executor, 'unsupported-ci' satisfies UnavailableReason);
    return result('ran', executor); // no CI workflow at all: nothing to scan, nothing found
  }
  const outcomes: Outcome[] = []; const head: RawFinding[] = []; const base: RawFinding[] = [];
  for (const unit of units) {
    const h = scanTree(t, executor, ctx.root, unit, ctx, true);
    if (h.outcome.kind !== 'ran') { outcomes.push(h.outcome); continue; }
    let b: Outcome;
    try { b = scanBase(t, executor, unit, ctx, h.lists[0] ?? []); } catch (e) { b = { kind: 'failed', reason: firstLine((e as Error).message) }; }
    outcomes.push(b.kind === 'ran' ? h.outcome : b);
    if (b.kind === 'ran') { head.push(...h.outcome.findings); base.push(...b.findings); }
  }
  const worst = outcomes.find(o => o.kind === 'failed') ?? outcomes.find(o => o.kind === 'unavailable');
  if (worst && worst.kind !== 'ran') return result(worst.kind, executor, worst.reason);
  return result('ran', executor, undefined, head, base);
}

export function runScan(opts: RunScanOptions): ScanReport {
  const root = path.resolve(opts.root);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const config = loadConfig(root);
  const dismissals = loadDismissals(root);
  const pairs = stackPairs(root, config);
  const stacks = [...new Set(pairs.map(p => p.stack))];
  const tools = toolsFor(stacks, opts.tools ?? loadTools()).filter(t => unitsOf(t, pairs).length > 0);
  const head = git(root, ['rev-parse', 'HEAD']) ?? '';
  const base = head ? resolveBase(root, path.resolve(opts.stateRoot), opts.base) : null;
  const report: ScanReport = { schema: 'ork.security-scan/v1', base: base ?? '', head, generatedAt, stacks, tools: [], excluded: [], findings: [] };
  if (!base) {
    report.tools = tools.map(t => ({ name: t.name, category: t.category, version: t.version, executor: null,
      state: config.tools[t.name]?.disabled ? 'unavailable' : 'failed', reason: config.tools[t.name]?.disabled ? 'disabled' : 'base-unresolved', counts: emptyCounts() }));
    return report;
  }
  let mainRoot = root;
  try { mainRoot = raizDoEstado(root); } catch { /* not a linked worktree git understands: scan from the root itself */ }
  const ctx: Context = {
    root, mainRoot, base, head, rangeCommits: Number(git(root, ['rev-list', '--count', `${base}..HEAD`]) ?? 0),
    probe: opts.probe ?? defaultProbe(), baseTree: new BaseTree(mainRoot, base), images: new Map(),
  };
  const excluded = new Set<string>();
  try {
    for (const t of tools) {
      const r = scanTool(t, unitsOf(t, pairs), config, ctx);
      if (r.run.state === 'ran') {
        const c = classify(r.head, r.base, dismissals, config.exclude);
        for (const f of c.findings) r.run.counts[f.status][f.severity]++;
        report.findings.push(...c.findings);
        c.excluded.forEach(e => excluded.add(e));
      }
      report.tools.push(r.run);
    }
  } finally {
    ctx.baseTree.dispose();
  }
  report.excluded = [...excluded].sort();
  return report;
}

