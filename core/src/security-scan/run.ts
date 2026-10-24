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
 *   `$XDG_CACHE_HOME/orkastery/security-scan/<base-sha>/<tool>-<id>[-<stack>-<dir>].json`, keyed by the whole ToolSpec,
 *   the resolved tool config content and SCAN_CACHE_VERSION.
 * - HEAD is scanned from a detached worktree of the HEAD commit, like the base: only committed content is scanned
 *   (uncommitted or ignored files, node_modules, .env, are not), and `.ork-security/` is read from that tree. The report
 *   carries the HEAD sha, which is what `ork verify` and `ork ship` prove. A scan started from a subdirectory scans the
 *   repository (`git rev-parse --show-toplevel`).
 * - `deadlineMs` bounds the whole round: each process gets the tool `timeoutMs` capped by the time left, and once it is
 *   spent the remaining units are `failed`/`timeout` without running. A round killed by a signal is cleaned up by the
 *   reaper of guard.ts (worktrees, raw output dirs, the running container, the native process group).
 * - A failure on the base side carries the `base-` prefix (`base-timeout`, `base-exit-2: ...`).
 * - Errors the catalog tolerates (`expect.tolerate`: Semgrep warn-level Timeout and PartialParsing) leave the tool
 *   `ran` with the HEAD reason `partial-timeout: <n>` / `partial-parsing: <n>`; the findings obtained count.
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
import { detectStacks, hasStackManifest, type StackDir } from './detect';
import {
  chooseExecutor, CONFIG_FILES, defaultProbe, defaultsDir, ensureImage, nativeVersionOf, runDocker, runNative,
  type InvocationResult, type Probe, type UnavailableReason,
} from './executor';
import { RoundGuard } from './guard';
import { NORMALIZERS, partialOf } from './normalize';
import { loadTools, toolsFor } from './tools';
import type { Executor, FindingStatus, RawFinding, ScanReport, Severity, Stack, ToolRun, ToolSpec } from './types';

export type { Probe, UnavailableReason } from './executor';
export { chooseExecutor, defaultProbe } from './executor';

export interface RunScanOptions {
  root: string; stateRoot: string; base?: string; now?: () => Date; probe?: Probe;
  /** Catalog override (tests shorten `timeoutMs`); the embedded tools.json otherwise. */
  tools?: ToolSpec[];
  /** Total time budget of the round in ms (the CLI reads ORK_SECURITY_SCAN_DEADLINE_MS); unbounded when absent. */
  deadlineMs?: number;
  /** RM-072 (D13): the Agile-only tools behind the manifest flags; `runScan` (Classic) never reads it. */
  agile?: { osv_scanner?: boolean; oxlint?: boolean };
}

/** Version of the normalized cache content; bump when a normalizer or the RawFinding shape changes. */
export const SCAN_CACHE_VERSION = 1;

/** `reason` on `ran` is the tolerated partial coverage (`partial-timeout: 2`), see `expect.tolerate`. */
type Outcome = { kind: 'ran'; findings: RawFinding[]; reason?: string } | { kind: 'failed' | 'unavailable'; reason: string };
/** `forced`: the pair comes from `config.stacks.add` (root, no manifest needed), not from detection. */
export interface Unit { stack?: Stack; dir: string; forced?: boolean }

const STATUSES: FindingStatus[] = ['new', 'existing', 'dismissed'];
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const GIT_TIMEOUT_MS = 60000;

export function git(cwd: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  return r.error || r.status !== 0 ? null : r.stdout.trim();
}

export function emptyCounts(): ToolRun['counts'] {
  return Object.fromEntries(STATUSES.map(s => [s, Object.fromEntries(SEVERITIES.map(v => [v, 0]))])) as ToolRun['counts'];
}

