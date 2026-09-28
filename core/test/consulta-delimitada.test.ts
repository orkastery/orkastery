import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validarConsultaDelimitada, tagsDoEscopo } from '../src/orkmind';
const query = () => ({ collection: 'handoff', escopo: { tenant: 'fabrica', thread: 'ork-teste' },
  tags: { skill: ['GOAL', 'PLAN'] }, limite: 100 });
test('consulta copia escopo e tags, empurra somente as fronteiras', () => {
  const q = query(), v = validarConsultaDelimitada(q);
  q.escopo.tenant = 'outra'; q.tags.skill.push('GO');
  assert.deepEqual(tagsDoEscopo(v.escopo), { project: ['fabrica'], situation: ['thread:ork-teste'] });
  assert.deepEqual(v.tags.skill, ['GOAL', 'PLAN']);
  assert.throws(() => { (v.escopo as any).tenant = 'outra'; });
});
test('consulta invalida ou contraditoria recusa antes do transporte', () => {
  for (const delta of [{ collection: undefined }, { collection: 'session' }, { limite: 0 }, { limite: 1.5 },
    { limite: Infinity }, { limite: 1001 }, { limite: '10' }, { requester: 'admin' },
    { escopo: { tenant: 'fabrica', thread: '../outra' } },
    { escopo: { tenant: 'fabrica', thread: 'ork-teste', grant: true } },
    { tags: null }, { tags: { skill: 'GOAL' } }, { tags: { desconhecida: [] } },
    { tags: { project: ['outra'] } }, { tags: { situation: ['thread:outra'] } },
    { tags: { skill: Array(33).fill('GO') } }, { tags: { skill: ['x'.repeat(257)] } }]) {
    assert.throws(() => validarConsultaDelimitada({ ...query(), ...delta }), /memory.query./);
  }
});
