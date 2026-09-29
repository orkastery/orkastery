/**
 * RM-037 (rm037defeito, defeito 3): com `max_parallel_threads: 5`, um sexto `ork phase run` saiu as
 * 09h03 de 29/09/2026 com cinco sessoes vivas de outras threads. O despacho nao consultava vaga
 * nenhuma. Sessao viva e a conducao `exec:<thread>` com dono `sessao`, de qualquer runtime ou conta.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { vagaDoDespacho } from '../src/board';
import { conducaoDaThread, registrarConducaoDaSessao } from '../src/conducao';
import { lerLedger, registrar } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { dirThread, novaThread } from '../src/thread';

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
