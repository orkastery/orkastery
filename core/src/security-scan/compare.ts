import * as crypto from 'node:crypto';
import type { Dismissal } from './config';
import { isLoop, type Finding, type RawFinding } from './types';

/**
 * sha256 of `tool|rule|file|snippet`, whitespace collapsed. The line is not part of it (a shift must not make a finding
 * new) and neither is the message. For secrets the snippet already is the sha256 of the value.
 */
export function fingerprintOf(f: RawFinding): string {
  const text = [f.tool, f.rule, f.file, f.snippet].map(p => p.replace(/\s+/g, ' ').trim()).join('|');
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Glob over repository-relative posix paths, no dependency (`path.matchesGlob` needs Node 22, the package supports 20):
 * `**` crosses directories, `*` and `?` stay inside one segment, and a pattern without wildcards also excludes the
 * directory of that name.
 */
export function matchesGlob(file: string, pattern: string): boolean {
  const pat = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*' && pat[i + 1] === '*') {
      if (pat[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}(?:/.*)?$`).test(file);
}

/**
 * Classifies the HEAD findings against the base ones. Dismissal (by fingerprint) wins, then presence in the base
 * (`existing`), else `new`. Equal fingerprints are matched by count: occurrences beyond what the base had are `new`.
 * `loop` is true only for `new` findings that `isLoop` accepts. Findings in an excluded path leave `findings`; their
 * paths are listed (deduplicated, sorted) in `excluded`.
 */
export function classify(head: RawFinding[], base: RawFinding[], dismissals: Dismissal[], exclude: string[]): { findings: Finding[]; excluded: string[] } {
  const excluded = new Set<string>();
  const isExcluded = (f: RawFinding): boolean => exclude.some(p => matchesGlob(f.file, p));
  const baseCount = new Map<string, number>();
  for (const b of base) if (!isExcluded(b)) { const fp = fingerprintOf(b); baseCount.set(fp, (baseCount.get(fp) ?? 0) + 1); }
  const dismissed = new Set(dismissals.map(d => d.fingerprint));
  const findings: Finding[] = [];
  for (const h of head) {
    if (isExcluded(h)) { excluded.add(h.file); continue; }
    const fingerprint = fingerprintOf(h);
    const left = baseCount.get(fingerprint) ?? 0;
    if (left > 0) baseCount.set(fingerprint, left - 1);
    const status = dismissed.has(fingerprint) ? 'dismissed' : left > 0 ? 'existing' : 'new';
    const { snippet: _snippet, ...rest } = h;
    findings.push({ ...rest, fingerprint, status, loop: status === 'new' && isLoop(h.category, h.severity) });
  }
  return { findings, excluded: [...excluded].sort() };
}
