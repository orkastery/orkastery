import { createHash } from 'node:crypto';
/**
 * Adapter de runtime `codex` (thread ork-homologarcod).
 *
 * O criterio destes testes e o mesmo do claude-bg: exercitar o caminho REAL do despacho
 * (spawn desanexado, extracao do thread_id do stream `--json`, re-verificacao no rollout
 * que o Codex grava em disco), com o binario trocado por um stub que a gente controla.
 * A forma do comando foi validada em teste real na maquina (06/09/2026, codex-cli 0.153.4).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  acharRollout,
  ambienteDoDespacho,
  casaDoCodex,
  consultarRollouts,
  despachar,
  ENVS_REMOVIDAS_DO_DESPACHO,
  extrairThreadId,
  montarComando,
  parseRateLimitCodex,
  SANDBOX_PADRAO,
} from '../src/adapters/codex';
import { dirTemporario } from './apoio';

const THREAD_ID = '0199aaaa-bbbb-cccc-dddd-eeeeffff0001';

/**
 * Stub do binario `codex`: responde `--version`, grava o rollout num CODEX_HOME de teste
 * e emite o stream `--json` com `thread.started`, como o CLI real faz.
 */
const SCRIPT_DO_CODEX = `#!/bin/sh
DIR="$ORK_CODEX_STUB_DIR"
if [ "$1" = "--version" ]; then echo "codex-cli stub 0.0.1"; exit 0; fi
if [ "$1" = "sandbox" ]; then exit 0; fi
echo "$@" >> "$DIR/chamadas"
if [ -f "$DIR/rate-limit" ]; then
  rm -f "$DIR/rate-limit"
  cat "$DIR/stderr-simulado"
  exit 1
fi
mkdir -p "$CODEX_HOME/sessions/2026/09/06"
: > "$CODEX_HOME/sessions/2026/09/06/rollout-2026-09-06T00-00-00-${THREAD_ID}.jsonl"
printf '{"type":"thread.started","thread_id":"${THREAD_ID}"}\\n'
printf '{"type":"turn.completed"}\\n'
exit 0
`;

interface CodexFalso {
  dir: string;
  casa: string;
  chamadas: () => string[];
  proximoDespachoMorreDeRateLimit: (saida: string) => void;
  restaurar: () => void;
}

