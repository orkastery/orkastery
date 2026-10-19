/**
 * RM-061, fatia F3b: o texto pt-BR de `thread list|close|entrega`, `worktree`, `claims`, `decisao`, `accounts`,
 * `network`, `roadmap reservas|pegar|soltar|feat`, `docs verificar|sincronizar`, `adapter`, dos erros de estado, das
 * skills que o `adapter install` copia (pelo recibo) e do prompt de fase fica igual byte a byte, e tambem o que esses
 * comandos gravam no ledger e no `claims.jsonl`. Os casos moram em `locale-f3b-casos.ts`; a fixture foi gerada uma
 * vez por eles sobre o codigo da base (a F3a na `main`, antes da F3b) e este teste so compara. O nome comeca por
 * "locale pt-BR F3b:" para a claim rodar so ele.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { gerarCasos, normalizar } from './locale-f3b-casos';

const FIXTURE = path.resolve(__dirname, '../../test/fixtures/locale-f3b-pt-BR.json');

test('locale pt-BR F3b: o resto do CLI, as skills instaladas e o prompt de fase iguais byte a byte a base', () => {
  const esperado = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  const obtido = gerarCasos();
  assert.deepEqual(Object.keys(obtido), Object.keys(esperado), 'os mesmos casos, na mesma ordem');
  for (const nome of Object.keys(esperado)) assert.equal(obtido[nome], esperado[nome], nome);
});

test('locale pt-BR F3b: SHA7 só de letras é normalizado no contexto de commit sem engolir palavras comuns', () => {
  assert.equal(
    normalizar('commit ceedebe; merge deadbee; remoto cafeabc; @ faceade; a1b2c3d; acabada; decafed'),
    'commit <SHA7>; merge <SHA7>; remoto <SHA7>; @ <SHA7>; <SHA7>; acabada; decafed',
  );
  // Os dois contextos que derrubaram o CI em 19/10 com sha só de letras (aaeecea e ebcbadb).
  assert.equal(
    normalizar('  branch ork/roadmap-reservas em aaeecea\nRede: pc-a publicou o retrato em x/y (ebcbadb, 1 tentativa(s)).\n'),
    '  branch ork/roadmap-reservas em <SHA7>\nRede: pc-a publicou o retrato em x/y (<SHA7>, 1 tentativa(s)).\n',
  );
  assert.equal(normalizar('feito em acabada parte; (decafed) e em faceade cedo'), 'feito em acabada parte; (decafed) e em faceade cedo');
});
