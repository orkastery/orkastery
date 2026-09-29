/**
 * RM-031 KG2: extracao deterministica do grafo `ork.code-artifact-graph/v1`.
 *
 * Grupos: "KG2 extract" (o que sai e de onde), "KG2 provenance" (evidencia contra os bytes),
 * "KG2 determinism" (mesma entrada, mesmo grafo) e "KG2 limits" (o que nao se prova fica fora e
 * declarado). Os repositorios sao sinteticos: em memoria, ou Git temporario para a leitura e o
 * comando provisorio.
 */
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';
import {
  conferirFontes, digestDoGrafo, validarGrafo, type FonteFornecida, type GrafoCodigo,
} from '../src/intelligence-graph-contract';
import { slugDoGithub } from '../src/intelligence-graph-extract-md';
import { lerRepositorio } from '../src/intelligence-graph-repo';
import { dirTemporario } from './apoio';
import {
  extrairGrafo, idDeBlob, textoAceito, type EntradaDeExtracao, type FonteDoRepositorio, type ResultadoDaExtracao,
} from '../src/intelligence-graph-extract';

const fontesDe = (arquivos: Record<string, string | Uint8Array>): FonteDoRepositorio[] =>
  Object.entries(arquivos).map(([p, c]) => ({ path: p, bytes: typeof c === 'string' ? Buffer.from(c, 'utf8') : c }));

function entrada(arquivos: Record<string, string | Uint8Array>, extra: Partial<EntradaDeExtracao> = {}): EntradaDeExtracao {
  return {
    tenant_id: 'teste', repository_id: 'repo-teste', revision: null, revision_unavailable_reason: 'repositorio-sintetico',
    acl_refs: ['repo:repo-teste:leitura'], fontes: fontesDe(arquivos), ...extra,
  };
}
const extrair = (arquivos: Record<string, string | Uint8Array>, extra: Partial<EntradaDeExtracao> = {}): ResultadoDaExtracao =>
  extrairGrafo(entrada(arquivos, extra), { ts });

