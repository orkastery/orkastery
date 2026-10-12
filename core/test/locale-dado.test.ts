/**
 * RM-061, fatia F2a: o catalogo inteiro (todas as familias) e o contrato do `--json`. O ingles tem as
 * mesmas chaves e os mesmos tipos de folha do pt-BR, nenhuma mensagem vazia e nenhum travessao U+2014; o
 * `--json` dos comandos cobertos nao muda com a lingua. O dado gravado por familia fica nos testes de
 * cada uma (onboarding, thread, phase). Os nomes comecam por "locale F2a catalogo:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { msg } from '../src/locale';
import { cenario, EN, ork, PT } from './locale-apoio';

type Arvore = Record<string, unknown>;

/** RM-061 (F3b): as familias que a fatia acrescenta ao catalogo, na ordem em que entram. */
const FAMILIAS_DA_F3B: readonly string[] = ['worktree', 'estado', 'claims'];

/** Cada folha do catalogo: o caminho, o tipo (`string`, `function`, `number`) e o valor. */
function folhas(o: Arvore, pre = ''): Array<{ k: string; tipo: string; v: unknown }> {
  return Object.entries(o).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !(pre === 'doctor.' && k === 'nomes') ? folhas(v as Arvore, `${pre}${k}.`) : [{ k: `${pre}${k}`, tipo: typeof v, v }]);
}

test('locale F2a catalogo: o ingles tem as mesmas chaves e os mesmos tipos de folha do pt-BR em todas as familias', () => {
  const pt = folhas(msg('pt-BR') as unknown as Arvore), en = folhas(msg('en') as unknown as Arvore);
  assert.deepEqual(en.map(({ k, tipo }) => [k, tipo]), pt.map(({ k, tipo }) => [k, tipo]));
  for (const familia of ['cli', 'horario', 'doctor', 'init', 'onboarding', 'thread', 'phase', 'ajuda', 'verify', 'ship', 'retry', 'master', 'pulse', 'roadmap', 'gerados',
    // F3b
    ...FAMILIAS_DA_F3B]) {
    assert.ok(pt.some(({ k }) => k.startsWith(`${familia}.`)), familia);
  }
});

test('locale F2a catalogo: nenhuma mensagem vazia nem igual ao pt-BR por descuido, e nenhum travessao U+2014', () => {
  const pt = folhas(msg('pt-BR') as unknown as Arvore), en = folhas(msg('en') as unknown as Arvore);
  // Iguais de proposito: identificador, comando ou rotulo que e a mesma palavra nas duas linguas.
  const iguaisPermitidos = new Set(['thread.rotulos.id', 'thread.rotulos.slug', 'thread.rotulos.status', 'thread.rotulos.base',
    'thread.rotulos.worktree', 'thread.rotulos.score', 'phase.rotulos.prompt', 'phase.rotulos.sha256', 'phase.rotulos.runtime',
    'phase.rotulos.sessionId', 'doctor.rodeInit', 'thread.operacoes.verify', 'thread.operacoes.baseline', 'thread.operacoes.fix.open',
    'thread.operacoes.fix.reverify', 'thread.operacoes.mcp.verify',
    // F2b: o mesmo rotulo nas duas linguas, e a correcao que e so um comando.
    'verify.comandoOk', 'retry.politica.runtime.silencio.correcao', 'retry.politica.human.pending.correcao',
    'master.colunas.0', 'master.colunas.1', 'master.colunas.4', 'master.colunasAceitas.0',
    // F3b: os rotulos de tabela que sao a mesma palavra nas duas linguas.
    'thread.colunasDaLista.0', 'thread.colunasDaLista.1', 'thread.colunasDaLista.4', 'claims.colunas.0']);
  en.forEach(({ k, tipo, v }, i) => {
    if (tipo !== 'string') return;
    assert.ok((v as string).trim(), `${k} vazia`);
    if (!iguaisPermitidos.has(k)) assert.notEqual(v, pt[i].v, `${k} igual ao pt-BR`);
  });
  const src = path.resolve(__dirname, '../../src');
  for (const arquivo of fs.readdirSync(src).filter((f) => /^locale(-[a-z]+)?\.ts$/.test(f))) {
    assert.ok(!fs.readFileSync(path.join(src, arquivo), 'utf8').includes('\u2014'), `${arquivo} com travessao`);
  }
});

test('locale F2a catalogo: o --json dos comandos cobertos nao muda com a lingua', () => {
  const c = cenario('catalogo-json');
  try {
    assert.equal(ork(c, PT, true, 'thread', 'new', 'Json', '--modo', 'auto', '--sem-worktree').status, 0);
    const iguais = (args: string[]) => {
      const pt = ork(c, PT, true, ...args), en = ork(c, EN, true, ...args);
      assert.equal(en.status, pt.status, args.join(' '));
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.doesNotThrow(() => JSON.parse(pt.stdout), args.join(' '));
    };
    iguais(['onboarding', '--json']);
    iguais(['onboarding', 'show', '--json']);
    iguais(['thread', 'status', 'loc-json', '--json']);
    iguais(['thread', 'list', '--json']);
    iguais(['projetos', '--json']);
  } finally { c.limpar(); }
});
