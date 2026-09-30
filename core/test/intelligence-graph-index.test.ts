/**
 * RM-031 KG3: analisadores no nucleo, indice persistente e o `ork grafo`.
 *
 * Grupos: "KG3 parsers" (D1: o compilador, o micromark e o juiz de sintaxe vem da instalacao do
 * `ork`, com as versoes do KG2). Os repositorios sao sinteticos, em Git temporario.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';
import { extrairGrafo, type EntradaDeExtracao } from '../src/intelligence-graph-extract';
import { carregarAnalisadores, criarJuizDeSintaxe, PACOTES_DOS_ANALISADORES, versoesDosAnalisadores } from '../src/intelligence-graph-parsers';
import { dirTemporario } from './apoio';

const MODULO_DOS_ANALISADORES = path.resolve(__dirname, '../src/intelligence-graph-parsers.js');

/** Roda um trecho num Node filho, com o cwd dado, e devolve o JSON que ele imprime. */
function noFilho(cwd: string, corpo: string, env: NodeJS.ProcessEnv = {}): { status: number | null; saida: unknown; erro: string } {
  const r = spawnSync(process.execPath, ['-e', corpo], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 120_000 });
  let saida: unknown = null;
  try {
    saida = JSON.parse(r.stdout);
  } catch {
    saida = r.stdout;
  }
  return { status: r.status, saida, erro: r.stderr };
}

