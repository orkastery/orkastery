/**
 * I-31 KG1 (T1): conformidade do contrato `ork.code-artifact-graph/v1`.
 *
 * Tres grupos, cada um com casos positivos e negativos: "KG1 graph" (identidade, vocabulario e
 * estrutura), "KG1 provenance" (evidencia contra fontes fornecidas) e "KG1 security" (tenant, ACL,
 * caminhos e recusa de inferencia). Os casos invalidos moram no corpus, para outra implementacao
 * poder rodar a mesma conformidade; aqui ficam os que precisam de bytes ou de recalculo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CLASSE_DE_CONFIANCA, GRAFO_SCHEMA, METODOS_DE_EXTRACAO, TIPOS_DE_ARESTA, TIPOS_DE_NO, canonico, compararUtf8,
  conferirFontes, derivarIds, digestDoGrafo, grafoSchema, idDoNo, validarGrafo,
  type FonteFornecida, type GrafoCodigo,
} from '../src/intelligence-graph-contract';

const RAIZ = path.resolve(__dirname, '../../..');
const corpus = JSON.parse(fs.readFileSync(path.join(RAIZ, 'core/test/fixtures/code-artifact-graph-v1.json'), 'utf8'));
const GRAFO: GrafoCodigo = corpus.graph;

type Operacao = { op: 'add' | 'replace' | 'remove'; path: string; value?: unknown };
interface CasoInvalido { group: 'graph' | 'provenance' | 'security'; name: string; code: string; patch: Operacao[] }

/** Subconjunto do JSON Patch (RFC 6902) que o corpus usa: add, replace e remove. */
function aplicar(base: unknown, patch: readonly Operacao[]): unknown {
  const alvo = structuredClone(base);
  for (const o of patch) {
    const partes = o.path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    const ultima = partes.pop() as string;
    let pai = alvo as Record<string, unknown> | unknown[];
    for (const p of partes) pai = (pai as Record<string, unknown>)[p] as Record<string, unknown>;
    if (Array.isArray(pai)) {
      const i = ultima === '-' ? pai.length : Number(ultima);
      if (o.op === 'remove') pai.splice(i, 1);
      else pai.splice(i, o.op === 'add' ? 0 : 1, structuredClone(o.value));
    } else if (o.op === 'remove') delete pai[ultima];
    else pai[ultima] = structuredClone(o.value);
  }
  return alvo;
}

const comCodigo = (codigo: string) => (e: unknown): boolean => e instanceof Error && e.message.split(' ')[0] === codigo;
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function fontesDoCorpus(): Map<string, FonteFornecida> {
  return new Map(corpus.sources.map((s: { path: string; tipo: string; utf8?: string; base64?: string; paginas_utf8?: string[] }) => [
    s.path,
    s.tipo === 'texto'
      ? { tipo: 'texto', bytes: Buffer.from(s.utf8 as string, 'utf8') }
      : { tipo: 'pdf', bytes: Buffer.from(s.base64 as string, 'base64'), paginas: (s.paginas_utf8 as string[]).map((p) => Buffer.from(p, 'utf8')) },
  ]));
}

const indiceDaAresta = (g: GrafoCodigo, kind: string, caminhoDaEvidencia: string): number =>
  g.edges.findIndex((a) => a.kind === kind && a.evidence[0].path === caminhoDaEvidencia);

/** Troca os bytes de uma fonte e reescreve hash e tamanho onde eles aparecem, com ids recalculados. */
function comFonte(g: GrafoCodigo, p: string, bytes: Uint8Array): GrafoCodigo {
  const r = structuredClone(g), hash = sha256(bytes);
  const m = r.snapshot.source_manifest.find((x) => x.path === p) as GrafoCodigo['snapshot']['source_manifest'][number];
  m.source_hash = hash;
  m.size_bytes = bytes.length;
  for (const n of r.nodes) if (n.locator.path === p) n.source_hash = hash;
  for (const a of r.edges) for (const e of a.evidence) if (e.path === p) e.source_hash = hash;
  return derivarIds(r);
}

function trocar(fontes: ReadonlyMap<string, FonteFornecida>, p: string, f: FonteFornecida): Map<string, FonteFornecida> {
  return new Map(fontes).set(p, f);
}

const bytesDe = (fontes: ReadonlyMap<string, FonteFornecida>, p: string): Buffer => Buffer.from((fontes.get(p) as FonteFornecida).bytes);

