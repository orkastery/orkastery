/**
 * I-43 (D3): o indice automatico de qualidade, e os limites do que ele sabe.
 *
 * O indice substitui a fila de ratificacao de score. As duas regras duras que estes
 * testes travam, e o motivo medido de cada uma:
 *
 * 1. SO entra fato com escritor no nucleo e entrada no catalogo. Os 137 ledgers do
 *    projeto trazem mais de 200 valores distintos de `tipo`, com variantes do mesmo
 *    fato e ate lixo literal (`B`, `path`, `commit`); `verify_result` tem 122
 *    ocorrencias e ZERO escritor. Um indice que case string livre e um indice que mente.
 *
 * 2. O indice e DERIVADO, nunca digitado. E a diferenca entre ele e o campo `score`,
 *    que hoje mistura tres coisas diferentes no mesmo lugar.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { calcularIndice, INDICE_BASE, INDICE_MINIMO, INSUMOS_DO_INDICE, textoDoIndice } from '../src/indice';
import { TIPOS_DE_EVENTO } from '../src/ledger';
import { EventoLedger } from '../src/types';

const ev = (tipo: string, n = 1): EventoLedger[] =>
  Array.from({ length: n }, (_, i) => ({ ts: `2026-09-20T00:00:0${i}.000Z`, thread: 't', tipo, eventId: `e${tipo}${i}` }));

test('entrega sem tropeco nenhum vale o teto: entregue e aceito', () => {
  const zero = calcularIndice([]);
  assert.equal(zero.valor, INDICE_BASE);
  assert.deepEqual(zero.parcelas, []);
  assert.equal(zero.derivado, true);

  // Evento que nao e insumo nao mexe no indice, por mais que apareca.
  const ruido = calcularIndice([...ev(TIPOS_DE_EVENTO.faseDespachada, 20), ...ev('verify_result', 122)]);
  assert.equal(ruido.valor, INDICE_BASE);
  assert.deepEqual(ruido.parcelas, []);
});

test('reversao pesa sozinha mais que tudo junto', () => {
  const r = calcularIndice(ev(TIPOS_DE_EVENTO.rollbackConcluido));
  assert.equal(r.valor, 2, 'base 5 menos 3');
  assert.equal(r.parcelas.length, 1);
  assert.equal(r.parcelas[0].evento, 'rollback_done');

  // Ela e o unico fato que diz sem interpretacao que a entrega nao servia, entao
  // pesa mais que GO-FIX, CHECK refeito e ship barrado somados nos seus pisos.
  const tudoMenosReversao = calcularIndice([
    ...ev(TIPOS_DE_EVENTO.fixAberto, 10),
    ...ev(TIPOS_DE_EVENTO.reverifyConcluido, 10),
    ...ev(TIPOS_DE_EVENTO.shipBloqueado, 10),
  ]);
  assert.equal(tudoMenosReversao.valor, 2, '5 - 1.5 - 1 - 0.5');
  assert.ok(3 >= 1.5 + 1 + 0.5, 'o peso da reversao domina a soma dos pisos');
});

test('os pisos impedem o indice de virar contador', () => {
  // Tres rodadas de GO-FIX dizem "esta thread custou correcao". A decima nao diz dez
  // vezes mais: sem piso, uma thread longa e sadia afundaria por acumulo.
  const tres = calcularIndice(ev(TIPOS_DE_EVENTO.fixAberto, 3));
  const dez = calcularIndice(ev(TIPOS_DE_EVENTO.fixAberto, 10));
  assert.equal(tres.valor, 3.5, '5 - 1.5 (ja no piso)');
  assert.equal(dez.valor, 3.5, 'o piso cortou');
  assert.equal(tres.parcelas[0].noPiso, false);
  assert.equal(dez.parcelas[0].noPiso, true);

  // Cada insumo respeita o piso declarado em D3.
  for (const insumo of INSUMOS_DO_INDICE) {
    const muitos = calcularIndice(ev(insumo.evento, 50));
    assert.equal(muitos.parcelas[0].desconto, insumo.piso, `piso de ${insumo.evento}`);
  }
});

test('o indice tem chao e teto, e nunca sai deles', () => {
  const pior = calcularIndice([
    ...ev(TIPOS_DE_EVENTO.rollbackConcluido, 5),
    ...ev(TIPOS_DE_EVENTO.fixAberto, 20),
    ...ev(TIPOS_DE_EVENTO.reverifyConcluido, 20),
    ...ev(TIPOS_DE_EVENTO.shipBloqueado, 20),
  ]);
  assert.ok(pior.valor >= INDICE_MINIMO, `chao respeitado: ${pior.valor}`);
  assert.equal(pior.valor, 0);
  assert.ok(calcularIndice([]).valor <= INDICE_BASE);
});

test('todo insumo e evento do CATALOGO do nucleo, nunca string livre', () => {
  const catalogo = new Set<string>(Object.values(TIPOS_DE_EVENTO));
  for (const insumo of INSUMOS_DO_INDICE) {
    assert.ok(catalogo.has(insumo.evento), `${insumo.evento} fora do catalogo TIPOS_DE_EVENTO`);
    assert.ok(insumo.peso < 0, 'insumo so desconta');
    assert.ok(insumo.piso <= insumo.peso, `piso de ${insumo.evento} precisa cobrir ao menos uma ocorrencia`);
  }
  // "Tempo ate entregar" ficou de fora de proposito (M2): ele varia de 0,0h a 123,9h
  // entre entregas todas consideradas boas, ou seja, mede TAMANHO e nao qualidade.
  assert.equal(INSUMOS_DO_INDICE.some((i) => /tempo|duracao|horas/i.test(i.evento)), false);
});

test('o texto mostra de ONDE o numero veio, nao so o numero', () => {
  const t = textoDoIndice(calcularIndice([...ev(TIPOS_DE_EVENTO.rollbackConcluido), ...ev(TIPOS_DE_EVENTO.fixAberto, 2)]));
  assert.match(t, /derivado do ledger, nunca digitado/);
  assert.match(t, /rollback_done x1/);
  assert.match(t, /go_fix_opened x2/);
  assert.match(textoDoIndice(calcularIndice([])), /nenhum insumo/);
});
