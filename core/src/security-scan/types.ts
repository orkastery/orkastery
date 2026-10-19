export type Stack = 'js' | 'python' | 'go';
export type Category = 'secret' | 'sast' | 'dependency' | 'iac' | 'workflow' | 'quality' | 'license';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ToolState = 'ran' | 'failed' | 'unavailable';
export type FindingStatus = 'new' | 'existing' | 'dismissed';
export type Executor = 'docker' | 'native';
export type BaseMode = 'worktree' | 'native-baseline' | 'commit-range';

/**
 * One catalog entry (core/assets/security-scan/tools.json). `args` is the full argv, binary included; the container
 * runs it with the image entrypoint overridden by args[0], as a non-root user, with the repository mounted read-only
 * at {src} (the container working directory) and a writable output directory at {out}. Placeholders substituted by
 * the executor, inside any argument:
 *   {src}     repository root (HEAD or the temporary base worktree) inside the container
 *   {out}     output directory for the tool's report files
 *   {base}    base commit sha (Semgrep --baseline-commit, Gitleaks log-opts range)
 *   {config}  tool config: project `.ork-security/<file>` or the embedded default in `defaults/`
 *   {install} the `install` list, space separated (pinned packages installed inside the container)
 */
export interface ToolSpec {
  name: string; category: Category; stacks: Stack[] | 'all'; image: string; version: string;
  native?: { bin: string; versionArgs: string[]; versionPattern: string };
  network: 'none' | 'default'; baseMode: BaseMode; timeoutMs: number;
  severityMap?: Record<string, Severity>;
  /** Command template; replaced by `argsByStack[stack]` when the tool has a variant for that stack. */
  args: string[];
  /** Per-stack variant of `args` (Semgrep rulesets). A stack without a variant uses `args`. */
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
  /** Exit codes that mean "ran" (findings found is not an error); default [0]. */
  okExitCodes?: number[];
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
}

/** Categories where any new finding enters the loop. */
export const LOOP_CATEGORIES_ANY: readonly Category[] = ['secret'];
/** Categories where a new finding enters the loop at high or critical. */
export const LOOP_CATEGORIES_HIGH: readonly Category[] = ['dependency', 'sast', 'iac', 'workflow'];

export function isLoop(category: Category, severity: Severity): boolean {
  if (LOOP_CATEGORIES_ANY.includes(category)) return true;
  return LOOP_CATEGORIES_HIGH.includes(category) && (severity === 'high' || severity === 'critical');
}
