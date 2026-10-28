/**
 * O `codex` falso do roteiro da prova de ativação (B11), dividido entre `prova-ativacao-roteiro.test.ts` e o teste de
 * hermeticidade da RM-037 (`rm037-defeitos2010-hermeticos.test.ts`): um arquivo de teste não importa outro, porque os
 * testes dele rodariam junto.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * B11: um `codex` falso no PATH. `exec` le o servidor MCP que o roteiro passa por `-c`, chama `ork_maestro`
 * nele de verdade e devolve os eventos no formato do `codex exec --json`. Assim o roteiro inteiro roda sem
 * sessao do Codex: login, fixture, adaptador, `ork mcp install`, tools/list, conferencia e recibo.
 */
const CODEX_FALSO = `#!/usr/bin/env node
const cp = require('node:child_process');
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('codex-cli 0.0.0-falso'); process.exit(0); }
if (a[0] === 'login') {
  if (process.env.CODEX_FALSO_SEM_LOGIN) { console.error('Not logged in'); process.exit(1); }
  console.error('Logged in using ChatGPT'); process.exit(0);
}
if (a[0] !== 'exec') process.exit(9);
const cfg = {}; let dir = process.cwd();
for (let i = 1; i < a.length; i++) {
  if (a[i] === '-c') { const [k, ...v] = a[++i].split('='); cfg[k] = JSON.parse(v.join('=')); }
  else if (a[i] === '-C') dir = a[++i];
}
fs.writeFileSync(process.env.CODEX_FALSO_ARGS, JSON.stringify({ argv: a, cfg }));
if (process.env.ORK_TEST_WRITER_ACK) {
  const prazo = Date.now() + 10000;
  const pausa = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(process.env.ORK_TEST_WRITER_ACK) && Date.now() < prazo) Atomics.wait(pausa, 0, 0, 5);
  if (!fs.existsSync(process.env.ORK_TEST_WRITER_ACK)) { console.error('writer de teste não confirmou a sobreposição'); process.exit(8); }
}
const entrada = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-falso', version: '0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ork_maestro', arguments: {} } },
].map(m => JSON.stringify(m)).join('\\n') + '\\n';
const r = cp.spawnSync(cfg['mcp_servers.orkastery.command'], cfg['mcp_servers.orkastery.args'], { cwd: dir, input: entrada, encoding: 'utf8' });
const resp = r.stdout.split('\\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(m => m && m.id === 2);
const item = { id: 'item_1', type: 'mcp_tool_call', server: 'orkastery', tool: 'ork_maestro', arguments: {} };
const ev = [
  { type: 'thread.started', thread_id: 'falso' }, { type: 'turn.started' },
  { type: 'item.started', item: { ...item, status: 'in_progress' } },
  { type: 'item.completed', item: { ...item, result: resp.result, error: null, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Panorama do projeto provaativacao: nenhuma thread.' } },
  { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
];
for (const e of ev) console.log(JSON.stringify(e));
`;

export function codexFalso() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-codex-falso-'));
  fs.writeFileSync(path.join(dir, 'codex'), CODEX_FALSO, { mode: 0o755 });
  const codexHome = path.join(dir, 'codex-home');
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "x"\n');
  // RM-037 (defeito 3 de 19 e 20/10/2026): o HOME e a pasta do usuario do roteiro sao do teste. Com os de quem roda a
  // suite, a conferencia `global.intocado` fotografava o registro de projetos que outras sessoes da maquina regravam
  // (e a casa do `npm test`, que os arquivos da suite dividem), e a prova reprovava sob carga sem o codigo mudar.
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, ORK_USUARIO_DIR: path.join(dir, 'usuario'), ORKASTERY_HOME: path.join(dir, 'casa'),
    PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`, CODEX_HOME: codexHome, CODEX_FALSO_ARGS: path.join(dir, 'args.json') };
  return { dir, env, args: () => JSON.parse(fs.readFileSync(env.CODEX_FALSO_ARGS, 'utf8')), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
