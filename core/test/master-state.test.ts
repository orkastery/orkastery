import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread } from '../src/thread';
import { adicionarClaim, lerClaims } from '../src/claims';
import { registrar, lerLedger } from '../src/ledger';
import { registrarMaster, lerMasterLog, caminhoPostmortem } from '../src/master';
import { auditarEstado } from '../src/estado-thread';

test('MASTER, claims e ledger escritos na worktree têm o mesmo domicílio físico na main', () => {
  const p = projetoTemporario('master-estado');
  try {
    const t = novaThread(p.carregado, { nome: 'MASTER único', modo: 'auto', criarWorktree: true }).thread;
    const wt = t.worktree!;
    adicionarClaim(wt, t.id, { arquivo: 'README.md', alegacao: 'README existe', verificar: ['test -f README.md'] });
    registrar(dirThread(wt, t.id), t.id, 'ship_done', { fase: 'SHIP', mergeSha: 'a'.repeat(40), pushVerificado: true });
    registrarMaster(wt, t.id, { score: 4, justificativa: 'entrega verificada pelo humano', classes: ['sem-falha'], por: 'julio' });
    assert.deepEqual(lerClaims(wt, t.id), lerClaims(p.dir, t.id));
    assert.equal(lerClaims(p.dir, t.id).length, 1);
    assert.deepEqual(lerMasterLog(wt, t.id), lerMasterLog(p.dir, t.id));
    assert.equal(lerThread(p.dir, t.id).score?.avaliadoPor, 'julio');
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'master_done').length, 1);
    for (const file of ['ledger.jsonl', 'claims.jsonl', 'master-log.json', 'POSTMORTEM.json']) {
      assert.equal(fs.realpathSync(path.join(wt, '.orkastery/threads', t.id, file)), path.join(dirThread(p.dir, t.id), file));
    }
    assert.equal(fs.realpathSync(caminhoPostmortem(wt, t.id)), caminhoPostmortem(p.dir, t.id));
    assert.equal(auditarEstado(p.dir, t.id, wt).nivel, 'ok');
  } finally { p.limpar(); }
});
