import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { commitar, projetoTemporario, runtimeFalso } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { novaThread, dirThread, lerThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { ingerirEvento } from '../src/session-events';
import { Fase } from '../src/types';
import { exec } from '../src/util';

const PROMPT = 'Fatia de fixture SIMULADA para o observador claude-bg';

function cenario(nome: string) {
  const runtime = runtimeFalso(nome);
  const p = projetoTemporario(nome);
  // GO-FIX 2 (D12): a prova do GO inclui worktree limpa, então a thread tem worktree própria.
  const t = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true }).thread;
  const dir = dirThread(p.dir, t.id);
  return { runtime, p, t, dir, eventos: () => lerLedger(dir),
    limpar: () => { runtime.restaurar(); p.limpar(); } };
}

function despachar(c: ReturnType<typeof cenario>, operacao: string, fase: Fase): string {
  if (operacao === 'phase') {
    const r = rodarFase(c.p.carregado, c.t.id, { fase, runtime: 'claude-bg', prompt: PROMPT });
    assert.equal(r.bloqueado, false, r.erro); assert.ok(r.sessionId, 'despacho sem sessão');
    return r.sessionId!;
  }
  const prompt = path.join(c.dir, 'prompt-retry.md'); fs.writeFileSync(prompt, PROMPT);
  const sha = createHash('sha256').update(PROMPT).digest('hex');
  const r = redespachar(c.p.carregado, lerThread(c.p.dir, c.t.id), fase, prompt, sha, { runtime: 'claude-bg' });
  assert.ok(r.sessionId, 'redespacho sem sessão');
  return r.sessionId!;
}

for (const operacao of ['phase', 'retry']) {
  test(`I-34: despacho ${operacao} claude-bg registra fonte nativa e o watcher conclui sem chamada manual`, () => {
    const c = cenario('claude-watch-' + operacao);
    try {
      const sid = despachar(c, operacao, 'GO');
      const registro = c.eventos().find(e => e.tipo === 'session_sensor_registered')!;
      assert.ok(registro, 'registro de sensor ausente');
      assert.equal(registro.nativo, 'claude-agents');
      assert.equal(registro.sessionId, sid);
      assert.equal(registro.cwd, lerThread(c.p.dir, c.t.id).worktree ?? c.p.dir);
      assert.equal(registro.artefato, undefined, 'somente o PLAN guarda base de artefato');
      assert.equal(registro.logPath, undefined); assert.equal(registro.controlador, undefined);
      const arranque = c.eventos().find(e => e.tipo === 'session_watcher_started')!;
      assert.ok(arranque, 'watcher não foi iniciado pelo despacho');
      assert.equal(arranque.sessionId, sid);
      assert.equal(c.eventos().some(e => e.tipo === 'session_watcher_error'), false);
      // Sessão viva: o watcher não conclui por silêncio.
      assert.equal(c.eventos().some(e => e.tipo === 'phase_result'), false);
      // D16: done com Stop só conclui o GO com commit conferido no git da worktree, criado depois
      // do despacho (o HEAD do despacho fica gravado na fonte e não serve de prova), e worktree limpa.
      const wt = lerThread(c.p.dir, c.t.id).worktree!;
      assert.equal(registro.head, exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim(), 'HEAD do despacho ausente da fonte');
      const sha = commitar(wt, `entrega-${operacao}.txt`, 'entrega do GO\n', 'commit do GO depois do despacho');
      assert.notEqual(sha, registro.head);
      ingerirEvento(c.p.dir, sid, 'commit', JSON.stringify({ observedAt: new Date().toISOString(), eventId: 'commit-' + operacao, commit: sha }));
      ingerirEvento(c.p.dir, sid, 'stop', JSON.stringify({ observedAt: new Date().toISOString(), eventId: 'stop-' + operacao }));
      c.runtime.estadoDaSessao('done'); c.runtime.statusDaSessao('idle');
      esperarCondicao(() => lerLedger(c.dir).some(e => e.tipo === 'phase_result'), 40000);
      const resultado = c.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(resultado.sessionId, sid); assert.equal(resultado.runtime, 'claude-bg');
      assert.equal(resultado.classificacao, 'fase_concluida'); assert.equal(resultado.estadoNativo, 'done');
      assert.equal(resultado.origem, 'sessions.watch');
      assert.deepEqual((resultado.provaOrk as { commits: string[] }).commits, [sha]);
      assert.equal(JSON.stringify(c.eventos()).includes(PROMPT), false, 'ledger sem o texto do prompt');
    } finally { c.limpar(); }
  });
}

test('I-34: despacho PLAN claude-bg guarda a base do artefato e conclui sem plan.md como artifact.missing', () => {
  const c = cenario('claude-watch-plan');
  try {
    const sid = despachar(c, 'phase', 'PLAN');
    const registro = c.eventos().find(e => e.tipo === 'session_sensor_registered')!;
    assert.deepEqual(registro.artefato, { arquivo: 'docs/plan.md', sha256: null });
    ingerirEvento(c.p.dir, sid, 'stop', JSON.stringify({ observedAt: new Date().toISOString(), eventId: 'stop-plan' }));
    c.runtime.estadoDaSessao('done');
    esperarCondicao(() => lerLedger(c.dir).some(e => e.tipo === 'phase_result'), 40000);
    const resultado = c.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(resultado.classificacao, 'gate_blocked'); assert.equal(resultado.motivo, 'artifact.missing');
    assert.ok(c.eventos().some(e => e.tipo === 'gate_blocked' && e.motivo === 'artifact.missing' && e.sessionId === sid));
  } finally { c.limpar(); }
});
