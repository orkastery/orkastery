import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { compensateReservedObjective, createReservedObjective, listObjectiveMessages, listObjectives, readObjective, approveObjective } from '../src/objective';
import { estadoParaDespacho } from '../src/phase';
import { receiveCreationOperation } from '../src/creation-operation-store';
import { caminhoThread, lerThread, listarIds, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { dirThread } from '../src/thread';

const request = { key: 'recovery-ticket-001', action: 'create_entity_with_ticket', entity: { kind: 'project', id: 'proj-fixture', parentId: 'prod-fixture', title: 'Recuperar', acceptanceCriteria: [] }, expectedParentVersion: 1, request: 'Recuperar operação', doneWhen: ['persistiu'], workspaceIds: [], mode: 'auto' };
const input = { title: 'Recuperar', request: request.request, doneWhen: request.doneWhen, mode: 'auto' as const };

test('compensação preserva ticket/threads e disputa aprovação pelo mesmo lock; ticket parado não despacha', () => {
  const p = projetoTemporario('objective-compensate');
  try {
    const op = receiveCreationOperation(p.dir, 'fixture', request, 'ork');
    const ticket = createReservedObjective(p.carregado, input, { operationId: op.operationId, principal: op.principal });
    // I-43 (T11): as assercoes sobre `estadoParaDespacho` sairam junto com o ramo que
    // elas exercitavam. Ele era a unica consulta do produto ao envelope e dependia de
    // `creationOrigin`, que ZERO das 137 threads do projeto tinham: o ramo nunca
    // disparou. O que este teste guarda de verdade (o journal de criacao, o lock e a
    // compensacao) esta inteiro abaixo, porque nada disso foi removido.
    const stopped = compensateReservedObjective(p.dir, op.operationId, op.principal)!;
    assert.equal(stopped.status, 'stopped');
    assert.deepEqual(compensateReservedObjective(p.dir, op.operationId, op.principal), stopped);
    assert.equal(listarIds(p.dir).length, 3);
    assert.throws(() => approveObjective(p.dir, ticket.id, 'fixture-owner'), /não aguarda/);
    const other = receiveCreationOperation(p.dir, 'fixture', { ...request, key: 'approved-ticket-001' }, 'ork');
    const running = createReservedObjective(p.carregado, input, { operationId: other.operationId, principal: other.principal });
    approveObjective(p.dir, running.id, 'fixture-owner');
    // O despacho passa a nao ter mais nada a ver com o envelope: ele so confere estado.
    assert.equal(estadoParaDespacho(p.dir, lerThread(p.dir, running.threads[0].id)), null);
    assert.throws(() => compensateReservedObjective(p.dir, other.operationId, other.principal), /creation.started/);
    assert.equal(readObjective(p.dir, running.id).status, 'running');
  } finally { p.limpar(); }
});

test('ticket persiste antes das threads e recuperação parcial conserva IDs, origem e envelope', () => {
  const p = projetoTemporario('objective-recovery');
  try {
    const op = receiveCreationOperation(p.dir, 'fixture', request, 'ork');
    const reservation = { operationId: op.operationId, principal: op.principal };
    const originalRename = fs.renameSync;
    const fail = mock.method(require('node:fs'), 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === caminhoThread(p.dir, op.reserved.threadIds[1])) throw new Error('fixture.disk_lost');
      return originalRename(from, to);
    });
    try { assert.throws(() => createReservedObjective(p.carregado, input, reservation), /fixture.disk_lost/); }
    finally { fail.mock.restore(); }
    const before = readObjective(p.dir, op.reserved.ticketId!);
    assert.equal(listarIds(p.dir).length, 1);
    assert.equal(before.threads.length, 3);
    const after = createReservedObjective(p.carregado, input, reservation);
    assert.equal(after.envelope.hash, before.envelope.hash);
    assert.equal(after.createdAt, before.createdAt);
    assert.deepEqual(after.threads.map((t) => t.id), op.reserved.threadIds);
    assert.deepEqual(createReservedObjective(p.carregado, input, reservation), after);
    assert.equal(listObjectives(p.dir).length, 1);
    assert.equal(listarIds(p.dir).length, 3);
    assert.equal(listObjectiveMessages(p.dir, after.id).length, 1);
    for (const link of after.threads) {
      assert.equal(lerThread(p.dir, link.id).creationOrigin?.operationId, op.operationId);
      assert.deepEqual(lerThread(p.dir, link.id).sessoes, []);
      assert.equal(lerLedger(dirThread(p.dir, link.id)).filter((e) => e.tipo === 'thread_created').length, 1);
    }
    approveObjective(p.dir, after.id, 'fixture-owner');
    assert.throws(() => createReservedObjective(p.carregado, input, reservation), /creation.started/);
  } finally { p.limpar(); }
});

test('recuperação recusa thread alheia e intenção divergente sem escolher ID alternativo', () => {
  const p = projetoTemporario('objective-recovery-conflict');
  try {
    const op = receiveCreationOperation(p.dir, 'fixture', request, 'ork');
    const reservation = { operationId: op.operationId, principal: op.principal };
    const foreign = novaThread(p.carregado, { nome: 'Alheia', assunto: op.reserved.threadIds[0].slice(4), modo: 'auto' }).thread;
    const before = fs.readFileSync(caminhoThread(p.dir, foreign.id), 'utf8');
    assert.throws(() => createReservedObjective(p.carregado, input, reservation), /creation.conflict/);
    assert.equal(fs.readFileSync(caminhoThread(p.dir, foreign.id), 'utf8'), before);
    assert.equal(listarIds(p.dir).length, 1);
    assert.throws(() => createReservedObjective(p.carregado, { ...input, request: 'outra' }, reservation), /creation.conflict/);
    assert.throws(() => createReservedObjective(p.carregado, input, { ...reservation, principal: 'outro' }), /creation.unavailable/);
  } finally { p.limpar(); }
});
