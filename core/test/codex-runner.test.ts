import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';
import { estadoProcesso, identidadeProcesso, iniciarSupervisor, ReciboCodex, ProcessoCodex } from '../src/adapters/codex-runner';
const wait = async (file: string) => {
  for (let n = 0; n < 200 && !fs.existsSync(file); n++) await new Promise(r => setTimeout(r, 25));
  assert.ok(fs.existsSync(file), file); return JSON.parse(fs.readFileSync(file, 'utf8'));
};

test('supervisor sobrevive ao dispatcher e grava saída real não zero com arquivos restritos', async () => {
  const dir = dirTemporario('supervisor');
  try {
    const log = path.join(dir, 'run.jsonl');
    const script = `require(${JSON.stringify(require.resolve('../src/adapters/codex-runner'))}).iniciarSupervisor(${JSON.stringify([
      process.execPath, '-e', 'console.log(JSON.stringify({type:"thread.started",thread_id:"fixture"})); setTimeout(()=>process.exit(7),200);',
    ])},${JSON.stringify(dir)},${JSON.stringify(log)},process.env);`;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 1000 });
    assert.equal(r.status, 0, r.stderr);
    const recibo: ReciboCodex = await wait(log + '.exit.json');
    assert.equal(recibo.exitCode, 7); assert.equal(recibo.signal, null); assert.ok(recibo.duracaoMs >= 200);
    assert.ok(recibo.filho?.inicio); assert.ok(recibo.supervisor?.inicio);
    assert.match(fs.readFileSync(log, 'utf8'), /thread.started/);
    for (const f of [log, log + '.exit.json', log + '.process.json']) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.launch') || f.endsWith('.tmp')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sinal do filho fica no recibo; PID desconhecido e reutilizado não viram processo vivo', async () => {
  const dir = dirTemporario('supervisor-sinal');
  try {
    const log = path.join(dir, 'run.jsonl');
    const p = iniciarSupervisor([process.execPath, '-e', 'setInterval(()=>{},1000)'], dir, log, process.env);
    const dados: ProcessoCodex = await wait(p.processoPath);
    assert.ok(dados.filho); assert.equal(estadoProcesso(dados.filho), 'vivo');
    process.kill(dados.filho.pid, 'SIGTERM');
    const recibo: ReciboCodex = await wait(p.reciboPath);
    assert.equal(recibo.exitCode, null); assert.equal(recibo.signal, 'SIGTERM');
    assert.equal(estadoProcesso(null), 'desconhecido');
    assert.equal(estadoProcesso({ ...identidadeProcesso(process.pid)!, inicio: '0' }), 'ausente');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('morte abrupta do supervisor não produz exitCode zero presumido', async () => {
  const dir = dirTemporario('supervisor-kill');
  let filho: number | undefined;
  try {
    const log = path.join(dir, 'run.jsonl');
    const p = iniciarSupervisor([process.execPath, '-e', 'setInterval(()=>{},1000)'], dir, log, process.env);
    const dados: ProcessoCodex = await wait(p.processoPath);
    filho = dados.filho?.pid; assert.ok(dados.supervisor);
    process.kill(dados.supervisor.pid, 'SIGKILL');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(fs.existsSync(p.reciboPath), false); assert.equal(estadoProcesso(dados.filho), 'vivo');
  } finally {
    if (filho) try { process.kill(filho, 'SIGKILL'); } catch { /* terminou */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
