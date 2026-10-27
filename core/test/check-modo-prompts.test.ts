/**
 * RM-072 (D17, T9 da ork-check5x): o modo do CHECK nos prompts das fases. O contrato do CHECK pede o modo da rodada no
 * parecer, e o fecho do GO pede o modo no `pr-body.md`, os dois nas duas linguas e no prompt montado. Os nomes comecam
 * por "CPn:".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PROMPTS_EN, PROMPTS_PT_BR } from '../src/locale-prompts';
import { fechoDoGo, montarPrompt } from '../src/phase';
import { threadDeExemplo } from '../src/prompts';

test('CP1: o contrato do CHECK pede o modo da rodada no parecer, nas duas linguas', () => {
  assert.match(PROMPTS_PT_BR.contratoDasFases.CHECK,
    /; o parecer diz o modo do CHECK da rodada \(Agile Check ou Classic Check, da linha `check` do `ork verify`\)\.$/);
  assert.match(PROMPTS_EN.contratoDasFases.CHECK,
    /; the verdict names the CHECK mode of the round \(Agile Check or Classic Check, from the `check` line of `ork verify`\)\.$/);
  for (const fase of ['GOAL', 'PLAN', 'GO', 'SHIP', 'MASTER'] as const) {
    assert.doesNotMatch(PROMPTS_PT_BR.contratoDasFases[fase], /Agile Check|Classic Check/, fase);
  }
});

test('CP2: o fecho do GO pede o modo do CHECK no pr-body.md, nas duas linguas', () => {
  const pt = fechoDoGo('ork-x', 'pt-BR').split('\n').find((l) => l.includes('pr-body.md'))!;
  assert.equal(pt, 'Grave `.orkastery/threads/ork-x/pr-body.md` curto, no idioma do projeto, com o modo do CHECK da rodada ' +
    '(Agile Check ou Classic Check, da linha `check` do `ork verify`); se o perfil não puder gravá-lo pelo transporte autorizado, ' +
    'devolva o corpo completo no resumo final.');
  const en = fechoDoGo('ork-x', 'en').split('\n').find((l) => l.includes('pr-body.md'))!;
  assert.equal(en, 'Write a short `.orkastery/threads/ork-x/pr-body.md` in the project language, naming the CHECK mode of the round ' +
    '(Agile Check or Classic Check, from the `check` line of `ork verify`); if the profile cannot write it through the authorized ' +
    'transport, return the full body in the final summary.');
});

test('CP3: o prompt montado do bloco com GO e CHECK leva os dois pedidos; o do bloco sem GO, so o do contrato', () => {
  const comGo = montarPrompt(threadDeExemplo('auto', 'GO'), 'GO', 'pedido', undefined, '', 'pt-BR');
  assert.ok(comGo.includes('o parecer diz o modo do CHECK da rodada (Agile Check ou Classic Check'), 'contrato no ciclo');
  assert.ok(comGo.includes('pr-body.md` curto, no idioma do projeto, com o modo do CHECK da rodada'), 'fecho do GO');
  const ingles = montarPrompt(threadDeExemplo('auto', 'GO'), 'GO', 'request', undefined, '', 'en');
  assert.ok(ingles.includes('the verdict names the CHECK mode of the round') && ingles.includes('naming the CHECK mode of the round'));
  const soGoal = montarPrompt(threadDeExemplo('classic', 'GOAL'), 'GOAL', 'pedido', undefined, '', 'pt-BR');
  assert.ok(soGoal.includes('o parecer diz o modo do CHECK da rodada'), 'o ciclo canonico lista o contrato do CHECK');
  assert.ok(!soGoal.includes('pr-body.md'), 'sem GO no bloco, sem fecho');
});
