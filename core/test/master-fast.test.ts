/**
 * Hotfix de 27/09/2026: uma thread #Fast entregue nao pode derrubar a lista de pendentes do
 * MASTER. O ciclo do #Fast so tem GO: o regime do score e de lote, e o aceite por omissao fecha
 * a thread sem trocar de fase (I-42). Antes, `pendentesDeScore` lancava "fase MASTER nao pertence
 * a nenhum bloco", e com ele caiam `ork master`, o aceite por omissao e o pulse.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { listarBatch } from '../src/master-batch';
import { aceitarPendentesPorOmissao, pendentesDeScore, regimeDoScore } from '../src/master';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

test('thread #Fast entregue entra no MASTER em lote e fecha por omissao sem trocar de fase', () => {
  const p = projetoTemporario('master-fast');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'ajuste rapido', modo: 'fast' });
    assert.equal(regimeDoScore(thread), 'batch');
    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.shipConcluido,
      { de: `ork/${thread.id}-go`, para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true });

    const pendentes = pendentesDeScore(p.dir);
    assert.deepEqual(pendentes.map((x) => [x.thread.id, x.regime, x.entregou]), [[thread.id, 'batch', true]]);
    assert.deepEqual(listarBatch(p.dir).map((x) => x.thread), [thread.id], 'a visao em lote do pulse tambem lista');

    assert.deepEqual(aceitarPendentesPorOmissao(p.dir).map((a) => a.thread), [thread.id]);
    const depois = lerThread(p.dir, thread.id);
    assert.equal(depois.status, 'fechada');
    assert.equal(depois.faseAtual, thread.faseAtual, 'o #Fast fecha sem trocar de fase');
    assert.deepEqual(pendentesDeScore(p.dir), []);
  } finally { p.limpar(); }
});
