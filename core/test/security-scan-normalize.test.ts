import { strict as assert } from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { executarSecurityScan } from '../src/security-scan/cli';
import { NORMALIZERS, partialOf } from '../src/security-scan/normalize';
import { loadAgileTools, loadTools } from '../src/security-scan/tools';
import type { RawFinding, ScanReport } from '../src/security-scan/types';
import { fingerprintOf } from '../src/security-scan/compare';
import { defaultsDir } from '../src/security-scan/executor';
import { cacheRoot, runScan, SCAN_CACHE_VERSION } from '../src/security-scan/run';
import { dirTemporario } from './apoio';
import { installFakeTools } from './security-scan-docker-falso';
import { repositorioSecurityScan } from './security-scan-repo-fixture';

// dist-test/test -> core/test/fixtures (recorded real output of Task 5), and the fixture sources for the fake secret.
const FIX = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'security-scan');
const SRC = path.resolve(__dirname, '..', '..', '..', 'eval', 'fixtures', 'security-scan');
const ROOT_CTX = { root: '/src', stackDir: '.' };
const read = (f: string): string => fs.readFileSync(path.join(FIX, f), 'utf8');
const run = (tool: string, file: string, ctx = ROOT_CTX): RawFinding[] => NORMALIZERS[tool](read(file), ctx);
const mensagemArgumentoInseguro = (tipo: string): string =>
  `Unsafe argument of type \`any\` assigned to a parameter of type \`${tipo}\`.`;
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

