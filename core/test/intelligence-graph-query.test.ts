/**
 * RM-031 KG3: consulta sobre o grafo do indice (D5 a D7).
 *
 * Grupos: "KG3 query" (resolucao de no, vizinhanca, chamadores, importadores, caminho, proveniencia
 * e ACL) e "KG3 determinism" (mesma pergunta, mesma saida byte a byte). O grafo vem do extrator do
 * KG2 sobre um repositorio em memoria com estrutura conhecida.
 */
import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';
import { derivarIds, validarGrafo, type GrafoCodigo } from '../src/intelligence-graph-contract';
import { extrairGrafo, type EntradaDeExtracao, type Parser } from '../src/intelligence-graph-extract';
import { carregarAnalisadores } from '../src/intelligence-graph-parsers';
import {
  AVISO_DE_PARCIALIDADE, CONSULTA_SCHEMA, ErroDeConsulta, caminho, chamadores, importadores, jsonDaResposta, prepararConsulta,
  resolverNo, rotuloDoNo, textoDaResposta, vizinhos, type CabecalhoDoIndice, type Concessao, type GrafoConsultavel, type RespostaDeConsulta,
} from '../src/intelligence-graph-query';

const REPO: Record<string, string> = {
  'src/util.ts': [
    'export function soma(a: number, b: number): number { return a + b; }',
    'export function dobro(x: number): number { return soma(x, x); }',
    'export class Calc {',
    '  static criar(): Calc { return new Calc(); }',
    '  total(x: number): number { return dobro(x); }',
    '}',
    '',
  ].join('\n'),
  'src/app.ts': [
    "import { dobro, soma } from './util';",
    "import * as u from './util';",
    'export function principal(): number { return dobro(2) + soma(1, 2) + u.soma(3, 4); }',
    'export function outra(): number { return principal(); }',
    '',
  ].join('\n'),
  'src/solto.ts': 'export function soma(): number { return 0; }\nexport function isolado(): number { return 1; }\n',
  'docs/guia.md': '# Guia\n\nVeja [app](../src/app.ts).\n\n## Detalhe\n\n[util](../src/util.ts)\n',
};
const CONCESSAO: Concessao = { tenant_id: 'local', acl_refs: ['repo:demo:leitura'] };

let PARSER: Parser;
let GRAFO: GrafoCodigo;
let G: GrafoConsultavel;
before(() => {
  PARSER = carregarAnalisadores();
  GRAFO = extrair(Object.keys(REPO));
  G = prepararConsulta(GRAFO, CONCESSAO);
});

function extrair(ordem: string[]): GrafoCodigo {
  const entrada: EntradaDeExtracao = {
    tenant_id: 'local', repository_id: 'demo', revision: null, revision_unavailable_reason: 'repositorio-sintetico',
    acl_refs: ['repo:demo:leitura'], fontes: ordem.map((p) => ({ path: p, bytes: Buffer.from(REPO[p], 'utf8') })),
  };
  return extrairGrafo(entrada, PARSER).grafo;
}

const cabecalho = (g: GrafoCodigo, arvore: CabecalhoDoIndice['arvore'] = 'limpa'): CabecalhoDoIndice => ({
  repository_id: g.repository_id, revision: 'a'.repeat(40), chave: `idx-${'b'.repeat(64)}`, snapshot_id: g.snapshot.snapshot_id,
  graph_digest: 'c'.repeat(64), arvore, extratores: g.snapshot.extractors,
});
const pares = (r: RespostaDeConsulta): string[] => r.arestas.map((a) => `${a.kind} ${a.from} -> ${a.to}`);
const erroDe = (f: () => unknown): ErroDeConsulta => {
  try {
    f();
  } catch (e) {
    assert.ok(e instanceof ErroDeConsulta, String(e));
    return e;
  }
  assert.fail('sem erro');
};

