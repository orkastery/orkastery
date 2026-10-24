/**
 * `ork security-scan [--base <ref>] [--json] [--check classic|agile]` (spec sections 5.4 and 5.5): runs the round, writes `report.json` and
 * `report.md` under `<state of the main tree>/security-scan/<head-sha>/`, prints a short summary whose last line is the path of
 * `report.md` (with `--json` it prints the ScanReport JSON instead, with no path line), and returns the exit code.
 * Environment: ORK_SECURITY_SCAN_REQUIRED=1 makes an unavailable or failed loop-category tool exit 1;
 * ORK_SECURITY_SCAN_DEADLINE_MS bounds the whole round. `ctx.estado` is the state root of the main tree (`raizDoEstado`). Invalid config or dismissals exit 1 without scanning.
 * RM-072 (D9): the round is the Classic one (`runScan`) or the Agile one (`runScanAgil`, the same tools in parallel with
 * the database caches); the mode comes from `--check`, then ORK_CHECK_MODO (set by `ork verify` for its round), then the
 * manifest `check.mode`, then the default (agile).
 */
import { msg } from '../locale';
import { ENV_MODO_DO_CHECK, lerModo, MODO_PADRAO, type ModoDoCheck } from '../check-modo';
import { runScanAgil } from './agil';
import { exitCodeOf, tally, writeReport } from './report';
import { runScan } from './run';

export interface ScanCliContext { raiz: string; estado: string; escrever: (t: string) => void;
  /** RM-072 (D9): the manifest `check.mode`, when declared. */
  modoDoManifesto?: ModoDoCheck;
  /** RM-072 (D13): the manifest `check.agile.osv_scanner` and `check.agile.oxlint`, used only by the Agile round. */
  agile?: { osv_scanner?: boolean; oxlint?: boolean } }

export function executarSecurityScan(argv: string[], ctx: ScanCliContext): number {
  const m = msg().securityScan;
  let base: string | undefined;
  let json = false;
  let check: ModoDoCheck | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--check' || a.startsWith('--check=')) {
      const valor = a === '--check' ? (i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : null) : a.slice(8);
      const modo = lerModo(valor);
      if (!modo) { console.error(`${m.checkInvalido(valor)}\n${m.usage}`); return 2; }
      check = modo;
    }
    else if (a === '--base' && i + 1 < argv.length && !argv[i + 1].startsWith('--')) base = argv[++i];
    else if (a.startsWith('--base=') && a.length > 7) base = a.slice(7);
    else { console.error(`${m.unknownFlag(a)}\n${m.usage}`); return 2; }
  }
  const required = process.env.ORK_SECURITY_SCAN_REQUIRED === '1';
  const deadline = Number(process.env.ORK_SECURITY_SCAN_DEADLINE_MS);
  let report;
  try {
    const modo = check ?? lerModo(process.env[ENV_MODO_DO_CHECK]) ?? ctx.modoDoManifesto ?? MODO_PADRAO;
    const opcoes = { root: ctx.raiz, stateRoot: ctx.estado, base, deadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : undefined };
    report = modo === 'agile' ? runScanAgil({ ...opcoes, ...(ctx.agile ? { agile: ctx.agile } : {}) }) : runScan(opcoes);
  } catch (e) {
    const message = (e as Error).message;
    if (!/^security-scan\.(config-invalid|dismissal-invalid)/.test(message)) throw e;
    console.error(message);
    return 1;
  }
  const files = writeReport(ctx.estado, report);
  if (json) ctx.escrever(JSON.stringify(report, null, 2));
  else {
    const t = tally(report);
    ctx.escrever(m.summary(t.new, t.existing, t.dismissed, t.loop));
    const notRun = report.tools.filter(r => r.state !== 'ran');
    if (notRun.length) {
      ctx.escrever(m.notRunHeading);
      for (const r of notRun) ctx.escrever(m.notRun(r.name, m.states[r.state] ?? r.state, r.reason ?? ''));
    }
    ctx.escrever(files.md);
  }
  return exitCodeOf(report, required);
}
