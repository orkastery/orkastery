import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extrairGrafo, type EntradaDeExtracao } from '../src/intelligence-graph-extract';
import { carregarAnalisadores } from '../src/intelligence-graph-parsers';
import { conferirFontes, validarGrafo, type GrafoCodigo } from '../src/intelligence-graph-contract';

const PARSER = carregarAnalisadores();
const REPO: Record<string, string> = {
  'core/src/alvo.ts': 'export const alvo = 1;',
  'core/src/modulo.ts': 'export const modulo = 2;',
  'core/src/extra.ts': 'export const extra = 3;',
  'core/src/duplo.ts': 'export const duplo = 4;',
  'core/src/duplo.tsx': 'export const duplo = 5;',
  'core/src/produto.ts': "export const texto = 'core/src/alvo.ts';",
  'docs/guia.md': [
    '# Guia', '', 'Citação é `core/src/alvo.ts`.', '[módulo](core/src/modulo.ts)',
    '[extra](../core/src/extra.ts#trecho)', '`core/src/ausente.ts`', '[ausente](core/src/ausente.ts)',
    '[externo](https://example.invalid/core/src/alvo.ts)', '```ts', '`core/src/produto.ts`', '```',
    '<!-- `core/src/produto.ts` -->', 'core/src/produto.ts',
  ].join('\n'),
  'core/test/prova.test.ts': [
    "export const caminho = 'core/src/alvo.ts';",
    "const modulo = require('../dist/modulo');",
    "const extra = import('../src/extra.js');",
    'const codigo = "require(\'../dist/modulo\')";',
    "const ausente = 'core/src/ausente.ts';",
    "const ambiguo = '../src/duplo.js';",
    "const externo = 'https://example.invalid/core/src/alvo.ts';",
    'const dinamico = `core/src/${nome}.ts`;',
    "// 'core/src/produto.ts'",
    "const fuga = '../../../core/src/produto.ts';",
  ].join('\n'),
  'core/scripts/prova.cjs': "const alvo = require('../dist/modulo');\nconst citado = 'core/src/alvo.ts';",
};
function entrada(repo = REPO): EntradaDeExtracao {
  return { tenant_id: 'local', repository_id: 'citacoes', revision: 'a'.repeat(40), revision_unavailable_reason: null,
    acl_refs: ['repo:citacoes:leitura'], fontes: Object.entries(repo).map(([p, c]) => ({ path: p, bytes: Buffer.from(c) })) };
}
const rotulos = (g: GrafoCodigo): string[] => {
  const nos = new Map(g.nodes.map((n) => [n.node_id, n.locator.path]));
  return g.edges.filter((a) => a.kind === 'cites').map((a) => `${nos.get(a.from)} -> ${nos.get(a.to)}`).sort();
};
function provarCitacoes(extrair = extrairGrafo): void {
  const e = entrada(), r = extrair(e, PARSER), g = r.grafo;
  assert.deepEqual(rotulos(g), [
    'docs/guia.md -> core/src/alvo.ts', 'docs/guia.md -> core/src/modulo.ts',
    'core/test/prova.test.ts -> core/src/alvo.ts', 'core/test/prova.test.ts -> core/src/modulo.ts',
    'core/scripts/prova.cjs -> core/src/modulo.ts', 'core/scripts/prova.cjs -> core/src/alvo.ts',
  ].sort());
  assert.deepEqual(validarGrafo(g), g);
  const fontes = new Map(e.fontes.map((f) => [f.path, { tipo: 'texto' as const, bytes: f.bytes }]));
  assert.equal(conferirFontes(g, fontes).estado, 'verificada');
  const md = g.edges.find((a) => a.kind === 'cites' && a.evidence[0].path === 'docs/guia.md'
    && g.nodes.find((n) => n.node_id === a.to)?.locator.path === 'core/src/alvo.ts')!;
  assert.equal(md.evidence[0].span.type === 'text' && md.evidence[0].span.line_start, 3);
  assert.equal(Buffer.from(REPO['docs/guia.md']).subarray(md.evidence[0].span.byte_start, md.evidence[0].span.byte_end).toString(), 'core/src/alvo.ts');
  const modulo = g.edges.find((a) => a.kind === 'cites' && a.evidence[0].path === 'core/test/prova.test.ts'
    && g.nodes.find((n) => n.node_id === a.to)?.locator.path === 'core/src/modulo.ts')!;
  assert.deepEqual(modulo.evidence.map((e) => e.span.type === 'text' && e.span.line_start).sort(), [2, 4]);
  assert.equal(r.digest, extrair({ ...e, fontes: [...e.fontes].reverse() }, PARSER).digest);
}

test('KG5 citacoes: Markdown, strings de teste/script, linhas e bytes; ausentes, ambiguos e dinamicos ficam fora', () => {
  provarCitacoes();
});

function provarIncremental(extrair = extrairGrafo): void {
  const inicial = { 'docs/guia.md': '`core/src/novo.ts`', 'core/test/prova.test.ts': "export const citado = '../dist/novo.js';" };
  const comAlvo = { ...inicial, 'core/src/novo.ts': 'export const novo = 1;' };
  const ambiguo = { ...comAlvo, 'core/src/novo.tsx': 'export const novo = 2;' };
  let anterior = extrair(entrada(inicial), PARSER);
  for (const [repo, total] of [[comAlvo, 2], [ambiguo, 1], [comAlvo, 2], [inicial, 0]] as const) {
    const e = entrada(repo), incremental = extrair(e, PARSER, anterior.unidades), completo = extrair(e, PARSER);
    assert.deepEqual(incremental.grafo, completo.grafo);
    assert.deepEqual(incremental.unidades, completo.unidades);
    assert.equal(rotulos(incremental.grafo).length, total);
    anterior = incremental;
  }
}

