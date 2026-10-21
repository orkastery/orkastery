/**
 * RM-061, fatia F3d: o texto pt-BR das familias que a F3d levou ao catalogo (`portfolio`, `creation`, `objective`,
 * `ci`, `setup`, `projetos`, `modos`, `ciclos`, `sessions`, `gate`, as recusas HITL, `pulse cadencia`, `fix`, `handoff`,
 * `recall`, `retry`, `ledger`, `conducao`, `lease`, `board`, `monitor`, `memory`, a memoria do prompt, `grafo`,
 * `audit`, `fabrica`, `eval`, `licoes`, `master`, `mcp install` e `demo`) fica igual byte a byte ao da base. Os casos
 * moram em `locale-f3d-casos.ts` e nos modulos de cada grupo; a fixture foi gerada uma vez por eles sobre o codigo da
 * base (a `main` em `97c2a446`, antes da F3d) e este teste so compara, um teste por grupo. O nome comeca por
 * "locale pt-BR F3d:" para a claim rodar so ele. Os casos de CLI rodam o `core/dist/index.js` em processo filho: a
 * mutacao que prova o teste vai no fonte (com o build) ou no `core/dist`, nao so na memoria do processo do teste.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { casosDoGrupo, GRUPOS } from './locale-f3d-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f3d-pt-BR.json');
const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, Record<string, string>>;

test('locale pt-BR F3d: a fixture tem os grupos dos casos, na mesma ordem', () => {
  assert.deepEqual(GRUPOS.map(([nome]) => nome), Object.keys(esperado));
});

for (const [grupo] of GRUPOS) {
  test(`locale pt-BR F3d: ${grupo} igual byte a byte a base`, () => {
    const obtido = casosDoGrupo(grupo);
    const daBase = esperado[grupo] ?? {};
    assert.deepEqual(Object.keys(obtido), Object.keys(daBase), 'os mesmos casos, na mesma ordem');
    for (const nome of Object.keys(daBase)) assert.equal(obtido[nome], daBase[nome], nome);
  });
}
