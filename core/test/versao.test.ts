/** A versao do `ork` tem uma fonte so: o package.json que viaja com o pacote. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NOME_DO_PACOTE, VERSAO_DO_ORK } from '../src/versao';

const PACOTE = path.resolve(__dirname, '../../package.json');
const CLI = path.resolve(__dirname, '../../dist/index.js');

test('a versao do ork e a do package.json, e ork --version imprime so ela', () => {
  const pacote = JSON.parse(fs.readFileSync(PACOTE, 'utf8')) as { name: string; version: string };
  assert.equal(pacote.name, NOME_DO_PACOTE);
  assert.equal(VERSAO_DO_ORK, pacote.version);
  assert.match(VERSAO_DO_ORK, /^\d+\.\d+\.\d+/);
  for (const argumento of ['--version', 'version']) {
    const r = spawnSync(process.execPath, [CLI, argumento], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), pacote.version, `ork ${argumento}`);
  }
});

test('o adaptador OpenClaw anda na mesma versao do pacote', () => {
  const raiz = path.resolve(__dirname, '../../..');
  for (const arquivo of ['adapters/openclaw/package.json', 'adapters/openclaw/openclaw.plugin.json']) {
    const versao = (JSON.parse(fs.readFileSync(path.join(raiz, arquivo), 'utf8')) as { version: string }).version;
    assert.equal(versao, VERSAO_DO_ORK, arquivo);
  }
});
