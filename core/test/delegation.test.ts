/** Configuração e identidades SIMULADAS; não concede autorização em threads reais. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { avaliarDelegacao, validarDelegacao } from '../src/delegation';
import { planejarRetry } from '../src/retry';
import { novaThread, dirThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { ajustarManifesto, projetoTemporario } from './apoio';

test('delegação exige opt-in, thread, escopo, prazo e evidência; nunca libera Look/Classic/push/score', () => {
  const p = projetoTemporario('delegacao');
  try {
    const t = novaThread(p.carregado, { nome: 'simulada', modo: 'maestro' }).thread;
    const entrada = { thread: t.id, modo: 'maestro' as const, fase: 'PLAN' as const, escopo: 'premissas', quando: '2026-09-08T01:00:00Z' };
    assert.equal(avaliarDelegacao(p.carregado.manifesto, entrada).permitida, false);
    p.carregado.manifesto.conduction.delegation = { thread: t.id, escopo: 'premissas', prazo: '2026-09-08T02:00:00Z', evidencia: 'fixture explícita', delegado: 'agente-simulado' };
    assert.equal(avaliarDelegacao(p.carregado.manifesto, entrada).permitida, true);
    for (const modo of ['look', 'classic', 'ork', 'auto'] as const) assert.equal(avaliarDelegacao(p.carregado.manifesto, { ...entrada, modo }).permitida, false);
    for (const escopo of ['push', 'score', 'premissas,push']) assert.equal(avaliarDelegacao(p.carregado.manifesto, { ...entrada, escopo }).permitida, false);
    for (const alteracao of [{ conteudo: 'Aprovar [GATE] protegido' }, { thread: 'outra' }, { fase: 'SHIP' as const }, { quando: '2026-09-08T02:00:00Z' }]) {
      assert.equal(avaliarDelegacao(p.carregado.manifesto, { ...entrada, ...alteracao }).permitida, false);
    }
    for (const k of ['thread', 'escopo', 'prazo', 'evidencia', 'delegado']) {
      const d: Record<string, unknown> = { ...p.carregado.manifesto.conduction.delegation }; delete d[k]; assert.equal(validarDelegacao(d), false);
    }
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'human_gate'), false);
  } finally { p.limpar(); }
});

test('retry consulta delegação vigente e mantém policy, custo e limite bloqueados', () => {
  const p = projetoTemporario('delegacao-retry');
  try {
    const t = novaThread(p.carregado, { nome: 'simulada', modo: 'maestro' }).thread;
    const config = p.carregado.manifesto;
    fs.writeFileSync(path.join(dirThread(p.dir, t.id), 'PLAN.md'), 'Premissas da fixture simulada.');
    assert.equal(planejarRetry(p.carregado, t.id, { motivo: 'artifact.missing', fase: 'PLAN', autorizadoPor: 'nome-fabricado' }).automatica, false);
    config.conduction.delegation = { thread: t.id, escopo: 'premissas', prazo: new Date(Date.now() + 60000).toISOString(), evidencia: 'fixture', delegado: 'agente-simulado' };
    assert.equal(planejarRetry(p.carregado, t.id, { motivo: 'artifact.missing', fase: 'PLAN' }).automatica, true);
    fs.appendFileSync(path.join(dirThread(p.dir, t.id), 'PLAN.md'), '\n[GATE] não delegar esta premissa');
    assert.equal(planejarRetry(p.carregado, t.id, { motivo: 'artifact.missing', fase: 'PLAN', autorizadoPor: 'nome-fabricado' }).automatica, false);
    fs.writeFileSync(path.join(dirThread(p.dir, t.id), 'PLAN.md'), 'Premissas da fixture simulada.');
    for (const motivo of ['human.pending', 'policy.violation', 'cost.violation'] as const) assert.equal(planejarRetry(p.carregado, t.id, { motivo, fase: 'PLAN' }).automatica, false);
    config.retry.max_tentativas = 0;
    assert.equal(planejarRetry(p.carregado, t.id, { motivo: 'artifact.missing', fase: 'PLAN' }).bloqueio, 'escalacao.limite');
  } finally { p.limpar(); }
});

test('manifesto recusa configuração de delegação incompleta', () => {
  const p = projetoTemporario('delegacao-manifesto');
  try { assert.throws(() => ajustarManifesto(p, 'conduction:', 'conduction:\n  delegation:\n    escopo: push'), /conduction.delegation/); }
  finally { p.limpar(); }
});
