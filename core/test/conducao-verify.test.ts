/**
 * I-36 (RM-036, P2): os pontos de entrada que EXECUTAM na worktree tomam o lease de execucao.
 *
 * O caso de aceite e o incidente de 19/09/2026: dois `ork verify` na mesma worktree, por canais
 * diferentes. Aqui o primeiro roda de verdade num processo filho (o CLI), e o segundo, neste
 * processo, sai sem executar nada, dizendo quem conduz e o que fazer.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { adicionarClaim } from '../src/claims';
import { conducaoDaThread, ErroDeConducao, nomeDaConducao } from '../src/conducao';
import { abrirRodada } from '../src/fix';
import { lerLease } from '../src/leases';
import { lerLedger, registrar } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { dirThread, novaThread } from '../src/thread';
import { ExecutorVerify, verificar } from '../src/verify';
import { projetoTemporario, runtimeFalso } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

async function ate(condicao: () => boolean, ms: number, oque: string): Promise<void> {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${oque}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function contador(): { executor: ExecutorVerify; vezes: () => number } {
  let n = 0;
  return {
    executor: (nome, comando) => { n++; return { nome, comando, ok: true, code: 0, resumo: 'ok' }; },
    vezes: () => n,
  };
}

/** O primeiro condutor: `ork verify` do CLI num processo filho, com uma claim que leva alguns segundos. */
function verifyDoFilho(dir: string, thread: string, canal: string) {
  const filho = spawn(process.execPath, [CLI, 'verify', thread, '--so-claims'],
    { cwd: dir, env: { ...process.env, ORK_CANAL: canal }, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (b) => { saida += b; });
  filho.stderr.on('data', (b) => { saida += b; });
  return { filho, saida: () => saida };
}

test('dois ork verify na mesma worktree: so um executa, e o segundo sai sem executar nada, com quem conduz (CS1)', async () => {
  const p = projetoTemporario('conducao-dois-verify');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'dois verify', modo: 'auto' });
    adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'leva tempo', verificar: ['sleep 3 && echo primeiro'] });
    const primeiro = verifyDoFilho(p.dir, thread.id, 'claude-code');
    await ate(() => conducaoDaThread(p.dir, thread.id) !== null, 15_000, 'o primeiro verify tomar a conducao');

    const segundo = contador();
    assert.throws(() => verificar(p.carregado, thread.id, { soClaims: true, executor: segundo.executor, conducao: { canal: 'hermes' } }),
      (e: unknown) => {
        assert.ok(e instanceof ErroDeConducao);
        const r = e.recusa;
        assert.equal(r.motivo, 'conducao.em-andamento');
        assert.equal(r.conducao?.canal, 'claude-code');
        assert.equal(r.conducao?.operacao, 'verify');
        assert.equal(r.pedido.canal, 'hermes');
        assert.deepEqual(r.acoes.map((a) => a.acao), ['esperar', 'acompanhar', 'assumir']);
        assert.match(r.texto, /Pedido nao executado/);
        assert.match(r.texto, /Quem conduz: canal claude-code/);
        assert.match(r.texto, /ork conducao assumir/);
        return true;
      });
    assert.equal(segundo.vezes(), 0, 'o segundo pedido nao executou nenhum comando');

    const [codigo] = await once(primeiro.filho, 'exit');
    assert.equal(codigo, 0, primeiro.saida());
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    const rodadas = eventos.filter((e) => e.tipo === 'verify_run');
    assert.equal(rodadas.length, 1, 'uma rodada so, a do primeiro');
    assert.equal(rodadas[0].canal, 'claude-code');
    assert.equal(eventos.filter((e) => e.tipo === 'conducao_recusada').length, 1, 'o segundo pedido deixa rastro');

    // Livre de novo: o mesmo pedido agora executa.
    verificar(p.carregado, thread.id, { soClaims: true, executor: segundo.executor, conducao: { canal: 'hermes' } });
    assert.equal(segundo.vezes(), 1);
    assert.equal(conducaoDaThread(p.dir, thread.id), null, 'terminou, liberou');
  } finally { p.limpar(); }
});

test('--esperar espera a vez e segue sozinho quando a conducao termina (a opcao contraria da D2)', async () => {
  const p = projetoTemporario('conducao-esperar');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'esperar', modo: 'auto' });
    adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'leva tempo', verificar: ['sleep 2 && echo primeiro'] });
    const primeiro = verifyDoFilho(p.dir, thread.id, 'claude-code');
    await ate(() => conducaoDaThread(p.dir, thread.id) !== null, 15_000, 'o primeiro verify tomar a conducao');
    const segundo = contador();
    const antes = Date.now();
    verificar(p.carregado, thread.id, { soClaims: true, executor: segundo.executor, conducao: { canal: 'hermes', esperarMs: 60_000 } });
    assert.equal(segundo.vezes(), 1, 'depois da vez, executou');
    assert.ok(Date.now() - antes >= 500, 'esperou o primeiro terminar');
    const [codigo] = await once(primeiro.filho, 'exit');
    assert.equal(codigo, 0, primeiro.saida());
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'conducao_recusada').length, 0,
      'quem esperou nao foi recusado');
  } finally { p.limpar(); }
});

