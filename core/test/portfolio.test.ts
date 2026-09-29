import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { createObjective } from '../src/objective';
import { assertCycleScope, createInitiative, createOperationEntity, createProduct, createProject, listEntities, readPortfolio } from '../src/portfolio';
import { receiveCreationOperation } from '../src/creation-operation-store';

test('criação reservada grava origem com o catálogo e recusa versão antiga ou entidade alheia', () => {
  const p = projetoTemporario('portfolio-reserved');
  try {
    createProduct(p.dir, { id: 'prod-fixture', title: 'Ensaio' });
    const request = { key: 'portfolio-reserved-001', action: 'create_entity', entity: { kind: 'project', id: 'proj-fixture', parentId: 'prod-fixture', title: 'Ensaio', acceptanceCriteria: [] }, expectedParentVersion: 1, request: 'Ensaio', doneWhen: ['persistiu'], workspaceIds: [], mode: 'auto' };
    const stale = receiveCreationOperation(p.dir, 'fixture', { ...request, key: 'portfolio-stale-001', expectedParentVersion: 2 }, 'ork');
    assert.throws(() => createOperationEntity(p.dir, stale.operationId, stale.principal), /creation.conflict/);
    assert.equal(readPortfolio(p.dir).projects.length, 0);
    const op = receiveCreationOperation(p.dir, 'fixture', request, 'ork');
    const first = createOperationEntity(p.dir, op.operationId, op.principal);
    assert.equal(first.creationOperationId, op.operationId);
    assert.deepEqual(createOperationEntity(p.dir, op.operationId, op.principal), first);
    const other = receiveCreationOperation(p.dir, 'fixture', { ...request, key: 'portfolio-other-001' }, 'ork');
    assert.throws(() => createOperationEntity(p.dir, other.operationId, other.principal), /creation.conflict/);
    assert.equal(readPortfolio(p.dir).projects.length, 1);
  } finally { p.limpar(); }
});

function writer(root: string, id: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      const p = require(process.argv[1]);
      try { p.createProject(process.argv[2], {id: process.argv[3], productId: 'prod-fixture', title: 'Concorrente'}); }
      catch (e) { if (/já existe/.test(e.message)) process.exit(17); throw e; }
    `, require.resolve('../src/portfolio'), root, id], { timeout: 15000, stdio: 'ignore' });
    child.once('error', reject); child.once('exit', resolve);
  });
}

test('escritores legados concorrentes preservam todas as entidades e apenas um vence o mesmo ID', { timeout: 25000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-portfolio-concurrent-'));
  try {
    createProduct(root, { id: 'prod-fixture', title: 'Catálogo de ensaio', status: 'delivered' });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => writer(root, `proj-fixture-${i}`)));
    assert.deepEqual(results, Array(8).fill(0));
    assert.equal(readPortfolio(root).projects.length, 8);
    const competing = await Promise.all(Array.from({ length: 5 }, () => writer(root, 'proj-same-id')));
    assert.equal(competing.filter((code) => code === 0).length, 1);
    assert.equal(competing.filter((code) => code === 17).length, 4);
    assert.equal(readPortfolio(root).projects.length, 9);
    assert.equal(readPortfolio(root).products[0].status, 'delivered');
    assert.equal(readPortfolio(root).products[0].version, 1);
    assert.equal(fs.statSync(path.join(root, '.orkastery/portfolio.json')).mode & 0o777, 0o600);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('validação falha sem alterar snapshot e libera escritor para a próxima operação', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-portfolio-failure-'));
  try {
    createProduct(root, { id: 'prod-fixture', title: 'Ensaio' });
    const before = readPortfolio(root);
    assert.throws(() => createProject(root, { id: 'proj-invalid', productId: 'prod-absent', title: 'Inválido' }), /não encontrado/);
    assert.deepEqual(readPortfolio(root), before);
    createProject(root, { id: 'proj-valid', productId: 'prod-fixture', title: 'Válido' });
    createInitiative(root, { id: 'init-valid', projectId: 'proj-valid', title: 'Válida' });
    assert.equal(listEntities(root).length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('portfólio mantém produto, projeto multirrepositório e iniciativas', () => {
  const p = projetoTemporario('portfolio');
  try {
    createProduct(p.dir, { id: 'prod-orkastery', title: 'Orkastery' });
    createProject(p.dir, { id: 'proj-maestro-workspace', productId: 'prod-orkastery', title: 'Maestro Workspace', workspaceIds: ['orkastery', 'orkmind', 'site'] });
    createInitiative(p.dir, { id: 'init-ontology', projectId: 'proj-maestro-workspace', title: 'Ontologia' });
    createInitiative(p.dir, { id: 'init-kanban', projectId: 'proj-maestro-workspace', title: 'Kanban', dependsOn: ['init-ontology'] });
    assert.equal(listEntities(p.dir, 'project', 'prod-orkastery').length, 1);
    assert.equal(listEntities(p.dir, 'initiative', 'proj-maestro-workspace').length, 2);
    assert.deepEqual(assertCycleScope(p.dir, { projectId: 'proj-maestro-workspace', delivery: 'initiatives', initiativeIds: ['init-kanban', 'init-kanban'] }).initiativeIds, ['init-kanban']);
  } finally { p.limpar(); }
});

test('objective envelope fica vinculado ao escopo de portfólio', () => {
  const p = projetoTemporario('objective-portfolio');
  try {
    createProduct(p.dir, { id: 'prod-orkastery', title: 'Orkastery' });
    createProject(p.dir, { id: 'proj-maestro-workspace', productId: 'prod-orkastery', title: 'Maestro Workspace' });
    createInitiative(p.dir, { id: 'init-ontology', projectId: 'proj-maestro-workspace', title: 'Ontologia' });
    const objective = createObjective(p.carregado, {
      title: 'Ontologia', request: 'Tipar portfólio', doneWhen: ['contrato verde'],
      productId: 'prod-orkastery', projectId: 'proj-maestro-workspace',
      delivery: 'initiatives', initiativeIds: ['init-ontology'], mode: 'auto',
    });
    assert.deepEqual(objective.envelope.portfolio, {
      productId: 'prod-orkastery', projectId: 'proj-maestro-workspace',
      delivery: 'initiatives', initiativeIds: ['init-ontology'],
    });
    assert.throws(() => createObjective(p.carregado, {
      title: 'Órfão', request: 'x', doneWhen: ['y'],
      productId: 'prod-orkastery', projectId: 'proj-missing',
    }), /não encontrado/);
  } finally { p.limpar(); }
});
