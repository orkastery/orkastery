/**
 * RM-026 K7, fatia 1: conhecimento escrito no contrato `ork.conhecimento/v1`. Cada teste reprova no código de
 * antes desta thread (ork-rm026k7conhe), que não tinha o modo estrito do YAML. O nome de cada teste começa pela
 * decisão do PLAN que ele prova (D1 a D9), a mesma do critério registrado no ledger.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lerYaml } from '../src/yaml';

test('D9: lerYaml estrito recusa chave repetida, __proto__ e linha fora do bloco; o modo padrão segue igual', () => {
  // O modo padrão, que o orkastery.yaml e as páginas de docs usam, não muda.
  assert.deepEqual(lerYaml('a: 1\na: 2\n'), { a: 2 });
  assert.deepEqual(lerYaml('r:\n  b: [x]\n d: [y]\n'), { r: { b: ['x'] } });

  assert.throws(() => lerYaml('a: 1\na: 2\n', { estrito: true }), /linha 2: chave repetida/);
  assert.throws(() => lerYaml('r:\n  b: 1\n  b: 2\n', { estrito: true }), /linha 3: chave repetida/);
  assert.throws(() => lerYaml('__proto__:\n  id: doc-x\n', { estrito: true }), /linha 1: chave reservada/);
  assert.throws(() => lerYaml('r:\n  b: [x]\n d: [y]\n', { estrito: true }), /linha 3: indentacao fora do bloco/);
  assert.throws(() => lerYaml('a: [x]\n  - y\n', { estrito: true }), /linha 2: indentacao fora do bloco/);

  const valido = 'id: doc-a\ncolecoes: [rh, politicas]\nreferencias:\n  brain:\n    - proj-a\n  decisoes: [ork-x#3]\n';
  assert.deepEqual(lerYaml(valido, { estrito: true }),
    { id: 'doc-a', colecoes: ['rh', 'politicas'], referencias: { brain: ['proj-a'], decisoes: ['ork-x#3'] } });
});
