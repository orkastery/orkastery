/**
 * `ork security-scan [--base <ref>] [--json]` (spec sections 5.4 and 5.5): runs the round, writes `report.json` and
 * `report.md` under `<state of the main tree>/security-scan/<head-sha>/`, prints a short summary whose last line is the path of
 * `report.md` (with `--json` it prints the ScanReport JSON instead, with no path line), and returns the exit code.
 * Environment: ORK_SECURITY_SCAN_REQUIRED=1 makes an unavailable or failed loop-category tool exit 1;
 * ORK_SECURITY_SCAN_DEADLINE_MS bounds the whole round. `ctx.estado` is the state root of the main tree (`raizDoEstado`). Invalid config or dismissals exit 1 without scanning.
 */
import { msg } from '../locale';
import { exitCodeOf, tally, writeReport } from './report';
import { runScan } from './run';

export interface ScanCliContext { raiz: string; estado: string; escrever: (t: string) => void }

export function executarSecurityScan(argv: string[], ctx: ScanCliContext): number {
  const m = msg().securityScan;
  let base: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--base' && i + 1 < argv.length && !argv[i + 1].startsWith('--')) base = argv[++i];
    else if (a.startsWith('--base=') && a.length > 7) base = a.slice(7);
    else { console.error(`${m.unknownFlag(a)}\n${m.usage}`); return 2; }
  }
  const required = process.env.ORK_SECURITY_SCAN_REQUIRED === '1';
  const deadline = Number(process.env.ORK_SECURITY_SCAN_DEADLINE_MS);
  let report;
  try {
    report = runScan({ root: ctx.raiz, stateRoot: ctx.estado, base, deadlineMs: Number.isFinite(deadline) && deadline > 0 ? deadline : undefined });
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
