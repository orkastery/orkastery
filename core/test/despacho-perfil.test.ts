/**
 * I-33 (T3, D2): o perfil entra no contrato de despacho e o adapter monta o env do filho a
 * partir dele. O stub do `claude` simula um registro de sessoes POR CONTA: `claude agents` so
 * lista a sessao quando roda com o `CLAUDE_CONFIG_DIR` que despachou. Assim a prova de que a
 * reverificacao usa o perfil nao depende de ler o codigo: com o env do processo ela falharia.
 */
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ambienteDoPerfil, conferirAuth as authClaude, consultarAgentesNativos, consultarSessoes, despachar as despacharClaude,
  logs as logsClaude, montarComando, parar as pararClaude,
} from '../src/adapters/claude-bg';
import {
  acharRollout, ambienteDoDespacho, casaDoCodex, conferirAuth as authCodex, despachar as despacharCodex,
} from '../src/adapters/codex';
import { despacharComController } from '../src/adapters/codex-controller';
import { PedidoDeDespacho } from '../src/runtimes';
import { dirTemporario } from './apoio';

const SESSAO = '22222222-3333-4444-5555-666666666666';

/** `claude` por conta: cada chamada grava `<subcomando> <CLAUDE_CONFIG_DIR>` em `envs`. */
const SCRIPT_CLAUDE = `#!/bin/sh
DIR="$ORK_PERFIL_STUB_DIR"
echo "$1 $CLAUDE_CONFIG_DIR" >> "$DIR/envs"
if [ "$1" = "auth" ]; then
  if [ -f "$CLAUDE_CONFIG_DIR/.stub-logado" ]; then L=true; else L=false; fi
  printf '{"loggedIn":%s,"authMethod":"claude.ai","configDirectory":"%s"}\\n' "$L" "$CLAUDE_CONFIG_DIR"
  [ "$L" = true ] && exit 0 || exit 1
fi
if [ "$1" = "agents" ]; then
  if [ -f "$DIR/conta" ] && [ "$(cat "$DIR/conta")" = "$CLAUDE_CONFIG_DIR" ]; then
    printf '[{"id":"22222222","sessionId":"${SESSAO}","name":"ork-perfil-f3","cwd":"%s","kind":"background","state":"working"}]\\n' "$(cat "$DIR/cwd")"
  else echo '[]'; fi
  exit 0
fi
if [ "$1" = "logs" ] || [ "$1" = "stop" ]; then echo "ok $2"; exit 0; fi
printf '%s' "$CLAUDE_CONFIG_DIR" > "$DIR/conta"
pwd > "$DIR/cwd"
echo "Background agent started: ${SESSAO}"
exit 0
`;

const SCRIPT_CODEX = `#!/bin/sh
echo "$1 $CODEX_HOME" >> "$ORK_PERFIL_STUB_DIR/envs"
if [ "$1" = "login" ]; then
  if [ -f "$CODEX_HOME/.stub-logado" ]; then echo "Logged in using ChatGPT"; exit 0; fi
  echo "Not logged in"; exit 1
fi
exit 0
`;

interface Stub { dir: string; envs: () => string[]; restaurar: () => void }

