/**
 * RM-061, fatia F2a: `ork onboarding` (pauta, show, set, reset) e `ork experiencia show` em ingles.
 * Os nomes comecam por "locale en F2a onboarding:" para cada claim rodar so o seu. O pt-BR byte a
 * byte fica com o snapshot (`locale-f2a-snapshot`).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ONDE_FICAM_OS_SEGREDOS, PAUTA_ONBOARDING, perguntaDaEtapa } from '../src/onboarding';
import { msg } from '../src/locale';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

test('locale en F2a onboarding: pauta, show, set e reset saem em ingles', () => {
  const c = cenario('onboarding-en');
  try {
    const show = ork(c, EN, false, 'onboarding');
    assert.equal(show.status, 0, show.stderr);
    const linhas = show.stdout.trimEnd().split('\n');
    assert.equal(linhas[0], 'Project onboarding (ork.onboarding/v1)');
    assert.equal(linhas[1], 'Recommended experience: en-US, America/New_York, depth curta. Turn it on with these values, configure it or turn it off?');
    assert.match(linhas[2], /^Record the choice in maestro with \{"owner":\{"language":"en-US","timezone":"America\/New_York","depth":"curta","experience":true\}\}; use experience:false to turn it off\. Viewing does not record an answer\.$/);
    assert.match(linhas[3], /^\[pending\] maestro: Who runs the project, what are their goals and preferences/);
    assert.equal(linhas.at(-1), 'Answer with `ork onboarding set <step> --conteudo <JSON> --por <who>`.');
    assert.equal(linhas.length, 13);
    assert.deepEqual(linhasEmPortugues(show.stdout), []);
    assert.equal(ork(c, EN, false, 'onboarding', 'show').stdout, show.stdout);
    const set = ork(c, EN, false, 'onboarding', 'set', 'produtos', '--conteudo', '{"produtos":["loc"]}', '--por', 'teste');
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /\n\[answered\] produtos: Which public products and repositories belong to the project\?\n/);
    const reset = ork(c, EN, false, 'onboarding', 'reset', 'produtos', '--por', 'teste');
    assert.match(reset.stdout, /\n\[pending\] produtos: /);
    const alias = ork(c, EN, false, 'onboarding', '--reset', '--por', 'teste');
    assert.equal(alias.status, 0, alias.stderr);
    assert.deepEqual(linhasEmPortugues(set.stdout + reset.stdout + alias.stdout), []);
    // Controle do detector: a mesma pauta em pt-BR e acusada.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'onboarding').stdout).length >= 8, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2a onboarding: os erros de uso saem em ingles, com error:', () => {
  const c = cenario('onboarding-erros');
  try {
    const sub = ork(c, EN, false, 'onboarding', 'qualquer');
    assert.equal(sub.status, 1);
    assert.equal(sub.stderr, 'error: onboarding.input.invalid: use `ork onboarding [show|set <step>|reset [step]] --conteudo <JSON> [--por WHO] [--json]`\n');
    const segredo = ork(c, EN, false, 'onboarding', 'set', 'produtos', '--conteudo', '{"senha":"x"}', '--por', 'teste');
    assert.equal(segredo.stderr, 'error: onboarding.input.invalid: use public JSON and variable references; secrets live in the process ' +
      'environment or in the host vault (with Hermes, ~/.hermes/.env)\n');
    const etapa = ork(c, EN, false, 'onboarding', 'set', 'nenhuma', '--conteudo', '{}', '--por', 'teste');
    assert.match(etapa.stderr, /^error: onboarding\.input\.invalid: use public JSON/);
    const experiencia = ork(c, EN, false, 'experiencia', 'show', '--x');
    assert.equal(experiencia.stderr, 'error: usage: ork experiencia show [--json]\n');
  } finally { c.limpar(); }
});

test('locale en F2a onboarding: experiencia show em ingles, com as origens e o aviso', () => {
  const c = cenario('experiencia-en');
  try {
    const r = ork(c, EN, false, 'experiencia', 'show');
    assert.equal(r.stdout, 'Experience on: en-US, America/New_York, depth curta.\nSkill: orchestration-experience\n' +
      'Sources: language system, timezone system, depth default, experience default\n');
    assert.equal(ork(c, EN, false, 'experiencia').stdout, r.stdout);
    fs.appendFileSync(path.join(c.dir, 'orkastery.yaml'), '\nowner:\n  depth: "funda"\n');
    const aviso = ork(c, EN, false, 'experiencia', 'show');
    // O aviso que o manifesto gravou em pt-BR sai traduzido na impressao (D14); o --json leva o gravado.
    assert.match(aviso.stdout, /\nWarning: experiencia\.config\.invalid: `owner\.depth` requires `curta` or `detalhada`; the default is used for now; `ork adapter install` skips the package until `ork onboarding set maestro` fixes it\.\n$/);
  } finally { c.limpar(); }
});

test('locale en F2a onboarding: a pauta pt-BR, a frase dos segredos e o dado gravado nao mudam', () => {
  assert.equal(ONDE_FICAM_OS_SEGREDOS, 'no ambiente do processo ou no cofre do host (no Hermes, ~/.hermes/.env)');
  assert.equal(msg('pt-BR').onboarding.segredos, ONDE_FICAM_OS_SEGREDOS);
  for (const { etapa, pergunta } of PAUTA_ONBOARDING) {
    assert.equal(perguntaDaEtapa(etapa, 'pt-BR'), pergunta);
    assert.notEqual(perguntaDaEtapa(etapa, 'en'), pergunta, etapa);
  }
  const pt = cenario('onboarding-dado-pt'), en = cenario('onboarding-dado-en');
  try {
    const estado = (c: typeof pt) => {
      const bruto = JSON.parse(fs.readFileSync(path.join(c.dir, '.orkastery', 'onboarding.json'), 'utf8'));
      for (const r of Object.values(bruto.etapas as Record<string, { respondidaEm?: string } | null>)) if (r) r.respondidaEm = '<T>';
      bruto.atualizadoEm = '<T>';
      return bruto;
    };
    for (const [c, locale] of [[pt, PT], [en, EN]] as const) {
      assert.equal(ork(c, locale, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"objetivo":"x","owner":{"timezone":"UTC"}}', '--por', 'teste').status, 0);
      assert.equal(ork(c, locale, false, 'onboarding', 'set', 'skills', '--conteudo', '["a"]', '--por', 'teste').status, 0);
    }
    assert.deepEqual(estado(en), estado(pt));
    assert.equal(fs.readFileSync(path.join(en.dir, 'orkastery.yaml'), 'utf8').replace(/loc/g, 'x'),
      fs.readFileSync(path.join(pt.dir, 'orkastery.yaml'), 'utf8').replace(/loc/g, 'x'));
    assert.equal(ork(en, EN, false, 'onboarding', '--json').stdout.replace(/"\d{4}-[^"]+"/g, '"<T>"'),
      ork(pt, PT, false, 'onboarding', '--json').stdout.replace(/"\d{4}-[^"]+"/g, '"<T>"'));
  } finally { pt.limpar(); en.limpar(); }
});

test('locale en F2a onboarding: rotas fora da lista seguem em pt-BR com LANG=en_US', () => {
  const c = cenario('onboarding-negativo');
  try {
    // A F3e levou onboarding sync e experiencia uninstall ao catálogo; privado e Noctum seguem fora.
    for (const args of [['privado'], ['noctum']]) {
      const pt = ork(c, PT, false, ...args), en = ork(c, EN, false, ...args);
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.equal(en.stderr, pt.stderr, args.join(' '));
      assert.equal(en.status, pt.status, args.join(' '));
      assert.notEqual(pt.status, 0, args.join(' '));
    }
  } finally { c.limpar(); }
});
