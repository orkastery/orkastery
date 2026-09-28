import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { proporMaster } from '../src/master';
import { listarBatch, ratificarBatch } from '../src/master-batch';

test('batch ratifica seleção explícita após preflight integral; rejeita proposta alterada e autoria de agente', () => {
  const p = projetoTemporario('batch-ratificar');
  try {
    const ts = ['um', 'dois', 'tres'].map(nome => novaThread(p.carregado, { nome, modo: 'auto' }).thread);
    for (const t of ts) {
      registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40) });
      proporMaster(p.dir, t.id, { score: 4, justificativa: 'entrega com testes', classes: ['sem-falha'], por: 'Codex' });
    }
    const selecao = listarBatch(p.dir).map(i => ({ thread: i.thread, assinatura: i.assinatura! }));
    assert.throws(() => ratificarBatch(p.dir, selecao, 'Codex'), /humano/);
    assert.throws(() => ratificarBatch(p.dir, [], 'julio'), /explicitamente/);
    assert.throws(() => ratificarBatch(p.dir, [selecao[0], selecao[0]], 'julio'), /distintas/);
    assert.throws(() => ratificarBatch(p.dir, [selecao[0], { ...selecao[1], assinatura: '0'.repeat(64) }], 'julio'), /alterada/);
    assert.equal(lerThread(p.dir, selecao[0].thread).status, 'aberta', 'erro no segundo não ratifica o primeiro');
    proporMaster(p.dir, selecao[1].thread, { score: 2, justificativa: 'proposta mudou', por: 'Codex' });
    assert.throws(() => ratificarBatch(p.dir, selecao, 'julio'), /alterada/);
    ratificarBatch(p.dir, [selecao[0]], 'julio');
    assert.equal(listarBatch(p.dir).length, 2);
    ratificarBatch(p.dir, listarBatch(p.dir).map(i => ({ thread: i.thread, assinatura: i.assinatura! })), 'julio');
    assert.equal(listarBatch(p.dir).length, 0);
    assert.throws(() => ratificarBatch(p.dir, selecao, 'julio'), /ausente/);
  } finally { p.limpar(); }
});
