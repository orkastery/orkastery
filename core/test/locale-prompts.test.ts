/** RM-061 F3c: `ork prompt` e os prompts de fase seguem a lingua do dono. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cobreLocale } from '../src/locale';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

test('locale en F3c prompts: render, list, lint e recusas saem em ingles', () => {
  assert.ok(cobreLocale(['prompt', 'render'], {}));
  assert.ok(cobreLocale(['prompt', 'list'], {}));
  assert.ok(cobreLocale(['prompt', 'lint'], {}));
  assert.equal(cobreLocale(['prompt', 'render'], { json: true }), false);

  const c = cenario('prompts-f3c');
  try {
    const render = ork(c, EN, false, 'prompt', 'render', '--exemplo', '--fase', 'GOAL', '--modo', 'auto', '--pedido', 'Map it.');
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stdout, /^# template fase-padrao\.en v3 \(source: /);
    assert.match(render.stdout, /# EXAMPLE thread \(nothing was written\), mode #Auto, sha256 [0-9a-f]{64}/);
    assert.match(render.stdout, /# Orkastery, GOAL phase of thread/);
    assert.match(render.stdout, /## Canonical cycle[\s\S]*## Conduction mode: #Auto[\s\S]*## Builder request\nMap it\./);
    assert.match(render.stdout, /CENTRAL RULE: the mode relaxes the pause, NEVER verification\./);
    assert.deepEqual(linhasEmPortugues(render.stdout), []);

    const lista = ork(c, EN, false, 'prompt', 'list');
    assert.equal(lista.status, 0, lista.stderr);
    assert.match(lista.stdout, /^Prompt templates /);
    assert.match(lista.stdout, /fase-padrao\.en/);

    const lint = ork(c, EN, false, 'prompt', 'lint');
    assert.equal(lint.status, 0, lint.stderr);
    assert.match(lint.stdout, /^Prompt template lint/);
    assert.match(lint.stdout, /templates: 2 \| errors: 0 \| warnings: 0/);

    const invalida = ork(c, EN, false, 'prompt', 'render', '--exemplo', '--fase', 'F7');
    assert.notEqual(invalida.status, 0);
    assert.match(invalida.stderr, /phase "F7" is outside the canonical cycle/);

    const pt = ork(c, PT, false, 'prompt', 'render', '--exemplo', '--fase', 'GOAL', '--modo', 'auto', '--pedido', 'Mapear.');
    assert.equal(pt.status, 0, pt.stderr);
    assert.match(pt.stdout, /^# template fase-padrao v3 \(origem: /);
    assert.match(pt.stdout, /# Orkastery, fase GOAL da thread/);
    assert.match(pt.stdout, /REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao\./);
  } finally {
    c.limpar();
  }
});

test('locale en F3c prompts: owner.language vence o ambiente na geracao', () => {
  const c = cenario('prompts-f3c-owner');
  try {
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'test').status, 0);
    const render = ork(c, PT, false, 'prompt', 'render', '--exemplo', '--fase', 'PLAN', '--modo', 'auto', '--pedido', 'Plan it.');
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stdout, /^# template fase-padrao\.en v3 \(source: /);
    assert.match(render.stdout, /# Orkastery, PLAN phase of thread/);
  } finally {
    c.limpar();
  }
});
