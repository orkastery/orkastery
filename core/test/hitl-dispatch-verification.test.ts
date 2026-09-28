/** Regressão simulada: verifica recibos no ambiente exato entregue aos runtimes. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { prazoDoPedido } from '../src/hitl-contract';
import { registrar, lerLedger } from '../src/ledger';
import { abrirPedidoGate, assinaturaDaResposta, contextoDoPedidoNativo, responderGate, RespostaHumana } from '../src/hitl-gates';
import { aprovacaoHumanaProvada, aprovacoesHumanas } from '../src/gates';
import { ambienteDeAssinatura } from '../src/runtime-ambiente';
import { ambienteDoDespacho } from '../src/adapters/codex';
import { ENV_HITL_VERIFIERS, publicHitlVerifiers, signPublicReceipt } from '../src/hitl-public-receipt';
import { prepararRecibosParaDespacho } from '../src/hitl-ingress-receipt';
import { nativeMessage } from '../src/hitl-native';

for (const channel of ['legacy', 'hermes', 'openclaw', 'native'] as const) test(`recibo ${channel}: filho verifica sem chaves e rejeita adulteração, troca de autoridade e prova ausente`, () => {
  const p = projetoTemporario('hitl-public-verification'), saved = { ...process.env };
  const key = `fixture-${channel}-`.repeat(5), native = channel === 'native';
  const binding = { host: 'hermes' as const, installationId: 'installation', connectionId: 'connection',
    sessionId: 'session', accountId: 'account', channelId: 'discord', conversationId: 'chat', personId: '42' };
  const keyName = native ? 'ORK_HITL_NATIVE_KEY_HERMES' : `ORK_HITL_INGRESS_KEY${channel === 'legacy' ? '' : `_${channel.toUpperCase()}`}`;
  Object.assign(process.env, { [keyName]: key, ORK_HITL_OPENCLAW_ACCOUNT: 'account',
    ORK_HITL_NATIVE_BINDING_HERMES: JSON.stringify(binding), ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' });
  try {
    const t = novaThread(p.carregado, { nome: 'Recibo anterior ao despacho', modo: 'classic' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id), context = contextoDoPedidoNativo(p.dir, t.id, q.id);
    const n = { ...binding, messageId: 'msg', context: context.contexto as string, pedidoSha256: context.pedidoSha256, expiresAt: prazoDoPedido(q)! };
    const answer: RespostaHumana = { origem: native ? 'native' : 'telegram', resposta: '1', prova: '',
      por: native ? 'native:hermes:42' : 'telegram:42', mensagem: native ? nativeMessage(n) : 'telegram:-7:fixture',
      recebidoEm: new Date().toISOString(), ...(channel !== 'legacy' ? { canal: native ? 'hermes' : channel } : {}),
      ...(native ? { native: n, conta: 'account' } : channel === 'openclaw' ? { conta: 'account' } : {}) };
    answer.prova = assinaturaDaResposta(t.id, q.id, answer, key);
    responderGate(p.dir, t.id, q.id, answer);
    const event = lerLedger(dir).find(e => e.tipo === 'human_gate')!;
    const file = path.join(dir, 'hitl-ingress', path.basename(String(event.evidencia)));
    const original = fs.readFileSync(file), proof = fs.readFileSync(`${file}.public`);
    const parent = { ...process.env };
    const publicEnv = ambienteDeAssinatura(parent);
    assert.deepEqual(Object.keys(publicEnv).filter(k => k.startsWith('ORK_HITL_')), []);
    assert.ok(!JSON.stringify(publicEnv).includes(key));
    assert.ok(!publicEnv[ENV_HITL_VERIFIERS]!.includes('"personId"'));
    assert.equal(parent[keyName], key);
    for (const env of [publicEnv, ambienteDoDespacho(parent)]) {
      process.env = env;
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);
      assert.equal(aprovacaoHumanaProvada(p.dir, t.id, { ...event, opcao: 2 }), false);
      assert.throws(() => responderGate(p.dir, t.id, q.id, answer), /credencial|credentials|capability/);
      const altered = JSON.parse(original.toString()); altered.dados.por = 'telegram:99';
      fs.writeFileSync(file, JSON.stringify(altered));
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
      fs.writeFileSync(file, original);
      fs.writeFileSync(`${file}.public`, proof.toString().replace(/"signature":"./, '"signature":"!'));
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
      fs.writeFileSync(`${file}.public`, proof);
      process.env[ENV_HITL_VERIFIERS] = publicHitlVerifiers({ ...parent, [keyName]: 'another-private-fixture-'.repeat(3) });
      assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
    }
    // Compatibilidade: uma versão antiga deixa só HMAC. O pai autentica antes
    // de acrescentar o sidecar; não reescreve os bytes nem o hash do ledger.
    process.env = parent;
    fs.unlinkSync(`${file}.public`);
    prepararRecibosParaDespacho(p.dir, t.id);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.equal(createHash('sha256').update(original).digest('hex'), event.evidenciaSha256);
    process.env = ambienteDeAssinatura(parent);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 1);
    fs.unlinkSync(`${file}.public`);
    assert.equal(aprovacoesHumanas(p.dir, t.id).length, 0);
    process.env = parent;
    const forged = JSON.parse(original.toString()); forged.dados.por = 'telegram:99';
    fs.writeFileSync(file, JSON.stringify(forged));
    prepararRecibosParaDespacho(p.dir, t.id);
    assert.equal(fs.existsSync(`${file}.public`), false);
    assert.throws(() => signPublicReceipt(file, answer.canal ?? null, native), /mac-invalid/);
  } finally { process.env = saved; p.limpar(); }
});
