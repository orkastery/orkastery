import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { userInfo } from 'node:os';
import { main } from '../src/index';
import { createProduct } from '../src/portfolio';
import { projetoTemporario } from './apoio';

test('CLI usa identidade local, oferece journal/eventos e exige revisão para compensar', () => {
  const p = projetoTemporario('creation-cli');
  const cwd = process.cwd(), originalLog = console.log, originalError = console.error;
  try {
    process.chdir(p.dir);
    createProduct(p.dir, { id: 'prod-fixture', title: 'Ensaio' });
    const input = path.join(p.dir, 'input.json');
    fs.writeFileSync(input, JSON.stringify({ key: 'cli-creation-001', action: 'create_entity', entity: { kind: 'project', id: 'proj-fixture', parentId: 'prod-fixture', title: 'CLI', acceptanceCriteria: [] }, expectedParentVersion: 1, request: 'Ensaio CLI', doneWhen: ['persistiu'], workspaceIds: [], mode: 'auto' }));
    const run = (...args: string[]) => {
      const output: string[] = []; console.log = (s) => output.push(String(s)); console.error = () => {};
      const code = main(['creation', ...args]);
      return { code, value: output.length ? JSON.parse(output.join('\n')) : null };
    };
    const session = run('session', '--json');
    assert.equal(session.code, 0);
    assert.equal(session.value.schema, 'ork.creation-session/v1');
    assert.equal(session.value.principal, 'local:uid:' + userInfo().uid);
    assert.deepEqual(session.value.actions, ['create_entity', 'create_entity_with_ticket', 'open_ticket']);
    assert.ok(session.value.modes.includes('auto'));
    const first = run('start', '--input-file', input, '--json');
    assert.equal(first.code, 0); assert.equal(first.value.state, 'completed');
    assert.equal(first.value.principal, `local:uid:${userInfo().uid}`);
    assert.deepEqual(run('show', first.value.operationId, '--json').value, first.value);
    assert.equal(run('list', '--json').value.length, 1);
    assert.equal(run('events', first.value.operationId, '--json').value.events.length, first.value.version);
    assert.equal(run('compensate', first.value.operationId).code, 2);
    assert.throws(() => run('start', '--input-file', input, '--principal', 'spoof'), /creation.identity/);
    assert.equal(run('compensate', first.value.operationId, '--expected-version', String(first.value.version), '--json').value.state, 'compensated');
  } finally { console.log = originalLog; console.error = originalError; process.chdir(cwd); p.limpar(); }
});
