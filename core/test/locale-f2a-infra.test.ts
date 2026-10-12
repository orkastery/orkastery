/**
 * RM-061, fatia F2a: a ativacao do locale por comando e subcomando (D6) e o escopo pt-BR do dado
 * gravado (`comLocale`). Os nomes comecam por "locale F2a infra:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ativarLocale, chaveDoLocale, cobreLocale, comLocale, COMANDOS_COM_LOCALE, localeAtivo, msg } from '../src/locale';

test('locale F2a infra: a chave de cada linha de comando, com o subcomando padrao', () => {
  assert.equal(chaveDoLocale(['doctor'], {}), 'doctor');
  assert.equal(chaveDoLocale(['onboarding'], {}), 'onboarding show');
  assert.equal(chaveDoLocale(['onboarding', 'set', 'maestro'], {}), 'onboarding set');
  assert.equal(chaveDoLocale(['onboarding'], { reset: 'maestro' }), 'onboarding reset');
  assert.equal(chaveDoLocale(['experiencia'], {}), 'experiencia show');
  assert.equal(chaveDoLocale(['thread'], {}), 'thread list');
  assert.equal(chaveDoLocale(['thread', 'status', 'x'], {}), 'thread status');
  assert.equal(chaveDoLocale(['phase', 'run', 'x', 'GO'], {}), 'phase run');
  // Subcomando desconhecido (ou ausente onde nao ha padrao) e `?`: o erro de uso e do proprio comando.
  assert.equal(chaveDoLocale(['phase'], {}), 'phase ?');
  assert.equal(chaveDoLocale(['thread', 'qualquer'], {}), 'thread ?');
  assert.equal(chaveDoLocale(['onboarding', 'qualquer'], {}), 'onboarding ?');
  assert.equal(chaveDoLocale(['experiencia', 'qualquer'], {}), 'experiencia ?');
  assert.equal(chaveDoLocale(['constructor'], {}), 'constructor');
  assert.equal(chaveDoLocale([], {}), '');
});

test('locale F2a infra: cobreLocale so com a entrada na lista, nunca com --json nem nos recortes da D2', () => {
  for (const chave of COMANDOS_COM_LOCALE) assert.ok(cobreLocale(chave.split(' '), {}), chave);
  assert.equal(cobreLocale(['doctor'], { json: true }), false);
  assert.equal(cobreLocale(['doctor'], { modo: 'fast' }), false);
  assert.equal(cobreLocale(['init'], { json: true }), false);
  assert.equal(cobreLocale(['thread', 'new', 'x'], { 'from-finding': 'A1' }), false);
  assert.equal(cobreLocale(['thread', 'new', 'x'], { 'do-achado': 'A1' }), false);
  for (const fora of [['verify', 'x'], ['ship', 'x'], ['pulse'], ['master'], ['retry', 'list'], ['roadmap', 'status'], ['thread', 'list'],
    ['thread', 'close', 'x'], ['onboarding', 'sync'], ['experiencia', 'uninstall', 'codex'], ['projetos'], ['modos']]) {
    assert.equal(cobreLocale(fora, {}), false, fora.join(' '));
  }
});

test('locale F2a infra: comLocale roda no locale pedido e volta ao anterior, mesmo com erro', () => {
  ativarLocale('en');
  try {
    assert.equal(comLocale('pt-BR', () => localeAtivo()), 'pt-BR');
    assert.equal(localeAtivo(), 'en');
    assert.throws(() => comLocale('pt-BR', () => { throw new Error(msg().cli.erro('x')); }), /^Error: erro: x$/);
    assert.equal(localeAtivo(), 'en');
    assert.equal(msg().cli.erro('x'), 'error: x');
  } finally { ativarLocale(undefined); }
  assert.equal(msg().cli.erro('x'), 'erro: x');
});
