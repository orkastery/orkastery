/**
 * I-31 KG1 (D1 a D5, D9, D10): contrato `ork.code-artifact-graph/v1` do grafo deterministico
 * de codigo e artefatos.
 *
 * O grafo e projecao local e descartavel: a mesma entrada, configuracao e versao de extrator
 * determinam as mesmas identidades e o mesmo conteudo canonico, em qualquer ordem de insercao.
 * Modulo puro (D10): sem filesystem, rede, subprocesso, parser, banco ou modelo. Bytes de fonte
 * chegam por argumento. Nao amplia o Company Brain v1 nem pluga o adaptador semantico (D9).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const GRAFO_SCHEMA = 'ork.code-artifact-graph/v1' as const;

/** Tetos do contrato: acima deles o payload e recusado, nunca truncado. */
export const GRAFO_LIMITES = Object.freeze({
  manifesto: 100_000, nos: 100_000, arestas: 500_000, evidenciasPorAresta: 64, aclRefs: 32,
  extratores: 32, diagnosticos: 100_000, caminho: 1024, fragmento: 512, paginas: 100_000,
});

export const TIPOS_DE_NO = ['file', 'symbol', 'section', 'artifact'] as const;
export type TipoDeNo = typeof TIPOS_DE_NO[number];
export const TIPOS_DE_ARESTA = ['contains', 'declares', 'imports', 'calls', 'references', 'derived_from'] as const;
export type TipoDeAresta = typeof TIPOS_DE_ARESTA[number];
/** D4: so metodo deterministico sustenta aresta. Embedding, similaridade e inferencia ficam fora. */
export const METODOS_DE_EXTRACAO = ['ast', 'structured', 'explicit-link', 'text-location'] as const;
export const CLASSE_DE_CONFIANCA = 'EXTRACTED' as const;
/** D3: o que o extrator nao resolveu vira diagnostico, nunca aresta nem no externo fabricado. */
export const TIPOS_DE_DIAGNOSTICO = ['unresolved-import', 'dynamic-resolution', 'unsupported-language'] as const;
/** D4: o indice nao e autoridade de fato. Estes esquemas de autoridade apontam para o proprio grafo. */
export const ESQUEMAS_DE_AUTORIDADE_RESERVADOS = ['graph', 'index', 'kg', 'snap', 'node', 'edge'] as const;

const nenhum: readonly TipoDeNo[] = [];
/** D3: matriz fechada, tipo de origem para os tipos de destino permitidos. */
export const MATRIZ_DE_ARESTAS: Readonly<Record<TipoDeAresta, Readonly<Record<TipoDeNo, readonly TipoDeNo[]>>>> = Object.freeze({
  contains: { file: ['section'], symbol: ['symbol'], section: nenhum, artifact: nenhum },
  declares: { file: ['symbol'], symbol: nenhum, section: nenhum, artifact: nenhum },
  imports: { file: ['file', 'symbol'], symbol: ['file', 'symbol'], section: nenhum, artifact: nenhum },
  calls: { file: nenhum, symbol: ['symbol'], section: nenhum, artifact: nenhum },
  references: { file: TIPOS_DE_NO, symbol: TIPOS_DE_NO, section: TIPOS_DE_NO, artifact: TIPOS_DE_NO },
  derived_from: { file: nenhum, symbol: nenhum, section: nenhum, artifact: ['file', 'section', 'artifact'] },
});

const inteiro = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const linha = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const idDeSnapshot = z.string().regex(/^snap-[a-f0-9]{64}$/);
const idDeNo = z.string().regex(/^node-[a-f0-9]{64}$/);
const idDeAresta = z.string().regex(/^edge-[a-f0-9]{64}$/);
const tenant = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
const aclRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/);
const autoridade = z.string().regex(/^[a-z][a-z0-9+.-]{0,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/);
const versaoDaFonte = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/);
const idDeExtrator = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/);
const versaoDeExtrator = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/);
const caminho = z.string().min(1).max(GRAFO_LIMITES.caminho);
const textoCurto = z.string().min(1).max(GRAFO_LIMITES.fragmento);