function invertidoERodado<T>(itens: readonly T[]): T[] {
  const r = [...itens].reverse();
  return r.length > 1 ? [...r.slice(1), r[0]] : r;
}

const casos = corpus.invalid as CasoInvalido[];
for (const grupo of ['graph', 'provenance', 'security'] as const) {
  const doGrupo = casos.filter((c) => c.group === grupo);
  test(`KG1 ${grupo}: o corpus traz casos negativos do grupo`, () => {
    assert.ok(doGrupo.length >= 10, `${grupo}: ${doGrupo.length} casos`);
    assert.equal(new Set(doGrupo.map((c) => c.name)).size, doGrupo.length);
  });
  for (const c of doGrupo) {
    test(`KG1 ${grupo}: recusa ${c.name} com ${c.code}`, () => {
      assert.throws(() => validarGrafo(aplicar(GRAFO, c.patch)), comCodigo(c.code));
    });
  }
}

// ---------------------------------------------------------------- KG1 graph

test('KG1 graph: exemplo sintetico minimo valido, canonico e com digest estavel', () => {
  assert.equal(corpus.data_class, 'synthetic');
  assert.equal(GRAFO.schema, GRAFO_SCHEMA);
  assert.deepEqual(validarGrafo(GRAFO), GRAFO);
  assert.equal(digestDoGrafo(GRAFO), corpus.digest);
  assert.deepEqual([...new Set(GRAFO.nodes.map((n) => n.kind))].sort(), [...TIPOS_DE_NO].sort());
  assert.deepEqual([...new Set(GRAFO.edges.map((a) => a.kind))].sort(), [...TIPOS_DE_ARESTA].sort());
  assert.equal(GRAFO.diagnostics[0].kind, 'unresolved-import');
});

