import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comLocale, msg } from '../src/locale';
import { tabelaDeModos } from '../src/modos';
import { textoDaMigracaoModos } from '../src/modos-migracao';
import { tabelaDeVariantes } from '../src/ciclos';
import { linhasEmPortugues } from './locale-apoio';
import { CADENCIAS, textoDaCadencia } from '../src/pulse-cadencia';
import { textoDasEstatisticas, LedgerStats } from '../src/ledger-stats';

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

test('F3d: ledger stats e estimate têm texto equivalente nas duas línguas', () => {
  const stats = {
    periodo: { desde: '2026-10-20T10:00:00.000Z', ate: '2026-10-20T11:00:00.000Z', intervalo: '[desde,ate)' },
    threads: 1, sessoes: { concluidas: 2, despachadas: 3, retries: 1 }, throughput: { ships: 1 },
    execucao: { horas: 1.25, cobertura: { medidas: 2, semMedida: 1 } },
    tokens: { total: 20, input: 10, cachedInput: 2, output: 10 },
    custoReferencia: { valor: null }, esperaHumana: { milissegundos: 60_000, abertas: 1 },
    hitlDeConducao: { pedidos: 1, paradoMs: 60_000, medianaRespostaMs: 60_000, dentroDaMeta: true,
      abertos: 0, emTexto: { foraDaExcecao: 0 } },
    riscosPreventivos: { total: 1 }, estimativasPlano: { amostras: 1 },
    qualidade: { observacoes: ['1 sessao(oes) sem medicao de tokens'] },
  } as unknown as LedgerStats;
  const pt = comLocale('pt-BR', () => textoDasEstatisticas(stats));
  const en = comLocale('en', () => [textoDasEstatisticas(stats), msg().operacao.ledger.estimativa('ork-x', 4, 2)].join('\n'));
  assert.match(pt, /threads\/sessoes/);
  assert.match(en, /threads\/sessions/);
  assert.match(en, /no coverage/);
  assert.match(en, /PLAN estimate recorded/);
  assert.deepEqual(linhasEmPortugues(en, ['[desde,ate)']), []);
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