/** D5: restricao de acesso. Referencias ordenadas, sem repeticao; nenhuma concede permissao. */
export const acessoSchema = z.object({
  tenant_id: tenant, acl_refs: z.array(aclRef).min(1).max(GRAFO_LIMITES.aclRefs),
}).strict();
export const entradaDoManifestoSchema = z.object({
  path: caminho, authority: autoridade, source_hash: sha256, source_version: versaoDaFonte,
  size_bytes: inteiro, access: acessoSchema,
}).strict();
export const extratorSchema = z.object({ extractor_id: idDeExtrator, extractor_version: versaoDeExtrator }).strict();
/** D2: snapshot e manifesto, configuracao e extratores. Nome de branch nao identifica entrada. */
export const snapshotSchema = z.object({
  snapshot_id: idDeSnapshot,
  revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).nullable(),
  revision_unavailable_reason: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable(),
  source_manifest: z.array(entradaDoManifestoSchema).min(1).max(GRAFO_LIMITES.manifesto),
  config_hash: sha256,
  extractors: z.array(extratorSchema).min(1).max(GRAFO_LIMITES.extratores),
  extractors_digest: sha256,
}).strict();
/** D4: offsets em bytes UTF-8 da fonte, inicio inclusivo e fim exclusivo. */
export const spanDeTextoSchema = z.object({
  type: z.literal('text'), byte_start: inteiro, byte_end: inteiro, line_start: linha, line_end: linha,
}).strict();
/** D4: offsets no texto UTF-8 extraido da pagina, nunca no binario do PDF. */
export const spanDePdfSchema = z.object({
  type: z.literal('pdf-text'), page: z.number().int().min(1).max(GRAFO_LIMITES.paginas),
  byte_start: inteiro, byte_end: inteiro, extracted_text_hash: sha256,
}).strict();
export const spanSchema = z.discriminatedUnion('type', [spanDeTextoSchema, spanDePdfSchema]);
export const evidenciaSchema = z.object({
  snapshot_id: idDeSnapshot, path: caminho, source_hash: sha256, source_version: versaoDaFonte,
  authority: autoridade, extractor_id: idDeExtrator, extractor_version: versaoDeExtrator,
  extraction_method: z.enum(METODOS_DE_EXTRACAO), confidence_class: z.literal(CLASSE_DE_CONFIANCA),
  span: spanSchema, access: acessoSchema,
}).strict();
export const noSchema = z.object({
  node_id: idDeNo, kind: z.enum(TIPOS_DE_NO), snapshot_id: idDeSnapshot,
  locator: z.object({ path: caminho, fragment: textoCurto.nullable() }).strict(),
  source_hash: sha256, access: acessoSchema,
}).strict();
export const arestaSchema = z.object({
  edge_id: idDeAresta, kind: z.enum(TIPOS_DE_ARESTA), snapshot_id: idDeSnapshot, from: idDeNo, to: idDeNo,
  evidence: z.array(evidenciaSchema).min(1).max(GRAFO_LIMITES.evidenciasPorAresta), access: acessoSchema,
}).strict();
export const diagnosticoSchema = z.object({
  kind: z.enum(TIPOS_DE_DIAGNOSTICO), path: caminho, reference: textoCurto.nullable(),
  extractor_id: idDeExtrator, extractor_version: versaoDeExtrator, access: acessoSchema,
}).strict();
export const grafoSchema = z.object({
  schema: z.literal(GRAFO_SCHEMA), tenant_id: tenant,
  repository_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  snapshot: snapshotSchema,
  nodes: z.array(noSchema).max(GRAFO_LIMITES.nos),
  edges: z.array(arestaSchema).max(GRAFO_LIMITES.arestas),
  diagnostics: z.array(diagnosticoSchema).max(GRAFO_LIMITES.diagnosticos),
}).strict();

export type Acesso = z.infer<typeof acessoSchema>;
export type EntradaDoManifesto = z.infer<typeof entradaDoManifestoSchema>;
export type Extrator = z.infer<typeof extratorSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Evidencia = z.infer<typeof evidenciaSchema>;
export type No = z.infer<typeof noSchema>;
export type Aresta = z.infer<typeof arestaSchema>;
export type Diagnostico = z.infer<typeof diagnosticoSchema>;
export type GrafoCodigo = z.infer<typeof grafoSchema>;

