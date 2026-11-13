import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../../..', import.meta.url));
const nucleo = path.join(raiz, 'core', 'dist');

async function comHooks(corpo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-openclaw-sessao-'));
  const salvo = process.env.ORK_NUCLEO_DIR;
  try {
    const sdk = path.join(dir, 'node_modules', 'openclaw');
    fs.mkdirSync(sdk, { recursive: true });
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({
      type: 'module', exports: { './plugin-sdk/tool-plugin': './sdk.js' },
    }));
    fs.writeFileSync(path.join(sdk, 'sdk.js'), 'export const defineToolPlugin = d => d;');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    for (const arquivo of ['index.js', 'hitl-ingress.js']) {
      fs.copyFileSync(new URL(`../dist/${arquivo}`, import.meta.url), path.join(dir, arquivo));
    }
    const workspace = path.join(dir, 'workspace');
    fs.mkdirSync(workspace);
    fs.copyFileSync(path.join(raiz, 'orkastery.yaml'), path.join(workspace, 'orkastery.yaml'));
    process.env.ORK_NUCLEO_DIR = nucleo;
    const registrados = new Map();
    const plugin = (await import(`${pathToFileURL(path.join(dir, 'index.js')).href}?fixture=${Date.now()}`)).default;
    plugin.register({
      on() {},
      registerHook(eventos, handler) {
        for (const evento of Array.isArray(eventos) ? eventos : [eventos]) registrados.set(evento, handler);
      },
    });
    await corpo({ registrados, workspace });
  } finally {
    if (salvo === undefined) delete process.env.ORK_NUCLEO_DIR;
    else process.env.ORK_NUCLEO_DIR = salvo;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('command:new/reset so respondem pelo event.messages quando o comando veio do chat', async () => {
  await comHooks(async ({ registrados, workspace }) => {
    assert.deepEqual([...registrados.keys()].sort(), ['agent:bootstrap', 'command:new', 'command:reset']);
    for (const action of ['new', 'reset']) {
      const evento = {
        type: 'command', action, sessionKey: `chat-${action}`, messages: [],
        context: { commandSource: 'telegram', senderId: '42', workspaceDir: workspace },
      };
      await registrados.get(`command:${action}`)(evento);
      assert.equal(evento.messages.length, 1);
      assert.match(evento.messages[0], /fora de uma thread/);
      assert.match(evento.messages[0], /node core\/dist\/index\.js thread new/);
      assert.match(evento.messages[0], /node core\/dist\/index\.js adotar/);
    }

    const rpc = {
      type: 'command', action: 'reset', sessionKey: 'rpc-reset', messages: [],
      context: { commandSource: 'gateway:sessions.reset', workspaceDir: workspace },
    };
    await registrados.get('command:reset')(rpc);
    assert.deepEqual(rpc.messages, []);
  });
});

test('agent:bootstrap transporta a orientacao somente como contexto', async () => {
  await comHooks(async ({ registrados, workspace }) => {
    const arquivo = { name: 'AGENTS.md', path: path.join(workspace, 'AGENTS.md'), content: '# Workspace', missing: false };
    const evento = {
      type: 'agent', action: 'bootstrap', sessionKey: 'bootstrap-key', messages: [],
      context: { sessionId: 'bootstrap-session', workspaceDir: workspace, bootstrapFiles: [arquivo] },
    };
    await registrados.get('agent:bootstrap')(evento);
    assert.deepEqual(evento.messages, []);
    assert.match(arquivo.content, /# Workspace/);
    assert.match(arquivo.content, /fora de uma thread/);
    assert.match(arquivo.content, /node core\/dist\/index\.js thread new/);
    assert.match(arquivo.content, /node core\/dist\/index\.js adotar/);
  });
});

test('superficie sem identidade ou workspace confirmado segue sem reply e sem bloqueio', async () => {
  await comHooks(async ({ registrados }) => {
    const comando = {
      type: 'command', action: 'new', sessionKey: '', messages: [],
      context: { commandSource: 'telegram', senderId: '42', workspaceDir: 'relativo' },
    };
    await registrados.get('command:new')(comando);
    assert.deepEqual(comando.messages, []);
    const bootstrap = {
      type: 'agent', action: 'bootstrap', sessionKey: '', messages: [],
      context: { workspaceDir: 'relativo', bootstrapFiles: [] },
    };
    await registrados.get('agent:bootstrap')(bootstrap);
    assert.deepEqual(bootstrap.context.bootstrapFiles, []);
  });
});
