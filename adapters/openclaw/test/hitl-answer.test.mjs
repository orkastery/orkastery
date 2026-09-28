import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

test('plugin carrega tools e transporta respostas correlacionadas sem shell', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'ork-openclaw-hitl-'));
  const saved = { ...process.env };
  try {
    const sdk = path.join(dir, 'node_modules/openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' } }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(dir, 'index.js'), fs.readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8').replace("'./hitl-ingress.js'", "'./hitl-ingress.mjs'"));
    fs.copyFileSync(new URL('../dist/hitl-ingress.js', import.meta.url), path.join(dir, 'hitl-ingress.mjs'));
    const bin = path.join(dir, 'ork');
    fs.writeFileSync(bin, `#!${process.execPath}\nif (process.argv[2] === 'receipt-verifiers') { console.log('null'); process.exit(0); }\nrequire('fs').writeFileSync(process.env.SINK,JSON.stringify({argv:process.argv.slice(2),stdin:require('fs').readFileSync(0,'utf8')})); console.log('recibo humano');`, { mode: 0o755 });
    // O executável CommonJS usa extensão fora do package ESM.
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');
    fs.renameSync(path.join(dir, 'index.js'), path.join(dir, 'index.mjs'));
    process.env.ORK_BIN = bin;
    process.env.SINK = path.join(dir, 'sink');
    process.env.ORK_HITL_TELEGRAM_USERS = '42';
    process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
    const plugin = (await import(pathToFileURL(path.join(dir, 'index.mjs')))).default;
    const tools = plugin.tools(d => d);
    const manifesto = JSON.parse(fs.readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
    assert.deepEqual(tools.map(t => t.name).sort(), manifesto.contracts.tools.slice().sort());
    assert.ok(!tools.some(t => t.name === 'ork_gate_approve'));
    for (const [name, alvo] of [['ork_gate_answer', 'gate'], ['ork_session_answer', 'sessions']]) {
      const tool = tools.find(t => t.name === name);
      assert.ok(tool);
      const update = { message: { message_id: 8, from: { id: 42, is_bot: false }, chat: { id: -7 },
        reply_to_message: { text: 'Pergunta\nork-hitl ork-t H1' }, text: '$(touch INJETADO) `id`\n1' } };
      const params = { thread: 'ork-t', pedido: 'H1', updateTelegram: update };
      assert.equal(await tool.execute(params, {}, {}), 'recibo humano');
      const recebido = JSON.parse(fs.readFileSync(process.env.SINK, 'utf8'));
      const args = recebido.argv;
      assert.deepEqual(args.slice(0, 4), [alvo, 'answer', 'ork-t', 'H1']);
      assert.equal(recebido.stdin, update.message.text);
      assert.ok(!args.includes(update.message.text));
      assert.ok(args.includes('telegram:42'));
      assert.ok(args.includes('telegram:-7:8'));
      assert.ok(!fs.existsSync(path.join(dir, 'INJETADO')));
      for (const alteracao of [u => u.message.from.id = 43, u => u.message.from.is_bot = true,
        u => u.message.chat.id = -8, u => u.message.reply_to_message.text = 'outro pedido']) {
        const invalido = structuredClone(update); alteracao(invalido);
        const antes = fs.readFileSync(process.env.SINK, 'utf8');
        assert.match(await tool.execute({ ...params, updateTelegram: invalido }, {}, {}), /recusou/);
        assert.equal(fs.readFileSync(process.env.SINK, 'utf8'), antes);
      }
      const cb = { callback_query: { id: 'cb7', from: { id: 42, is_bot: false }, message: { chat: { id: -7 } }, data: 'ork:ork-t:H1:2' } };
      assert.equal(await tool.execute({ ...params, updateTelegram: cb }, {}, {}), 'recibo humano');
      assert.equal(JSON.parse(fs.readFileSync(process.env.SINK, 'utf8')).stdin, '2');
    }
  } finally {
    for (const key of ['ORK_BIN', 'SINK', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
