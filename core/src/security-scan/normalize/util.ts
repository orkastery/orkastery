import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { loadTools } from '../tools';
import type { RawFinding, Severity } from '../types';

/**
 * `root` is the path where the scanned tree was mounted inside the tool's container ('/src' in every catalog run);
 * an absolute path under it is made relative to the repository root. `stackDir` is the stack directory relative to
 * the repository root ('.' at the root).
 */
export type NormalizeContext = { root: string; stackDir: string };
export type Normalizer = (output: string, ctx: NormalizeContext) => RawFinding[];

const DEFAULT_SEVERITY: Severity = 'medium';

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function parseError(tool: string, reason: string): Error {
  const first = (reason.split('\n').find(l => l.trim()) ?? '').trim().slice(0, 200);
  return new Error(`security-scan.parse: ${tool}: ${first}`);
}

function parseJsonStream(text: string): unknown[] {
  const values: unknown[] = [];
  let depth = 0; let inString = false; let escaped = false; let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') { if (depth++ === 0) start = i; }
    else if (c === '}' || c === ']') { if (--depth === 0) values.push(JSON.parse(text.slice(start, i + 1))); if (depth < 0) throw Error('unbalanced JSON'); }
    else if (depth === 0 && !/\s/.test(c)) throw Error(`unexpected "${c}" outside a JSON value`);
  }
  if (depth !== 0) throw Error('truncated JSON');
  return values;
}

const nonEmpty = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '' && v !== false;

/** Parses a tool report and enforces the catalog `expect` contract (shape, requireKey, failIfKey); throws security-scan.parse. */
export function parseReport(tool: string, output: string, catalogName = tool): unknown {
  const spec = loadTools().find(t => t.name === catalogName);
  if (!spec) throw parseError(tool, 'not in the catalog');
  const { shape, requireKey = [], failIfKey = [] } = spec.expect;
  let value: unknown;
  try {
    if (shape === 'stream') {
      const values = parseJsonStream(output);
      if (values.length === 0) throw Error('empty stream');
      return values;
    }
    value = JSON.parse(output);
  } catch (e) {
    throw parseError(tool, output.trim() ? output : (e as Error).message);
  }
  if (shape === 'array') {
    if (!Array.isArray(value)) throw parseError(tool, 'expected a JSON array');
    return value;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw parseError(tool, 'expected a JSON object');
  const obj = value as Record<string, unknown>;
  for (const k of requireKey) if (!(k in obj)) throw parseError(tool, `missing key "${k}"`);
  for (const k of failIfKey) if (nonEmpty(obj[k])) throw parseError(tool, `tool reported "${k}": ${JSON.stringify(obj[k]).slice(0, 160)}`);
  return obj;
}

/**
 * Severity through the catalog `severityMap`, case-insensitive, with '*' as the catch-all. A value the map does not
 * know (or a tool without a map) is `medium`, never an exception.
 */
export function mapSeverity(tool: string, raw: unknown, fallback: Severity = DEFAULT_SEVERITY): Severity {
  const map = loadTools().find(t => t.name === tool)?.severityMap;
  if (!map) return fallback;
  const key = String(raw ?? '').toLowerCase();
  for (const [k, v] of Object.entries(map)) if (k.toLowerCase() === key) return v;
  return map['*'] ?? fallback;
}

/**
 * A file path as printed by a tool, made relative to the repository root with posix separators. An absolute path is
 * taken under `ctx.root` (the container mount); a relative one is relative to the repository root, or to the stack
 * directory when `from` is 'stack' (tools that run inside it). A path that leaves the mount is returned normalized.
 */
export function repoPath(file: string, ctx: NormalizeContext, from: 'root' | 'stack' = 'root'): string {
  const mount = path.posix.resolve('/', (ctx.root || '/src').replaceAll('\\', '/'));
  let f = file.replaceAll('\\', '/');
  // golangci-lint run at the mount root prints `../src/x.go`: relative to a sibling of the mount, so root-relative.
  const sibling = `../${path.posix.basename(mount)}/`;
  if (f.startsWith(sibling)) f = path.posix.join(mount, f.slice(sibling.length));
  const abs = path.posix.resolve(mount, from === 'stack' ? ctx.stackDir : '.', f);
  const rel = path.posix.relative(mount, abs);
  if (rel === '' || rel.startsWith('..')) return path.posix.normalize(f);
  return rel;
}

/** A file the stack owns (lockfile, requirements.txt, go.mod), inside the stack directory. */
export function stackFile(name: string, ctx: NormalizeContext): string {
  return path.posix.normalize(path.posix.join(ctx.stackDir.replaceAll('\\', '/'), name));
}

export const asArray = <T>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : [];
