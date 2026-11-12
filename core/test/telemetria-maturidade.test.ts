import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calcularMaturidade, EventoAnalitico } from '../src/telemetria-maturidade';
import { ChaveDoReciboDeProva, CONTRATO_DO_RECIBO_DE_PROVA } from '../src/recibo-prova';

const janela = { desde: '2026-11-01T00:00:00.000Z', ate: '2026-12-01T00:00:00.000Z' };
let ordem = 0;
function evento(tipo: string, dados: Partial<EventoAnalitico> = {}): EventoAnalitico {
  ordem += 1;
  return { tipo, ts: '2026-11-10T12:00:00.000Z', eventId: `${tipo}-${ordem}`, sequence: ordem,
    thread: 'ork-a', ...dados };
}

function recibo(head: string): ChaveDoReciboDeProva {
  return { contrato: CONTRATO_DO_RECIBO_DE_PROVA, head, claimsSha256: 'a'.repeat(64),
    planoSha256: 'b'.repeat(64), dependenciasExternas: [], sha256: 'c'.repeat(64) };
}

test('A1 e A2 confirmam recibo e primeira verdade pela ordem do ledger', () => {
  ordem = 0;
  const eventos = [
    evento('verify_run', { veredito: 'verdade sustentada', recibo: recibo('fonte-a') }),
    evento('ship_done', { shaDe: 'fonte-a', mergeSha: 'merge-a', pushVerificado: true,
      politicaReciboVersao: CONTRATO_DO_RECIBO_DE_PROVA, evidencia: { verificadoNoCommit: 'fonte-a' }, modo: '#Auto' }),
  ];
  const resultado = calcularMaturidade(eventos, janela);
  const a1 = resultado.indicadores[0], a2 = resultado.indicadores[1];
  assert.equal(a1.series.find((item) => item.id === 'taxa')?.valor, 1);
  assert.equal(a2.series.find((item) => item.id === 'taxa')?.valor, 1);
  assert.deepEqual(a1.cobertura, { confirmados: 1, total: 1, razao: 1 });
});

test('A2 mantém primeiro vermelho como negativo mesmo após rodada verde', () => {
  ordem = 0;
  const eventos = [
    evento('verify_run', { veredito: 'reprovado', recibo: recibo('fonte-a') }),
    evento('verify_run', { veredito: 'verdade sustentada', recibo: recibo('fonte-a') }),
    evento('ship_done', { shaDe: 'fonte-a', mergeSha: 'merge-a', pushVerificado: true,
      politicaReciboVersao: CONTRATO_DO_RECIBO_DE_PROVA, evidencia: { verificadoNoCommit: 'fonte-a' }, modo: '#Auto' }),
  ];
  const a2 = calcularMaturidade(eventos, janela).indicadores[1];
  assert.equal(a2.series.find((item) => item.id === 'positivos')?.valor, 0);
  assert.equal(a2.series.find((item) => item.id === 'negativos')?.valor, 1);
});

test('A3 conta IDs e rodadas distintos; retransmissão não aumenta séries', () => {
  ordem = 0;
  const fix = evento('go_fix_opened', { rodada: 1, correcoes: [{ id: 'B1' }, { id: 'B2' }] });
  const resultado = calcularMaturidade([fix, { ...fix }], janela).indicadores[2];
  assert.deepEqual(resultado.series.map((item) => item.valor), [2, 1]);
  assert.equal(resultado.tipo, 'contagem_distinta');
});

test('A4, A5 e A6 ficam separados e lacuna histórica não vira negativo', () => {
  ordem = 0;
  const eventos = [
    evento('autonomous_decision', { pedido: { id: 'd1' }, quemDecidiu: 'sessão', evidencia: 'medição', razao: 'critério' }),
    evento('autonomous_decision', { pedido: { id: 'd2' }, quemDecidiu: 'sessão', evidencia: 'medição',
      razao: 'critério', reverte: 'd1' }),
    evento('hitl_requested', { pedido: { id: 'p1', alvo: { tipo: 'gate', sobre: 'SHIP' } } }),
    evento('ship_unscanned_authorized', { por: 'dono', categorias: ['sast'], sha: 'fonte-a' }),
    evento('thread_created', { modo: '#Maestro' }),
    evento('ship_done', { modo: '#Auto', mergeSha: 'm', pushVerificado: false }),
  ];
  const resultado = calcularMaturidade(eventos, janela);
  assert.deepEqual(resultado.indicadores[3].series.map((item) => item.valor), [2, 1, 1]);
  assert.equal(resultado.indicadores[4].series[0].valor, 1);
  assert.deepEqual(resultado.indicadores[5].series.map((item) => item.valor), [{ maestro: 1 }, { auto: 1 }]);
  assert.equal(resultado.indicadores[0].series.find((item) => item.id === 'negativos')?.valor, 0);
  assert.equal(resultado.indicadores[0].lacunas.politica_historica_ausente, 1);
});

