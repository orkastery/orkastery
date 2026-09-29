import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';

test('CLI conta, adota, prova limpeza e denuncia indisponibilidade no doctor', () => {
  const p = projetoTemporario('sessoes-cli');
  const cli = path.resolve(__dirname, '../../dist/index.js');
  const id = 'aaaaaaaa-1111-2222-3333-444444444444';
  try {
    const env = { ...process.env, PATH: `${p.dir}:${process.env.PATH}`, CODEX_HOME: p.dir };
    fs.mkdirSync(path.join(p.dir, 'sessions'));
    fs.writeFileSync(path.join(p.dir, 'claude'), `#!${process.execPath}
if(process.argv.includes('agents'))console.log(JSON.stringify([{sessionId:'${id}',cwd:${JSON.stringify(p.dir)}}]));
else console.log('fixture');
`, { mode: 0o755 });
    fs.writeFileSync(path.join(p.dir, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: p.dir, env, encoding: 'utf8' });
    const sujo = run('sessions', '--global', '--all', '--json', '--exigir-limpo');
    assert.equal(sujo.status, 1);
    assert.equal(JSON.parse(sujo.stdout).semThread, 1);
    assert.match(run('doctor').stdout, /1 sem thread/);
    const adotada = run('sessions', 'adopt', id, '--json');
    assert.equal(adotada.status, 0, adotada.stderr);
    assert.equal(JSON.parse(adotada.stdout).criada, true);
    assert.equal(JSON.parse(run('sessions', 'adopt', id, '--json').stdout).criada, false);
    const limpo = run('sessions', '--global', '--all', '--json', '--exigir-limpo');
    assert.equal(limpo.status, 0, limpo.stderr);
    assert.equal(JSON.parse(limpo.stdout).semThread, 0);
    assert.equal(JSON.parse(limpo.stdout).total, 1);
    assert.match(run('doctor').stdout, /0 sem thread.*inventário válido/);
    fs.writeFileSync(path.join(p.dir, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    assert.equal(run('sessions', '--global', '--all', '--json').status, 1);
    assert.match(run('doctor').stdout, /INCOMPLETO \(zero não comprovado\)/);
    assert.equal(run('sessions', 'adopt', id).status, 1);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// RM-037 (defeitosdeco D-2): `ork sessions stop <id>` respondia "nao encontrada no runtime" para a
// sessao de um perfil de conta que nao e o padrao: o `claude agents` so a lista com o
// `CLAUDE_CONFIG_DIR` da conta que a despachou, e o stop consultava so o ambiente do processo.
// ---------------------------------------------------------------------------
import { runtimePorConta } from './apoio';

test('defeitosdeco D-2: sessions stop, logs e attach acham a sessao no perfil que a despachou e agem com o env dele', () => {
  const p = projetoTemporario('sessoes-perfil');
  const claude = runtimePorConta('sessoes-perfil');
  const cli = path.resolve(__dirname, '../../dist/index.js');
  try {
    const contaA = claude.conta(p.dir, 'a');
    claude.conta(p.dir, 'b');
    // A sessao nasce na conta `a`, como um despacho com o perfil `a`.
    const bg = spawnSync(path.join(claude.dir, 'claude'), ['--bg', 'fase', '--name', 'ork-x-go'], { cwd: p.dir,
      env: { ...process.env, CLAUDE_CONFIG_DIR: contaA }, encoding: 'utf8' });
    assert.equal(bg.status, 0, bg.stderr);
    const sessao = /Background agent started: (\S+)/.exec(bg.stdout)![1];
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: p.dir, env: process.env, encoding: 'utf8' });
    // O processo `ork` roda noutra conta (a do processo), onde a sessao nao aparece.
    assert.notEqual(process.env.CLAUDE_CONFIG_DIR, contaA);

    const parada = run('sessions', 'stop', sessao.slice(0, 8));
    assert.equal(parada.status, 0, parada.stdout + parada.stderr);
    assert.match(parada.stdout, new RegExp(`sessao ${sessao} parada \\(perfil a\\)`));
    assert.ok(claude.envs().includes(`stop ${contaA}`), `o claude stop rodou com o CLAUDE_CONFIG_DIR do perfil: ${claude.envs().join(' | ')}`);

    const antes = claude.envs().length;
    const logs = run('sessions', 'logs', sessao);
    assert.equal(logs.status, 0, logs.stdout + logs.stderr);
    assert.ok(claude.envs().includes(`logs ${contaA}`));
    // GO-FIX (R5a): com o UUID completo, a busca para na conta que achou; b nao e consultada.
    assert.deepEqual(claude.envs().slice(antes).filter(l => l.startsWith('agents ')).map(l => l.slice(7)),
      [process.env.CLAUDE_CONFIG_DIR, contaA]);

    const attach = run('sessions', 'attach', sessao);
    assert.equal(attach.status, 0, attach.stdout + attach.stderr);
    assert.equal(attach.stdout.trim(), `CLAUDE_CONFIG_DIR=${contaA} claude attach ${sessao}`);

    // Ausente em todas as contas: a mensagem e o codigo de antes.
    const ausente = run('sessions', 'stop', 'ffffffff');
    assert.equal(ausente.status, 1);
    assert.match(ausente.stdout, /sessao "ffffffff" nao encontrada no runtime/);
  } finally { claude.restaurar(); p.limpar(); }
});