test('KG3 query: resolverNo por caminho, caminho#fragmento, tipo e nome solto; ambiguo lista candidatos', () => {
  const r = (t: string) => rotuloDoNo(resolverNo(G, t));
  assert.equal(r('src/app.ts'), 'file src/app.ts');
  assert.equal(r('src/util.ts#dobro'), 'symbol src/util.ts#dobro');
  assert.equal(r('symbol:src/util.ts#Calc.criar'), 'symbol src/util.ts#Calc.criar');
  assert.equal(r('file:src/util.ts'), 'file src/util.ts');
  assert.equal(r('docs/guia.md#detalhe'), 'section docs/guia.md#detalhe');
  assert.equal(r('dobro'), 'symbol src/util.ts#dobro');
  assert.equal(r('Calc.total'), 'symbol src/util.ts#Calc.total');
  assert.equal(r('guia'), 'section docs/guia.md#guia');
  const amb = erroDe(() => resolverNo(G, 'soma'));
  assert.equal(amb.codigo, 'grafo.consulta.ambiguo');
  assert.deepEqual(amb.candidatos, ['symbol src/solto.ts#soma', 'symbol src/util.ts#soma']);
  for (const t of ['naoexiste', 'src/nada.ts', 'src/util.ts#nada', 'file:src/app.ts#principal', 'section:src/util.ts#dobro', 'symbol:dobro']) {
    const e = erroDe(() => resolverNo(G, t));
    assert.deepEqual([e.codigo, e.message], ['grafo.consulta.no-desconhecido', `grafo.consulta.no-desconhecido: ${t}`], t);
  }
  assert.equal(erroDe(() => resolverNo(G, '')).codigo, 'grafo.consulta.uso');
});

test('KG3 query: vizinhos com profundidade, sentido, tipos e limite', () => {
  const c = cabecalho(GRAFO);
  const base = vizinhos(G, c, 'src/util.ts#dobro');
  assert.equal(base.schema, CONSULTA_SCHEMA);
  assert.deepEqual(pares(base), [
    'calls symbol src/app.ts#principal -> symbol src/util.ts#dobro',
    'calls symbol src/util.ts#Calc.total -> symbol src/util.ts#dobro',
    'calls symbol src/util.ts#dobro -> symbol src/util.ts#soma',
    'declares file src/util.ts -> symbol src/util.ts#dobro',
    'imports file src/app.ts -> symbol src/util.ts#dobro',
  ]);
  assert.deepEqual(base.nos.map((n) => `${n.distancia} ${n.rotulo}`), [
    '0 symbol src/util.ts#dobro', '1 file src/app.ts', '1 file src/util.ts', '1 symbol src/app.ts#principal',
    '1 symbol src/util.ts#Calc.total', '1 symbol src/util.ts#soma',
  ]);
  assert.deepEqual([base.total_arestas, base.truncado, base.parcial], [5, false, AVISO_DE_PARCIALIDADE]);
  assert.deepEqual(pares(vizinhos(G, c, 'dobro', { sentido: 'saida' })), ['calls symbol src/util.ts#dobro -> symbol src/util.ts#soma']);
  assert.equal(vizinhos(G, c, 'dobro', { tipos: ['calls'] }).total_arestas, 3);
  const fundo = vizinhos(G, c, 'dobro', { profundidade: 2, sentido: 'entrada', tipos: ['calls'] });
  assert.deepEqual(pares(fundo), [
    'calls symbol src/app.ts#outra -> symbol src/app.ts#principal',
    'calls symbol src/app.ts#principal -> symbol src/util.ts#dobro',
    'calls symbol src/util.ts#Calc.total -> symbol src/util.ts#dobro',
  ]);
  assert.equal(fundo.nos.find((n) => n.rotulo === 'symbol src/app.ts#outra')?.distancia, 2);
  const curto = vizinhos(G, c, 'dobro', { limite: 2 });
  assert.deepEqual([curto.arestas.length, curto.total_arestas, curto.truncado], [2, 5, true]);
  assert.deepEqual(pares(curto), pares(base).slice(0, 2));
  for (const errado of [{ profundidade: 0 }, { profundidade: 6 }, { limite: 0 }, { limite: 1.5 }, { sentido: 'lado' as never }, { tipos: ['usa' as never] }, { tipos: [] }]) {
    assert.equal(erroDe(() => vizinhos(G, c, 'dobro', errado)).codigo, 'grafo.consulta.uso', JSON.stringify(errado));
  }
});

