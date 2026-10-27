import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Stack, ToolSpec } from './types';

/** Catalog location: dist/security-scan (and the package) or dist-test/src/security-scan (tests), the same two-level lookup the other readers use. */
function catalogFile(): string {
  const file = [path.join(__dirname, '..', '..', 'assets', 'security-scan', 'tools.json'),
    path.join(__dirname, '..', '..', '..', 'assets', 'security-scan', 'tools.json')].find(fs.existsSync);
  if (!file) throw Error('security-scan.catalog.unavailable');
  return file;
}

export function loadTools(): ToolSpec[] {
  return JSON.parse(fs.readFileSync(catalogFile(), 'utf8')) as ToolSpec[];
}

/**
 * RM-072 (D13): o catalogo so do Agile Check (`tools-agil.json`, ao lado do `tools.json`): `osv-scanner` e `oxlint`,
 * atras de `check.agile.osv_scanner` e `check.agile.oxlint`. O Classic nunca le este arquivo.
 */
export function loadAgileTools(): ToolSpec[] {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(catalogFile()), 'tools-agil.json'), 'utf8')) as ToolSpec[];
}

/** The tools that run for at least one of the stacks (`all` tools always run). */
export function toolsFor(stacks: Stack[], tools: ToolSpec[] = loadTools()): ToolSpec[] {
  return tools.filter(t => t.stacks === 'all' || t.stacks.some(s => stacks.includes(s)));
}
