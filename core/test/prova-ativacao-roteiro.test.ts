import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROTEIRO = path.resolve(__dirname, '../../scripts/prova-ativacao.cjs');

test('roteiro: host fora da prova e host ausente saem com 2 e recibo tipado, sem criar nada', () => {
  const naoSuportado = cp.spawnSync(process.execPath, [ROTEIRO, 'hermes'], { encoding: 'utf8' });
  assert.equal(naoSuportado.status, 2);
  assert.match(naoSuportado.stderr, /host\.nao-suportado/);
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-path-'));
  try {
    const ausente = cp.spawnSync(process.execPath, [ROTEIRO, 'openclaw'], { encoding: 'utf8', env: { ...process.env, PATH: vazio } });
    assert.equal(ausente.status, 2, ausente.stderr);
    const recibo = JSON.parse(ausente.stdout);
    assert.equal(recibo.contrato, 'ork.prova-ativacao/v1');
    assert.equal(recibo.estado, 'host-ausente');
    assert.equal(recibo.limpeza.removido, true);
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); }
});