/** O erro traz o codigo e a posicao estrutural, nunca conteudo de fonte. */
function falha(codigo: string, onde?: string): never {
  throw new Error(onde ? `${codigo} em ${onde}` : codigo);
}

/**
 * Ordem de code points, que e a ordem dos bytes UTF-8: nao depende da linguagem do consumidor.
 * Unidade UTF-16 de surrogate (D800-DFFF) representa code point acima de FFFF e vai para o fim.
 */
export function compararUtf8(a: string, b: string): number {
  const ajuste = (c: number) => (c >= 0xe000 ? c - 0x800 : c >= 0xd800 ? c + 0x2000 : c);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x !== y) return ajuste(x) - ajuste(y);
  }
  return a.length - b.length;
}

/** D2: JSON canonico. Chaves na ordem de bytes UTF-8, sem espaco, so numero finito. */
export function canonico(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : falha('grafo.canonico.numero-invalido');
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort(compararUtf8).map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
  }
  return falha('grafo.canonico.tipo-invalido');
}

/** SHA-256 sobre os bytes UTF-8 do conteudo canonico. */
export const sha256DoCanonico = (v: unknown): string => createHash('sha256').update(canonico(v), 'utf8').digest('hex');
const sha256DosBytes = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Ordena conjunto por chave estavel, calculando cada chave uma vez. */
function ordenado<T>(itens: readonly T[], chave: (t: T) => string): T[] {
  return itens.map((item) => [chave(item), item] as const).sort((a, b) => compararUtf8(a[0], b[0])).map(([, item]) => item);
}

export const digestDosExtratores = (extratores: readonly Extrator[]): string =>
  sha256DoCanonico(ordenado(extratores, (e) => e.extractor_id));

type BaseDoSnapshot = Pick<GrafoCodigo, 'tenant_id' | 'repository_id'> & {
  snapshot: Omit<Snapshot, 'snapshot_id' | 'extractors_digest'>;
};

/** D2: o snapshot deriva de tenant, repositorio, revisao, manifesto, configuracao e extratores. */
export function idDoSnapshot(g: BaseDoSnapshot): string {
  const s = g.snapshot;
  return `snap-${sha256DoCanonico({
    schema: GRAFO_SCHEMA, tenant_id: g.tenant_id, repository_id: g.repository_id,
    revision: s.revision, revision_unavailable_reason: s.revision_unavailable_reason,
    source_manifest: ordenado(s.source_manifest, (m) => m.path), config_hash: s.config_hash,
    extractors: ordenado(s.extractors, (e) => e.extractor_id),
  })}`;
}

/** D2: o no deriva de tenant, repositorio, snapshot, tipo e localizador. */
export function idDoNo(tenantId: string, repositoryId: string, snapshotId: string, kind: TipoDeNo, locator: No['locator']): string {
  return `node-${sha256DoCanonico({ tenant_id: tenantId, repository_id: repositoryId, snapshot_id: snapshotId, kind, locator })}`;
}

/** D2: a aresta deriva de snapshot, tipo, extremidades e evidencias canonicas. */
export function idDaAresta(a: Pick<Aresta, 'snapshot_id' | 'kind' | 'from' | 'to' | 'evidence'>): string {
  return `edge-${sha256DoCanonico({ snapshot_id: a.snapshot_id, kind: a.kind, from: a.from, to: a.to, evidence: ordenado(a.evidence, canonico) })}`;
}

function canonizar(g: GrafoCodigo): GrafoCodigo {
  return {
    ...g,
    snapshot: {
      ...g.snapshot,
      source_manifest: ordenado(g.snapshot.source_manifest, (m) => m.path),
      extractors: ordenado(g.snapshot.extractors, (e) => e.extractor_id),
    },
    nodes: ordenado(g.nodes, (n) => n.node_id),
    edges: ordenado(g.edges.map((a) => ({ ...a, evidence: ordenado(a.evidence, canonico) })), (a) => a.edge_id),
    diagnostics: ordenado(g.diagnostics, canonico),
  };
}

