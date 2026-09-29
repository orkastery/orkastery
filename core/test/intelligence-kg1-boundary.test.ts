/**
 * I-31 KG1 (T3, D9, D10) e RM-031 KG2 (D1, D11): fronteiras da familia do grafo.
 *
 * O Company Brain v1 fica byte a byte, os contratos KG1 e os extratores puros do KG2 sao fechados
 * por allowlist no fechamento transitivo dos imports, e fora da familia do grafo nenhum modulo do
 * nucleo os consome: indice, consumo e federacao sao KG3 a KG7. O compilador TypeScript entra nos
 * extratores so como tipo (D1). A analise usa o parser do TypeScript, nao busca de palavra em
 * prosa: comentario que cita "embedding" nao conta, identificador e import contam.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { ehContratoPublico } from '../src/contrato-publico';

const RAIZ = path.resolve(__dirname, '../../..');
const SRC = path.join(RAIZ, 'core/src');
const MODULOS_KG1 = ['intelligence-graph-contract.ts', 'intelligence-benchmark-contract.ts'];
/** RM-031 KG2: extratores puros; recebem bytes e o compilador por parametro. */
const MODULOS_KG2_PUROS = ['intelligence-graph-extract.ts', 'intelligence-graph-extract-ts.ts', 'intelligence-graph-extract-md.ts'];
/** RM-031 KG2 (D8): a unica borda de E/S da familia, que le o repositorio Git local. */
const MODULO_KG2_LEITURA = 'intelligence-graph-repo.ts';
const FAMILIA_DO_GRAFO = [...MODULOS_KG1, ...MODULOS_KG2_PUROS, MODULO_KG2_LEITURA];
/** Modulos de apoio que o KG2 puro pode alcancar: puros e sem import, conferidos com as mesmas regras. */
const APOIO_PURO_KG2 = ['yaml.ts'];
/** Externos que o KG2 puro pode alcancar; `typescript` so em `import type`. */
const EXTERNOS_KG2 = new Set(['zod', 'node:crypto', 'typescript']);
/** Allowlist explicita do fechamento transitivo dos modulos KG1. */
const EXTERNOS_PERMITIDOS = new Set(['zod', 'node:crypto']);
/** Globais que dariam processo, rede, arquivo, relogio, acaso ou avaliacao dinamica a um modulo puro. */
const GLOBAIS_PROIBIDOS = ['process', 'require', 'fetch', 'eval', 'Function', 'globalThis', 'XMLHttpRequest', 'WebSocket',
  'setTimeout', 'setInterval', 'setImmediate', 'performance', 'now', 'random', 'randomUUID', 'randomBytes', 'getRandomValues'];
/** De `node:crypto`, so o hash deterministico. */
const DE_CRYPTO_PERMITIDOS = new Set(['createHash']);
const TERMO_SEMANTICO = /embedding|vector|similar|sqlite|postgres|tree-?sitter|pdfjs|openai|anthropic|orkmind/i;
/** D9: hashes do GOAL E2 e E4, congelados nesta entrega. */
const CONGELADOS: [string, string][] = [
  ['core/schemas/company-brain.schema.json', 'a1dddf24f16fd875ac6fc979ef165eaff2012c4f3dd80b4687173925867a8166'],
  ['core/test/fixtures/company-brain-v1.json', '76dbbd35f2c4bfc0d509b8c98666e5a61203669731eae55e58315407f2afe9f1'],
  ['core/assets/orkmind-native-schema.json', '6c6fe6125c4734a60373ee713dada3b6f168abec98a9c66952d5cf1a424043ef'],
];

const ler = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
const importacoes = (rel: string): string[] => ts.preProcessFile(ler(rel), true, true).importedFiles.map((f) => f.fileName);

/** Imports e reexports com modulo, marcando os que so trazem tipo (apagados na compilacao). */
function importsComTipo(rel: string): { modulo: string; soTipo: boolean }[] {
  const fonte = ts.createSourceFile(rel, ler(rel), ts.ScriptTarget.ES2022, true), r: { modulo: string; soTipo: boolean }[] = [];
  for (const st of fonte.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      r.push({ modulo: st.moduleSpecifier.text, soTipo: !!st.importClause?.isTypeOnly });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      r.push({ modulo: st.moduleSpecifier.text, soTipo: st.isTypeOnly });
    }
  }
  return r;
}

