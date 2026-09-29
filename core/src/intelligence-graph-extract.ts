/**
 * RM-031 KG2 (D1, D7 a D10): extracao deterministica do grafo `ork.code-artifact-graph/v1`.
 *
 * Modulo puro: recebe os bytes das fontes e o compilador TypeScript por parametro (D1), sem abrir
 * arquivo, rede ou processo. As fontes sao ordenadas antes de tudo e os IDs saem do contrato
 * (`derivarIds`), entao a ordem de leitura nao muda o grafo nem o relatorio. O que nenhum extrator
 * prova vira diagnostico do contrato ou lacuna do relatorio (D7), nunca aresta nem no fabricado.
 */
import { createHash } from 'node:crypto';
import type * as TS from 'typescript';
import {
  CLASSE_DE_CONFIANCA, GRAFO_LIMITES, GRAFO_SCHEMA, TIPOS_DE_ARESTA, TIPOS_DE_DIAGNOSTICO, TIPOS_DE_NO, caminhoValido, canonico,
  compararUtf8, derivarIds, sha256DoCanonico, validarGrafo,
  type Acesso, type Aresta, type Diagnostico, type EntradaDoManifesto, type Evidencia, type Extrator, type GrafoCodigo, type No,
  type TipoDeAresta, type TipoDeNo,
} from './intelligence-graph-contract';
import { CHAVES_DO_FRONTMATTER, PADRAO_DE_ID, extrairMarkdown } from './intelligence-graph-extract-md';
import { OPCOES_TS_DESCRITAS, extrairTypeScript } from './intelligence-graph-extract-ts';

export const EXTRATOR_TS = 'ork.ts-ast';
export const EXTRATOR_MD = 'ork.md-structure';
export const EXTRATOR_ID = 'ork.id-mention';
/** D9: declara o arquivo do manifesto que nenhum extrator leu. */
export const EXTRATOR_ARQUIVOS = 'ork.repo-files';
/** Versao da regra de extracao; a do compilador entra no `extractor_version` do `ork.ts-ast`. */
export const VERSAO_KG2 = '1.0.0';
export const RELATORIO_SCHEMA = 'ork.graph-extraction-report/v0' as const;
export const CONFIG_SCHEMA = 'ork.graph-extraction-config/v0' as const;
export const EXTENSOES_TS = ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'] as const;
export const EXTENSOES_MD = ['.markdown', '.md'] as const;
/** D7: categorias de lacuna volumosas saem so na contagem; as demais saem tambem listadas. */
export const LACUNAS_SO_CONTAGEM: ReadonlySet<string> = new Set([
  'chamada-fora-de-simbolo', 'chamada-nao-resolvida', 'chamada-alvo-fora-do-grafo', 'chamada-por-tipo', 'import-sem-simbolo',
  'id-sem-artefato', 'link-externo',
]);

export type MetodoDeExtracao = Evidencia['extraction_method'];
export type TipoDeDiagnostico = Diagnostico['kind'];

/** Fonte ja lida pelo chamador: caminho relativo a raiz do repositorio e bytes. */
export interface FonteDoRepositorio { path: string; bytes: Uint8Array }
/** Fonte que ficou fora do manifesto, com o motivo; o contrato v1 nao tem onde registrar isso. */
export interface Exclusao { path: string; motivo: string }

export interface EntradaDeExtracao {
  tenant_id: string;
  repository_id: string;
  revision: string | null;
  revision_unavailable_reason: string | null;
  acl_refs: readonly string[];
  fontes: readonly FonteDoRepositorio[];
  /** Exclusoes ja feitas por quem leu o repositorio (link simbolico, arquivo ausente). */
  excluidas?: readonly Exclusao[];
}

/** D1: o compilador chega por parametro; este modulo so conhece o seu tipo. */
export interface Parser { ts: typeof TS }

/** Extremidade de aresta antes do ID: tipo e localizador. */
export interface RefDeNo { kind: TipoDeNo; path: string; fragment: string | null }
/** Trecho em offsets do texto decodificado (unidades UTF-16), inicio inclusivo e fim exclusivo. */
export interface Trecho { path: string; inicio: number; fim: number }
export interface AchadoDeAresta {
  kind: TipoDeAresta; from: RefDeNo; to: RefDeNo; extrator: string; metodo: MetodoDeExtracao; trecho: Trecho;
}
export interface AchadoDeDiagnostico { kind: TipoDeDiagnostico; path: string; reference: string | null; extrator: string }
export interface Lacuna { categoria: string; path: string; inicio: number | null; detalhe: string | null }
export interface Achados { nos: RefDeNo[]; arestas: AchadoDeAresta[]; diagnosticos: AchadoDeDiagnostico[]; lacunas: Lacuna[] }
export interface FonteDeTexto { path: string; texto: string }

