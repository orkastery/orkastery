import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { classify, fingerprintOf, matchesGlob, mergeByFingerprint } from '../src/security-scan/compare';
import { loadConfig, loadDismissals, type Dismissal } from '../src/security-scan/config';
import type { RawFinding } from '../src/security-scan/types';

const f = (over: Partial<RawFinding> = {}): RawFinding => ({
  tool: 'semgrep', rule: 'r1', category: 'sast', severity: 'high', file: 'src/a.js', line: 10, message: 'm', snippet: 'eval(x)', ...over,
});
const dismissal = (fingerprint: string): Dismissal => ({
  fingerprint, tool: 'semgrep', rule: 'r1', file: 'src/a.js', reason: 'false positive', decidedBy: 'me', decisionRef: 'MR-1', date: '2026-10-19',
});
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ork-sec-'));

test('fingerprint: sha256 of tool|rule|file|snippet with whitespace collapsed, line and message ignored', () => {
  assert.match(fingerprintOf(f()), /^[0-9a-f]{64}$/);
  assert.equal(fingerprintOf(f()), fingerprintOf(f({ line: 99, message: 'other', snippet: '  eval(x)\n' })));
  assert.equal(fingerprintOf(f({ snippet: 'a   b' })), fingerprintOf(f({ snippet: 'a b' })));
  assert.notEqual(fingerprintOf(f()), fingerprintOf(f({ rule: 'r2' })));
  assert.notEqual(fingerprintOf(f()), fingerprintOf(f({ tool: 'other' })));
});

test('classify: only in HEAD is new, in both is existing, line shift stays existing', () => {
  const r = classify([f(), f({ rule: 'r2' }), f({ rule: 'r3', line: 50 })], [f({ rule: 'r2' }), f({ rule: 'r3', line: 7 })], [], []);
  const byRule = Object.fromEntries(r.findings.map(x => [x.rule, x]));
  assert.equal(byRule.r1.status, 'new');
  assert.equal(byRule.r2.status, 'existing');
  assert.equal(byRule.r3.status, 'existing');
  assert.equal(byRule.r3.line, 50);
  assert.equal(byRule.r1.fingerprint, fingerprintOf(f()));
  assert.ok(!('snippet' in byRule.r1));
});

test('classify: a second occurrence of the same fingerprint beyond the base count is new', () => {
  const r = classify([f({ line: 1 }), f({ line: 2 })], [f({ line: 9 })], [], []);
  assert.deepEqual(r.findings.map(x => x.status), ['new', 'existing']);
});

test('classify: dismissal by fingerprint wins over new and existing', () => {
  const r = classify([f(), f({ rule: 'r2' })], [f({ rule: 'r2' })], [dismissal(fingerprintOf(f())), dismissal(fingerprintOf(f({ rule: 'r2' })))], []);
  assert.deepEqual(r.findings.map(x => x.status), ['dismissed', 'dismissed']);
  assert.ok(r.findings.every(x => x.loop === false));
});

test('classify: loop follows isLoop only for new findings', () => {
  const head = [f(), f({ rule: 'q', category: 'quality', severity: 'critical' }), f({ rule: 'm', severity: 'medium' }),
    f({ rule: 's', category: 'secret', severity: 'critical' }), f({ rule: 'old' })];
  const r = classify(head, [f({ rule: 'old' })], [], []);
  const loop = Object.fromEntries(r.findings.map(x => [x.rule, x.loop]));
  assert.deepEqual(loop, { r1: true, q: false, m: false, s: true, old: false });
});

test('classify: excluded paths leave findings and are listed once, sorted', () => {
  const head = [f({ file: 'eval/fixtures/security-scan/js/a.js' }), f({ file: 'eval/fixtures/security-scan/js/a.js', rule: 'x' }),
    f({ file: 'docs/z.md' }), f({ file: 'src/ok.js' })];
  const r = classify(head, [], [], ['eval/fixtures/security-scan/**', 'docs/*.md']);
  assert.deepEqual(r.findings.map(x => x.file), ['src/ok.js']);
  assert.deepEqual(r.excluded, ['docs/z.md', 'eval/fixtures/security-scan/js/a.js']);
});