test('KG3 parsers: versoes no formato do KG2, iguais as do modulo carregado e as dos extratores', () => {
  const v = versoesDosAnalisadores();
  const p = carregarAnalisadores();
  assert.equal(v.typescript, ts.version);
  assert.equal(p.ts.version, ts.version);
  assert.equal(v.javascript, `node.${process.versions.node}`);
  assert.equal(p.javascript.versao, v.javascript);
  assert.match(v.markdown, /^micromark\.[0-9]+\.[0-9]+\.[0-9]+\.gfm-table\.[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(p.markdown.versao, v.markdown);
  assert.equal(p.unicode, String(process.versions.unicode));
  assert.equal(v.unicode, p.unicode);
  const entrada: EntradaDeExtracao = {
    tenant_id: 'teste', repository_id: 'repo-teste', revision: null, revision_unavailable_reason: 'repositorio-sintetico',
    acl_refs: ['repo:repo-teste:leitura'],
    fontes: [{ path: 'a.ts', bytes: Buffer.from('export const a = 1;\n') }, { path: 'x.md', bytes: Buffer.from('# X\n') }],
  };
  const versoes = new Map(extrairGrafo(entrada, p).grafo.snapshot.extractors.map((e) => [e.extractor_id, e.extractor_version]));
  assert.equal(versoes.get('ork.ts-ast'), `1.0.0+typescript.${v.typescript}+${v.javascript}`);
  assert.equal(versoes.get('ork.md-structure'), `1.0.0+${v.markdown}+unicode.${v.unicode}`);
});

test('KG3 parsers: micromark com a tabela GFM e o decodificador de referencia do proprio micromark', () => {
  const { markdown } = carregarAnalisadores();
  const tipos = new Set(markdown.analisar('# Titulo\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n').filter((e) => e.entrada).map((e) => e.tipo));
  for (const t of ['atxHeading', 'table', 'tableRow', 'tableData', 'tableDelimiterRow']) assert.ok(tipos.has(t), t);
  const evento = markdown.analisar('é# x').find((e) => e.entrada && e.tipo === 'paragraph');
  assert.deepEqual([evento?.inicio, evento?.fim], [0, 4], 'offset em unidades UTF-16 do texto');
  assert.equal(markdown.referencia('eacute'), 'é');
  assert.equal(markdown.referencia('#233'), 'é');
  assert.equal(markdown.referencia('#xE9'), 'é');
  assert.equal(markdown.referencia('#x0'), '�');
  assert.equal(markdown.referencia('naoexiste'), null);
});

test('KG3 parsers: juiz de sintaxe do V8 decide CommonJS e ESM sem executar o codigo', () => {
  const dir = dirTemporario('kg3-juiz');
  try {
    const canario = (n: string) => path.join(dir, `canario-${n}`);
    const juiz = criarJuizDeSintaxe();
    assert.equal(juiz.versao, `node.${process.versions.node}`);
    const pedidos = [
      { texto: `require('node:fs').writeFileSync(${JSON.stringify(canario('cjs'))}, 'x');\n`, formato: 'cjs' as const },
      { texto: `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(canario('esm'))}, 'x');\n`, formato: 'esm' as const },
      { texto: `await import('node:fs').then((f) => f.writeFileSync(${JSON.stringify(canario('await'))}, 'x'));\n`, formato: 'esm' as const },
      { texto: `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(canario('hashbang'))}, 'x');\n`, formato: 'cjs' as const },
      { texto: "import x from './x';\n", formato: 'cjs' as const },
      { texto: 'return 1;\n', formato: 'esm' as const },
      { texto: 'return 1;\n', formato: 'cjs' as const },
      { texto: 'let a; let a;\n', formato: 'esm' as const },
    ];
    assert.deepEqual(juiz.sintaxe(pedidos), [true, true, true, true, false, false, true, false]);
    for (const n of ['cjs', 'esm', 'await', 'hashbang']) assert.ok(!fs.existsSync(canario(n)), `o juiz executou ${n}`);
    // Mesmo texto e formato: o veredito vem do cache, sem outro filho.
    assert.deepEqual(juiz.sintaxe([pedidos[1], pedidos[5]]), [true, false]);
    // O filho roda sem ambiente: um NODE_OPTIONS hostil de quem chama nao carrega codigo nele.
    const preload = path.join(dir, 'preload.js');
    fs.writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(canario('preload'))}, 'x');\n`);
    const antes = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--require ${preload}`;
    try {
      assert.deepEqual(criarJuizDeSintaxe().sintaxe([{ texto: 'export const b = 2;\n', formato: 'esm' }]), [true]);
    } finally {
      if (antes === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = antes;
    }
    assert.ok(!fs.existsSync(canario('preload')), 'o filho herdou o NODE_OPTIONS');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 parsers: typescript falso no repositorio analisado e no diretorio atual nao e carregado', () => {
  const dir = dirTemporario('kg3-ts-falso');
  try {
    const canario = path.join(dir, 'canario');
    for (const pacote of ['typescript', 'micromark']) {
      fs.mkdirSync(path.join(dir, 'node_modules', pacote), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', pacote, 'package.json'), JSON.stringify({ name: pacote, version: '0.0.0-falso', main: 'index.js' }));
      fs.writeFileSync(path.join(dir, 'node_modules', pacote, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(canario)}, '${pacote}');\n`);
    }
    const r = noFilho(dir, `
      const m = require(${JSON.stringify(MODULO_DOS_ANALISADORES)});
      const p = m.carregarAnalisadores();
      process.stdout.write(JSON.stringify({ versoes: m.versoesDosAnalisadores(), ts: p.ts.version }));
    `, { NODE_PATH: path.join(dir, 'node_modules') });
    assert.equal(r.status, 0, r.erro);
    const saida = r.saida as { versoes: { typescript: string; markdown: string }; ts: string };
    assert.equal(saida.ts, ts.version);
    assert.equal(saida.versoes.typescript, ts.version);
    assert.ok(!saida.versoes.markdown.includes('falso'));
    assert.ok(!fs.existsSync(canario), 'carregou pacote do diretorio analisado');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG3 parsers: sem o pacote na instalacao, a recusa e grafo.parser.indisponivel com o nome dele', () => {
  const dir = dirTemporario('kg3-sem-parser');
  try {
    // O modulo compilado so importa o Node em tempo de execucao: sozinho, fora do core, nao acha os pacotes.
    const copia = path.join(dir, 'isolado', 'intelligence-graph-parsers.js');
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(MODULO_DOS_ANALISADORES, copia);
    const r = noFilho(dir, `
      const m = require(${JSON.stringify(copia)});
      const erro = (f) => { try { f(); return null; } catch (e) { return e.message; } };
      process.stdout.write(JSON.stringify({ versoes: erro(() => m.versoesDosAnalisadores()), carga: erro(() => m.carregarAnalisadores()), pacotes: m.PACOTES_DOS_ANALISADORES }));
    `);
    assert.equal(r.status, 0, r.erro);
    const saida = r.saida as { versoes: string; carga: string; pacotes: string[] };
    assert.equal(saida.versoes, 'grafo.parser.indisponivel: typescript');
    assert.equal(saida.carga, 'grafo.parser.indisponivel: typescript');
    assert.deepEqual(saida.pacotes, [...PACOTES_DOS_ANALISADORES]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
