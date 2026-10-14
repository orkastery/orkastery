import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';

const FIX = path.resolve(__dirname, '../../test/fixtures/forja/github/2026-10');
const corpo = (caso: string) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(FIX, `${caso}.json`), 'utf8')).corpo);
const gravado = (mapa: Record<string, string>) => (caminho: string) => {
  const caso = Object.keys(mapa).find((k) => caminho.includes(k));
  return caso ? { ok: true, code: 0, stdout: corpo(mapa[caso]), stderr: '' } : { ok: false, code: 1, stdout: '', stderr: 'sem resposta' };
};

test('pedidoMesclado do GitHub lê o PR gravado na forma neutra', () => {
  const gh = adaptadorDaForja('github');
  const pr = exigirCapacidade(gh, 'pedidoMesclado')({ repo: 'orkastery/orkastery', numero: 164, executor: gravado({ '/pulls/164': 'pr' }) });
  assert.ok(pr);
  assert.equal(pr!.mesclado, true);
  assert.match(pr!.mergeSha ?? '', /^[0-9a-f]{40}$/);
  assert.match(pr!.headSha ?? '', /^[0-9a-f]{40}$/);
  assert.equal(pr!.base, 'main');
});

test('consulta que falha vira null, nunca PR vazio', () => {
  const pr = exigirCapacidade(adaptadorDaForja('github'), 'pedidoMesclado')({ repo: 'o/r', numero: 1, executor: gravado({}) });
  assert.equal(pr, null);
});
