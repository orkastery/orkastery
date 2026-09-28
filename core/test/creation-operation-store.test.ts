import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { advanceCreationOperation, creationOperationSchema, listCreationOperations, readCreationOperation, receiveCreationOperation } from '../src/creation-operation-store';

const input = { key: 'fixture-key-001', action: 'create_entity_with_ticket', entity: { kind: 'project', id: 'proj-fixture', parentId: 'prod-fixture', title: 'Ensaio', acceptanceCriteria: ['teste'] }, expectedParentVersion: 1, request: 'Ensaio isolado', doneWhen: ['testes'], workspaceIds: [], mode: 'auto' };
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-creation-store-')); return { root, clean: () => fs.rmSync(root, { recursive: true, force: true }) }; }

test('intenção e identidades sobrevivem a processo perdido; retry não duplica e conflito não sobrescreve', () => {
  const f = fixture();
  try {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('../src/creation-operation-store'))}).receiveCreationOperation(process.argv[1], 'fixture-author', JSON.parse(process.argv[2]), 'ork'); process.exit(19)`, f.root, JSON.stringify(input)], { timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 19, result.stderr.toString());
    const op = receiveCreationOperation(f.root, 'fixture-author', input, 'ork');
    assert.equal(op.version, 1); assert.equal(op.reserved.threadIds.length, 3);
    assert.equal(new Set(op.reserved.threadIds).size, 3);
    assert.deepEqual(readCreationOperation(f.root, op.operationId, 'fixture-author'), op);
    assert.throws(() => receiveCreationOperation(f.root, 'fixture-author', { ...input, request: 'outra intenção' }, 'ork'), /creation.conflict/);
    assert.equal(listCreationOperations(f.root, 'fixture-author').length, 1);
    assert.throws(() => readCreationOperation(f.root, op.operationId, 'outro'), /creation.unavailable/);
    assert.equal(listCreationOperations(f.root, 'outro').length, 0);
    assert.notEqual(receiveCreationOperation(f.root, 'outro', input, 'ork').operationId, op.operationId);
  } finally { f.clean(); }
});

test('journal conserva sequência, rejeita revisão antiga, transição inválida e intenção corrompida', () => {
  const f = fixture();
  try {
    const op = receiveCreationOperation(f.root, 'fixture-author', input, 'ork');
    const change = { state: 'entity_persisted' as const, confirmed: { entityVersion: 1, ticket: false }, nextAction: 'resume' as const, error: null, receipts: [] };
    const next = advanceCreationOperation(f.root, op.operationId, op.principal, 1, change, 'entity.confirmed');
    assert.equal(next.version, 2); assert.deepEqual(next.events.map((e) => e.sequence), [1, 2]);
    assert.throws(() => advanceCreationOperation(f.root, op.operationId, op.principal, 1, change, 'repeat'), /creation.conflict/);
    assert.throws(() => advanceCreationOperation(f.root, op.operationId, op.principal, 2, { ...change, state: 'received' }, 'bad'), /creation.transition/);
    assert.equal(creationOperationSchema.safeParse({ ...next, request: { ...next.request, request: 'alterado' } }).success, false);
    assert.equal(creationOperationSchema.safeParse({ ...next, events: [next.events[1]] }).success, false);
    assert.equal(fs.readdirSync(path.join(f.root, '.orkastery/creation-operations')).filter((n) => n.endsWith('.tmp')).length, 0);
    assert.equal(fs.statSync(path.join(f.root, '.orkastery/creation-operations', op.operationId + '.json')).mode & 0o777, 0o600);
    assert.throws(() => readCreationOperation(f.root, '../portfolio', 'fixture-author'), /creation.id/);
  } finally { f.clean(); }
});

test('escritores concorrentes convergem para uma intenção e lock é liberado após SIGKILL', { timeout: 25000 }, async () => {
  const f = fixture();
  const modulePath = JSON.stringify(require.resolve('../src/creation-operation-store'));
  try {
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', `require(${modulePath}).receiveCreationOperation(process.argv[1], 'fixture-author', JSON.parse(process.argv[2]), 'ork')`, f.root, JSON.stringify(input)], { timeout: 10000 });
      let stderr = ''; child.stderr.on('data', (d) => stderr += d); child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    await Promise.all(Array.from({ length: 5 }, run));
    assert.equal(listCreationOperations(f.root, 'fixture-author').length, 1);
    const child = spawn(process.execPath, ['-e', `require(${modulePath}).withCreationLock(process.argv[1], 'crash-test', () => { process.stdout.write('locked\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); })`, f.root], { timeout: 15000 });
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', (code) => reject(new Error('lock child exited ' + code))); });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL'); await exited;
    const retry = spawnSync(process.execPath, ['-e', `require(${modulePath}).withCreationLock(process.argv[1], 'crash-test', () => {})`, f.root], { timeout: 10000 });
    assert.equal(retry.error, undefined);
    assert.equal(retry.status, 0, retry.stderr.toString());
  } finally { f.clean(); }
});
