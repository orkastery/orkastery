import type { RawFinding, Severity } from '../types';
import { asArray, mapSeverity, parseReport, repoPath, type NormalizeContext } from './util';

interface OsvVuln { id: string; summary?: string; database_specific?: { severity?: string } }
interface OsvGrupo { ids: string[]; max_severity?: string }
interface OsvPacote { package: { name: string; version?: string }; vulnerabilities?: OsvVuln[]; groups?: OsvGrupo[] }
interface OsvResultado { source: { path: string }; packages?: OsvPacote[] }

/** A pontuacao CVSS do grupo em severidade (as faixas do CVSS 3); sem ela, a do advisory; sem nada, o padrao. */
function severidade(grupo: OsvGrupo, vulns: OsvVuln[]): Severity {
  const nota = Number(grupo.max_severity);
  if (grupo.max_severity && Number.isFinite(nota) && nota > 0) return nota >= 9 ? 'critical' : nota >= 7 ? 'high' : nota >= 4 ? 'medium' : 'low';
  return mapSeverity('osv-scanner', vulns.map(v => v.database_specific?.severity).find(Boolean));
}

/**
 * RM-072 (D13): osv-scanner v2 (`scan source --format json`), so no Agile Check e atras de `check.agile.osv_scanner`. Um
 * achado por grupo de aliases (o mesmo problema com id do GHSA, do PYSEC ou do Go vira um so), com o primeiro id do
 * grupo como regra e o pacote como trecho, no lockfile que o resultado nomeia.
 */
export function osvScanner(output: string, ctx: NormalizeContext): RawFinding[] {
  const report = parseReport('osv-scanner', output) as { results?: OsvResultado[] };
  const out: RawFinding[] = [];
  for (const r of asArray(report.results)) {
    for (const p of asArray(r.packages)) {
      const porId = new Map(asArray(p.vulnerabilities).map(v => [v.id, v] as const));
      const grupos = asArray(p.groups).length ? asArray(p.groups) : asArray(p.vulnerabilities).map(v => ({ ids: [v.id] }));
      for (const g of grupos) {
        const vulns = g.ids.map(id => porId.get(id)).filter((v): v is OsvVuln => !!v);
        out.push({ tool: 'osv-scanner', rule: g.ids[0], category: 'dependency', severity: severidade(g, vulns),
          file: repoPath(r.source.path, ctx), message: vulns.find(v => v.summary)?.summary ?? g.ids[0], snippet: p.package.name });
      }
    }
  }
  return out;
}
