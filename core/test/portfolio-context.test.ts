import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { createInitiative, createProduct, createProject, findEntity } from '../src/portfolio';
import { approveObjective, createObjective, stopObjective } from '../src/objective';
import { inspectPortfolio } from '../src/portfolio-context';
import { main } from '../src/index';

const projectId = 'proj-maestro-workspace';
const initiatives = ['init-i18-portfolio-ontology', 'init-i19-multirepo-catalog', 'init-i20-kanban-modes', 'init-i21-channel-continuity', 'init-i22-runtime-config', 'init-i23-copilot-maestro', 'init-i24-ux-docs'];

test('oito IDs de ensaio entregues são inspecionáveis sem ciclo, com origem e lacuna de recibo', () => {
  const p = projetoTemporario('portfolio-context-eight');
  try {
    createProduct(p.dir, { id: 'prod-orkastery', title: 'Produto de ensaio' });
    createProject(p.dir, { id: projectId, productId: 'prod-orkastery', title: 'Projeto de ensaio', status: 'delivered' });
    for (const id of initiatives) createInitiative(p.dir, { id, projectId, title: 'Iniciativa de ensaio', status: 'delivered' });
    for (const id of [projectId, ...initiatives]) {
      const before = findEntity(p.dir, id);
      const context = inspectPortfolio(p.dir, id);
      assert.equal(context.entity.id, id); assert.equal(context.entity.status, 'delivered');
      assert.equal(context.cyclesMessage, 'Nenhum ciclo vinculado');
      assert.equal(context.cyclesState, 'available'); assert.equal(context.cycles.length, 0);
      assert.equal(context.origin.reference, `portfolio:${id}`);
      assert.ok(context.gaps.includes('delivery.receipt_not_loaded'));
      assert.ok(context.parent); assert.deepEqual(findEntity(p.dir, id), before);
    }
    const unavailable = inspectPortfolio(p.dir, projectId, () => { throw new Error('fixture.private_detail'); });
    assert.equal(unavailable.entity.status, 'delivered');
    assert.equal(unavailable.cyclesState, 'unavailable');
    assert.notEqual(unavailable.cyclesMessage, 'Nenhum ciclo vinculado');
    assert.ok(!JSON.stringify(unavailable).includes('private_detail'));
    assert.throws(() => inspectPortfolio(p.dir, 'proj-missing'), /portfolio.unavailable/);
    assert.throws(() => inspectPortfolio(p.dir, '../portfolio'), /portfolio.id/);
  } finally { p.limpar(); }
});

test('contexto conserva todos os ciclos, escopo parcial, interrompido e conflitos sem inferir entrega', () => {
  const p = projetoTemporario('portfolio-context-cycles');
  try {
    createProduct(p.dir, { id: 'prod-orkastery', title: 'Ensaio' });
    createProject(p.dir, { id: projectId, productId: 'prod-orkastery', title: 'Ensaio', status: 'delivered' });
    for (const id of initiatives.slice(0, 2)) createInitiative(p.dir, { id, projectId, title: 'Ensaio' });
    const common = { request: 'Ensaio', doneWhen: ['verde'], productId: 'prod-orkastery', projectId, mode: 'auto' as const };
    const full = createObjective(p.carregado, { ...common, title: 'Projeto', delivery: 'project' });
    const partial = createObjective(p.carregado, { ...common, title: 'Parcial', delivery: 'initiatives', initiativeIds: [initiatives[0]] });
    stopObjective(p.dir, full.id);
    approveObjective(p.dir, partial.id, 'fixture-owner');
    const project = inspectPortfolio(p.dir, projectId);
    assert.equal(project.cycles.length, 2);
    assert.equal(project.cycles.find((c) => c.id === full.id)?.statusLabel, 'Interrompido');
    assert.equal(project.cycles.find((c) => c.id === partial.id)?.relation, 'initiative_delivery');
    assert.deepEqual(project.conflicts, [{ code: 'entity.delivered_cycle_open', cycleId: partial.id }]);
    assert.ok(project.cycles.every((c) => !c.entityDeliveryProven));
    const first = inspectPortfolio(p.dir, initiatives[0]);
    assert.equal(first.cycles.length, 2);
    assert.equal(first.cycles.find((c) => c.id === full.id)?.relation, 'project_context');
    assert.equal(inspectPortfolio(p.dir, initiatives[1]).cycles.length, 1);
  } finally { p.limpar(); }
});

test('CLI portfolio inspect expõe contrato sem criar ticket nem agente', () => {
  const p = projetoTemporario('portfolio-context-cli');
  const cwd = process.cwd(), log = console.log;
  try {
    createProduct(p.dir, { id: 'prod-orkastery', title: 'Ensaio', status: 'cancelled' });
    process.chdir(p.dir);
    let output = ''; console.log = (s) => { output += String(s); };
    assert.equal(main(['portfolio', 'inspect', 'prod-orkastery', '--json']), 0);
    const result = JSON.parse(output);
    assert.equal(result.schema, 'ork.portfolio-context/v1');
    assert.equal(result.entity.status, 'cancelled');
    assert.deepEqual(result.cycles, []);
  } finally { console.log = log; process.chdir(cwd); p.limpar(); }
});