function codexFalso(nome: string): CodexFalso {
  const dir = dirTemporario(`codex-${nome}`);
  const casa = path.join(dir, 'casa-codex');
  fs.mkdirSync(casa, { recursive: true });
  fs.writeFileSync(path.join(dir, 'codex'), SCRIPT_DO_CODEX, { encoding: 'utf8', mode: 0o755 });
  const pathAnterior = process.env.PATH ?? '';
  const casaAnterior = process.env.CODEX_HOME;
  const stubAnterior = process.env.ORK_CODEX_STUB_DIR;
  process.env.PATH = `${dir}:${pathAnterior}`;
  process.env.CODEX_HOME = casa;
  process.env.ORK_CODEX_STUB_DIR = dir;
  return {
    dir,
    casa,
    chamadas: () => {
      const arquivo = path.join(dir, 'chamadas');
      if (!fs.existsSync(arquivo)) return [];
      return fs.readFileSync(arquivo, 'utf8').split('\n').filter((l) => l.trim() !== '');
    },
    proximoDespachoMorreDeRateLimit: (saida: string) => {
      fs.writeFileSync(path.join(dir, 'stderr-simulado'), saida, 'utf8');
      fs.writeFileSync(path.join(dir, 'rate-limit'), '1', 'utf8');
    },
    restaurar: () => {
      process.env.PATH = pathAnterior;
      if (casaAnterior === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = casaAnterior;
      if (stubAnterior === undefined) delete process.env.ORK_CODEX_STUB_DIR;
      else process.env.ORK_CODEX_STUB_DIR = stubAnterior;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('o comando do codex e o headless validado: exec + sandbox + approval never + --json', () => {
  const comando = montarComando({
    prompt: 'Mapear o objetivo',
    nome: 'ork-teste-full',
    cwd: '/tmp/projeto',
    model: 'gpt-6-astra',
    effort: 'xhigh',
  });
  assert.equal(comando[0], 'codex');
  assert.equal(comando[1], 'exec');
  assert.deepEqual(comando.slice(2, 4), ['--sandbox', SANDBOX_PADRAO]);
  assert.ok(comando.includes('approval_policy=never'));
  assert.ok(comando.includes('--skip-git-repo-check'));
  assert.deepEqual(comando.slice(comando.indexOf('-C'), comando.indexOf('-C') + 2), ['-C', '/tmp/projeto']);
  assert.ok(comando.includes('--json'));
  assert.deepEqual(comando.slice(comando.indexOf('-m'), comando.indexOf('-m') + 2), ['-m', 'gpt-6-astra']);
  assert.ok(comando.includes('model_reasoning_effort="xhigh"'));
  // O prompt e o ULTIMO argumento: tudo que vem depois dele seria engolido como prompt.
  assert.equal(comando[comando.length - 1], 'Mapear o objetivo');
});

test('o sandbox do pedido substitui o padrao, sem mudar o resto do comando', () => {
  const comando = montarComando({
    prompt: 'x',
    nome: 'n',
    cwd: '/tmp',
    sandbox: 'danger-full-access',
  });
  assert.deepEqual(comando.slice(2, 4), ['--sandbox', 'danger-full-access']);
});

test('dry-run monta o comando e nao executa nada', () => {
  const stub = codexFalso('dry-run');
  try {
    const r = despachar({ prompt: 'x', nome: 'ork-dry-full', cwd: stub.dir, dryRun: true, vinculo: { thread: 'ork-fixture', fase: 'GO', promptSha256: createHash('sha256').update('x').digest('hex') } });
    assert.equal(r.ok, true);
    assert.equal(r.sessionId, null);
    assert.equal(r.comando[0], 'codex');
    assert.deepEqual(stub.chamadas(), []);
  } finally {
    stub.restaurar();
  }
});

for (const dryRun of [false, true]) {
  test(`F9 SIMULADO: sem vínculo recusa despacho antes de spawn, dryRun=${dryRun}`, () => {
    const stub = codexFalso('sem-vinculo');
    try {
      const r = despachar({ prompt: 'x', nome: 'ork-sem-vinculo', cwd: stub.dir, dryRun });
      assert.equal(r.ok, false); assert.equal(r.sessionId, null); assert.equal(r.verificada, false);
      assert.match(r.erro ?? '', /runtime.unavailable: despacho Codex exige vínculo/);
      assert.deepEqual(r.comando, []); assert.deepEqual(stub.chamadas(), []);
      assert.equal(r.controlador, undefined);
    } finally { stub.restaurar(); }
  });
}

test('extrairThreadId le o evento thread.started e ignora linha corrompida', () => {
  const saida = [
    '{"type":"turn.started"}',
    '{"type":"thread.started","thread_id":"' + THREAD_ID + '"}',
    '{quebrada',
  ].join('\n');
  assert.equal(extrairThreadId(saida), THREAD_ID);
  assert.equal(extrairThreadId('{"type":"turn.completed"}'), null);
  assert.equal(extrairThreadId(''), null);
});

test('parseRateLimitCodex reusa o reconhecimento generico e soma as frases do plano ChatGPT', () => {
  // Frase generica com epoch: o horario vem do runtime, nao de chute.
  const comEpoch = parseRateLimitCodex('usage limit reached|1757012400');
  assert.equal(comEpoch?.fonte, 'epoch');
  // Frase propria do codex sem horario: sem-horario, com o trecho real.
  const proprio = parseRateLimitCodex("You've hit your usage limit.");
  assert.equal(proprio?.fonte, 'sem-horario');
  // Texto sem nada de limite: null, nunca sinal inventado.
  assert.equal(parseRateLimitCodex('tudo certo por aqui'), null);
});

test('o despacho limpa a credencial paga do ambiente: subscription-only vale no codex', () => {
  const env = ambienteDoDespacho({
    PATH: '/usr/bin',
    OPENAI_API_KEY: 'sk-vazaria-cobranca',
    OPENAI_BASE_URL: 'https://api.openai.com',
    // A higiene de runtime da main nao lista a chave especifica do Codex: o adapter a remove.
    CODEX_API_KEY: 'sk-vazaria-codex',
    ANTHROPIC_API_KEY: 'sk-vazaria-anthropic',
    CODEX_HOME: '/tmp/casa',
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.ok(ENVS_REMOVIDAS_DO_DESPACHO.includes('CODEX_API_KEY'));
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.CODEX_HOME, '/tmp/casa');
});

test('acharRollout varre so os dias recentes do estado do codex', () => {
  const stub = codexFalso('rollout');
  try {
    const dir = path.join(stub.casa, 'sessions', '2026', '09', '06');
    fs.mkdirSync(dir, { recursive: true });
    const arquivo = path.join(dir, `rollout-2026-09-06T01-02-03-${THREAD_ID}.jsonl`);
    fs.writeFileSync(arquivo, '', 'utf8');
    assert.equal(acharRollout(THREAD_ID), arquivo);
    assert.equal(acharRollout('inexistente-0000'), null);
  } finally {
    stub.restaurar();
  }
});

test('I-33: rollouts do perfil moram na casa do perfil; a casa do processo nao os enxerga', () => {
  const stub = codexFalso('rollout-perfil');
  try {
    const casaDoPerfil = path.join(stub.dir, 'conta-x');
    const perfil = { id: 'x', runtime: 'codex' as const, codexHome: casaDoPerfil };
    const dir = path.join(casaDoPerfil, 'sessions', '2026', '09', '19');
    fs.mkdirSync(dir, { recursive: true });
    const arquivo = path.join(dir, `rollout-2026-09-19T01-02-03-${THREAD_ID}.jsonl`);
    fs.writeFileSync(arquivo, JSON.stringify({ type: 'session_meta', payload: { id: THREAD_ID, cwd: stub.dir } }) + '\n', 'utf8');
    assert.equal(casaDoCodex(perfil), casaDoPerfil);
    assert.equal(casaDoCodex(), stub.casa, 'sem perfil, o CODEX_HOME do processo');
    assert.equal(acharRollout(THREAD_ID, 3, casaDoCodex(perfil)), arquivo);
    assert.equal(acharRollout(THREAD_ID), null);
    assert.deepEqual(consultarRollouts(true, casaDoCodex(perfil)).sessoes.map(s => s.sessionId), [THREAD_ID]);
    assert.deepEqual(consultarRollouts(true).sessoes, []);
    assert.equal(ambienteDoDespacho({ CODEX_HOME: stub.casa }, perfil).CODEX_HOME, casaDoPerfil);
  } finally {
    stub.restaurar();
  }
});