/** Base sha: `--base`, else merge-base with `<remote>/<base_branch>`, else with the local branch; null when unresolved. */
export function resolveBase(root: string, stateRoot: string, ref: string | undefined): string | null {
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
export function stackPairs(root: string, config: ScanConfig): Array<StackDir & { forced?: boolean }> {
  const pairs: Array<StackDir & { forced?: boolean }> = detectStacks(root).filter(p => !config.stacks.remove.includes(p.stack));
  for (const s of config.stacks.add) if (!pairs.some(p => p.stack === s)) pairs.push({ stack: s, dir: '.', forced: true });
  return pairs;
}

const usesStackDir = (t: ToolSpec): boolean => !!t.argsByStack || t.args.some(a => a.includes('{stackDir}'));
const argvFor = (t: ToolSpec, stack?: Stack): string[] => (stack && t.argsByStack?.[stack]) || t.args;

export function unitsOf(t: ToolSpec, pairs: Array<StackDir & { forced?: boolean }>): Unit[] {
  if (!usesStackDir(t)) return [{ dir: '.' }];
  return pairs.filter(p => (t.stacks === 'all' || t.stacks.includes(p.stack)) && argvFor(t, p.stack).length > 0)
    .map(p => ({ stack: p.stack, dir: p.dir, ...(p.forced ? { forced: true } : {}) }));
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

/** A detached worktree of `sha` from the main repository, registered in the guard (removed by `guard.close()`). */
export function checkout(mainRoot: string, sha: string, guard: RoundGuard): string {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-security-scan-tree-')));
  const tree = path.join(tmp, 'tree');
  guard.add('worktrees', tree);
  const r = spawnSync('git', ['worktree', 'add', '--detach', tree, sha], { cwd: mainRoot, encoding: 'utf8', timeout: GIT_TIMEOUT_MS * 5 });
  if (r.error || r.status !== 0) throw Error(`worktree-failed: ${firstLine(r.stderr ?? '')}`);
  return tree;
}

export function cacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.cache'), 'orkastery', 'security-scan');
}

const sha256 = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
const slug = (dir: string): string => (dir === '.' ? 'root' : dir.replace(/[^A-Za-z0-9._-]/g, '_'));

export interface Context {
  /** Detached worktree of the HEAD commit, where every HEAD scan runs. */
  headTree: string; mainRoot: string; base: string; head: string;
  /** Commits in base..HEAD; null when git could not count them. */
  rangeCommits: number | null;
  /** Whether `git log -p` of base..HEAD has patch content; computed on first use (see `rangeHasPatch`). */
  rangePatch?: boolean;
  probe: Probe; guard: RoundGuard; images: Map<string, boolean>; deadline: number;
  baseTree?: string;
}

const remaining = (ctx: Context): number => ctx.deadline - Date.now();

/**
 * Whether base..HEAD has any patch content for Gitleaks to read. A range of merges without conflict resolution, empty
 * commits or pure renames has none, and Gitleaks then reports 0 commits scanned with nothing skipped. A git error
 * (including output too large for the buffer) counts as content: the strict reading keeps `zero-commits-scanned`.
 */
function rangeHasPatch(ctx: Context): boolean {
  if (ctx.rangePatch === undefined) {
    const out = git(ctx.mainRoot, ['log', '-p', '--format=', `${ctx.base}..${ctx.head}`]);
    ctx.rangePatch = out === null || out !== '';
  }
  return ctx.rangePatch;
}

/** Host path of the tool config: the project's `.ork-security/<file>` in the HEAD tree, else the embedded default. */
function configOf(t: ToolSpec, ctx: Context): string | undefined {
  const name = CONFIG_FILES[t.name];
  if (!name) return undefined;
  const project = path.join(ctx.headTree, '.ork-security', name);
  return fs.existsSync(project) ? project : path.join(defaultsDir(), name);
}

/** The scan of one tool on one tree for one unit; `extra` adds the `extraArgs` (Gitleaks git scan, HEAD only). */
function scanTree(t: ToolSpec, executor: Executor, tree: string, unit: Unit, ctx: Context, extra: boolean): { outcome: Outcome; lists: RawFinding[][] } {
  const fail = (kind: 'failed' | 'unavailable', reason: string) => ({ outcome: { kind, reason } as Outcome, lists: [] });
  const configHost = configOf(t, ctx);
  const rangeArgs = extra ? t.extraArgs ?? [] : [];
  if (rangeArgs.length && ctx.rangeCommits === null) return fail('failed', 'commit-range-unresolved');
  const argvs = [argvFor(t, unit.stack), ...(ctx.rangeCommits ? rangeArgs : [])];
  const lists: RawFinding[][] = [];
  const partial: string[] = [];
  for (const argv of argvs) {
    const timeoutMs = Math.min(t.timeoutMs, remaining(ctx));
    if (timeoutMs <= 0) return fail('failed', 'timeout');
    const isGitScan = argv !== argvs[0] && t.baseMode === 'commit-range';
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-security-scan-out-'));
    ctx.guard.add('outDirs', out);
    try {
      const inv = {
        tool: t, argv, srcHost: tree, outHost: out, base: ctx.base, stackDir: unit.dir, configHost, timeoutMs, guard: ctx.guard,
        // The tree is a linked worktree: its `.git` file points into the main `.git`, mounted at its own path.
        sameMounts: isGitScan ? [path.join(ctx.mainRoot, '.git')] : [],
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
      if (isGitScan && !commitsScanned(r.stderr) && rangeHasPatch(ctx)) return fail('failed', 'zero-commits-scanned');
      if (t.stdoutFile) fs.writeFileSync(path.join(out, t.stdoutFile), r.stdout, { mode: 0o600 });
      const findings: RawFinding[] = [];
      for (const file of filesOf(t, argv)) {
        const f = path.join(out, file);
        if (!fs.existsSync(f)) return fail('failed', `missing-output: ${file}`);
        const nctx = { root: executor === 'docker' ? '/src' : tree, stackDir: unit.dir };
        try {
          const content = fs.readFileSync(f, 'utf8');
          findings.push(...NORMALIZERS[t.name](content, nctx));
          const p = partialOf(t.name, content);
          if (p) partial.push(p);
        } catch (e) {
          const msg = (e as Error).message;
          return fail('failed', msg.startsWith('security-scan.parse') || t.category !== 'secret' ? msg : 'security-scan.parse: unreadable output');
        }
      }
      lists.push(findings);
    } finally {
      // The raw output (Gitleaks keeps the secret value) never outlives the run.
      fs.rmSync(out, { recursive: true, force: true });
      ctx.guard.remove('outDirs', out);
    }
  }
  const findings = lists.length > 1 ? mergeByFingerprint(lists) : lists.flat();
  return { outcome: { kind: 'ran', findings, ...(partial.length ? { reason: partial.join('; ') } : {}) }, lists };
}

/** Base findings of one unit: cache, else the base worktree; "nothing to scan" on the base is an empty list. */
function scanBase(t: ToolSpec, executor: Executor, unit: Unit, ctx: Context, headMain: RawFinding[]): Outcome {
  if (ctx.base === ctx.head) return { kind: 'ran', findings: headMain };
  const nativeVersion = executor === 'native' ? nativeVersionOf(t, ctx.probe) : '';
  const id = executor === 'docker' ? (t.image.split('@sha256:')[1] ?? sha256(t.image)).slice(0, 12) : sha256(nativeVersion).slice(0, 12);
  const file = path.join(cacheRoot(), ctx.base, `${t.name}-${id}${unit.stack ? `-${unit.stack}-${slug(unit.dir)}` : ''}.json`);
  const configHost = configOf(t, ctx);
  const key = sha256(JSON.stringify({ version: SCAN_CACHE_VERSION, tool: t, executor, nativeVersion, unit,
    config: configHost ? fs.readFileSync(configHost, 'utf8') : null }));
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { key?: string; findings?: RawFinding[] };
    if (cached.key === key && Array.isArray(cached.findings)) return { kind: 'ran', findings: cached.findings };
  } catch { /* absent or unreadable: scan again */ }
  ctx.baseTree ??= checkout(ctx.mainRoot, ctx.base, ctx.guard);
  const tree = ctx.baseTree;
  if (unit.dir !== '.' && !fs.existsSync(path.join(tree, unit.dir))) return { kind: 'ran', findings: [] };
  if (t.category === 'workflow' && !hasWorkflows(tree)) return { kind: 'ran', findings: [] };
  // A detected stack whose manifest is absent from the base at that dir (a project adopting it, or moving it, in this
  // change): nothing to scan on the base, not a failure. A stack forced by `config.stacks.add` has no manifest by design
  // and is always scanned. A manifest moved from `a/` to `b/` leaves `b/` empty on the base, so its findings are `new`.
  if (unit.stack && !unit.forced && !hasStackManifest(tree, unit.stack, unit.dir)) return { kind: 'ran', findings: [] };
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

export interface ToolResult { run: ToolRun; head: RawFinding[]; base: RawFinding[] }

/**
 * RM-072 (D9): o trabalho de uma ferramenta na varredura do Agile, como vai ao trabalhador em JSON: a ferramenta, as
 * unidades, a config e o contexto sem o que nao atravessa processo (o probe, o guarda e o mapa de imagens), com o prazo
 * absoluto (`null` sem prazo).
 */
export interface TrabalhoDaFerramenta {
  tool: ToolSpec; units: Unit[]; config: ScanConfig;
  /** RM-072 (D12): o binario nativo desta ferramenta esta na maquina com a versao do catalogo; o Agile o usa antes do Docker. */
  nativoPrimeiro?: boolean;
  ctx: Omit<Context, 'probe' | 'guard' | 'images' | 'deadline' | 'rangePatch'> & { deadline: number | null };
}

const DOCKER_OFF = (p: Probe): Probe => ({ ...p, dockerCli: () => false, dockerDaemon: () => false });

export function scanTool(t: ToolSpec, units: Unit[], config: ScanConfig, ctx: Context): ToolResult {
  const result = (state: ToolRun['state'], executor: Executor | null, reason?: string, head: RawFinding[] = [], base: RawFinding[] = []): ToolResult => ({
    run: { name: t.name, category: t.category, version: executor === 'native' ? nativeVersionOf(t, ctx.probe) : t.version, executor, state, ...(reason ? { reason } : {}), counts: emptyCounts() },
    head, base,
  });
  if (config.tools[t.name]?.disabled) return result('unavailable', null, 'disabled' satisfies UnavailableReason);
  const choice = chooseExecutor(t, ctx.probe);
  if (choice.kind === 'unavailable') return result('unavailable', null, choice.reason);
  let executor: Executor = choice.kind;
  if (executor === 'docker') {
    if (!ctx.images.has(t.image)) ctx.images.set(t.image, ensureImage(t.image, Math.min(t.timeoutMs, remaining(ctx))));
    if (!ctx.images.get(t.image)) {
      // Docker -> native -> unavailable (spec 5.2.1): an image that cannot be pulled falls back to the native binary.
      const native = chooseExecutor(t, DOCKER_OFF(ctx.probe));
      if (native.kind !== 'native') {
        return result(remaining(ctx) <= 0 ? 'failed' : 'unavailable', null, remaining(ctx) <= 0 ? 'timeout' : 'image-pull-failed' satisfies UnavailableReason);
      }
      executor = 'native';
    }
  }
  if (t.category === 'workflow' && !hasWorkflows(ctx.headTree)) {
    if (fs.existsSync(path.join(ctx.headTree, '.gitlab-ci.yml'))) return result('unavailable', executor, 'unsupported-ci' satisfies UnavailableReason);
    return result('ran', executor); // no CI workflow at all: nothing to scan, nothing found
  }
  const outcomes: Outcome[] = []; const head: RawFinding[] = []; const base: RawFinding[] = []; const partial: string[] = [];
  for (const unit of units) {
    const h = scanTree(t, executor, ctx.headTree, unit, ctx, true);
    if (h.outcome.kind !== 'ran') { outcomes.push(h.outcome); continue; }
    let b: Outcome;
    try { b = scanBase(t, executor, unit, ctx, h.lists[0] ?? []); } catch (e) { b = { kind: 'failed', reason: firstLine((e as Error).message) }; }
    if (b.kind === 'ran') {
      outcomes.push(h.outcome); head.push(...h.outcome.findings); base.push(...b.findings);
      // Partial coverage of the HEAD scan is reported; on the base it only makes HEAD findings `new` (stricter).
      if (h.outcome.reason) partial.push(h.outcome.reason);
    }
    else outcomes.push({ kind: b.kind, reason: `base-${b.reason}` });
  }
  const worst = outcomes.find(o => o.kind === 'failed') ?? outcomes.find(o => o.kind === 'unavailable');
  if (worst && worst.kind !== 'ran') return result(worst.kind, executor, worst.reason);
  return result('ran', executor, partial.join('; ') || undefined, head, base);
}

export const failedAll = (tools: ToolSpec[], config: ScanConfig, reason: string): ToolRun[] => tools.map(t => ({
  name: t.name, category: t.category, version: t.version, executor: null,
  state: config.tools[t.name]?.disabled ? 'unavailable' : 'failed', reason: config.tools[t.name]?.disabled ? 'disabled' : reason, counts: emptyCounts(),
}));

export function runScan(opts: RunScanOptions): ScanReport {
  const start = path.resolve(opts.root);
  const root = git(start, ['rev-parse', '--show-toplevel']) ?? start;
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const head = git(root, ['rev-parse', 'HEAD']) ?? '';
  let mainRoot = root;
  try { mainRoot = raizDoEstado(root); } catch { /* not a linked worktree git understands: use the root itself */ }
  const report: ScanReport = { schema: 'ork.security-scan/v1', base: '', head, generatedAt, stacks: [], tools: [], excluded: [], findings: [] };
  const catalog = opts.tools ?? loadTools();
  if (!head) {
    // No commit to scan: nothing is checked out; stacks and config come from the directory as it is.
    const config = loadConfig(root);
    const pairs = stackPairs(root, config);
    report.stacks = [...new Set(pairs.map(p => p.stack))];
    report.tools = failedAll(toolsFor(report.stacks, catalog).filter(t => unitsOf(t, pairs).length > 0), config, 'base-unresolved');
    return report;
  }
  const guard = new RoundGuard(mainRoot);
  try {
    let headTree: string;
    try { headTree = checkout(mainRoot, head, guard); } catch (e) {
      const config = loadConfig(root);
      const pairs = stackPairs(root, config);
      report.stacks = [...new Set(pairs.map(p => p.stack))];
      report.tools = failedAll(toolsFor(report.stacks, catalog).filter(t => unitsOf(t, pairs).length > 0), config, `head-${firstLine((e as Error).message)}`);
      return report;
    }
    const config = loadConfig(headTree);
    const dismissals = loadDismissals(headTree);
    const pairs = stackPairs(headTree, config);
    report.stacks = [...new Set(pairs.map(p => p.stack))];
    const tools = toolsFor(report.stacks, catalog).filter(t => unitsOf(t, pairs).length > 0);
    const base = resolveBase(root, path.resolve(opts.stateRoot), opts.base);
    if (!base) { report.tools = failedAll(tools, config, 'base-unresolved'); return report; }
    report.base = base;
    const count = git(root, ['rev-list', '--count', `${base}..${head}`]);
    const ctx: Context = {
      headTree, mainRoot, base, head, rangeCommits: count === null ? null : Number(count),
      probe: opts.probe ?? defaultProbe(), guard, images: new Map(),
      deadline: opts.deadlineMs === undefined ? Infinity : Date.now() + opts.deadlineMs,
      baseTree: base === head ? headTree : undefined,
    };
    const excluded = new Set<string>();
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
    report.excluded = [...excluded].sort();
    return report;
  } finally {
    guard.close();
  }
}
