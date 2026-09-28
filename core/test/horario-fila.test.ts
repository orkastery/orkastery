/**
 * I-35 (T5): phase list, retry list, retry run e retomada no fuso do dono. O ledger e a fila
 * continuam com ISO. Os esperados valem com `TZ=UTC` e `TZ=America/Sao_Paulo`.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { tabelaDoLedger } from '../src/phase';
import { enfileirar, lerFilaDeRetomada, tabelaDaFila } from '../src/ratelimit';
import { textoDaRetomada, textoDoRetry } from '../src/retry';
import { definirFusoDoDono } from '../src/horario';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** O que o `phase list` mostrava: UTC truncado sem rótulo, parecendo hora local. */
const UTC_TRUNCADO = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;
/** 19/09/2026 15:16 em Brasília. */
const AGORA = '2026-09-19T18:16:00.000Z';
/** O ano só aparece quando não é o corrente; o teste não depende do ano em que roda. */
const ANO = '(?:/2026)?';

test('phase list: QUANDO no fuso do dono com segundos, libera em e detalhe localizados, legenda', () => {
  const p = projetoTemporario('horario-phase-list');
  definirFusoDoDono(SP);
  try {
    const t = novaThread(p.carregado, { nome: 'Fila', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    // O exemplo da ordem do dono: "2026-09-19 18:13:34" no phase list era UTC.
    registrar(dir, t.id, 'phase_dispatch', { ts: '2026-09-19T18:13:34.000Z', fase: 'GOAL' });
    registrar(dir, t.id, 'rate_limit_enqueued', { ts: '2026-09-19T18:14:00.000Z', fase: 'GOAL', pedido: 'R1',
      liberaEm: '2026-09-20T02:30:00.000Z', correcao: 'ork retry resume (ou aguarde ate 2026-09-20T02:30:00.000Z)' });
    registrar(dir, t.id, 'gate_blocked', { ts: '2026-09-19T18:15:00.000Z', fase: 'GOAL', motivo: 'runtime.rate-limited',
      detalhe: 'janela libera em 2026-09-20T02:30:00.000Z' });
    const texto = tabelaDoLedger(p.dir, t.id);
    assert.match(texto, new RegExp(`19/09${ANO} 15:13:34 +phase_dispatch`));
    assert.match(texto, new RegExp(`libera em 19/09${ANO} 23:30`));
    assert.match(texto, new RegExp(`janela libera em 19/09${ANO} 23:30`));
    assert.match(texto, /\nHorários de Brasília\.$/);
    assert.doesNotMatch(texto, ISO);
    assert.doesNotMatch(texto, UTC_TRUNCADO);
    // O ledger continua com ISO.
    assert.equal(lerLedger(dir).find(e => e.tipo === 'phase_dispatch')!.ts, '2026-09-19T18:13:34.000Z');
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});

test('retry list, retry run e retomada: libera em local, FALTA relativo e legenda; fila com ISO', () => {
  const p = projetoTemporario('horario-retry');
  definirFusoDoDono(SP);
  try {
    const t = novaThread(p.carregado, { nome: 'Limite', modo: 'auto' }).thread;
    const pedido = enfileirar(p.carregado, { thread: t.id, fase: 'GO', slug: t.slug, promptPath: 'prompt.md', promptSha256: '0'.repeat(64),
      cwd: p.dir, model: null, effort: null, sinal: { resetEm: '2026-09-20T02:30:00.000Z', fonte: 'epoch', trecho: 'SIMULADO' },
      detalhe: 'rate limit SIMULADO' }, Date.parse(AGORA));
    const lista = tabelaDaFila(p.dir, AGORA);
    assert.match(lista, /R1 .* 19\/09 23:30 .* em 8h14/);
    assert.match(lista, /\nHorários de Brasília\.$/);
    assert.doesNotMatch(lista, ISO);
    assert.doesNotMatch(lista, UTC_TRUNCADO);
    assert.equal(lerFilaDeRetomada(p.dir)[0].liberaEm, '2026-09-20T02:30:00.000Z');

    const plano = { thread: t.id, modo: 'auto', fase: 'GO', motivo: 'runtime.rate-limited', detalhe: 'reset em 2026-09-20T02:30:00.000Z',
      politica: null, acao: 'esperar-janela', tentativas: 0, limite: 3, effort: 'high', effortAnterior: 'high', automatica: true,
      bloqueio: null, razao: 'SIMULADO' } as unknown as Parameters<typeof textoDoRetry>[0]['plano'];
    const run = textoDoRetry({ plano, executada: true, rodada: null, reverify: null, sync: null, redespacho: null, fila: [pedido],
      detalhe: `1 pedido(s) na fila duravel; o proximo libera em ${pedido.liberaEm}` });
    assert.match(run, new RegExp(`detalhe {9}reset em 19/09${ANO} 23:30`));
    assert.match(run, new RegExp(`o proximo libera em 19/09${ANO} 23:30`));
    assert.match(run, new RegExp(`R1 {2}GO {2}libera em 19/09${ANO} 23:30`));
    assert.equal((run.match(/Horários de Brasília\./g) ?? []).length, 1);
    assert.doesNotMatch(run, ISO);

    const retomada = textoDaRetomada([{ pedido, playbook: 'mesma-sessao', slug: t.slug, despachada: false, sessionId: null,
      verificada: false, motivo: 'runtime.rate-limited', detalhe: `a janela ainda nao liberou (libera em ${pedido.liberaEm})`, dryRun: false }] as Parameters<typeof textoDaRetomada>[0]);
    assert.match(retomada, new RegExp(`a janela ainda nao liberou \\(libera em 19/09${ANO} 23:30\\)`));
    assert.match(retomada, /\nHorários de Brasília\.$/);
    assert.doesNotMatch(retomada, ISO);
  } finally { definirFusoDoDono(undefined); p.limpar(); }
});
