import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = fileURLToPath(new URL('../../../core/dist/', import.meta.url));
const { projetoTemporario } = require('../../../core/dist-test/test/apoio.js');
const { novaThread, dirThread } = require(path.join(core, 'thread.js'));
const { registrar, lerLedger } = require(path.join(core, 'ledger.js'));
const { abrirPedidoGate, contextoDoPedidoNativo, responderGate, assinaturaDaResposta } = require(path.join(core, 'hitl-gates.js'));
const { nativeMessage } = require(path.join(core, 'hitl-native.js'));

test('GO-FIX4: helper real migra recibo legado antes de exportar somente verificadores públicos', () => {
  const p = projetoTemporario('openclaw-legacy-helper'), saved = { ...process.env }, log = console.log;
  try {
    process.env = { ...saved };
    for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_') || name === 'ORK_RECEIPT_VERIFIERS') delete process.env[name];
    const key = 'fixture-private-legacy-'.repeat(3);
    Object.assign(process.env, { ORK_HITL_ROOT: p.dir, ORK_HITL_INGRESS_KEY_OPENCLAW: key,
      ORK_HITL_OPENCLAW_ACCOUNT: 'account', ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' });
    const t = novaThread(p.carregado, { nome: 'Legado', modo: 'classic' }).thread, dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id);
    const answer = { origem: 'telegram', canal: 'openclaw', conta: 'account', resposta: '1', prova: '',
      por: 'telegram:42', mensagem: 'telegram:-7:legacy', recebidoEm: new Date().toISOString() };
    answer.prova = assinaturaDaResposta(t.id, q.id, answer, key);
    responderGate(p.dir, t.id, q.id, answer);
    const event = lerLedger(dir).find(e => e.tipo === 'human_gate');
    const file = path.join(dir, 'hitl-ingress', path.basename(event.evidencia));
    const original = fs.readFileSync(file), ledger = fs.readFileSync(path.join(dir, 'ledger.jsonl'));
    fs.unlinkSync(file + '.public');
    let output;
    console.log = value => { output = value; };
    const main = require(path.join(core, 'index.js')).main;
    assert.equal(main(['receipt-verifiers', '--json']), 0);
    assert.equal(JSON.parse(output).schema, 'ork.hitl-verifiers/v1');
    assert.ok(!output.includes(key));
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'ledger.jsonl')), ledger);
    const trusted = { ...process.env };
    process.env = { ORK_RECEIPT_VERIFIERS: output };
    assert.equal(require(path.join(core, 'gates.js')).aprovacoesHumanas(p.dir, t.id).length, 1);
    assert.throws(() => responderGate(p.dir, t.id, q.id, answer));
    process.env = trusted;
    fs.unlinkSync(file + '.public');
    const forged = JSON.parse(original); forged.dados.por = 'forged';
    fs.writeFileSync(file, JSON.stringify(forged));
    assert.equal(main(['receipt-verifiers', '--json']), 0);
    assert.equal(fs.existsSync(file + '.public'), false);
    delete process.env.ORK_HITL_ROOT;
    assert.throws(() => main(['receipt-verifiers', '--json']), /project-unavailable/);
  } finally { console.log = log; process.env = saved; p.limpar(); }
});

