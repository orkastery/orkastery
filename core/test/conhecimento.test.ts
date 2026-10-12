/**
 * RM-026 K7, fatia 1: conhecimento escrito no contrato `ork.conhecimento/v1`. Cada teste reprova no código de
 * antes desta thread (ork-rm026k7conhe), que não tinha o modo estrito do YAML. O nome de cada teste começa pela
 * decisão do PLAN que ele prova (D1 a D9), a mesma do critério registrado no ledger.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carregarManifesto } from '../src/manifest';
import { lerYaml } from '../src/yaml';
import { dirTemporario } from './apoio';

const PROJETO = 'project:\n  name: "teste"\n  abbrev: "tst"\n';

/** Um projeto mínimo, sem git: o leitor do conhecimento não precisa de repositório. */
function projeto(nome: string, bloco = ''): { dir: string; limpar: () => void } {
  const dir = dirTemporario(`conhecimento-${nome}`);
  fs.writeFileSync(path.join(dir, 'orkastery.yaml'), PROJETO + bloco);
  return { dir, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('D1: o bloco conhecimento declara a pasta; sem ele não há conhecimento, e forma errada só avisa', () => {
  const p = projeto('manifesto');
  try {
    const ler = (bloco: string) => {
      fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), PROJETO + bloco);
      const c = carregarManifesto(p.dir)!;
      assert.deepEqual(c.erros, []);
      return { conhecimento: c.manifesto.conhecimento, avisos: c.avisos.filter((a) => a.startsWith('conhecimento')) };
    };
    assert.deepEqual(ler(''), { conhecimento: undefined, avisos: [] });
    assert.deepEqual(ler('conhecimento:\n  dir: docs/conhecimento\n'), { conhecimento: { dir: 'docs/conhecimento' }, avisos: [] });
    // A regra do caminho é do leitor: o manifesto guarda o texto, e o leitor recusa com lacuna tipada.
    assert.deepEqual(ler('conhecimento:\n  dir: /etc\n'), { conhecimento: { dir: '/etc' }, avisos: [] });
    assert.deepEqual(ler('conhecimento: docs/conhecimento\n'), { conhecimento: undefined,
      avisos: ['conhecimento deve ser um mapa com dir: <pasta dentro da raiz>; o bloco foi ignorado'] });
    assert.deepEqual(ler('conhecimento:\n  dir:\n'), { conhecimento: undefined,
      avisos: ['conhecimento.dir deve ser uma pasta dentro da raiz, como docs/conhecimento; o bloco foi ignorado'] });
    assert.deepEqual(ler('conhecimento:\n  dir: kb\n  pasta: outra\n'), { conhecimento: { dir: 'kb' },
      avisos: ['conhecimento.pasta desconhecida; o bloco conhecimento so tem dir'] });
  } finally { p.limpar(); }
});

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
