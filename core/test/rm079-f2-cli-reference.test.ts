import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cenario, EN, ork, PT } from './locale-apoio';

const RAIZ = path.resolve(__dirname, '../../..');

function opcoesDoUso(uso: string): string[] {
  return [...new Set(uso.match(/--[a-z][a-z-]*/g) ?? [])].sort();
}

test('RM-079 F2: a referencia bilingue cobre as opcoes impressas por claims add e verificar', () => {
  const c = cenario('rm079-f2-cli-reference');
  try {
    for (const [locale, documento] of [[PT, 'docs/referencia/cli.md'], [EN, 'docs/referencia/cli.en.md']] as const) {
      const add = ork(c, locale, false, 'claims', 'add', 'thread-incompleta');
      const verificar = ork(c, locale, false, 'claims', 'verificar', 'thread-incompleta');
      assert.equal(add.status, 2, add.stderr);
      assert.equal(verificar.status, 2, verificar.stderr);

      const doc = fs.readFileSync(path.join(RAIZ, documento), 'utf8');
      const inicio = doc.indexOf('ork claims add');
      const fim = doc.indexOf('ork verify', inicio);
      assert.ok(inicio >= 0 && fim > inicio, documento);
      const secao = doc.slice(inicio, fim);
      for (const opcao of [...opcoesDoUso(add.stderr), ...opcoesDoUso(verificar.stderr)]) {
        assert.ok(secao.includes(opcao), `${documento}: falta ${opcao}`);
      }
    }
  } finally { c.limpar(); }
});