test('KG1 graph: schema JSON publicado coincide com a geracao do contrato e declara o dialeto', () => {
  const arquivo = path.join(RAIZ, 'core/schemas/code-artifact-graph.v1.schema.json');
  const publicado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const converter = zodToJsonSchema as unknown as (schema: unknown, options: object) => unknown;
  assert.deepEqual(converter(grafoSchema, { name: 'CodeArtifactGraph', $refStrategy: 'none' }), publicado);
  assert.equal(publicado.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(publicado.definitions.CodeArtifactGraph.additionalProperties, false);
  assert.equal(publicado.definitions.CodeArtifactGraph.properties.schema.const, GRAFO_SCHEMA);
});

test('KG1 graph: rascunho com ids provisorios vira o mesmo grafo canonico', () => {
  const rascunho = structuredClone(GRAFO);
  const provisorio = new Map(rascunho.nodes.map((n, i) => [n.node_id, `provisorio-${i}`]));
  for (const n of rascunho.nodes) n.node_id = provisorio.get(n.node_id) as string;
  for (const a of rascunho.edges) {
    a.from = provisorio.get(a.from) as string;
    a.to = provisorio.get(a.to) as string;
    a.edge_id = 'provisorio';
  }
  rascunho.snapshot.snapshot_id = 'provisorio';
  assert.throws(() => validarGrafo(rascunho), comCodigo('grafo.estrutura.invalida'));
  assert.deepEqual(derivarIds(rascunho), GRAFO);
});

test('KG1 graph: snapshot alterado muda todas as identidades; a mesma entrada volta ao mesmo digest', () => {
  const alterado = structuredClone(GRAFO);
  alterado.snapshot.config_hash = '1'.repeat(64);
  assert.throws(() => validarGrafo(alterado), comCodigo('grafo.id.divergente'));
  const recalculado = validarGrafo(derivarIds(alterado));
  assert.notEqual(recalculado.snapshot.snapshot_id, GRAFO.snapshot.snapshot_id);
  const antigos = new Set(GRAFO.nodes.map((n) => n.node_id));
  assert.ok(recalculado.nodes.every((n) => !antigos.has(n.node_id)));
  assert.notEqual(digestDoGrafo(recalculado), corpus.digest);
  const devolvido = structuredClone(recalculado);
  devolvido.snapshot.config_hash = GRAFO.snapshot.config_hash;
  assert.equal(digestDoGrafo(derivarIds(devolvido)), corpus.digest);
});

test('KG1 graph: mesmo arquivo em outro repositorio ou tenant tem identidade distinta', () => {
  const [tenant, repo, snap] = [GRAFO.tenant_id, GRAFO.repository_id, GRAFO.snapshot.snapshot_id];
  const locator = { path: 'src/app.ts', fragment: null };
  const base = idDoNo(tenant, repo, snap, 'file', locator);
  assert.notEqual(idDoNo(tenant, 'repo-b', snap, 'file', locator), base);
  assert.notEqual(idDoNo('outro-tenant', repo, snap, 'file', locator), base);
  const outroRepo = validarGrafo(derivarIds({ ...structuredClone(GRAFO), repository_id: 'repo-b' }));
  const outroTenant = validarGrafo(derivarIds(JSON.parse(JSON.stringify(GRAFO).replaceAll('"tenant_id":"synthetic"', '"tenant_id":"outro-tenant"'))));
  const ids = new Set(GRAFO.nodes.map((n) => n.node_id));
  assert.ok([...outroRepo.nodes, ...outroTenant.nodes].every((n) => !ids.has(n.node_id)));
  assert.equal(outroTenant.nodes.length, GRAFO.nodes.length);
});

test('KG1 graph: calls, references e imports podem formar ciclo; contains nao', () => {
  const g = structuredClone(GRAFO);
  const util = g.snapshot.source_manifest.find((m) => m.path === 'src/util.ts') as GrafoCodigo['snapshot']['source_manifest'][number];
  const noDe = (kind: string, p: string, fragment: string | null) =>
    (g.nodes.find((n) => n.kind === kind && n.locator.path === p && n.locator.fragment === fragment) as GrafoCodigo['nodes'][number]).node_id;
  /** Aresta de volta, com evidencia em src/util.ts, que e a fonte de onde ela parte. */
  const deVolta = (kind: GrafoCodigo['edges'][number]['kind'], from: string, to: string, metodo: 'ast' | 'text-location') => {
    const base = structuredClone(g.edges[indiceDaAresta(g, 'calls', 'src/app.ts')]);
    Object.assign(base.evidence[0], { path: 'src/util.ts', source_hash: util.source_hash, source_version: util.source_version,
      extraction_method: metodo, span: { type: 'text', byte_start: 55, byte_end: 61, line_start: 2, line_end: 2 } });
    return { ...base, kind, from, to };
  };
  const [app, fUtil, principal, soma, secao] = [noDe('file', 'src/app.ts', null), noDe('file', 'src/util.ts', null),
    noDe('symbol', 'src/app.ts', 'principal'), noDe('symbol', 'src/util.ts', 'soma'), noDe('section', 'docs/guia.md', 'configuração')];
  g.edges.push(deVolta('calls', soma, principal, 'ast'), deVolta('imports', fUtil, app, 'ast'), deVolta('references', fUtil, secao, 'text-location'));
  const ciclico = validarGrafo(derivarIds(g));
  for (const [kind, de, para] of [['calls', principal, soma], ['imports', app, fUtil], ['references', secao, fUtil]] as const) {
    const ida = ciclico.edges.find((a) => a.kind === kind && a.from === de && a.to === para);
    const volta = ciclico.edges.find((a) => a.kind === kind && a.from === para && a.to === de);
    assert.ok(ida && volta, `${kind} em ciclo`);
  }
  const auxiliar = { ...structuredClone(g.nodes.find((n) => n.node_id === principal) as GrafoCodigo['nodes'][number]), node_id: 'provisorio-auxiliar',
    locator: { path: 'src/app.ts', fragment: 'auxiliar' } };
  const contem = (from: string, to: string) => ({ ...structuredClone(g.edges[indiceDaAresta(g, 'calls', 'src/app.ts')]), kind: 'contains' as const, from, to });
  g.nodes.push(auxiliar);
  g.edges.push(contem(principal, auxiliar.node_id), contem(auxiliar.node_id, principal));
  assert.throws(() => validarGrafo(derivarIds(g)), comCodigo('grafo.aresta.ciclo-contains'));
});

test('KG1 graph: id provisorio repetido no rascunho e recusado, sem redirecionar arestas', () => {
  const g = structuredClone(GRAFO);
  const soma = g.nodes.find((n) => n.locator.fragment === 'soma') as GrafoCodigo['nodes'][number];
  g.nodes.push({ ...structuredClone(soma), locator: { path: 'src/util.ts', fragment: 'subtrai' } });
  assert.throws(() => derivarIds(g), comCodigo('grafo.id.provisorio-duplicado'));
});

test('KG1 graph: canonico ordena chaves por bytes UTF-8 e recusa numero nao finito', () => {
  assert.equal(canonico({ b: 1, a: [2, { d: null, c: 'x' }] }), '{"a":[2,{"c":"x","d":null}],"b":1}');
  // Escape do JSON.stringify do ECMAScript: aspas, barra invertida e controle; o resto vai cru em UTF-8.
  assert.equal(canonico('ç"\\\u0001\n'), '"ç\\"\\\\\\u0001\\n"');
  assert.deepEqual([...Buffer.from(canonico('ç'), 'utf8')], [0x22, 0xc3, 0xa7, 0x22]);
  assert.ok(compararUtf8('￿', '\u{1f600}') < 0, 'code point FFFF antes de 1F600, como nos bytes UTF-8');
  assert.ok('￿' > '\u{1f600}', 'a ordem UTF-16 do JavaScript diverge; o contrato nao depende dela');
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, { x: Number.NEGATIVE_INFINITY }]) {
    assert.throws(() => canonico(v), comCodigo('grafo.canonico.numero-invalido'));
  }
});

