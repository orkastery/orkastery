/**
 * Ensaio isolado de 03/10, defeito 1: `ork adapter install` apontava a extensão para o primeiro `ork`
 * do PATH, e não para o binário que roda o install. Pelo tarball, a extensão 0.5.2 ficou chamando o
 * `ork` 0.4.3 global sem aviso. Aqui o CLI roda com um `ork` falso (0.4.3) primeiro no PATH.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario } from '../src/sandbox';
import { VERSAO_DO_ORK } from '../src/versao';

const CLI = path.resolve(__dirname, '../src/index.js');

function cenario(corpo: (c: { projeto: string; bin: string; falso: string; destino: string }) => void): void {
  const projeto = dirTemporario('ork-em-execucao');
  try {
    const bin = path.join(projeto, 'bin-velho');
    fs.mkdirSync(bin);
    const falso = path.join(bin, 'ork');
    fs.writeFileSync(falso, '#!/bin/sh\necho 0.4.3\n', { mode: 0o755 });
    corpo({ projeto, bin, falso, destino: path.join(projeto, 'oc', 'extensions', 'orkastery') });
  } finally { fs.rmSync(projeto, { recursive: true, force: true }); }
}

function instalar(projeto: string, bin: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [CLI, 'adapter', 'install', 'openclaw', '--dir', path.join(projeto, 'oc'), '--force', ...extra], {
    cwd: projeto, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  assert.equal(r.status, 0, `install saiu com ${r.status}: ${r.stderr}`);
  return r.stdout;
}

const recibo = (destino: string) => JSON.parse(fs.readFileSync(path.join(destino, 'INSTALADO.json'), 'utf8')) as { orkBin: string };

test('adapter install aponta a extensão para o ork em execução, não para o ork do PATH, e avisa as duas versões', () => {
  cenario(({ projeto, bin, falso, destino }) => {
    const saida = instalar(projeto, bin);
    const real = fs.realpathSync(CLI);
    assert.equal(recibo(destino).orkBin, real, 'INSTALADO.json grava o ork que rodou o install');
    const dist = fs.readFileSync(path.join(destino, 'dist', 'index.js'), 'utf8');
    assert.ok(dist.includes(real), 'dist/index.js renderizado com o ork em execução');
    assert.ok(!dist.includes(falso), 'dist/index.js não chama o ork do PATH');
    assert.match(saida, /Aviso: o ork do PATH/);
    assert.ok(saida.includes(`${falso}, 0.4.3`), 'o aviso diz o caminho e a versão do ork do PATH');
    assert.ok(saida.includes(`${real}, ${VERSAO_DO_ORK}`), 'o aviso diz o caminho e a versão do ork em execução');
  });
});

test('adapter install com --ork mantém o override explícito e não avisa', () => {
  cenario(({ projeto, bin, falso, destino }) => {
    const saida = instalar(projeto, bin, '--ork', falso);
    assert.equal(recibo(destino).orkBin, falso);
    assert.doesNotMatch(saida, /Aviso: o ork do PATH/);
  });
});

test('adapter install não avisa quando o ork do PATH é o próprio binário em execução', () => {
  cenario(({ projeto, bin, falso, destino }) => {
    fs.rmSync(falso);
    fs.chmodSync(CLI, 0o755);
    fs.symlinkSync(CLI, falso);
    const saida = instalar(projeto, bin);
    assert.equal(recibo(destino).orkBin, fs.realpathSync(CLI));
    assert.doesNotMatch(saida, /Aviso: o ork do PATH/);
  });
});