/**
 * Para o produtor (KG2): recalcula snapshot, nos e arestas a partir do conteudo, reescrevendo
 * as extremidades pelo id provisorio de cada no. Nao valida; o resultado passa por validarGrafo.
 */
export function derivarIds(rascunho: GrafoCodigo): GrafoCodigo {
  const g = structuredClone(rascunho), s = g.snapshot;
  s.extractors_digest = digestDosExtratores(s.extractors);
  s.snapshot_id = idDoSnapshot(g);
  const novos = new Map<string, string>();
  for (const n of g.nodes) {
    // Id provisorio repetido tornaria ambigua a extremidade: recusa em vez de escolher um.
    if (novos.has(n.node_id)) falha('grafo.id.provisorio-duplicado');
    n.snapshot_id = s.snapshot_id;
    const id = idDoNo(g.tenant_id, g.repository_id, s.snapshot_id, n.kind, n.locator);
    novos.set(n.node_id, id);
    n.node_id = id;
  }
  for (const a of g.edges) {
    a.snapshot_id = s.snapshot_id;
    a.from = novos.get(a.from) ?? a.from;
    a.to = novos.get(a.to) ?? a.to;
    for (const e of a.evidence) e.snapshot_id = s.snapshot_id;
    a.edge_id = idDaAresta(a);
  }
  return canonizar(g);
}

/**
 * Controle C0 e C1, controles bidirecionais e marcas invisiveis sem uso em nome (hifen suave,
 * espaco de largura zero, juntores de palavra, BOM), que fazem um nome parecer outro. ZWJ e ZWNJ
 * ficam: emoji e escritas como a persa e as indicas dependem deles.
 */
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;
const SURROGATE_ISOLADO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const textoValido = (t: string): boolean => !CONTROLE.test(t) && !SURROGATE_ISOLADO.test(t);

/**
 * D2: caminho relativo a raiz declarada, com "/" e caixa preservada. O contrato compara caminhos
 * como texto e nao normaliza: forma ambigua e recusada, para dois caminhos distintos nunca se
 * fundirem em silencio. Escape percentual (`%2e`, `%252e`) e recusado inteiro, porque um
 * consumidor que decodifica uma ou duas vezes chegaria a outro caminho. Primeiro segmento com
 * ":" parece esquema de URL ou drive e tambem e recusado.
 */
export function caminhoValido(p: string): boolean {
  if (!p || !textoValido(p) || p.includes('\\') || p.startsWith('/') || /%[0-9A-Fa-f]{2}/.test(p)) return false;
  const segmentos = p.split('/');
  if (segmentos[0].includes(':')) return false;
  return segmentos.every((segmento) => segmento !== '' && segmento !== '.' && segmento !== '..');
}

const autoridadeDoIndice = (a: string): boolean =>
  (ESQUEMAS_DE_AUTORIDADE_RESERVADOS as readonly string[]).includes(a.slice(0, a.indexOf(':')));

function contem(maior: readonly string[], menor: Iterable<string>): boolean {
  const s = new Set(maior);
  for (const x of menor) if (!s.has(x)) return false;
  return true;
}

function conferirAcesso(a: Acesso, tenantId: string, onde: string): void {
  if (a.tenant_id !== tenantId) falha('grafo.acesso.tenant-divergente', onde);
  for (let i = 1; i < a.acl_refs.length; i++) {
    const c = compararUtf8(a.acl_refs[i - 1], a.acl_refs[i]);
    if (c === 0) falha('grafo.acesso.acl-duplicada', onde);
    if (c > 0) falha('grafo.acesso.acl-fora-de-ordem', onde);
  }
}

interface Contexto {
  snapshotId: string;
  tenantId: string;
  manifesto: Map<string, EntradaDoManifesto>;
  extratores: Set<string>;
}

const chaveDoExtrator = (id: string, versao: string): string => `${id}@${versao}`;

