import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROTEIRO = path.resolve(__dirname, '../../scripts/prova-ativacao.cjs');

test('roteiro: host fora da prova e host ausente saem com 2 e recibo tipado, sem criar nada', () => {
  const naoSuportado = cp.spawnSync(process.execPath, [ROTEIRO, 'hermes'], { encoding: 'utf8' });
  assert.equal(naoSuportado.status, 2);
  assert.match(naoSuportado.stderr, /host\.nao-suportado/);
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-path-'));
  try {
    const ausente = cp.spawnSync(process.execPath, [ROTEIRO, 'openclaw'], { encoding: 'utf8', env: { ...process.env, PATH: vazio } });
    assert.equal(ausente.status, 2, ausente.stderr);
    const recibo = JSON.parse(ausente.stdout);
    assert.equal(recibo.contrato, 'ork.prova-ativacao/v1');
    assert.equal(recibo.estado, 'host-ausente');
    assert.equal(recibo.limpeza.removido, true);
  } finally { fs.rmSync(vazio, { recursive: true, force: true }); }
});

/**
 * B11: um `codex` falso no PATH. `exec` le o servidor MCP que o roteiro passa por `-c`, chama `ork_maestro`
 * nele de verdade e devolve os eventos no formato do `codex exec --json`. Assim o roteiro inteiro roda sem
 * sessao do Codex: login, fixture, adaptador, `ork mcp install`, tools/list, conferencia e recibo.
 */
const CODEX_FALSO = `#!/usr/bin/env node
const cp = require('node:child_process');
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
require('node:fs').writeFileSync(process.env.CODEX_FALSO_ARGS, JSON.stringify({ argv: a, cfg }));
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

function codexFalso() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-codex-falso-'));
  fs.writeFileSync(path.join(dir, 'codex'), CODEX_FALSO, { mode: 0o755 });
  const codexHome = path.join(dir, 'codex-home');
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "x"\n');
  const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}`, CODEX_HOME: codexHome,
    CODEX_FALSO_ARGS: path.join(dir, 'args.json') };
  return { dir, env, args: () => JSON.parse(fs.readFileSync(env.CODEX_FALSO_ARGS, 'utf8')), limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('roteiro codex (B11): sessao efemera, MCP do projeto por -c, so ork_maestro aprovada, 11 de 11 conferencias', () => {
  const f = codexFalso();
  try {
    const r = cp.spawnSync(process.execPath, [ROTEIRO, 'codex'], { encoding: 'utf8', env: f.env, timeout: 240000 });
    assert.equal(r.status, 0, `${r.stderr}\n${r.stdout.slice(0, 3000)}`);
    const recibo = JSON.parse(r.stdout);
    assert.equal(recibo.estado, 'aprovada');
    assert.equal(recibo.hostVersao, 'codex-cli 0.0.0-falso');
    assert.equal(recibo.conferencias.length, 11);
    assert.ok(recibo.conferencias.every((c: { ok: boolean }) => c.ok), JSON.stringify(recibo.conferencias));
    assert.equal(recibo.global.intocado, true);
    assert.ok(Object.keys(recibo.global.antes).includes('codex:config.toml'));
    assert.deepEqual(recibo.transcript.chamadas.map((c: { nome: string }) => c.nome), ['mcp__orkastery__ork_maestro']);
    const { argv, cfg } = f.args();
    for (const flag of ['--json', '--ephemeral', '--ignore-user-config', '--ignore-rules']) assert.ok(argv.includes(flag), flag);
    assert.equal(argv[argv.indexOf('-s') + 1], 'read-only');
    assert.equal(cfg.approval_policy, 'never');
    assert.equal(cfg['mcp_servers.orkastery.tools.ork_maestro.approval_mode'], 'approve');
    assert.deepEqual(Object.keys(cfg).filter(k => k.endsWith('.approval_mode')), ['mcp_servers.orkastery.tools.ork_maestro.approval_mode']);
    assert.deepEqual(cfg['mcp_servers.orkastery.env_vars'], ['CODEX_HOME']);
    assert.equal(argv.at(-1), 'orkastery maestro');
    assert.equal(recibo.limpeza.removido, true);
  } finally { f.limpar(); }
});

test('roteiro codex (B11): sem login e pendencia humana (saida 3); sem codex no PATH e host ausente (saida 2)', () => {
  const f = codexFalso();
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-path-'));
  try {
    const semLogin = cp.spawnSync(process.execPath, [ROTEIRO, 'codex'], { encoding: 'utf8', env: { ...f.env, CODEX_FALSO_SEM_LOGIN: '1' }, timeout: 60000 });
    assert.equal(semLogin.status, 3, semLogin.stderr);
    const recibo = JSON.parse(semLogin.stdout);
    assert.equal(recibo.estado, 'pendente-humano');
    assert.match(recibo.pendenciasHumanas[0].comando, /codex login/);
    assert.equal(fs.existsSync(f.env.CODEX_FALSO_ARGS), false, 'nenhuma sessao foi aberta');
    const ausente = cp.spawnSync(process.execPath, [ROTEIRO, 'codex'], { encoding: 'utf8', env: { ...process.env, PATH: vazio } });
    assert.equal(ausente.status, 2, ausente.stderr);
    assert.equal(JSON.parse(ausente.stdout).estado, 'host-ausente');
  } finally { f.limpar(); fs.rmSync(vazio, { recursive: true, force: true }); }
});
