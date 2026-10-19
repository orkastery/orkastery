/**
 * RM-061, fatia F3c: o texto pt-BR das cinco superficies da fatia (o `.gitignore` do estado, as recusas de `decisao
 * registrar`, o `network roadmap`, a ficha e o pedido do `--from-finding` e os prompts de fase com o `ork prompt`) fica
 * igual byte a byte ao da main de integracao. Os casos moram em `locale-f3c-casos.ts`; a fixture foi gerada uma vez por
 * eles sobre o codigo da main (`8d37c75f`, antes da F3c; regerada depois do merge da RM-064 fatia 2) e este teste so compara. O nome comeca por "locale pt-BR
 * F3c:" para a claim rodar so ele.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gerarCasos } from './locale-f3c-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f3c-pt-BR.json');

test('locale pt-BR F3c: as cinco superficies da fatia iguais byte a byte a main de integracao', () => {
  const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const obtido = gerarCasos();
  assert.deepEqual(Object.keys(obtido), Object.keys(esperado), 'os mesmos casos, na mesma ordem');
  for (const nome of Object.keys(esperado)) assert.equal(obtido[nome], esperado[nome], nome);
});