test('a sessao que conduz reentra pela identidade do despacho; outra identidade e recusada (D4, R3)', (t) => {
  const p = projetoTemporario('conducao-reentrada');
  const runtime = runtimeFalso('conducao-reentrada');
  const ambiente = { id: process.env.ORK_DISPATCH_ID, thread: process.env.ORK_DISPATCH_THREAD };
  t.after(() => {
    if (ambiente.id === undefined) delete process.env.ORK_DISPATCH_ID; else process.env.ORK_DISPATCH_ID = ambiente.id;
    if (ambiente.thread === undefined) delete process.env.ORK_DISPATCH_THREAD; else process.env.ORK_DISPATCH_THREAD = ambiente.thread;
    runtime.restaurar(); p.limpar();
  });
  const { thread } = novaThread(p.carregado, { nome: 'reentrada', modo: 'auto' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  assert.equal(r.sessionId, runtime.sessionId);
  const lease = lerLease(p.dir, nomeDaConducao(thread.id))!;
  const identidade = lease.conducao!.identidade;
  assert.equal(lease.conducao!.dono.tipo, 'sessao');
  // A sessao filha recebeu a identidade, a thread e o canal no ambiente.
  assert.equal(fs.readFileSync(path.join(runtime.dir, 'dispatch-id'), 'utf8'), identidade);
  assert.equal(fs.readFileSync(path.join(runtime.dir, 'canal'), 'utf8'), 'hermes');

  const passos = contador();
  const proprio = verificar(p.carregado, thread.id, { soClaims: true, executor: passos.executor, conducao: { identidade } });
  assert.equal(proprio.ok, true);
  // Pelo ambiente, como o CLI de dentro da sessao filha.
  process.env.ORK_DISPATCH_ID = identidade;
  process.env.ORK_DISPATCH_THREAD = thread.id;
  verificar(p.carregado, thread.id, { soClaims: true, executor: passos.executor });
  const rodadas = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'verify_run');
  assert.deepEqual(rodadas.map((e) => (e.conducao as { reentrada: boolean }).reentrada), [true, true]);
  delete process.env.ORK_DISPATCH_ID;
  assert.throws(() => verificar(p.carregado, thread.id, { soClaims: true, executor: passos.executor,
    conducao: { identidade: '11111111-2222-4333-8444-555555555555', canal: 'cli' } }), ErroDeConducao);
  assert.ok(conducaoDaThread(p.dir, thread.id), 'reentrar e ser recusado nao mexem na conducao da sessao');
});

test('fix open e retry run respeitam a conducao: nada executa nem e redespachado (T5, T6)', (t) => {
  const p = projetoTemporario('conducao-fix-retry');
  const runtime = runtimeFalso('conducao-fix-retry');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'fix e retry', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  assert.throws(() => abrirRodada(p.carregado, thread.id, { soClaims: true, conducao: { canal: 'cli' } }), ErroDeConducao);
  // Um gate tipado de conducao no ledger: o retry diz quem conduz e nao redespacha.
  registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', { gate: 'phase.dispatch', motivo: 'conducao.em-andamento',
    modo: 'auto', fase: 'GO', detalhe: 'fixture' });
  const chamadas = runtime.chamadas().length;
  const r = executarRetry(p.carregado, thread.id, {});
  assert.equal(r.executada, false);
  assert.match(r.detalhe, /conduzido agora por hermes/);
  assert.equal(runtime.chamadas().length, chamadas, 'nenhum redespacho no runtime');
});

test('CLI: a recusa sai com codigo 3, o texto para o humano, e --json com a mesma estrutura', (t) => {
  const p = projetoTemporario('conducao-cli');
  const runtime = runtimeFalso('conducao-cli');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'cli', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  const env = { ...process.env, ORK_CANAL: 'cli' };
  const texto = spawnSync(process.execPath, [CLI, 'verify', thread.id, '--so-claims'], { cwd: p.dir, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(texto.status, 3, texto.stderr);
  assert.match(texto.stdout, /Pedido nao executado/);
  assert.match(texto.stdout, /O que voce pode fazer:/);
  assert.match(texto.stdout, /--esperar 30/);
  const json = spawnSync(process.execPath, [CLI, 'verify', thread.id, '--so-claims', '--json'], { cwd: p.dir, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(json.status, 3, json.stderr);
  const recusa = JSON.parse(json.stdout);
  assert.equal(recusa.motivo, 'conducao.em-andamento');
  assert.equal(recusa.conducao.canal, 'hermes');
  assert.equal(recusa.conducao.sessao, runtime.sessionId);
  assert.equal(recusa.texto.split('\n')[1], texto.stdout.split('\n')[1], 'o texto e o JSON saem da mesma estrutura');
  const canal = spawnSync(process.execPath, [CLI, 'verify', thread.id, '--canal', 'telegram'], { cwd: p.dir, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(canal.status, 1);
  assert.match(canal.stderr, /conducao\.canal-desconhecido/);
});
