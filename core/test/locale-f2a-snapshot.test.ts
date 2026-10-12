/**
 * RM-061, fatia F2a: o texto pt-BR dos comandos que a fatia passa pelo catalogo fica igual byte a
 * byte. Os casos moram em `locale-f2a-casos.ts`; a fixture foi gerada uma vez por eles sobre o codigo
 * da base (antes da F2a) e este teste so compara. Os nomes comecam por "locale pt-BR F2a:" para cada
 * claim rodar so o seu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gerarCasos } from './locale-f2a-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f2a-pt-BR.json');

test('locale pt-BR F2a: doctor, onboarding, experiencia, thread, phase e ajuda iguais byte a byte a base', () => {
  const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const obtido = gerarCasos();
  assert.deepEqual(Object.keys(obtido), Object.keys(esperado), 'os mesmos casos, na mesma ordem');
  for (const nome of Object.keys(esperado)) assert.equal(obtido[nome], esperado[nome], nome);
});
