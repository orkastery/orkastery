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
