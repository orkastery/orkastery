/** F3: relógio controlado é SIMULADO, nunca um horário operacional fabricado. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { assinaturaDaResposta, comLockHitl, abrirPedidoGate, responderGate } from '../src/hitl-gates';
import { instanteDoIngresso } from '../src/hitl-ingress-receipt';
import { lerLedger, registrar } from '../src/ledger';
test('F3 SIMULADO: entrada autenticada na janela sobrevive contenção, envelhecido sem recibo e replay divergente recusam', () => {
  const f = projetoTemporario('ingress-receipt'); const t = novaThread(f.carregado, { nome: 'entrada', modo: 'classic' }).thread;
  const old = { ...process.env }; const key = 'chave-F3-SIMULADA-00000000000000000000';
  Object.assign(process.env, { ORK_HITL_INGRESS_KEY: key, ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' });
  const start = new Date().toISOString();
  try {
    registrar(dirThread(f.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const pedido = abrirPedidoGate(f.dir, t.id, 'human.pending', start);
    const raw = { resposta: '1', origem: 'telegram' as const, por: 'telegram:42', mensagem: 'telegram:-7:123', recebidoEm: start };
    const r = { ...raw, prova: assinaturaDaResposta(t.id, pedido.id, raw, key) };
    const dentro = new Date(Date.parse(start) + 30000).toISOString(), depois = new Date(Date.parse(start) + 65000).toISOString();
    comLockHitl(f.dir, t.id, () => { assert.throws(() => responderGate(f.dir, t.id, pedido.id, r, dentro), /ocupado/); });
    assert.equal(instanteDoIngresso(f.dir, t.id, pedido.id, r), dentro);
    assert.equal(lerLedger(dirThread(f.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 0);
    const semRecibo = { ...r, mensagem: 'telegram:-7:124' }; semRecibo.prova = assinaturaDaResposta(t.id, pedido.id, semRecibo, key);
    assert.throws(() => responderGate(f.dir, t.id, pedido.id, semRecibo, depois), /proveniência/);
    assert.equal(responderGate(f.dir, t.id, pedido.id, r, depois).repetida, false);
    assert.equal(responderGate(f.dir, t.id, pedido.id, r, depois).repetida, true);
    assert.equal(lerLedger(dirThread(f.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 1);
    const alterado = { ...r, resposta: '2' }; alterado.prova = assinaturaDaResposta(t.id, pedido.id, alterado, key);
    assert.throws(() => responderGate(f.dir, t.id, pedido.id, alterado, depois), /divergente/);
    const dir = path.join(dirThread(f.dir, t.id), 'hitl-ingress'); const file = path.join(dir, fs.readdirSync(dir)[0]);
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(receipt.dados.resposta, undefined);
    receipt.observadoEm = depois; fs.writeFileSync(file, JSON.stringify(receipt));
    assert.throws(() => responderGate(f.dir, t.id, pedido.id, r, depois), /inválido/);
  } finally { process.env = old; f.limpar(); }
});
