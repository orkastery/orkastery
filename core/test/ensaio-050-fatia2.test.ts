/**
 * Fatia 2 do ensaio de primeira experiencia da 0.5.0 (thread ork-ensaiofatia2): os achados P1 a P3 e
 * P5 a P9 e os registros R2, R3, R5 e R7 do relatorio da ork-ensaioprimei. Os nomes comecam por
 * "fatia 2 <ID>:" para que cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente; nenhum teste depende de `claude`,
 * `codex`, horario ou fuso de quem roda.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec, noPath } from '../src/util';
import { dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PATH_ATUAL = process.env.PATH ?? '/usr/bin:/bin';

/** A CLI do HEAD, com HOME proprio e so o PATH pedido e LANG no ambiente. */
function ork(dir: string, casa: string, caminho: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: caminho, LANG: 'C.UTF-8' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('fatia 2 R3: noPath acha o binario sem o which', () => {
  const bin = dirTemporario('fatia2-path');
  const casa = dirTemporario('fatia2-path-casa');
  const p = projetoTemporario('fatia2-path-projeto');
  try {
    const exe = path.join(bin, 'ferramenta-da-fatia2');
    fs.writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'sem-execucao'), 'texto\n', { mode: 0o644 });
    // So este diretorio no PATH: o `which` nao existe aqui, e a busca e do proprio processo.
    assert.equal(noPath('ferramenta-da-fatia2', { PATH: bin }), exe);
    assert.equal(noPath('sem-execucao', { PATH: bin }), null, 'arquivo sem bit de execucao');
    assert.equal(noPath('nao-existe', { PATH: bin }), null);
    assert.equal(noPath('ferramenta-da-fatia2', { PATH: `${path.delimiter}${bin}` }), exe, 'entrada vazia do PATH e pulada');
    assert.equal(noPath(exe, { PATH: '' }), exe, 'nome com barra e conferido direto');

    // O sintoma do ensaio: com o git no PATH e sem o `which`, o doctor dizia que o git faltava.
    const git = noPath('git', { PATH: PATH_ATUAL });
    assert.ok(git, 'git no PATH de quem roda');
    fs.symlinkSync(path.resolve(git), path.join(bin, 'git'));
    const r = ork(p.dir, casa, bin, 'doctor');
    assert.match(r.stdout, /^ {2}\[ok\] {3}git {2,}\S*git$/m, r.stdout);
    assert.doesNotMatch(r.stdout, /nao encontrado no PATH/);
    assert.equal(exec('git', ['--version'], p.dir, 10000, { PATH: bin }).ok, true);
  } finally { p.limpar(); limpar(bin, casa); }
});