function conferirEvidencia(e: Evidencia, c: Contexto, onde: string): void {
  if (e.snapshot_id !== c.snapshotId) falha('grafo.snapshot.divergente', onde);
  if (!caminhoValido(e.path)) falha('grafo.caminho.invalido', onde);
  const m = c.manifesto.get(e.path);
  if (!m) falha('grafo.proveniencia.fonte-ausente', onde);
  if (e.source_hash !== m.source_hash || e.source_version !== m.source_version) falha('grafo.proveniencia.fonte-divergente', onde);
  if (autoridadeDoIndice(e.authority)) falha('grafo.proveniencia.autoridade-indice', onde);
  if (e.authority !== m.authority) falha('grafo.proveniencia.autoridade-divergente', onde);
  if (!c.extratores.has(chaveDoExtrator(e.extractor_id, e.extractor_version))) falha('grafo.proveniencia.extrator-nao-fixado', onde);
  const s = e.span;
  if (s.byte_start >= s.byte_end) falha('grafo.span.intervalo-invalido', onde);
  if (s.type === 'text') {
    if (s.byte_end > m.size_bytes) falha('grafo.span.fora-da-fonte', onde);
    if ((s.line_start === null) !== (s.line_end === null) || (s.line_start !== null && s.line_end !== null && s.line_start > s.line_end)) {
      falha('grafo.span.linhas-invalidas', onde);
    }
  }
  conferirAcesso(e.access, c.tenantId, onde);
  if (!contem(e.access.acl_refs, m.access.acl_refs)) falha('grafo.acesso.restricao-omitida', onde);
}

/** Hierarquia `contains` sem ciclo, em profundidade iterativa para nao estourar a pilha. */
function semCiclo(filhos: Map<string, string[]>): boolean {
  const estado = new Map<string, 'aberto' | 'fechado'>();
  for (const raiz of filhos.keys()) {
    if (estado.has(raiz)) continue;
    estado.set(raiz, 'aberto');
    const pilha: [string, number][] = [[raiz, 0]];
    while (pilha.length) {
      const topo = pilha[pilha.length - 1], lista = filhos.get(topo[0]) ?? [];
      if (topo[1] === lista.length) {
        estado.set(topo[0], 'fechado');
        pilha.pop();
        continue;
      }
      const filho = lista[topo[1]++], visto = estado.get(filho);
      if (visto === 'aberto') return false;
      if (!visto) {
        estado.set(filho, 'aberto');
        pilha.push([filho, 0]);
      }
    }
  }
  return true;
}

