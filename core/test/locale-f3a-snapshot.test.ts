/**
 * RM-061, fatia F3a: os arquivos que o CLI gera em pt-BR ficam iguais byte a byte (o `orkastery.yaml` e o
 * bloco do `AGENTS.md` do `ork init`, o bloco da experiencia do `CLAUDE.md` e do `AGENTS.md`, os sete arquivos
 * do `ork docs init`), e tambem o texto que `ork init` e `ork docs init` imprimem. Os casos moram em
 * `locale-f3a-casos.ts`; a fixture foi gerada uma vez por eles sobre o codigo da base (a F2b na `main`, antes da
 * F3a) e este teste so compara. O nome comeca por "locale pt-BR F3a:" para a claim rodar so o seu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gerarCasos } from './locale-f3a-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f3a-pt-BR.json');

test('locale pt-BR F3a: arquivos gerados por init, adapter install e docs init iguais byte a byte a base', () => {
  const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const obtido = gerarCasos();
  assert.deepEqual(Object.keys(obtido), Object.keys(esperado), 'os mesmos casos, na mesma ordem');
  for (const nome of Object.keys(esperado)) assert.equal(obtido[nome], esperado[nome], nome);
});
