/**
 * I-33 (D13, GO-FIX 1 do CHECK aa279e17, achado A2): perfil autenticado por API paga NUNCA
 * recebe despacho. O preflight so aprova login de assinatura (`claude auth status` com
 * `authMethod` `claude.ai`, sem `apiKeySource`; `codex login status` com login ChatGPT). O perfil
 * pago fica `provider-pago`, sai do rodizio, aparece no `ork accounts` e no doctor, e sem outro
 * perfil elegivel o bloqueio e `cost.violation`, sem retry. Stubs dos dois CLIs; nenhuma chave real.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirTemporario, projetoTemporario, runtimePorConta } from './apoio';
import { conferirAuth as authClaude } from '../src/adapters/claude-bg';
import { conferirAuth as authCodex } from '../src/adapters/codex';
import { checarContas } from '../src/doctor';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { executarRetry } from '../src/retry';
import { adicionarPerfil, lerPerfis, PerfilDeDespacho, perfilDisponivel } from '../src/runtime-profiles';
import { dirThread, novaThread } from '../src/thread';

const CLI = path.resolve(__dirname, '../../dist/index.js');

function ork(cwd: string, args: string[], env: NodeJS.ProcessEnv): { saida: string; codigo: number } {
  try { return { saida: execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: 'pipe' }), codigo: 0 }; }
  catch (e) { const x = e as { stdout?: string; stderr?: string; status?: number }; return { saida: `${x.stdout ?? ''}${x.stderr ?? ''}`, codigo: x.status ?? 1 }; }
}

/**
 * Stubs dos dois CLIs que respondem pelo arquivo de status do proprio diretorio do perfil. E o
 * CLI simulado respondendo; o `ork` nunca abre esses arquivos (so roda o CLI com o env do perfil).
 */
function clisPorStatus(): { bin: string; restaurar: () => void } {
  const bin = dirTemporario('clis-status');
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
if [ "$1" = "auth" ]; then cat "$CLAUDE_CONFIG_DIR/.stub-auth-status.json"; exit 0; fi
echo "claude $1" >> "${bin}/despachos"; exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'codex'), `#!/bin/sh
if [ "$1" = "login" ]; then cat "$CODEX_HOME/.stub-login-status"; exit "$(cat "$CODEX_HOME/.stub-login-code" 2>/dev/null || echo 0)"; fi
echo "codex $1" >> "${bin}/despachos"; exit 1
`, { mode: 0o755 });
  const anterior = process.env.PATH;
  process.env.PATH = `${bin}:${anterior ?? ''}`;
  return { bin, restaurar: () => { process.env.PATH = anterior; fs.rmSync(bin, { recursive: true, force: true }); } };
}

