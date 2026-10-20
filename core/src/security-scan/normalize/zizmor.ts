import type { RawFinding } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface ZizmorLocation {
  symbolic?: { key?: { Local?: { given_path?: string; verbatim_path?: string } }; annotation?: string; kind?: string };
  concrete?: { location?: { start_point?: { row?: number } }; feature?: string };
}
interface ZizmorFinding {
  ident: string; desc?: string; ignored?: boolean; determinations?: { severity?: string }; locations?: ZizmorLocation[];
}

/** zizmor JSON (`--format json`). Rows are 0-based in the report, lines are 1-based here; the primary location wins. */
export function zizmor(output: string, ctx: NormalizeContext): RawFinding[] {
  const list = parseReport('zizmor', output) as ZizmorFinding[];
  return list.filter(z => !z.ignored).map(z => {
    const loc = asArray(z.locations).find(l => l.symbolic?.kind === 'Primary') ?? asArray(z.locations)[0];
    const local = loc?.symbolic?.key?.Local;
    const row = loc?.concrete?.location?.start_point?.row;
    return {
      tool: 'zizmor', rule: z.ident, category: 'workflow', severity: mapSeverity('zizmor', z.determinations?.severity),
      file: repoPath(local?.verbatim_path ?? local?.given_path ?? '', ctx), line: row === undefined ? undefined : row + 1,
      message: [z.desc, loc?.symbolic?.annotation].filter(Boolean).join(': ') || z.ident,
      snippet: loc?.concrete?.feature ?? z.desc ?? z.ident,
    };
  });
}