test('eslint: Classic and Agile write a report of new findings several times above the measured call argument limit', () => {
  const amount = 400_000;
  const repo = repositorioSecurityScan('normalize-large-report');
  const fake = installFakeTools(['docker']);
  const cache = dirTemporario('normalize-large-report-cache');
  const anterior = { cache: process.env.XDG_CACHE_HOME, tamanho: process.env.ORK_FAKE_ESLINT_REPORT_SIZE };
  process.env.XDG_CACHE_HOME = cache;
  process.env.ORK_FAKE_ESLINT_REPORT_SIZE = String(amount);
  try {
    for (const mode of ['classic', 'agile'] as const) {
      const out: string[] = [];
      const code = executarSecurityScan(['--base', repo.base, '--check', mode],
        { raiz: repo.dir, estado: repo.dir, escrever: text => out.push(text) });
      const markdown = out.at(-1)!;
      const report = JSON.parse(fs.readFileSync(path.join(path.dirname(markdown), 'report.json'), 'utf8')) as ScanReport;
      const tool = report.tools.find(t => t.name === 'eslint')!;
      assert.equal(tool.state, 'ran', tool.reason);
      const eslintFindings = report.findings.filter(f => f.tool === 'eslint');
      assert.equal(eslintFindings.length, amount);
      assert.ok(eslintFindings.every(f => f.status === 'new'));
      assert.equal(eslintFindings.at(-1)?.rule, `rule-${amount - 1}`);
      assert.equal(tool.counts.new.medium, amount);
      assert.equal(tool.counts.existing.medium, 0);
      assert.equal(code, 1, 'os demais achados novos da fixture permanecem no laço');
      assert.match(fs.readFileSync(markdown, 'utf8'), new RegExp(`rule-${amount - 1}\\b`));
      fs.rmSync(path.dirname(markdown), { recursive: true, force: true });
    }
  } finally {
    fake.restore();
    repo.cleanup();
    fs.rmSync(cache, { recursive: true, force: true });
    if (anterior.cache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = anterior.cache;
    if (anterior.tamanho === undefined) delete process.env.ORK_FAKE_ESLINT_REPORT_SIZE;
    else process.env.ORK_FAKE_ESLINT_REPORT_SIZE = anterior.tamanho;
  }
});

test('eslint: Classic aggregates a large report from both HEAD and base without spreading either list', () => {
  const amount = 130_000;
  const repo = repositorioSecurityScan('normalize-large-report-both-trees');
  const fake = installFakeTools(['docker']);
  const cache = dirTemporario('normalize-large-report-both-trees-cache');
  const anterior = {
    cache: process.env.XDG_CACHE_HOME,
    tamanho: process.env.ORK_FAKE_ESLINT_REPORT_SIZE,
    base: process.env.ORK_FAKE_ESLINT_REPORT_ON_EMPTY,
  };
  process.env.XDG_CACHE_HOME = cache;
  process.env.ORK_FAKE_ESLINT_REPORT_SIZE = String(amount);
  process.env.ORK_FAKE_ESLINT_REPORT_ON_EMPTY = '1';
  try {
    const eslint = loadTools().find(t => t.name === 'eslint')!;
    const report = runScan({ root: repo.dir, stateRoot: repo.dir, base: repo.base, tools: [eslint] });
    const tool = report.tools.find(t => t.name === 'eslint')!;
    const findings = report.findings.filter(f => f.tool === 'eslint');
    assert.equal(tool.state, 'ran', tool.reason);
    assert.equal(findings.length, amount);
    assert.ok(findings.every(f => f.status === 'existing'));
    assert.equal(findings.at(-1)?.rule, `rule-${amount - 1}`);
    assert.equal(tool.counts.existing.medium, amount);
    assert.equal(tool.counts.new.medium, 0);
  } finally {
    fake.restore();
    repo.cleanup();
    fs.rmSync(cache, { recursive: true, force: true });
    if (anterior.cache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = anterior.cache;
    if (anterior.tamanho === undefined) delete process.env.ORK_FAKE_ESLINT_REPORT_SIZE;
    else process.env.ORK_FAKE_ESLINT_REPORT_SIZE = anterior.tamanho;
    if (anterior.base === undefined) delete process.env.ORK_FAKE_ESLINT_REPORT_ON_EMPTY;
    else process.env.ORK_FAKE_ESLINT_REPORT_ON_EMPTY = anterior.base;
  }
});

test('eslint: equivalent top-level union orders have the same fingerprint', () => {
  const findings = run('eslint', 'eslint.union-equivalent.json');
  assert.notEqual(findings[0].message, findings[1].message, 'the report keeps the original messages');
  assert.equal(fingerprintOf(findings[0]), fingerprintOf(findings[1]));
});

test('eslint: findings cached with the previous fingerprint semantics are not compared', () => {
  const repo = repositorioSecurityScan('normalize-old-cache');
  repo.commit!('.fake-case', 'union-equivalent\n');
  const fake = installFakeTools(['docker']);
  const cache = dirTemporario('normalize-old-cache-root');
  const anterior = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  try {
    const eslint = loadTools().find(t => t.name === 'eslint')!;
    const unit = { stack: 'js', dir: '.' };
    const config = fs.readFileSync(path.join(defaultsDir(), 'eslint.config.mjs'), 'utf8');
    assert.equal(SCAN_CACHE_VERSION, 2, 'the canonical fingerprint cache has its own fixed version');
    const keyFor = (version: number) => crypto.createHash('sha256').update(JSON.stringify({
      version, tool: eslint, executor: 'docker', nativeVersion: '', unit, config,
    })).digest('hex');
    const id = eslint.image.split('@sha256:')[1].slice(0, 12);
    const arquivo = path.join(cacheRoot(), repo.base, `eslint-${id}-js-root.json`);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const cached = [run('eslint', 'eslint.union-equivalent.json')[0]];
    fs.writeFileSync(arquivo, JSON.stringify({ key: keyFor(SCAN_CACHE_VERSION), findings: cached }));

    const beforeCurrent = fake.calls().length;
    const current = runScan({ root: repo.dir, stateRoot: repo.dir, base: repo.base, tools: [eslint] });
    assert.equal(current.tools[0].state, 'ran', current.tools[0].reason);
    assert.deepEqual(current.findings.map(f => f.status).sort(), ['existing', 'new']);
    assert.equal(fake.calls().slice(beforeCurrent).filter(c => c.as === 'docker' && c.args[0] === 'run').length, 1,
      'a chave da versão atual reaproveita a base');

    fs.writeFileSync(arquivo, JSON.stringify({ key: keyFor(1), findings: cached }));

    const beforePrevious = fake.calls().length;
    const report = runScan({ root: repo.dir, stateRoot: repo.dir, base: repo.base, tools: [eslint] });
    assert.equal(report.tools[0].state, 'ran', report.tools[0].reason);
    assert.equal(report.findings.length, 2);
    assert.ok(report.findings.every(f => f.status === 'new'), 'a base da semântica anterior não participa da comparação');
    const runs = fake.calls().slice(beforePrevious).filter(c => c.as === 'docker' && c.args[0] === 'run');
    assert.equal(runs.length, 2, 'HEAD e base são varridos quando a versão do cache não coincide');
  } finally {
    fake.restore();
    repo.cleanup();
    fs.rmSync(cache, { recursive: true, force: true });
    if (anterior === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = anterior;
  }
});

test('eslint: genuinely different unions keep different fingerprints', () => {
  const findings = run('eslint', 'eslint.union-different.json');
  assert.notEqual(fingerprintOf(findings[0]), fingerprintOf(findings[1]));
});

test('eslint: union order remains significant outside no-unsafe-argument', () => {
  const report = (message: string) => JSON.stringify([{ filePath: '/src/src/union.ts', messages: [{
    ruleId: 'other-rule', severity: 2, message, line: 1,
  }] }]);
  for (const [left, right] of [
    [mensagemArgumentoInseguro('A | B'), mensagemArgumentoInseguro('B | A')],
    ['A | B', 'B | A'],
  ]) {
    const a = NORMALIZERS.eslint(report(left), ROOT_CTX)[0];
    const b = NORMALIZERS.eslint(report(right), ROOT_CTX)[0];
    assert.notEqual(fingerprintOf(a), fingerprintOf(b));
  }
});

test('eslint: union order remains significant inside a generic', () => {
  const report = (tipo: string) => JSON.stringify([{ filePath: '/src/src/union.ts', messages: [{
    ruleId: '@typescript-eslint/no-unsafe-argument', severity: 2, message: mensagemArgumentoInseguro(tipo), line: 1,
  }] }]);
  const a = NORMALIZERS.eslint(report('Array<A | B>'), ROOT_CTX)[0];
  const b = NORMALIZERS.eslint(report('Array<B | A>'), ROOT_CTX)[0];
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
});

test('eslint: union order remains significant inside an object', () => {
  const report = (tipo: string) => JSON.stringify([{ filePath: '/src/src/union.ts', messages: [{
    ruleId: '@typescript-eslint/no-unsafe-argument', severity: 2, message: mensagemArgumentoInseguro(tipo), line: 1,
  }] }]);
  const a = NORMALIZERS.eslint(report('{ a: A | B }'), ROOT_CTX)[0];
  const b = NORMALIZERS.eslint(report('{ a: B | A }'), ROOT_CTX)[0];
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
});

test('eslint: a top-level conditional type is not canonicalized', () => {
  const report = (tipo: string) => JSON.stringify([{ filePath: '/src/src/union.ts', messages: [{
    ruleId: '@typescript-eslint/no-unsafe-argument', severity: 2, message: mensagemArgumentoInseguro(tipo), line: 1,
  }] }]);
  const a = NORMALIZERS.eslint(report('Z | A extends B ? C : D'), ROOT_CTX)[0];
  const b = NORMALIZERS.eslint(report('A extends B ? C : D | Z'), ROOT_CTX)[0];
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
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
