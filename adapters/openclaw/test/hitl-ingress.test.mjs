/** Hooks, identities and credentials are SIMULATED; CLI transport is a local subprocess. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { registerHitlIngress } from '../dist/hitl-ingress.js';

test('native hook signs authenticated identity and passes only envelope via stdin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-native-'));
  // FX1: this channel has ITS OWN key; the shared ORK_HITL_INGRESS_KEY must not authenticate it.
  const names = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];
  const old = names.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-native-ingress-key-for-test-000', dir];
  names.forEach((n, i) => process.env[n] = vals[i]);
  try {
    const bin = path.join(dir, 'ork');
    fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('received.json',JSON.stringify({args:process.argv.slice(2),envelope:JSON.parse(fs.readFileSync(0,'utf8'))}));console.log(JSON.stringify({ok:true,pedidoId:'request-1',estado:'aprovado',repetida:false}));\n`, { mode: 0o700 });
    let handler;
    registerHitlIngress({ on(name, fn) { assert.equal(name, 'inbound_claim'); handler = fn; } }, bin);
    const event = { content: '/ork gate ork-simulated request-1 simulado ç $()', channel: 'telegram', commandAuthorized: true,
      accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '8', timestamp: Date.now() };
    const ctx = { channelId: 'telegram', accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '8' };
    for (const change of [{ commandAuthorized: false }, { commandAuthorized: undefined }, { senderId: '99' }, { accountId: 'wrong' }, { conversationId: '-8' }, { timestamp: 1 }, { messageId: 'fabricated' }]) {
      assert.equal((await handler({ ...event, ...change }, ctx)).handled, true);
      assert.equal(fs.existsSync(path.join(dir, 'received.json')), false);
    }
    const r = await handler(event, ctx);
    assert.match(r.reply.text, /recebida/);
    const { args, envelope: e } = JSON.parse(fs.readFileSync(path.join(dir, 'received.json'), 'utf8'));
    assert.ok(!args.includes(e.resposta));
    // D12: the channel is inside the signed body, and argv must declare the same one.
    assert.equal(e.canal, 'openclaw');
    assert.equal(args[args.indexOf('--canal') + 1], 'openclaw');
    // FX5: the authorized account is signed and declared, not only checked in this process.
    assert.equal(e.conta, 'simulated');
    assert.equal(args[args.indexOf('--conta') + 1], 'simulated');
    assert.equal(e.prova, createHmac('sha256', vals[4]).update(JSON.stringify(['ork.hitl-answer/v2', 'ork-simulated', 'request-1', 'openclaw', 'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
    // A v1 signature over the same envelope must NOT match: the channel changed the body.
    assert.notEqual(e.prova, createHmac('sha256', vals[4]).update(JSON.stringify(['ork.hitl-answer/v1', 'ork-simulated', 'request-1', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
    // Another account signs a different proof, so a stolen receipt does not travel accounts.
    assert.notEqual(e.prova, createHmac('sha256', vals[4]).update(JSON.stringify(['ork.hitl-answer/v2', 'ork-simulated', 'request-1', 'openclaw', 'outra-conta', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
    assert.equal(args[4], '--resposta-stdin');
    // FX1: the Hermes key, or the shared legacy key, signs a different proof.
    for (const alheia of ['SIMULATED-hermes-ingress-key-for-test-0000', 'SIMULATED-shared-legacy-key-for-test-00000']) {
      assert.notEqual(e.prova, createHmac('sha256', alheia).update(JSON.stringify(['ork.hitl-answer/v2',
        'ork-simulated', 'request-1', 'openclaw', 'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
    }
    await handler(event, ctx);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'received.json'), 'utf8')).envelope.prova, e.prova);
    assert.equal((await handler({ content: 'normal' }, ctx)).handled, false);
  } finally {
    names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session answer uses the flag the CLI actually requires, and signs the channel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-native-session-'));
  // FX1: this channel has ITS OWN key; the shared ORK_HITL_INGRESS_KEY must not authenticate it.
  const names = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];
  const old = names.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-native-ingress-key-for-test-000', dir];
  names.forEach((n, i) => process.env[n] = vals[i]);
  try {
    const bin = path.join(dir, 'ork');
    fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('received.json',JSON.stringify({args:process.argv.slice(2),envelope:JSON.parse(fs.readFileSync(0,'utf8'))}));console.log(JSON.stringify({ok:true,pedidoId:'request-2',estado:'entregue',repetida:false,sessionId:'00000000-0000-0000-0000-000000000042'}));\n`, { mode: 0o700 });
    let handler;
    registerHitlIngress({ on(_name, fn) { handler = fn; } }, bin);
    const event = { content: '/ork session ork-simulated request-2 texto livre', channel: 'telegram', commandAuthorized: true,
      accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '9', timestamp: Date.now() };
    const ctx = { channelId: 'telegram', accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '9' };
    await handler(event, ctx);
    const { args, envelope: e } = JSON.parse(fs.readFileSync(path.join(dir, 'received.json'), 'utf8'));
    assert.equal(args[0], 'sessions');
    // `sessions answer` requires --stdin; --resposta-stdin belongs to `gate answer` only.
    assert.equal(args[4], '--stdin');
    assert.equal(args.includes('--resposta-stdin'), false);
    assert.equal(e.canal, 'openclaw');
    assert.equal(args[args.indexOf('--canal') + 1], 'openclaw');
    assert.equal(e.conta, 'simulated');
    assert.equal(e.prova, createHmac('sha256', vals[4]).update(JSON.stringify(['ork.hitl-answer/v2', 'ork-simulated', 'request-2', 'openclaw', 'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, e.resposta])).digest('hex'));
  } finally {
    names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('FX5: a resposta ao humano so afirma o que o recibo do nucleo diz', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-native-recibo-'));
  const names = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];
  const old = names.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-native-ingress-key-for-test-000', dir];
  names.forEach((n, i) => process.env[n] = vals[i]);
  const bin = path.join(dir, 'ork');
  const responder = corpo => fs.writeFileSync(bin,
    `#!${process.execPath}\nconst fs=require('fs');fs.readFileSync(0,'utf8');console.log(${JSON.stringify(JSON.stringify(corpo))});\n`, { mode: 0o700 });
  try {
    let handler;
    registerHitlIngress({ on(_name, fn) { handler = fn; } }, bin);
    const ctx = { channelId: 'telegram', accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '10' };
    const evento = (content, messageId) => ({ content, channel: 'telegram', commandAuthorized: true,
      accountId: 'simulated', senderId: '42', conversationId: '-7', messageId, timestamp: Date.now() });
    // `ok: true` sem veredito tipado nunca foi recibo: antes disto, qualquer um destes
    // corpos fazia o adaptador dizer ao humano que a resposta tinha sido recebida.
    const insuficientes = [
      { ok: true, pedidoId: 'request-3' },
      { ok: true, pedidoId: 'request-3', estado: 'inventado', repetida: false },
      { ok: true, pedidoId: 'request-3', estado: 'entregue', repetida: false },
      { ok: true, pedidoId: 'outro', estado: 'aprovado', repetida: false },
      { ok: true, pedidoId: 'request-3', estado: 'aprovado', repetida: 'sim' },
    ];
    for (const corpo of insuficientes) {
      responder(corpo);
      const r = await handler(evento('/ork gate ork-simulated request-3 1', '10'), { ...ctx, messageId: '10' });
      assert.match(r.reply.text, /nao confirmada|não confirmada/);
    }
    responder({ ok: true, pedidoId: 'request-3', estado: 'recusado', repetida: true });
    assert.match((await handler(evento('/ork gate ork-simulated request-3 1', '11'),
      { ...ctx, messageId: '11' })).reply.text, /recebida/);
    // Sessao exige, alem do veredito, a sessao que recebeu: sem ela nao ha o que afirmar.
    responder({ ok: true, pedidoId: 'request-4', estado: 'entregue', repetida: false });
    assert.match((await handler(evento('/ork session ork-simulated request-4 texto', '12'),
      { ...ctx, messageId: '12' })).reply.text, /nao confirmada|não confirmada/);
    responder({ ok: true, pedidoId: 'request-4', estado: 'entregue', repetida: false, sessionId: '00000000-0000-0000-0000-000000000042' });
    assert.match((await handler(evento('/ork session ork-simulated request-4 texto', '13'),
      { ...ctx, messageId: '13' })).reply.text, /recebida/);
  } finally {
    names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('I-41 (GO-FIX 1): the answer to the pulse is signed at the pulse address and the reply is the core text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-pulse-openclaw-'));
  const names = ['ORK_HITL_OPENCLAW_ACCOUNT', 'ORK_HITL_TELEGRAM_BOT_ID', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW', 'ORK_HITL_ROOT'];
  const old = names.map(n => process.env[n]);
  const vals = ['simulated', '99', '42', '-7', 'SIMULATED-native-ingress-key-for-test-000', dir];
  names.forEach((n, i) => process.env[n] = vals[i]);
  const bin = path.join(dir, 'ork');
  const recibo = corpo => fs.writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs');fs.writeFileSync('received.json',JSON.stringify({args:process.argv.slice(2),envelope:JSON.parse(fs.readFileSync(0,'utf8'))}));console.log(${JSON.stringify(JSON.stringify(corpo))});\n`, { mode: 0o700 });
  const valido = { contrato: 'ork.pulse-resposta/v1', ok: true, tipo: 'lote', repetida: false, registradas: [], recusas: [],
    mensagem: 'Orkastery, 2 respostas registradas SIMULADAS' };
  try {
    let handler;
    registerHitlIngress({ on(_name, fn) { handler = fn; } }, bin);
    const ctx = { channelId: 'telegram', accountId: 'simulated', senderId: '42', conversationId: '-7', messageId: '20' };
    const evento = content => ({ content, channel: 'telegram', commandAuthorized: true, accountId: 'simulated',
      senderId: '42', conversationId: '-7', messageId: '20', timestamp: Date.now() });
    for (const texto of ['P4EJ a', '1a 2c', '#OrkPulseOn-15m', '1. B, 2. A', '1 aprovo', 'DE6H aprovo com a ressalva do risco']) {
      recibo(valido);
      const r = await handler(evento(texto), ctx);
      assert.equal(r.reply.text, valido.mensagem, texto);
      const { args, envelope: e } = JSON.parse(fs.readFileSync(path.join(dir, 'received.json'), 'utf8'));
      assert.deepEqual(args.slice(0, 3), ['pulse', 'responder', '--resposta-stdin']);
      assert.equal(args.includes(texto), false, 'the answer never goes in argv');
      assert.equal(e.resposta, texto);
      assert.equal(e.prova, createHmac('sha256', vals[4]).update(JSON.stringify(['ork.hitl-answer/v2', 'pulse', 'resposta',
        'openclaw', 'simulated', e.origem, e.por, e.mensagem, e.recebidoEm, texto])).digest('hex'));
    }
    // Ordinary chat is not claimed; a pulse-shaped message outside Telegram is not claimed either.
    for (const texto of ['oi tudo bem', 'HMMM ok', '7XYZ b', '1ab', 'fica em #OrkPulseOn hoje', '#OrkPulseOff-15m',
      '1. I-31. Aprovar', 'sim', 'aprovo', 'a', '1' + ' '.repeat(400) + 'a']) {
      assert.equal((await handler(evento(texto), ctx)).handled, false, texto);
    }
    // RM-048 (D3): the bare word is claimed only while the core's listening window is open.
    const monitor = path.join(dir, '.orkastery', 'monitor');
    fs.mkdirSync(monitor, { recursive: true });
    const escuta = (livreAte, contrato = 'ork.pulse-escuta/v1') =>
      fs.writeFileSync(path.join(monitor, 'pulse-escuta.json'), JSON.stringify({ contrato, livreAte }));
    escuta(new Date(Date.now() + 30 * 60000).toISOString());
    for (const texto of ['sim', 'Aprovo!', 'pode seguir', 'a', '1', 'Não']) {
      recibo(valido);
      assert.equal((await handler(evento(texto), ctx)).reply.text, valido.mensagem, texto);
    }
    escuta(new Date(Date.now() - 60000).toISOString());
    assert.equal((await handler(evento('sim'), ctx)).handled, false, 'expired window');
    escuta(new Date(Date.now() + 30 * 60000).toISOString(), 'outro/v1');
    assert.equal((await handler(evento('sim'), ctx)).handled, false, 'foreign contract');
    fs.writeFileSync(path.join(monitor, 'pulse-escuta.json'), 'x'.repeat(5000));
    assert.equal((await handler(evento('sim'), ctx)).handled, false, 'oversized file');
    assert.equal((await handler({ ...evento('1a'), channel: 'discord' }, { ...ctx, channelId: 'discord' })).handled, false);
    // Same identity checks as the gate: another sender is denied before the core is called.
    fs.rmSync(path.join(dir, 'received.json'), { force: true });
    assert.match((await handler({ ...evento('1a'), senderId: '43' }, { ...ctx, senderId: '43' })).reply.text, /não confirmada/);
    assert.equal(fs.existsSync(path.join(dir, 'received.json')), false);
    // An invalid receipt never becomes a reply that claims something; a repeated one is not resent.
    recibo({ ...valido, contrato: 'ork.hitl/v2' });
    assert.match((await handler(evento('1a'), ctx)).reply.text, /não confirmada/);
    recibo({ ...valido, repetida: true });
    assert.deepEqual(await handler(evento('1a'), ctx), { handled: true });
  } finally {
    names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