// ---------------------------------------------------------------- KG1 provenance

test('KG1 provenance: toda evidencia do exemplo confere com as fontes fornecidas', () => {
  const r = conferirFontes(GRAFO, fontesDoCorpus());
  const total = GRAFO.edges.reduce((n, a) => n + a.evidence.length, 0);
  assert.deepEqual(r, { estado: 'verificada', fontesVerificadas: GRAFO.snapshot.source_manifest.map((m) => m.path),
    fontesIndisponiveis: [], evidenciasVerificadas: total, evidenciasIndisponiveis: 0 });
  assert.ok(GRAFO.edges.every((a) => a.evidence.every((e) => e.confidence_class === CLASSE_DE_CONFIANCA)));
  assert.ok(GRAFO.edges.some((a) => a.evidence.some((e) => e.span.type === 'pdf-text')));
});

test('KG1 provenance: permutar manifesto, nos, arestas e evidencias nao muda identidade nem digest', () => {
  const g = structuredClone(GRAFO);
  const calls = g.edges[indiceDaAresta(g, 'calls', 'src/app.ts')];
  calls.evidence.push({ ...structuredClone(calls.evidence[0]), extraction_method: 'text-location' });
  const comDuas = validarGrafo(derivarIds(g));
  const permutado = structuredClone(comDuas);
  permutado.snapshot.source_manifest = invertidoERodado(permutado.snapshot.source_manifest);
  permutado.snapshot.extractors = invertidoERodado(permutado.snapshot.extractors);
  permutado.nodes = invertidoERodado(permutado.nodes);
  permutado.edges = invertidoERodado(permutado.edges).map((a) => ({ ...a, evidence: invertidoERodado(a.evidence) }));
  assert.notDeepEqual(permutado, comDuas);
  assert.deepEqual(validarGrafo(permutado), comDuas);
  assert.equal(digestDoGrafo(permutado), digestDoGrafo(comDuas));
  assert.deepEqual(derivarIds(permutado), comDuas);
});

test('KG1 provenance: fonte indisponivel fica parcial, distinta de verificada', () => {
  const total = GRAFO.edges.reduce((n, a) => n + a.evidence.length, 0);
  const semFontes = conferirFontes(GRAFO, new Map());
  assert.equal(semFontes.estado, 'parcial');
  assert.deepEqual(semFontes.fontesVerificadas, []);
  assert.equal(semFontes.fontesIndisponiveis.length, GRAFO.snapshot.source_manifest.length);
  assert.equal(semFontes.evidenciasIndisponiveis, total);
  const soTexto = fontesDoCorpus();
  soTexto.delete('docs/manual.pdf');
  const parcial = conferirFontes(GRAFO, soTexto);
  assert.equal(parcial.estado, 'parcial');
  assert.deepEqual(parcial.fontesIndisponiveis, ['docs/manual.pdf']);
  assert.equal(parcial.evidenciasIndisponiveis, 2);
  assert.equal(parcial.evidenciasVerificadas, total - 2);
});

