import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { main } from '../src/index';
import { projetoTemporario } from './apoio';

const RAIZ = path.resolve(__dirname, '../../..');

function opcoesDoUso(uso: string): string[] {
  return [...new Set(uso.match(/--[a-z][a-z-]*/g) ?? [])].sort();
}

function executar(cwd: string, lang: string, argv: string[]): { code: number; stdout: string; stderr: string } {
  const anterior = process.cwd(), langAnterior = process.env.LANG, lcAllAnterior = process.env.LC_ALL;
  const stdout: string[] = [], stderr: string[] = [], log = console.log, error = console.error;
  try {
    process.chdir(cwd);
    process.env.LANG = lang;
    delete process.env.LC_ALL;
    console.log = (...args: unknown[]) => stdout.push(args.join(' '));
    console.error = (...args: unknown[]) => stderr.push(args.join(' '));
    return { code: main(argv), stdout: stdout.join('\n'), stderr: stderr.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    process.chdir(anterior);
    if (langAnterior === undefined) delete process.env.LANG; else process.env.LANG = langAnterior;
    if (lcAllAnterior === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = lcAllAnterior;
  }
}

test('RM-079 F2: a referencia bilingue cobre as opcoes impressas por claims add e verificar', () => {
  const p = projetoTemporario('rm079-f2-cli-reference');
  try {
    for (const [lang, documento] of [['pt_BR.UTF-8', 'docs/referencia/cli.md'], ['en_US.UTF-8', 'docs/referencia/cli.en.md']] as const) {
      const add = executar(p.dir, lang, ['claims', 'add', 'thread-incompleta']);
      const verificar = executar(p.dir, lang, ['claims', 'verificar', 'thread-incompleta']);
      assert.equal(add.code, 2, add.stderr);
      assert.equal(verificar.code, 2, verificar.stderr);
      assert.match(add.stderr, /--claim/);
      assert.match(verificar.stderr, /--comando/);

      const doc = fs.readFileSync(path.join(RAIZ, documento), 'utf8');
      const inicio = doc.indexOf('ork claims add');
      const fim = doc.indexOf('\n| `ork verify <thread>', inicio);
      assert.ok(inicio >= 0 && fim > inicio, documento);
      const secao = doc.slice(inicio, fim);
      for (const opcao of [...opcoesDoUso(add.stderr), ...opcoesDoUso(verificar.stderr)]) {
        assert.ok(secao.includes(opcao), `${documento}: falta ${opcao}`);
      }
    }
  } finally { p.limpar(); }
});
