/**
 * Revisao das entregas da madrugada de 03/10 (thread ork-revisaodasen): o teto de 14 min da RM-053
 * (D9) lia e gravava a marca da tentativa sem trava. Varios processos na mesma batida (um cron de
 * pulse por projeto, mais os eventos de thread) liam a marca velha e todos tomavam a vez.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { dirTemporario } from './apoio';

const MODULO = path.resolve(__dirname, '../src/rede-adesao.js');
const PROCESSOS = 12;

function rodada(dir: string): Promise<string> {
  const largada = Date.now() + 1500;
  const codigo = `const { tomarVezDePublicar } = require(${JSON.stringify(MODULO)});` +
    `while (Date.now() < ${largada}) {} process.stdout.write(tomarVezDePublicar() ? 'T' : 'F');`;
  return Promise.all(Array.from({ length: PROCESSOS }, () => new Promise<string>((resolve, reject) => {
    const filho = spawn(process.execPath, ['-e', codigo], { env: { ...process.env, ORK_USUARIO_DIR: dir } });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += String(d); });
    filho.on('error', reject);
    filho.on('close', () => resolve(saida));
  }))).then((s) => s.join(''));
}

test('revisao 03/10: na mesma batida, um so processo toma a vez de publicar na rede', async () => {
  for (let i = 0; i < 3; i++) {
    const dir = dirTemporario('rev0310-rede-vez');
    try {
      const vezes = await rodada(dir);
      assert.equal(vezes.length, PROCESSOS, `todo processo respondeu: ${vezes}`);
      assert.equal([...vezes].filter((c) => c === 'T').length, 1, `mais de um processo tomou a vez: ${vezes}`);
      assert.ok(!fs.existsSync(path.join(dir, 'rede', 'tentativa.lock')), 'a trava e solta depois da vez');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