test('KG5 citacoes: incremental religa Markdown e invalida strings quando alvos surgem, somem ou ficam ambiguos', () => {
  provarIncremental();
});

function provarSemDuplicacao(extrair = extrairGrafo): void {
  const repo = {
    'core/src/alvo.ts': 'export const alvo = 1;',
    'core/test/import.test.ts': "import { alvo } from '../src/alvo.ts';\nconst citado = '../src/alvo.ts';",
    'core/test/require.test.ts': "const alvo = require('../src/alvo.ts');",
    'core/test/dinamico.test.ts': "const alvo = import('../src/alvo.ts');",
    'docs/alvo.md': '# Alvo',
    'docs/guia.md': '[arquivo](../core/src/alvo.ts)\n[seção](alvo.md#alvo)\n`core/src/alvo.ts`\n[raiz](core/src/alvo.ts)',
  };
  const g = extrair(entrada(repo), PARSER).grafo;
  const ocorrencias = (arquivo: string, kind: string): number[] => g.edges
    .filter((a) => a.kind === kind).flatMap((a) => a.evidence)
    .filter((e) => e.path === arquivo).map((e) => e.span.type === 'text' ? e.span.line_start! : -1).sort();
  assert.deepEqual(ocorrencias('docs/guia.md', 'references'), [1, 2]);
  assert.deepEqual(ocorrencias('docs/guia.md', 'cites'), [3, 4]);
  assert.deepEqual(ocorrencias('core/test/import.test.ts', 'cites'), [2], 'outra string igual continua citando');
  for (const arquivo of ['core/test/import.test.ts', 'core/test/require.test.ts', 'core/test/dinamico.test.ts']) {
    assert.ok(ocorrencias(arquivo, 'imports').includes(1), arquivo);
    assert.ok(!ocorrencias(arquivo, 'cites').includes(1), arquivo);
  }
}

test('KG5 citacoes GO-FIX: links e imports resolvidos nao duplicam cites; prova cai por mutacao', () => {
  provarSemDuplicacao();
  for (const [modulo, antes, depois] of [
    ['intelligence-graph-extract-md', 'relativo === null || !arquivos.has(relativo)', 'true'],
    ['intelligence-graph-extract-ts', 'chave !== undefined && mapa.get(chave)?.alvo != null', 'false'],
  ]) assert.throws(() => provarSemDuplicacao(mutante(modulo, antes, depois)), antes);
});

/** Mutantes carregados em memoria, sem tocar nos arquivos nem no cache do Node. */
function mutante(modulo: string, antes: string, depois: string): typeof extrairGrafo {
  const Module = require('node:module');
  const carregar = (nome: string, transformar: (s: string) => string, dependencias: Record<string, unknown> = {}): any => {
    const arquivo = path.resolve(__dirname, `../src/${nome}.js`), m = new Module(arquivo);
    m.filename = arquivo; m.paths = Module._nodeModulePaths(path.dirname(arquivo));
    const carregarOriginal = m.require.bind(m);
    m.require = (id: string) => dependencias[id] ?? carregarOriginal(id);
    m._compile(transformar(fs.readFileSync(arquivo, 'utf8')), arquivo);
    return m.exports;
  };
  const alterado = carregar(modulo, (s) => { assert.ok(s.includes(antes), `ponto de mutacao: ${antes}`); return s.replace(antes, depois); });
  return carregar('intelligence-graph-extract', (s) => s, { [`./${modulo}`]: alterado }).extrairGrafo;
}

test('KG5 citacoes: provas caem ao retirar inline, links, strings, resolucao ou linhas', () => {
  provarCitacoes();
  for (const [modulo, antes, depois] of [
    ['intelligence-graph-extract-md', "e.tipo === 'codeTextData' && !emExcesso", 'false'],
    ['intelligence-graph-extract-md', "citar(literal, k, 'explicit-link')", "void literal"],
    ['intelligence-graph-extract-ts', "aresta('cites', arquivo,", "aresta('references', arquivo,"],
    ['intelligence-graph-extract-ts', 'presentes.length === 1', 'presentes.length >= 1'],
    ['intelligence-graph-extract-ts', 'grupo.filter((p) => arquivos.has(p))', 'grupo'],
    ['intelligence-graph-extract-ts', "'$1src/'", "'$1missing/'"],
    ['intelligence-graph-extract-ts', 'inicio: n.getStart(sf), fim: n.getEnd()', 'inicio: 0, fim: n.getEnd()'],
  ]) {
    const extrair = mutante(modulo, antes, depois);
    assert.throws(() => provarCitacoes(extrair), `${modulo}: ${antes}`);
  }
  const semSonda = mutante('intelligence-graph-extract-ts', 'sondas.add(p);', 'void p;');
  assert.throws(() => provarIncremental(semSonda), 'sem sondas nao descobre alvo novo ou ambiguo');
});