test('SDK SIMULADO registra panorama; argv real é fixo e modelo não injeta resposta/root', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ork-maestro-openclaw-'));
  const saved = process.env.ORK_BIN;
  const savedKey = process.env.ORK_HITL_NATIVE_KEY_OPENCLAW;
  try {
    const sdk = path.join(dir, 'node_modules/openclaw'); fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const f of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(new URL('../dist/' + f, import.meta.url), path.join(dir, f));
    const bin = path.join(dir, 'cli fixture');
    fs.writeFileSync(bin, '#!/bin/sh\nif [ "$1" = receipt-verifiers ]; then printf "null\\n"; exit; fi\nif [ "${ORK_HITL_NATIVE_KEY_OPENCLAW+x}" = x ]; then exit 42; fi\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    process.env.ORK_BIN = bin;
    delete process.env.ORK_HITL_NATIVE_KEY_OPENCLAW;
    const plugin = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;
    const tools = plugin.tools(d => d), tool = tools.find(t => t.name === 'ork_maestro');
    assert.ok(tool); assert.match(tool.description, /orkastery maestro/);
    assert.equal(tool.parameters.additionalProperties, false);
    assert.equal(await tool.execute({ thread: 'ork-fixture', section: 'threads', offset: 2 }, {}, {}), 'maestro\n--json\n--thread\nork-fixture\n--section\nthreads\n--offset\n2');
    // I-36 (D6): toda chamada do adaptador ao ork declara o canal openclaw no ambiente.
    const doctor = tools.find(t => t.name === 'ork_doctor');
    fs.writeFileSync(bin, '#!/bin/sh\nif [ "$1" = receipt-verifiers ]; then printf "null\\n"; exit; fi\nprintf "%s\\n" "$ORK_CANAL"\n', { mode: 0o755 });
    assert.equal(await doctor.execute({}, {}, {}), 'openclaw');
    fs.writeFileSync(bin, '#!/bin/sh\nif [ "$1" = receipt-verifiers ]; then printf "null\\n"; exit; fi\nif [ "${ORK_HITL_NATIVE_KEY_OPENCLAW+x}" = x ]; then exit 42; fi\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    for (const p of [{ thread: 'x; touch INJETADO' }, { root: '/tmp' }, { resposta: '1' }, { offset: 3 }])
      assert.match(await tool.execute(p, {}, {}), /recusou|invalid/);
    assert.equal(fs.existsSync(path.join(dir, 'INJETADO')), false);
    process.env.ORK_HITL_NATIVE_KEY_OPENCLAW = 'fixture-private';
    assert.match(await tool.execute({}, {}, {}), /verifiers-unavailable/);
    assert.equal(process.env.ORK_HITL_NATIVE_KEY_OPENCLAW, 'fixture-private');
    const manifest = JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
    assert.deepEqual(tools.map(t => t.name).sort(), manifest.contracts.tools.slice().sort());
  } finally {
    if (saved === undefined) delete process.env.ORK_BIN; else process.env.ORK_BIN = saved;
    if (savedKey === undefined) delete process.env.ORK_HITL_NATIVE_KEY_OPENCLAW; else process.env.ORK_HITL_NATIVE_KEY_OPENCLAW = savedKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const transport of ['telegram', 'native']) test(`OpenClaw ${transport}: tool verifica recibo público sem herdar autoridade de ingresso`, async () => {
  const p = projetoTemporario('openclaw-public'), saved = { ...process.env };
  const key = `fixture-${transport}-`.repeat(5);
  const binding = { host: 'openclaw', installationId: 'install', connectionId: 'connection',
    sessionId: 'session', accountId: 'account', channelId: 'discord', conversationId: 'chat', personId: '42' };
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_') || name === 'ORK_RECEIPT_VERIFIERS') delete process.env[name];
    const keyName = transport === 'native' ? 'ORK_HITL_NATIVE_KEY_OPENCLAW' : 'ORK_HITL_INGRESS_KEY_OPENCLAW';
    Object.assign(process.env, { [keyName]: key, ORK_HITL_ROOT: p.dir, ORK_HITL_OPENCLAW_ACCOUNT: 'account',
      ORK_HITL_NATIVE_BINDING_OPENCLAW: JSON.stringify(binding), ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' });
    const t = novaThread(p.carregado, { nome: 'Recibo OpenClaw', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id), context = contextoDoPedidoNativo(p.dir, t.id, q.id);
    const n = { ...binding, messageId: 'message', context: context.contexto, pedidoSha256: context.pedidoSha256, expiresAt: q.prazo };
    const answer = { origem: transport, canal: 'openclaw', conta: 'account', resposta: '1', prova: '',
      recebidoEm: new Date().toISOString(), por: transport === 'native' ? 'native:openclaw:42' : 'telegram:42',
      mensagem: transport === 'native' ? nativeMessage(n) : 'telegram:-7:fixture', ...(transport === 'native' ? { native: n } : {}) };
    answer.prova = assinaturaDaResposta(t.id, q.id, answer, key);
    responderGate(p.dir, t.id, q.id, answer);
    const sdk = path.join(p.dir, 'node_modules/openclaw'); fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(p.dir, 'package.json'), '{"type":"module"}');
    for (const file of ['index.js', 'hitl-ingress.js']) fs.copyFileSync(new URL('../dist/' + file, import.meta.url), path.join(p.dir, file));
    const bin = path.join(p.dir, 'cli.cjs');
    fs.writeFileSync(bin, `#!/usr/bin/env node
const assert = require('node:assert/strict');
if (process.argv[2] === 'receipt-verifiers') {
  assert.deepEqual(process.argv.slice(2), ['receipt-verifiers', '--json']);
  require(${JSON.stringify(path.join(core, 'index.js'))}).main(process.argv.slice(2));
} else {
  assert.equal(Object.keys(process.env).some(k => k.startsWith('ORK_HITL_')), false);
  assert.throws(() => require(${JSON.stringify(path.join(core, 'hitl-gates.js'))}).responderGate(${JSON.stringify(p.dir)}, ${JSON.stringify(t.id)}, ${JSON.stringify(q.id)}, ${JSON.stringify(answer)}));
  console.log(require(${JSON.stringify(path.join(core, 'gates.js'))}).aprovacoesHumanas(${JSON.stringify(p.dir)}, ${JSON.stringify(t.id)}).length);
}
`, { mode: 0o755 });
    process.env.ORK_BIN = bin;
    const plugin = (await import(pathToFileURL(path.join(p.dir, 'index.js')).href)).default;
    const tool = plugin.tools(d => d).find(t => t.name === 'ork_thread_status');
    assert.equal(await tool.execute({ thread: t.id }, {}, {}), '1');
    assert.equal(process.env[keyName], key);
    process.env[keyName] = 'rotated-fixture-key-'.repeat(4);
    assert.equal(await tool.execute({ thread: t.id }, {}, {}), '0');
    process.env[keyName] = key;
    const event = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'human_gate');
    const file = path.join(dirThread(p.dir, t.id), 'hitl-ingress', path.basename(event.evidencia));
    const original = fs.readFileSync(file), ledger = fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl'));
    fs.unlinkSync(file + '.public');
    assert.equal(await tool.execute({ thread: t.id }, {}, {}), '1');
    assert.ok(fs.existsSync(file + '.public'));
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl')), ledger);
    // Recibo legado adulterado nunca ganha prova pública pelo processo confiável.
    fs.unlinkSync(file + '.public');
    const forged = JSON.parse(original); forged.dados.por = 'forged';
    fs.writeFileSync(file, JSON.stringify(forged));
    assert.equal(await tool.execute({ thread: t.id }, {}, {}), '0');
    assert.equal(fs.existsSync(file + '.public'), false);
    fs.writeFileSync(file, original);
    delete process.env.ORK_HITL_ROOT;
    assert.match(await tool.execute({ thread: t.id }, {}, {}), /verifiers-unavailable/);
    process.env.ORK_HITL_ROOT = p.dir;
    process.env.ORK_RECEIPT_VERIFIERS = 'invalid';
    assert.match(await tool.execute({ thread: t.id }, {}, {}), /verifiers-unavailable/);
  } finally { process.env = saved; p.limpar(); }
});
