/**
 * I-35 (T3): texto do pulse e sexta-feira do digest no fuso do dono. Os esperados valem com
 * `TZ=UTC` e com `TZ=America/Sao_Paulo`; o digest em Brasília repete o algoritmo da base.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { CONTRATO_PULSE, ItemPulse, Pulse, textoDoPulse } from '../src/pulse';
import { enviarDigest, montarDigest, sextaLocal } from '../src/master-digest';
import { definirFusoDoDono } from '../src/horario';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** O algoritmo da base (fuso fixo em código até a I-35), reproduzido só para comparar. */
function sextaDaBase(quando: string): string | null {
  const campos = new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(quando));
  const parte = (tipo: string) => campos.find(p => p.type === tipo)!.value;
  const dia = `${parte('year')}-${parte('month')}-${parte('day')}`;
  return new Date(`${dia}T12:00:00Z`).getUTCDay() === 5 ? dia : null;
}

test('texto do pulse: consulta local rotulada, pergunta e diagnóstico sem ISO', () => {
  definirFusoDoDono(SP);
  try {
    const item: ItemPulse = { id: 'orfa:ork-fixture:GO', classe: 'fase-orfa', motivo: 'runtime.silencio', thread: 'ork-fixture',
      fase: 'GO', sessionId: null, desdeEm: '2026-09-19T14:00:30.843Z', paradaHaMin: 16, impacto: 3,
      pergunta: 'Fase GO sem heartbeat desde 2026-09-19T14:00:30.843Z.', opcoes: ['retomar'], recomendacao: 'Conferir a sessão SIMULADA.',
      comandoResposta: 'ork phase list ork-fixture', evidencia: [], fontes: [], contextoLogs: [] };
    const pulse: Pulse = { contrato: CONTRATO_PULSE, consultadoEm: '2026-09-20T02:30:00.000Z',
      runtime: { ok: true, detalhe: 'liveness.snapshot.invalid desde 2026-09-19T14:00:30.843Z' },
      precisaDeHumanoAgora: [item], acoesAutomaticas: [], resumo: { humanos: 1, automaticas: 0, scores: 0, fasesOrfas: 1 } };
    const texto = textoDoPulse(pulse);
    // 02:30 UTC de 20/09 ainda é 19/09 em Brasília.
    assert.match(texto, /^Pulse \(ork\.pulse\/v1\) 19\/09 23:30 \(horário de Brasília\)\n/);
    assert.match(texto, /\[diagnostico\] liveness\.snapshot\.invalid desde 19\/09 11:00/);
    assert.match(texto, /\nFase GO sem heartbeat desde 19\/09 11:00\.\n/);
    assert.doesNotMatch(texto, ISO);
    assert.equal(item.pergunta, 'Fase GO sem heartbeat desde 2026-09-19T14:00:30.843Z.');
  } finally { definirFusoDoDono(undefined); }
});

test('digest: com o dono em Brasília a sexta é a mesma da base, hora a hora, em qualquer TZ do processo', () => {
  const inicio = Date.parse('2026-09-07T00:00:00Z');
  for (let h = 0; h < 24 * 21; h++) {
    const quando = new Date(inicio + h * 3600000).toISOString();
    assert.equal(sextaLocal(quando, SP), sextaDaBase(quando), quando);
  }
  // Fronteiras: quinta 22:00 em Brasília (sexta em UTC) e sexta 22:00 em Brasília (sábado em UTC).
  assert.equal(sextaLocal('2026-09-11T01:00:00Z', SP), null);
  assert.equal(sextaLocal('2026-09-12T01:00:00Z', SP), '2026-09-11');
  assert.equal(sextaLocal('2026-09-11T01:00:00Z', 'UTC'), '2026-09-11');
  assert.equal(sextaLocal('2026-09-12T01:00:00Z', 'UTC'), null);
});

test('digest usa o fuso do dono do processo, sem fuso fixo, e a página fala a data brasileira', () => {
  const p = projetoTemporario('horario-digest');
  try {
    definirFusoDoDono(SP);
    assert.equal(sextaLocal('2026-09-12T01:00:00Z'), '2026-09-11');
    assert.match(montarDigest(p.dir, '2026-09-12T01:00:00Z').paginas[0].texto, /Semana de 11\/09\/2026\./);
    assert.match(enviarDigest({ raiz: p.dir, quando: '2026-09-11T01:00:00Z' }).detalhe, /fora da sexta-feira no fuso do dono \(America\/Sao_Paulo\)/);
    definirFusoDoDono('UTC');
    assert.equal(sextaLocal('2026-09-12T01:00:00Z'), null);
    assert.throws(() => montarDigest(p.dir, '2026-09-12T01:00:00Z'), /sexta-feira no fuso do dono \(UTC\)/);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});
