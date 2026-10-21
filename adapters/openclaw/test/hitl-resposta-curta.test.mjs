/**
 * RM-057 (short answer): the reply to a question on the Telegram ingress. Hooks, identities and credentials are SIMULATED; the CLI is a local subprocess.
 *
 * GO-FIX 1 (finding 2): the reference only comes from the arc question title and carries the replied message id; a
 * confirmation, a reminder, the owner's own message or a member's message never gives one, and only an answer goes with it.
 * GO-FIX 2 (round 2, R1): the bare word in reply to any other message goes marked (`resposta:outra`), and the core refuses
 * it; the code and the number name the question and go without the mark.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { isReply, registerHitlIngress, replyReference } from '../dist/hitl-ingress.js';

const QUESTION = '🔔 7. arco arco-simulado · NX4K\n❓ Autorizar o arco arco-simulado (proposta 1)?\n↩️ Responda a, b ou c. Detalhes: NX4K detalhes.';
const CONFIRMATION = 'NX4K → b) Adiar: nada muda, e a proposta vence às 22:10 se você não autorizar antes.';
const NAMES = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];

/** A simulated `ork` that records argv and the envelope and answers with the pulse receipt. The listening window is CLOSED. */
async function withIngress(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-short-answer-ingress-'));
  const old = NAMES.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-short-answer-ingress-key-for-test', dir];
  NAMES.forEach((n, i) => process.env[n] = vals[i]);
  try {
    const receipt = { ok: true, contrato: 'ork.pulse-resposta/v1', mensagem: '✅ NX4K → a) Autorizo: o arco está autorizado.', repetida: false };
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

test('reply: "sim" in reply to a question is signed at resposta:<code>:<id> and goes with --em-resposta-a, window closed', async () => {
  await withIngress(async ({ handler, event, ctx, received, key }) => {
    const r = await handler(event('sim', { replyToBody: QUESTION, replyToId: '5' }), ctx);
    assert.equal(r.reply.text, '✅ NX4K → a) Autorizo: o arco está autorizado.');
    const { args, envelope: e } = received();
    assert.deepEqual(args, ['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'openclaw', '--conta', 'simulated',
      '--por', 'telegram:42', '--mensagem', 'telegram:-7:8', '--em-resposta-a', 'NX4K:5']);
    assert.equal(e.resposta, 'sim');
    assert.equal(e.prova, createHmac('sha256', key).update(JSON.stringify(['ork.hitl-answer/v2', 'pulse', 'resposta:NX4K:5', 'openclaw',
      'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
  });
});

test('reply: without a reply and with the window closed, the bare word goes to the assistant', async () => {
  await withIngress(async ({ handler, event, ctx, received }) => {
    assert.deepEqual(await handler(event('sim'), ctx), { handled: false });
    assert.equal(received(), null);
  });
});

test('reply: a confirmation, a reminder, the owner\'s own message or a member\'s message gives no reference', async () => {
  // S8 of the CHECK, inverted: the reference came out of any replied text with one code.
  for (const body of ['NX4K b', CONFIRMATION, 'lembrete: NX4K', 'resumo sem pergunta', 'hash 3f2a9c1d em minusculas, thread ork-rm057respost',
    `antes\n${QUESTION}`]) {
    assert.equal(replyReference({ replyToBody: body, replyToId: '5' }), null, body);
  }
  assert.equal(replyReference({ replyToBody: QUESTION }), null, 'no replied message id');
  assert.equal(replyReference({ replyToBody: QUESTION, replyToId: 'abc' }), null);
  assert.equal(replyReference({}), null);
  assert.equal(replyReference({ replyToBody: QUESTION, replyToId: '5' }), 'NX4K:5');
  await withIngress(async ({ handler, event, ctx, received }) => {
    assert.deepEqual(await handler(event('ok', { replyToBody: CONFIRMATION, replyToId: '9' }), ctx), { handled: false });
    assert.equal(received(), null);
  });
});

test('reply: the typed code and the number in a reply also carry the reference; the core decides', async () => {
  await withIngress(async ({ handler, event, ctx, received }) => {
    await handler(event('NX4K a', { replyToBody: QUESTION, replyToId: '5' }), ctx);
    assert.deepEqual(received().args.slice(-2), ['--em-resposta-a', 'NX4K:5']);
    await handler(event('7a', { replyToBody: QUESTION, replyToId: '5' }), ctx);
    assert.deepEqual(received().args.slice(-2), ['--em-resposta-a', 'NX4K:5']);
  });
});

test('reply: ordinary chat in a reply goes to the assistant, a non-answer goes without the reference, and a foreign sender never reaches the core', async () => {
  await withIngress(async ({ handler, event, ctx, received }) => {
    assert.deepEqual(await handler(event('pode me explicar o envelope antes?', { replyToBody: QUESTION, replyToId: '5' }), ctx), { handled: false });
    await handler(event('#OrkPulseOn', { replyToBody: QUESTION, replyToId: '5' }), ctx);
    assert.ok(!received().args.includes('--em-resposta-a'), 'the cadence tag is not an answer to the question');
    fs.rmSync(path.join(process.env.ORK_HITL_ROOT, 'received.json'), { force: true });
    const r = await handler(event('sim', { replyToBody: QUESTION, replyToId: '5', senderId: '43' }), ctx);
    assert.match(r.reply.text, /não confirmada/);
    assert.equal(received(), null);
  });
});

/** Opens the core's listening window (ork.pulse-escuta/v1) in the simulated root. */
function openWindow() {
  const monitor = path.join(process.env.ORK_HITL_ROOT, '.orkastery', 'monitor');
  fs.mkdirSync(monitor, { recursive: true });
  fs.writeFileSync(path.join(monitor, 'pulse-escuta.json'), JSON.stringify({ contrato: 'ork.pulse-escuta/v1',
    livreAte: new Date(Date.now() + 30 * 60_000).toISOString() }));
}

test('reply: window open, the bare word in reply to another message goes marked at resposta:outra; the code and the number go without the mark', async () => {
  // G1c of the CHECK (round 2), inverted at the gateway: "sim" in reply to a member's message went as a plain bare word.
  await withIngress(async ({ handler, event, ctx, received, key }) => {
    openWindow();
    const gateConfirmation = '✅ DE6H → a) Aprovo: o gate da thread exemplo-SIMULADA está aprovado.';
    for (const [text, change] of [['sim', { replyToBody: 'Bom dia, pessoal', replyToId: '77', replyToSender: 'Membro SIMULADO' }],
      ['ok', { replyToBody: gateConfirmation, replyToId: '40' }], ['a', { replyToBody: 'Quer que eu rode a suíte agora?', replyToId: '41' }],
      ['sim', { replyToBody: QUESTION, replyToId: 'abc' }], ['autorizo', { replyToId: '42' }], ['ok', { replyToIsQuote: true }]]) {
      fs.rmSync(path.join(process.env.ORK_HITL_ROOT, 'received.json'), { force: true });
      const r = await handler(event(text, change), ctx);
      assert.equal(r.handled, true, `${text}: ${JSON.stringify(change)}`);
      const { args, envelope: e } = received();
      assert.deepEqual(args.slice(-2), ['--em-resposta-a', 'outra'], JSON.stringify(change));
      assert.equal(e.prova, createHmac('sha256', key).update(JSON.stringify(['ork.hitl-answer/v2', 'pulse', 'resposta:outra', 'openclaw',
        'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
    }
    for (const text of ['DE6H a', '1a', '1. sim']) {
      fs.rmSync(path.join(process.env.ORK_HITL_ROOT, 'received.json'), { force: true });
      await handler(event(text, { replyToBody: 'Bom dia, pessoal', replyToId: '77' }), ctx);
      const { args, envelope: e } = received();
      assert.ok(!args.includes('--em-resposta-a'), text);
      assert.equal(e.prova, createHmac('sha256', key).update(JSON.stringify(['ork.hitl-answer/v2', 'pulse', 'resposta', 'openclaw',
        'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'), text);
    }
    // Without a reply, the bare word with the window open goes as always, without the mark.
    fs.rmSync(path.join(process.env.ORK_HITL_ROOT, 'received.json'), { force: true });
    await handler(event('sim'), ctx);
    assert.ok(!received().args.includes('--em-resposta-a'));
  });
});

test('reply: window closed, the bare word in reply to another message goes to the assistant; isReply sees reply, quote and the reply without text', async () => {
  await withIngress(async ({ handler, event, ctx, received }) => {
    assert.deepEqual(await handler(event('sim', { replyToBody: 'Bom dia, pessoal', replyToId: '77' }), ctx), { handled: false });
    assert.equal(received(), null);
  });
  assert.equal(isReply({ replyToBody: 'Bom dia', replyToId: '77' }), true);
  assert.equal(isReply({ replyToId: '77' }), true);
  assert.equal(isReply({ replyToSender: 'Membro' }), true);
  assert.equal(isReply({ replyToIsQuote: true }), true);
  assert.equal(isReply({}), false);
  assert.equal(isReply({ replyToBody: '', replyToId: '', replyToIsQuote: false }), false);
});