test('KG3 query: chamadores de simbolo e importadores de arquivo e de simbolo', () => {
  const c = cabecalho(GRAFO);
  const ch = chamadores(G, c, 'src/util.ts#soma');
  assert.deepEqual(pares(ch), ['calls symbol src/app.ts#principal -> symbol src/util.ts#soma', 'calls symbol src/util.ts#dobro -> symbol src/util.ts#soma']);
  assert.equal(ch.arestas[0].evidencias.length, 2, 'soma(1, 2) e u.soma(3, 4) na mesma aresta');
  assert.deepEqual([ch.consulta.tipo, ch.consulta.sentido, ch.consulta.tipos], ['chamadores', 'entrada', ['calls']]);
  // Raio 2: entram as arestas que chegam aos nos a 1 salto, tambem a que liga dois deles.
  assert.deepEqual(pares(chamadores(G, c, 'src/util.ts#soma', { profundidade: 2 })), [
    'calls symbol src/app.ts#outra -> symbol src/app.ts#principal',
    'calls symbol src/app.ts#principal -> symbol src/util.ts#dobro',
    'calls symbol src/app.ts#principal -> symbol src/util.ts#soma',
    'calls symbol src/util.ts#Calc.total -> symbol src/util.ts#dobro',
    'calls symbol src/util.ts#dobro -> symbol src/util.ts#soma',
  ]);
  assert.equal(chamadores(G, c, 'isolado').total_arestas, 0, 'sem chamador e resposta, nao erro');
  assert.deepEqual(pares(chamadores(G, c, 'Calc')), ['calls symbol src/util.ts#Calc.criar -> symbol src/util.ts#Calc']);
  assert.equal(erroDe(() => chamadores(G, c, 'src/app.ts')).codigo, 'grafo.consulta.alvo-invalido');
  const im = importadores(G, c, 'src/util.ts');
  assert.deepEqual(pares(im), ['imports file src/app.ts -> file src/util.ts']);
  assert.equal(im.arestas[0].evidencias.length, 2, 'os dois imports de ./util');
  assert.deepEqual(pares(importadores(G, c, 'src/util.ts#soma')), ['imports file src/app.ts -> symbol src/util.ts#soma']);
  assert.equal(importadores(G, c, 'src/solto.ts').total_arestas, 0);
  assert.equal(erroDe(() => importadores(G, c, 'docs/guia.md#guia')).codigo, 'grafo.consulta.alvo-invalido');
});

