import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';

const PR = { number: 9, state: 'OPEN', headRefName: 'ork/ork-x', headRefOid: 'a'.repeat(40), baseRefName: 'main', isDraft: false,
  isCrossRepository: false, url: 'https://github.com/o/r/pull/9', createdAt: '2026-10-13T10:00:00Z', mergedAt: null, mergeable: 'MERGEABLE' };

test('pedidosDaBranch chama o mesmo gh pr list de hoje e filtra a branch', () => {
  const chamadas: string[][] = [];
  const r = exigirCapacidade(adaptadorDaForja('github'), 'pedidosDaBranch')({ host: 'github.com', repositorio: 'o/r', base: 'main',
    branch: 'ork/ork-x', prazoMs: 1000, executor: (args) => { chamadas.push([...args]);
      return { status: 0, stdout: JSON.stringify([PR, { ...PR, number: 8, headRefName: 'outra' }]), stderr: '' }; } });
  assert.equal(r.erro, null);
  assert.deepEqual(r.prs.map((p) => p.numero), [9]);
  assert.deepEqual(chamadas[0].slice(0, 4), ['pr', 'list', '--repo=github.com/o/r', '--head=ork/ork-x']);
});

test('abrirPedido chama o mesmo gh pr create de hoje', () => {
  const chamadas: string[][] = [];
  exigirCapacidade(adaptadorDaForja('github'), 'abrirPedido')({ host: 'github.com', repositorio: 'o/r', base: 'main', branch: 'ork/ork-x',
    titulo: 't', corpo: 'c', prazoMs: 1000, executor: (args) => { chamadas.push([...args]); return { status: 0, stdout: '', stderr: '' }; } });
  assert.deepEqual(chamadas[0], ['pr', 'create', '--repo=github.com/o/r', '--base=main', '--head=ork/ork-x', '--title=t', '--body=c']);
});
