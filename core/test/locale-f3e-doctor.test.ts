/** RM-061 F3e: snapshot do preflight humano de `ork doctor --modo`. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { comLocale } from '../src/locale';
import { preflight, textoPreflight } from '../src/preflight';
import { cenario, linhasEmPortugues } from './locale-apoio';

const sensores = {
  runtime: () => true,
  sandboxCodex: () => true,
  auth: () => ({ ok: true, pago: false, transitorio: false, detalhe: 'ok' }),
};

test('locale pt-BR F3e doctor: preflight contextual preserva a moldura da base', () => {
  const c = cenario('f3e-doctor-pt');
  try {
    const texto = comLocale('pt-BR', () => textoPreflight(preflight(c.dir, 'classic', [], sensores)));
    assert.match(texto, /^ork doctor contextual: classic$/m);
    assert.match(texto, /^ok: repositorio: Repositório Git local necessário$/m);
    assert.match(texto, /^bloco 1 GOAL: /m);
    assert.match(texto, /^Primeiro bloco: sonda pronta; todos os blocos: sonda pronta$/m);
    assert.match(texto, /Sonda contextual local: não inventaria sessões/);
  } finally { c.limpar(); }
});

test('locale en F3e doctor: preflight contextual sai integralmente em ingles', () => {
  const c = cenario('f3e-doctor-en');
  try {
    const texto = comLocale('en', () => textoPreflight(preflight(c.dir, 'classic', [], sensores)));
    assert.match(texto, /^ork contextual doctor: classic$/m);
    assert.match(texto, /^ok: repository: Local Git repository required$/m);
    assert.match(texto, /^block 1 GOAL: /m);
    assert.match(texto, /^First block: probe ready; all blocks: probe ready$/m);
    assert.match(texto, /Local contextual probe: it does not invent sessions/);
    assert.deepEqual(linhasEmPortugues(texto, [c.dir]), []);
  } finally { c.limpar(); }
});
