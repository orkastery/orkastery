import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { adquirirTravaPortatil, comTravaPortatil, donosDaTravaPortatil } from '../src/trava-portatil';

function fixture(): { dir: string; alvo: string; limpar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-trava-portatil-'));
  return { dir, alvo: path.join(dir, 'recurso'), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('trava portátil exclui concorrente vivo e o prazo não rouba propriedade', () => {
  const f = fixture();
  try {
    const primeira = adquirirTravaPortatil(f.alvo, 'primeira');
    assert.ok(primeira);
    const inicio = Date.now();
    assert.equal(adquirirTravaPortatil(f.alvo, 'concorrente', { esperarMs: 30 }), null);
    assert.ok(Date.now() - inicio >= 20);
    assert.deepEqual(donosDaTravaPortatil(f.alvo).map((d) => d.operacao), ['primeira']);
    primeira.liberar();
    const depois = adquirirTravaPortatil(f.alvo, 'depois', { esperarMs: 0 });
    assert.ok(depois); depois.liberar();
  } finally { f.limpar(); }
});

test('processo morto perde apenas o próprio candidato e a aquisição seguinte continua', () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const filho = spawnSync(process.execPath, ['-e',
      `require(process.argv[1]).adquirirTravaPortatil(process.argv[2],'filho');process.exit(19)`, modulo, f.alvo],
    { encoding: 'utf8', timeout: 5000 });
    assert.equal(filho.status, 19, filho.stderr);
    const trava = adquirirTravaPortatil(f.alvo, 'recuperada', { esperarMs: 2000 });
    assert.ok(trava); trava.liberar();
    assert.deepEqual(donosDaTravaPortatil(f.alvo), []);
  } finally { f.limpar(); }
});

test('dois processos não ocupam a região crítica ao mesmo tempo', async () => {
  const f = fixture();
  try {
    const modulo = require.resolve('../src/trava-portatil');
    const registro = path.join(f.dir, 'regiao.log');
    const script = [
      `const fs=require('node:fs');`,
      `const t=require(process.argv[1]);`,
      `t.comTravaPortatil(process.argv[2],process.argv[3],()=>{`,
      `fs.appendFileSync(process.argv[4],process.argv[3]+':entra\\n');`,
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);`,
      `fs.appendFileSync(process.argv[4],process.argv[3]+':sai\\n');`,
      `},{esperarMs:3000});`,
    ].join('');
    const rodar = (nome: string) => spawn(process.execPath, ['-e', script, modulo, f.alvo, nome, registro], { stdio: 'pipe' });
    const a = rodar('a'), b = rodar('b');
    const aguardar = (p: ReturnType<typeof spawn>) => new Promise<number | null>((resolve, reject) => {
      let erro = ''; p.stderr?.on('data', (d) => { erro += d; });
      p.on('error', reject); p.on('close', (code) => code === 0 ? resolve(code) : reject(Error(erro)));
    });
    await Promise.all([aguardar(a), aguardar(b)]);
    const linhas = fs.readFileSync(registro, 'utf8').trim().split('\n');
    assert.ok(linhas.join(',') === 'a:entra,a:sai,b:entra,b:sai' || linhas.join(',') === 'b:entra,b:sai,a:entra,a:sai', linhas.join(','));
  } finally { f.limpar(); }
});

test('identidade desconhecida conserva candidato; identidade divergente permite limpeza', () => {
  const f = fixture();
  try {
    const identidades = new Map<number, string | null | undefined>([[process.pid, 'self']]);
    const primeira = adquirirTravaPortatil(f.alvo, 'primeira', { identidadeDoProcesso: (pid) => identidades.get(pid) });
    assert.ok(primeira);
    identidades.set(process.pid, undefined);
    assert.throws(() => adquirirTravaPortatil(f.alvo, 'sem-identidade', { identidadeDoProcesso: (pid) => identidades.get(pid) }), /indisponivel/);
    identidades.set(process.pid, 'self');
    primeira.liberar();
    comTravaPortatil(f.alvo, 'final', () => assert.equal(donosDaTravaPortatil(f.alvo, () => 'self').length, 1),
      { identidadeDoProcesso: () => 'self' });
  } finally { f.limpar(); }
});
