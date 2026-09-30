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
import { assumirConducao, conducaoDaThread, registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { lerLedger, registrar } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { fecharAdministrativamente } from '../src/thread-close';

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
    // S1 do CHECK final: a sessao de thread fechada sai da conta, mesmo com o lease da conducao ainda gravado.
    // Dois caminhos: o fechamento administrativo (evento e status) e o status sem evento, como a migracao do MASTER.
    const peloAdmin = threadComSessaoViva(p, 'fechada pelo admin', 'claude-bg', 8);
    const peloStatus = threadComSessaoViva(p, 'fechada pelo status', 'codex', 9);
    assert.deepEqual(vagaDoDespacho(p.carregado, propria.id)?.ocupam.map(o => o.thread).sort(),
      [peloAdmin.id, peloStatus.id].sort(), 'abertas, elas ocupam');
    fecharAdministrativamente(p.dir, peloAdmin.id, { motivo: 'superada', por: 'teste', justificativa: 'thread SIMULADA superada' });
    const t = lerThread(p.dir, peloStatus.id);
    t.status = 'fechada';
    gravarThread(p.dir, t);
    assert.equal(vagaDoDespacho(p.carregado, propria.id), null, 'fechadas, as sessoes delas nao contam');
    const outra = novaThread(p.carregado, { nome: 'outra', modo: 'auto' }).thread;
    assert.deepEqual(vagaDoDespacho(p.carregado, outra.id)?.ocupam.map(o => o.thread), [propria.id]);
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

// CHECK 3 (A-1, A-2, S-5, S-7).

test('defeito 3 (A-1): a recusa por vaga devolve a reserva do dono', () => {
  const p = projetoTemporario('rm037-limite-devolve');
  const claude = runtimePorConta('rm037-limite-devolve');
  try {
    claude.conta(p.dir, 'a');
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    // Reserva do canal cli: o proximo pedido do mesmo canal a consumiria.
    const reservada = novaThread(p.carregado, { nome: 'reservada', modo: 'auto' }).thread;
    assert.equal(assumirConducao(p.dir, reservada.id, { por: 'dono no terminal', motivo: 'retomar a thread', canal: 'cli' }).ok, true);
    threadComSessaoViva(p, 'enche o projeto', 'codex', 71);
    const r = rodarFase(p.carregado, reservada.id, { fase: 'GOAL', prompt: 'depois da reserva', canal: 'cli' });
    assert.equal(r.motivo, 'concurrency.limite', r.erro);
    assert.equal(conducaoDaThread(p.dir, reservada.id)?.dono.tipo, 'reserva', 'a reserva do dono voltou');
    assert.ok(lerLedger(dirThread(p.dir, reservada.id)).some(e => e.tipo === 'conducao_devolvida'));
  } finally { p.limpar(); claude.restaurar(); }
});

test('defeito 3 (A-1): a tomada que sucedeu uma sessao bloqueada a devolve quando o pedido e recusado', () => {
  const p = projetoTemporario('rm037-limite-devolve-sessao');
  try {
    const t = novaThread(p.carregado, { nome: 'bloqueada', modo: 'auto' }).thread;
    const sessionId = '00000000-0000-4000-8000-000000000072';
    assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', promptSha256: 'a'.repeat(64), prazoMs: 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: 'a' }), true);
    // O runtime diz que a sessao esta blocked: o despacho seguinte da fase a sucede.
    const tomada = tomarConducao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', promptSha256: 'b'.repeat(64), prazoMs: 60_000,
      consultarSessao: () => ({ ok: true, estado: 'blocked', detalhe: 'SIMULADO: blocked' }) });
    assert.equal(tomada.ok, true);
    assert.equal(conducaoDaThread(p.dir, t.id)?.dono.tipo, 'processo');
    if (tomada.ok) tomada.devolver();
    const depois = conducaoDaThread(p.dir, t.id);
    assert.deepEqual([depois?.dono.tipo, depois?.sessao], ['sessao', sessionId], 'a sessao bloqueada segue com o lease');
    assert.ok(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'conducao_devolvida'));
  } finally { p.limpar(); }
});

test('defeito 3 (A-2, S-7): silencio do pulse e sessao bloqueada no runtime liberam a vaga ate o evento que resolve', () => {
  const p = projetoTemporario('rm037-limite-silencio');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const nova = novaThread(p.carregado, { nome: 'quem pede', modo: 'auto' }).thread;
    const conta = () => (vagaDoDespacho(p.carregado, nova.id)?.ocupam.length ?? 0) > 0;
    const muda = threadComSessaoViva(p, 'muda', 'codex', 81);
    const dirMuda = dirThread(p.dir, muda.id);
    assert.equal(conta(), true);
    registrar(dirMuda, muda.id, 'gate_blocked', { gate: 'liveness', motivo: 'runtime.silencio', fase: 'GO', origem: 'pulse' });
    assert.equal(conta(), false, 'sessao em silencio nao ocupa');
    registrar(dirMuda, muda.id, 'gate_passed', { fase: 'GO', motivo: 'runtime.silencio' });
    assert.equal(conta(), true, 'o silencio resolvido devolve a sessao a conta');
    registrar(dirMuda, muda.id, 'sessao_bloqueada', { fase: 'GO', sessionId: muda.sessionId });
    assert.equal(conta(), false, 'bloqueada no runtime esperando o dono nao ocupa');
    registrar(dirMuda, muda.id, 'sessao_destravada', { fase: 'GO', sessionId: muda.sessionId });
    assert.equal(conta(), true);
  } finally { p.limpar(); }
});

