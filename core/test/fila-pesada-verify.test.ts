/**
 * RM-058 (N2, D10 da ork-rm058n2): `ork verify` e a baseline na fila de recursos pesados. O outro verify é um
 * processo de verdade segurando a vez da mesma raiz de estado, como o de outra worktree nesta máquina.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, envPtBr, projetoTemporario } from './apoio';
import { ErroDaFilaPesada, kernelDisponivel, OcupanteDaFila } from '../src/fila-pesada';
import { ESPERA_DA_FILA_PESADA_MS, ExecutorVerify, gravarBaseline, verificar } from '../src/verify';
import { ESPERA_DA_FILA_PESADA_MCP_MS, verificarMcp } from '../src/mcp-verify';
import { conducaoDaThread } from '../src/conducao';
import { lerLease } from '../src/leases';
import { lerLedger } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';

const MODULO = path.resolve(__dirname, '../src/fila-pesada');
const ORK = path.resolve(__dirname, '../../dist/index.js');
const semKernel = !kernelDisponivel();

/** Outro verify desta máquina: segura a vez da fila pesada da raiz por `ms` e avisa quando já está dentro. */
function outroVerify(raiz: string, ms: number): { filho: ChildProcess; dentro: Promise<void> } {
  const pronto = path.join(raiz, `.pronto-${process.hrtime.bigint()}`);
  const filho = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const { comRecursoPesado } = require(${JSON.stringify(MODULO)});
    comRecursoPesado(${JSON.stringify(raiz)}, { artefato: ${JSON.stringify(path.join(raiz, 'outra-worktree'))}, operacao: 'verify',
      thread: 'ork-outra', slots: 1, esperarMs: 60000 }, () => {
      fs.writeFileSync(${JSON.stringify(pronto)}, 'ok');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
    });
  `], { stdio: 'ignore' });
  const dentro = (async () => {
    const fim = Date.now() + 20000;
    while (!fs.existsSync(pronto)) {
      if (Date.now() > fim) assert.fail('o outro verify não pegou a vez');
      await new Promise(r => setTimeout(r, 25));
    }
  })();
  return { filho, dentro };
}

function encerrar(filho: ChildProcess): Promise<void> {
  if (filho.exitCode !== null || filho.signalCode !== null) return Promise.resolve();
  filho.kill('SIGKILL');
  return new Promise(r => filho.once('exit', () => r()));
}

test('V1: o verify de outra thread na mesma raiz espera a vez, avisa uma vez e roda quando ela volta', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v1');
  const outro = outroVerify(p.dir, 1500);
  try {
    const t = novaThread(p.carregado, { nome: 'espera a vez', modo: 'auto' }).thread;
    await outro.dentro;
    const avisos: OcupanteDaFila[][] = [];
    const r = verificar(p.carregado, t.id, { soClaims: true, conducao: { filaPesada: { aoEsperar: (o) => avisos.push(o) } } });
    assert.equal(r.filaPesada.situacao, 'adquirida');
    assert.ok(r.filaPesada.esperouMs >= 300, `esperou ${r.filaPesada.esperouMs} ms`);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0][0]?.thread, 'ork-outra');
    const rodada = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'verify_run').at(-1);
    assert.equal((rodada?.filaPesada as { situacao?: string } | undefined)?.situacao, 'adquirida', 'o verify_run diz que a rodada esperou a vez');
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V2: sem a vez no prazo, a recusa é tipada, nenhum comando roda, nada vai ao ledger e a condução volta', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v2');
  const outro = outroVerify(p.dir, 60000);
  try {
    const t = novaThread(p.carregado, { nome: 'sem a vez', modo: 'auto' }).thread;
    await outro.dentro;
    let comandos = 0;
    const executor: ExecutorVerify = (nome, comando) => { comandos++; return { nome, comando, ok: true, code: 0, resumo: '' }; };
    assert.throws(() => verificar(p.carregado, t.id, { executor, conducao: { filaPesada: { esperarMs: 600 } } }),
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.motivo === 'fila-pesada.ocupada' && e.recusa.thread === t.id &&
        /Quem ocupa: verify da thread ork-outra/.test(e.recusa.texto) && new RegExp(`ork verify ${t.id} --esperar 60`).test(e.recusa.texto));
    assert.equal(comandos, 0, 'nenhum comando do manifesto nem do preparo rodou');
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'verify_run'), false);
    assert.equal(conducaoDaThread(p.dir, t.id), null, 'a recusa devolve a condução da thread');
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V3: com max_parallel_heavy 0 a fila fica desligada e o verify roda junto', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v3');
  const outro = outroVerify(p.dir, 60000);
  try {
    const t = novaThread(p.carregado, { nome: 'fila desligada', modo: 'auto' }).thread;
    await outro.dentro;
    p.carregado.manifesto.concurrency.max_parallel_heavy = 0;
    const inicio = Date.now();
    const r = verificar(p.carregado, t.id, { soClaims: true, conducao: { filaPesada: { esperarMs: 600 } } });
    assert.equal(r.filaPesada.situacao, 'desligada');
    assert.ok(Date.now() - inicio < 15000);
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V4: a baseline também espera a vez, e sem ela não grava nada', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v4');
  const outro = outroVerify(p.dir, 60000);
  try {
    const t = novaThread(p.carregado, { nome: 'baseline na fila', modo: 'auto' }).thread;
    await outro.dentro;
    let comandos = 0;
    const executor: ExecutorVerify = (nome, comando) => { comandos++; return { nome, comando, ok: true, code: 0, resumo: '' }; };
    assert.throws(() => gravarBaseline(p.carregado, t.id, executor, { filaPesada: { esperarMs: 600 } }),
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.operacao === 'baseline' && /--baseline --esperar 60/.test(e.recusa.texto));
    assert.equal(comandos, 0);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'baseline_recorded'), false);
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V5: o CLI espera em primeiro plano, avisa no stderr e recusa com 3 dizendo quem ocupa', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v5');
  const outro = outroVerify(p.dir, 60000);
  try {
    const t = novaThread(p.carregado, { nome: 'pelo cli', modo: 'auto' }).thread;
    await outro.dentro;
    let codigo = 0, saida = '', erro = '';
    try {
      saida = execFileSync(process.execPath, [ORK, 'verify', t.id, '--so-claims', '--esperar', '0.02'],
        { cwd: p.dir, encoding: 'utf8', stdio: 'pipe', env: envPtBr() });
    } catch (e) {
      const x = e as { status?: number; stdout?: string; stderr?: string };
      codigo = x.status ?? -1; saida = x.stdout ?? ''; erro = x.stderr ?? '';
    }
    assert.equal(codigo, 3, `${saida}${erro}`);
    assert.match(saida, /Operação pesada não executada: verify da thread/);
    assert.match(saida, /Quem ocupa: verify da thread ork-outra/);
    assert.match(erro, /Esperando a vez na fila de recursos pesados \(concurrency\.max_parallel_heavy\) para o verify: ocupada por verify da thread ork-outra/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'verify_run'), false);
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V6: o MCP espera no máximo o teto dele, e a recusa devolve a lease da worktree', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v6');
  const outro = outroVerify(p.dir, 60000);
  try {
    assert.equal(ESPERA_DA_FILA_PESADA_MCP_MS, 20_000);
    assert.equal(ESPERA_DA_FILA_PESADA_MS, 60 * 60 * 1000);
    const { thread } = novaThread(p.carregado, { nome: 'pelo mcp', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'produto.md', 'produto\n', 'produto');
    await outro.dentro;
    assert.throws(() => verificarMcp(p.dir, thread.id, { filaPesada: { esperarMs: 600 } }),
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.motivo === 'fila-pesada.ocupada');
    assert.equal(lerLease(p.dir, `worktree-write:${thread.id}`), null, 'a lease da worktree foi devolvida');
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'verify_run'), false);
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V7: concurrency.max_parallel_heavy vem do manifesto, com padrão 1, 0 desliga e valor sem sentido volta a 1', () => {
  const p = projetoTemporario('fila-pesada-v7');
  try {
    const manifesto = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(manifesto, 'utf8');
    assert.equal(exigirManifesto(p.dir).manifesto.concurrency.max_parallel_heavy, 1, 'sem a chave, uma operação pesada por vez');
    for (const [valor, esperado] of [['0', 0], ['2', 2], ['100', 64], ['-1', 1], ['muitos', 1], ['.inf', 1]] as const) {
      fs.writeFileSync(manifesto, original.replace(/^concurrency:\n/m, `concurrency:\n  max_parallel_heavy: ${valor}\n`));
      assert.equal(exigirManifesto(p.dir).manifesto.concurrency.max_parallel_heavy, esperado, `max_parallel_heavy: ${valor}`);
    }
  } finally { p.limpar(); }
});
