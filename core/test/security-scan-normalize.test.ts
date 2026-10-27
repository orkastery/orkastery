import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { NORMALIZERS, partialOf } from '../src/security-scan/normalize';
import { loadAgileTools, loadTools } from '../src/security-scan/tools';
import type { RawFinding } from '../src/security-scan/types';
import { fingerprintOf } from '../src/security-scan/compare';

// dist-test/test -> core/test/fixtures (recorded real output of Task 5), and the fixture sources for the fake secret.
const FIX = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'security-scan');
const SRC = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan');
const ROOT_CTX = { root: '/src', stackDir: '.' };
const read = (f: string): string => fs.readFileSync(path.join(FIX, f), 'utf8');
const run = (tool: string, file: string, ctx = ROOT_CTX): RawFinding[] => NORMALIZERS[tool](read(file), ctx);
const count = (fs_: RawFinding[], key: 'severity' | 'category' | 'rule'): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const f of fs_) out[f[key]] = (out[f[key]] ?? 0) + 1;
  return out;
};
const FAKE_SECRET = /apiKey: '([^']+)'/.exec(fs.readFileSync(path.join(SRC, 'js', 'src', 'config.js'), 'utf8'))![1];

test('every catalog tool has a normalizer', () => {
  // RM-072 (D13): the Agile-only catalog (tools-agil.json) has its normalizers too.
  assert.deepEqual(Object.keys(NORMALIZERS).sort(), [...loadTools(), ...loadAgileTools()].map(t => t.name).sort());
});

test('empty recordings normalize to nothing, without throwing', () => {
  for (const t of [...loadTools(), ...loadAgileTools()]) {
    const files = t.name === 'gitleaks' ? ['gitleaks-dir.empty.json', 'gitleaks-git.empty.json'] : [`${t.name}.empty.json`];
    for (const f of files) assert.deepEqual(run(t.name, f), [], f);
  }
});

test('gitleaks: critical secret, repo-relative file, never the value', () => {
  for (const stack of ['js', 'python', 'go']) {
    const dir = run('gitleaks', `gitleaks-dir.${stack}.json`);
    const git = run('gitleaks', `gitleaks-git.${stack}.json`);
    assert.equal(dir.length, 1);
    assert.equal(dir[0].category, 'secret');
    assert.equal(dir[0].severity, 'critical');
    assert.equal(dir[0].rule, 'generic-api-key');
    assert.equal(dir[0].line, git[0].line);
    assert.ok((dir[0].line ?? 0) >= 1);
    assert.match(dir[0].snippet, /^[0-9a-f]{64}$/);
    assert.ok(!dir[0].file.startsWith('/'), dir[0].file);
    // tree scan and commit scan of the same secret in the same file are the same finding
    assert.equal(fingerprintOf(dir[0]), fingerprintOf(git[0]));
    for (const r of [dir, git]) assert.ok(!JSON.stringify(r).includes(FAKE_SECRET));
  }
  assert.equal(run('gitleaks', 'gitleaks-dir.js.json')[0].file, 'src/config.js');
});

test('semgrep: ERROR high, WARNING medium, paths as printed (repo-relative)', () => {
  const js = run('semgrep', 'semgrep.js.json');
  assert.equal(js.length, 2);
  assert.deepEqual(count(js, 'severity'), { medium: 1, high: 1 });
  assert.ok(js.every(f => f.category === 'sast' && f.file === 'src/server.js' && typeof f.line === 'number'));
  assert.equal(run('semgrep', 'semgrep.python.json').length, 4);
  assert.equal(run('semgrep', 'semgrep.go.json').length, 2);
});

test('trivy-vuln: dependency findings by package, severity from the map', () => {
  const js = run('trivy-vuln', 'trivy-vuln.js.json');
  assert.equal(js.length, 11);
  assert.ok(js.every(f => f.category === 'dependency' && f.file === 'package-lock.json'));
  assert.equal(run('trivy-vuln', 'trivy-vuln.python.json').length, 5);
  const go = run('trivy-vuln', 'trivy-vuln.go.json');
  assert.equal(go.length, 3);
  assert.ok(go.some(f => f.rule === 'CVE-2022-32149' && f.severity === 'high' && f.file === 'go.mod'));
});

test('trivy-config: Dockerfile misconfigurations (iac)', () => {
  const r = run('trivy-config', 'trivy-config.js.json');
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(f => f.rule).sort(), ['DS-0001', 'DS-0002', 'DS-0026']);
  assert.ok(r.every(f => f.category === 'iac' && f.file === 'Dockerfile' && f.line === 1 || f.rule !== 'DS-0001'));
  assert.equal(r.find(f => f.rule === 'DS-0001')!.severity, 'medium');
});

