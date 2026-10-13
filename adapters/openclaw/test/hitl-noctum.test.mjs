/** RM-058 N6: /ork noctum on the Telegram ingress. Hooks, identities and credentials are SIMULATED; the CLI is a local subprocess. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { registerHitlIngress } from '../dist/hitl-ingress.js';

const HASH = 'b'.repeat(64);
const NAMES = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];

/** A simulated `ork` that records argv and the envelope and answers with the given receipt. */
async function withIngress(receipt, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-noctum-ingress-'));
  const old = NAMES.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-noctum-ingress-key-for-test-00', dir];
  NAMES.forEach((n, i) => process.env[n] = vals[i]);
  try {
    const bin = path.join(dir, 'ork');
    fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('received.json',JSON.stringify({args:process.argv.slice(2),envelope:JSON.parse(fs.readFileSync(0,'utf8'))}));console.log(${JSON.stringify(JSON.stringify(receipt))});\n`, { mode: 0o700 });
    let handler;
    registerHitlIngress({ on(_name, fn) { handler = fn; } }, bin);
    const event = (content, change = {}) => ({ content, channel: 'telegram', commandAuthorized: true, accountId: 'simulated', senderId: '42',
      conversationId: '-7', messageId: '8', timestamp: Date.now(), ...change });
    const ctx = { channelId: 'telegram', accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '8' };
    const received = () => fs.existsSync(path.join(dir, 'received.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'received.json'), 'utf8')) : null;
    await body({ handler, event, ctx, received, key: vals[4] });
  } finally {
    NAMES.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ok = (change = {}) => ({ ok: true, contrato: 'ork.noctum-ingresso/v1', arco: 'arco-simulado', ato: 'autorizar', situacao: 'vigente', versao: 1,
  envelopeSha256: HASH, repetida: false, ...change });

test('noctum: authorize is signed at the arc address with the account and goes to ork noctum responder', async () => {
  await withIngress(ok(), async ({ handler, event, ctx, received, key }) => {
    const r = await handler(event(`/ork noctum arco-simulado autorizar ${HASH}`), ctx);
    assert.equal(r.reply.text, 'Arco arco-simulado autorizado pelo núcleo.');
    const { args, envelope: e } = received();
    assert.deepEqual(args, ['noctum', 'responder', 'arco-simulado', '--resposta-stdin', '--origem', 'telegram', '--canal', 'openclaw',
      '--conta', 'simulated', '--por', 'telegram:42', '--mensagem', 'telegram:-7:8']);
    assert.equal(e.resposta, `autorizar ${HASH}`);
    assert.equal(e.prova, createHmac('sha256', key).update(JSON.stringify(['ork.hitl-answer/v2', 'noctum', 'arco:arco-simulado', 'openclaw',
      'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
    // The gate address signs a different proof: one envelope never serves the other.
    assert.notEqual(e.prova, createHmac('sha256', key).update(JSON.stringify(['ork.hitl-answer/v2', 'arco-simulado', 'autorizar', 'openclaw',
      'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
  });
});

test('noctum: revoke goes the same way, and an act already in force gets no second confirmation', async () => {
  await withIngress(ok({ ato: 'revogar', situacao: 'revogado' }), async ({ handler, event, ctx, received }) => {
    const r = await handler(event('/ork noctum arco-simulado revogar'), ctx);
    assert.equal(r.reply.text, 'Arco arco-simulado revogado pelo núcleo.');
    assert.equal(received().envelope.resposta, 'revogar');
  });
  await withIngress(ok({ repetida: true }), async ({ handler, event, ctx }) => {
    const r = await handler(event(`/ork noctum arco-simulado autorizar ${HASH}`), ctx);
    assert.deepEqual(r, { handled: true });
  });
});

test('noctum: malformed commands, foreign senders and old messages never reach the core', async () => {
  await withIngress(ok(), async ({ handler, event, ctx, received }) => {
    for (const content of ['/ork noctum arco-simulado autorizar abc', '/ork noctum ARCO revogar', '/ork noctum arco-simulado aprovar',
      '/ork noctum arco:x revogar', `/ork noctum arco-simulado autorizar ${HASH.toUpperCase()}`]) {
      const r = await handler(event(content), ctx);
      assert.equal(r.handled, true, content);
      assert.match(r.reply.text, /não confirmada/);
    }
    for (const change of [{ senderId: '43' }, { timestamp: 1 }, { commandAuthorized: false }, { accountId: 'wrong' }]) {
      assert.match((await handler(event(`/ork noctum arco-simulado autorizar ${HASH}`, change), ctx)).reply.text, /não confirmada/);
    }
    assert.equal(received(), null);
  });
});

test('noctum: a receipt for another arc or contract is not a confirmation', async () => {
  for (const wrong of [ok({ arco: 'outro-arco' }), ok({ contrato: 'ork.hitl-gate/v1' }), ok({ ato: 'aprovar' }), ok({ repetida: 'nao' })]) {
    await withIngress(wrong, async ({ handler, event, ctx }) => {
      const r = await handler(event(`/ork noctum arco-simulado autorizar ${HASH}`), ctx);
      assert.match(r.reply.text, /não confirmada/, JSON.stringify(wrong));
    });
  }
});