test('janela é semiaberta e eventos sem UID viram lacuna', () => {
  ordem = 0;
  const resultado = calcularMaturidade([
    evento('thread_created', { ts: janela.desde, modo: '#Auto' }),
    evento('thread_created', { ts: janela.ate, modo: '#Auto' }),
    { tipo: 'thread_created', ts: '2026-11-15T00:00:00.000Z', thread: 'ork-b', modo: '#Auto' },
  ], janela);
  const a6 = resultado.indicadores[5];
  assert.equal(a6.populacao, 1);
  assert.equal(a6.lacunas.event_id_ausente, 1);
});

test('resultado não contém nota, peso, ranking, meta ou classificação de bom e ruim', () => {
  const serializado = JSON.stringify(calcularMaturidade([], janela));
  for (const proibido of ['score', 'nota', 'peso', 'ranking', 'meta', 'bom', 'ruim']) {
    assert.equal(serializado.toLowerCase().includes(proibido), false, proibido);
  }
});

test('B1 normaliza os contratos emitidos pelo verify, GO-FIX, decisão, HITL e exceção', () => {
  ordem = 0;
  const eventos = [
    evento('verify_run', { veredito: 'verdade sustentada', parcial: false, recibo: recibo('fonte-a') }),
    evento('go_fix_opened', { rodada: 2, correcoes: [{ id: 'B1' }, { id: 'B2' }] }),
    evento('autonomous_decision', { quemDecidiu: 'sessão', evidencia: 'medição', razao: 'critério',
      pedido: { id: 'd1' } }),
    evento('hitl_requested', { pedido: { id: 'p1', alvo: { tipo: 'decisao', id: 'd1' } } }),
    evento('ship_unscanned_authorized', { por: 'dono', categorias: ['sast'], sha: 'fonte-a' }),
    evento('ship_done', { shaDe: 'fonte-a', mergeSha: 'merge-a', pushVerificado: true,
      politicaReciboVersao: CONTRATO_DO_RECIBO_DE_PROVA, modo: '#Auto',
      evidencia: { verificadoNoCommit: 'fonte-a' } }),
  ];
  const resultado = calcularMaturidade(eventos, janela);
  assert.equal(resultado.indicadores[0].series.find((item) => item.id === 'positivos')?.valor, 1);
  assert.deepEqual(resultado.indicadores[2].series.map((item) => item.valor), [2, 1]);
  assert.deepEqual(resultado.indicadores[3].series.map((item) => item.valor), [1, 1, 0]);
  assert.equal(resultado.indicadores[4].series[0].valor, 1);
});

test('B1 chaveia A1 por merge e trata política histórica ausente como lacuna', () => {
  ordem = 0;
  const eventos = [
    evento('verify_run', { veredito: 'verdade sustentada', parcial: false, recibo: recibo('fonte-a') }),
    evento('ship_done', { shaDe: 'fonte-a', mergeSha: 'merge-a', pushVerificado: true,
      politicaReciboVersao: CONTRATO_DO_RECIBO_DE_PROVA, evidencia: { verificadoNoCommit: 'fonte-a' } }),
    evento('verify_run', { veredito: 'verdade sustentada', parcial: false, recibo: recibo('fonte-b') }),
    evento('ship_done', { shaDe: 'fonte-b', mergeSha: 'merge-b', pushVerificado: true,
      evidencia: { verificadoNoCommit: 'fonte-b' } }),
  ];
  const a1 = calcularMaturidade(eventos, janela).indicadores[0];
  assert.equal(a1.populacao, 2);
  assert.deepEqual(a1.cobertura, { confirmados: 1, total: 2, razao: 0.5 });
  assert.equal(a1.lacunas.politica_historica_ausente, 1);
  assert.equal(a1.series.find((item) => item.id === 'negativos')?.valor, 0);
});

test('B6 não reordena sequências acumuladas depois da passagem pelos eventos', () => {
  ordem = 0;
  const eventos = [
    evento('verify_run', { veredito: 'verdade sustentada', parcial: false, recibo: recibo('fonte-a') }),
    evento('ship_done', { shaDe: 'fonte-a', mergeSha: 'merge-a', pushVerificado: true,
      politicaReciboVersao: CONTRATO_DO_RECIBO_DE_PROVA, evidencia: { verificadoNoCommit: 'fonte-a' } }),
  ];
  const ordenar = Array.prototype.sort;
  Array.prototype.sort = function proibido(): never { throw new Error('ordenação posterior proibida'); };
  try {
    assert.equal(calcularMaturidade(eventos, janela).indicadores[0].populacao, 1);
  } finally {
    Array.prototype.sort = ordenar;
  }
});