test('KG3 query: caminho mais curto no sentido da aresta, contra ela com ambos, e ausencia tipada', () => {
  const c = cabecalho(GRAFO);
  const curto = caminho(G, c, 'outra', 'src/util.ts#soma');
  assert.deepEqual(curto.caminho?.map((p) => `${p.sentido} ${p.aresta.kind} ${p.aresta.from} -> ${p.aresta.to}`), [
    'saida calls symbol src/app.ts#outra -> symbol src/app.ts#principal',
    'saida calls symbol src/app.ts#principal -> symbol src/util.ts#soma',
  ]);
  assert.deepEqual(curto.nos.map((n) => `${n.distancia} ${n.rotulo}`), ['0 symbol src/app.ts#outra', '1 symbol src/app.ts#principal', '2 symbol src/util.ts#soma']);
  assert.equal(curto.para?.distancia, 2);
  const nada = caminho(G, c, 'src/util.ts#soma', 'outra');
  assert.deepEqual([nada.caminho, nada.nos_explorados, nada.total_arestas], [null, 1, 0]);
  assert.match(textoDaResposta(nada), /sem caminho de symbol src\/util\.ts#soma para symbol src\/app\.ts#outra \(sentido saida\): 1 nos explorados/);
  const contra = caminho(G, c, 'src/util.ts#soma', 'outra', { sentido: 'ambos' });
  assert.deepEqual(contra.caminho?.map((p) => `${p.sentido} ${p.aresta.from} -> ${p.aresta.to}`), [
    'entrada symbol src/app.ts#principal -> symbol src/util.ts#soma',
    'entrada symbol src/app.ts#outra -> symbol src/app.ts#principal',
  ]);
  assert.deepEqual(caminho(G, c, 'docs/guia.md', 'dobro').caminho?.map((p) => p.aresta.kind), ['contains', 'references', 'declares']);
  assert.deepEqual(caminho(G, c, 'src/app.ts', 'src/util.ts#soma', { tipos: ['imports'] }).caminho?.length, 1);
  assert.equal(caminho(G, c, 'docs/guia.md', 'dobro', { tipos: ['calls'] }).caminho, null);
  const mesmo = caminho(G, c, 'dobro', 'src/util.ts#dobro');
  assert.deepEqual([mesmo.caminho, mesmo.nos.length], [[], 1]);
  assert.equal(erroDe(() => caminho(G, c, 'soma', 'dobro')).codigo, 'grafo.consulta.ambiguo');
});

test('KG3 query: cada aresta traz extrator, versao, metodo e evidencia que batem com os bytes da fonte', () => {
  const c = cabecalho(GRAFO);
  const versoes = new Map(GRAFO.snapshot.extractors.map((e) => [e.extractor_id, e.extractor_version]));
  const r = vizinhos(G, c, 'src/util.ts', { profundidade: 5 });
  assert.ok(r.total_arestas >= 20, `${r.total_arestas}`);
  const vistos = new Set<string>();
  for (const a of r.arestas) {
    assert.ok(a.evidencias.length >= 1);
    for (const e of a.evidencias) {
      assert.equal(e.extractor_version, versoes.get(e.extractor_id), e.extractor_id);
      assert.equal(e.path, a.from.slice(a.from.indexOf(' ') + 1).split('#')[0], 'a evidencia fica no arquivo da origem');
      assert.equal(e.span.type, 'text');
      const s = e.span as { byte_start: number; byte_end: number; line_start: number; line_end: number };
      const bytes = Buffer.from(REPO[e.path], 'utf8'), trecho = bytes.subarray(s.byte_start, s.byte_end).toString('utf8');
      assert.equal(s.line_start, bytes.subarray(0, s.byte_start).toString('utf8').split('\n').length, 'linha do inicio');
      const alvo = (a.to.split('#')[1] ?? '').split('.').pop() as string;
      if (a.kind === 'calls') assert.match(trecho, new RegExp(`(^|\\.|new )${alvo}\\($`), trecho);
      if (a.kind === 'imports' && a.to.startsWith('file ')) assert.match(trecho, /^import .* from '\.\/util';$/);
      if (a.kind === 'imports' && a.to.startsWith('symbol ')) assert.equal(trecho, alvo);
      if (a.kind === 'references') assert.match(trecho, /^\[(app|util)\]\(\.\.\/src\/(app|util)\.ts\)$/);
      if (a.kind === 'declares') assert.match(trecho, new RegExp(`^export (function|class) ${alvo}\\b`));
      if (a.kind === 'contains' && a.to.startsWith('section ')) assert.match(trecho, /^#+ (Guia|Detalhe)$/);
      vistos.add(`${a.kind}/${e.extractor_id}/${e.extraction_method}`);
    }
  }
  assert.deepEqual([...vistos].sort(), [
    'calls/ork.ts-ast/ast', 'contains/ork.md-structure/structured', 'contains/ork.ts-ast/ast', 'declares/ork.ts-ast/ast',
    'imports/ork.ts-ast/ast', 'references/ork.md-structure/explicit-link',
  ]);
  const texto = textoDaResposta(chamadores(G, c, 'src/util.ts#soma'));
  assert.match(texto, /^  calls  symbol src\/app\.ts#principal -> symbol src\/util\.ts#soma$/m);
  assert.match(texto, /^      ork\.ts-ast ast src\/app\.ts:3 bytes \d+-\d+$/m);
  assert.match(texto, /^extratores: .*ork\.ts-ast 1\.0\.0\+typescript\./m);
});

/** O grafo com `src/util.ts#dobro` numa ACL a mais, valido no contrato. */
function comDobroRestrito(): GrafoCodigo {
  const g = structuredClone(GRAFO);
  const dobro = g.nodes.find((n) => n.locator.path === 'src/util.ts' && n.locator.fragment === 'dobro');
  assert.ok(dobro);
  const mais = (refs: string[]) => [...refs, 'repo:secreto:leitura'].sort();
  dobro.access = { ...dobro.access, acl_refs: mais(dobro.access.acl_refs) };
  for (const a of g.edges) if (a.from === dobro.node_id || a.to === dobro.node_id) a.access = { ...a.access, acl_refs: mais(a.access.acl_refs) };
  return validarGrafo(derivarIds(g));
}

test('KG3 query: no de outra ACL e invisivel em resposta, contagem, candidato, caminho e erro', () => {
  const restrito = comDobroRestrito(), c = cabecalho(restrito);
  const g = prepararConsulta(restrito, CONCESSAO);
  for (const t of ['dobro', 'src/util.ts#dobro', 'symbol:src/util.ts#dobro']) {
    const e = erroDe(() => resolverNo(g, t));
    assert.deepEqual([e.codigo, e.message, e.candidatos], ['grafo.consulta.no-desconhecido', `grafo.consulta.no-desconhecido: ${t}`, []], 'igual a no inexistente');
  }
  const doArquivo = vizinhos(g, c, 'src/util.ts');
  assert.equal(doArquivo.total_arestas, vizinhos(G, cabecalho(GRAFO), 'src/util.ts').total_arestas - 1, 'o declares de dobro sai da contagem');
  const json = jsonDaResposta(vizinhos(g, c, 'src/util.ts', { profundidade: 5 }));
  assert.ok(!json.includes('#dobro'), 'nada de dobro na vizinhanca');
  assert.deepEqual(pares(chamadores(g, c, 'src/util.ts#soma', { profundidade: 3 })), [
    'calls symbol src/app.ts#outra -> symbol src/app.ts#principal', 'calls symbol src/app.ts#principal -> symbol src/util.ts#soma',
  ]);
  assert.equal(caminho(g, c, 'Calc.total', 'src/util.ts#soma').caminho, null, 'o caminho por dobro sumiu');
  assert.equal(caminho(G, cabecalho(GRAFO), 'Calc.total', 'src/util.ts#soma').caminho?.length, 2);
  assert.equal(importadores(g, c, 'src/util.ts#soma').total_arestas, 1);
  // Com a referencia a mais concedida, o no volta; com outro tenant, nada e visivel.
  assert.equal(rotuloDoNo(resolverNo(prepararConsulta(restrito, { tenant_id: 'local', acl_refs: ['repo:demo:leitura', 'repo:secreto:leitura'] }), 'dobro')), 'symbol src/util.ts#dobro');
  const outroTenant = prepararConsulta(GRAFO, { tenant_id: 'outro', acl_refs: ['repo:demo:leitura'] });
  assert.equal(erroDe(() => resolverNo(outroTenant, 'src/app.ts')).codigo, 'grafo.consulta.no-desconhecido');
  assert.equal(outroTenant.nos.size, 0);
  // Aresta mais restrita que as pontas (o contrato aceita): some sozinha, as pontas ficam.
  const g3 = structuredClone(GRAFO);
  const rotulo = new Map(g3.nodes.map((n) => [n.node_id, rotuloDoNo(n)]));
  const chamada = g3.edges.find((a) => a.kind === 'calls' && rotulo.get(a.from) === 'symbol src/app.ts#principal' && rotulo.get(a.to) === 'symbol src/util.ts#dobro');
  assert.ok(chamada);
  chamada.access = { ...chamada.access, acl_refs: ['repo:demo:leitura', 'repo:secreto:leitura'] };
  const g3c = prepararConsulta(validarGrafo(derivarIds(g3)), CONCESSAO);
  assert.deepEqual(pares(chamadores(g3c, cabecalho(GRAFO), 'dobro')), ['calls symbol src/util.ts#Calc.total -> symbol src/util.ts#dobro']);
  assert.equal(rotuloDoNo(resolverNo(g3c, 'principal')), 'symbol src/app.ts#principal');
  // Candidatos do nome ambiguo tambem so trazem visiveis.
  const soma = GRAFO.nodes.find((n) => n.locator.path === 'src/solto.ts' && n.locator.fragment === 'soma');
  const g2 = structuredClone(GRAFO);
  const alvo = g2.nodes.find((n) => n.node_id === soma?.node_id);
  assert.ok(alvo);
  alvo.access = { ...alvo.access, acl_refs: ['repo:demo:leitura', 'repo:secreto:leitura'] };
  for (const a of g2.edges) if (a.to === alvo.node_id || a.from === alvo.node_id) a.access = { ...a.access, acl_refs: ['repo:demo:leitura', 'repo:secreto:leitura'] };
  assert.equal(rotuloDoNo(resolverNo(prepararConsulta(validarGrafo(derivarIds(g2)), CONCESSAO), 'soma')), 'symbol src/util.ts#soma', 'o candidato negado nao conta');
});

test('KG3 query: o texto traz cabecalho, aviso de arvore modificada, contagem e a parcialidade', () => {
  const r = vizinhos(G, cabecalho(GRAFO, 'modificada'), 'dobro');
  const t = textoDaResposta(r);
  assert.match(t, /^grafo de demo na revisao aaaaaaaaaaaa, indice idx-bbbbbbbbbbbb, snapshot snap-/);
  assert.match(t, /^aviso: a arvore tem mudanca rastreada; a resposta e do HEAD, nao da arvore$/m);
  assert.match(t, /^vizinhos de symbol src\/util\.ts#dobro \(profundidade 1, sentido ambos, tipos todos\): 5 aresta\(s\), 5 no\(s\)$/m);
  assert.ok(t.endsWith(AVISO_DE_PARCIALIDADE));
  assert.ok(!textoDaResposta(vizinhos(G, cabecalho(GRAFO), 'dobro')).includes('aviso:'));
  assert.match(textoDaResposta(vizinhos(G, cabecalho(GRAFO), 'dobro', { limite: 1 })), /^truncado: 1 de 5 arestas; use --limite$/m);
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

function todasAsConsultas(g: GrafoConsultavel, c: CabecalhoDoIndice): string[] {
  const respostas = [
    vizinhos(g, c, 'src/util.ts', { profundidade: 3 }), vizinhos(g, c, 'dobro', { sentido: 'entrada' }),
    chamadores(g, c, 'src/util.ts#soma', { profundidade: 2 }), importadores(g, c, 'src/util.ts'),
    caminho(g, c, 'docs/guia.md', 'dobro'), caminho(g, c, 'src/util.ts#soma', 'outra', { sentido: 'ambos' }),
  ];
  return respostas.flatMap((r) => [jsonDaResposta(r), textoDaResposta(r)]);
}

test('KG3 determinism: a mesma pergunta da a mesma saida byte a byte, repetida e com o grafo em outra ordem', () => {
  const c = cabecalho(GRAFO);
  const base = todasAsConsultas(G, c);
  assert.deepEqual(todasAsConsultas(prepararConsulta(GRAFO, CONCESSAO), c), base, 'repetida');
  const outraExtracao = extrair([...Object.keys(REPO)].reverse());
  assert.deepEqual(outraExtracao, GRAFO, 'extracao em outra ordem da o mesmo grafo');
  for (const semente of [1, 7, 2026]) {
    const baguncado: GrafoCodigo = {
      ...outraExtracao,
      nodes: embaralhar(outraExtracao.nodes, semente),
      edges: embaralhar(outraExtracao.edges, semente + 1).map((a) => ({ ...a, evidence: embaralhar(a.evidence, semente + 2) })),
    };
    assert.deepEqual(todasAsConsultas(prepararConsulta(baguncado, CONCESSAO), c), base, `semente ${semente}`);
  }
});

test('KG3 determinism: a saida nao tem horario nem tempo', () => {
  for (const s of todasAsConsultas(G, cabecalho(GRAFO))) {
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:/.test(s), 'sem data e hora');
    assert.ok(!/"(ms|duracao|tempo|em|ts)":/.test(s), 'sem campo de tempo');
  }
});
