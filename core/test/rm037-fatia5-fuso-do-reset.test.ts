/**
 * RM-037 (fatia 5, item 2): a hora de volta da cota no fuso que o runtime diz.
 *
 * Na madrugada de 02/10/2026 o Claude Code gravou, nas transcricoes da conta que parou, "your session limit resets
 * 4:40am (America/Sao_Paulo)", com `quotaLimits.resetsAt` 1790926800 (07:40Z). O `ork` lia a hora no relogio da
 * maquina e ignorava o fuso entre parenteses: na VPS o fuso coincidia, mas numa maquina em UTC o mesmo texto lido as
 * 06:00Z dava 04:40Z do dia seguinte. Os textos abaixo sao os reais das transcricoes; a claim roda este arquivo com
 * TZ=UTC e com TZ=Pacific/Auckland, e o resultado tem de ser o mesmo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { naturezaDoLimite, parseFalhaDeConta, parseRateLimit } from '../src/adapters/claude-bg';
import { FUSO_DE_BRASILIA, instanteNoFuso } from '../src/horario';

/** Os dois textos reais do limite de gasto (02/10 e 29/09/2026) e o `resetsAt` que veio na mesma linha. */
const GASTO_0440 = "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit · " +
  'your session limit resets 4:40am (America/Sao_Paulo)';
const GASTO_1340 = "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit · " +
  'your session limit resets 1:40pm (America/Sao_Paulo)';
const LIDO_0440 = Date.parse('2026-10-02T06:00:07.004Z');
const LIDO_1340 = Date.parse('2026-09-29T16:25:02.249Z');
const RESETS_AT_0440 = 1790926800 * 1000;
const RESETS_AT_1340 = 1790700000 * 1000;

test('limite de gasto real: 4:40am e 1:40pm no fuso dito, iguais ao resetsAt da linha, em qualquer fuso da maquina', () => {
  const madrugada = parseFalhaDeConta(`rate_limit: ${GASTO_0440}`, LIDO_0440);
  assert.deepEqual([madrugada?.motivo, madrugada?.resetEm, madrugada?.fonte],
    ['runtime.quota-exhausted', '2026-10-02T07:40:00.000Z', 'relogio'], `TZ=${process.env.TZ ?? '(sistema)'}`);
  assert.equal(Date.parse(madrugada!.resetEm!), RESETS_AT_0440, 'a hora lida bate com o resetsAt que o Claude Code gravou');
  const tarde = parseFalhaDeConta(`rate_limit: ${GASTO_1340}`, LIDO_1340);
  assert.deepEqual([tarde?.motivo, tarde?.resetEm], ['runtime.quota-exhausted', '2026-09-29T16:40:00.000Z']);
  assert.equal(Date.parse(tarde!.resetEm!), RESETS_AT_1340);
  // A regra da D16 e a mesma: o limite de gasto e esgotamento explicito, com o prazo dito.
  const n = naturezaDoLimite(GASTO_0440, LIDO_0440);
  assert.deepEqual([n?.natureza, n?.regra, n?.resetEm], ['esgotamento', 'esgotamento-explicito', '2026-10-02T07:40:00.000Z']);
});

test('a ancora e o instante da mensagem: o mesmo texto lido depois do reset aponta o dia seguinte', () => {
  // Quem le a mensagem tarde (07:45Z, depois do reset) precisa passar o instante da mensagem, e nao o relogio dele.
  assert.equal(parseFalhaDeConta(GASTO_0440, LIDO_0440 + 105 * 60000)?.resetEm, '2026-10-03T07:40:00.000Z');
  assert.equal(parseFalhaDeConta(GASTO_0440, LIDO_0440)?.resetEm, '2026-10-02T07:40:00.000Z');
});

test('outro fuso dito vale do mesmo jeito; data com fuso, com ano e na virada do ano', () => {
  assert.equal(parseFalhaDeConta("You've hit your limit · resets 4:40am (Asia/Tokyo)", LIDO_0440)?.resetEm,
    '2026-10-02T19:40:00.000Z', '06:00Z sao 15:00 em Toquio: a proxima 04:40 de la e no dia seguinte');
  const set19 = Date.parse('2026-09-19T15:00:00.000Z');
  assert.equal(parseFalhaDeConta("You've hit your limit · resets Sep 22, 3pm (America/Sao_Paulo)", set19)?.resetEm,
    '2026-09-22T18:00:00.000Z');
  assert.equal(parseFalhaDeConta("You've hit your limit · resets Sep 22, 2027, 3:05pm (America/Sao_Paulo)", set19)?.resetEm,
    '2027-09-22T18:05:00.000Z');
  const reveillon = Date.parse('2027-01-01T02:00:00.000Z'); // 23:00 de 31/12 em Brasilia
  assert.equal(parseFalhaDeConta("You've hit your limit · resets Jan 2, 3pm (America/Sao_Paulo)", reveillon)?.resetEm,
    '2027-01-02T18:00:00.000Z');
  assert.equal(parseRateLimit('usage limit reached; resets 7pm (America/Sao_Paulo)', set19)?.resetEm, '2026-09-19T22:00:00.000Z',
    'a fila do rate limit comum le o mesmo fuso');
});

test('sem fuso, ou com fuso que o Intl recusa, a hora segue no relogio da maquina, como antes', () => {
  const agora = Date.parse('2026-10-02T06:00:07.004Z');
  const base = new Date(agora);
  const local = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 4, 40, 0, 0);
  if (local.getTime() <= agora) local.setDate(local.getDate() + 1);
  assert.equal(parseFalhaDeConta("You've hit your spend limit · resets 4:40am", agora)?.resetEm, local.toISOString());
  assert.equal(parseFalhaDeConta("You've hit your spend limit · resets 4:40am (Nao/Existe)", agora)?.resetEm, local.toISOString());
  assert.equal(parseFalhaDeConta("You've hit your spend limit · resets 4:40am (429)", agora)?.resetEm, local.toISOString(),
    'parenteses que nao sao fuso nao mudam nada');
});

test('instanteNoFuso: relogio comum, horario de verao (volta e salto), data e fuso invalidos', () => {
  assert.equal(new Date(instanteNoFuso(2026, 10, 2, 4, 40, FUSO_DE_BRASILIA)).toISOString(), '2026-10-02T07:40:00.000Z');
  assert.equal(new Date(instanteNoFuso(2026, 10, 2, 4, 40, 'UTC')).toISOString(), '2026-10-02T04:40:00.000Z');
  // Nova York: em 01/11/2026 o relogio volta de 02:00 para 01:00; 01:30 acontece duas vezes, vale a primeira (EDT).
  assert.equal(new Date(instanteNoFuso(2026, 11, 1, 1, 30, 'America/New_York')).toISOString(), '2026-11-01T05:30:00.000Z');
  // Em 08/03/2026 o relogio pula de 02:00 para 03:00: 02:30 nao existe e cai depois do salto (03:30 EDT).
  assert.equal(new Date(instanteNoFuso(2026, 3, 8, 2, 30, 'America/New_York')).toISOString(), '2026-03-08T07:30:00.000Z');
  assert.ok(Number.isNaN(instanteNoFuso(2026, 2, 30, 12, 0, FUSO_DE_BRASILIA)), '30 de fevereiro');
  assert.ok(Number.isNaN(instanteNoFuso(2026, 10, 2, 4, 40, 'Nao/Existe')));
});
