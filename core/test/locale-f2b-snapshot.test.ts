/**
 * RM-061, fatia F2b: o texto pt-BR de `verify`, `ship`, `retry`, `master`, `pulse` e `roadmap status` fica
 * igual byte a byte, e tambem os detalhes que esses comandos gravam no ledger. Os casos moram em
 * `locale-f2b-casos.ts`; a fixture foi gerada uma vez por eles sobre o codigo da base (a F2a na `main`,
 * antes da F2b) e este teste so compara. Os nomes comecam por "locale pt-BR F2b:" para cada claim rodar
 * so o seu.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gerarCasos } from './locale-f2b-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f2b-pt-BR.json');
const SEM_SUBPROCESSO_NO_SANDBOX_EXTERNO = process.env.CODEX_SANDBOX_NETWORK_DISABLED
  && process.env.ORK_TESTE_EXIGE_AMBIENTE !== '1'
  ? 'sandbox externo do Codex não preserva os subprocessos da CLI; o CI hermético força esta prova'
  : false;

test('locale pt-BR F2b: verify, ship, retry, master, pulse e roadmap status iguais byte a byte a base',
  { skip: SEM_SUBPROCESSO_NO_SANDBOX_EXTERNO }, () => {
  const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const obtido = gerarCasos();
  assert.deepEqual(Object.keys(obtido), Object.keys(esperado), 'os mesmos casos, na mesma ordem');
  for (const nome of Object.keys(esperado)) assert.equal(obtido[nome], esperado[nome], nome);
});