export interface LacunaDoRelatorio { categoria: string; path: string; linha: number | null; detalhe: string | null }
/** D7: relatorio provisorio fora do contrato; ordenado, sem horario, com digest reproduzivel. */
export interface RelatorioDeExtracao {
  schema: typeof RELATORIO_SCHEMA;
  snapshot_id: string;
  graph_digest: string;
  contagens: {
    fontes: number;
    nos: Record<TipoDeNo, number>;
    arestas: Record<TipoDeAresta, number>;
    diagnosticos: Record<TipoDeDiagnostico, number>;
    evidencias: number;
  };
  evidencias_excedentes: number;
  excluidas: Exclusao[];
  lacunas_por_categoria: Record<string, number>;
  lacunas: LacunaDoRelatorio[];
}

export interface ResultadoDaExtracao { grafo: GrafoCodigo; digest: string; relatorio: RelatorioDeExtracao }

function falha(codigo: string, onde?: string): never {
  throw new Error(onde ? `${codigo} em ${onde}` : codigo);
}

/**
 * Replica da regra de texto do contrato (controles, marcas invisiveis, surrogate isolado), para o
 * produtor descartar referencia que o contrato recusaria. O corpus do KG1 e a autoridade.
 */
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;
const SURROGATE_ISOLADO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const textoAceito = (t: string): boolean => !CONTROLE.test(t) && !SURROGATE_ISOLADO.test(t);

/** Texto curto que cabe em `reference` ou `fragment`; fora disso, `null` (nunca truncado). */
export function textoCurto(t: string): string | null {
  const limpo = t.trim();
  return limpo.length >= 1 && limpo.length <= GRAFO_LIMITES.fragmento && textoAceito(limpo) ? limpo : null;
}

/** Extensao do nome do arquivo em minusculas (`.ts`); arquivo oculto sem ponto no meio nao tem. */
export function extensaoDe(caminho: string): string {
  const nome = caminho.slice(caminho.lastIndexOf('/') + 1), i = nome.lastIndexOf('.');
  return i <= 0 ? '' : nome.slice(i).toLowerCase();
}

