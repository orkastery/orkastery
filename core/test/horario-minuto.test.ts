/**
 * I-35 (GO-FIX 1, P3-4 do CHECK c655cb5e): relativo no limite do minuto nas superfícies.
 * Monitor, radar de sessões e pulse (texto e mensagem ao Telegram) dizem `menos de 1 min`,
 * nunca `0min` nem `0 min`. Fixtures SIMULADAS; esperados valem com `TZ=UTC` e
 * `TZ=America/Sao_Paulo`.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { montarMonitor, textoDoMonitor } from '../src/orquestracao';
import { textoDoRadar } from '../src/hitl';
import { CONTRATO_PULSE, ItemPulse, textoDoPulse } from '../src/pulse';
import { mensagemPulse } from '../src/pulse-delivery';
import { definirFusoDoDono } from '../src/horario';
import { RadarDeSessoes, SessaoNoRadar } from '../src/types';

const SP = 'America/Sao_Paulo';
/** 19/09/2026 15:16 em Brasília. */
const AGORA = '2026-09-19T18:16:00.000Z';
const ZERO = /\b0 ?min\b/;

test('monitor, radar e pulse: parada de menos de 1 min por extenso, nunca 0min', () => {
  const p = projetoTemporario('horario-minuto');
  definirFusoDoDono(SP);
  try {
    const t = novaThread(p.carregado, { nome: 'Recente', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'gate_blocked', { ts: '2026-09-19T18:15:30.000Z', fase: 'GOAL', motivo: 'human.pending' });
    const monitor = textoDoMonitor(montarMonitor(p.carregado, { agora: AGORA, semRuntime: true }));
    assert.match(monitor, /\[human\.pending\] parada ha menos de 1 min \(desde 15:15\)/);

    const sessao: SessaoNoRadar = { id: 'abc12345', sessionId: 'sessao-SIMULADA', nome: 'fixture', cwd: '/tmp/fixture', kind: 'bg',
      estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: 'hitl.permissao', jobVivo: true, precisaDeHumano: true, detalhe: 'pergunta SIMULADA',
      desdeEm: AGORA, idadeMin: 0, paradaHaMin: 0, bloqueadaDesdeEm: AGORA, pergunta: 'Qual opção?', alternativas: [], thread: null,
      recomendacao: 'Responder.', acimaDoLimite: false,
      comandos: { logs: 'claude logs abc12345', attach: 'claude attach abc12345', parar: 'claude stop abc12345' } };
    const radar = textoDoRadar({ consultadoEm: AGORA, atencaoMin: 10, runtimeConsultado: true, runtimeDetalhe: '', logsLidos: true,
      raiz: p.dir, sessoes: [sessao], resumo: { total: 1, precisamDeHumano: 1, hitl: 1, abandonadas: 0, falhas: 0, trabalhando: 0,
        desconhecidas: 0, acimaDoLimite: 0, foraDoOrk: 1 } } as RadarDeSessoes);
    assert.match(radar, /parada ha: menos de 1 min \(desde a primeira observação\)/);
    assert.match(radar, /viva ha {2}: menos de 1 min \(idade da sessao\)/);

    const item: ItemPulse = { id: 'orfa:ork-fixture:GO', classe: 'fase-orfa', motivo: 'runtime.silencio', thread: 'ork-fixture',
      fase: 'GO', sessionId: null, desdeEm: '2026-09-19T18:15:30.000Z', paradaHaMin: 0, impacto: 3,
      pergunta: 'Fase GO sem heartbeat desde 2026-09-19T18:15:30.000Z.', opcoes: [], recomendacao: 'Conferir a sessão SIMULADA.',
      comandoResposta: 'ork phase list ork-fixture', evidencia: [], fontes: [], contextoLogs: [] };
    const mensagem = mensagemPulse(item, AGORA);
    assert.match(mensagem, /\nEspera: menos de 1 min\n/);
    const pulse = textoDoPulse({ contrato: CONTRATO_PULSE, consultadoEm: AGORA, runtime: { ok: true, detalhe: '' },
      precisaDeHumanoAgora: [item], acoesAutomaticas: [], resumo: { humanos: 1, automaticas: 0, scores: 0, fasesOrfas: 1 } });
    assert.match(pulse, /\nork-fixture \[fase-orfa\] menos de 1 min\n/);

    for (const texto of [monitor, radar, mensagem, pulse]) assert.doesNotMatch(texto, ZERO, texto);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});