function semantica(g: GrafoCodigo): void {
  const s = g.snapshot;
  if ((s.revision === null) === (s.revision_unavailable_reason === null)) falha('grafo.snapshot.revisao-inconsistente', 'snapshot');
  const c: Contexto = { snapshotId: s.snapshot_id, tenantId: g.tenant_id, manifesto: new Map(), extratores: new Set() };
  const normalizados = new Set<string>();
  s.source_manifest.forEach((m, i) => {
    const onde = `snapshot.source_manifest.${i}`;
    if (!caminhoValido(m.path)) falha('grafo.caminho.invalido', onde);
    if (c.manifesto.has(m.path)) falha('grafo.manifesto.duplicado', onde);
    // NFC e NFD sao caminhos distintos aqui, mas um sistema de arquivos que normaliza os fundiria.
    const normalizado = m.path.normalize('NFC');
    if (normalizados.has(normalizado)) falha('grafo.manifesto.caminho-ambiguo', onde);
    normalizados.add(normalizado);
    if (autoridadeDoIndice(m.authority)) falha('grafo.proveniencia.autoridade-indice', onde);
    conferirAcesso(m.access, g.tenant_id, onde);
    c.manifesto.set(m.path, m);
  });
  const idsDeExtrator = new Set<string>();
  s.extractors.forEach((e, i) => {
    if (idsDeExtrator.has(e.extractor_id)) falha('grafo.extrator.duplicado', `snapshot.extractors.${i}`);
    idsDeExtrator.add(e.extractor_id);
    c.extratores.add(chaveDoExtrator(e.extractor_id, e.extractor_version));
  });

  const nos = new Map<string, No>(), localizadores = new Set<string>();
  g.nodes.forEach((n, i) => {
    const onde = `nodes.${i}`;
    if (n.snapshot_id !== s.snapshot_id) falha('grafo.snapshot.divergente', onde);
    if (!caminhoValido(n.locator.path)) falha('grafo.caminho.invalido', onde);
    if ((n.kind === 'file') !== (n.locator.fragment === null)) falha('grafo.no.localizador-invalido', onde);
    if (n.locator.fragment !== null && !textoValido(n.locator.fragment)) falha('grafo.texto.invalido', onde);
    const m = c.manifesto.get(n.locator.path);
    if (!m) falha('grafo.no.fonte-ausente', onde);
    if (n.source_hash !== m.source_hash) falha('grafo.no.hash-divergente', onde);
    conferirAcesso(n.access, g.tenant_id, onde);
    if (!contem(n.access.acl_refs, m.access.acl_refs)) falha('grafo.acesso.restricao-omitida', onde);
    const localizador = canonico([n.kind, n.locator]);
    if (nos.has(n.node_id) || localizadores.has(localizador)) falha('grafo.no.duplicado', onde);
    nos.set(n.node_id, n);
    localizadores.add(localizador);
  });

  const arestas = new Set<string>(), triplas = new Set<string>(), contidos = new Map<string, string[]>(), pais = new Set<string>();
  const textosDePagina = new Map<string, string>();
  g.edges.forEach((a, i) => {
    const onde = `edges.${i}`;
    if (a.snapshot_id !== s.snapshot_id) falha('grafo.snapshot.divergente', onde);
    const de = nos.get(a.from), para = nos.get(a.to);
    if (!de || !para) falha('grafo.aresta.endpoint-ausente', onde);
    if (!MATRIZ_DE_ARESTAS[a.kind][de.kind].includes(para.kind)) falha('grafo.aresta.kind-incompativel', onde);
    // Hierarquia e declaracao moram dentro de um arquivo; a relacao entre arquivos e imports ou references.
    if ((a.kind === 'contains' || a.kind === 'declares') && de.locator.path !== para.locator.path) falha('grafo.aresta.fora-do-arquivo', onde);
    // D5: conjuncao das restricoes das extremidades e das evidencias, nunca uniao de permissoes.
    const exigidas = new Set([...de.access.acl_refs, ...para.access.acl_refs]), vistas = new Set<string>();
    a.evidence.forEach((e, j) => {
      const ondeDaEvidencia = `${onde}.evidence.${j}`;
      conferirEvidencia(e, c, ondeDaEvidencia);
      if (e.span.type === 'pdf-text') {
        // A mesma pagina da mesma fonte tem um texto extraido so; dois hashes nao podem valer juntos.
        const pagina = canonico([e.path, e.span.page]), anterior = textosDePagina.get(pagina);
        if (anterior !== undefined && anterior !== e.span.extracted_text_hash) falha('grafo.span.texto-da-pagina-divergente', ondeDaEvidencia);
        textosDePagina.set(pagina, e.span.extracted_text_hash);
      }
      const chave = canonico(e);
      if (vistas.has(chave)) falha('grafo.proveniencia.evidencia-duplicada', ondeDaEvidencia);
      vistas.add(chave);
      e.access.acl_refs.forEach((r) => exigidas.add(r));
    });
    // A relacao e observada na fonte de onde ela parte: sem evidencia la, a aresta nao e localizavel.
    if (!a.evidence.some((e) => e.path === de.locator.path)) falha('grafo.proveniencia.origem-fora-do-endpoint', onde);
    conferirAcesso(a.access, g.tenant_id, onde);
    if (!contem(a.access.acl_refs, exigidas)) falha('grafo.acesso.restricao-omitida', onde);
    const tripla = canonico([a.kind, a.from, a.to]);
    if (arestas.has(a.edge_id) || triplas.has(tripla)) falha('grafo.aresta.duplicada', onde);
    arestas.add(a.edge_id);
    triplas.add(tripla);
    if (a.kind === 'contains') {
      // Depois da duplicata: a mesma aresta repetida e duplicata, nao um segundo pai.
      if (pais.has(a.to)) falha('grafo.aresta.contains-com-dois-pais', onde);
      pais.add(a.to);
      const lista = contidos.get(a.from) ?? [];
      lista.push(a.to);
      contidos.set(a.from, lista);
    }
  });
  if (!semCiclo(contidos)) falha('grafo.aresta.ciclo-contains');

  const diagnosticos = new Set<string>();
  g.diagnostics.forEach((d, i) => {
    const onde = `diagnostics.${i}`;
    if (!caminhoValido(d.path)) falha('grafo.caminho.invalido', onde);
    if (d.reference !== null && !textoValido(d.reference)) falha('grafo.texto.invalido', onde);
    const m = c.manifesto.get(d.path);
    if (!m) falha('grafo.diagnostico.fonte-ausente', onde);
    if (!c.extratores.has(chaveDoExtrator(d.extractor_id, d.extractor_version))) falha('grafo.proveniencia.extrator-nao-fixado', onde);
    conferirAcesso(d.access, g.tenant_id, onde);
    if (!contem(d.access.acl_refs, m.access.acl_refs)) falha('grafo.acesso.restricao-omitida', onde);
    const chave = canonico(d);
    if (diagnosticos.has(chave)) falha('grafo.diagnostico.duplicado', onde);
    diagnosticos.add(chave);
  });

  // D2: id fornecido pelo produtor e recalculado; divergencia e recusa, nunca correcao silenciosa.
  if (s.extractors_digest !== digestDosExtratores(s.extractors) || s.snapshot_id !== idDoSnapshot(g)) falha('grafo.id.divergente', 'snapshot');
  g.nodes.forEach((n, i) => {
    if (n.node_id !== idDoNo(g.tenant_id, g.repository_id, s.snapshot_id, n.kind, n.locator)) falha('grafo.id.divergente', `nodes.${i}`);
  });
  g.edges.forEach((a, i) => {
    if (a.edge_id !== idDaAresta(a)) falha('grafo.id.divergente', `edges.${i}`);
  });
}