test('KG1 provenance: bytes que nao batem com o manifesto sao recusados', () => {
  const fontes = fontesDoCorpus(), app = bytesDe(fontes, 'src/app.ts');
  const trocado = Buffer.from(app);
  trocado[0] = 0x20;
  assert.throws(() => conferirFontes(GRAFO, trocar(fontes, 'src/app.ts', { tipo: 'texto', bytes: trocado })), comCodigo('grafo.fonte.hash-divergente'));
  assert.throws(() => conferirFontes(GRAFO, trocar(fontes, 'src/app.ts', { tipo: 'texto', bytes: Buffer.concat([app, Buffer.from('\n')]) })),
    comCodigo('grafo.fonte.tamanho-divergente'));
  assert.throws(() => conferirFontes(GRAFO, trocar(fontes, 'src/fantasma.ts', { tipo: 'texto', bytes: app })), comCodigo('grafo.fonte.fora-do-manifesto'));
  const util = Buffer.concat([bytesDe(fontes, 'src/util.ts'), Buffer.from([0xff])]);
  assert.throws(() => conferirFontes(comFonte(GRAFO, 'src/util.ts', util), trocar(fontes, 'src/util.ts', { tipo: 'texto', bytes: util })),
    comCodigo('grafo.fonte.utf8-invalido'));
});

test('KG1 provenance: span fora da fronteira UTF-8 ou com linhas falsas e recusado', () => {
  const g = structuredClone(GRAFO);
  const secao = g.edges[indiceDaAresta(g, 'contains', 'docs/guia.md')].evidence[0].span;
  assert.equal(secao.type, 'text');
  secao.byte_end -= 2; // cai no segundo byte do "ã" de "Configuração"
  const cortado = derivarIds(g);
  assert.deepEqual(validarGrafo(cortado), cortado, 'sem bytes, a estrutura nao ve a fronteira');
  assert.throws(() => conferirFontes(cortado, fontesDoCorpus()), comCodigo('grafo.span.fronteira-utf8'));
  const h = structuredClone(GRAFO);
  Object.assign(h.edges[indiceDaAresta(h, 'calls', 'src/app.ts')].evidence[0].span, { line_start: 1, line_end: 1 });
  assert.throws(() => conferirFontes(derivarIds(h), fontesDoCorpus()), comCodigo('grafo.span.linhas-divergentes'));
});

test('KG1 provenance: fonte binaria confere hash e tamanho, e nao aceita span', () => {
  const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
  const g = structuredClone(GRAFO), app = g.snapshot.source_manifest.find((m) => m.path === 'src/app.ts') as GrafoCodigo['snapshot']['source_manifest'][number];
  g.snapshot.source_manifest.push({ ...structuredClone(app), path: 'assets/logo.png', source_hash: sha256(logo), source_version: 'v1', size_bytes: logo.length });
  const arquivo = structuredClone(g.nodes.find((n) => n.kind === 'file' && n.locator.path === 'src/app.ts') as GrafoCodigo['nodes'][number]);
  g.nodes.push({ ...arquivo, node_id: 'provisorio-logo', locator: { path: 'assets/logo.png', fragment: null }, source_hash: sha256(logo) });
  const comLogo = derivarIds(g), fontes = trocar(fontesDoCorpus(), 'assets/logo.png', { tipo: 'binario', bytes: logo });
  assert.equal(conferirFontes(comLogo, fontes).estado, 'verificada');
  assert.throws(() => conferirFontes(comLogo, trocar(fontes, 'assets/logo.png', { tipo: 'texto', bytes: logo })), comCodigo('grafo.fonte.utf8-invalido'));
  assert.throws(() => conferirFontes(GRAFO, trocar(fontesDoCorpus(), 'src/app.ts', { tipo: 'binario', bytes: bytesDe(fontesDoCorpus(), 'src/app.ts') })),
    comCodigo('grafo.span.tipo-incompativel'));
});

