import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { recusaDaFila } from '../src/fila-pesada';

test('recusa portátil sem data não imprime desde vazio', () => {
  const recusa = recusaDaFila({
    artefato: '/fixture',
    operacao: 'verify',
    thread: 'ork-fixture',
    slots: 1,
    esperarMs: 0,
  }, 0, [{
    slot: 0,
    operacao: 'teste',
    thread: null,
    artefato: '',
    pid: 42,
    desde: '',
    vida: 'vivo',
    prova: 'processo',
  }]);
  assert.match(recusa.texto, /Quem ocupa: teste, processo 42/);
  assert.doesNotMatch(recusa.texto, /desde\s*,/);
});