test('matchesGlob: **, *, ? and plain directories', () => {
  assert.equal(matchesGlob('eval/fixtures/security-scan/js/a.js', 'eval/fixtures/security-scan/**'), true);
  assert.equal(matchesGlob('eval/fixtures/other/a.js', 'eval/fixtures/security-scan/**'), false);
  assert.equal(matchesGlob('a/b/c.test.ts', '**/*.test.ts'), true);
  assert.equal(matchesGlob('c.test.ts', '**/*.test.ts'), true);
  assert.equal(matchesGlob('a/b.ts', '*.ts'), false);
  assert.equal(matchesGlob('a.ts', '?.ts'), true);
  assert.equal(matchesGlob('vendor/x/y.js', 'vendor'), true);
  assert.equal(matchesGlob('vendors/y.js', 'vendor'), false);
});

test('loadConfig and loadDismissals: absent files are empty defaults', () => {
  const root = tmp();
  assert.deepEqual(loadConfig(root), { exclude: [], tools: {}, stacks: { add: [], remove: [] } });
  assert.deepEqual(loadDismissals(root), []);
});

test('loadConfig reads the file; invalid JSON throws a clear error', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.ork-security'));
  fs.writeFileSync(path.join(root, '.ork-security', 'config.json'), JSON.stringify({ exclude: ['x/**'], tools: { semgrep: { disabled: 'noisy' } } }));
  const c = loadConfig(root);
  assert.deepEqual(c.exclude, ['x/**']);
  assert.equal(c.tools.semgrep.disabled, 'noisy');
  assert.deepEqual(c.stacks, { add: [], remove: [] });
  fs.writeFileSync(path.join(root, '.ork-security', 'config.json'), '{nope');
  assert.throws(() => loadConfig(root), /security-scan\.config-invalid: config\.json/);
});

test('loadDismissals: entry without reason or decisionRef throws with the fingerprint', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.ork-security'));
  const file = path.join(root, '.ork-security', 'dismissals.json');
  const ok = dismissal('aaa');
  fs.writeFileSync(file, JSON.stringify([ok]));
  assert.deepEqual(loadDismissals(root), [ok]);
  const { decisionRef: _d, ...noRef } = dismissal('bbb');
  fs.writeFileSync(file, JSON.stringify([ok, noRef]));
  assert.throws(() => loadDismissals(root), /^Error: security-scan\.dismissal-invalid: bbb$/);
  fs.writeFileSync(file, JSON.stringify([{ ...dismissal('ccc'), reason: '  ' }]));
  assert.throws(() => loadDismissals(root), /security-scan\.dismissal-invalid: ccc/);
  fs.writeFileSync(file, 'not json');
  assert.throws(() => loadDismissals(root), /security-scan\.dismissal-invalid|config-invalid/);
});

test('classify: same-fingerprint occurrences pair with the base by nearest line', () => {
  const r = classify([f({ line: 5 }), f({ line: 40 })], [f({ line: 38 })], [], []);
  assert.deepEqual(r.findings.map(x => [x.line, x.status]), [[5, 'new'], [40, 'existing']]);
});

test('matchesGlob: a directory match covers everything under it (gitignore-like)', () => {
  assert.equal(matchesGlob('src/a/b/c.js', 'src/*'), true);
  assert.equal(matchesGlob('other/a.js', 'src/*'), false);
});

const secret = (line: number, snippet = 'h1'): RawFinding => f({ tool: 'gitleaks', category: 'secret', severity: 'critical', rule: 'k', line, snippet });

test('mergeByFingerprint: max of the counts, dir entries preferred, no double count', () => {
  const dir = [secret(7)];
  const git = [secret(3)];
  const merged = mergeByFingerprint([dir, git]);
  assert.deepEqual(merged.map(x => x.line), [7]);
  assert.deepEqual(mergeByFingerprint([[secret(1)], [secret(2), secret(3)]]).map(x => x.line), [2, 3]);
  assert.deepEqual(mergeByFingerprint([[], [secret(4, 'h2')]]).map(x => x.line), [4]);
});

test('secret in base dir, HEAD dir and HEAD git: one existing, none new; new secret seen twice: exactly one new', () => {
  const existing = classify(mergeByFingerprint([[secret(10)], [secret(3)]]), [secret(8)], [], []);
  assert.deepEqual(existing.findings.map(x => x.status), ['existing']);
  assert.ok(existing.findings.every(x => !x.loop));
  const fresh = classify(mergeByFingerprint([[secret(10, 'h9')], [secret(3, 'h9')]]), [], [], []);
  assert.deepEqual(fresh.findings.map(x => [x.status, x.loop]), [['new', true]]);
});
