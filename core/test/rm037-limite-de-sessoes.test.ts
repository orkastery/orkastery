/**
 * RM-037 (rm037defeito, defeito 3): com `max_parallel_threads: 5`, um sexto `ork phase run` saiu as
 * 09h03 de 29/09/2026 com cinco sessoes vivas de outras threads. O despacho nao consultava vaga
 * nenhuma. Sessao viva e a conducao `exec:<thread>` com dono `sessao`, de qualquer runtime ou conta.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ajustarManifesto, projetoTemporario, runtimePorConta } from './apoio';
import { vagaDoDespacho } from '../src/board';
import { conducaoDaThread, registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { lerLedger, registrar } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { dirThread, novaThread } from '../src/thread';

const ORK = path.resolve(__dirname, '../../dist/index.js');

/** Uma thread com sessao viva: a conducao do despacho convertida em sessao, como o `phase run` deixa. */
function threadComSessaoViva(p: ReturnType<typeof projetoTemporario>, nome: string, runtime: string, n: number) {
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GO', prazoMs: 3600_000 },
    { sessionId, runtime, perfil: null }), true);
  return { id: t.id, sessionId };
}

test('defeito 3: no limite, o phase run recusa com concurrency.limite, diz quem ocupa e nao abre sessao', () => {
  const p = projetoTemporario('rm037-limite');
  const claude = runtimePorConta('rm037-limite');
  try {
    claude.conta(p.dir, 'a');
    p.carregado.manifesto.concurrency.max_parallel_threads = 2;
    const vivas = [threadComSessaoViva(p, 'viva codex', 'codex', 1), threadComSessaoViva(p, 'viva claude', 'claude-bg', 2)];
    const nova = novaThread(p.carregado, { nome: 'terceira', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, nova.id);

    const ensaio = rodarFase(p.carregado, nova.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO', dryRun: true });
    assert.equal(ensaio.motivo, 'concurrency.limite', 'o ensaio diz a verdade');
    assert.equal(lerLedger(dir).some(e => e.tipo === 'slot_refused'), false, 'o ensaio nao grava');

    const r = rodarFase(p.carregado, nova.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'concurrency.limite');
    assert.equal(r.sessionId, null);
    assert.match(r.erro ?? '', /2 sessao\(oes\) viva\(s\) em outras threads e o limite e 2/);
    for (const v of vivas) assert.match(r.erro ?? '', new RegExp(v.id));
    const eventos = lerLedger(dir);
    const recusa = eventos.find(e => e.tipo === 'slot_refused');
    assert.ok(recusa, 'a recusa fica no ledger');
    assert.deepEqual((recusa!.ocupam as { thread: string }[]).map(o => o.thread).sort(), vivas.map(v => v.id).sort());
    assert.equal(eventos.some(e => e.tipo === 'phase_dispatch'), false, 'nenhuma sessao aberta');
    assert.equal(conducaoDaThread(p.dir, nova.id), null, 'a thread recusada nao toma conducao');
    assert.equal(claude.envs().some(l => l.startsWith('--bg ')), false, 'o runtime nem foi chamado');

    // A sessao viva que terminou devolve a vaga: o mesmo pedido agora sai.
    registrar(dirThread(p.dir, vivas[0].id), vivas[0].id, 'phase_result', { fase: 'GO', sessionId: vivas[0].sessionId });
    assert.equal(vagaDoDespacho(p.carregado, nova.id), null);
    const depois = rodarFase(p.carregado, nova.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO' });
    assert.equal(depois.verificada, true, depois.erro);
  } finally { p.limpar(); claude.restaurar(); }
});

test('defeito 3: a propria thread e thread fechada nao contam; abaixo do limite o despacho segue', () => {
  const p = projetoTemporario('rm037-limite-proprio');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const propria = threadComSessaoViva(p, 'propria', 'codex', 7);
    assert.equal(vagaDoDespacho(p.carregado, propria.id), null, 'a conducao da propria thread tem portao proprio');
    const outra = novaThread(p.carregado, { nome: 'outra', modo: 'auto' }).thread;
    assert.equal(vagaDoDespacho(p.carregado, outra.id)?.ocupam.length, 1);
    p.carregado.manifesto.concurrency.max_parallel_threads = 2;
    assert.equal(vagaDoDespacho(p.carregado, outra.id), null);
  } finally { p.limpar(); }
});

test('defeito 3: com --esperar, o despacho espera a vaga liberar e sai sem recusa', () => {
  const p = projetoTemporario('rm037-limite-esperar');
  const claude = runtimePorConta('rm037-limite-esperar');
  try {
    claude.conta(p.dir, 'a');
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const viva = threadComSessaoViva(p, 'viva', 'codex', 9);
    const nova = novaThread(p.carregado, { nome: 'espera', modo: 'auto' }).thread;
    // Outro processo encerra a sessao viva daqui a pouco, enquanto o despacho espera.
    const ledger = path.resolve(__dirname, '../src/ledger');
    const filho = spawn(process.execPath, ['-e', `setTimeout(() => require(${JSON.stringify(ledger)}).registrar(` +
      `${JSON.stringify(dirThread(p.dir, viva.id))}, ${JSON.stringify(viva.id)}, 'phase_result', ` +
      `{ fase: 'GO', sessionId: ${JSON.stringify(viva.sessionId)} }), 1500)`], { stdio: 'ignore' });
    const inicio = Date.now();
    const r = rodarFase(p.carregado, nova.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO', esperarMs: 30_000 });
    filho.kill();
    assert.equal(r.verificada, true, r.erro);
    assert.ok(Date.now() - inicio >= 1000, 'esperou a vaga');
    assert.equal(lerLedger(dirThread(p.dir, nova.id)).some(e => e.tipo === 'slot_refused'), false, 'a espera nao grava recusa');
  } finally { p.limpar(); claude.restaurar(); }
});

// GO-FIX do CHECK 1 (B1, A1, S1, S3).

test('defeito 3 (B1): o CLI diz quem ocupa, cita slot_refused e sai com 3, a espera', () => {
  const p = projetoTemporario('rm037-limite-cli');
  try {
    ajustarManifesto(p, 'max_parallel_threads: 3', 'max_parallel_threads: 1');
    const viva = threadComSessaoViva(p, 'viva', 'codex', 11);
    const nova = novaThread(p.carregado, { nome: 'pelo cli', modo: 'auto' }).thread;
    let codigo = 0, saida = '';
    try { saida = execFileSync(process.execPath, [ORK, 'phase', 'run', nova.id, 'GOAL', '--prompt', 'objetivo SIMULADO'], { cwd: p.dir, encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { const x = e as { status?: number; stdout?: string; stderr?: string }; codigo = x.status ?? -1; saida = `${x.stdout ?? ''}${x.stderr ?? ''}`; }
    assert.equal(codigo, 3, saida);
    assert.match(saida, /Despacho recusado: concurrency\.limite/);
    assert.match(saida, new RegExp(`${viva.id}.*codex 00000000`));
    assert.match(saida, /ork conducao status <thread>/);
    assert.match(saida, /evento slot_refused no ledger/);
    assert.doesNotMatch(saida, /gate_blocked/);
    assert.equal(lerLedger(dirThread(p.dir, nova.id)).some(e => e.tipo === 'slot_refused'), true);
  } finally { p.limpar(); }
});

test('defeito 3 (A1, N1): sessao viva em pausa prevista ou com verify reprovado ocupa; parada ou escalada ao dono, nao', () => {
  const p = projetoTemporario('rm037-limite-ocupacao');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const nova = novaThread(p.carregado, { nome: 'quem pede', modo: 'auto' }).thread;
    const conta = (id: string) => vagaDoDespacho(p.carregado, nova.id)?.ocupam.some(o => o.thread === id) ?? false;
    // #Classic: o despacho grava a pausa prevista ao fim do bloco e a sessao segue rodando.
    const classica = novaThread(p.carregado, { nome: 'classica', modo: 'classic' }).thread;
    assert.equal(registrarConducaoDaSessao(p.dir, classica.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 3600_000 },
      { sessionId: '00000000-0000-4000-8000-000000000020', runtime: 'claude-bg', perfil: null }), true);
    registrar(dirThread(p.dir, classica.id), classica.id, 'human_gate', { fase: 'GOAL', estado: 'prevista ao fim do bloco' });
    assert.equal(conta(classica.id), true, 'a pausa prevista nao para a sessao do bloco');
    registrar(dirThread(p.dir, classica.id), classica.id, 'phase_result', { fase: 'GOAL', sessionId: '00000000-0000-4000-8000-000000000020' });

    // #Auto: o verify reprovou no meio do GO e a sessao segue corrigindo.
    const impedida = threadComSessaoViva(p, 'impedida', 'codex', 22);
    registrar(dirThread(p.dir, impedida.id), impedida.id, 'gate_blocked', { gate: 'verify', motivo: 'verify.regression' });
    assert.equal(conta(impedida.id), true, 'verify reprovado nao para a sessao');
    registrar(dirThread(p.dir, impedida.id), impedida.id, 'phase_result', { fase: 'GO', sessionId: impedida.sessionId });

    // Escalou para o dono depois de comecar: esperar humano nao ocupa.
    const escalada = threadComSessaoViva(p, 'escalada', 'claude-bg', 21);
    registrar(dirThread(p.dir, escalada.id), escalada.id, 'gate_blocked', { gate: 'phase.dispatch', motivo: 'human.pending', fase: 'GO' });
    assert.equal(conta(escalada.id), false);
    // Parada: despachada ha 10 horas e sem evento desde entao (stale_after_min padrao: 240).
    const parada = threadComSessaoViva(p, 'parada', 'claude-bg', 23);
    const antigo = new Date(Date.now() - 10 * 3600_000).toISOString();
    fs.appendFileSync(path.join(dirThread(p.dir, parada.id), 'ledger.jsonl'),
      JSON.stringify({ ts: antigo, thread: parada.id, tipo: 'phase_dispatch', fase: 'GO', sessionId: parada.sessionId, eventId: 'e-antigo' }) + '\n');
    assert.equal(conta(parada.id), false);
    assert.equal(vagaDoDespacho(p.carregado, nova.id), null, 'so as duas que nao ocupam restaram');
  } finally { p.limpar(); }
});

test('defeito 3 (S1, S3): o despacho em curso de outra thread ocupa; a thread que ja conduz recebe a resposta da conducao', () => {
  const p = projetoTemporario('rm037-limite-corrida');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const outra = novaThread(p.carregado, { nome: 'despachando', modo: 'auto' }).thread;
    const nova = novaThread(p.carregado, { nome: 'segunda', modo: 'auto' }).thread;
    const tomada = tomarConducao(p.dir, outra.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 60_000 });
    assert.equal(tomada.ok, true);
    try {
      const recusa = vagaDoDespacho(p.carregado, nova.id);
      assert.deepEqual(recusa?.ocupam.map(o => [o.thread, o.sessao]), [[outra.id, null]]);
      assert.match(recusa!.detalhe, /despacho em curso/);
    } finally { if (tomada.ok) tomada.liberar(); }
    assert.equal(vagaDoDespacho(p.carregado, nova.id), null);

    // Projeto cheio e a thread ja conduz: o pedido repetido nao vira concurrency.limite.
    threadComSessaoViva(p, 'cheia', 'codex', 31);
    const propria = threadComSessaoViva(p, 'propria', 'codex', 32);
    const r = rodarFase(p.carregado, propria.id, { fase: 'GO', prompt: 'x', dryRun: true, runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.motivo, 'conducao.em-andamento');
  } finally { p.limpar(); }
});

test('defeito 3 (N2): a conducao orfa da propria thread, liberada pela tomada, nao fura o limite', () => {
  const p = projetoTemporario('rm037-limite-orfa');
  const claude = runtimePorConta('rm037-limite-orfa');
  try {
    claude.conta(p.dir, 'a');
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    threadComSessaoViva(p, 'ocupa', 'codex', 61);
    const t = novaThread(p.carregado, { nome: 'orfa', modo: 'auto' }).thread;
    assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 3600_000 },
      { sessionId: '00000000-0000-4000-8000-000000000062', runtime: 'claude-bg', perfil: null }), true);
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'depois da orfa' });
    assert.equal(r.motivo, 'concurrency.limite', r.erro);
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.some(e => e.tipo === 'slot_refused'), true);
    assert.equal(eventos.some(e => e.tipo === 'phase_dispatch'), false);
    assert.equal(conducaoDaThread(p.dir, t.id), null, 'a tomada foi devolvida');
  } finally { p.limpar(); claude.restaurar(); }
});
