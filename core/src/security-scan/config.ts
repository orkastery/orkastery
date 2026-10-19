import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadTools } from './tools';
import type { Stack } from './types';

export interface Dismissal {
  fingerprint: string; tool: string; rule: string; file: string; reason: string; decidedBy: string; decisionRef: string; date: string;
}
export interface ScanConfig { exclude: string[]; tools: Record<string, { disabled?: string; version?: string }>; stacks: { add: Stack[]; remove: Stack[] } }

function readJson(root: string, name: string): unknown {
  const file = path.join(root, '.ork-security', name);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw Error(`security-scan.config-invalid: ${name}: ${(e as Error).message}`); }
}

const strings = (v: unknown, name: string, field: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw Error(`security-scan.config-invalid: ${name}: ${field} must be a list of strings`);
  return v as string[];
};

/** `.ork-security/config.json` under `root`; absent means empty defaults. */
export function loadConfig(root: string): ScanConfig {
  const raw = readJson(root, 'config.json');
  if (raw === undefined) return { exclude: [], tools: {}, stacks: { add: [], remove: [] } };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw Error('security-scan.config-invalid: config.json: expected an object');
  const c = raw as { exclude?: unknown; tools?: Record<string, { disabled?: string; version?: string }>; stacks?: { add?: unknown; remove?: unknown } };
  // Swapping a tool version is not supported in this version: a declared version other than the catalog's is an error,
  // never silently ignored (the scan would claim a version it did not run).
  const catalog = new Map(loadTools().map(t => [t.name, t.version]));
  for (const [name, t] of Object.entries(c.tools ?? {})) {
    if (t?.version !== undefined && t.version !== catalog.get(name)) throw Error(`security-scan.config-invalid: tools.${name}.version`);
  }
  return {
    exclude: strings(c.exclude, 'config.json', 'exclude'),
    tools: c.tools ?? {},
    stacks: { add: strings(c.stacks?.add, 'config.json', 'stacks.add') as Stack[], remove: strings(c.stacks?.remove, 'config.json', 'stacks.remove') as Stack[] },
  };
}

/** `.ork-security/dismissals.json` under `root` (a list); absent means none. An entry without `reason` or `decisionRef` throws. */
export function loadDismissals(root: string): Dismissal[] {
  const raw = readJson(root, 'dismissals.json');
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw Error('security-scan.config-invalid: dismissals.json: expected a list');
  return raw.map((d: Partial<Dismissal>) => {
    const filled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
    if (!filled(d?.fingerprint) || !filled(d.reason) || !filled(d.decisionRef)) throw Error(`security-scan.dismissal-invalid: ${d?.fingerprint ?? '(no fingerprint)'}`);
    return d as Dismissal;
  });
}
