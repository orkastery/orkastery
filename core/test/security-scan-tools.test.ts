import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { isLoop } from '../src/security-scan/types';
import { loadTools, toolsFor } from '../src/security-scan/tools';

const NAMES = ['gitleaks', 'semgrep', 'trivy-vuln', 'npm-audit', 'pip-audit', 'govulncheck', 'trivy-config', 'zizmor',
  'actionlint', 'eslint', 'ruff', 'golangci-lint', 'trivy-license'];

test('isLoop: secret any severity, high or critical for dependency/sast/iac/workflow, never quality or license', () => {
  assert.equal(isLoop('secret', 'low'), true);
  assert.equal(isLoop('sast', 'high'), true);
  assert.equal(isLoop('sast', 'medium'), false);
  assert.equal(isLoop('quality', 'critical'), false);
  assert.equal(isLoop('license', 'critical'), false);
});

test('catalog is valid: digests, timeouts, unique names, the 13 tools, runnable args', () => {
  const tools = loadTools();
  const names = tools.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of NAMES) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(names.length, NAMES.length);
  for (const t of tools) {
    assert.match(t.image, /^[^@\s]+@sha256:[0-9a-f]{64}$/, t.name);
    assert.ok(t.timeoutMs >= 30000 && t.timeoutMs <= 1800000, t.name);
    assert.ok(Array.isArray(t.args) && (t.args.length > 0 || t.argsByStack), `${t.name} args`);
  }
  const semgrep = tools.find(t => t.name === 'semgrep')!;
  const all = JSON.stringify(semgrep);
  assert.match(all, /--metrics=off/);
  assert.doesNotMatch(all, /config auto|--config=auto/);
  assert.ok(semgrep.argsByStack?.js && semgrep.argsByStack.python && semgrep.argsByStack.go);
});

test('catalog has no em dash', () => {
  assert.doesNotMatch(JSON.stringify(loadTools()), /\u2014/);
});

test('toolsFor(go) picks go and all-stack tools only', () => {
  const names = toolsFor(['go']).map(t => t.name);
  for (const n of ['govulncheck', 'golangci-lint', 'gitleaks']) assert.ok(names.includes(n), n);
  for (const n of ['eslint', 'npm-audit']) assert.ok(!names.includes(n), n);
});

test('default configs exist and the catalog matches the decisions', () => {
  const dir = path.join(__dirname, '..', '..', 'assets', 'security-scan', 'defaults');
  const defaults = path.join(fs.existsSync(dir) ? dir : path.join(__dirname, '..', '..', '..', 'assets', 'security-scan', 'defaults'));
  for (const f of ['gitleaks.toml', 'eslint.config.mjs', 'ruff.toml', '.golangci.yml'])
    assert.ok(fs.existsSync(path.join(defaults, f)), f);
  assert.match(fs.readFileSync(path.join(defaults, 'gitleaks.toml'), 'utf8'), /useDefault = true/);
  assert.match(fs.readFileSync(path.join(defaults, 'eslint.config.mjs'), 'utf8'), /recommendedTypeChecked/);
  const by = Object.fromEntries(loadTools().map(t => [t.name, t]));
  for (const n of ['gitleaks', 'actionlint', 'zizmor', 'ruff']) assert.equal(by[n].network, 'none', n);
  for (const n of ['eslint', 'golangci-lint', 'semgrep', 'trivy-vuln', 'npm-audit', 'pip-audit', 'govulncheck']) assert.equal(by[n].network, 'default', n);
  assert.equal(by.gitleaks.baseMode, 'commit-range');
  assert.ok(by.gitleaks.extraArgs?.some(a => a.includes('git') && a.some(x => x.includes('{base}..HEAD'))));
  assert.ok(by.zizmor.args.includes('--offline'));
  assert.equal(by.ruff.containerBin, '/ruff');
  for (const n of ['eslint', 'pip-audit', 'govulncheck']) assert.ok(by[n].install?.every(i => /@|==/.test(i) && !/latest/.test(i)), n);
});
