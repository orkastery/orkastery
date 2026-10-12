import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENVS_DE_PROVIDER_PAGO } from '../src/runtime-ambiente';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { lerLedger } from '../src/ledger';

test('entrada da fábrica limpa credenciais passivas e preserva bloqueios antes da limpeza', () => {
  const p = projetoTemporario('fabrica-higiene');
  try {
    const cli = path.resolve(__dirname, '../../dist/index.js');
    // O texto do doctor conferido aqui e o pt-BR: o locale fica fixo, sem herdar o LANG de quem roda (CLI por locale).
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${p.dir}:${process.env.PATH}`, CODEX_HOME: p.dir, LANG: 'C.UTF-8', LC_ALL: '', LC_MESSAGES: '' };
    for (const nome of ENVS_DE_PROVIDER_PAGO) delete env[nome];
    env.OPENROUTER_API_KEY = 'fixture-nao-imprimir';
    env.OPENAI_API_KEY = 'fixture-nao-imprimir';
    fs.mkdirSync(path.join(p.dir, 'sessions'));
    fs.writeFileSync(path.join(p.dir, 'claude'), '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
    const codigo = `const {main}=require(${JSON.stringify(cli)});
const rc=main(['sessions','--global','--all','--json']);
console.log(JSON.stringify({rc,recebidas:${JSON.stringify(ENVS_DE_PROVIDER_PAGO)}.filter(n=>n in process.env)}));`;
    const limpa = spawnSync(process.execPath, ['-e', codigo], { cwd: p.dir, env, encoding: 'utf8' });
    assert.equal(limpa.status, 0, limpa.stderr);
    assert.deepEqual(JSON.parse(limpa.stdout.trim().split('\n').at(-1)!), { rc: 0, recebidas: [] });
    assert.ok(!limpa.stdout.includes('fixture-nao-imprimir'));
    const thread = novaThread(p.carregado, { nome: 'provider', modo: 'auto' }).thread;
    for (const nome of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
      const bloqueada = spawnSync(process.execPath, [cli, 'phase', 'run', thread.id, 'GO', '--dry-run', '--prompt', 'fixture'], {
        cwd: p.dir, env: { ...env, [nome]: 'fixture-nao-imprimir' }, encoding: 'utf8',
      });
      assert.equal(bloqueada.status, 1);
      assert.match(bloqueada.stderr, /cost.violation/);
      assert.ok(bloqueada.stderr.includes(nome));
      assert.ok(!(bloqueada.stdout + bloqueada.stderr).includes('fixture-nao-imprimir'));
      assert.ok(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'gate_blocked' && e.motivo === 'cost.violation'));
      for (const args of [['sessions'], ['board'], ['phase', 'list', thread.id]]) {
        const leitura = spawnSync(process.execPath, [cli, ...args], {
          cwd: p.dir, env: { ...env, [nome]: 'fixture-nao-imprimir' }, encoding: 'utf8',
        });
        assert.equal(leitura.status, 0, leitura.stderr);
        assert.ok(!(leitura.stdout + leitura.stderr).includes('fixture-nao-imprimir'));
      }
    }
    fs.writeFileSync(path.join(p.dir, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const diagnostico = spawnSync(process.execPath, [cli, 'doctor'], { cwd: p.dir, env, encoding: 'utf8' });
    assert.match(diagnostico.stdout, /custo e provider herdado.*OPENROUTER_API_KEY/);
    assert.match(diagnostico.stdout, /\[ok\]\s+provider efetivo da fabrica\s+nenhum nome/);
    assert.ok(!diagnostico.stdout.includes('fixture-nao-imprimir'));
    const bloqueado = spawnSync(process.execPath, [cli, 'doctor'], {
      cwd: p.dir, env: { ...env, ANTHROPIC_BASE_URL: 'fixture-nao-imprimir' }, encoding: 'utf8',
    });
    assert.equal(bloqueado.status, 1);
    assert.match(bloqueado.stdout, /ork doctor:/);
    assert.match(bloqueado.stdout, /\[FAIL\].*custo e provider herdado/);
  } finally { p.limpar(); }
});
