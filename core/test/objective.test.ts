import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { approveObjective, createObjective, listObjectiveMessages, messageObjective, objectivePhases, readObjective, reviseObjective, stopObjective, validateObjective } from '../src/objective';
import { gravarThread, lerThread } from '../src/thread';

test('Objective Envelope abre três threads, uma pausa global e exige CHECK cruzado', () => {
  const p = projetoTemporario('objective');
  try {
    const objective = createObjective(p.carregado, {
      title: 'Nova jornada premium', request: 'Criar a jornada completa', doneWhen: ['usuário conclui a demanda'],
      executionRuntime: 'claude-bg', validationRuntimes: ['claude-bg', 'codex'], mode: 'auto',
    });
    assert.equal(objective.status, 'awaiting_approval');
    assert.equal(objective.pauseReason, 'human.approval.objective-envelope');
    assert.equal(listObjectiveMessages(p.dir, objective.id)[0].text, 'Criar a jornada completa');
    const note = messageObjective(p.dir, objective.id, { role: 'human', by: 'julio', text: 'Priorize a experiência visual.' });
    assert.equal(note.role, 'human');
    assert.equal(listObjectiveMessages(p.dir, objective.id).length, 2);
    assert.equal(objective.threads.length, 3);
    assert.deepEqual(objective.threads.map((item) => item.role), ['discovery', 'delivery', 'validation']);
    assert.equal(objective.mode, 'auto');
    assert.ok(objective.threads.every((item) => lerThread(p.dir, item.id).modo === 'auto'));
    assert.equal(objectivePhases(p.dir, objective)[0].state, 'waiting');
    assert.throws(() => approveObjective(p.dir, objective.id, ''), /--por/);
    const running = approveObjective(p.dir, objective.id, 'maestro');
    assert.equal(running.status, 'running');
    assert.equal(running.approval?.envelopeHash, running.envelope.hash);
    assert.throws(() => validateObjective(p.dir, objective.id, 'claude-bg', 'approved', ''), /evidência/);
    assert.equal(validateObjective(p.dir, objective.id, 'claude-bg', 'approved', 'suite A').status, 'running');
    assert.equal(validateObjective(p.dir, objective.id, 'codex', 'approved', 'suite B').status, 'validated');
  } finally { p.limpar(); }
});

test('envelope é íntegro, revisões preservam histórico e terceira oscilação pausa', () => {
  const p = projetoTemporario('objective-integrity');
  try {
    let objective = createObjective(p.carregado, { title: 'Envelope', request: 'versão zero', doneWhen: ['verde'] });
    for (let index = 1; index <= 3; index++) objective = reviseObjective(p.dir, objective.id, `versão ${index}`);
    assert.equal(objective.status, 'paused');
    assert.equal(objective.pauseReason, 'objective.oscillation');
    assert.equal(objective.envelopeHistory.length, 3);
    assert.equal(objective.envelope.version, 4);
    const file = path.join(p.dir, '.orkastery', 'objectives', objective.id, 'objective.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')); raw.envelope.request = 'alterado por fora';
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.throws(() => readObjective(p.dir, objective.id), /alterado fora/);
  } finally { p.limpar(); }
});

test('stop stack percorre sessões conhecidas e é idempotente', () => {
  const p = projetoTemporario('objective-stop');
  try {
    const objective = createObjective(p.carregado, { title: 'Parar tudo', request: 'execução longa', doneWhen: ['parou'] });
    const child = lerThread(p.dir, objective.threads[0].id);
    child.sessoes.push({ slug: 'evl-parar-full', fase: 'GO', bloco: 'full', sessionId: '11111111-2222-3333-4444-555555555555', runtime: 'codex', verificada: true, despachadaEm: new Date().toISOString(), promptPath: 'prompt.md', promptSha256: 'a'.repeat(64) });
    gravarThread(p.dir, child);
    const calls: string[] = [];
    const stopped = stopObjective(p.dir, objective.id, (session) => { calls.push(session); return { codigo: 0, texto: 'stopped' }; });
    assert.deepEqual(calls, ['11111111-2222-3333-4444-555555555555']);
    assert.equal(stopped.stopStack[0].stopped, true);
    assert.equal(stopObjective(p.dir, objective.id, () => { throw new Error('não deve chamar'); }).status, 'stopped');
  } finally { p.limpar(); }
});

test('ensemble recusa configuração que não cruza runtime e validador rejeitado pausa', () => {
  const p = projetoTemporario('objective-ensemble');
  try {
    assert.throws(() => createObjective(p.carregado, { title: 'Sem cruzamento', request: 'x', doneWhen: ['y'], executionRuntime: 'codex', validationRuntimes: ['codex'] }), /dois runtimes/);
    const objective = createObjective(p.carregado, { title: 'Rejeição', request: 'x', doneWhen: ['y'] });
    approveObjective(p.dir, objective.id, 'maestro');
    const rejected = validateObjective(p.dir, objective.id, 'codex', 'rejected', 'regressão');
    assert.equal(rejected.status, 'paused');
    assert.equal(rejected.pauseReason, 'ensemble.rejected');
  } finally { p.limpar(); }
});
