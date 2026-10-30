/**
 * RM-058 (N2, D10 da ork-rm058n2): `ork verify` e a baseline na fila de recursos pesados. O outro verify é um
 * processo de verdade segurando a vez da mesma raiz de estado, como o de outra worktree nesta máquina.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, envPtBr, projetoTemporario, shaDaBranch } from './apoio';
import { adicionarClaim } from '../src/claims';
import { ENV_DONO_DA_FILA, ErroDaFilaPesada, kernelDisponivel, OcupanteDaFila } from '../src/fila-pesada';
import { ESPERA_DA_FILA_PESADA_MS, ESPERA_PADRAO_DA_FILA_PESADA_MS, ExecutorVerify, gravarBaseline, textoDoVerify,
  verificar } from '../src/verify';
import { ESPERA_DA_FILA_PESADA_MCP_MS } from '../src/mcp-verify';
import { criarServidorMcp } from '../src/mcp-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { conducaoDaThread } from '../src/conducao';
import { LEASE_MAIN_TREE, lerLease } from '../src/leases';
import { lerLedger } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import { ship } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { rodarFase } from '../src/phase';
import { controllerSimulado } from './controller-simulado';
import { exec } from '../src/util';

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
    // Pela biblioteca, ninguém disse que comando repete o pedido: a recusa não inventa um.
    assert.throws(() => verificar(p.carregado, t.id, { executor, conducao: { filaPesada: { esperarMs: 600 } } }),
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.motivo === 'fila-pesada.ocupada' && e.recusa.thread === t.id &&
        /Quem ocupa: verify da thread ork-outra/.test(e.recusa.texto) && !/--esperar/.test(e.recusa.texto));
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
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.operacao === 'baseline' && e.recusa.thread === t.id);
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
    const inicio = Date.now();
    try {
      // `--esperar 0.02` é pouco mais de um segundo: o CLI que ignorasse o prazo ficaria a hora inteira.
      saida = execFileSync(process.execPath, [ORK, 'verify', t.id, '--so-claims', '--esperar', '0.02'],
        { cwd: p.dir, encoding: 'utf8', stdio: 'pipe', env: envPtBr(), timeout: 30000 });
    } catch (e) {
      const x = e as { status?: number; stdout?: string; stderr?: string };
      codigo = x.status ?? -1; saida = x.stdout ?? ''; erro = x.stderr ?? '';
    }
    assert.equal(codigo, 3, `${saida}${erro}`);
    assert.ok(Date.now() - inicio < 20000, `levou ${Date.now() - inicio} ms`);
    assert.match(saida, /Operação pesada não executada: verify da thread/);
    assert.match(saida, /Quem ocupa: verify da thread ork-outra/);
    assert.match(saida, new RegExp(`ork verify ${t.id} --esperar 120`));
    assert.match(erro, /Esperando a vez na fila de recursos pesados \(concurrency\.max_parallel_heavy\) para o verify: ocupada por verify da thread ork-outra/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'verify_run'), false);
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V6: o verify assíncrono inicia já, espera no máximo o teto MCP e o status devolve a recusa tipada', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v6');
  const outro = outroVerify(p.dir, 90000);
  const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    assert.equal(ESPERA_DA_FILA_PESADA_MCP_MS, 20_000);
    assert.equal(ESPERA_DA_FILA_PESADA_MS, 60 * 60 * 1000);
    assert.equal(ESPERA_PADRAO_DA_FILA_PESADA_MS, 30_000);
    const { thread } = novaThread(p.carregado, { nome: 'pelo mcp', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'produto.md', 'produto\n', 'produto');
    await outro.dentro;
    // A chamada curta só inicia. O worker conserva o teto MCP de 20 s e a lease enquanto espera;
    // a consulta terminal carrega a mesma recusa tipada que o CLI síncrono.
    const inicio = Date.now();
    const r = await client.callTool({ name: 'ork_verify', arguments: { threadId: thread.id } });
    assert.ok(Date.now() - inicio < 2_000, `início levou ${Date.now() - inicio} ms`);
    assert.notEqual(r.isError, true);
    const iniciada = JSON.parse((r.content as { type: string; text: string }[]).map((c) => c.text).join(''));
    assert.equal(iniciada.estado, 'na-fila');
    assert.ok(lerLease(p.dir, `worktree-write:${thread.id}`), 'a rodada segura a lease enquanto espera');
    let terminal: any, respostaTerminal: any;
    const ate = Date.now() + 30_000;
    do {
      respostaTerminal = await client.callTool({ name: 'ork_verify_status', arguments: { threadId: thread.id, rodadaId: iniciada.rodadaId } });
      terminal = JSON.parse((respostaTerminal.content as { type: string; text: string }[]).map((c) => c.text).join(''));
      if (terminal.estado !== 'falhou') await new Promise((resolve) => setTimeout(resolve, 50));
    } while (terminal.estado !== 'falhou' && Date.now() < ate);
    const levou = Date.now() - inicio;
    assert.ok(levou >= 19_000 && levou < 29_000, `terminal levou ${levou} ms`);
    assert.equal(respostaTerminal.isError, true);
    assert.equal(terminal.falha.motivo, 'fila-pesada.ocupada');
    const recusa = terminal.falha.recusa;
    assert.equal(recusa.contrato, 'ork.fila-pesada-recusa/v1', 'a mesma recusa tipada do CLI, e não um erro genérico');
    assert.equal(recusa.motivo, 'fila-pesada.ocupada');
    assert.equal(recusa.ocupantes[0]?.thread, 'ork-outra');
    assert.equal(lerLease(p.dir, `worktree-write:${thread.id}`), null, 'a lease da worktree foi devolvida');
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'verify_run'), false);
  } finally { await client.close(); await server.close(); await encerrar(outro.filho); p.limpar(); }
});

test('V7: concurrency.max_parallel_heavy vem do manifesto, com padrão 1, 0 desliga e valor sem sentido volta a 1', () => {
  const p = projetoTemporario('fila-pesada-v7');
  try {
    const manifesto = path.join(p.dir, 'orkastery.yaml');
    const original = fs.readFileSync(manifesto, 'utf8');
    assert.equal(exigirManifesto(p.dir).manifesto.concurrency.max_parallel_heavy, 1, 'sem a chave, uma operação pesada por vez');
    // Fração nunca desliga a fila: 0.5 e 0.99 voltam a 1, e 2.7 fica 2.
    for (const [valor, esperado] of [['0', 0], ['2', 2], ['100', 64], ['-1', 1], ['muitos', 1], ['.inf', 1], ['0.5', 1],
      ['0.99', 1], ['2.7', 2]] as const) {
      fs.writeFileSync(manifesto, original.replace(/^concurrency:\n/m, `concurrency:\n  max_parallel_heavy: ${valor}\n`));
      assert.equal(exigirManifesto(p.dir).manifesto.concurrency.max_parallel_heavy, esperado, `max_parallel_heavy: ${valor}`);
    }
  } finally { p.limpar(); }
});

test('V8: o verify aninhado na claim de quem segura a vez entra como reentrada, sem esperar a vaga do pai', { skip: semKernel }, () => {
  const p = projetoTemporario('fila-pesada-v8');
  try {
    const antes = process.env[ENV_DONO_DA_FILA];
    const pai = novaThread(p.carregado, { nome: 'verifica a outra', modo: 'auto' }).thread;
    const outra = novaThread(p.carregado, { nome: 'verificada por dentro', modo: 'auto' }).thread;
    // A claim roda o verify de outra thread do mesmo projeto, como a de um `ci prepare` de outra frente. O prazo
    // curto do filho faz a regressão aparecer como recusa em segundos, e não no prazo do comando.
    const comando = `env -u ORK_PROJETO "${process.execPath}" "${ORK}" verify ${outra.id} --so-claims --esperar 0.05`;
    adicionarClaim(p.dir, pai.id, { arquivo: 'README.md', alegacao: 'o verify da outra thread roda dentro da vez', verificar: [comando] });
    const r = verificar(p.carregado, pai.id, { soClaims: true });
    assert.equal(r.ok, true, textoDoVerify(r));
    assert.equal(r.filaPesada.situacao, 'adquirida');
    const daOutra = lerLedger(dirThread(p.dir, outra.id)).filter(e => e.tipo === 'verify_run').at(-1);
    assert.equal((daOutra?.filaPesada as { situacao?: string } | undefined)?.situacao, 'reentrada', 'o filho entrou na vez do pai');
    assert.equal(process.env[ENV_DONO_DA_FILA], antes, 'a marca da posse sai do ambiente quando a vez volta');
  } finally { p.limpar(); }
});

test('V9: o ship espera a fila só o prazo que recebe e recusa tipado, sem verify_run, sem merge e sem lease', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v9', true);
  const outro = outroVerify(p.dir, 60000);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'ship na fila', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', 'entrega\n', 'feat: entrega');
    await outro.dentro;
    const mainAntes = shaDaBranch(p.dir, 'main');
    const inicio = Date.now();
    assert.throws(() => ship(p.carregado, thread.id, { para: 'main', esperarFilaPesadaMs: 800 }),
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.motivo === 'fila-pesada.ocupada' && e.recusa.thread === thread.id);
    assert.ok(Date.now() - inicio < 15000, `levou ${Date.now() - inicio} ms`);
    assert.equal(shaDaBranch(p.dir, 'main'), mainAntes, 'nada foi mergeado');
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'verify_run'), false);
    assert.equal(lerLease(p.dir, LEASE_MAIN_TREE), null);
    assert.equal(conducaoDaThread(p.dir, thread.id), null, 'a recusa devolve a condução da thread');
  } finally { await encerrar(outro.filho); p.limpar(); }
});

/** Roda o CLI com a vez da fila pesada ocupada; devolve saída, código e tempo. */
function cliNaFila(dir: string, args: string[]): { codigo: number; saida: string; erro: string; levouMs: number } {
  const inicio = Date.now();
  try {
    const saida = execFileSync(process.execPath, [ORK, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: envPtBr(), timeout: 30000 });
    return { codigo: 0, saida, erro: '', levouMs: Date.now() - inicio };
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string };
    return { codigo: x.status ?? -1, saida: x.stdout ?? '', erro: x.stderr ?? '', levouMs: Date.now() - inicio };
  }
}