function stubs(nome: string): Stub {
  const dir = dirTemporario(`perfil-${nome}`);
  fs.writeFileSync(path.join(dir, 'claude'), SCRIPT_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'codex'), SCRIPT_CODEX, { mode: 0o755 });
  const anterior = { PATH: process.env.PATH, STUB: process.env.ORK_PERFIL_STUB_DIR, CLAUDE: process.env.CLAUDE_CONFIG_DIR,
    CODEX: process.env.CODEX_HOME };
  process.env.PATH = `${dir}:${anterior.PATH ?? ''}`;
  process.env.ORK_PERFIL_STUB_DIR = dir;
  // O processo `ork` roda na conta B; o perfil do despacho e a conta A.
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'conta-b');
  process.env.CODEX_HOME = path.join(dir, 'codex-b');
  const volta = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  return {
    dir,
    envs: () => fs.existsSync(path.join(dir, 'envs')) ? fs.readFileSync(path.join(dir, 'envs'), 'utf8').trim().split('\n') : [],
    restaurar: () => {
      volta('PATH', anterior.PATH); volta('ORK_PERFIL_STUB_DIR', anterior.STUB);
      volta('CLAUDE_CONFIG_DIR', anterior.CLAUDE); volta('CODEX_HOME', anterior.CODEX);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('claude-bg: despacho, reverificacao, consultas, logs e parar rodam com o CLAUDE_CONFIG_DIR do perfil', () => {
  const s = stubs('claude');
  try {
    const contaA = path.join(s.dir, 'conta-a');
    const perfil = { id: 'a', runtime: 'claude-bg' as const, configDir: contaA };
    const pedido: PedidoDeDespacho = { prompt: 'fase', nome: 'ork-perfil-f3', cwd: s.dir, perfil };
    assert.equal(montarComando(pedido).some(a => a.includes(contaA)), false, 'o perfil vai no env, nunca na linha de comando');
    const r = despacharClaude(pedido);
    assert.equal(r.ok, true, r.erro);
    assert.equal(r.sessionId, SESSAO);
    assert.equal(r.verificada, true, 'reverificado na mesma conta que despachou');
    assert.deepEqual(s.envs(), [`--bg ${contaA}`, `agents ${contaA}`]);
    // Pelo env do processo (conta B) a sessao nao aparece: e o risco R2 que o perfil fecha.
    assert.deepEqual(consultarSessoes(undefined, true).sessoes, []);
    const env = ambienteDoPerfil(perfil);
    assert.equal(consultarSessoes(undefined, true, env).sessoes[0]?.sessionId, SESSAO);
    assert.equal(consultarAgentesNativos(undefined, env).registros[0]?.sessionId, SESSAO);
    assert.equal(consultarAgentesNativos().registros.length, 0);
    assert.equal(logsClaude(SESSAO, 10, env).ok, true);
    assert.equal(pararClaude(SESSAO, env).ok, true);
    assert.ok(s.envs().slice(-4).every(l => l.endsWith(contaA)), s.envs().join('\n'));
  } finally { s.restaurar(); }
});

test('claude-bg sem perfil segue o ambiente do processo (P8) e perfil de outro runtime e recusado', () => {
  const s = stubs('claude-p8');
  try {
    const r = despacharClaude({ prompt: 'fase', nome: 'ork-perfil-f3', cwd: s.dir });
    assert.equal(r.verificada, true);
    assert.deepEqual(s.envs(), [`--bg ${path.join(s.dir, 'conta-b')}`, `agents ${path.join(s.dir, 'conta-b')}`]);
    const errado = despacharClaude({ prompt: 'fase', nome: 'ork-perfil-f3', cwd: s.dir,
      perfil: { id: 'x', runtime: 'codex', codexHome: '/srv/x' } });
    assert.equal(errado.ok, false);
    assert.match(errado.erro ?? '', /CLAUDE_CONFIG_DIR/);
    assert.equal(s.envs().length, 2, 'perfil invalido nao chega a executar nada');
  } finally { s.restaurar(); }
});

test('auth: claude auth status e codex login status sao do perfil, e so login do proprio CLI aprova', () => {
  const s = stubs('auth');
  try {
    const contaA = path.join(s.dir, 'conta-a'), codexA = path.join(s.dir, 'codex-a');
    fs.mkdirSync(contaA); fs.mkdirSync(codexA);
    const claude = { id: 'a', runtime: 'claude-bg' as const, configDir: contaA };
    const codex = { id: 'x', runtime: 'codex' as const, codexHome: codexA };
    assert.equal(authClaude(claude).ok, false);
    assert.equal(authCodex(codex).ok, false);
    assert.match(authCodex(codex).detalhe, /Not logged in/);
    fs.writeFileSync(path.join(contaA, '.stub-logado'), '');
    fs.writeFileSync(path.join(codexA, '.stub-logado'), '');
    assert.deepEqual(authClaude(claude), { ok: true, detalhe: 'claude auth status: loggedIn (claude.ai)' });
    assert.equal(authCodex(codex).ok, true);
    assert.ok(s.envs().includes(`auth ${contaA}`) && s.envs().includes(`login ${codexA}`));
    assert.equal(authClaude(null).ok, false, 'conta B do processo nao tem login no stub');
  } finally { s.restaurar(); }
});

test('codex: CODEX_HOME do perfil no env do despacho, rollouts e casa pelo perfil, sem chave paga', () => {
  const base = { PATH: '/bin', CODEX_HOME: '/home/u/.codex', OPENAI_API_KEY: 'x', CODEX_API_KEY: 'y' };
  const perfil = { id: 'x', runtime: 'codex' as const, codexHome: '/srv/contas/codex-x' };
  const env = ambienteDoDespacho(base, perfil);
  assert.equal(env.CODEX_HOME, '/srv/contas/codex-x');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(ambienteDoDespacho(base).CODEX_HOME, '/home/u/.codex');
  assert.throws(() => ambienteDoDespacho(base, { id: 'a', runtime: 'claude-bg', configDir: '/srv/a' }), /codexHome/);
  assert.equal(casaDoCodex(perfil), '/srv/contas/codex-x');
  const casa = dirTemporario('perfil-rollout');
  try {
    const id = '0199aaaa-bbbb-cccc-dddd-eeeeffff0009';
    fs.mkdirSync(path.join(casa, 'sessions', '2026', '09', '19'), { recursive: true });
    fs.writeFileSync(path.join(casa, 'sessions', '2026', '09', '19', `rollout-2026-09-19T00-00-00-${id}.jsonl`), '');
    assert.ok(acharRollout(id, 3, casa));
    assert.equal(acharRollout(id, 3, path.join(casa, 'outra')), null);
  } finally { fs.rmSync(casa, { recursive: true, force: true }); }
});

test('codex: despacho com perfil cujo env diverge e recusado antes do worker', () => {
  const cwd = dirTemporario('perfil-controller');
  try {
    const prompt = 'fase';
    const vinculo = { thread: 't', fase: 'GO' as const, promptSha256: createHash('sha256').update(prompt).digest('hex') };
    const perfil = { id: 'x', runtime: 'codex' as const, codexHome: '/srv/contas/codex-x' };
    const pedido = { prompt, nome: 'ork-perfil-f3', cwd, vinculo, perfil, dryRun: true };
    const divergente = despacharComController(pedido, { CODEX_HOME: '/home/u/.codex' });
    assert.equal(divergente.ok, false);
    assert.match(divergente.erro ?? '', /diverge do perfil/);
    assert.equal(despacharComController(pedido, { CODEX_HOME: perfil.codexHome }).ok, true);
    assert.equal(despacharCodex({ ...pedido, perfil: { id: 'a', runtime: 'claude-bg', configDir: '/srv/a' } }).ok, false);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});
