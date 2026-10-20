import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { codexFalso } from './prova-ativacao-apoio';

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
