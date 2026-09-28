import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { registerHitlIngress } from '../dist/hitl-ingress.js';

test('callback/CLI SIMULADOS: nativo sem Telegram exige identidade e preserva receipt', async () => {
  const require = createRequire(import.meta.url), saved = { ...process.env };
  for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_')) delete process.env[name];
  const { projetoTemporario } = require('../../../core/dist-test/test/apoio.js');
  const p = projetoTemporario('openclaw-offer');
  const { novaThread, dirThread } = require('../../../core/dist/thread.js');
  const { registrar, lerLedger } = require('../../../core/dist/ledger.js');
  const { abrirPedidoGate, contextoDoPedidoNativo } = require('../../../core/dist/hitl-gates.js');
  const { ofertaDoPedido, apresentarDecisao } = require('../../../core/dist/hitl-presentation.js');
  const t = novaThread(p.carregado, { nome: 'Oferta', modo: 'classic' }).thread;
  registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
  const q = abrirPedidoGate(p.dir, t.id);
  const n = { host: 'openclaw', installationId: 'fixture', connectionId: 'connection', sessionId: 'session',
    accountId: 'account', channelId: 'discord', conversationId: '42', personId: '24' };
  process.env.ORK_HITL_NATIVE_BINDING_OPENCLAW = JSON.stringify(n);
  process.env.ORK_HITL_NATIVE_KEY_OPENCLAW = 'fixture-openclaw-key-'.repeat(3);
  process.env.ORK_HITL_ROOT = p.dir;
  let handler, calls = 0, repeat = false, envelope;
  const stub = mock.method(require('node:child_process'), 'execFile', (_bin, argv, _options, cb) => {
    calls++; const stdin = new EventEmitter();
    stdin.end = raw => { envelope = JSON.parse(raw); };
    queueMicrotask(() => {
      if (argv[1] === 'context') assert.deepEqual(argv, ['gate', 'context', t.id, q.id, '--native-offer-stdin']);
      cb(null, JSON.stringify(argv[1] === 'context'
        ? { ...contextoDoPedidoNativo(p.dir, t.id, q.id), canais: ofertaDoPedido(q, [], { callback: envelope, raiz: p.dir }), apresentacao: apresentarDecisao(q) }
        : { ok: true, pedidoId: q.id, estado: 'aprovado', repetida: repeat }));
    });
    return { stdin };
  });
  syncBuiltinESMExports();
  try {
    registerHitlIngress({ on: (name, callback) => { assert.equal(name, 'inbound_claim'); handler = callback; } }, 'fixture-cli');
    const event = { content: `/ork gate ${t.id} ${q.id} 1`, channel: 'discord', commandAuthorized: true,
      senderIsOwner: true, sessionKey: 'session', accountId: 'account', conversationId: '42', senderId: '24', messageId: 'msg', timestamp: Date.now() };
    const ctx = { channelId: 'discord', sessionKey: 'session', accountId: 'account', conversationId: '42', senderId: '24', messageId: 'msg' };
    for (const change of [{ commandAuthorized: false }, { senderIsOwner: false }, { sessionKey: 'other' }, { senderId: 'other' }, { accountId: 'other' }]) {
      assert.match((await handler({ ...event, ...change }, ctx)).reply.text, /indisponível/);
      assert.equal(calls, 0);
    }
    assert.match((await handler(event, ctx)).reply.text, /confirmada/);
    assert.equal(calls, 2); assert.equal(envelope.origem, 'native');
    const b = envelope.native;
    const body = ['ork.hitl-native/v1', t.id, q.id, b.host, b.installationId, b.connectionId, b.sessionId,
      b.accountId, b.channelId, b.conversationId, b.personId, b.messageId, b.context, b.pedidoSha256, b.expiresAt,
      envelope.origem, envelope.canal, envelope.conta, envelope.por, envelope.mensagem, envelope.recebidoEm, envelope.resposta];
    assert.equal(envelope.prova, createHmac('sha256', process.env.ORK_HITL_NATIVE_KEY_OPENCLAW).update(JSON.stringify(body)).digest('hex'));
    repeat = true; assert.deepEqual(await handler(event, ctx), { handled: true });
    const before = lerLedger(dirThread(p.dir, t.id));
    const offered = await handler({ ...event, content: `/ork offer ${t.id} ${q.id}` }, ctx);
    assert.match(offered.reply.text, /Canal nativo OpenClaw disponível/);
    assert.equal(calls, 5);
    assert.deepEqual(lerLedger(dirThread(p.dir, t.id)), before);
  } finally { stub.mock.restore(); syncBuiltinESMExports(); process.env = saved; p.limpar(); }
});