function fechamento(inicio: string): { locais: Set<string>; externos: Set<string> } {
  const locais = new Set<string>(), externos = new Set<string>(), fila = [inicio];
  while (fila.length) {
    const atual = fila.pop() as string;
    if (locais.has(atual)) continue;
    locais.add(atual);
    for (const i of importacoes(atual)) {
      assert.ok(!i.startsWith('../'), `${atual} importa fora de core/src: ${i}`);
      if (i.startsWith('./')) fila.push(`${i.slice(2)}.ts`);
      else externos.add(i);
    }
  }
  return { locais, externos };
}

function simbolos(rel: string): { identificadores: Set<string>; literais: string[]; relogio: number; deCrypto: string[] } {
  const fonte = ts.createSourceFile(rel, ler(rel), ts.ScriptTarget.ES2022, true);
  const identificadores = new Set<string>(), literais: string[] = [], deCrypto: string[] = [];
  let relogio = 0;
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) identificadores.add(n.text);
    else if (ts.isStringLiteralLike(n)) literais.push(n.text);
    // `new Date()` le o relogio; `Date.parse` de texto fornecido continua puro.
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date') relogio++;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === 'node:crypto') {
      const nomes = n.importClause?.namedBindings;
      if (!nomes || !ts.isNamedImports(nomes) || n.importClause?.name) deCrypto.push('*');
      else nomes.elements.forEach((e) => deCrypto.push((e.propertyName ?? e.name).text));
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fonte);
  return { identificadores, literais, relogio, deCrypto };
}

test('KG1 boundary: Company Brain v1, corpus C1 e schema nativo ficam byte a byte', () => {
  for (const [arquivo, esperado] of CONGELADOS) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(RAIZ, arquivo))).digest('hex'), esperado, arquivo);
  }
});

test('KG1 boundary: Company Brain v1 continua fechado, sem tipo de grafo no Event nem na Selection', () => {
  const texto = fs.readFileSync(path.join(RAIZ, 'core/schemas/company-brain.schema.json'), 'utf8');
  const s = JSON.parse(texto);
  assert.equal(s.$id, 'orkmind.company-brain/v1');
  assert.equal(s.$defs.Source.properties.authority.const, 'ork');
  assert.deepEqual(s.$defs.Entity.properties.kind.enum, ['prod', 'proj', 'init']);
  assert.deepEqual(s.$defs.Event.properties.payload.anyOf, [{ $ref: '#/$defs/Entity' }, { $ref: '#/$defs/Assertion' }, { type: 'null' }]);
  for (const kg1 of ['code-artifact-graph', 'graph-benchmark', 'edge_id', 'extraction_method']) assert.ok(!texto.includes(kg1), kg1);
});

test('KG1 boundary: modulos KG1 so dependem de zod e node:crypto, no fechamento transitivo', () => {
  for (const modulo of MODULOS_KG1) {
    const { locais, externos } = fechamento(modulo);
    assert.ok([...locais].every((l) => MODULOS_KG1.includes(l)), `${modulo}: ${[...locais]}`);
    assert.ok([...externos].every((e) => EXTERNOS_PERMITIDOS.has(e)), `${modulo}: ${[...externos]}`);
  }
  assert.deepEqual([...fechamento('intelligence-benchmark-contract.ts').locais].sort(), [...MODULOS_KG1].sort());
});

test('KG1 boundary: modulos KG1 nao tocam processo, rede, arquivo, relogio, acaso nem busca semantica', () => {
  for (const modulo of MODULOS_KG1) {
    const { identificadores, literais, relogio, deCrypto } = simbolos(modulo);
    assert.ok(identificadores.size > 50, `${modulo}: parser leu o arquivo`);
    for (const g of GLOBAIS_PROIBIDOS) assert.ok(!identificadores.has(g), `${modulo} usa ${g}`);
    assert.equal(relogio, 0, `${modulo} le o relogio com new Date()`);
    assert.ok(deCrypto.every((d) => DE_CRYPTO_PERMITIDOS.has(d)), `${modulo} importa de node:crypto: ${deCrypto}`);
    const semanticos = [...identificadores, ...literais].filter((t) => TERMO_SEMANTICO.test(t));
    assert.deepEqual(semanticos, [], modulo);
  }
});