test('trivy-license: only lockfiles that carry licenses produce findings', () => {
  const js = run('trivy-license', 'trivy-license.js.json');
  assert.equal(js.length, 70);
  assert.ok(js.every(f => f.category === 'license' && f.file === 'package-lock.json'));
  assert.equal(run('trivy-license', 'trivy-license.python.json').length, 0);
  assert.equal(run('trivy-license', 'trivy-license.go.json').length, 0);
});

test('npm-audit: one finding per advisory, manifest joined to the stack directory', () => {
  const r = run('npm-audit', 'npm-audit.js.json');
  assert.equal(r.length, 11);
  assert.ok(r.every(f => f.category === 'dependency' && f.file === 'package-lock.json' && f.stack === 'js'));
  assert.ok(r.some(f => f.severity === 'high') && r.some(f => f.severity === 'medium'));
  assert.ok(r.every(f => /^GHSA-/.test(f.rule)));
  const sub = run('npm-audit', 'npm-audit.js.json', { root: '/src', stackDir: 'core' });
  assert.ok(sub.every(f => f.file === 'core/package-lock.json'));
});

test('pip-audit: one finding per vulnerability, no scanner severity means high', () => {
  const r = run('pip-audit', 'pip-audit.python.json');
  assert.equal(r.length, 10);
  assert.ok(r.every(f => f.category === 'dependency' && f.severity === 'high' && f.stack === 'python'));
  assert.ok(r.some(f => f.rule === 'PYSEC-2018-28'));
});

test('govulncheck: one finding per advisory and module, reachable only for the called one', () => {
  const r = run('govulncheck', 'govulncheck.go.json');
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(f => f.rule).sort(), ['GO-2022-1059', 'GO-2026-5970', 'GO-2026-6629']);
  assert.equal(r.find(f => f.rule === 'GO-2022-1059')!.reachable, true);
  assert.ok(r.filter(f => f.rule !== 'GO-2022-1059').every(f => f.reachable === false));
  assert.ok(r.every(f => f.severity === 'high' && f.file === 'go.mod' && f.stack === 'go'));
});

test('zizmor: severity case-insensitive, offsets to 1-based lines, primary location', () => {
  const r = run('zizmor', 'zizmor.js.json');
  assert.equal(r.length, 5);
  assert.ok(r.every(f => f.category === 'workflow' && f.file === '.github/workflows/ci.yml' && (f.line ?? 0) >= 1));
  assert.deepEqual(count(r, 'severity'), { medium: 2, high: 3 });
});

test('actionlint: medium workflow finding with the reported line', () => {
  const r = run('actionlint', 'actionlint.js.json');
  assert.equal(r.length, 1);
  assert.equal(r[0].category, 'workflow');
  assert.equal(r[0].severity, 'medium');
  assert.equal(r[0].file, '.github/workflows/ci.yml');
  assert.equal(r[0].line, 12);
});

test('eslint: severity 2 medium, absolute container path made repo-relative', () => {
  const r = run('eslint', 'eslint.js.json');
  assert.equal(r.length, 4);
  assert.ok(r.every(f => f.category === 'quality' && f.severity === 'medium' && f.file === 'src/util.ts' && f.stack === 'js'));
});

test('ruff: low quality findings', () => {
  const r = run('ruff', 'ruff.python.json');
  assert.equal(r.length, 3);
  assert.ok(r.every(f => f.category === 'quality' && f.severity === 'low' && f.file.startsWith('app/') && f.stack === 'python'));
  assert.ok(r.some(f => f.rule === 'F401'));
});

test('golangci-lint: paths relative to the stack directory get the stack prefix', () => {
  const r = run('golangci-lint', 'golangci-lint.go.json');
  assert.equal(r.length, 3);
  assert.ok(r.every(f => f.category === 'quality' && f.severity === 'low' && f.file === 'main.go' && f.stack === 'go'));
  // run from inside the stack directory (measured with `cd go`), the tool prints the path relative to it
  const inside = JSON.stringify({ Issues: [{ FromLinter: 'errcheck', Text: 't', Pos: { Filename: 'main.go', Line: 3 } }] });
  const sub = NORMALIZERS['golangci-lint'](inside, { root: '/src', stackDir: 'eval/fixtures/security-scan/go' });
  assert.equal(sub[0].file, 'eval/fixtures/security-scan/go/main.go');
});

