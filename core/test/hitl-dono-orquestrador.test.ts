/**
 * RM-048 (item 6, D6): o que e do dono e o que e do orquestrador, separado de forma explicita.
 *
 * O dono nao e chamado a decidir impedimento tecnico. Reconhecer um `runtime.unavailable` grava
 * `aguardando` e nao libera nada; pedir esse veredito ao dono era barulho com cara de decisao.
 * Aqui se prova: o mapa e fechado e o padrao e o dono; escalacao tecnica nao vira pergunta; a
 * decisao do dono (custo, pausa) continua pergunta; e o resumo diz "Conosco" para o tecnico.
 *
 * Threads e canais SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { ambienteDoIngresso, itemDoGate, pulseCom, QUANDO } from './apoio-pulse';
import * as path from 'node:path';
import { MOTIVOS_DO_ORQUESTRADOR, quemDecide } from '../src/hitl-classificacao';
import { MOTIVOS_DE_ESCALACAO_HUMANA } from '../src/hitl-gates';
import { avaliarFila } from '../src/pulse-resposta';
import { varrerPulse } from '../src/pulse-delivery';
import { dirThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { resumirHitl, textoDoResumo } from '../src/hitl-resumo';

test('o mapa é fechado e o padrão é o dono: motivo sem classificação nunca some da vista dele', () => {
  for (const m of ['human.pending', 'policy.violation', 'cost.violation', 'hitl.credencial', 'retry.max_tentativas', 'motivo.que-ninguem-conhece']) {
    assert.equal(quemDecide(m), 'dono', m);
  }
  for (const m of ['runtime.unavailable', 'runtime.silencio', 'artifact.missing', 'verify.regression', 'claims.failed', 'hitl.formato', 'vaga.stale']) {
    assert.equal(quemDecide(m), 'orquestrador', m);
  }
  // Das escalações que abrem gate, só a de runtime é técnica: as outras quatro são decisão do dono.
  assert.deepEqual(MOTIVOS_DE_ESCALACAO_HUMANA.filter(m => MOTIVOS_DO_ORQUESTRADOR.includes(m)), ['runtime.unavailable']);
});

test('escalação técnica não vira pergunta ao dono; a de custo continua pergunta', () => {
  const p = projetoTemporario('dono-orquestrador-fila');
  try {
    const { thread: runtime } = novaThread(p.carregado, { nome: 'runtime auto', modo: 'auto' });
    registrar(dirThread(p.dir, runtime.id), runtime.id, 'gate_blocked', { fase: 'GOAL', motivo: 'runtime.unavailable', detalhe: 'simulado' });
    const { thread: custo } = novaThread(p.carregado, { nome: 'custo auto', modo: 'auto' });
    registrar(dirThread(p.dir, custo.id), custo.id, 'gate_blocked', { fase: 'GOAL', motivo: 'cost.violation', detalhe: 'simulado' });
    const itens = [itemDoGate(runtime.id, 0, { motivo: 'runtime.unavailable', id: `thread:${runtime.id}:GOAL:runtime.unavailable:ledger` }),
      itemDoGate(custo.id, 1, { motivo: 'cost.violation', id: `thread:${custo.id}:GOAL:cost.violation:ledger` })];
    const fila = avaliarFila(p.dir, itens, QUANDO);
    assert.deepEqual(fila.candidatos.map(c => [c.thread, c.motivo]), [[custo.id, 'cost.violation']]);
  } finally { p.limpar(); }
});

test('o resumo conta para o dono só o que é dele, e diz "Conosco" para o técnico, nos dois canais', () => {
  const itens = [
    itemDoGate('ork-simulada-decisao', 0),
    itemDoGate('ork-simulada-runtime', 1, { id: 'b', motivo: 'runtime.unavailable' }),
    itemDoGate('ork-simulada-verify', 2, { id: 'c', motivo: 'verify.regression' }),
  ];
  const resumo = resumirHitl(itens, { quando: QUANDO, prontas: 1 });
  assert.equal(resumo.total, 1);
  assert.deepEqual(resumo.threadsBloqueadas, ['ork-simulada-decisao']);
  assert.equal(resumo.tecnicos, 2);
  for (const canal of ['telegram', 'terminal'] as const) {
    const texto = textoDoResumo(resumo, { canal, codigo: 'K3F9' });
    assert.match(texto, /Conosco, impedimento técnico: 2 \(ork-simulada-runtime, ork-simulada-verify\)\. Não precisa de você\./, canal);
    assert.equal(texto.split('\n').filter(l => l.includes('ork-simulada-runtime')).length, 1, `${canal}: técnico nomeado só em Conosco`);
  }
});

test('ponta a ponta: a varredura manda UM resumo com a pergunta do dono e o técnico em Conosco', () => {
  const p = projetoTemporario('dono-orquestrador-pulse'), restaurar = ambienteDoIngresso();
  try {
    const { thread: pausa } = novaThread(p.carregado, { nome: 'pausa classic', modo: 'classic' });
    registrar(dirThread(p.dir, pausa.id), pausa.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const { thread: runtime } = novaThread(p.carregado, { nome: 'runtime auto', modo: 'auto' });
    registrar(dirThread(p.dir, runtime.id), runtime.id, 'gate_blocked', { fase: 'GOAL', motivo: 'runtime.unavailable', detalhe: 'simulado' });
    const itens = [itemDoGate(pausa.id, 0), itemDoGate(runtime.id, 1, { motivo: 'runtime.unavailable', id: `thread:${runtime.id}:GOAL:runtime.unavailable:ledger` })];
    const mensagens: string[] = [];
    varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens, QUANDO), quando: QUANDO, enviar: m => { mensagens.push(m); return true; },
      estadoDir: path.join(p.dir, '.orkastery', 'monitor') });
    assert.equal(mensagens.length, 1);
    assert.match(mensagens[0], /Perguntas para você: 1/);
    assert.match(mensagens[0], /Esperando você: 1/);
    assert.match(mensagens[0], new RegExp(`Conosco, impedimento técnico: 1 \\(${runtime.id}\\)`));
  } finally { restaurar(); p.limpar(); }
});
