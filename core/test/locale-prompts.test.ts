/** RM-061 F3c: `ork prompt` e os prompts de fase seguem a lingua do dono. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ativarLocale, cobreLocale, mensagemDoErro, msg } from '../src/locale';
import { main } from '../src/index';
import { hashDoPrompt, montarPromptComMemoria } from '../src/phase';
import { TEMPLATE_FASE_PADRAO } from '../src/prompts';
import { novaThread } from '../src/thread';
import { abrirMemoria } from '../src/memoria';
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
    assert.match(render.stdout, /^# template fase-padrao\.en v5 \(source: built-in\)/);
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
    assert.match(pt.stdout, /^# template fase-padrao v5 \(origem: /);
    assert.match(pt.stdout, /# Orkastery, fase GOAL da thread/);
    assert.match(pt.stdout, /REGRA CENTRAL: o modo afrouxa a pausa, NUNCA a verificacao\./);
  } finally {
    console.log = log; console.error = error; process.chdir(cwd); ativarLocale(undefined); p.limpar();
  }
});

test('locale en F3c prompts: o render mostra o prompt do despacho, e o --template fala a lingua dele', () => {
  // Sem owner.language, o phase run grava o prompt em pt-BR com qualquer LANG; o render, que mostra esse prompt, tambem.
  const p = projetoTemporario('prompts-f3c-despacho');
  const cwd = process.cwd(), log = console.log, error = console.error;
  const lcAll = process.env.LC_ALL, lang = process.env.LANG;
  try {
    process.chdir(p.dir); process.env.LC_ALL = 'en_US.UTF-8'; process.env.LANG = 'en_US.UTF-8';
    const { thread } = novaThread(p.carregado, { nome: 'despacho', modo: 'auto' });
    const render = executar('prompt', 'render', thread.id, 'GOAL', '--pedido', 'Mapear a mudanca.');
    assert.equal(render.status, 0, render.stderr);
    assert.match(render.stdout, /^# template fase-padrao v5 \(source: built-in\)\n# thread \S+, phase GOAL, sha256 [0-9a-f]{64}\n/);
    assert.match(render.stdout, /\n# Orkastery, fase GOAL da thread /);
    const { prompt } = montarPromptComMemoria(p.carregado, thread, 'GOAL', 'Mapear a mudanca.', abrirMemoria(p.carregado));
    assert.ok(render.stdout.includes(`, sha256 ${hashDoPrompt(prompt)}\n`), 'o mesmo sha256 do prompt que o phase run grava');
    const lista = executar('prompt', 'list');
    assert.match(lista.stdout, /^Prompt templates /);
    assert.match(lista.stdout, /\n {2}fase-padrao {6}v5 {2}source: built-in\n/);
    assert.doesNotMatch(lista.stdout, /fase-padrao\.en/);
    // O --template escolhe tambem a lingua dos valores: o `.en` sai inteiro em ingles, sem modulo em pt-BR.
    const en = executar('prompt', 'render', '--exemplo', '--fase', 'GO', '--modo', 'fast', '--template', 'fase-padrao.en', '--pedido', 'Fix it.');
    assert.equal(en.status, 0, en.stderr);
    assert.match(en.stdout, /\n> GO \(F3\): implement slice by slice/);
    assert.doesNotMatch(en.stdout, /implementacao slice por slice|Nada de self-report/);
  } finally {
    console.log = log; console.error = error; process.chdir(cwd); ativarLocale(undefined);
    if (lcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = lcAll;
    if (lang === undefined) delete process.env.LANG; else process.env.LANG = lang;
    p.limpar();
  }
});

test('locale en F3c prompts: com o dono em ingles, o lint avisa o template do projeto sem par .en', () => {
  const p = projetoTemporario('prompts-f3c-par');
  ajustarManifesto(p, 'owner:\n', 'owner:\n  language: en-US\n');
  const cwd = process.cwd(), log = console.log, error = console.error;
  try {
    process.chdir(p.dir);
    fs.mkdirSync(path.join(p.dir, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'prompts', 'fase-goal.md'), TEMPLATE_FASE_PADRAO.replace('id: fase-padrao', 'id: fase-goal') + '\n');
    const lint = executar('prompt', 'lint');
    assert.equal(lint.status, 0, lint.stderr);
    assert.match(lint.stdout, /\n {2}\[warning\] fase-goal :: idioma\n {11}the owner speaks English and the project template fase-goal has no fase-goal\.en counterpart: that phase is rendered in pt-BR\n/);
    assert.match(lint.stdout, /templates: 2 \| errors: 0 \| warnings: 1/);
    const lista = executar('prompt', 'list');
    assert.match(lista.stdout, /\n {2}fase-goal /);
    assert.match(lista.stdout, /\n {2}fase-padrao\.en /);
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
    assert.match(render.stdout, /^# template fase-padrao\.en v5 \(source: built-in\)/);
    assert.match(render.stdout, /# Orkastery, PLAN phase of thread/);
  } finally {
    console.log = log; console.error = error; process.chdir(cwd); ativarLocale(undefined);
    if (lcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = lcAll;
    if (lang === undefined) delete process.env.LANG; else process.env.LANG = lang;
    p.limpar();
  }
});

test('locale en F3d prompts: o bloco de memoria injetada fala a lingua do prompt', () => {
  const p = projetoTemporario('prompts-f3d-memoria');
  ajustarManifesto(p, 'owner:\n', 'owner:\n  language: en-US\n');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'memory prompt', modo: 'auto' });
    thread.decisoes.push({ id: 'D1', texto: 'conteudo preservado', locked: true,
      decididaEm: '2026-10-20T00:00:00.000Z', decididaPor: 'agent' });
    const { prompt } = montarPromptComMemoria(p.carregado, thread, 'GO', 'Implement it.', abrirMemoria(p.carregado));
    assert.match(prompt, /## Injected memory \(files regime\)/);
    assert.match(prompt, /Deterministic retrieval by tag/);
    assert.match(prompt, /### Closed decisions from this thread \(included in EVERY phase\) \(1\)/);
    assert.match(prompt, /- Decision D1 \(closed by agent\)/);
    assert.match(prompt, /  source: \.orkastery\/threads\/\S+\/thread\.json#json:decisoes\.D1/);
    assert.match(prompt, /  conteudo preservado/);
    assert.doesNotMatch(prompt, /Memoria injetada|Recuperacao deterministica|Decisoes fechadas|origem:/);
  } finally { p.limpar(); }
});