/** D8: id de blob do Git, calculado dos bytes; igual ao `git hash-object` do arquivo. */
export function idDeBlob(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** UTF-8 estrito, com o BOM preservado para os offsets baterem com os bytes. */
export function decodificarUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Converte offset UTF-16 do texto em offset de byte UTF-8 e em linha (1-based). */
class MapaDoTexto {
  private bytes: Uint32Array | null = null;
  private quebras: number[] | null = null;

  constructor(private readonly texto: string, private readonly tamanho: number) {}

  byte(i: number): number {
    if (this.tamanho === this.texto.length) return i;
    if (!this.bytes) {
      const t = this.texto, acc = new Uint32Array(t.length + 1);
      for (let j = 0; j < t.length; j++) {
        const c = t.charCodeAt(j);
        // Par de surrogates e um code point de 4 bytes; o texto veio de UTF-8 valido, sem surrogate isolado.
        if (c >= 0xd800 && c <= 0xdbff && j + 1 < t.length) {
          acc[j + 1] = acc[j] + 4;
          acc[j + 2] = acc[j + 1];
          j++;
          continue;
        }
        acc[j + 1] = acc[j] + (c < 0x80 ? 1 : c < 0x800 ? 2 : 3);
      }
      this.bytes = acc;
    }
    return this.bytes[i];
  }

  linha(i: number): number {
    if (!this.quebras) {
      const q: number[] = [];
      for (let j = this.texto.indexOf('\n'); j >= 0; j = this.texto.indexOf('\n', j + 1)) q.push(j);
      this.quebras = q;
    }
    let baixo = 0, alto = this.quebras.length;
    while (baixo < alto) {
      const meio = (baixo + alto) >> 1;
      if (this.quebras[meio] < i) baixo = meio + 1;
      else alto = meio;
    }
    return baixo + 1;
  }
}

const chaveDoNo = (r: RefDeNo): string => canonico([r.kind, r.path, r.fragment]);
const zeros = '0'.repeat(64);

function contagemVazia<T extends string>(chaves: readonly T[]): Record<T, number> {
  return Object.fromEntries(chaves.map((k) => [k, 0])) as Record<T, number>;
}

/**
 * Extrai o grafo das fontes fornecidas. Lanca `extracao.*` para entrada invalida ou teto do
 * contrato estourado (D10), e `grafo.*` se o resultado violar o contrato (defeito do extrator).
 */
export function extrairGrafo(entrada: EntradaDeExtracao, parser: Parser): ResultadoDaExtracao {
  const { ts } = parser;
  const acl = [...new Set(entrada.acl_refs)].sort(compararUtf8);
  const access: Acesso = { tenant_id: entrada.tenant_id, acl_refs: acl };
  const authority = `git:${entrada.repository_id}`;

  const fontes = [...entrada.fontes].sort((a, b) => compararUtf8(a.path, b.path));
  for (let i = 1; i < fontes.length; i++) if (fontes[i - 1].path === fontes[i].path) falha('extracao.entrada.fonte-duplicada');

  // O contrato recusa o grafo inteiro por um caminho ruim; aqui o caminho sai e fica declarado.
  const excluidas: Exclusao[] = (entrada.excluidas ?? []).map((e) => ({ path: e.path, motivo: e.motivo }));
  const validas = fontes.filter((f) => {
    const ok = f.path.length <= GRAFO_LIMITES.caminho && caminhoValido(f.path);
    if (!ok) excluidas.push({ path: f.path, motivo: 'caminho-recusado' });
    return ok;
  });
  const porNfc = new Map<string, number>();
  for (const f of validas) porNfc.set(f.path.normalize('NFC'), (porNfc.get(f.path.normalize('NFC')) ?? 0) + 1);
  const aceitas = validas.filter((f) => {
    const ok = porNfc.get(f.path.normalize('NFC')) === 1;
    if (!ok) excluidas.push({ path: f.path, motivo: 'caminho-ambiguo' });
    return ok;
  });
  if (aceitas.length === 0) falha('extracao.entrada.sem-fontes');
  if (aceitas.length > GRAFO_LIMITES.manifesto) falha('extracao.limite.manifesto');

  const manifesto = new Map<string, EntradaDoManifesto>();
  for (const f of aceitas) {
    manifesto.set(f.path, {
      path: f.path, authority, source_hash: sha256(f.bytes), source_version: idDeBlob(f.bytes), size_bytes: f.bytes.length, access,
    });
  }
  const bytesDe = new Map(aceitas.map((f) => [f.path, f.bytes]));
  const textos = new Map<string, string | null>();
  const texto = (p: string): string | undefined => {
    if (!textos.has(p)) {
      const b = bytesDe.get(p);
      textos.set(p, b ? decodificarUtf8(b) : null);
    }
    return textos.get(p) ?? undefined;
  };

  const achados: Achados = { nos: [], arestas: [], diagnosticos: [], lacunas: [] };
  const juntar = (a: Achados): void => {
    achados.nos.push(...a.nos);
    achados.arestas.push(...a.arestas);
    achados.diagnosticos.push(...a.diagnosticos);
    achados.lacunas.push(...a.lacunas);
  };
  const caminhos = aceitas.map((f) => f.path);
  const fontesTs: FonteDeTexto[] = [], fontesMd: FonteDeTexto[] = [];
  for (const p of caminhos) {
    const ext = extensaoDe(p), ehTs = (EXTENSOES_TS as readonly string[]).includes(ext), ehMd = (EXTENSOES_MD as readonly string[]).includes(ext);
    if (!ehTs && !ehMd) {
      // D9: o arquivo vira no, e o diagnostico diz que o conteudo dele nao foi lido.
      achados.diagnosticos.push({ kind: 'unsupported-language', path: p, reference: ext || null, extrator: EXTRATOR_ARQUIVOS });
      continue;
    }
    const t = texto(p);
    if (t === undefined) achados.lacunas.push({ categoria: 'utf8-invalido', path: p, inicio: null, detalhe: null });
    else (ehTs ? fontesTs : fontesMd).push({ path: p, texto: t });
  }
  const versaoTs = `${VERSAO_KG2}+typescript.${ts.version}`;
  // B1: a raiz virtual do compilador deriva do manifesto; um caminho do repositorio nao a nomeia.
  const raiz = `/ork-${sha256DoCanonico([...manifesto.values()].map((m) => [m.path, m.source_hash])).slice(0, 32)}`;
  const aceitaFragmento = (f: string): boolean => f.length >= 1 && f.length <= GRAFO_LIMITES.fragmento && textoAceito(f);
  juntar(extrairTypeScript({ fontes: fontesTs, arquivos: caminhos, texto, raiz, aceitaFragmento, extrator: EXTRATOR_TS }, ts));
  const simbolos = new Set(achados.nos.filter((r) => r.kind === 'symbol').map((r) => `${r.path}#${r.fragment}`));
  juntar(extrairMarkdown({ fontes: fontesMd, codigo: fontesTs, arquivos: caminhos, simbolos, extratorMd: EXTRATOR_MD, extratorId: EXTRATOR_ID }));

  const extratores: Extrator[] = [
    { extractor_id: EXTRATOR_ARQUIVOS, extractor_version: VERSAO_KG2 },
    { extractor_id: EXTRATOR_ID, extractor_version: VERSAO_KG2 },
    { extractor_id: EXTRATOR_MD, extractor_version: VERSAO_KG2 },
    { extractor_id: EXTRATOR_TS, extractor_version: versaoTs },
  ];
  const versoes = new Map(extratores.map((e) => [e.extractor_id, e.extractor_version]));
  const versaoDe = (id: string): string => versoes.get(id) ?? falha('extracao.interna.extrator-desconhecido');

  // Nos: todo arquivo do manifesto e os nos que os extratores provaram.
  const nos = new Map<string, RefDeNo>();
  for (const p of caminhos) nos.set(chaveDoNo({ kind: 'file', path: p, fragment: null }), { kind: 'file', path: p, fragment: null });
  for (const r of achados.nos) {
    if (!manifesto.has(r.path)) falha('extracao.interna.no-sem-fonte');
    if (r.fragment === null || !textoAceito(r.fragment) || r.fragment.length > GRAFO_LIMITES.fragmento) falha('extracao.interna.fragmento');
    nos.set(chaveDoNo(r), r);
  }
  if (nos.size > GRAFO_LIMITES.nos) falha('extracao.limite.nos');

  const mapas = new Map<string, MapaDoTexto>();
  const mapaDe = (p: string): MapaDoTexto => {
    let m = mapas.get(p);
    if (!m) {
      const t = texto(p);
      if (t === undefined) falha('extracao.interna.trecho-sem-texto');
      m = new MapaDoTexto(t, (bytesDe.get(p) as Uint8Array).length);
      mapas.set(p, m);
    }
    return m;
  };

  // D10: uma aresta por (tipo, origem, destino), com as evidencias ordenadas por posicao.
  const arestas = new Map<string, { kind: TipoDeAresta; from: RefDeNo; to: RefDeNo; evidencias: Map<string, Evidencia> }>();
  for (const a of achados.arestas) {
    const kf = chaveDoNo(a.from), kt = chaveDoNo(a.to);
    if (!nos.has(kf) || !nos.has(kt)) falha('extracao.interna.extremidade-ausente');
    if (a.trecho.path !== a.from.path) falha('extracao.interna.evidencia-fora-da-origem');
    if (!(a.trecho.inicio < a.trecho.fim)) falha('extracao.interna.trecho-vazio');
    const m = mapaDe(a.trecho.path), fonte = manifesto.get(a.trecho.path) as EntradaDoManifesto;
    const e: Evidencia = {
      snapshot_id: `snap-${zeros}`, path: fonte.path, source_hash: fonte.source_hash, source_version: fonte.source_version, authority,
      extractor_id: a.extrator, extractor_version: versaoDe(a.extrator), extraction_method: a.metodo, confidence_class: CLASSE_DE_CONFIANCA,
      span: { type: 'text', byte_start: m.byte(a.trecho.inicio), byte_end: m.byte(a.trecho.fim), line_start: m.linha(a.trecho.inicio), line_end: m.linha(a.trecho.fim - 1) },
      access,
    };
    const chave = `${a.kind}\u0000${kf}\u0000${kt}`;
    let atual = arestas.get(chave);
    if (!atual) arestas.set(chave, (atual = { kind: a.kind, from: a.from, to: a.to, evidencias: new Map() }));
    atual.evidencias.set(canonico(e), e);
  }
  if (arestas.size > GRAFO_LIMITES.arestas) falha('extracao.limite.arestas');

  const idProvisorio = (r: RefDeNo): string => `node-${sha256DoCanonico([r.kind, r.path, r.fragment])}`;
  let excedentes = 0;
  const edges: Aresta[] = [...arestas.values()].map((a) => {
    const evidencias = [...a.evidencias.values()].sort((x, y) =>
      (x.span.byte_start - y.span.byte_start) || (x.span.byte_end - y.span.byte_end)
      || compararUtf8(x.extractor_id, y.extractor_id) || compararUtf8(x.extraction_method, y.extraction_method));
    excedentes += Math.max(0, evidencias.length - GRAFO_LIMITES.evidenciasPorAresta);
    return {
      edge_id: `edge-${zeros}`, kind: a.kind, snapshot_id: `snap-${zeros}`, from: idProvisorio(a.from), to: idProvisorio(a.to),
      evidence: evidencias.slice(0, GRAFO_LIMITES.evidenciasPorAresta), access,
    };
  });

  const diagnosticos = new Map<string, Diagnostico>();
  for (const d of achados.diagnosticos) {
    if (!manifesto.has(d.path)) falha('extracao.interna.diagnostico-sem-fonte');
    const reference = d.reference === null ? null : textoCurto(d.reference);
    const diag: Diagnostico = { kind: d.kind, path: d.path, reference, extractor_id: d.extrator, extractor_version: versaoDe(d.extrator), access };
    diagnosticos.set(canonico(diag), diag);
  }
  if (diagnosticos.size > GRAFO_LIMITES.diagnosticos) falha('extracao.limite.diagnosticos');

  const config = {
    schema: CONFIG_SCHEMA, authority, acl_refs: acl, evidencias_por_aresta: GRAFO_LIMITES.evidenciasPorAresta,
    typescript: { extensoes: EXTENSOES_TS, opcoes: OPCOES_TS_DESCRITAS },
    markdown: { extensoes: EXTENSOES_MD, ancora: 'github-slug', artefato: PADRAO_DE_ID.source, frontmatter: CHAVES_DO_FRONTMATTER },
  };
  const rascunho: GrafoCodigo = {
    schema: GRAFO_SCHEMA, tenant_id: entrada.tenant_id, repository_id: entrada.repository_id,
    snapshot: {
      snapshot_id: `snap-${zeros}`, revision: entrada.revision, revision_unavailable_reason: entrada.revision_unavailable_reason,
      source_manifest: [...manifesto.values()], config_hash: sha256DoCanonico(config), extractors: extratores, extractors_digest: zeros,
    },
    nodes: [...nos.values()].map((r): No => ({
      node_id: idProvisorio(r), kind: r.kind, snapshot_id: `snap-${zeros}`, locator: { path: r.path, fragment: r.fragment },
      source_hash: (manifesto.get(r.path) as EntradaDoManifesto).source_hash, access,
    })),
    edges,
    diagnostics: [...diagnosticos.values()],
  };
  const grafo = validarGrafo(derivarIds(rascunho));
  const digest = sha256DoCanonico(grafo);

  const contagens: RelatorioDeExtracao['contagens'] = {
    fontes: grafo.snapshot.source_manifest.length, nos: contagemVazia(TIPOS_DE_NO), arestas: contagemVazia(TIPOS_DE_ARESTA),
    diagnosticos: contagemVazia(TIPOS_DE_DIAGNOSTICO), evidencias: 0,
  };
  for (const n of grafo.nodes) contagens.nos[n.kind]++;
  for (const a of grafo.edges) {
    contagens.arestas[a.kind]++;
    contagens.evidencias += a.evidence.length;
  }
  for (const d of grafo.diagnostics) contagens.diagnosticos[d.kind]++;

  const porCategoria = new Map<string, number>(), listadas = new Map<string, LacunaDoRelatorio>();
  for (const l of achados.lacunas) {
    porCategoria.set(l.categoria, (porCategoria.get(l.categoria) ?? 0) + 1);
    if (LACUNAS_SO_CONTAGEM.has(l.categoria)) continue;
    const linha = l.inicio === null || texto(l.path) === undefined ? null : mapaDe(l.path).linha(l.inicio);
    const item: LacunaDoRelatorio = { categoria: l.categoria, path: l.path, linha, detalhe: l.detalhe };
    listadas.set(canonico(item), item);
  }
  const relatorio: RelatorioDeExtracao = {
    schema: RELATORIO_SCHEMA, snapshot_id: grafo.snapshot.snapshot_id, graph_digest: digest, contagens, evidencias_excedentes: excedentes,
    excluidas: [...new Map(excluidas.map((e) => [canonico(e), e])).entries()].sort((a, b) => compararUtf8(a[0], b[0])).map(([, e]) => e),
    lacunas_por_categoria: Object.fromEntries([...porCategoria.entries()].sort((a, b) => compararUtf8(a[0], b[0]))),
    lacunas: [...listadas.entries()].sort((a, b) => compararUtf8(a[0], b[0])).map(([, l]) => l),
  };
  return { grafo, digest, relatorio };
}
