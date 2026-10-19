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
 * Glob over repository-relative posix paths, no dependency (`path.matchesGlob` needs Node 22, the package supports 20),
 * with gitignore-like semantics: `**` crosses directories, `*` and `?` stay inside one segment, and a match on a
 * directory also covers everything under it (`src/*` matches `src/a/b/c.js` through `src/a`; `vendor` excludes
 * `vendor/x/y.js`).
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
 * Union of several scans of the same tree state (Gitleaks HEAD: `dir` scan and `git` scan of base..HEAD) without double
 * counting. Per fingerprint the merged count is the MAX of the per-list counts, not the sum, and the occurrences come
 * from the list holding that max; on a tie the earliest list wins, so pass the `dir` scan first (its line numbers are
 * those of the current tree). Order follows the first appearance of each fingerprint.
 */
export function mergeByFingerprint(lists: RawFinding[][]): RawFinding[] {
  const groups = new Map<string, RawFinding[][]>();
  for (const [i, list] of lists.entries()) {
    for (const f of list) {
      const fp = fingerprintOf(f);
      const per = groups.get(fp) ?? lists.map(() => []);
      per[i].push(f);
      groups.set(fp, per);
    }
  }
  const out: RawFinding[] = [];
  for (const per of groups.values()) out.push(...per.reduce((best, cur) => cur.length > best.length ? cur : best));
  return out;
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
  const baseLines = new Map<string, number[]>();
  for (const b of base) if (!isExcluded(b)) { const fp = fingerprintOf(b); baseLines.set(fp, [...(baseLines.get(fp) ?? []), b.line ?? 0]); }
  const headByFp = new Map<string, number[]>();
  head.forEach((h, i) => { if (!isExcluded(h)) { const fp = fingerprintOf(h); headByFp.set(fp, [...(headByFp.get(fp) ?? []), i]); } });
  // Same-fingerprint occurrences are paired with the base by nearest line, so the `new` one is the inserted one.
  const paired = new Set<number>();
  for (const [fp, idxs] of headByFp) {
    const lines = baseLines.get(fp) ?? [];
    const pairs = idxs.flatMap(hi => lines.map((bl, bi) => ({ hi, bi, d: Math.abs((head[hi].line ?? 0) - bl) })));
    const usedH = new Set<number>(); const usedB = new Set<number>();
    for (const p of pairs.sort((x, y) => x.d - y.d || x.hi - y.hi || x.bi - y.bi)) {
      if (usedH.has(p.hi) || usedB.has(p.bi)) continue;
      usedH.add(p.hi); usedB.add(p.bi); paired.add(p.hi);
    }
  }
  const dismissed = new Set(dismissals.map(d => d.fingerprint));
  const findings: Finding[] = [];
  for (const [i, h] of head.entries()) {
    if (isExcluded(h)) { excluded.add(h.file); continue; }
    const fingerprint = fingerprintOf(h);
    const status = dismissed.has(fingerprint) ? 'dismissed' : paired.has(i) ? 'existing' : 'new';
    const { snippet: _snippet, ...rest } = h;
    findings.push({ ...rest, fingerprint, status, loop: status === 'new' && isLoop(h.category, h.severity) });
  }
  return { findings, excluded: [...excluded].sort() };
}
