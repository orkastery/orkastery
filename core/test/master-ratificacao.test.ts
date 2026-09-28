import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, lerThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { proporMaster, registrarMaster, lerMasterLog, pendentesDeScore, caminhoMasterLog, caminhoPostmortem, autoriaHumana } from '../src/master';

for (const por of [undefined, '', 'Codex', 'agente', 'Claude Opus', 'gpt-6-astra', 'humano pendente', 'batch', 'humano', 'operador', 'anônimo', 'x', '--por']) {
  test(`ratificação recusa autoria ${String(por)} sem escrever`, () => {
    const p = projetoTemporario('master-autoria');
    try {
      const t = novaThread(p.carregado, { nome: 'autor', modo: 'auto' }).thread;
      registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40) });
      const antes = lerLedger(dirThread(p.dir, t.id));
      assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'entrega testada', por }), /autoria|humano/);
      assert.deepEqual(lerLedger(dirThread(p.dir, t.id)), antes);
      assert.equal(fs.existsSync(caminhoMasterLog(p.dir, t.id)), false);
    } finally { p.limpar(); }
  });
}

test('proposta deixa MASTER e postmortem pendentes, humano ratifica com por e publica leitura', () => {
  const p = projetoTemporario('master-proposta');
  try {
    const t = novaThread(p.carregado, { nome: 'proposta', modo: 'auto' }).thread;
    assert.throws(() => proporMaster(p.dir, t.id, { score: 4, justificativa: 'ainda não entregue', por: 'Codex' }), /exige entrega/);
    assert.throws(() => registrarMaster(p.dir, t.id, { score: 4, justificativa: 'ainda não entregue', por: 'julio' }), /exige entrega/);
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', { mergeSha: 'a'.repeat(40) });
    const log = proporMaster(p.dir, t.id, { score: 4, justificativa: 'testes passaram', classes: ['processo'], por: 'Codex' });
    assert.equal(log.contrato, 'ork.master-pending/v1');
    assert.equal(log.score, null);
    assert.equal('avaliadoPor' in log, false);
    assert.equal(lerThread(p.dir, t.id).status, 'aberta');
    assert.equal(lerMasterLog(p.dir, t.id), null, 'aprendizado não recebe proposta como ratificação');
    assert.equal(pendentesDeScore(p.dir)[0].thread.score_proposto?.valor, 4);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'master_done').length, 0);
    registrarMaster(p.dir, t.id, { score: 3, justificativa: 'humano encontrou dívida', classes: ['processo'], por: 'julio' });
    assert.equal(lerMasterLog(p.dir, t.id)?.score, 3);
    assert.equal(lerThread(p.dir, t.id).status, 'fechada');
    assert.equal(lerThread(p.dir, t.id).score_proposto, null);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).at(-1)?.por, 'julio');
    for (const e of lerLedger(dirThread(p.dir, t.id)).filter(e => ['score_proposto', 'postmortem_recorded', 'master_done'].includes(e.tipo))) {
      assert.match(String(e.arquivo), new RegExp(`^\\.orkastery/threads/${t.id}/`));
    }
    assert.equal(pendentesDeScore(p.dir).length, 0);
    assert.throws(() => proporMaster(p.dir, t.id, { score: 5, justificativa: 'sobrescrever', por: 'Codex', refazer: true }), /pontuada/);
    assert.equal(autoriaHumana('Julia'), true);
  } finally { p.limpar(); }
});


test('aprendizado recusa MASTER e POSTMORTEM que divergem da ratificação', () => {
  const p = projetoTemporario('master-documento-divergente');
  try {
    const t = novaThread(p.carregado, { nome: 'íntegra', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'ship_done', {});
    registrarMaster(p.dir, t.id, { score: 4, justificativa: 'revisão humana', por: 'Julio', classes: ['sem-falha'] });
    const file = caminhoMasterLog(p.dir, t.id), original = fs.readFileSync(file, 'utf8');
    assert.equal(lerMasterLog(p.dir, t.id)?.score, 4);
    for (const mudanca of [{ score: 1 }, { classesDeFalha: ['modelo'] }, { resumo: 'texto não ratificado' }]) {
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(original), ...mudanca }));
      assert.equal(lerMasterLog(p.dir, t.id), null);
    }
    fs.writeFileSync(file, original);
    fs.appendFileSync(caminhoPostmortem(p.dir, t.id), ' ');
    assert.equal(lerMasterLog(p.dir, t.id), null);
    fs.writeFileSync(file, '{inválido');
    assert.equal(lerMasterLog(p.dir, t.id), null);
  } finally { p.limpar(); }
});