const rotulo = (g: GrafoCodigo) => {
  const nos = new Map(g.nodes.map((n) => [n.node_id, `${n.kind}:${n.locator.path}${n.locator.fragment === null ? '' : `#${n.locator.fragment}`}`]));
  return (id: string): string => nos.get(id) as string;
};
const arestas = (g: GrafoCodigo, kind?: string): string[] => {
  const r = rotulo(g);
  return g.edges.filter((a) => !kind || a.kind === kind).map((a) => `${a.kind} ${r(a.from)} -> ${r(a.to)}`).sort();
};
const temAresta = (g: GrafoCodigo, texto: string): boolean => arestas(g).includes(texto);
const fontesFornecidas = (arquivos: Record<string, string | Uint8Array>): Map<string, FonteFornecida> =>
  new Map(fontesDe(arquivos).map((f) => [f.path, { tipo: 'texto', bytes: f.bytes }]));
/** Texto de cada evidencia da aresta, cortado dos bytes da fonte pelo span. */
function trechos(g: GrafoCodigo, arquivos: Record<string, string>, texto: string): string[] {
  const r = rotulo(g);
  const a = g.edges.find((x) => `${x.kind} ${r(x.from)} -> ${r(x.to)}` === texto);
  assert.ok(a, `aresta ausente: ${texto}`);
  // O contrato devolve as evidencias na ordem canonica; aqui elas voltam a ordem de posicao.
  return a.evidence.map((e) => {
    assert.equal(e.span.type, 'text');
    const s = e.span as { byte_start: number; byte_end: number };
    return [s.byte_start, Buffer.from(arquivos[e.path], 'utf8').subarray(s.byte_start, s.byte_end).toString('utf8')] as const;
  }).sort((x, y) => x[0] - y[0]).map(([, t]) => t);
}

const UTIL = [
  '// ação: utilitários com acento, para os offsets em bytes diferirem dos de texto',
  'export function soma(a: number, b: number): number {',
  '  return a + b;',
  '}',
  'export function soma2(a: number): number;',
  'export function soma2(a: number, b?: number): number { return a + (b ?? 0); }',
  'export class Calculadora {',
  '  static criar(): Calculadora { return new Calculadora(); }',
  '  dobrar(x: number): number { return this.somar(x, x); }',
  '  somar(a: number, b: number): number { return soma(a, b); }',
  '}',
  'export const PI = 3.14, { E } = { E: 2.71 };',
  'export type Numero = number;',
  'export interface Forma { area(): number }',
  '',
].join('\n');
const APP = [
  "import { soma, Calculadora } from './util';",
  "import * as util from './util';",
  "import { chunk } from 'pacote-externo';",
  "import type { Forma } from './util';",
  '',
  'export function principal(f: Forma): number {',
  '  const c = Calculadora.criar();',
  '  const local = (x: number) => x;',
  '  return soma(1, 2) + util.soma2(3) + c.dobrar(2) + local(1) + chunk() + f.area();',
  '}',
  'principal({ area: () => 1 });',
  '',
].join('\n');
const REPO_TS = { 'src/util.ts': UTIL, 'src/app.ts': APP };

test('KG2 extract: TypeScript gera declares, contains, imports e calls provados pelo compilador', () => {
  const { grafo } = extrair(REPO_TS);
  const esperadas = [
    'declares file:src/util.ts -> symbol:src/util.ts#soma',
    'declares file:src/util.ts -> symbol:src/util.ts#soma2',
    'declares file:src/util.ts -> symbol:src/util.ts#Calculadora',
    'declares file:src/util.ts -> symbol:src/util.ts#PI',
    'declares file:src/util.ts -> symbol:src/util.ts#E',
    'declares file:src/util.ts -> symbol:src/util.ts#Numero',
    'declares file:src/util.ts -> symbol:src/util.ts#Forma',
    'declares file:src/app.ts -> symbol:src/app.ts#principal',
    'contains symbol:src/util.ts#Calculadora -> symbol:src/util.ts#Calculadora.criar',
    'contains symbol:src/util.ts#Calculadora -> symbol:src/util.ts#Calculadora.dobrar',
    'contains symbol:src/util.ts#Calculadora -> symbol:src/util.ts#Calculadora.somar',
    'imports file:src/app.ts -> file:src/util.ts',
    'imports file:src/app.ts -> symbol:src/util.ts#soma',
    'imports file:src/app.ts -> symbol:src/util.ts#Calculadora',
    'imports file:src/app.ts -> symbol:src/util.ts#Forma',
    'calls symbol:src/util.ts#Calculadora.criar -> symbol:src/util.ts#Calculadora',
    'calls symbol:src/util.ts#Calculadora.dobrar -> symbol:src/util.ts#Calculadora.somar',
    'calls symbol:src/util.ts#Calculadora.somar -> symbol:src/util.ts#soma',
    'calls symbol:src/app.ts#principal -> symbol:src/util.ts#Calculadora.criar',
    'calls symbol:src/app.ts#principal -> symbol:src/util.ts#soma',
    'calls symbol:src/app.ts#principal -> symbol:src/util.ts#soma2',
  ].sort();
  assert.deepEqual(arestas(grafo), esperadas);
  // Interface nao tem membro de classe: `area` nao vira simbolo.
  assert.ok(!grafo.nodes.some((n) => n.locator.fragment === 'Forma.area'));
  assert.deepEqual(grafo.diagnostics.map((d) => [d.kind, d.path, d.reference]), [['unresolved-import', 'src/app.ts', 'pacote-externo']]);
});

test('KG2 extract: sobrecarga e tres imports do mesmo arquivo viram uma aresta com varias evidencias', () => {
  const { grafo } = extrair(REPO_TS);
  assert.deepEqual(trechos(grafo, REPO_TS, 'declares file:src/util.ts -> symbol:src/util.ts#soma2'), [
    'export function soma2(a: number): number;',
    'export function soma2(a: number, b?: number): number { return a + (b ?? 0); }',
  ]);
  assert.deepEqual(trechos(grafo, REPO_TS, 'imports file:src/app.ts -> file:src/util.ts'), [
    "import { soma, Calculadora } from './util';", "import * as util from './util';", "import type { Forma } from './util';",
  ]);
  assert.deepEqual(trechos(grafo, REPO_TS, 'calls symbol:src/app.ts#principal -> symbol:src/util.ts#soma2'), ['util.soma2(']);
  assert.deepEqual(trechos(grafo, REPO_TS, 'calls symbol:src/util.ts#Calculadora.criar -> symbol:src/util.ts#Calculadora'), ['new Calculadora(']);
});

test('KG2 extract: reexport, export default e CommonJS resolvem ate a declaracao original', () => {
  const arquivos = {
    'src/util.ts': 'export function soma(a: number, b: number) { return a + b; }\n',
    'src/index.ts': "export { soma as mais } from './util';\nexport * from './util';\n",
    'src/def.ts': 'export default function () { return 1; }\n',
    'src/app.ts': "import { mais } from './index';\nimport def from './def';\nexport const total = () => mais(1, 2) + def();\n",
    'scripts/b.cjs': 'function ajudar() { return 1; }\nmodule.exports = { ajudar };\n',
    'scripts/a.cjs': "const { ajudar } = require('./b.cjs');\nconst b = require('./b.cjs');\nfunction rodar() { return ajudar() + b.ajudar(); }\nmodule.exports = { rodar };\n",
  };
  const { grafo } = extrair(arquivos);
  for (const a of [
    'imports file:src/index.ts -> file:src/util.ts',
    'imports file:src/index.ts -> symbol:src/util.ts#soma',
    'imports file:src/app.ts -> file:src/index.ts',
    'imports file:src/app.ts -> symbol:src/util.ts#soma',
    'imports file:src/app.ts -> symbol:src/def.ts#default',
    'calls symbol:src/app.ts#total -> symbol:src/util.ts#soma',
    'calls symbol:src/app.ts#total -> symbol:src/def.ts#default',
    'imports file:scripts/a.cjs -> file:scripts/b.cjs',
    'calls symbol:scripts/a.cjs#rodar -> symbol:scripts/b.cjs#ajudar',
  ]) assert.ok(temAresta(grafo, a), a);
  assert.deepEqual(trechos(grafo, arquivos, 'imports file:scripts/a.cjs -> file:scripts/b.cjs'), ["require('./b.cjs')", "require('./b.cjs')"]);
});

test('KG2 provenance: toda evidencia bate com os bytes, em bytes UTF-8 e linhas, pelo ork.ts-ast', () => {
  const { grafo } = extrair(REPO_TS);
  const r = conferirFontes(grafo, fontesFornecidas(REPO_TS));
  assert.equal(r.estado, 'verificada');
  assert.equal(r.evidenciasIndisponiveis, 0);
  assert.ok(r.evidenciasVerificadas >= grafo.edges.length);
  for (const a of grafo.edges) {
    for (const e of a.evidence) {
      assert.equal(e.extractor_id, 'ork.ts-ast');
      assert.equal(e.extractor_version, `1.0.0+typescript.${ts.version}`);
      assert.equal(e.extraction_method, 'ast');
      assert.equal(e.confidence_class, 'EXTRACTED');
      assert.equal(e.authority, 'git:repo-teste');
    }
  }
  const util = grafo.snapshot.source_manifest.find((m) => m.path === 'src/util.ts');
  assert.equal(util?.source_version, idDeBlob(Buffer.from(UTIL, 'utf8')));
  // A linha 2 comeca depois do comentario com acentos: o offset em bytes e maior que o de texto.
  const soma = grafo.edges.find((a) => rotulo(grafo)(a.to) === 'symbol:src/util.ts#soma' && a.kind === 'declares');
  assert.equal(soma?.evidence[0].span.type === 'text' && soma.evidence[0].span.line_start, 2);
  assert.ok(soma && soma.evidence[0].span.byte_start > UTIL.indexOf('export function soma('));
});

test('KG2 provenance: o grafo sai na forma canonica do contrato, com digest igual ao do contrato', () => {
  const r = extrair(REPO_TS);
  assert.deepEqual(validarGrafo(r.grafo), r.grafo);
  assert.equal(digestDoGrafo(r.grafo), r.digest);
  assert.equal(r.relatorio.graph_digest, r.digest);
  assert.equal(r.relatorio.snapshot_id, r.grafo.snapshot.snapshot_id);
  assert.deepEqual(r.grafo.snapshot.extractors, [
    { extractor_id: 'ork.id-mention', extractor_version: '1.0.0' }, { extractor_id: 'ork.md-structure', extractor_version: '1.0.0' },
    { extractor_id: 'ork.repo-files', extractor_version: '1.0.0' }, { extractor_id: 'ork.ts-ast', extractor_version: `1.0.0+typescript.${ts.version}` },
  ]);
});

const GUIA = [
  '# Guia',
  '',
  '## Configuração',
  '',
  'Veja [util](../src/util.ts) antes de mudar a soma, e o [ADR](adr/ADR-001.md#decisão).',
  '',
  '```sh',
  '[falso](../src/util.ts) RM-001',
  '```',
  '',
  'Texto com `[codigo](../src/util.ts)` e <!-- [comentario](../src/util.ts) RM-001 --> fim.',
  '',
  '## Configuração',
  '',
  'Externo [site](https://exemplo.com), quebrado [x](nao-existe.md), pasta [d](../src/), âncora ruim [a](adr/ADR-001.md#nao-tem),',
  'local [topo](#guia) e imagem ![logo](../assets/logo.png). Cita RM-001 e FEAT-999.',
  '',
].join('\n');
const ADR = [
  '---',
  'id: ADR-001',
  'tipo: adr',
  'pai: RM-001',
  'roadmap: [RM-001, RM-404]',
  'fontes:',
  '  codigo:',
  '    - src/util.ts',
  '    - src/nao-existe.ts',
  '  simbolos:',
  '    - src/util.ts#soma',
  '    - src/util.ts#nada',
  '---',
  '',
  '# ADR-001 Soma pura',
  '',
  '## Decisão',
  '',
  'Origem: [guia](../guia.md#configuração).',
  '',
].join('\n');
const REPO_MD = {
  'src/util.ts': UTIL,
  'src/ref.ts': '// RM-001: a soma mora em util\nexport const REF = 1;\n',
  'docs/guia.md': GUIA,
  'docs/adr/ADR-001.md': ADR,
  'docs/roadmap/RM-001.md': '---\nid: RM-001\ntipo: roadmap\n---\n\n# RM-001 Base\n\nDecidido no ADR-001.\n',
  'docs/roadmap/_modelo.md': '---\nid: RM-000\ntipo: roadmap\n---\n\n# Modelo\n',
  'assets/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]),
  'data/x.json': '{"a": 1}\n',
  'scripts/y.py': 'print(1)\n',
  LICENSE: 'MIT\n',
};
const textoMd = Object.fromEntries(Object.entries(REPO_MD).filter(([, v]) => typeof v === 'string')) as Record<string, string>;

test('KG2 extract: Markdown gera secoes, links, artefatos, frontmatter e mencoes de ID', () => {
  const { grafo } = extrair(REPO_MD);
  const md = arestas(grafo).filter((a) => !/^(declares|contains symbol|calls|imports)/.test(a));
  assert.deepEqual(md, [
    'contains file:docs/adr/ADR-001.md -> section:docs/adr/ADR-001.md#adr-001-soma-pura',
    'contains file:docs/adr/ADR-001.md -> section:docs/adr/ADR-001.md#decisão',
    'contains file:docs/guia.md -> section:docs/guia.md#configuração',
    'contains file:docs/guia.md -> section:docs/guia.md#configuração-1',
    'contains file:docs/guia.md -> section:docs/guia.md#guia',
    'contains file:docs/roadmap/RM-001.md -> section:docs/roadmap/RM-001.md#rm-001-base',
    'contains file:docs/roadmap/_modelo.md -> section:docs/roadmap/_modelo.md#modelo',
    'derived_from artifact:docs/adr/ADR-001.md#ADR-001 -> file:src/util.ts',
    'references artifact:docs/adr/ADR-001.md#ADR-001 -> artifact:docs/roadmap/RM-001.md#RM-001',
    'references artifact:docs/adr/ADR-001.md#ADR-001 -> symbol:src/util.ts#soma',
    'references file:src/ref.ts -> artifact:docs/roadmap/RM-001.md#RM-001',
    'references section:docs/adr/ADR-001.md#adr-001-soma-pura -> artifact:docs/adr/ADR-001.md#ADR-001',
    'references section:docs/adr/ADR-001.md#decisão -> section:docs/guia.md#configuração',
    'references section:docs/guia.md#configuração -> file:src/util.ts',
    'references section:docs/guia.md#configuração -> section:docs/adr/ADR-001.md#decisão',
    'references section:docs/guia.md#configuração-1 -> artifact:docs/roadmap/RM-001.md#RM-001',
    'references section:docs/guia.md#configuração-1 -> file:assets/logo.png',
    'references section:docs/guia.md#configuração-1 -> file:docs/adr/ADR-001.md',
    'references section:docs/guia.md#configuração-1 -> section:docs/guia.md#guia',
    'references section:docs/roadmap/RM-001.md#rm-001-base -> artifact:docs/adr/ADR-001.md#ADR-001',
    'references section:docs/roadmap/RM-001.md#rm-001-base -> artifact:docs/roadmap/RM-001.md#RM-001',
  ]);
  assert.deepEqual(grafo.nodes.filter((n) => n.kind === 'artifact').map((n) => n.locator.fragment).sort(), ['ADR-001', 'RM-001']);
  assert.deepEqual(grafo.diagnostics.filter((d) => d.kind === 'unsupported-language').map((d) => [d.path, d.reference, d.extractor_id]), [
    ['LICENSE', null, 'ork.repo-files'], ['assets/logo.png', '.png', 'ork.repo-files'],
    ['data/x.json', '.json', 'ork.repo-files'], ['scripts/y.py', '.py', 'ork.repo-files'],
  ]);
});

test('KG2 extract: pai e roadmap para o mesmo artefato viram uma aresta com duas evidencias no frontmatter', () => {
  const { grafo } = extrair(REPO_MD);
  assert.deepEqual(trechos(grafo, textoMd, 'references artifact:docs/adr/ADR-001.md#ADR-001 -> artifact:docs/roadmap/RM-001.md#RM-001'), ['RM-001', 'RM-001']);
  assert.deepEqual(trechos(grafo, textoMd, 'derived_from artifact:docs/adr/ADR-001.md#ADR-001 -> file:src/util.ts'), ['src/util.ts']);
  assert.deepEqual(trechos(grafo, textoMd, 'references section:docs/guia.md#configuração -> file:src/util.ts'), ['[util](../src/util.ts)']);
  assert.deepEqual(trechos(grafo, textoMd, 'contains file:docs/guia.md -> section:docs/guia.md#configuração-1'), ['## Configuração']);
  assert.deepEqual(trechos(grafo, textoMd, 'references section:docs/guia.md#configuração-1 -> file:assets/logo.png'), ['![logo](../assets/logo.png)']);
});

test('KG2 provenance: evidencias do Markdown usam o metodo de cada prova e batem com os bytes', () => {
  const { grafo } = extrair(REPO_MD);
  const fontes = new Map<string, FonteFornecida>(fontesDe(REPO_MD).map((f) => [f.path, { tipo: f.path.endsWith('.png') ? 'binario' : 'texto', bytes: f.bytes }]));
  assert.equal(conferirFontes(grafo, fontes).estado, 'verificada');
  const r = rotulo(grafo), metodos = new Set<string>();
  for (const a of grafo.edges) {
    for (const e of a.evidence) {
      metodos.add(`${a.kind}/${e.extractor_id}/${e.extraction_method}`);
      if (e.extractor_id === 'ork.id-mention') assert.equal(e.extraction_method, 'text-location', r(a.from));
    }
  }
  for (const m of ['contains/ork.md-structure/structured', 'references/ork.md-structure/explicit-link', 'references/ork.md-structure/structured',
    'derived_from/ork.md-structure/structured', 'references/ork.id-mention/text-location']) assert.ok(metodos.has(m), m);
  assert.deepEqual(grafo.snapshot.extractors.map((x) => x.extractor_id), ['ork.id-mention', 'ork.md-structure', 'ork.repo-files', 'ork.ts-ast']);
});

test('KG2 limits: codigo, comentario, link sem alvo, pasta, ancora ruim e ID inexistente ficam fora e declarados', () => {
  const { grafo, relatorio } = extrair(REPO_MD);
  const guia = arestas(grafo).filter((a) => a.includes('section:docs/guia.md'));
  // Uma evidencia so para util a partir de #configuração: a do codigo cercado, a do span e a do comentario nao contam.
  assert.deepEqual(trechos(grafo, textoMd, 'references section:docs/guia.md#configuração -> file:src/util.ts').length, 1);
  assert.ok(!guia.some((a) => a.includes('nao-existe') || a.includes('file:src ->') || a.includes('#nao-tem')));
  const listadas = relatorio.lacunas.map((l) => `${l.categoria} ${l.path}:${l.linha} ${l.detalhe}`).sort();
  assert.deepEqual(listadas, [
    'ancora-nao-resolvida docs/guia.md:15 adr/ADR-001.md#nao-tem',
    'frontmatter-sem-alvo docs/adr/ADR-001.md:5 roadmap: RM-404',
    'frontmatter-sem-alvo docs/adr/ADR-001.md:9 fontes.codigo: src/nao-existe.ts',
    'frontmatter-sem-alvo docs/adr/ADR-001.md:12 fontes.simbolos: src/util.ts#nada',
    'link-para-diretorio docs/guia.md:15 ../src/',
    'link-sem-alvo docs/guia.md:15 nao-existe.md',
  ].sort());
  assert.equal(relatorio.lacunas_por_categoria['link-externo'], 1);
  assert.equal(relatorio.lacunas_por_categoria['id-sem-artefato'], 1);
  assert.ok(!grafo.nodes.some((n) => n.locator.fragment === 'RM-000'), 'modelo nao e artefato');
});

test('KG2 limits: ID de artefato repetido em dois arquivos nao vira artefato em nenhum', () => {
  const { grafo, relatorio } = extrair({
    'a.md': '---\nid: RM-002\ntipo: roadmap\n---\n\n# A\n', 'b.md': '---\nid: RM-002\ntipo: roadmap\n---\n\n# B\n', 'c.md': 'Cita RM-002.\n',
  });
  assert.equal(grafo.nodes.filter((n) => n.kind === 'artifact').length, 0);
  assert.deepEqual(relatorio.lacunas.filter((l) => l.categoria === 'artefato-id-repetido').map((l) => l.path), ['a.md', 'b.md']);
  assert.deepEqual(arestas(grafo, 'references'), []);
});

test('KG2 extract: slug de ancora como o do GitHub', () => {
  const casos: [string, string][] = [
    ['6. Três leitores e fatos de SDLC (adaptação Orkastery)', '6-três-leitores-e-fatos-de-sdlc-adaptação-orkastery'],
    ['1. Instale o `ork`', '1-instale-o-ork'],
    ['Um Maestro, vários canais (I-36)', 'um-maestro-vários-canais-i-36'],
    ['RM-031 : Grafo', 'rm-031--grafo'],
    ['Veja [o guia](x.md) já', 'veja-o-guia-já'],
    ['snake_case e CAIXA', 'snake_case-e-caixa'],
  ];
  for (const [titulo, slug] of casos) assert.equal(slugDoGithub(titulo), slug, titulo);
});

/** Repositorio Git temporario com identidade local e sem assinatura. */
function repositorioGit(arquivos: Record<string, string>): string {
  const dir = dirTemporario('kg2-repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'teste@orkastery.local');
  git('config', 'user.name', 'Teste Orkastery');
  git('config', 'commit.gpgsign', 'false');
  for (const [p, c] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
  git('add', '--', ...Object.keys(arquivos));
  git('commit', '-q', '-m', 'inicial');
  return dir;
}
const REPO_GIT = {
  'orkastery.yaml': 'project:\n  name: "demo"\n  abbrev: "dem"\n',
  'src/a.ts': "import { b } from './b';\nexport function a() { return b(); }\n",
  'src/b.ts': 'export function b() { return 1; }\n',
  'docs/x.md': '# X\n\nVeja [a](../src/a.ts).\n',
};

test('KG2 extract: a leitura do repositorio Git fixa revisao, fontes rastreadas, repositorio e ACL', () => {
  const dir = repositorioGit(REPO_GIT);
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'nao-rastreado.ts'), 'export const z = 1;\n');
    const e = lerRepositorio(path.join(dir, 'src'));
    assert.equal(e.repository_id, 'demo');
    assert.equal(e.tenant_id, 'local');
    assert.deepEqual(e.acl_refs, ['repo:demo:leitura']);
    assert.equal(e.revision, head);
    assert.equal(e.revision_unavailable_reason, null);
    assert.deepEqual(e.fontes.map((f) => f.path).sort(), ['docs/x.md', 'orkastery.yaml', 'src/a.ts', 'src/b.ts']);
    const { grafo } = extrairGrafo(e, { ts });
    assert.equal(grafo.snapshot.revision, head);
    assert.ok(temAresta(grafo, 'calls symbol:src/a.ts#a -> symbol:src/b.ts#b'));
    assert.ok(temAresta(grafo, 'references section:docs/x.md#x -> file:src/a.ts'));
    assert.equal(lerRepositorio(dir, { repository_id: 'outro', tenant_id: 'org', acl_refs: ['acl:x'] }).repository_id, 'outro');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG2 limits: arvore modificada tira a revisao; link simbolico e arquivo sumido ficam fora e declarados', () => {
  const dir = repositorioGit(REPO_GIT);
  try {
    fs.symlinkSync('b.ts', path.join(dir, 'src/ligado.ts'));
    execFileSync('git', ['add', '--', 'src/ligado.ts'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'link'], { cwd: dir });
    fs.rmSync(path.join(dir, 'docs/x.md'));
    fs.appendFileSync(path.join(dir, 'src/b.ts'), '// mudou\n');
    const e = lerRepositorio(dir);
    assert.equal(e.revision, null);
    assert.equal(e.revision_unavailable_reason, 'working-tree-modified');
    assert.deepEqual([...(e.excluidas ?? [])].sort((x, y) => x.path.localeCompare(y.path)), [
      { path: 'docs/x.md', motivo: 'ausente-na-arvore' }, { path: 'src/ligado.ts', motivo: 'link-simbolico' },
    ]);
    const { relatorio, grafo } = extrairGrafo(e, { ts });
    assert.deepEqual(relatorio.excluidas.map((x) => x.motivo).sort(), ['ausente-na-arvore', 'link-simbolico']);
    assert.ok(!grafo.snapshot.source_manifest.some((m) => m.path === 'src/ligado.ts' || m.path === 'docs/x.md'));
    fs.rmSync(path.join(dir, 'orkastery.yaml'));
    assert.throws(() => lerRepositorio(dir), /^Error: extracao\.repositorio\.sem-id/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('KG2 determinism: o comando provisorio verifica, amostra e confere a amostra auditada', () => {
  const dir = repositorioGit(REPO_GIT);
  const script = path.resolve(__dirname, '../../scripts/extrair-grafo.cjs');
  const rodar = (...args: string[]) => spawnSync(process.execPath, [script, '--raiz', dir, ...args], { encoding: 'utf8', timeout: 120_000 });
  try {
    const v = rodar('--verificar');
    assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /conferirFontes verificada/);
    assert.match(v.stdout, /ordem invertida: .* igual/);
    assert.match(v.stdout, /ordem embaralhada: .* igual/);
    const amostra = JSON.parse(rodar('--amostra', '2').stdout);
    assert.ok(amostra.arestas.length > 0);
    const arquivo = path.join(dir, 'amostra.json');
    // Sem veredito, a conferencia reprova: a amostra so vale depois da auditoria manual.
    fs.writeFileSync(arquivo, JSON.stringify(amostra));
    assert.equal(rodar('--conferir-amostra', arquivo).status, 1);
    for (const item of amostra.arestas) Object.assign(item, { veredito: 'supported', nota: 'conferida no teste' });
    fs.writeFileSync(arquivo, JSON.stringify(amostra));
    const c = rodar('--conferir-amostra', arquivo);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    // Trecho auditado que nao bate mais com a fonte reprova.
    amostra.arestas[0].evidencia.trecho_sha256 = '0'.repeat(64);
    fs.writeFileSync(arquivo, JSON.stringify(amostra));
    const d = rodar('--conferir-amostra', arquivo);
    assert.equal(d.status, 1);
    assert.match(d.stdout, /nenhuma evidencia com o trecho auditado/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Embaralhamento reproduzivel (LCG), para a permutacao nao depender de acaso. */
function embaralhar<T>(itens: readonly T[], semente: number): T[] {
  const r = [...itens];
  let s = semente >>> 0;
  for (let i = r.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

test('KG2 determinism: ordem de leitura invertida, embaralhada e repetida dao o mesmo grafo, digest e relatorio', () => {
  const base = entrada({ ...REPO_TS, ...REPO_MD, 'src/extra.ts': "import { soma } from './util';\nexport const x = soma(1, 1);\n" });
  const a = extrairGrafo(base, { ts });
  const variantes = [
    { ...base, fontes: [...base.fontes].reverse() },
    ...[1, 7, 42, 2026].map((s) => ({ ...base, fontes: embaralhar(base.fontes, s) })),
    { ...base, acl_refs: [...base.acl_refs, ...base.acl_refs] },
    base,
  ];
  for (const v of variantes) {
    const b = extrairGrafo(v, { ts });
    assert.equal(b.digest, a.digest);
    assert.deepEqual(b.grafo, a.grafo);
    assert.deepEqual(b.relatorio, a.relatorio);
  }
});

test('KG2 determinism: mudar ACL, bytes de uma fonte ou revisao muda o snapshot', () => {
  const a = extrair(REPO_TS);
  const outraAcl = extrair(REPO_TS, { acl_refs: ['repo:repo-teste:leitura', 'repo:repo-teste:restrito'] });
  const outroByte = extrair({ ...REPO_TS, 'src/app.ts': `${APP}\n` });
  const outraRevisao = extrair(REPO_TS, { revision: 'a'.repeat(40), revision_unavailable_reason: null });
  for (const b of [outraAcl, outroByte, outraRevisao]) {
    assert.notEqual(b.grafo.snapshot.snapshot_id, a.grafo.snapshot.snapshot_id);
    assert.notEqual(b.digest, a.digest);
  }
  assert.notEqual(outraAcl.grafo.snapshot.config_hash, a.grafo.snapshot.config_hash);
  assert.equal(outroByte.grafo.snapshot.config_hash, a.grafo.snapshot.config_hash);
});

test('KG2 limits: despacho por tipo, parametro, local, externo e chamada fora de simbolo nao viram aresta', () => {
  const { grafo, relatorio } = extrair(REPO_TS);
  for (const falsa of [
    'calls symbol:src/app.ts#principal -> symbol:src/util.ts#Calculadora.dobrar',
    'calls symbol:src/app.ts#principal -> symbol:src/util.ts#Forma',
  ]) assert.ok(!temAresta(grafo, falsa), falsa);
  assert.ok(!arestas(grafo, 'calls').some((a) => a.includes('chunk') || a.includes('local') || a.includes('area')));
  assert.deepEqual(relatorio.lacunas_por_categoria, {
    'chamada-alvo-fora-do-grafo': 1, 'chamada-fora-de-simbolo': 1, 'chamada-nao-resolvida': 1, 'chamada-por-tipo': 2,
  });
});

test('KG2 limits: sombreamento por parametro ou local nao liga a chamada ao simbolo de topo', () => {
  const { grafo } = extrair({
    'src/s.ts': [
      'export function alvo() { return 1; }',
      'export function usa(alvo: () => number) { return alvo(); }',
      'export function usa2() { const alvo = () => 2; return alvo(); }',
      'export function usa3() { return alvo(); }',
      '',
    ].join('\n'),
  });
  assert.deepEqual(arestas(grafo, 'calls'), ['calls symbol:src/s.ts#usa3 -> symbol:src/s.ts#alvo']);
});

test('KG2 limits: script global nao liga chamada entre arquivos, e nome em dois arquivos e ambiguo', () => {
  const { grafo, relatorio } = extrair({
    'web/g1.js': 'function comum() { return 1; }\nfunction usa() { return comum() + outra(); }\n',
    'web/g2.js': 'function outra() { return 2; }\nfunction comum() { return 3; }\n',
  });
  assert.deepEqual(arestas(grafo, 'calls'), []);
  assert.deepEqual(relatorio.lacunas.map((l) => [l.categoria, l.path, l.linha, l.detalhe]), [
    ['chamada-alvo-ambiguo', 'web/g1.js', 2, 'comum'],
    ['chamada-global-entre-arquivos', 'web/g1.js', 2, 'outra'],
  ]);
});

test('KG2 limits: require e import dinamicos sem literal viram dynamic-resolution, nunca aresta', () => {
  const { grafo } = extrair({
    'scripts/c.cjs': "const nome = './d.cjs';\nconst m = require(nome);\nimport(`./${nome}`);\nmodule.exports = m;\n",
    'scripts/d.cjs': 'module.exports = 1;\n',
  });
  assert.deepEqual(arestas(grafo, 'imports'), []);
  assert.deepEqual(grafo.diagnostics.map((d) => [d.kind, d.reference]).sort(), [
    ['dynamic-resolution', '`./${nome}`'], ['dynamic-resolution', 'nome'],
  ]);
});

test('KG2 limits: mais de 64 evidencias ficam nas 64 primeiras por posicao, e o excedente e contado', () => {
  const chamadas = Array.from({ length: 70 }, (_, i) => `  alvo(${i});`).join('\n');
  const arquivos = { 'src/m.ts': `export function alvo(n: number) { return n; }\nexport function muitas() {\n${chamadas}\n}\n` };
  const { grafo, relatorio } = extrair(arquivos);
  const a = grafo.edges.find((x) => x.kind === 'calls');
  assert.equal(a?.evidence.length, 64);
  assert.equal(relatorio.evidencias_excedentes, 6);
  const linhas = (a?.evidence ?? []).map((e) => (e.span.type === 'text' ? e.span.line_start ?? 0 : 0)).sort((x, y) => x - y);
  assert.deepEqual(linhas, Array.from({ length: 64 }, (_, i) => i + 3));
});

test('KG2 limits: caminho recusado pelo contrato e caminhos iguais em NFC ficam fora e declarados', () => {
  const nfc = 'docs/caf\u00e9.md', nfd = 'docs/cafe\u0301.md';
  const { grafo, relatorio } = extrair({ ...REPO_TS, 'a/%2e/b.ts': 'export const x = 1;\n', [nfc]: '# a\n', [nfd]: '# b\n' });
  const caminhos = grafo.snapshot.source_manifest.map((m) => m.path);
  assert.deepEqual(caminhos, ['src/app.ts', 'src/util.ts']);
  assert.deepEqual(relatorio.excluidas.map((e) => e.motivo).sort(), ['caminho-ambiguo', 'caminho-ambiguo', 'caminho-recusado']);
  assert.throws(() => extrair({ ...REPO_TS }, { fontes: [...fontesDe(REPO_TS), ...fontesDe({ 'src/app.ts': APP })] }), /^Error: extracao\.entrada\.fonte-duplicada/);
});

test('KG2 limits: a regra de texto do produtor recusa o que o contrato recusa', () => {
  assert.equal(textoAceito('configura\u00e7\u00e3o'), true);
  assert.equal(textoAceito('a\u200db'), true);
  for (const ruim of ['a\u0000b', 'a\u00adb', 'a\u200bb', 'a\u2028b', 'a\ufeffb', 'a\ud800b']) assert.equal(textoAceito(ruim), false, JSON.stringify(ruim));
});
