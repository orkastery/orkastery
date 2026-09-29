/**
 * I-31 KG1 (T3, D9, D10): fronteiras dos contratos KG1.
 *
 * O Company Brain v1 fica byte a byte, os modulos novos sao puros e fechados por allowlist no
 * fechamento transitivo dos imports, e nenhum outro modulo do nucleo os consome ainda: extracao,
 * indice, consumo e federacao sao KG2 a KG7. A analise usa o parser do TypeScript, nao busca
 * de palavra em prosa: comentario que cita "embedding" nao conta, identificador e import contam.
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
/** Allowlist explicita do fechamento transitivo dos modulos KG1. */
const EXTERNOS_PERMITIDOS = new Set(['zod', 'node:crypto']);
/** Globais que dariam processo, rede, arquivo, relogio ou avaliacao dinamica a um modulo puro. */
const GLOBAIS_PROIBIDOS = ['process', 'require', 'fetch', 'eval', 'Function', 'globalThis', 'XMLHttpRequest', 'WebSocket',
  'setTimeout', 'setInterval', 'setImmediate', 'performance', 'now'];
const TERMO_SEMANTICO = /embedding|vector|similar|sqlite|postgres|tree-?sitter|pdfjs|openai|anthropic|orkmind/i;
/** D9: hashes do GOAL E2 e E4, congelados nesta entrega. */
const CONGELADOS: [string, string][] = [
  ['core/schemas/company-brain.schema.json', 'a1dddf24f16fd875ac6fc979ef165eaff2012c4f3dd80b4687173925867a8166'],
  ['core/test/fixtures/company-brain-v1.json', '76dbbd35f2c4bfc0d509b8c98666e5a61203669731eae55e58315407f2afe9f1'],
  ['core/assets/orkmind-native-schema.json', '6c6fe6125c4734a60373ee713dada3b6f168abec98a9c66952d5cf1a424043ef'],
];

const ler = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
const importacoes = (rel: string): string[] => ts.preProcessFile(ler(rel), true, true).importedFiles.map((f) => f.fileName);

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

function simbolos(rel: string): { identificadores: Set<string>; literais: string[] } {
  const fonte = ts.createSourceFile(rel, ler(rel), ts.ScriptTarget.ES2022, true);
  const identificadores = new Set<string>(), literais: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) identificadores.add(n.text);
    else if (ts.isStringLiteralLike(n)) literais.push(n.text);
    ts.forEachChild(n, visitar);
  };
  visitar(fonte);
  return { identificadores, literais };
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

test('KG1 boundary: modulos KG1 nao tocam processo, rede, arquivo, relogio nem busca semantica', () => {
  for (const modulo of MODULOS_KG1) {
    const { identificadores, literais } = simbolos(modulo);
    assert.ok(identificadores.size > 50, `${modulo}: parser leu o arquivo`);
    for (const g of GLOBAIS_PROIBIDOS) assert.ok(!identificadores.has(g), `${modulo} usa ${g}`);
    const semanticos = [...identificadores, ...literais].filter((t) => TERMO_SEMANTICO.test(t));
    assert.deepEqual(semanticos, [], modulo);
  }
});

test('KG1 boundary: nenhum outro modulo do nucleo consome os contratos KG1 ainda', () => {
  const outros = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts') && !MODULOS_KG1.includes(f));
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
