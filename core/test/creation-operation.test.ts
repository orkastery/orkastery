import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { CreationActor, compensateCreation, resumeCreation, startCreation } from '../src/creation-operation';
import { readCreationOperation, receiveCreationOperation } from '../src/creation-operation-store';
import { createProduct, createProject, findEntity, readPortfolio } from '../src/portfolio';
import { approveObjective, listObjectives, readObjective } from '../src/objective';
import { listarIds } from '../src/thread';

const request = { key: 'coordinator-001', action: 'create_entity_with_ticket', entity: { kind: 'project', id: 'proj-fixture', parentId: 'prod-fixture', title: 'Ensaio', acceptanceCriteria: ['persistiu'] }, expectedParentVersion: 1, request: 'Criar ensaio', doneWhen: ['persistiu'], workspaceIds: ['fixture'], mode: 'auto' };
const actor: CreationActor = { principal: 'fixture', authorize: () => {} };

test('coordenador confirma efeitos, reconsulta após resposta perdida e compensa sem apagar registros', () => {
  const p = projetoTemporario('creation-coordinator');
  try {
    createProduct(p.dir, { id: 'prod-fixture', title: 'Ensaio' });
    const op = startCreation(p.carregado, actor, request);
    assert.equal(op.state, 'completed');
    assert.equal(op.confirmed.ticket, true);
    assert.equal(op.confirmed.entityVersion, 1);
    assert.equal(op.receipts.length, 1);
    assert.deepEqual(startCreation(p.carregado, actor, request), op);
    assert.equal(readPortfolio(p.dir).projects.length, 1);
    assert.equal(listObjectives(p.dir).length, 1);
    assert.equal(listarIds(p.dir).length, 3);
    assert.throws(() => resumeCreation(p.carregado, actor, op.operationId, 1), /creation.conflict/);
    const compensated = compensateCreation(p.carregado, actor, op.operationId, op.version);
    assert.equal(compensated.state, 'compensated');
    assert.equal(readObjective(p.dir, op.reserved.ticketId!).pauseReason, 'creation.compensated');
    assert.equal(findEntity(p.dir, 'proj-fixture')?.status, 'idea');
    assert.equal(listarIds(p.dir).length, 3);
    assert.deepEqual(compensateCreation(p.carregado, actor, op.operationId, compensated.version), compensated);
  } finally { p.limpar(); }
});

test('falha entre entidade e ticket é recuperável; retomada não cria outro catálogo', () => {
  const p = projetoTemporario('creation-recovery');
  try {
    createProduct(p.dir, { id: 'prod-fixture', title: 'Ensaio' });
    const rename = fs.renameSync;
    const failure = mock.method(require('node:fs'), 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to).endsWith('/objective.json')) throw new Error('fixture.disk_lost /private/path');
      return rename(from, to);
    });
    let op;
    try { op = startCreation(p.carregado, actor, request); }
    finally { failure.mock.restore(); }
    assert.equal(op.state, 'recoverable_failure');
    assert.equal(op.nextAction, 'resume');
    assert.equal(op.confirmed.entityVersion, 1);
    assert.ok(!JSON.stringify(op).includes('/private/path'));
    assert.equal(listarIds(p.dir).length, 0);
    const complete = resumeCreation(p.carregado, actor, op.operationId, op.version);
    assert.equal(complete.state, 'completed');
    assert.equal(readPortfolio(p.dir).projects.length, 1);
    assert.equal(listObjectives(p.dir).length, 1);
  } finally { p.limpar(); }
});

test('autorização revogada, entidade alheia e compensação após aprovação não executam efeitos indevidos', () => {
  const p = projetoTemporario('creation-authority');
  try {
    createProduct(p.dir, { id: 'prod-fixture', title: 'Ensaio' });
    const pending = receiveCreationOperation(p.dir, actor.principal, request, 'ork');
    const denied: CreationActor = { ...actor, authorize: () => { throw new Error('fixture.denied'); } };
    assert.throws(() => resumeCreation(p.carregado, denied, pending.operationId, pending.version), /fixture.denied/);
    assert.equal(readCreationOperation(p.dir, pending.operationId, actor.principal).version, 1);
    assert.equal(readPortfolio(p.dir).projects.length, 0);
    const complete = resumeCreation(p.carregado, actor, pending.operationId, pending.version);
    approveObjective(p.dir, complete.reserved.ticketId!, 'fixture-owner');
    const refused = compensateCreation(p.carregado, actor, complete.operationId, complete.version);
    assert.equal(refused.state, 'compensation_failed');
    assert.equal(refused.nextAction, 'manual');
    assert.equal(readObjective(p.dir, complete.reserved.ticketId!).status, 'running');
    const conflict = startCreation(p.carregado, actor, { ...request, key: 'coordinator-other-001' });
    assert.equal(conflict.state, 'recoverable_failure');
    assert.equal(listObjectives(p.dir).length, 1);
    assert.throws(() => startCreation(p.carregado, actor, { ...request, principal: 'spoof' }));
  } finally { p.limpar(); }
});

test('cadastro sem ciclo e ticket de entidade existente preservam a versão do catálogo', () => {
  const p = projetoTemporario('creation-actions');
  try {
    createProduct(p.dir, { id: 'prod-fixture', title: 'Ensaio' });
    const registration = startCreation(p.carregado, actor, { ...request, action: 'create_entity' });
    assert.equal(registration.state, 'completed');
    assert.equal(registration.reserved.ticketId, null);
    assert.equal(listObjectives(p.dir).length, 0);
    const existing = createProject(p.dir, { id: 'proj-existing', productId: 'prod-fixture', title: 'Anterior', workspaceIds: ['fixture'], status: 'delivered' });
    const opened = startCreation(p.carregado, actor, { key: 'existing-001', action: 'open_ticket', entityId: existing.id, expectedEntityVersion: 1, request: 'Revisar', doneWhen: ['revisado'], workspaceIds: ['fixture'], mode: 'auto' });
    assert.equal(opened.state, 'completed');
    assert.equal(compensateCreation(p.carregado, actor, opened.operationId, opened.version).state, 'compensated');
    assert.deepEqual(findEntity(p.dir, existing.id), existing);
  } finally { p.limpar(); }
});
