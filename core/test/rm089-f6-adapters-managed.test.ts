import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';

const raiz = path.resolve(__dirname, '../../..');

function ambienteDeterministico(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL|_KEY(?:_|$))/i.test(key)) continue;
    if (key === 'ORK_PROJETO' || key === 'ORK_PROJETO_EXPLICITO') continue;
    env[key] = value;
  }
  return { ...env, CI: 'true', NO_COLOR: '1', ...extra };
}

function executarArgv(comando: string, args: string[], cwd: string, env: NodeJS.ProcessEnv,
  entrada?: string): Promise<{ codigo: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    filho.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    filho.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    filho.on('error', reject);
    filho.on('close', (codigo) => {
      resolve({ codigo, stdout, stderr });
    });
    filho.stdin.end(entrada);
  });
}

function executarHook(script: string, entrada: Record<string, unknown>): Record<string, unknown> | null {
  const anterior = process.env.ORK_NUCLEO_DIR;
  process.env.ORK_NUCLEO_DIR = path.resolve(__dirname, '../src');
  try {
    delete require.cache[require.resolve(script)];
    return (require(script) as { executarComEntrada(input: Record<string, unknown>): Record<string, unknown> | null })
      .executarComEntrada(entrada);
  } finally {
    if (anterior === undefined) delete process.env.ORK_NUCLEO_DIR;
    else process.env.ORK_NUCLEO_DIR = anterior;
  }
}

test('Claude Code e Codex consultam o núcleo no SessionStart e só transportam systemMessage', () => {
  const p = projetoTemporario('rm089-f6-adapters-managed');
  try {
    const casos = [
      { runtime: 'claude-code', manifesto: 'adapters/claude-code/hooks/hooks.json', script: 'adapters/claude-code/hooks/ork-sessao.js' },
      { runtime: 'codex', manifesto: 'adapters/codex/hooks/hooks.json', script: 'adapters/codex/hooks/ork-sessao.js' },
    ];
    for (const caso of casos) {
      const hooks = JSON.parse(fs.readFileSync(path.join(raiz, caso.manifesto), 'utf8'));
      assert.equal(hooks.hooks.SessionStart[0].hooks[0].type, 'command');
      const r = executarHook(path.join(raiz, caso.script), {
        hook_event_name: 'SessionStart', session_id: `sessao-${caso.runtime}`, cwd: p.dir,
      });
      assert.notEqual(r, null, `${caso.runtime} não transportou a orientação`);
      assert.deepEqual(Object.keys(r!), ['systemMessage']);
      assert.match(String(r!.systemMessage), /fora de uma thread/);
      assert.match(String(r!.systemMessage), /node core\/dist\/index\.js thread new/);
      assert.match(String(r!.systemMessage), /node core\/dist\/index\.js adotar/);
    }
  } finally { p.limpar(); }
});

test('hook não decide nem bloqueia quando a superfície nativa não está confirmada', () => {
  const script = path.join(raiz, 'adapters/codex/hooks/ork-sessao.js');
  const r = executarHook(script, { hook_event_name: 'SessionStart', session_id: '', cwd: 'relativo' });
  assert.equal(r, null);
  const fonte = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(fonte, /decision|permissionDecision/);
});

test('plugin Hermes registra a orientação pela API pública simulada sem instalação operacional', async () => {
  const runner = [
    'import os,sys,unittest',
    "sys.path.insert(0,'adapters/hermes/test')",
    'suite=unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:])',
    'result=unittest.TextTestRunner(stream=sys.stdout,verbosity=1).run(suite)',
    'sys.stdout.flush();sys.stderr.flush()',
    'os._exit(0 if result.wasSuccessful() else 1)',
  ].join(';');
  const grupos = [
    [
      'hitl_ingress_test.IngressTest.test_native_hook_only_and_sync_skip',
      'hitl_ingress_test.IngressTest.test_session_start_consults_core_and_first_turn_transports_context',
    ],
    [
      'hitl_session_hooks_simulated_test.SimulatedContractTest.test_session_hooks_transport_core_context',
    ],
  ];
  for (const casos of grupos) {
    const r = await executarArgv(process.env.HERMES_TEST_PYTHON ?? 'python3', ['-I', '-u', '-c', runner, ...casos], raiz,
      ambienteDeterministico({ PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '', PYTHONNOUSERSITE: '1',
        HERMES_HOME: '/tmp/hermes-SIMULADO-ausente' }));
    assert.equal(r.codigo, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /OK/);
  }
});

test('OpenClaw executa a suíte nativa por argv em instalação temporária', async () => {
  const env = ambienteDeterministico();
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST_')) delete env[key];
  const r = await executarArgv(process.execPath,
    ['--test', 'adapters/openclaw/test/sessao-fora-thread.test.mjs'], raiz, env);
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
});

test('a prova gerida usa spawn assíncrono sem shell nem transporte de segredos', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(source, new RegExp(['spawn', 'Sync'].join('')));
  assert.doesNotMatch(source, /shell\s*:\s*true/);
  assert.doesNotMatch(JSON.stringify(ambienteDeterministico()), /(?:TOKEN|SECRET|API_KEY)/);
});
