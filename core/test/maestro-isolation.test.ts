import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { novaIdentidadeDeDespacho } from '../src/runtime-context';
import { concluirDespacho, ContextoDeDespacho, dadosDoDespacho, resolverDespacho } from '../src/phase';
import { novaThread } from '../src/thread';
import { TOOLS_FILHO_CODEX } from '../src/mcp-install';

test('identidades do mesmo harness são distintas, papéis não promovem grants nem alteram modelo', () => {
  const a = novaIdentidadeDeDespacho('ork-fixture', 'GO'), b = novaIdentidadeDeDespacho('ork-fixture', 'CHECK');
  assert.notEqual(a.dispatchId, b.dispatchId);
  assert.equal(a.role, 'executor'); assert.equal(b.role, 'reviewer');
  assert.ok(!TOOLS_FILHO_CODEX.some(t => /gate|request_decision|phase_run/.test(t)));
  const p = projetoTemporario('maestro-isolation');
  try {
    const trio = resolverDespacho(p.carregado.manifesto, { runtime: 'codex', model: 'fixture-model', effort: 'high' });
    assert.deepEqual(trio, { runtime: 'codex', model: 'fixture-model', effort: 'high' });
    const thread = novaThread(p.carregado, { nome: 'Isolamento', modo: 'auto' }).thread;
    thread.sessoes.push({ slug: 'go', fase: 'GO', bloco: 'GO', sessionId: 'same-session', runtime: 'codex',
      promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), despachadaEm: new Date().toISOString(), verificada: true });
    const ctx: ContextoDeDespacho = { raiz: p.dir, thread, fase: 'CHECK', slug: 'check',
      promptPath: p.dir + '/prompt.md', promptSha256: 'b'.repeat(64), runtime: 'codex', cwd: p.dir,
      model: trio.model, effort: trio.effort, origem: 'fixture', identidade: b };
    // Compatibilidade: o runtime pode retomar o mesmo ID entre fases. Isso não
    // constitui prova de revisão independente; verifySessionReview exige três IDs.
    concluirDespacho(ctx, 'same-session', true, []);
    assert.equal(thread.sessoes.length, 2);
    const event = dadosDoDespacho(ctx, []);
    assert.deepEqual(event.identidade, b);
    assert.equal(event.model, 'fixture-model'); assert.equal(event.effort, 'high');
  } finally { p.limpar(); }
});
