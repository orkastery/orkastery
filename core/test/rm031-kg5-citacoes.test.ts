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

function provarTrocaDeDiretorio(extrair = extrairGrafo): void {
  const teste = 'core/test/pasta.test.ts';
  const fixture = { [teste]: 'export const codigo = "require(\'../src/pasta\')";' };
  const diretorio = { ...fixture, 'core/src/pasta/index.ts': 'export const pasta = 1;' };
  const arquivo = { ...fixture, 'core/src/pasta.ts': 'export const pasta = 2;' };
  let anterior = extrair(entrada(diretorio), PARSER);
  assert.deepEqual(rotulos(anterior.grafo), [`${teste} -> core/src/pasta/index.ts`]);
  const sondas = anterior.unidades.arquivos.find((u) => u.path === teste)!.ts!.sondas;
  assert.ok(sondas.includes('core/src/pasta'), 'diretorio conserva sonda para a troca por arquivo');
  assert.ok(sondas.includes('core/src/pasta.ts'), 'variante de arquivo ausente fica sondada');
  assert.ok(sondas.includes('core/src/pasta/index.ts'), 'variante index fica sondada');
  for (const [repo, alvo] of [[arquivo, 'core/src/pasta.ts'], [diretorio, 'core/src/pasta/index.ts']] as const) {
    const e = entrada(repo), incremental = extrair(e, PARSER, anterior.unidades), completo = extrair(e, PARSER);
    assert.deepEqual(incremental.grafo, completo.grafo);
    assert.deepEqual(incremental.unidades, completo.unidades);
    assert.equal(incremental.digest, completo.digest);
    assert.deepEqual(rotulos(incremental.grafo), [`${teste} -> ${alvo}`]);
    assert.ok(incremental.reaproveitamento?.ts.reextraidos.includes(teste), 'fixture precisa ser reextraida');
    anterior = incremental;
  }
}

test('KG5 citacoes GO-FIX 2: diretorio vira arquivo e volta com indice incremental igual ao completo; prova cai por mutacao', () => {
  provarTrocaDeDiretorio();
  const semVariantes = mutante('intelligence-graph-extract-ts',
    'const grupos = candidatosDaCitacao(base)',
    'if ([...arquivos].some((p) => p.startsWith(base + "/"))) return; const grupos = candidatosDaCitacao(base)');
  assert.throws(() => provarTrocaDeDiretorio(semVariantes), 'retorno antecipado perde index e sondas');
});

function provarTrocaDeDiretorioComExtensao(base: string, filho: string, extrair = extrairGrafo): void {
  const teste = 'core/test/diretorio.test.ts';
  const fixture = { [teste]: `export const caminho = '${base}';` };
  const diretorio = { ...fixture, [filho]: 'export const interno = 1;' };
  const arquivo = { ...fixture, [base]: base.endsWith('.ts') ? 'export const alvo = 2;' : 'body { color: red; }' };
  let anterior = extrair(entrada(diretorio), PARSER);
  assert.deepEqual(rotulos(anterior.grafo), [], 'diretorio nao e alvo de cites');
  for (const [repo, esperado] of [[arquivo, [`${teste} -> ${base}`]], [diretorio, []]] as const) {
    const e = entrada(repo), incremental = extrair(e, PARSER, anterior.unidades), completo = extrair(e, PARSER);
    assert.deepEqual(incremental.grafo, completo.grafo, `${base}: grafo incremental igual ao completo`);
    assert.deepEqual(incremental.unidades, completo.unidades, `${base}: unidades incrementais iguais as completas`);
    assert.equal(incremental.digest, completo.digest, `${base}: digest incremental igual ao completo`);
    assert.deepEqual(rotulos(incremental.grafo), esperado);
    assert.ok(incremental.reaproveitamento?.ts.reextraidos.includes(teste), 'citante precisa ser reextraido nos dois sentidos');
    anterior = incremental;
  }
}

for (const [base, filho] of [
  ['core/src/pasta.ts', 'core/src/pasta.ts/index.ts'],
  ['dist/x.css', 'dist/x.css/estilo.css'],
]) test(`KG5 citacoes GO-FIX 3: ${base} troca entre diretorio e arquivo nos dois sentidos; filtro de sondas mutante reprova`, () => {
  provarTrocaDeDiretorioComExtensao(base, filho);
  const semDiretorios = mutante('intelligence-graph-extract-ts', 'const grupos = candidatosDaCitacao(base);',
    'const grupos = candidatosDaCitacao(base).map((grupo) => grupo.filter((p) => ![...arquivos].some((f) => f.startsWith(p + "/"))));');
  assert.throws(() => provarTrocaDeDiretorioComExtensao(base, filho, semDiretorios),
    /grafo incremental igual ao completo/, 'filtrar diretorios perde a invalidacao incremental');
});