test('V10: o ork ship do CLI leva o --esperar à fila pesada, avisa no stderr e sugere o comando com mais espera', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v10', true);
  const outro = outroVerify(p.dir, 60000);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'ship pelo cli', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', 'entrega\n', 'feat: entrega');
    await outro.dentro;
    const mainAntes = shaDaBranch(p.dir, 'main');
    // `--esperar 0.02` é pouco mais de um segundo, bem menos que os 30 s do padrão de quem verifica por dentro.
    const r = cliNaFila(p.dir, ['ship', thread.id, '--para', 'main', '--esperar', '0.02']);
    assert.equal(r.codigo, 3, `${r.saida}${r.erro}`);
    assert.ok(r.levouMs < 20000, `levou ${r.levouMs} ms`);
    assert.match(r.erro, /Esperando a vez na fila de recursos pesados/);
    assert.match(r.saida, new RegExp(`ork ship ${thread.id} --para main --esperar 30`));
    assert.equal(shaDaBranch(p.dir, 'main'), mainAntes, 'nada foi mergeado');
  } finally { await encerrar(outro.filho); p.limpar(); }
});

test('V11: a baseline que o phase run grava espera a fila com o prazo e o aviso dele, e recusa sem despachar', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v11');
  const f = controllerSimulado(p.dir);
  const outro = outroVerify(p.dir, 60000);
  try {
    fs.writeFileSync(path.join(p.dir, '.gitignore'), 'fake-bin/\nruntime/\n');
    exec('git', ['add', '-A'], p.dir);
    exec('git', ['commit', '-m', 'base do teste com os stubs ignorados'], p.dir);
    p.carregado.manifesto.runtime.sandbox = 'workspace-write';
    const t = novaThread(p.carregado, { nome: 'baseline do despacho na fila', modo: 'auto' }).thread;
    await outro.dentro;
    const avisos: OcupanteDaFila[][] = [];
    const inicio = Date.now();
    assert.throws(() => rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'bloco SIMULADO', runtime: 'codex', model: 'modelo-SIMULADO',
      filaPesada: { esperarMs: 600, aoEsperar: (o) => avisos.push(o), comandoDeEsperar: `ork verify ${t.id} --baseline --esperar 120` } }),
      (e: unknown) => e instanceof ErroDaFilaPesada && e.recusa.operacao === 'baseline' &&
        new RegExp(`ork verify ${t.id} --baseline --esperar 120`).test(e.recusa.texto));
    assert.ok(Date.now() - inicio < 15000, `levou ${Date.now() - inicio} ms`);
    assert.equal(avisos.length, 1, 'avisa uma vez quem ocupa');
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.some(e => e.tipo === 'phase_dispatch' || e.tipo === 'baseline_recorded'), false, 'nem baseline nem despacho');
    assert.equal(conducaoDaThread(p.dir, t.id), null, 'a recusa devolve a condução retida');
  } finally { await encerrar(outro.filho); f.restaurar(); p.limpar(); }
});

test('V12: o ork fix do CLI leva o --esperar à fila pesada da verificação dele e sugere o comando com mais espera', { skip: semKernel }, async () => {
  const p = projetoTemporario('fila-pesada-v12');
  const outro = outroVerify(p.dir, 60000);
  try {
    const t = novaThread(p.carregado, { nome: 'fix na fila', modo: 'auto' }).thread;
    await outro.dentro;
    const r = cliNaFila(p.dir, ['fix', 'open', t.id, '--so-claims', '--esperar', '0.02']);
    assert.equal(r.codigo, 3, `${r.saida}${r.erro}`);
    assert.ok(r.levouMs < 20000, `levou ${r.levouMs} ms`);
    assert.match(r.erro, /Esperando a vez na fila de recursos pesados/);
    assert.match(r.saida, new RegExp(`ork fix open ${t.id} --esperar 30`));
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'verify_run'), false);
  } finally { await encerrar(outro.filho); p.limpar(); }
});