test('defeito 3 (S-5): dois despachos na ultima vaga, fica quem tomou antes', () => {
  const p = projetoTemporario('rm037-limite-desempate');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const a = novaThread(p.carregado, { nome: 'primeiro', modo: 'auto' }).thread;
    const b = novaThread(p.carregado, { nome: 'segundo', modo: 'auto' }).thread;
    const tomada = tomarConducao(p.dir, a.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 60_000 });
    assert.equal(tomada.ok, true);
    try {
      const desdeA = conducaoDaThread(p.dir, a.id)!.desde;
      const depois = new Date(Date.parse(desdeA) + 1000).toISOString(), antes = new Date(Date.parse(desdeA) - 1000).toISOString();
      assert.deepEqual(vagaDoDespacho(p.carregado, b.id, undefined, depois)?.ocupam.map(o => o.thread), [a.id], 'b tomou depois: a fica');
      assert.equal(vagaDoDespacho(p.carregado, b.id, undefined, antes), null, 'b tomou antes: a nao o recusa');
    } finally { if (tomada.ok) tomada.liberar(); }
  } finally { p.limpar(); }
});

test('defeito 3 (A-3): o bloqueio de OUTRA sessao da thread nao libera a vaga da sessao que trabalha', () => {
  const p = projetoTemporario('rm037-limite-outra-sessao');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const nova = novaThread(p.carregado, { nome: 'quem pede', modo: 'auto' }).thread;
    const viva = threadComSessaoViva(p, 'sucessora', 'codex', 101);
    // A sessao sucedida (S1) continua blocked no runtime e o pulse carimba o bloqueio dela depois.
    registrar(dirThread(p.dir, viva.id), viva.id, 'sessao_bloqueada', { fase: 'GO', sessionId: '00000000-0000-4000-8000-000000000100' });
    assert.deepEqual(vagaDoDespacho(p.carregado, nova.id)?.ocupam.map(o => o.thread), [viva.id]);
  } finally { p.limpar(); }
});

test('conducao (S5 do CHECK 6): a reentrada renova o lease de quem a segura; tomada encerrada nao regrava nada', () => {
  const p = projetoTemporario('rm037-conducao-renovar');
  try {
    const t = novaThread(p.carregado, { nome: 'renovar', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const externa = tomarConducao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 1000 });
    assert.equal(externa.ok, true);
    if (!externa.ok) return;
    const dentro = tomarConducao(p.dir, t.id, { canal: 'cli', operacao: 'baseline', prazoMs: 1000, identidade: externa.identidade });
    assert.equal(dentro.ok && dentro.reentrada, true);
    if (dentro.ok) { dentro.renovar(3600_000); dentro.liberar(); }
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'conducao_renovada').length, 1, 'a reentrada renovou o lease retido');
    externa.devolver();
    assert.equal(conducaoDaThread(p.dir, t.id), null);
    externa.renovar(3600_000);
    externa.converterEmSessao({ sessionId: '00000000-0000-4000-8000-000000000111', runtime: 'codex', perfil: null, prazoMs: 1000 });
    assert.equal(conducaoDaThread(p.dir, t.id), null, 'tomada encerrada nao regrava lease');
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'conducao_renovada').length, 1);
    assert.equal(externa.sucessaoAindaVale(), false, 'tomada encerrada nunca libera despacho');
  } finally { p.limpar(); }
});

test('conducao (S1 do CHECK 6): sucedida que sumiu do runtime, sem perfil, acabou: a sucessao vale', () => {
  const p = projetoTemporario('rm037-conducao-sumiu');
  try {
    const t = novaThread(p.carregado, { nome: 'sumiu', modo: 'auto' }).thread;
    assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', promptSha256: 'a'.repeat(64), prazoMs: 3600_000 },
      { sessionId: '00000000-0000-4000-8000-000000000112', runtime: 'claude-bg', perfil: null }), true);
    let estado: string | null = 'blocked';
    const tomada = tomarConducao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', promptSha256: 'b'.repeat(64), prazoMs: 60_000,
      consultarSessao: () => ({ ok: true, estado, detalhe: 'SIMULADO' }) });
    assert.equal(tomada.ok, true);
    if (!tomada.ok) return;
    estado = null;
    assert.equal(tomada.sucessaoAindaVale(), true);
    estado = 'running';
    assert.equal(tomada.sucessaoAindaVale(), false);
    tomada.devolver();

    // AV1 do CHECK 7: com perfil (varias contas), ausente pode ser leitura pela conta errada: a sucessao nao vale.
    const outra = novaThread(p.carregado, { nome: 'com perfil', modo: 'auto' }).thread;
    assert.equal(registrarConducaoDaSessao(p.dir, outra.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', promptSha256: 'c'.repeat(64), prazoMs: 3600_000 },
      { sessionId: '00000000-0000-4000-8000-000000000113', runtime: 'claude-bg', perfil: 'conta-b' }), true);
    let comPerfil: string | null = 'blocked';
    const t2 = tomarConducao(p.dir, outra.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', promptSha256: 'd'.repeat(64), prazoMs: 60_000,
      consultarSessao: () => ({ ok: true, estado: comPerfil, detalhe: 'SIMULADO' }) });
    assert.equal(t2.ok, true);
    if (!t2.ok) return;
    comPerfil = null;
    assert.equal(t2.sucessaoAindaVale(), false, 'sessao ausente na conta consultada nao prova fim');
    t2.devolver();
  } finally { p.limpar(); }
});
