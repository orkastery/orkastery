import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executar } from '../src/verify';

const vivo = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// Canario do travamento de 21/09/2026: no codigo antigo o neto sobrevive ao estouro.
test('verify: o estouro do teto leva a arvore do comando, nao so o bash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-verify-arvore-'));
  const arquivo = path.join(dir, 'neto.pid');
  // bash -> subshell -> sleep: o neto e o que ficava orfao com o exec puro.
  const r = executar('arvore', `(sleep 300 & echo $! > '${arquivo}'; wait)`, dir, 2000);
  assert.equal(r.ok, false);
  assert.equal(r.code, -1, 'o estouro continua saindo como code -1');
  const neto = Number(fs.readFileSync(arquivo, 'utf8'));
  for (let i = 0; i < 25 && vivo(neto); i++) spawnSync('sleep', ['0.2']);
  assert.equal(vivo(neto), false, `o neto ${neto} sobreviveu ao estouro do verify`);
});

test('verify: comando que termina no prazo mantem codigo e saida', () => {
  const r = executar('rapido', 'echo ok; exit 3', os.tmpdir(), 5000);
  assert.equal(r.ok, false);
  assert.equal(r.code, 3);
  assert.match(r.resumo, /ok/);
});

// O mesmo estouro tinha um segundo defeito (visto em 19/09 num projeto pnpm): o pnpm apanha o
// SIGTERM e sai com 0, e o verify gravava "passou". O `timeout` sai 124 no estouro, sempre.
test('verify: comando que engole o SIGTERM e sai 0 no estouro nao vira aprovacao', () => {
  const r = executar('engole', `trap 'exit 0' TERM; sleep 300 & wait`, os.tmpdir(), 1500);
  assert.equal(r.ok, false);
  assert.equal(r.code, -1);
});