test('KG2 boundary: extratores puros so alcancam a familia do grafo, zod e node:crypto; typescript so como tipo', () => {
  for (const modulo of MODULOS_KG2_PUROS) {
    const { locais, externos } = fechamento(modulo);
    assert.ok([...locais].every((l) => FAMILIA_DO_GRAFO.includes(l) || APOIO_PURO_KG2.includes(l)), `${modulo}: ${[...locais]}`);
    assert.ok([...externos].every((e) => EXTERNOS_KG2.has(e)), `${modulo}: ${[...externos]}`);
    for (const i of importsComTipo(modulo).filter((x) => x.modulo === 'typescript')) assert.ok(i.soTipo, `${modulo} importa typescript em tempo de execucao`);
  }
  assert.ok(importsComTipo('intelligence-graph-extract.ts').some((i) => i.modulo === './intelligence-graph-contract' && !i.soTipo));
  for (const apoio of APOIO_PURO_KG2) assert.deepEqual(importsComTipo(apoio), [], `${apoio} continua sem import`);
});

test('KG2 boundary: extratores puros nao tocam processo, rede, arquivo, relogio, acaso nem busca semantica', () => {
  for (const modulo of [...MODULOS_KG2_PUROS, ...APOIO_PURO_KG2]) {
    const { identificadores, literais, relogio, deCrypto } = simbolos(modulo);
    assert.ok(identificadores.size > (APOIO_PURO_KG2.includes(modulo) ? 10 : 50), `${modulo}: parser leu o arquivo`);
    for (const g of GLOBAIS_PROIBIDOS) assert.ok(!identificadores.has(g), `${modulo} usa ${g}`);
    assert.equal(relogio, 0, `${modulo} le o relogio com new Date()`);
    assert.ok(deCrypto.every((d) => DE_CRYPTO_PERMITIDOS.has(d)), `${modulo} importa de node:crypto: ${deCrypto}`);
    const semanticos = [...identificadores, ...literais].filter((t) => TERMO_SEMANTICO.test(t));
    assert.deepEqual(semanticos, [], modulo);
  }
});

test('KG2 boundary: a leitura do repositorio so traz tipos do extrator e so usa arquivo, caminho e processo do Node', () => {
  const imports = importsComTipo(MODULO_KG2_LEITURA);
  const externos = imports.filter((i) => !i.modulo.startsWith('./')).map((i) => i.modulo).sort();
  assert.deepEqual(externos, ['node:child_process', 'node:fs', 'node:path']);
  for (const i of imports.filter((x) => x.modulo.startsWith('./intelligence-'))) assert.ok(i.soTipo, `${i.modulo} entra so como tipo`);
  const { identificadores } = simbolos(MODULO_KG2_LEITURA);
  for (const proibido of ['exec', 'execSync', 'shell', 'fetch', 'eval', 'Function']) assert.ok(!identificadores.has(proibido), proibido);
  for (const f of FAMILIA_DO_GRAFO.filter((x) => x !== MODULO_KG2_LEITURA)) {
    assert.ok(!importacoes(f).includes('./intelligence-graph-repo'), `${f} importa a borda de E/S`);
  }
});

test('KG1 boundary: fora da familia do grafo, nenhum modulo do nucleo consome os contratos', () => {
  const outros = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts') && !FAMILIA_DO_GRAFO.includes(f));
  for (const vizinho of ['orkmind.ts', 'recall.ts', 'memoria.ts', 'company-brain-contract.ts', 'company-brain-client.ts', 'mcp-server.ts', 'index.ts', 'phase.ts']) {
    assert.ok(outros.includes(vizinho), `${vizinho} existe: a fronteira nao e vazia`);
  }
  for (const f of outros) {
    assert.ok(!importacoes(f).some((i) => i.includes('intelligence-')), `${f} importa contrato KG1`);
    const texto = ler(f);
    assert.ok(!texto.includes('ork.code-artifact-graph') && !texto.includes('ork.graph-benchmark'), `${f} cita contrato KG1`);
  }
});

test('KG1 boundary: os schemas publicados do KG1 ficam sob a fronteira de contrato publico', () => {
  for (const schema of ['core/schemas/code-artifact-graph.v1.schema.json', 'core/schemas/graph-benchmark.v1.schema.json']) {
    assert.ok(fs.existsSync(path.join(RAIZ, schema)), schema);
    assert.equal(ehContratoPublico(schema), true, schema);
  }
});
