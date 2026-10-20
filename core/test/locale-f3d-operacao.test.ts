import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comLocale, msg } from '../src/locale';
import { tabelaDeModos } from '../src/modos';
import { textoDaMigracaoModos } from '../src/modos-migracao';
import { tabelaDeVariantes } from '../src/ciclos';
import { linhasEmPortugues } from './locale-apoio';
import { CADENCIAS, textoDaCadencia } from '../src/pulse-cadencia';

test('F3d: modos, migracao e ciclos preservam pt-BR e têm texto completo em ingles', () => {
  const mudanca = { dryRun: true, backup: null, mudancas: [
    { arquivo: 'orkastery.yaml', campo: 'conduction.default_mode', de: 'look', para: 'classic' },
  ] };
  const pt = comLocale('pt-BR', () => [tabelaDeModos(), textoDaMigracaoModos(mudanca), tabelaDeVariantes()].join('\n'));
  const en = comLocale('en', () => [tabelaDeModos(), textoDaMigracaoModos(mudanca), tabelaDeVariantes()].join('\n'));

  assert.match(pt, /Modos de conducao/);
  assert.match(pt, /Simulacao \(--dry-run\), nada foi gravado/);
  assert.match(pt, /Variantes de ciclo/);
  assert.match(en, /Conduction modes/);
  assert.match(en, /Simulation \(`--dry-run`\): nothing was written/);
  assert.match(en, /Cycle variants/);
  assert.deepEqual(linhasEmPortugues(en, ['orkastery.yaml']), []);
});

test('F3d: pulse cadencia e as recusas de responder seguem o locale', () => {
  const quando = '2026-10-20T12:00:00.000Z';
  const pt = comLocale('pt-BR', () => textoDaCadencia(CADENCIAS['#OrkPulseOn-60m'], quando));
  const en = comLocale('en', () => [textoDaCadencia(CADENCIAS['#OrkPulseOn-60m'], quando),
    msg().operacao.pulseCadencia.umaTag, msg().operacao.pulseCadencia.responderUso].join('\n'));
  assert.match(pt, /de hora em hora/);
  assert.match(en, /hourly/);
  assert.match(en, /provide one tag at a time/);
  assert.match(en, /authenticated ingress envelope/);
  assert.deepEqual(linhasEmPortugues(en), []);
});