/**
 * Validacao estrutural e semantica pura. Devolve o grafo na forma canonica (conjuntos ordenados)
 * ou lanca erro com codigo `grafo.*`. Sem fontes, a evidencia so e conferida na estrutura.
 */
export function validarGrafo(entrada: unknown): GrafoCodigo {
  if (entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada) && 'schema' in entrada &&
      (entrada as { schema: unknown }).schema !== GRAFO_SCHEMA) falha('grafo.versao.incompativel');
  const r = grafoSchema.safeParse(entrada);
  if (!r.success) falha('grafo.estrutura.invalida', r.error.issues[0]?.path.join('.') || 'raiz');
  semantica(r.data);
  return canonizar(r.data);
}

/** D2: digest canonico do grafo valido; permutar nos, arestas ou evidencias nao o muda. */
export const digestDoGrafo = (entrada: unknown): string => sha256DoCanonico(validarGrafo(entrada));

/**
 * Bytes que o chamador ja leu. O contrato nunca abre caminho nem extrai PDF. `binario` confere
 * so hash e tamanho e nao aceita span; `texto` exige UTF-8 valido; `pdf` traz as paginas extraidas.
 */
export type FonteFornecida =
  | { tipo: 'texto'; bytes: Uint8Array }
  | { tipo: 'binario'; bytes: Uint8Array }
  | { tipo: 'pdf'; bytes: Uint8Array; paginas: readonly Uint8Array[] };

export interface ConferenciaDeFontes {
  /** `parcial` quando falta fonte ou evidencia sem bytes: indisponivel nao e verificado. */
  estado: 'verificada' | 'parcial';
  fontesVerificadas: string[];
  fontesIndisponiveis: string[];
  evidenciasVerificadas: number;
  evidenciasIndisponiveis: number;
}

function utf8Valido(b: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

const fronteiraUtf8 = (b: Uint8Array, i: number): boolean => i === b.length || (i < b.length && (b[i] & 0xc0) !== 0x80);

function quebrasDeLinha(b: Uint8Array): number[] {
  const q: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] === 0x0a) q.push(i);
  return q;
}

