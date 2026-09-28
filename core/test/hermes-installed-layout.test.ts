import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { instalarAdaptador } from '../src/hosts';

test('T17: instalador distribui layout único e suíte de ingresso preserva recusas na fonte e instalado', () => {
  const root = path.resolve(__dirname, '../../..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-hermes-layout-'));
  const run = (args: string[], cwd: string) => spawnSync('python3', args, { cwd, encoding: 'utf8', timeout: 20000,
    env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' } });
  try {
    const installation = instalarAdaptador('hermes', { projeto: tmp, catalogo: root, orkBin: '/opt/ork-synthetic' });
    assert.equal(installation.ok, true);
    const installed = path.join(tmp, '.hermes');
    for (const dir of [path.join(root, 'adapters/hermes'), installed]) {
      const result = run(['-m', 'unittest', 'discover', '-s', 'test', '-p', 'hitl_ingress_test.py'], dir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /Ran 20 tests/);
      assert.doesNotMatch(result.stderr, /skipped=/);
    }
    fs.mkdirSync(path.join(installed, 'hitl-ingress'));
    let result = run(['-c', 'from layout import plugin_directory; plugin_directory()'], path.join(installed, 'test'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hermes.layout.ambiguous/);
    fs.rmdirSync(path.join(installed, 'hitl-ingress'));
    fs.unlinkSync(path.join(installed, 'plugins/orkastery-hitl/plugin.yaml'));
    result = run(['-c', 'from layout import plugin_directory; plugin_directory()'], path.join(installed, 'test'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /hermes.layout.incomplete/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
