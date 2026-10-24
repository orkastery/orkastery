export type Stack = 'js' | 'python' | 'go';
export type Category = 'secret' | 'sast' | 'dependency' | 'iac' | 'workflow' | 'quality' | 'license';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ToolState = 'ran' | 'failed' | 'unavailable';
export type FindingStatus = 'new' | 'existing' | 'dismissed';
export type Executor = 'docker' | 'native';
export type BaseMode = 'worktree' | 'native-baseline' | 'commit-range';

/**
 * One catalog entry (core/assets/security-scan/tools.json). `args` is the full argv, binary included; the container
 * runs it with the image entrypoint overridden by args[0] (or `containerBin`), as a non-root user, with the repository
 * mounted read-only at {src} (the container working directory) and a writable output directory at {out}. Placeholders
 * substituted by the executor, inside any argument (and only these names):
 *   {src}      repository root (HEAD or the temporary base worktree) inside the container
 *   {out}      output directory for the tool's report files
 *   {base}     base commit sha (Gitleaks git scan range; only `commit-range` tools use it)
 *   {config}   tool config: project `.ork-security/<file>` or the embedded default in `defaults/`
 *   {install}  the `install` list, space separated (pinned packages installed inside the container); present iff `install` is set
 *   {stackDir} directory of the detected stack relative to {src}, '.' at the root (monorepo: `core` for core/package.json);
 *              every per-stack tool uses it and runs once per detected (stack, dir) pair. Tools that read the whole tree
 *              (Gitleaks, Trivy, zizmor, actionlint) run once at the root. Paths in a per-stack tool output are relative
 *              to {stackDir} or absolute under {src}; the normalizer makes them relative to the repository root.
 * `version` is the version of the tool the entry runs (for a tool installed inside a generic image, the installed
 * package; for npm-audit, the npm shipped in the node image), not of the image.
 * Semgrep runs on the HEAD tree and on the base worktree like the others (baseMode 'worktree'): `--baseline-commit`
 * needs `git reset --hard` and the mount is read-only.
 *
 * Failure contract (enforced by the executor in Task 7 and the normalizers in Task 6): a tool is `ran` only when the
 * process exits 0 AND every file in `expect.files` exists, parses as JSON of `expect.shape` ('stream' is a sequence of
 * JSON values, as govulncheck emits), carries every `expect.requireKey` and none of `expect.failIfKey` with a non-empty
 * value (npm audit `error`, Semgrep `errors`). `expect.tolerate` lets entries of one `failIfKey` list through when every
 * entry has that `level` and one of those `types` (Semgrep warn-level `Timeout` and `PartialParsing`: one rule or one
 * fragment of one file was skipped, the rest was scanned); the tool is then `ran` with the reason `partial-<type>: <n>`
 * and its findings count. Any other entry keeps the tool `failed`. Anything else is `failed`, never clean. Wrappers exit non-zero (3, or 4 for
 * "nothing to scan") instead of masking a tool's exit code 1 when the output is not the expected JSON.
 */
export interface ToolSpec {
  name: string; category: Category; stacks: Stack[] | 'all'; image: string; version: string;
  native?: { bin: string; versionArgs: string[]; versionPattern: string };
  network: 'none' | 'default'; baseMode: BaseMode; timeoutMs: number;
  severityMap?: Record<string, Severity>;
  /** Command template used when there is no `argsByStack` variant for the stack; empty when every stack has a variant. */
  args: string[];
  /** Per-stack variant of `args` (Semgrep rulesets); the executor picks `argsByStack[stack] ?? args`. */
  argsByStack?: Partial<Record<Stack, string[]>>;
  /** Binary path inside the image when it is not on PATH (Ruff: /ruff); replaces args[0] in the container only. */
  containerBin?: string;
  /** Further invocations of the same tool in the same run (Gitleaks `git` scan next to the `dir` scan). */
  extraArgs?: string[][];
  /** Exact `pkg@version` list installed inside a generic image, with install scripts disabled; never on the host. */
  install?: string[];
  /** Environment for the container (writable HOME and caches for a non-root user). */
  env?: Record<string, string>;
  /** When set, the executor writes the tool stdout to `{out}/<stdoutFile>` instead of the tool doing it. */
  stdoutFile?: string;
  /**
   * RM-072 (D10): persistent cache directories mounted read-write in the container (the Trivy database), set only by the
   * Agile Check spec (`agil.ts`); the catalog never carries it, so the Classic container keeps the tmpfs-only `/tmp`.
   */
  cacheMounts?: Array<{ host: string; container: string }>;
  /** Output validity contract, see the failure contract above; file names are relative to {out}. */
  expect: {
    files: string[]; shape: 'array' | 'object' | 'stream'; failIfKey?: string[]; requireKey?: string[];
    tolerate?: { key: string; level: string; types: string[] };
  };
}
export interface RawFinding {
  tool: string; rule: string; category: Category; severity: Severity; stack?: Stack;
  file: string; line?: number; message: string; snippet: string; reachable?: boolean;
}
export interface Finding extends Omit<RawFinding, 'snippet'> { fingerprint: string; status: FindingStatus; loop: boolean }
export interface ToolRun {
  name: string; category: Category; version: string; executor: Executor | null; state: ToolState; reason?: string;
  counts: Record<FindingStatus, Record<Severity, number>>;
}
export interface ScanReport {
  schema: 'ork.security-scan/v1'; base: string; head: string; generatedAt: string;
  stacks: Stack[]; tools: ToolRun[]; excluded: string[]; findings: Finding[];
  /** RM-072 (D9): only in an Agile Check round, the mode and each Agile piece (ran, or fell back to the Classic one). */
  check?: { modo: 'agile'; pecas: PecaDaVarredura[] };
}

/** RM-072 (D8, D9): one piece of the Agile scan and what happened to it; `fallback` names the Classic equivalent that ran. */
export interface PecaDaVarredura { peca: string; estado: 'agile' | 'fallback'; motivo?: string; fallback?: string }

/** Categories where any new finding enters the loop. */
export const LOOP_CATEGORIES_ANY: readonly Category[] = ['secret'];
/** Categories where a new finding enters the loop at high or critical. */
export const LOOP_CATEGORIES_HIGH: readonly Category[] = ['dependency', 'sast', 'iac', 'workflow'];

/** Every loop category: the categories whose tool, unavailable or failed, leaves the loop unscanned. */
export const LOOP_CATEGORIES: readonly Category[] = [...LOOP_CATEGORIES_ANY, ...LOOP_CATEGORIES_HIGH];

export function isLoop(category: Category, severity: Severity): boolean {
  if (LOOP_CATEGORIES_ANY.includes(category)) return true;
  return LOOP_CATEGORIES_HIGH.includes(category) && (severity === 'high' || severity === 'critical');
}