/** Linha (1-based) do byte `o`: uma a mais que as quebras antes dele. */
function linhaDoByte(quebras: readonly number[], o: number): number {
  let baixo = 0, alto = quebras.length;
  while (baixo < alto) {
    const meio = (baixo + alto) >> 1;
    if (quebras[meio] < o) baixo = meio + 1;
    else alto = meio;
  }
  return baixo + 1;
}

/**
 * D4: confere hash, tamanho e spans contra bytes fornecidos. Acerto de span nao prova que o
 * parser interpretou a relacao certo; essa prova vem da auditoria de arestas do benchmark.
 */
export function conferirFontes(entrada: unknown, fontes: ReadonlyMap<string, FonteFornecida>): ConferenciaDeFontes {
  const g = validarGrafo(entrada);
  const manifesto = new Map(g.snapshot.source_manifest.map((m) => [m.path, m]));
  for (const [p, f] of fontes) {
    if (!manifesto.has(p)) falha('grafo.fonte.fora-do-manifesto');
    const tipo = f !== null && typeof f === 'object' ? (f as { tipo: unknown }).tipo : undefined;
    if (!['texto', 'binario', 'pdf'].includes(tipo as string)) falha('grafo.fonte.tipo-desconhecido');
    if (!(f.bytes instanceof Uint8Array) || (f.tipo === 'pdf' && !(Array.isArray(f.paginas) && f.paginas.every((x) => x instanceof Uint8Array)))) {
      falha('grafo.fonte.incompleta');
    }
  }
  const fontesVerificadas: string[] = [], fontesIndisponiveis: string[] = [];
  g.snapshot.source_manifest.forEach((m, i) => {
    const onde = `snapshot.source_manifest.${i}`, f = fontes.get(m.path);
    if (!f) {
      fontesIndisponiveis.push(m.path);
      return;
    }
    if (f.bytes.length !== m.size_bytes) falha('grafo.fonte.tamanho-divergente', onde);
    if (sha256DosBytes(f.bytes) !== m.source_hash) falha('grafo.fonte.hash-divergente', onde);
    const textos = f.tipo === 'texto' ? [f.bytes] : f.tipo === 'pdf' ? f.paginas : [];
    if (!textos.every(utf8Valido)) falha('grafo.fonte.utf8-invalido', onde);
    fontesVerificadas.push(m.path);
  });
  const quebras = new Map<string, number[]>();
  let evidenciasVerificadas = 0, evidenciasIndisponiveis = 0;
  g.edges.forEach((a, i) => a.evidence.forEach((e, j) => {
    const onde = `edges.${i}.evidence.${j}`, f = fontes.get(e.path), s = e.span;
    if (!f) {
      evidenciasIndisponiveis++;
      return;
    }
    let texto: Uint8Array;
    if (s.type === 'text') {
      if (f.tipo !== 'texto') falha('grafo.span.tipo-incompativel', onde);
      texto = f.bytes;
    } else {
      if (f.tipo !== 'pdf') falha('grafo.span.tipo-incompativel', onde);
      if (s.page > f.paginas.length) falha('grafo.span.pagina-inexistente', onde);
      texto = f.paginas[s.page - 1];
      if (sha256DosBytes(texto) !== s.extracted_text_hash) falha('grafo.span.texto-da-pagina-divergente', onde);
    }
    if (s.byte_end > texto.length) falha('grafo.span.fora-da-fonte', onde);
    if (!fronteiraUtf8(texto, s.byte_start) || !fronteiraUtf8(texto, s.byte_end)) falha('grafo.span.fronteira-utf8', onde);
    if (s.type === 'text' && s.line_start !== null) {
      const q = quebras.get(e.path) ?? quebrasDeLinha(texto);
      quebras.set(e.path, q);
      if (linhaDoByte(q, s.byte_start) !== s.line_start || linhaDoByte(q, s.byte_end - 1) !== s.line_end) {
        falha('grafo.span.linhas-divergentes', onde);
      }
    }
    evidenciasVerificadas++;
  }));
  const completa = fontesIndisponiveis.length === 0 && evidenciasIndisponiveis === 0;
  return { estado: completa ? 'verificada' : 'parcial', fontesVerificadas, fontesIndisponiveis, evidenciasVerificadas, evidenciasIndisponiveis };
}