function provarSemDuplicacao(extrair = extrairGrafo): void {
  const repo = {
    'core/README.md': '# Core',
    'core/src/alvo.ts': 'export const alvo = 1;',
    'core/test/import.test.ts': "import { alvo } from '../src/alvo.ts';\nconst citado = '../src/alvo.ts';",
    'core/test/require.test.ts': "const alvo = require('../src/alvo.ts');",
    'core/test/dinamico.test.ts': "const alvo = import('../src/alvo.ts');",
    'docs/alvo.md': '# Alvo',
    'docs/guia.md': '[arquivo](../core/src/alvo.ts)\n[seção](alvo.md#alvo)\n`core/src/alvo.ts`\n[raiz](core/src/alvo.ts)',
    'docs/referencia/guia.md': [
      '[`core/README.md`](../../core/README.md) `core/src/alvo.ts`',
      '[`core/src/alvo.ts`](../alvo.md#alvo)',
      '[`core/src/alvo.ts`](ausente.md)',
      '[`core/src/alvo.ts`](core/src/alvo.ts)',
      '[`core/src/alvo.ts`](core/src/alvo.ts) `core/src/alvo.ts`',
    ].join('\n'),
  };
  const g = extrair(entrada(repo), PARSER).grafo;
  const ocorrencias = (arquivo: string, kind: string): number[] => g.edges
    .filter((a) => a.kind === kind).flatMap((a) => a.evidence)
    .filter((e) => e.path === arquivo).map((e) => e.span.type === 'text' ? e.span.line_start! : -1).sort();
  assert.deepEqual(ocorrencias('docs/guia.md', 'references'), [1, 2]);
  assert.deepEqual(ocorrencias('docs/guia.md', 'cites'), [3, 4]);
  assert.deepEqual(ocorrencias('docs/referencia/guia.md', 'references'), [1, 2]);
  assert.deepEqual(ocorrencias('docs/referencia/guia.md', 'cites'), [1, 3, 4, 5, 5], 'rotulo resolvido, inclusive pela raiz, nao duplica; inline independente e link sem alvo conservam citacoes');
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
    ['intelligence-graph-extract-md', 'k.fim <= l.fim', 'false'],
    ['intelligence-graph-extract-md', "if (citar(literal, k, 'explicit-link'))", "if (citar(literal, k, 'explicit-link') && false)"],
    ['intelligence-graph-extract-ts', 'chave !== undefined && mapa.get(chave)?.alvo != null', 'false'],
  ]) {
    const extrair = mutante(modulo, antes, depois);
    assert.throws(() => provarSemDuplicacao(extrair), antes);
  }
});

function provarSondasRestritas(extrair = extrairGrafo): void {
  const repo = {
    'alvo.ts': 'export const raiz = 0;',
    'core/src/alvo.ts': 'export const alvo = 1;',
    'core/src/pasta.ts/index.ts': 'export const interno = 2;',
    'core/src/sem-extensao': 'arquivo sem extensao',
    'core/src/nao-conhecida.xyz': 'extensao desconhecida',
    'core/src/nao-conhecida.ctsx': 'nao e uma extensao TypeScript',
    'core/test/ruido.test.ts': ["export const palavras = ['core', 'docs', '../..', 'core/src/alvo', 'alvo.ts',",
      "'core/src/sem-extensao', 'core/src/nao-conhecida.xyz', 'core/src/nao-conhecida.ctsx', 'core/src/pasta.ts', 'core/src/'];",
      'export const invalidos = ["require(\'../..\')", "import(\'core/src/\')"];'].join('\n'),
    'docs/ruido.md': '`core` `docs` `../..` `core/src/alvo` `core/src/sem-extensao` `core/src/nao-conhecida.xyz` `core/src/nao-conhecida.ctsx` `core/src/pasta.ts`',
    'core/test/caminho.test.ts': "export const arquivo = 'core/src/alvo.ts';",
    'core/test/fixture.test.ts': 'export const codigo = "require(\'../dist/alvo\')";',
    'core/test/pacotes.test.ts': "export {}; require('zod'); import('typescript'); require('@scope/pacote');",
    'core/test/fixture-pacotes.test.ts': 'export const codigo = "require(\'zod\'); import(\'typescript\'); require(\'core/src/alvo\');";',
  };
  const r = extrair(entrada(repo), PARSER);
  const ruido = r.unidades.arquivos.find((u) => u.path === 'core/test/ruido.test.ts')!.ts!;
  assert.deepEqual(ruido.sondas, ['core/src/pasta.ts'], 'caminho de diretorio com extensao conserva sonda; palavras e caminhos sem extensao ficam fora');
  assert.deepEqual(ruido.dependencias, []);
  for (const arquivo of ['core/test/pacotes.test.ts', 'core/test/fixture-pacotes.test.ts']) {
    const pacote = r.unidades.arquivos.find((u) => u.path === arquivo)!.ts!;
    assert.deepEqual(pacote.sondas, [], `${arquivo}: nomes de pacote nao geram candidatos locais`);
    assert.deepEqual(pacote.dependencias, []);
  }
  assert.deepEqual(rotulos(r.grafo), ['core/test/caminho.test.ts -> core/src/alvo.ts', 'core/test/fixture.test.ts -> core/src/alvo.ts']);
  const caminho = r.unidades.arquivos.find((u) => u.path === 'core/test/caminho.test.ts')!.ts!;
  assert.deepEqual(caminho.sondas, ['core/src/alvo.ts'], 'caminho com extensao nao expande 17 candidatos');
  const novo = extrair(entrada({ ...repo, 'core/src/novo.ts': 'export const novo = 3;' }), PARSER, r.unidades);
  assert.ok(novo.reaproveitamento);
  assert.ok(!novo.reaproveitamento.ts.reextraidos.includes('core/test/ruido.test.ts'), 'arquivo novo nao invalida palavras comuns');
}