test('fingerprint does not depend on the line, nor on whitespace in the snippet', () => {
  const [a] = run('golangci-lint', 'golangci-lint.go.json');
  assert.equal(fingerprintOf(a), fingerprintOf({ ...a, line: (a.line ?? 0) + 40, snippet: ` ${a.snippet}  ` }));
  assert.notEqual(fingerprintOf(a), fingerprintOf({ ...a, file: 'other.go' }));
});

test('invalid output throws security-scan.parse with the tool name', () => {
  assert.throws(() => NORMALIZERS.semgrep('não é json', ROOT_CTX), /^Error: security-scan\.parse: semgrep: /);
  assert.throws(() => NORMALIZERS.gitleaks('', ROOT_CTX), /security-scan\.parse: gitleaks/);
  assert.throws(() => NORMALIZERS.eslint('{}', ROOT_CTX), /security-scan\.parse: eslint/);
});

test('expect contract: error keys and missing keys fail instead of reading as clean', () => {
  assert.throws(() => NORMALIZERS['npm-audit'](JSON.stringify({ error: { code: 'ENOLOCK', summary: 'no lock' } }), ROOT_CTX),
    /security-scan\.parse: npm-audit/);
  assert.throws(() => NORMALIZERS.semgrep(JSON.stringify({ results: [], errors: [{ message: 'boom' }] }), ROOT_CTX),
    /security-scan\.parse: semgrep/);
  assert.throws(() => NORMALIZERS.semgrep(JSON.stringify({ errors: [] }), ROOT_CTX), /security-scan\.parse: semgrep/);
  assert.throws(() => NORMALIZERS['trivy-vuln']('{}', ROOT_CTX), /security-scan\.parse: trivy-vuln/);
  assert.throws(() => NORMALIZERS.govulncheck('', ROOT_CTX), /security-scan\.parse: govulncheck/);
});

test('semgrep: warn-level Timeout and PartialParsing are tolerated, the findings count and partialOf names them', () => {
  const partial = read('semgrep.partial.json');
  const out = run('semgrep', 'semgrep.partial.json');
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'high');
  assert.equal(partialOf('semgrep', partial), 'partial-timeout: 2, partial-parsing: 1');
  assert.equal(partialOf('semgrep', read('semgrep.js.json')), undefined, 'no error, no partial reason');
  assert.equal(partialOf('npm-audit', partial), undefined, 'a tool without tolerate never reports partial coverage');
  assert.equal(partialOf('semgrep', 'not json'), undefined);
});

test('semgrep: an error outside the tolerance still fails, even next to tolerated ones', () => {
  assert.throws(() => run('semgrep', 'semgrep.fatal.json'), /security-scan\.parse: semgrep: tool reported "errors": .*Rule parse error/);
  const errorLevelTimeout = { results: [], errors: [{ code: 2, level: 'error', type: 'Timeout', message: 'x' }] };
  assert.throws(() => NORMALIZERS.semgrep(JSON.stringify(errorLevelTimeout), ROOT_CTX), /security-scan\.parse: semgrep/);
  const warnOther = { results: [], errors: [{ code: 3, level: 'warn', type: 'Syntax error', message: 'x' }] };
  assert.throws(() => NORMALIZERS.semgrep(JSON.stringify(warnOther), ROOT_CTX), /security-scan\.parse: semgrep/);
});

test('unmapped severity falls back to medium instead of throwing', () => {
  const out = NORMALIZERS.semgrep(JSON.stringify({ results: [{ check_id: 'r', path: 'a.js', start: { line: 1 }, extra: { message: 'm', severity: 'WEIRD' } }], errors: [] }), ROOT_CTX);
  assert.equal(out[0].severity, 'medium');
});

test('a secret tool parse error never echoes the output', () => {
  const bad = `{"Secret":"${FAKE_SECRET}"`;
  assert.throws(() => NORMALIZERS.gitleaks(bad, ROOT_CTX), (e: Error) => /security-scan\.parse: gitleaks/.test(e.message) && !e.message.includes(FAKE_SECRET));
  assert.throws(() => NORMALIZERS.gitleaks(`{"Secret":"${FAKE_SECRET}"}`, ROOT_CTX), (e: Error) => !e.message.includes(FAKE_SECRET));
});

test('pip-audit severity comes from the catalog map', () => {
  assert.deepEqual(loadTools().find(t => t.name === 'pip-audit')!.severityMap, { '*': 'high' });
});
