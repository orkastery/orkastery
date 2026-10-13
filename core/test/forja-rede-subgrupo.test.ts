import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { separarRepositorio } from '../src/rede';

test('separa dono e nome pelo último /, com subgrupos', () => {
  assert.deepEqual(separarRepositorio('grupo/sub/casa'), ['grupo/sub', 'casa']);
  assert.deepEqual(separarRepositorio('dono/nome'), ['dono', 'nome']);
  assert.deepEqual(separarRepositorio('so-nome'), [null, 'so-nome']);
  assert.deepEqual(separarRepositorio(undefined), [null, null]);
});
