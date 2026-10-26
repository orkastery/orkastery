/**
 * RM-067 (ork-grokbuild, D16): o conferidor de casos das claims (`core/scripts/conferir-casos.cjs`). Ele roda o
 * `node --test` com TAP num arquivo só e sai 0 apenas com o mínimo de casos do prefixo passando, nenhum caindo e
 * nenhum pulado. Cada caso escreve um arquivo de teste pequeno num diretório temporário e roda o conferidor nele, com o
 * `NODE_TEST_CONTEXT` deste runner no ambiente: é ele que o conferidor precisa tirar do filho.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const RAIZ = path.resolve(__dirname, '../../..');
const CONFERIDOR = path.join(RAIZ, 'core/scripts/conferir-casos.cjs');

function arquivoDeTeste(nome: string, corpo: string): { arquivo: string; limpar: () => void } {
  const dir = dirTemporario(`conferir-${nome}`);
  const arquivo = path.join(dir, `${nome}.test.js`);
  fs.writeFileSync(arquivo, `'use strict';\nconst { test } = require('node:test');\n${corpo}\n`);
  return { arquivo, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function conferir(...args: string[]): { codigo: number | null; saida: string } {
  const r = spawnSync(process.execPath, [CONFERIDOR, ...args], { encoding: 'utf8', timeout: 60000 });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

const DOIS_PASSANDO = "test('XX1: passa', () => {});\ntest('XX2: passa', () => {});";

test('CC1: sai 0 com o minimo de casos do prefixo passando e diz quantos passaram', () => {
  const f = arquivoDeTeste('passa', DOIS_PASSANDO);
  try {
    const r = conferir(f.arquivo, 'XX', '2');
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /2 caso\(s\) XX passaram \(minimo 2\), 0 caindo, 0 pulado\(s\): ok/);
  } finally { f.limpar(); }
});

test('CC2: sai 1 quando faltam casos do prefixo ou quando um caso cai, e lista o que caiu', () => {
  const poucos = arquivoDeTeste('poucos', DOIS_PASSANDO);
  const caindo = arquivoDeTeste('caindo', `${DOIS_PASSANDO}\ntest('XX3: cai', () => { throw new Error('caiu'); });`);
  try {
    const r = conferir(poucos.arquivo, 'XX', '3');
    assert.equal(r.codigo, 1, r.saida);
    assert.match(r.saida, /REPROVADO/);
    const c = conferir(caindo.arquivo, 'XX', '2');
    assert.equal(c.codigo, 1, c.saida);
    assert.match(c.saida, /1 caindo/);
    assert.match(c.saida, /not ok \d+ - XX3: cai/);
  } finally { poucos.limpar(); caindo.limpar(); }
});

test('CC3: sai 1 com caso pulado e 2 com o uso errado', () => {
  const pulado = arquivoDeTeste('pulado', `${DOIS_PASSANDO}\ntest('XX3: pulado', { skip: true }, () => {});`);
  try {
    const r = conferir(pulado.arquivo, 'XX', '2');
    assert.equal(r.codigo, 1, r.saida);
    assert.match(r.saida, /1 pulado\(s\)/);
    assert.equal(conferir(pulado.arquivo, 'xx', '2').codigo, 2, 'prefixo minusculo');
    assert.equal(conferir(pulado.arquivo, 'XX', '0').codigo, 2, 'minimo zero');
    assert.equal(conferir(path.join(path.dirname(pulado.arquivo), 'ausente.test.js'), 'XX', '1').codigo, 2, 'arquivo ausente');
    assert.equal(conferir(pulado.arquivo, 'XX').codigo, 2, 'sem minimo');
  } finally { pulado.limpar(); }
});

test('CC4: o padrao do nome filtra os casos, e o filtro que nao casa nada sai 1', () => {
  const f = arquivoDeTeste('filtro', DOIS_PASSANDO);
  try {
    const um = conferir(f.arquivo, 'XX', '1', '^XX1:');
    assert.equal(um.codigo, 0, um.saida);
    assert.match(um.saida, /1 caso\(s\) XX passaram/);
    const nenhum = conferir(f.arquivo, 'XX', '1', '^XX9:');
    assert.equal(nenhum.codigo, 1, nenhum.saida);
    assert.match(nenhum.saida, /0 caso\(s\) XX passaram/);
  } finally { f.limpar(); }
});
