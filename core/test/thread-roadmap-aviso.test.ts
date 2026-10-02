import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { avisoRoadmapSemAssociacao, main } from '../src/index';
import * as reservas from '../src/roadmap-reservas';
import { projetoTemporario } from './apoio';

test('nome com RM-NNN recebe instrução útil; associação explícita e nomes comuns não avisam', () => {
  const aviso = avisoRoadmapSemAssociacao('RM-051 pacote de experiência');
  assert.match(aviso!, /ork roadmap reservas/); assert.match(aviso!, /--roadmap RM-051/);
  assert.equal(avisoRoadmapSemAssociacao('RM-051 pacote', 'RM-051'), null);
  assert.equal(avisoRoadmapSemAssociacao('pacote'), null);
  assert.equal(avisoRoadmapSemAssociacao('RM-0512'), null);
});

test('CLI dry-run emite aviso sem reservar nem impedir o resultado', () => {
  const p = projetoTemporario('thread-roadmap-aviso'), cwd = process.cwd();
  const err = mock.method(console, 'error', () => {}), out = mock.method(console, 'log', () => {});
  const pegar = mock.method(reservas, 'pegarItem', () => { throw Error('não deve reservar'); });
  try {
    process.chdir(p.dir);
    assert.equal(main(['thread', 'new', 'RM-051 pacote de experiência', '--modo', 'auto', '--dry-run']), 0);
    assert.ok(err.mock.calls.some(c => String(c.arguments[0]).includes('--roadmap RM-051')));
    assert.ok(out.mock.calls.some(c => String(c.arguments[0]).includes('Simulacao')));
    assert.equal(pegar.mock.callCount(), 0);
  } finally { process.chdir(cwd); err.mock.restore(); out.mock.restore(); pegar.mock.restore(); p.limpar(); }
});
