import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { exigirEscopoDeEscrita, validarDiretorioDeThread } from '../src/escopo-escrita';
import { projetoTemporario } from './apoio';

test('CG1: variantes de caixa de protegidas sao recusadas antes de acessar diretorios', () => {
  for (const id of ['ORK-GRANDEEVOLUC', 'Ork-JornadasDpa', 'ORK-RENARRATIVAC']) {
    assert.throws(() => exigirEscopoDeEscrita(['fixture', id]), /^Error: scope.thread.protected$/);
  }
  assert.deepEqual([...exigirEscopoDeEscrita(['Fixture-A'])], ['Fixture-A']);
});

test('CG6: thread inexistente retorna codigo de escopo sem caminho absoluto', () => {
  const p = projetoTemporario('escopo-inexistente');
  try { assert.throws(() => validarDiretorioDeThread(p.dir, 'nao-existe'), /^Error: scope.thread.missing$/); }
  finally { p.limpar(); }
});
