/** Integração em projeto temporário; sessões/cliente são fixtures, não prova live. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { canarioPorId } from '../src/canarios';
import { novaThread, dirThread, gravarThread, lerThread, listarIds } from '../src/thread';
import { concluirDespacho, rodarFase } from '../src/phase';
import { novaIdentidadeDeDespacho } from '../src/runtime-context';
import { verifySessionReview, SessionReviewBinding } from '../src/maestro-authority';
import { discoverMaestro } from '../src/maestro-discovery';
import { readMaestro } from '../src/maestro-cli';
import { performMaestroAction } from '../src/maestro-actions';
import { abrirPedidoGate } from '../src/hitl-gates';
import { criarIngressoLocal } from '../src/hitl-local';
import { aprovacoesHumanas } from '../src/gates';
import { lerLedger, registrar } from '../src/ledger';
import { Fase } from '../src/types';

const root = path.resolve(__dirname, '../../..');
test('canário registrado executa o oracle versionado sem rodar outros canários', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'eval/fixtures/fx-maestro-bootstrap/caso.json'), 'utf8'));
  const runner = canarioPorId(fixture.id); assert.ok(runner);
  assert.deepEqual(runner.rodar({ catalogo: root }), fixture.esperado);
});

test('mesmo harness isolado: entrada, ação, policy/HITL, recibo e readback sem declarar SHIP', async () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'core/test/fixtures/maestro-lifecycle.json'), 'utf8'));
  assert.equal(fixture.simulated, true);
  const p = projetoTemporario('maestro-lifecycle');
  let ingress: ReturnType<typeof criarIngressoLocal> | undefined;
  try {
    const context = discoverMaestro({ cwd: p.dir });
    const snapshot = () => readMaestro(context, { host: { tools: ['ork_thread_status', 'ork_request_decision', 'ork_phase_run'], child: true } });
    const before = listarIds(p.dir); assert.equal(snapshot().sections.threads.coverage.total, 0);
    assert.deepEqual(listarIds(p.dir), before);
    const t = novaThread(p.carregado, { nome: 'Ciclo sintético', modo: 'auto' }).thread;
    t.worktree = p.dir; gravarThread(p.dir, t);
    const refs = fixture.sessions.map((sessionId: string, i: number) => {
      const fase = fixture.roles[i] as Fase, promptPath = path.join(dirThread(p.dir, t.id), `fixture-${fase}.md`);
      fs.writeFileSync(promptPath, `FIXTURE: ${fase}`);
      const promptSha256 = createHash('sha256').update(fs.readFileSync(promptPath)).digest('hex');
      concluirDespacho({ raiz: p.dir, thread: lerThread(p.dir, t.id), fase, slug: `${t.slug}-${fase.toLowerCase()}`,
        promptPath, promptSha256, runtime: fixture.runtime, cwd: p.dir, model: 'fixture-model', effort: 'high',
        origem: 'fixture-only', identidade: novaIdentidadeDeDespacho(t.id, fase) }, sessionId, true, [], 'fixture-only');
      return { threadId: t.id, sessionId, worktree: p.dir };
    });
    const binding: SessionReviewBinding = { conductor: refs[0], executor: refs[1], reviewer: refs[2] };
    const identity = verifySessionReview(p.dir, binding);
    assert.equal(identity.runtime, fixture.runtime); assert.equal(new Set(identity.dispatchEvents).size, 6);
    assert.throws(() => verifySessionReview(p.dir, { ...binding, reviewer: binding.executor }), /self-review/);
    const state = snapshot(); assert.equal(state.sections.sessions.items.length, 3);
    let calls = 0;
    const result = performMaestroAction(context, { id: `thread.status:${t.id}`, expectedFingerprint: state.fingerprint }, {
      snapshot, receipts: () => null, readback: id => lerThread(p.dir, id),
      operations: { 'thread.status': id => { calls++; return lerThread(p.dir, id); } },
    });
    assert.equal(calls, 1); assert.equal((result.readback as typeof t).id, t.id);
    assert.throws(() => performMaestroAction(context, { id: `hitl.decide:${t.id}`, expectedFingerprint: state.fingerprint }, {
      snapshot, receipts: () => null, readback: () => null, operations: {},
    }), /conductor_required/);
    p.carregado.manifesto.policies = { segredo_em_prompt: 'block' };
    const current = lerThread(p.dir, t.id); current.faseAtual = 'GOAL'; gravarThread(p.dir, current);
    const blocked = rodarFase(p.carregado, t.id, { fase: 'GOAL', dryRun: true, prompt: 'FIXTURE ' + 'sk-ant-' + 'x'.repeat(24) });
    assert.equal(blocked.bloqueado, true); assert.equal(blocked.motivo, fixture.expected.blocker);
    const q = abrirPedidoGate(p.dir, t.id, blocked.motivo!);
    let dialogs = 0;
    ingress = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'fixture-conductor-connection' }, async question => {
      dialogs++; assert.equal(question.id, q.id); return { action: 'accept', content: { opcao: '1' } };
    });
    const response = await ingress.solicitar(t.id, q.id);
    assert.equal(response.estado, 'aguardando');
    assert.equal((await ingress.solicitar(t.id, q.id)).repetida, true); assert.equal(dialogs, 1);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, fixture.expected.humanApprovals);
    const events = lerLedger(dirThread(p.dir, t.id));
    assert.equal(events.filter(e => e.tipo === 'human_gate' && e.pedidoId === q.id).length, 1);
    const human = events.find(e => e.tipo === 'human_gate' && e.pedidoId === q.id)!;
    assert.equal(human.origem, 'mcp-local'); assert.equal(human.conexao, 'fixture-conductor-connection');
    assert.match(String(human.recibo), /^[a-f0-9]{64}$/);
    registrar(dirThread(p.dir, t.id), t.id, 'ship_started', { origem: 'fixture-only' });
    const after = snapshot();
    assert.equal(after.sections.blockers.items[0].facts.reason, fixture.expected.blocker);
    assert.equal(after.sections.ship.items[0].status, fixture.expected.ship);
    assert.equal(after.sections.master.items[0].status, fixture.expected.master);
    assert.equal(after.sections.master.items[0].facts.score, null);
  } finally { ingress?.fechar(); p.limpar(); }
});