function contaClaude(raiz: string, id: string, status: Record<string, unknown>): PerfilDeDespacho {
  const dir = path.join(raiz, 'contas', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.stub-auth-status.json'), JSON.stringify({ ...status, configDirectory: dir }));
  return { id, runtime: 'claude-bg', configDir: dir };
}
function contaCodex(raiz: string, id: string, saida: string, codigo = 0): PerfilDeDespacho {
  const dir = path.join(raiz, 'contas', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.stub-login-status'), saida + '\n');
  fs.writeFileSync(path.join(dir, '.stub-login-code'), String(codigo));
  return { id, runtime: 'codex', codexHome: dir };
}

const ASSINATURA = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' };

test('A2 conferencia do claude: so a assinatura claude.ai aprova; API key, helper, Console e nuvem sao provider pago', () => {
  const raiz = dirTemporario('auth-claude');
  const clis = clisPorStatus();
  try {
    assert.deepEqual(authClaude(contaClaude(raiz, 'assinatura', ASSINATURA)), { ok: true, detalhe: 'claude auth status: loggedIn (claude.ai)' });
    for (const [id, status, trecho] of [
      ['helper', { loggedIn: true, authMethod: 'api_key_helper', apiProvider: 'firstParty', apiKeySource: 'apiKeyHelper' }, 'authMethod api_key_helper, apiKeySource apiKeyHelper'],
      ['envkey', { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }, 'authMethod api_key, apiKeySource ANTHROPIC_API_KEY'],
      ['console', { loggedIn: true, authMethod: 'console', apiProvider: 'firstParty' }, 'authMethod console'],
      ['nuvem', { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' }, 'authMethod claude.ai, apiProvider bedrock'],
      ['chave-com-assinatura', { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', apiKeySource: 'apiKeyHelper' }, 'apiKeySource apiKeyHelper'],
      ['sem-metodo', { loggedIn: true }, 'authMethod ausente'],
    ] as const) {
      const r = authClaude(contaClaude(raiz, id, status));
      assert.equal(r.ok, false, id);
      assert.equal(r.pago, true, id);
      assert.ok(r.detalhe.includes(trecho) && r.detalhe.includes('provider pago'), `${id}: ${r.detalhe}`);
    }
    const semLogin = authClaude(contaClaude(raiz, 'sem-login', { loggedIn: false }));
    assert.deepEqual([semLogin.ok, semLogin.pago], [false, undefined], 'sem login e auth ausente, nao provider pago');
  } finally { clis.restaurar(); fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('A2 conferencia do codex: so o login ChatGPT aprova; API key e provider pago e o trecho da chave nao vaza', () => {
  const raiz = dirTemporario('auth-codex');
  const clis = clisPorStatus();
  try {
    assert.deepEqual(authCodex(contaCodex(raiz, 'chatgpt', 'Logged in using ChatGPT')), { ok: true, detalhe: 'codex login status: Logged in using ChatGPT' });
    const pago = authCodex(contaCodex(raiz, 'apikey', 'Logged in using an API key - sk-proj-***xxxxx'));
    assert.deepEqual(pago, { ok: false, pago: true, detalhe: 'codex login status: login por API key (provider pago)' });
    assert.equal(/sk-proj/.test(JSON.stringify(pago)), false, 'nem o trecho mascarado da chave vai ao detalhe');
    const estranho = authCodex(contaCodex(raiz, 'estranho', 'Logged in'));
    assert.deepEqual([estranho.ok, estranho.pago], [false, true], 'login sem assinatura ChatGPT comprovada nao despacha');
    const fora = authCodex(contaCodex(raiz, 'fora', 'Not logged in', 1));
    assert.deepEqual([fora.ok, fora.pago], [false, undefined]);
  } finally { clis.restaurar(); fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('A2 despacho: perfil pago sai do rodizio como provider-pago e o despacho vai ao perfil de assinatura', () => {
  const p = projetoTemporario('perfil-pago');
  const claude = runtimePorConta('pago');
  try {
    claude.conta(p.dir, 'pagoc', { pago: true });
    const contaA = claude.conta(p.dir, 'a');
    const t = novaThread(p.carregado, { nome: 'pago', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'fatia SIMULADA' });
    assert.equal(r.verificada, true, r.erro);
    const despacho = lerLedger(dir).find(e => e.tipo === 'phase_dispatch');
    assert.equal((despacho?.perfil as { id: string }).id, 'a');
    assert.deepEqual(claude.envs().filter(l => l.startsWith('--bg')), [`--bg ${contaA}`], 'o perfil pago nunca recebeu --bg');
    const pagoc = lerPerfis(p.dir).perfis.find(q => q.id === 'pagoc')!;
    assert.equal(pagoc.estado, 'provider-pago');
    assert.equal(pagoc.ultimaFalha?.motivo, 'cost.violation');
    assert.match(pagoc.ultimaFalha?.detalhe ?? '', /provider pago \(authMethod api_key_helper/);
    assert.equal(perfilDisponivel(pagoc), false);
    const rotacao = lerLedger(dir).find(e => e.tipo === 'runtime_profile_rotated');
    assert.deepEqual([rotacao?.motivo, rotacao?.de, rotacao?.para], ['cost.violation', { runtime: 'claude-bg', perfil: 'pagoc' }, { runtime: 'claude-bg', perfil: 'a' }]);
  } finally { p.limpar(); claude.restaurar(); }
});

test('A2 sem perfil elegivel: so perfil pago bloqueia em cost.violation, sem despacho e sem retry automatico', () => {
  const p = projetoTemporario('perfil-so-pago');
  const claude = runtimePorConta('so-pago');
  try {
    claude.conta(p.dir, 'pagoc', { pago: true });
    const t = novaThread(p.carregado, { nome: 'so-pago', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'fatia SIMULADA' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'cost.violation');
    assert.equal(claude.envs().some(l => l.startsWith('--bg')), false, 'nenhum despacho pela conta paga');
    assert.match(lerLedger(dir).filter(e => e.tipo === 'gate_blocked').at(-1)?.correcao as string, /assinatura/);
    const retry = executarRetry(p.carregado, t.id);
    assert.equal(retry.plano.acao, 'sem-retry');
    assert.equal(retry.executada, false);
    assert.equal(claude.envs().some(l => l.startsWith('--bg')), false, 'o retry tambem nao despacha');
  } finally { p.limpar(); claude.restaurar(); }
});

test('A2 codex: perfil logado por API key nunca recebe despacho', () => {
  const p = projetoTemporario('perfil-pago-codex');
  const clis = clisPorStatus();
  try {
    const pago = contaCodex(p.dir, 'pago', 'Logged in using an API key - sk-proj-***xxxxx');
    adicionarPerfil(p.dir, { id: 'pago', runtime: 'codex', dir: pago.codexHome as string });
    const t = novaThread(p.carregado, { nome: 'codex-pago', modo: 'auto' }).thread;
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', prompt: 'fatia SIMULADA', runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.deepEqual([r.bloqueado, r.motivo], [true, 'cost.violation']);
    assert.equal(fs.existsSync(path.join(clis.bin, 'despachos')), false, 'o app-server nunca foi iniciado');
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'provider-pago');
    assert.equal(/sk-proj/.test(fs.readFileSync(path.join(dirThread(p.dir, t.id), 'ledger.jsonl'), 'utf8')), false);
  } finally { clis.restaurar(); p.limpar(); }
});

test('A2 doctor e accounts: provider pago aparece legivel, add fixa --claudeai e check so reativa com assinatura', () => {
  const p = projetoTemporario('perfil-pago-cli');
  const clis = clisPorStatus();
  const env = { ...process.env };
  try {
    const dir = path.join(p.dir, 'contas', 'c');
    const add = ork(p.dir, ['accounts', 'add', 'c', '--runtime', 'claude-bg', '--dir', dir], env);
    assert.equal(add.codigo, 0, add.saida);
    assert.ok(add.saida.includes(`claude auth login --claudeai`), add.saida);
    contaClaude(p.dir, 'c', { loggedIn: true, authMethod: 'api_key_helper', apiKeySource: 'apiKeyHelper' });
    const check = ork(p.dir, ['accounts', 'check'], env);
    assert.equal(check.codigo, 1, check.saida);
    assert.match(check.saida, /provider pago, nunca despacha/);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'provider-pago');
    assert.match(ork(p.dir, ['accounts', 'list'], env).saida, /provider-pago/);
    const doctor = checarContas(p.dir);
    assert.equal(doctor.nivel, 'fail');
    assert.match(doctor.detalhe, /c provider pago \(nunca despacha\)/);
    // Login refeito pela assinatura: o check reativa.
    contaClaude(p.dir, 'c', ASSINATURA);
    assert.equal(ork(p.dir, ['accounts', 'check', 'c'], env).codigo, 0);
    assert.equal(lerPerfis(p.dir).perfis[0].estado, 'ativo');
  } finally { clis.restaurar(); p.limpar(); }
});