test('KG1 provenance: offset de PDF e do texto da pagina, nunca do binario', () => {
  const fontes = fontesDoCorpus(), i = indiceDaAresta(GRAFO, 'references', 'docs/manual.pdf');
  const pagina = (n: number) => {
    const g = structuredClone(GRAFO);
    Object.assign(g.edges[i].evidence[0].span, { page: n });
    return derivarIds(g);
  };
  assert.throws(() => conferirFontes(pagina(3), fontes), comCodigo('grafo.span.pagina-inexistente'));
  assert.throws(() => conferirFontes(pagina(1), fontes), comCodigo('grafo.span.texto-da-pagina-divergente'));
  const pdf = fontes.get('docs/manual.pdf') as { tipo: 'pdf'; bytes: Buffer; paginas: Buffer[] };
  assert.throws(() => conferirFontes(GRAFO, trocar(fontes, 'docs/manual.pdf', { tipo: 'texto', bytes: pdf.bytes })), comCodigo('grafo.span.tipo-incompativel'));
  const paginaTrocada = [pdf.paginas[0], Buffer.from('Seção 2\nOutro texto qualquer aqui\n')];
  assert.throws(() => conferirFontes(GRAFO, trocar(fontes, 'docs/manual.pdf', { ...pdf, paginas: paginaTrocada })),
    comCodigo('grafo.span.texto-da-pagina-divergente'));
  const binario = structuredClone(GRAFO);
  binario.edges[i].evidence[0].span = { type: 'text', byte_start: 0, byte_end: 4, line_start: null, line_end: null };
  assert.throws(() => conferirFontes(derivarIds(binario), fontes), comCodigo('grafo.span.tipo-incompativel'));
  const longo = structuredClone(GRAFO);
  Object.assign(longo.edges[i].evidence[0].span, { byte_end: pdf.paginas[1].length + 1 });
  assert.throws(() => conferirFontes(derivarIds(longo), fontes), comCodigo('grafo.span.fora-da-fonte'));
});

// ---------------------------------------------------------------- KG1 security

test('KG1 security: restricao da aresta e a conjuncao das fontes; mais restritiva continua valida', () => {
  const i = indiceDaAresta(GRAFO, 'references', 'docs/manual.pdf');
  assert.deepEqual(GRAFO.edges[i].access.acl_refs, ['acl:manuais:restrito', 'acl:repo-sintetico:leitura']);
  const mais = structuredClone(GRAFO);
  mais.edges[i].access.acl_refs = ['acl:auditoria:interna', ...mais.edges[i].access.acl_refs];
  assert.deepEqual(validarGrafo(mais).edges.find((a) => a.edge_id === GRAFO.edges[i].edge_id)?.access.acl_refs.length, 3);
});

test('KG1 security: o contrato nao tem campo de principal, dono ou papel que autorize leitura', () => {
  const nomes = new Set<string>();
  const coletar = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(coletar);
    else if (v && typeof v === 'object') {
      for (const [k, filho] of Object.entries(v)) {
        if (k === 'properties') Object.keys(filho as object).forEach((n) => nomes.add(n));
        coletar(filho);
      }
    }
  };
  coletar(JSON.parse(fs.readFileSync(path.join(RAIZ, 'core/schemas/code-artifact-graph.v1.schema.json'), 'utf8')));
  assert.ok(nomes.has('acl_refs') && nomes.has('tenant_id'));
  for (const proibido of ['principal', 'owner', 'role', 'user', 'actor', 'permissions', 'granted']) assert.ok(!nomes.has(proibido), proibido);
});

test('KG1 security: so metodo deterministico e classe EXTRACTED sustentam aresta', () => {
  assert.deepEqual([...METODOS_DE_EXTRACAO], ['ast', 'structured', 'explicit-link', 'text-location']);
  assert.equal(CLASSE_DE_CONFIANCA, 'EXTRACTED');
  const texto = fs.readFileSync(path.join(RAIZ, 'core/schemas/code-artifact-graph.v1.schema.json'), 'utf8');
  for (const proibido of ['INFERRED', 'embedding', 'vector', 'similarity', 'confidence"']) assert.ok(!texto.includes(proibido), proibido);
});

test('KG1 security: erro de validacao nao ecoa caminho nem conteudo da fonte', () => {
  const segredo = 'segredo-de-cliente-xyz';
  const g = structuredClone(GRAFO) as GrafoCodigo;
  g.snapshot.source_manifest[0].path = `../${segredo}.ts`;
  assert.throws(() => validarGrafo(g), (e: unknown) => e instanceof Error && e.message.startsWith('grafo.caminho.invalido') && !e.message.includes(segredo));
  const fontes = fontesDoCorpus();
  assert.throws(() => conferirFontes(GRAFO, trocar(fontes, `src/${segredo}.ts`, { tipo: 'texto', bytes: Buffer.from(segredo) })),
    (e: unknown) => e instanceof Error && !e.message.includes(segredo));
});
