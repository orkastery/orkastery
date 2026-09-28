/**
 * I-35 (T4): monitor e board mostram o horário no fuso do dono; o dado (JSON do monitor,
 * ledger e fila) continua em ISO. Os esperados valem com `TZ=UTC` e `TZ=America/Sao_Paulo`.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { enfileirar } from '../src/ratelimit';
import { montarMonitor, textoDoMonitor } from '../src/orquestracao';
import { textoDoPlano, textoDoReap } from '../src/board';
import { definirFusoDoDono } from '../src/horario';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** 19/09/2026 15:16 em Brasília. */
const AGORA = '2026-09-19T18:16:00.000Z';

test('monitor: desde, detalhe e evidência no fuso do dono; JSON com ISO', () => {
  const p = projetoTemporario('horario-monitor');
  definirFusoDoDono(SP);
  try {
    // O exemplo do dono: "desde 2026-09-17 01:53" era UTC; em Brasília é 16/09 22:53.
    const a = novaThread(p.carregado, { nome: 'Impedida', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, a.id), a.id, 'gate_blocked', { ts: '2026-09-17T01:53:00.000Z', fase: 'GOAL', motivo: 'verify.failed', detalhe: 'verify SIMULADO' });
    // Rate limit que libera às 23:30 de 19/09 em Brasília, já 20/09 em UTC.
    const b = novaThread(p.carregado, { nome: 'Na fila', modo: 'auto' }).thread;
    enfileirar(p.carregado, { thread: b.id, fase: 'GOAL', slug: b.slug, promptPath: 'prompt.md', promptSha256: '0'.repeat(64),
      cwd: p.dir, model: null, effort: null, sinal: { resetEm: '2026-09-20T02:30:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' },
      detalhe: 'rate limit SIMULADO' }, Date.parse(AGORA));

    // Pausa humana aberta às 11:00 de hoje em Brasília: só a hora, porque é hoje.
    const c = novaThread(p.carregado, { nome: 'Esperando', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, c.id), c.id, 'gate_blocked', { ts: '2026-09-19T14:00:30.843Z', fase: 'GOAL', motivo: 'human.pending' });

    const m = montarMonitor(p.carregado, { agora: AGORA, semRuntime: true });
    const texto = textoDoMonitor(m);
    assert.match(texto, /\n {2}Horários de Brasília\.\n/);
    assert.match(texto, /\[verify\.failed\] parada ha 2d 16h \(desde 16\/09 22:53\)/);
    assert.match(texto, /\[human\.pending\] parada ha 4h15 \(desde 11:00\)/);
    assert.match(texto, /libera em 8h14 \(19\/09 23:30, hora dita pelo runtime\)/);
    assert.doesNotMatch(texto, ISO);

    // Dado de máquina: o JSON do monitor guarda o ISO completo.
    const impedida = m.linhas.find(l => l.thread === a.id)!.impedimentos[0];
    assert.equal(impedida.desdeEm, '2026-09-17T01:53:00.000Z');
    assert.equal(m.linhas.find(l => l.thread === c.id)!.pausas[0].desdeEm, '2026-09-19T14:00:30.843Z');
    const rate = m.linhas.find(l => l.thread === b.id)!.impedimentos.find(i => i.motivo === 'runtime.rate-limited')!;
    assert.match(rate.detalhe, /\(2026-09-20T02:30:00\.000Z, hora dita pelo runtime\)/);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

test('board: fila de lease com desde local e reap com evidência localizada', () => {
  definirFusoDoDono(SP);
  try {
    const plano = textoDoPlano({ maxParalelas: 3, emAndamento: 1, vagas: [], decididoEm: AGORA,
      filaDeMerge: [{ nome: 'main-tree', tipo: 'main-tree', thread: 'ork-b', motivo: 'ship', desdeEm: '2026-09-19T14:00:30.843Z',
        colidiuCom: 'main-tree', bloqueadaPor: 'ork-a' }],
      filaDeRegiao: [] } as Parameters<typeof textoDoPlano>[0]);
    assert.match(plano, /^Escalonador por maquina\. Horários de Brasília\.\n/);
    assert.doesNotMatch(plano, /\(Horários/);
    assert.match(plano, /1\. ork-b quer main-tree \(colide com main-tree, thread ork-a\) desde 11:00 \(há 4h15\)/);
    assert.doesNotMatch(plano, ISO);

    const reap = textoDoReap([{ thread: 'ork-c', classe: 'stale', motivo: 'vaga.stale', detalhe: 'sem atividade ha 300 min',
      evidencia: 'ledger parado desde 2026-09-19T14:00:30.843Z; sessao 0123abcd state=idle', registrada: true }]);
    assert.match(reap, /^Vagas devolvidas por falta de procura ativa: 1\. Horários de Brasília\.\n/);
    assert.doesNotMatch(reap, /\(Horários/);
    assert.match(reap, /evidencia: ledger parado desde 19\/09 11:00; sessao 0123abcd state=idle/);
    assert.doesNotMatch(reap, ISO);
  } finally { definirFusoDoDono(undefined); }
});
