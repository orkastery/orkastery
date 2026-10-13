import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/forja-contrato.cjs');

/** Um `gh` falso no PATH: devolve um JSON com um token falso dentro, para provar a redação. */
function ghFalso(dir: string): void {
  const corpo = JSON.stringify({ total_count: 1, check_runs: [{ name: 'ork-verify', output: { text: 'ghp_' + 'a'.repeat(36) } }] });
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\nprintf '%s' '${corpo}'\n`, { mode: 0o755 });
}

test('grava cada caso com o corpo redigido e o comando sem token', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-bin-'));
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-saida-'));
  ghFalso(bin);
  const r = spawnSync(process.execPath, [SCRIPT, '--forja', 'github', '--host', 'github.com', '--repo', 'o/r',
    '--sha', 'a'.repeat(40), '--saida', saida], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  const arquivo = path.join(saida, 'check-runs.json');
  const gravado = fs.readFileSync(arquivo, 'utf8');
  assert.doesNotMatch(gravado, /ghp_a{36}/);
  assert.match(gravado, /\[redigido\]/);
  assert.equal((fs.statSync(arquivo).mode & 0o777), 0o600);
});

test('recusa forja desconhecida sem gravar nada', () => {
  const saida = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-saida-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--forja', 'gitea', '--host', 'h', '--repo', 'o/r', '--sha', 'a'.repeat(40),
    '--saida', saida], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.deepEqual(fs.readdirSync(saida), []);
});
