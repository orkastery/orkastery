import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { adicionarClaim, lerClaims } from '../src/claims';
import { registrarMaster } from '../src/master';
import { observarSessao } from '../src/session-watcher';
import { ingerirEvento } from '../src/session-events';
import { auditarEstado } from '../src/estado-thread';
import { sincronizarWorktree } from '../src/worktree';

const sid = '11111111-2222-3333-4444-555555555555';
function fixture() {
  const p = projetoTemporario('sensor-state');
  const t = novaThread(p.carregado, { nome: 'sensor', modo: 'auto', criarWorktree: true }).thread;
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex',
    despachadaEm: new Date(Date.now() - 1000).toISOString(), promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  return { ...p, t, wt: t.worktree!, estado: dirThread(p.dir, t.id),
    local: path.join(t.worktree!, '.orkastery/threads', t.id) };
}

test('hook CLI, watcher, claim e POSTMORTEM da worktree possuem domicílio físico único', () => {
  const p = fixture();
  try {
    const cli = path.resolve(__dirname, '../../dist/index.js');
    const r = spawnSync(process.execPath, [cli, 'sessions', 'event', '--tipo', 'permission_request', '--sessao', sid],
      { cwd: p.wt, input: '{}', encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(lerLedger(p.estado).at(-1)?.tipo, 'sessao_bloqueada');
    const rollout = path.join(p.estado, 'fixture-rollout.jsonl');
    fs.writeFileSync(rollout, [
      { type: 'session_meta', payload: { id: sid } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turno' } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turno', last_agent_message: 'Concluído.' } },
    ].map(e => JSON.stringify(e) + '\n').join(''));
    const observado = observarSessao({ ...p.carregado, raiz: p.wt }, sid, { rollout });
    assert.equal(observado.concluido, true);
    const resultado = lerLedger(p.estado).find(e => e.tipo === 'phase_result')!;
    assert.equal(resultado.exitCode, null); assert.equal(resultado.exitCodeFonte, 'unavailable');
    adicionarClaim(p.wt, p.t.id, { arquivo: 'README.md', alegacao: 'fixture existe', verificar: ['test -f README.md'] });
    assert.equal(lerClaims(p.dir, p.t.id).length, 1);
    // Prova de domicílio usa somente entrega e autoria sintéticas nesta fixture descartável.
    registrar(p.estado, p.t.id, 'ship_done', { mergeSha: 'a'.repeat(40), pushVerificado: true });
    registrarMaster(p.wt, p.t.id, { score: 3, justificativa: 'avaliação sintética da fixture', classes: ['sem-falha'], por: 'humano-fixture' });
    for (const f of ['ledger.jsonl', 'claims.jsonl', 'POSTMORTEM.json', 'master-log.json']) {
      assert.equal(fs.realpathSync(path.join(p.local, f)), path.join(p.estado, f));
    }
    assert.equal(auditarEstado(p.dir, p.t.id, p.wt).nivel, 'ok');
  } finally { p.limpar(); }
});

test('sensores recusam conflito 90/14 sem mutação de qualquer cópia', () => {
  const p = fixture();
  try {
    fs.unlinkSync(p.local); fs.mkdirSync(p.local);
    const eventos = Array.from({ length: 90 }, (_, i) => JSON.stringify({ tipo: 'runtime_event', n: i }) + '\n');
    fs.writeFileSync(path.join(p.estado, 'ledger.jsonl'), eventos.slice(0, 14).join(''));
    fs.writeFileSync(path.join(p.local, 'ledger.jsonl'), eventos.join(''));
    const mainAntes = fs.readFileSync(path.join(p.estado, 'ledger.jsonl'));
    const wtAntes = fs.readFileSync(path.join(p.local, 'ledger.jsonl'));
    assert.throws(() => ingerirEvento(p.wt, sid, 'stop'), /estado dividido/);
    assert.throws(() => observarSessao({ ...p.carregado, raiz: p.wt }, sid), /estado dividido/);
    assert.equal(sincronizarWorktree(p.carregado, p.t.id).ok, false);
    assert.deepEqual(fs.readFileSync(path.join(p.estado, 'ledger.jsonl')), mainAntes);
    assert.deepEqual(fs.readFileSync(path.join(p.local, 'ledger.jsonl')), wtAntes);
    assert.equal(fs.existsSync(path.join(p.estado, 'sensores')), false);
  } finally { p.limpar(); }
});

test('vínculo ausente exige sync oficial antes da ingestão sem criar resolvedor alternativo', () => {
  const p = fixture();
  try {
    fs.unlinkSync(p.local);
    assert.throws(() => ingerirEvento(p.wt, sid, 'heartbeat'), /estado dividido/);
    assert.equal(sincronizarWorktree(p.carregado, p.t.id).ok, true);
    assert.equal(ingerirEvento(p.wt, sid, 'heartbeat').gravado, true);
    assert.equal(fs.realpathSync(p.local), p.estado);
  } finally { p.limpar(); }
});
