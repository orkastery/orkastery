import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comLocale, msg } from '../src/locale';
import { textoDaEntrevista, textoDoSetup, validarFallback, validarLimitesDeBloco } from '../src/setup';
import { cenario, linhasEmPortugues } from './locale-apoio';

test('F3d: setup mostra entrevista, modo e recusas nas duas linguas', () => {
  const c = cenario('f3d-setup');
  try {
    const pt = comLocale('pt-BR', () => textoDaEntrevista(c.dir));
    const en = comLocale('en', () => textoDaEntrevista(c.dir));
    const enModo = comLocale('en', () => textoDoSetup(c.dir, 'classic'));
    const enErro = comLocale('en', () => msg().setup.cli.modoDesconhecido('desconhecido', 'classic, maestro, auto, fast'));
    assert.match(pt, /Entrevista #setup/);
    assert.match(en, /#setup interview/);
    assert.match(enModo, /Setup for mode #Classic/);
    assert.match(enErro, /unknown conduction mode/);
    assert.deepEqual(linhasEmPortugues([en, enModo, enErro].join('\n')), []);
  } finally { c.limpar(); }
});

test('F3d: validadores internos do setup preservam pt-BR e recusam em ingles', () => {
  const mensagem = (fn: () => unknown): string => {
    try { fn(); } catch (e) { return (e as Error).message; }
    assert.fail('a chamada deveria recusar');
  };
  const pt = mensagem(() => comLocale('pt-BR', () => validarFallback(['invalido'], 'claude-bg')));
  const en = mensagem(() => comLocale('en', () => validarFallback(['invalido'], 'claude-bg')));
  assert.match(pt, /fallback invalido/);
  assert.match(en, /invalid fallback/);
  const limite = mensagem(() => comLocale('en', () => validarLimitesDeBloco(
    { duracaoMs: 0, maxChildren: 0, maxDepth: 0, maxRetries: 0 }
  )));
  assert.match(limite, /positive finite representable integer/);
});
