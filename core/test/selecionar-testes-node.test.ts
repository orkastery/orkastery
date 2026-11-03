/** RM-074 M10: seletor conservador do `node --test`. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { planejarSelecaoNode, testeSobeProcesso } from '../src/seletor-node-test';

const CORE = path.resolve(__dirname, '../..');

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
    assert.equal(plano.modo, 'selecionada');
    assert.deepEqual(plano.arquivos, ['processo.test.js', 'relacionado.test.js']);
    assert.deepEqual(plano.sempre?.processoFilho, ['processo.test.js']);
    assert.equal(testeSobeProcesso("require('../../scripts/auxiliar.cjs')"), true);
    assert.equal(testeSobeProcesso("const cli = 'dist/index.js'"), true);
  } finally { f.limpar(); }
});

test('RM074 M10 S3: require dinamico prende somente o teste incerto', () => {
  const f = fixture('dinamico', {
    'test/a.test.js': "const nome = '../src/a'; require(nome);\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.equal(plano.modo, 'selecionada');
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S4: caminho local nao resolvido prende somente o teste incerto', () => {
  const f = fixture('nao-resolvido', {
    'test/a.test.js': "require('../src/sumiu');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.equal(plano.modo, 'selecionada');
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js']);
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

test('RM074 M10 S6: leitura textual de fonte TypeScript vira aresta resolvida', () => {
  const f = fixture('fonte-ts', {
    'test/a.test.js': "const fs = require('node:fs'); const path = require('node:path');\n" +
      "const FONTE = path.resolve(__dirname, '../../src', 'verify-sandbox.ts'); fs.readFileSync(FONTE, 'utf8');\n",
    'test/b.test.js': 'module.exports = true;\n',
    '../src/verify-sandbox.ts': 'export const frase = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/verify-sandbox.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, []);
  } finally { f.limpar(); }
});

test('RM074 M10 S7: JSON lido por fs vira aresta resolvida', () => {
  const f = fixture('json-fs', {
    'test/a.test.js': "const fs = require('node:fs'); const path = require('node:path');\n" +
      "fs.readFile(path.join(__dirname, 'fixtures', 'dados.json'), () => {});\n",
    'test/b.test.js': 'module.exports = true;\n',
    'test/fixtures/dados.json': '{"ok":true}\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/test/fixtures/dados.json']);
    assert.deepEqual(plano.arquivos, ['a.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, []);
  } finally { f.limpar(); }
});

test('RM074 M10 S8: require.resolve seguido de leitura vira aresta resolvida', () => {
  const f = fixture('require-resolve', {
    'test/a.test.js': "const fs = require('node:fs'); const ALVO = require.resolve('../src/dados.json'); fs.readFileSync(ALVO);\n",
    'test/b.test.js': 'module.exports = true;\n',
    'src/dados.json': '{"ok":true}\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/dados.json']);
    assert.deepEqual(plano.arquivos, ['a.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, []);
    assert.deepEqual(planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/fora.ts']).arquivos, []);
  } finally { f.limpar(); }
});

test('RM074 M10 S9: caminho de fs nao resolvido prende somente o teste incerto', () => {
  const f = fixture('fs-incerto', {
    'test/a.test.js': "const fs = require('node:fs'); fs.existsSync(process.env.ALVO);\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S10: a lane hermetica compilada seleciona subconjunto estrito para horario', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lanes = require(path.join(CORE, 'scripts', 'test-lanes.cjs')) as { listasDasLanes: () => { hermetica: string[] } };
  const arquivos = lanes.listasDasLanes().hermetica;
  const plano = planejarSelecaoNode(path.join(CORE, 'dist-test'), arquivos, ['core/src/horario.ts']);
  assert.equal(plano.modo, 'selecionada');
  assert.ok(plano.arquivos.length > 0, 'ao menos o teste relacionado ou conservador roda');
  assert.ok(plano.arquivos.length < arquivos.length, `${plano.arquivos.length} de ${arquivos.length} precisam ser subconjunto estrito`);
});

test('RM074 M10 S11: enumeracao de diretorio prende somente o teste incerto', () => {
  const f = fixture('enumera-diretorio', {
    'test/a.test.js': "const fs = require('node:fs'); fs.readdirSync(__dirname);\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S12: glob nativo ou de pacote prende somente o teste incerto', () => {
  const f = fixture('glob', {
    'test/a.test.js': "const fs = require('node:fs'); fs.globSync('**/*.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'test/c.test.js': "const { glob } = require('glob'); glob('**/*.json');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js', 'c.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js', 'c.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js', 'c.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S13: importacao construida prende somente o teste incerto', () => {
  const f = fixture('codigo-construido', {
    'test/a.test.js': "const importar = new Function('u', 'return import(u)'); importar('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S14: outras leituras nao modeladas e codigo avaliado prendem seus testes', () => {
  const f = fixture('fallback-conservador', {
    'test/a.test.js': "const fs = require('node:fs'); fs.readdir(__dirname, () => {}); fs.opendirSync(__dirname);\n",
    'test/b.test.js': "require('../src/b');\n",
    'test/c.test.js': "const fsp = require('node:fs/promises'); fsp.readdir(__dirname);\n",
    'test/d.test.js': "const { createReadStream } = require('node:fs'); createReadStream(__filename);\n",
    'test/e.test.js': "const vm = require('node:vm'); new vm.Script('module.exports = true');\n",
    'test/f.test.js': "eval('module.exports = true');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const arquivos = ['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js', 'e.test.js', 'f.test.js'];
    const plano = planejarSelecaoNode(f.distTest, arquivos, ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, arquivos);
    assert.deepEqual(plano.sempre?.dependenciaIncerta,
      ['a.test.js', 'c.test.js', 'd.test.js', 'e.test.js', 'f.test.js']);
  } finally { f.limpar(); }
});

test('RM074 M10 S15: alias de require prende o teste e explica arquivo e linha', () => {
  const f = fixture('alias-require', {
    'test/a.test.js': "const carregar = require;\ncarregar('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, ['a.test.js']);
    assert.deepEqual(plano.incertezas, [{
      testes: ['a.test.js'], arquivo: 'core/test/a.test.ts', linha: 1,
      forma: 'uso de require fora de chamada direta',
    }]);
  } finally { f.limpar(); }
});

test('RM074 M10 S16: module.require prende o teste', () => {
  const f = fixture('module-require', {
    'test/a.test.js': "require('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/a.js': "module.require('./oculto.js');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.arquivo === 'core/src/a.ts'
      && causa.forma === 'module.require'));
  } finally { f.limpar(); }
});

test('RM074 M10 S17: createRequire prende o teste', () => {
  const f = fixture('create-require', {
    'test/a.test.js': "createRequire(__filename)('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'createRequire'));
  } finally { f.limpar(); }
});

test('RM074 M10 S18: process.getBuiltinModule prende o teste', () => {
  const f = fixture('builtin-module', {
    'test/a.test.js': "process.getBuiltinModule('fs').readdirSync(__dirname);\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'process.getBuiltinModule'));
  } finally { f.limpar(); }
});

test('RM074 M10 S19: Worker prende o teste', () => {
  const f = fixture('worker', {
    'test/a.test.js': "new Worker('../src/worker.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'construtor Worker'));
  } finally { f.limpar(); }
});

test('RM074 M10 S20: acesso computado em globalThis prende o teste', () => {
  const f = fixture('global-computado', {
    'test/a.test.js': "globalThis['req' + 'uire']('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'acesso computado em objeto sensível'));
  } finally { f.limpar(); }
});

test('RM074 M10 S21: modulo nativo fora da lista curta prende o teste', () => {
  const f = fixture('nativo-fora-lista', {
    'test/a.test.js': "require('node:querystring');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'módulo fora da lista segura: node:querystring'));
  } finally { f.limpar(); }
});

test('RM074 M10 S22: fecho formado somente por formas seguras continua selecionavel', () => {
  const f = fixture('fecho-seguro', {
    'test/a.test.js': "const path = require('node:path'); const assert = require('node:assert');\n" +
      "const ALVO = path.join(__dirname, '..', 'src', 'a.js'); require(ALVO); assert.ok(true);\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/a.js': "const fs = require('node:fs'); const path = require('node:path');\n" +
      "fs.existsSync(path.join(__dirname, 'fixture.json')); module.exports = true;\n",
    'src/fixture.json': '{"ok":true}\n',
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/a.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, []);
    assert.deepEqual(plano.incertezas, []);
  } finally { f.limpar(); }
});

test('RM074 M10 S23: Reflect com fs prende o teste pela posicao da capacidade', () => {
  const f = fixture('reflect-fs', {
    'test/a.test.js': "const read = Reflect.get(require('node:fs'), 'readFileSync'); read('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.arquivo === 'core/test/a.test.ts'
      && causa.forma === 'capacidade em posição não segura: Reflect'));
  } finally { f.limpar(); }
});

test('RM074 M10 S24: Proxy de fs prende o teste pela posicao da capacidade', () => {
  const f = fixture('proxy-fs', {
    'test/a.test.js': "const io = new Proxy(require('node:fs'), {}); io.readFileSync('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'capacidade em posição não segura: Proxy'));
  } finally { f.limpar(); }
});

test('RM074 M10 S25: getter que devolve fs prende o teste', () => {
  const f = fixture('getter-fs', {
    'test/a.test.js': "const box = { get io() { return require('node:fs'); } }; box.io.readFileSync('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'capacidade de node:fs fora de importação segura'));
  } finally { f.limpar(); }
});

test('RM074 M10 S26: rest destructuring de fs prende o teste', () => {
  const f = fixture('rest-fs', {
    'test/a.test.js': "const { ...io } = require('node:fs'); io.readFileSync('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma.includes('desestruturado')));
  } finally { f.limpar(); }
});

test('RM074 M10 S27: alias de fs por atribuicao prende o teste', () => {
  const f = fixture('atribuicao-fs', {
    'test/a.test.js': "let io; io = require('node:fs'); io.readFileSync('../src/a.js');\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'capacidade de node:fs em posição não segura'));
  } finally { f.limpar(); }
});

test('RM074 M10 S28: capacidade em posicao nao catalogada prende pela regra geral', () => {
  const f = fixture('capacidade-geral', {
    'test/a.test.js': "function inspecionar(require) { with ({}) { return { WebAssembly, arguments, require }; } }\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'capacidade em posição não segura: WebAssembly'));
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'capacidade em posição não segura: with'));
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'sombreamento de capacidade: require'));
  } finally { f.limpar(); }
});

test('RM074 M10 S29: arquivo que o parser nao le por inteiro prende o teste', () => {
  const f = fixture('sintaxe-incompleta', {
    'test/a.test.js': 'function quebrada( {\n',
    'test/b.test.js': "require('../src/b');\n",
    'src/b.js': 'module.exports = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/b.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js', 'b.test.js']);
    assert.ok(plano.incertezas?.some((causa) => causa.forma === 'arquivo não analisado por inteiro: erro de sintaxe'));
  } finally { f.limpar(); }
});

test('RM074 M10 S30: interoperabilidade TypeScript e posicoes seguras continuam selecionaveis', () => {
  const f = fixture('interop-segura', {
    'test/a.test.js': "var __importStar = (this && this.__importStar) || ((mod) => mod);\n" +
      "var __importDefault = (this && this.__importDefault) || ((mod) => ({ default: mod }));\n" +
      "var __createBinding = (this && this.__createBinding) || (() => {});\n" +
      "var __setModuleDefault = (this && this.__setModuleDefault) || (() => {});\n" +
      "const fs = __importStar(require('node:fs')); const fsDefault = __importDefault(require('node:fs'));\n" +
      "const path = require('node:path'); const ALVO = path.join(__dirname, '..', 'src', 'a.js');\n" +
      "__createBinding({}, require('node:fs'), 'readFileSync'); __setModuleDefault({}, require('node:fs'));\n" +
      "fs.readFileSync(ALVO); fsDefault.default.statSync(ALVO); process.platform; process.env.CI;\n" +
      "Object.defineProperty(exports, 'seguro', { value: true });\n",
    'test/b.test.js': "require('../src/b');\n",
    'src/a.js': 'module.exports.valor = true;\n',
    'src/b.js': 'exports.valor = true;\n',
  });
  try {
    const plano = planejarSelecaoNode(f.distTest, ['a.test.js', 'b.test.js'], ['core/src/a.ts']);
    assert.deepEqual(plano.arquivos, ['a.test.js']);
    assert.deepEqual(plano.sempre?.dependenciaIncerta, []);
    assert.deepEqual(plano.incertezas, []);
  } finally { f.limpar(); }
});
