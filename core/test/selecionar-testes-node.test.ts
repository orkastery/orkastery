/** RM-074 M10: seletor conservador do `node --test`. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { planejarSelecaoNode, testeSobeProcesso } from '../src/seletor-node-test';

function fixture(nome: string, arquivos: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ork-m10-${nome}-`));
  const distTest = path.join(dir, 'dist-test');
  for (const [relativo, conteudo] of Object.entries(arquivos)) {
    const destino = path.join(distTest, relativo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
  }
  return { distTest, limpar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('RM074 M10 S1: fecho estatico simples e transitivo seleciona o teste relacionado', () => {
  const f = fixture('fecho', {
    'test/a.test.js': "require('../src/a');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/a.js': "require('./base');\n",
    'src/base.js': 'module.exports = true;\n',
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    assert.deepEqual(planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/a.ts']).arquivos, ['a.test.js']);
    assert.deepEqual(planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/base.ts']).arquivos,
      ['a.test.js'], 'o fecho transitivo chega ao modulo base');
    assert.deepEqual(planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/test/b.test.ts']).arquivos,
      ['b.test.js'], 'o proprio teste compilado participa do fecho');
  } finally { f.limpar(); }
});

test('RM074 M10 S2: teste que sobe processo filho fica sempre na selecao', () => {
  const f = fixture('processo', {
    'test/relacionado.test.js': "require('../src/alvo');\n",
    'test/processo.test.js': "const { spawn } = require('node:child_process'); spawn('node');\n",
    'test/fora.test.js': "require('../src/fora');\n",
    'src/alvo.js': 'module.exports = true;\n',
    'src/fora.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest,
      ['fora.test.js', 'processo.test.js', 'relacionado.test.js'], ['core/src/alvo.ts']);
    assert.deepEqual(plano, { modo: 'selecionada', motivo: 'selecionada',
      arquivos: ['processo.test.js', 'relacionado.test.js'], alterados: ['core/src/alvo.ts'] });
    assert.equal(testeSobeProcesso("require('../../scripts/auxiliar.cjs')"), true);
    assert.equal(testeSobeProcesso("const cli = 'dist/index.js'"), true);
  } finally { f.limpar(); }
});

test('RM074 M10 S3: require dinamico derruba a lane inteira', () => {
  const f = fixture('dinamico', {
    'test/a.test.js': "const nome = '../src/a'; require(nome);\n",
    'test/b.test.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/a.ts']);
    assert.equal(plano.modo, 'inteira');
    assert.equal(plano.motivo, 'require-dinamico');
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.ambiguidade, { arquivo: 'core/test/a.test.ts', pedido: 'nome' });
  } finally { f.limpar(); }
});

test('RM074 M10 S4: caminho local nao resolvido derruba a lane inteira', () => {
  const f = fixture('nao-resolvido', {
    'test/a.test.js': "require('../src/sumiu');\n",
    'test/b.test.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/a.ts']);
    assert.equal(plano.modo, 'inteira');
    assert.equal(plano.motivo, 'caminho-nao-resolvido');
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S5: mudanca fora do mapeamento e diff vazio conservam a lane inteira', () => {
  const f = fixture('quedas', { 'test/a.test.js': 'module.exports = true;\n' });
  try {
    assert.deepEqual(planejarSelecaoNode(f.distTest, ['a.test.js'], []).modo, 'inteira');
    assert.equal(planejarSelecaoNode(f.distTest, ['a.test.js'], []).motivo, 'sem-mudancas');
    assert.equal(planejarSelecaoNode(f.distTest, ['a.test.js'], ['package.json']).motivo, 'fora-do-mapeamento');
    assert.equal(planejarSelecaoNode(f.distTest, ['a.test.js'], ['core/scripts/x.cjs']).motivo, 'fora-do-mapeamento');
  } finally { f.limpar(); }
});
