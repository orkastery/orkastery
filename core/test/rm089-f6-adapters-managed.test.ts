import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';

const raiz = path.resolve(__dirname, '../../..');

function executarHook(script: string, cwd: string, entrada: Record<string, unknown>): Promise<{ codigo: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [script], {
      cwd,
      env: { ...process.env, ORK_NUCLEO_DIR: path.resolve(__dirname, '../src') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    filho.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    filho.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    filho.on('error', reject);
    filho.on('close', (codigo) => {
      resolve({ codigo, stdout, stderr });
    });
    filho.stdin.end(JSON.stringify(entrada));
  });
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
