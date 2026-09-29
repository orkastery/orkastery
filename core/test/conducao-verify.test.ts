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
  const ambiente = { id: process.env.ORK_DISPATCH_ID, thread: process.env.ORK_DISPATCH_THREAD, sessao: process.env.CLAUDE_CODE_SESSION_ID };
  t.after(() => {
    if (ambiente.id === undefined) delete process.env.ORK_DISPATCH_ID; else process.env.ORK_DISPATCH_ID = ambiente.id;
    if (ambiente.thread === undefined) delete process.env.ORK_DISPATCH_THREAD; else process.env.ORK_DISPATCH_THREAD = ambiente.thread;
    if (ambiente.sessao === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = ambiente.sessao;
    runtime.restaurar(); p.limpar();
  });
  const { thread } = novaThread(p.carregado, { nome: 'reentrada', modo: 'auto' });
  const r = rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  assert.equal(r.sessionId, runtime.sessionId);
  const lease = lerLease(p.dir, nomeDaConducao(thread.id))!;
  const identidade = lease.conducao!.identidade;
  assert.equal(lease.conducao!.dono.tipo, 'sessao');
  // RM-037 (defeitosdeco D-4): a sessao filha recebe a identidade, a thread e o canal POR SESSAO, em
  // `--settings`; o ambiente do processo `claude` (o que o daemon da conta guardaria) vem sem eles.
  const settings = JSON.parse(fs.readFileSync(path.join(runtime.dir, 'settings'), 'utf8')) as { env: Record<string, string> };
  assert.deepEqual(settings.env, { ORK_DISPATCH_ID: identidade, ORK_DISPATCH_THREAD: thread.id, ORK_CANAL: 'hermes' });
  assert.equal(fs.readFileSync(path.join(runtime.dir, 'dispatch-id'), 'utf8'), '');
  assert.equal(fs.readFileSync(path.join(runtime.dir, 'canal'), 'utf8'), '');

  const passos = contador();
  const proprio = verificar(p.carregado, thread.id, { soClaims: true, executor: passos.executor, conducao: { identidade } });
  assert.equal(proprio.ok, true);
  // Pelo ambiente, como o CLI de dentro da sessao filha: o Claude Code poe o UUID da sessao em cada uma.
  process.env.ORK_DISPATCH_ID = identidade;
  process.env.ORK_DISPATCH_THREAD = thread.id;
  process.env.CLAUDE_CODE_SESSION_ID = runtime.sessionId;
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

// ---------------------------------------------------------------------------
// RM-037 (defeitosdeco D-4): a sessao do PLAN da ork-i36buscasema nasceu com ORK_DISPATCH_THREAD de
// outra thread. O `claude --bg` entrega a sessao a um processo reserva do daemon da conta, e o daemon
// guarda o ambiente do primeiro despacho. O contexto passa a chegar por sessao, e o CLI de dentro de
// uma sessao Claude se reconhece pelo ledger, nunca pelo par herdado.
// ---------------------------------------------------------------------------
import { identidadeDoAmbiente } from '../src/conducao';
import { despachar } from '../src/adapters/claude-bg';

const SESSAO_A = 'aaaaaaaa-1111-4111-8111-111111111111', SESSAO_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const ID_A = 'a0a0a0a0-1111-4111-8111-aaaaaaaaaaaa', ID_B = 'b0b0b0b0-2222-4222-8222-bbbbbbbbbbbb';

function duasThreads(p: ReturnType<typeof projetoTemporario>) {
  const a = novaThread(p.carregado, { nome: 'thread a', modo: 'auto' }).thread;
  const b = novaThread(p.carregado, { nome: 'thread b', modo: 'auto' }).thread;
  registrar(dirThread(p.dir, a.id), a.id, 'phase_dispatch', { fase: 'GO', runtime: 'claude-bg', sessionId: SESSAO_A,
    identidade: { schema: 'ork.dispatch-identity/v1', dispatchId: ID_A, threadId: a.id, role: 'executor' } });
  registrar(dirThread(p.dir, b.id), b.id, 'phase_dispatch', { fase: 'GO', runtime: 'claude-bg', sessionId: SESSAO_B,
    identidade: { schema: 'ork.dispatch-identity/v1', dispatchId: ID_B, threadId: b.id, role: 'executor' } });
  return { a, b };
}

test('defeitosdeco D-4: par de despacho vazado de outra thread nao vale; a sessao se reconhece pelo ledger', () => {
  const p = projetoTemporario('contexto-vazado');
  try {
    const { a, b } = duasThreads(p);
    // A sessao B herdou do daemon o par do despacho A, como a f15c7158 herdou o da ork-i31kg1contra.
    const vazado = { ORK_DISPATCH_ID: ID_A, ORK_DISPATCH_THREAD: a.id, CLAUDE_CODE_SESSION_ID: SESSAO_B };
    assert.equal(identidadeDoAmbiente(a.id, vazado, p.dir), null, 'nunca a identidade de outra sessao');
    assert.equal(identidadeDoAmbiente(b.id, vazado, p.dir), ID_B, 'a propria, pelo phase_dispatch da sessao');
    // A sessao A, com o par certo, reentra como antes.
    assert.equal(identidadeDoAmbiente(a.id, { ORK_DISPATCH_ID: ID_A, ORK_DISPATCH_THREAD: a.id, CLAUDE_CODE_SESSION_ID: SESSAO_A }, p.dir), ID_A);
    // Fora de sessao Claude, o ambiente vale como antes.
    assert.equal(identidadeDoAmbiente(a.id, { ORK_DISPATCH_ID: ID_A, ORK_DISPATCH_THREAD: a.id }, p.dir), ID_A);
    // Despacho codex dentro de uma conducao Claude: o CLAUDE_CODE_SESSION_ID herdado e o da condutora.
    const c = novaThread(p.carregado, { nome: 'thread codex', modo: 'auto' }).thread;
    const idC = 'c0c0c0c0-3333-4333-8333-cccccccccccc';
    registrar(dirThread(p.dir, c.id), c.id, 'phase_dispatch', { fase: 'GO', runtime: 'codex', sessionId: '019a0000-0000-7000-8000-000000000001',
      identidade: { schema: 'ork.dispatch-identity/v1', dispatchId: idC, threadId: c.id, role: 'executor' } });
    assert.equal(identidadeDoAmbiente(c.id, { ORK_DISPATCH_ID: idC, ORK_DISPATCH_THREAD: c.id, CLAUDE_CODE_SESSION_ID: SESSAO_B }, p.dir), idC);
  } finally { p.limpar(); }
});

test('defeitosdeco D-4: com o par vazado, o verify do CLI nao reentra a conducao da outra thread', (t) => {
  const p = projetoTemporario('contexto-vazado-verify');
  const runtime = runtimeFalso('contexto-vazado-verify');
  const antes = { id: process.env.ORK_DISPATCH_ID, thread: process.env.ORK_DISPATCH_THREAD, sessao: process.env.CLAUDE_CODE_SESSION_ID };
  t.after(() => {
    for (const [k, v] of [['ORK_DISPATCH_ID', antes.id], ['ORK_DISPATCH_THREAD', antes.thread], ['CLAUDE_CODE_SESSION_ID', antes.sessao]] as const)
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    runtime.restaurar(); p.limpar();
  });
  const { thread } = novaThread(p.carregado, { nome: 'conduzida', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'cli' });
  const identidade = lerLease(p.dir, nomeDaConducao(thread.id))!.conducao!.identidade;
  // Outra sessao Claude, com o par desta thread herdado do daemon.
  process.env.ORK_DISPATCH_ID = identidade;
  process.env.ORK_DISPATCH_THREAD = thread.id;
  process.env.CLAUDE_CODE_SESSION_ID = SESSAO_B;
  const passos = contador();
  assert.throws(() => verificar(p.carregado, thread.id, { soClaims: true, executor: passos.executor }), ErroDeConducao);
  assert.equal(passos.vezes(), 0, 'nada executou sob a conducao alheia');
  // A sessao que de fato conduz reentra.
  process.env.CLAUDE_CODE_SESSION_ID = runtime.sessionId;
  assert.equal(verificar(p.carregado, thread.id, { soClaims: true, executor: passos.executor }).ok, true);
});

test('defeitosdeco D-4: o processo claude --bg nasce sem identidade de despacho; o contexto vai em --settings', (t) => {
  const runtime = runtimeFalso('contexto-settings');
  const antes = { id: process.env.ORK_DISPATCH_ID, thread: process.env.ORK_DISPATCH_THREAD, canal: process.env.ORK_CANAL };
  t.after(() => {
    for (const [k, v] of [['ORK_DISPATCH_ID', antes.id], ['ORK_DISPATCH_THREAD', antes.thread], ['ORK_CANAL', antes.canal]] as const)
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    runtime.restaurar();
  });
  // Quem despacha tambem pode estar com o par vazado; ele nao passa adiante.
  process.env.ORK_DISPATCH_ID = ID_A; process.env.ORK_DISPATCH_THREAD = 'ork-outra'; process.env.ORK_CANAL = 'cli';
  const r = despachar({ prompt: 'fase', nome: 'ork-x-go', cwd: runtime.dir,
    ambienteExtra: { ORK_DISPATCH_ID: ID_B, ORK_DISPATCH_THREAD: 'ork-desta', ORK_CANAL: 'hermes' } });
  assert.equal(r.ok, true, r.erro);
  const i = r.comando.indexOf('--settings');
  assert.ok(i > 0, 'o comando leva --settings');
  assert.deepEqual(JSON.parse(r.comando[i + 1]), { env: { ORK_DISPATCH_ID: ID_B, ORK_DISPATCH_THREAD: 'ork-desta', ORK_CANAL: 'hermes' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runtime.dir, 'settings'), 'utf8')).env.ORK_DISPATCH_THREAD, 'ork-desta');
  for (const arquivo of ['dispatch-id', 'dispatch-thread', 'canal'])
    assert.equal(fs.readFileSync(path.join(runtime.dir, arquivo), 'utf8'), '', `${arquivo} fora do ambiente do processo claude`);
});
