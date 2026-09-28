/** Testes do slug de sessao em 3 partes. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  montarSlug,
  normalizarAbbrev,
  normalizarAssunto,
  parseSlug,
  proximaRotacao,
  REGEX_SLUG,
  slugValido,
  validarAbbrev,
} from '../src/slug';
import { slugDasFases } from '../src/modos';

test('parse do slug devolve as 3 partes', () => {
  const p = parseSlug('sb-checkout-f12');
  assert.ok(p);
  assert.equal(p.produto, 'sb');
  assert.equal(p.assunto, 'checkout');
  assert.equal(p.fases, 'f12');
  assert.equal(p.rotacao, null);
});

test('parse do slug reconhece o sufixo de rotacao', () => {
  const p = parseSlug('sb-checkout-f34-2');
  assert.ok(p);
  assert.equal(p.fases, 'f34');
  assert.equal(p.rotacao, 2);
});

test('os exemplos da documentacao casam com a regex canonica', () => {
  for (const exemplo of [
    'sb-checkout-f12',
    'sb-checkout-f34',
    'sb-checkout-f34-2',
    'umf-pipeline-go',
    'ork-coreb0-full',
    'omd-memoria-master',
  ]) {
    assert.ok(REGEX_SLUG.test(exemplo), `esperado slug valido: ${exemplo}`);
    const p = parseSlug(exemplo);
    assert.ok(p, `esperado parse de 3 partes: ${exemplo}`);
  }
});

test('slugs fora do contrato sao rejeitados', () => {
  const invalidos = [
    'orka-checkout-f12', // produto com 4 caracteres
    'sb-checkout-f12-', // sufixo de rotacao vazio
    'sb-check_out-f12', // caractere fora de [a-z0-9]
    'sb-umassuntolongodemais-f12', // assunto acima de 12
    'sb-checkout-f7', // digito fora de F1..F6
    'sb-checkout-deploy', // fase inexistente
    'sb-checkout', // faltando a parte 3
    'SB-checkout-f12', // caixa alta
  ];
  for (const s of invalidos) {
    assert.equal(slugValido(s), false, `esperado slug invalido: ${s}`);
    assert.equal(parseSlug(s), null);
  }
});

test('montar slug normaliza acentos, espacos e tamanho', () => {
  assert.equal(montarSlug('ORK', 'Core B0', 'full'), 'ork-coreb0-full');
  assert.equal(montarSlug('sb', 'Cultura de QA', 'f12'), 'sb-culturadeqa-f12');
  assert.equal(montarSlug('sb', 'assunto muito muito longo', 'go'), 'sb-assuntomuito-go');
  assert.equal(normalizarAssunto('Sessao de Migracao'), 'sessaodemigr');
  assert.equal(normalizarAbbrev('Orkastery'), 'ork');
});

test('montar slug rejeita parte 3 invalida', () => {
  assert.throws(() => montarSlug('ork', 'core', 'deploy'), /slug gerado invalido/);
});

test('slug das fases usa nome canonico, alias numerico e full', () => {
  assert.equal(slugDasFases(['GOAL']), 'goal');
  assert.equal(slugDasFases(['GO', 'CHECK']), 'f34');
  assert.equal(slugDasFases(['GO', 'CHECK', 'SHIP']), 'f345');
  assert.equal(slugDasFases(['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER']), 'full');
});

test('rotacao de sessao incrementa o sufixo dentro do mesmo bloco', () => {
  assert.equal(proximaRotacao('sb-checkout-f34', ['sb-checkout-f34']), 'sb-checkout-f34-2');
  assert.equal(
    proximaRotacao('sb-checkout-f34', ['sb-checkout-f34', 'sb-checkout-f34-2']),
    'sb-checkout-f34-3'
  );
  // Slug de outro bloco nao interfere na contagem.
  assert.equal(proximaRotacao('sb-checkout-f34', ['sb-checkout-f12-9']), 'sb-checkout-f34-2');
});

test('validacao de abbrev do manifesto', () => {
  assert.equal(validarAbbrev('ork').ok, true);
  assert.equal(validarAbbrev('').ok, false);
  assert.equal(validarAbbrev('orka').ok, false);
  assert.equal(validarAbbrev('OR').ok, false);
});
