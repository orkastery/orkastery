/** RM-061 F3c: `ork prompt` e os prompts de fase seguem a lingua do dono. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ativarLocale, cobreLocale, mensagemDoErro, msg } from '../src/locale';
import { main } from '../src/index';
import { ajustarManifesto, projetoTemporario } from './apoio';
import { linhasEmPortugues } from './locale-apoio';

function executar(...args: string[]): { status: number; stdout: string; stderr: string } {
  const stdout: string[] = [], stderr: string[] = [];
  console.log = (...v: unknown[]) => stdout.push(v.map(String).join(' '));
  console.error = (...v: unknown[]) => stderr.push(v.map(String).join(' '));
  let status: number;
  try { status = main(args); }
  catch (e) { console.error(msg().cli.erro(mensagemDoErro(e))); status = 1; }
  return { status, stdout: stdout.join('\n') + (stdout.length ? '\n' : ''), stderr: stderr.join('\n') + (stderr.length ? '\n' : '') };
}

test('locale en F3c prompts: render, list, lint e recusas saem em ingles', () => {
  assert.ok(cobreLocale(['prompt', 'render'], {}));
  assert.ok(cobreLocale(['prompt', 'list'], {}));
  assert.ok(cobreLocale(['prompt', 'lint'], {}));
  assert.equal(cobreLocale(['prompt', 'render'], { json: true }), false);

  const p = projetoTemporario('prompts-f3c');
  ajustarManifesto(p, 'owner:\n', 'owner:\n  language: en-US\n');
  const cwd = process.cwd(), log = console.log, error = console.error;
  try {
    process.chdir(p.dir);
    const render = executar('prompt', 'render', '--exemplo', '--fase', 'GOAL', '--modo', 'auto', '--pedido', 'Map it.');
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stdout, /^# template fase-padrao\.en v3 \(source: built-in\)/);
    assert.match(render.stdout, /# EXAMPLE thread \(nothing was written\), mode #Auto, sha256 [0-9a-f]{64}/);
    assert.match(render.stdout, /# Orkastery, GOAL phase of thread/);
    assert.match(render.stdout, /## Canonical cycle[\s\S]*## Conduction mode: #Auto[\s\S]*## Builder request\nMap it\./);
    assert.match(render.stdout, /CENTRAL RULE: the mode relaxes the pause, NEVER verification\./);
    assert.deepEqual(linhasEmPortugues(render.stdout), []);

    const lista = executar('prompt', 'list');
    assert.equal(lista.status, 0, lista.stderr);
    assert.match(lista.stdout, /^Prompt templates /);
    assert.match(lista.stdout, /fase-padrao\.en/);
    assert.doesNotMatch(lista.stdout, /Prompt canonico|source: embutido|\n {2}fase-padrao {2}/);

    const lint = executar('prompt', 'lint');
    assert.equal(lint.status, 0, lint.stderr);
    assert.match(lint.stdout, /^Prompt template lint/);
    assert.match(lint.stdout, /templates: 1 \| errors: 0 \| warnings: 0/);

    const invalida = executar('prompt', 'render', '--exemplo', '--fase', 'F7');
    assert.notEqual(invalida.status, 0);
    assert.match(invalida.stderr, /phase "F7" is outside the canonical cycle/);

    ajustarManifesto(p, 'language: en-US', 'language: pt-BR');
    const pt = executar('prompt', 'render', '--exemplo', '--fase', 'GOAL', '--modo', 'auto', '--pedido', 'Mapear.');
    assert.equal(pt.status, 0, pt.stderr);
    assert.match(pt.stdout, /^# template fase-padrao v3 \(origem: /);
    assert.match(pt.stdout, /# Orkastery, fase GOAL da thread/);
    assert.match(pt.stdout, /REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao\./);
  } finally {
    console.log = log; console.error = error; process.chdir(cwd); ativarLocale(undefined); p.limpar();
  }
});

test('locale en F3c prompts: owner.language vence o ambiente na geracao', () => {
  const p = projetoTemporario('prompts-f3c-owner');
  ajustarManifesto(p, 'owner:\n', 'owner:\n  language: en-US\n');
  const cwd = process.cwd(), log = console.log, error = console.error;
  const lcAll = process.env.LC_ALL, lang = process.env.LANG;
  try {
    process.chdir(p.dir); process.env.LC_ALL = 'pt_BR.UTF-8'; process.env.LANG = 'pt_BR.UTF-8';
    const render = executar('prompt', 'render', '--exemplo', '--fase', 'PLAN', '--modo', 'auto', '--pedido', 'Plan it.');
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stdout, /^# template fase-padrao\.en v3 \(source: built-in\)/);
    assert.match(render.stdout, /# Orkastery, PLAN phase of thread/);
  } finally {
    console.log = log; console.error = error; process.chdir(cwd); ativarLocale(undefined);
    if (lcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = lcAll;
    if (lang === undefined) delete process.env.LANG; else process.env.LANG = lang;
    p.limpar();
  }
});