test('KG5 citacoes GO-FIX: sondas exigem arquivo ou argumento de modulo; provas caem por mutacao', () => {
  provarSondasRestritas();
  for (const [modulo, antes, depois] of [
    ['intelligence-graph-extract-md', '!modulo && (', 'false && ('],
    ['intelligence-graph-extract-md', 'if (modulo &&', 'if (false &&'],
    ['intelligence-graph-extract-md', '[cm]?[jt]s|[jt]sx', '[cm]?[jt]sx?'],
  ]) {
    const extrair = mutante(modulo, antes, depois);
    assert.throws(() => provarSondasRestritas(extrair), antes);
  }
});

function provarPrefixosDeModulo(extrair = extrairGrafo): void {
  const teste = 'core/test/prefixos.test.ts';
  const repo = {
    'core/test/alvo.ts': 'export const local = 1;',
    'core/src/alvo.ts': 'export const pai = 2;',
    '.../alvo.ts': 'export const tresPontos = 3;',
    [teste]: [
      'export const local = "require(\'./alvo.ts\')";',
      'export const pai = "import(\'../src/alvo.ts\')";',
      'export const pacote = "require(\'core/src/alvo.ts\')";',
      'export const absoluto = "require(\'/core/src/alvo.ts\')";',
      'export const tresPontos = "require(\'.../alvo.ts\')";',
      'export const fuga = "require(\'../../../../alvo.ts\')";',
      "export const caminhoAbsoluto = '/core/src/alvo.ts';",
    ].join('\n'),
  };
  const r = extrair(entrada(repo), PARSER);
  assert.deepEqual(rotulos(r.grafo), [`${teste} -> core/src/alvo.ts`, `${teste} -> core/test/alvo.ts`]);
  const unidade = r.unidades.arquivos.find((u) => u.path === teste)!.ts!;
  assert.deepEqual(unidade.sondas, ['core/src/alvo.ts', 'core/test/alvo.ts'], 'so ./ e ../ sondam caminhos locais');
  assert.deepEqual(unidade.dependencias, ['core/src/alvo.ts', 'core/test/alvo.ts']);
}

test('KG5 citacoes GO-FIX 3: prefixos de modulo aceitam ./ e ../, recusam absolutos, pacotes e tres pontos; mutantes reprovam', () => {
  provarPrefixosDeModulo();
  for (const [antes, depois] of [
    [String.raw`/^\.{1,2}\//`, String.raw`/^\.\//`],
    [String.raw`/^\.{1,2}\//`, String.raw`/^\.\.\//`],
    [String.raw`/^\.{1,2}\//`, String.raw`/^\.{1,3}\//`],
    ["literal.startsWith('/')", 'false'],
  ]) {
    const extrair = mutante('intelligence-graph-extract-md', antes, depois);
    assert.throws(() => provarPrefixosDeModulo(extrair), antes);
  }
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
  const dependencias: Record<string, unknown> = { [`./${modulo}`]: alterado };
  // TS compartilha caminhoDaCitacao com Markdown; o mutante deve chegar aos dois consumidores.
  if (modulo === 'intelligence-graph-extract-md') dependencias['./intelligence-graph-extract-ts'] =
    carregar('intelligence-graph-extract-ts', (s) => s, dependencias);
  return carregar('intelligence-graph-extract', (s) => s, dependencias).extrairGrafo;
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
