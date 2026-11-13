import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';

const raiz = path.resolve(__dirname, '../../..');

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

function executarHook(script: string, cwd: string, entrada: Record<string, unknown>) {
  return executarArgv(process.execPath, [script], cwd,
    { ...process.env, ORK_NUCLEO_DIR: path.resolve(__dirname, '../src') }, JSON.stringify(entrada));
}

test('Claude Code e Codex consultam o núcleo no SessionStart e só transportam systemMessage', async () => {
  const p = projetoTemporario('rm089-f6-adapters-managed');
  try {
    const casos = [
      { runtime: 'claude-code', manifesto: 'adapters/claude-code/hooks/hooks.json', script: 'adapters/claude-code/hooks/ork-sessao.js' },
      { runtime: 'codex', manifesto: 'adapters/codex/hooks/hooks.json', script: 'adapters/codex/hooks/ork-sessao.js' },
    ];
    for (const caso of casos) {
      const hooks = JSON.parse(fs.readFileSync(path.join(raiz, caso.manifesto), 'utf8'));
      assert.equal(hooks.hooks.SessionStart[0].hooks[0].type, 'command');
      const r = await executarHook(path.join(raiz, caso.script), p.dir, {
        hook_event_name: 'SessionStart', session_id: `sessao-${caso.runtime}`, cwd: p.dir,
      });
      assert.equal(r.codigo, 0);
      assert.equal(r.stderr, '');
      assert.notEqual(r.stdout, '', `${caso.runtime} não transportou a orientação: ${r.stderr}`);
      assert.deepEqual(Object.keys(JSON.parse(r.stdout)), ['systemMessage']);
      assert.match(JSON.parse(r.stdout).systemMessage, /fora de uma thread/);
    }
  } finally { p.limpar(); }
});

test('hook não decide nem bloqueia quando a superfície nativa não está confirmada', async () => {
  const script = path.join(raiz, 'adapters/codex/hooks/ork-sessao.js');
  const r = await executarHook(script, raiz, { hook_event_name: 'SessionStart', session_id: '', cwd: 'relativo' });
  assert.deepEqual(r, { codigo: 0, stdout: '', stderr: '' });
  const fonte = fs.readFileSync(script, 'utf8');
  assert.doesNotMatch(fonte, /decision|permissionDecision/);
});

test('plugin Hermes registra a orientação nos hooks nativos e passa a prova simulada', async () => {
  const r = await executarArgv(process.env.HERMES_TEST_PYTHON ?? 'python3', [
    '-m', 'unittest',
    'adapters/hermes/test/hitl_ingress_test.py',
    'adapters/hermes/test/hitl_native_confirmation_test.py',
  ], raiz, { ...process.env, PYTHONDONTWRITEBYTECODE: '1' });
  assert.equal(r.codigo, 0, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /OK/);
});
