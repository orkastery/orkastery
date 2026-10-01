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
import {
  CHAVES_DO_FRONTMATTER, PADRAO_DE_ID, TOKENS_SEM_MENCAO, estruturarMarkdown, ligarMarkdown, type EstruturaMd, type EventoMd,
} from './intelligence-graph-extract-md';
import {
  OPCOES_TS_DESCRITAS, casaSonda, extrairTypeScript, type EntradaTs, type ResultadoTs, type UnidadeTs,
} from './intelligence-graph-extract-ts';

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

/**
 * D1 e D15: os analisadores chegam por parametro; este modulo so conhece os seus tipos. `markdown`
 * e o analisador CommonMark (micromark com tabela GFM), a versao dele e o decodificador de referencia
 * de caractere do proprio micromark (`referencia('eacute')`, `referencia('#233')`; `null` se o nome nao
 * e entidade do HTML5). `unicode` e a versao do Unicode do motor JavaScript (`process.versions.unicode`).
 * As duas versoes entram na do extrator Markdown, porque o slug e a estrutura dependem delas; a tabela
 * de entidades do HTML5 e fixa. D16: `javascript` e o juiz de sintaxe do V8 do Node (`sintaxe` diz, em
 * lote, se cada texto compila como CommonJS ou como ESM) e a versao do Node, que entra na do
 * `ork.ts-ast`, porque o formato e a resolucao do runtime dependem dela.
 */
export interface Parser {
  ts: typeof TS;
  unicode: string;
  markdown: { analisar: (texto: string) => readonly EventoMd[]; referencia: (valor: string) => string | null; versao: string };
  javascript: { sintaxe: (pedidos: readonly { texto: string; formato: 'cjs' | 'esm' }[]) => readonly boolean[]; versao: string };
}

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

/** RM-031 KG4 (D2): as unidades por arquivo que o indice guarda para a proxima revisao reaproveitar. */
export const UNIDADES_SCHEMA = 'ork.graph-extraction-units/v0' as const;

/** Uma entrada do manifesto e o que o incremental reaproveita dela quando os bytes nao mudam. */
export interface UnidadeDoArquivo {
  path: string;
  source_hash: string;
  /** Fonte TS/JS com texto: os achados do `ork.ts-ast`, as dependencias e as sondas. */
  ts: UnidadeTs | null;
  /** Markdown com texto: a estrutura, pura dos bytes. */
  md: EstruturaMd | null;
}

export interface UnidadesDaExtracao {
  schema: typeof UNIDADES_SCHEMA;
  snapshot_id: string;
  graph_digest: string;
  /** Fontes TS/JS com declaracao no escopo global ou aumento de modulo. */
  globais_ts: string[];
  /** O manifesto inteiro, em ordem de caminho. */
  arquivos: UnidadeDoArquivo[];
}

/** O que a extracao com base reaproveitou e por que, para a saida do `ork grafo indexar`. */
export interface Reaproveitamento {
  mudanca: { alterados: number; novos: number; removidos: number };
  ts: {
    modo: 'reaproveitado' | 'parcial' | 'inteiro'; motivo: string | null; reextraidos: string[]; programa: number; reaproveitados: number;
  };
  md: { reextraidos: string[]; reaproveitados: number };
}

export interface ResultadoDaExtracao {
  grafo: GrafoCodigo;
  digest: string;
  relatorio: RelatorioDeExtracao;
  unidades: UnidadesDaExtracao;
  /** So com base: o que veio dela. */
  reaproveitamento: Reaproveitamento | null;
}

function falha(codigo: string, onde?: string): never {
  throw new Error(onde ? `${codigo} em ${onde}` : codigo);
}

/**
 * Aninhamento extremo estoura a pilha do compilador ou do analisador (o binder do TypeScript e
 * recursivo): a extracao falha inteira com erro tipado, nunca com grafo parcial (D10).
 */
function semEstouro<T>(extrator: string, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof RangeError && /call stack/i.test(e.message)) falha('extracao.limite.pilha', extrator);
    throw e;
  }
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

/** D8: id de blob do Git, calculado dos bytes; igual ao `git hash-object --no-filters` do arquivo. */
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

/** RM-031 KG4 (D1, D3, D4): o que muda entre a base e a revisao nova e o que se reaproveita. */
interface PlanoDeReuso {
  base: UnidadesDaExtracao;
  porCaminho: Map<string, UnidadeDoArquivo>;
  mudanca: { alterados: string[]; novos: string[]; removidos: string[] };
  /** Estruturas Markdown de arquivos que nao mudaram. */
  md: Map<string, EstruturaMd>;
  /** `motivo` nao nulo: o TypeScript e extraido inteiro. */
  ts: { motivo: string | null; sementes: Set<string>; afetados: Set<string> };
}

/**
 * A mudanca e por conteudo: o hash de cada caminho contra o da base, mais os novos e os removidos
 * (renome e os dois). No TypeScript, semente e o arquivo mudado ou novo e o nao mudado cuja sonda casa
 * caminho novo ou removido; afetado e a semente e quem alcanca semente ou caminho mudado pelas
 * dependencias gravadas na base. `package.json` ou arquivo global na mudanca extrai o TypeScript inteiro.
 */
function planejarReuso(base: UnidadesDaExtracao, manifesto: ReadonlyMap<string, EntradaDoManifesto>, fontesTs: readonly FonteDeTexto[],
  fontesMd: readonly FonteDeTexto[]): PlanoDeReuso {
  const porCaminho = new Map(base.arquivos.map((u) => [u.path, u]));
  const alterados: string[] = [], novos: string[] = [], removidos: string[] = [];
  for (const [p, m] of manifesto) {
    const u = porCaminho.get(p);
    if (!u) novos.push(p);
    else if (u.source_hash !== m.source_hash) alterados.push(p);
  }
  for (const p of porCaminho.keys()) if (!manifesto.has(p)) removidos.push(p);
  for (const l of [alterados, novos, removidos]) l.sort(compararUtf8);
  const mudados = new Set([...alterados, ...novos, ...removidos]);
  const md = new Map<string, EstruturaMd>();
  for (const f of fontesMd) {
    const u = porCaminho.get(f.path);
    if (u?.md && !mudados.has(f.path)) md.set(f.path, u.md);
  }
  const plano: PlanoDeReuso = { base, porCaminho, mudanca: { alterados, novos, removidos }, md, ts: { motivo: null, sementes: new Set(), afetados: new Set() } };
  const ordenados = [...mudados].sort(compararUtf8), globais = new Set(base.globais_ts), ts1 = new Set(fontesTs.map((f) => f.path));
  const pacote = ordenados.find((p) => p === 'package.json' || p.endsWith('/package.json'));
  const global = ordenados.find((p) => globais.has(p));
  const semUnidade = fontesTs.find((f) => !mudados.has(f.path) && !porCaminho.get(f.path)?.ts);
  if (pacote !== undefined) plano.ts.motivo = `package.json na mudanca (${pacote})`;
  else if (global !== undefined) plano.ts.motivo = `arquivo global do TypeScript na mudanca (${global})`;
  else if (semUnidade !== undefined) plano.ts.motivo = `base sem a unidade TypeScript de ${semUnidade.path}`;
  if (plano.ts.motivo !== null) return plano;
  const existencia = [...novos, ...removidos];
  for (const p of ts1) {
    if (mudados.has(p)) plano.ts.sementes.add(p);
    else if (existencia.length && (porCaminho.get(p)?.ts as UnidadeTs).sondas.some((b) => existencia.some((q) => casaSonda(b, q)))) plano.ts.sementes.add(p);
  }
  const dependentes = new Map<string, string[]>();
  for (const u of base.arquivos) {
    for (const d of u.ts?.dependencias ?? []) {
      const lista = dependentes.get(d);
      if (lista) lista.push(u.path);
      else dependentes.set(d, [u.path]);
    }
  }
  const vistos = new Set<string>(), fila = [...plano.ts.sementes, ...mudados];
  while (fila.length) {
    const q = fila.pop() as string;
    if (vistos.has(q)) continue;
    vistos.add(q);
    for (const x of dependentes.get(q) ?? []) if (!vistos.has(x)) fila.push(x);
  }
  // CHECK (B1): quem usa um global nao importa o arquivo dele, e o global depende do que esse arquivo
  // importa (heranca, tipo importado, `export *` atras de UMD, aumento que estende tipo de outro modulo).
  const globalAlcancado = [...globais].sort(compararUtf8).find((g) => vistos.has(g));
  if (globalAlcancado !== undefined) {
    plano.ts.motivo = `dependencia de arquivo global na mudanca (${globalAlcancado})`;
    return plano;
  }
  for (const p of vistos) if (ts1.has(p)) plano.ts.afetados.add(p);
  return plano;
}

/**
 * KG4 (D3): extrai os afetados num programa parcial: eles, os globais e o fecho direto pelas
 * dependencias da base (a semente descobre as suas no programa, que cresce ate fechar). O resto vem
 * da base. Afetado que passa a declarar global devolve o motivo, e o TypeScript sai inteiro.
 */
function extrairTsParcial(plano: PlanoDeReuso, entrada: EntradaTs, extrair: (e: EntradaTs) => ResultadoTs):
  { motivo: string | null; unidades: Map<string, UnidadeTs>; globais: string[]; programa: number } {
  const { afetados, sementes } = plano.ts, ts1 = new Set(entrada.fontes.map((f) => f.path));
  const daBase = (p: string): UnidadeTs => plano.porCaminho.get(p)?.ts as UnidadeTs;
  const unidades = new Map<string, UnidadeTs>(), globais = [...plano.base.globais_ts];
  const raizes = new Set<string>();
  const incluir = (inicio: Iterable<string>): void => {
    const fila = [...inicio];
    while (fila.length) {
      const p = fila.pop() as string;
      if (raizes.has(p) || !ts1.has(p)) continue;
      raizes.add(p);
      if (!sementes.has(p)) for (const d of daBase(p).dependencias) if (!raizes.has(d)) fila.push(d);
    }
  };
  let r: ResultadoTs | null = null;
  if (afetados.size) {
    incluir([...afetados, ...globais]);
    for (;;) {
      r = extrair({ ...entrada, fontes: entrada.fontes.filter((f) => raizes.has(f.path)), emitir: afetados });
      if (!r.faltantes.length) break;
      const antes = raizes.size;
      incluir(r.faltantes);
      if (raizes.size === antes) falha('extracao.interna.programa-parcial');
    }
    const daBaseGlobal = new Set(globais), doPrograma = new Set(r.globais);
    const novo = r.globais.find((g) => !daBaseGlobal.has(g));
    if (novo !== undefined) return { motivo: `arquivo passa a declarar global no TypeScript (${novo})`, unidades, globais, programa: raizes.size };
    const sumiu = globais.find((g) => ts1.has(g) && !doPrograma.has(g));
    if (sumiu !== undefined) return { motivo: `global da base fora do escopo global (${sumiu})`, unidades, globais, programa: raizes.size };
  }
  for (const f of entrada.fontes) {
    const u = afetados.has(f.path) ? r?.unidades.get(f.path) : daBase(f.path);
    if (!u) falha('extracao.interna.unidade-ts-ausente');
    unidades.set(f.path, u);
  }
  return { motivo: null, unidades, globais, programa: raizes.size };
}

/**
 * Extrai o grafo das fontes fornecidas. Lanca `extracao.*` para entrada invalida ou teto do
 * contrato estourado (D10), e `grafo.*` se o resultado violar o contrato (defeito do extrator).
 * RM-031 KG4: com `base` (as unidades do indice de outra revisao, do mesmo extrator), reextrai so o
 * que a mudanca alcanca; o resultado e o mesmo, byte a byte, da extracao sem base.
 */
export function extrairGrafo(entrada: EntradaDeExtracao, parser: Parser, base: UnidadesDaExtracao | null = null): ResultadoDaExtracao {
  const { ts, unicode, markdown, javascript } = parser;
  if (!/^[0-9]+(\.[0-9]+)*$/.test(unicode)) falha('extracao.entrada.unicode-invalido');
  if (!/^[0-9A-Za-z][0-9A-Za-z.-]{0,40}$/.test(markdown.versao) || typeof markdown.analisar !== 'function'
    || typeof markdown.referencia !== 'function') falha('extracao.entrada.markdown-invalido');
  if (!javascript || !/^node\.[0-9]+(\.[0-9]+)*$/.test(javascript.versao) || typeof javascript.sintaxe !== 'function') {
    falha('extracao.entrada.javascript-invalido');
  }
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
  // Laco, nao `push(...lista)`: lista grande estouraria a pilha antes do teto tipado do contrato.
  const juntar = (a: Achados): void => {
    for (const x of a.nos) achados.nos.push(x);
    for (const x of a.arestas) achados.arestas.push(x);
    for (const x of a.diagnosticos) achados.diagnosticos.push(x);
    for (const x of a.lacunas) achados.lacunas.push(x);
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
  const versaoTs = `${VERSAO_KG2}+typescript.${ts.version}+${javascript.versao}`;
  // B1: a raiz virtual do compilador deriva do manifesto; um caminho do repositorio nao a nomeia.
  const raiz = `/ork-${sha256DoCanonico([...manifesto.values()].map((m) => [m.path, m.source_hash])).slice(0, 32)}`;
  const aceitaFragmento = (f: string): boolean => f.length >= 1 && f.length <= GRAFO_LIMITES.fragmento && textoAceito(f);
  const entradaTs = { fontes: fontesTs, arquivos: caminhos, texto, raiz, aceitaFragmento, sintaxe: javascript.sintaxe, extrator: EXTRATOR_TS };
  const extrairTs = (e: EntradaTs): ResultadoTs => semEstouro(EXTRATOR_TS, () => extrairTypeScript(e, ts));

  // KG4 (D1, D3, D4): com as unidades de uma base, so o que a mudanca alcanca e extraido de novo.
  const plano = base ? planejarReuso(base, manifesto, fontesTs, fontesMd) : null;
  let tsDaBase: ReturnType<typeof extrairTsParcial> | null = null;
  if (plano && plano.ts.motivo === null) tsDaBase = extrairTsParcial(plano, entradaTs, extrairTs);
  const motivoTs = plano ? plano.ts.motivo ?? tsDaBase?.motivo ?? null : null;
  let unidadesTs: Map<string, UnidadeTs>, globaisTs: string[];
  if (tsDaBase && tsDaBase.motivo === null) {
    unidadesTs = tsDaBase.unidades;
    globaisTs = tsDaBase.globais;
  } else {
    const r = extrairTs(entradaTs);
    unidadesTs = r.unidades;
    globaisTs = r.globais;
  }
  for (const f of fontesTs) {
    const u = unidadesTs.get(f.path);
    if (!u) falha('extracao.interna.unidade-ts-ausente');
    juntar(u.achados);
  }
  // B4: chave `caminho#fragmento` como o frontmatter a escreve; duas refs na mesma chave ficam ambiguas.
  const simbolos = new Map<string, RefDeNo | null>();
  for (const r of achados.nos.filter((x) => x.kind === 'symbol')) {
    const chave = `${r.path}#${r.fragment}`, antes = simbolos.get(chave);
    simbolos.set(chave, antes === undefined || (antes && antes.path === r.path && antes.fragment === r.fragment) ? r : null);
  }
  const estruturas = semEstouro(EXTRATOR_MD, () => fontesMd.map((f) => plano?.md.get(f.path)
    ?? estruturarMarkdown(f, { aceitaFragmento, analisar: markdown.analisar, referencia: markdown.referencia })));
  juntar(semEstouro(EXTRATOR_MD, () => ligarMarkdown({
    estruturas, codigo: fontesTs, arquivos: caminhos, simbolos, aceitaFragmento, extratorMd: EXTRATOR_MD, extratorId: EXTRATOR_ID,
  })));

  const extratores: Extrator[] = [
    { extractor_id: EXTRATOR_ARQUIVOS, extractor_version: VERSAO_KG2 },
    { extractor_id: EXTRATOR_ID, extractor_version: VERSAO_KG2 },
    { extractor_id: EXTRATOR_MD, extractor_version: `${VERSAO_KG2}+${markdown.versao}+unicode.${unicode}` },
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
    markdown: {
      extensoes: EXTENSOES_MD, ancora: 'github-slug', artefato: PADRAO_DE_ID.source, frontmatter: CHAVES_DO_FRONTMATTER, sem_mencao: TOKENS_SEM_MENCAO,
    },
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
  const estruturaDe = new Map(estruturas.map((x) => [x.path, x]));
  const unidades: UnidadesDaExtracao = {
    schema: UNIDADES_SCHEMA, snapshot_id: grafo.snapshot.snapshot_id, graph_digest: digest, globais_ts: globaisTs,
    arquivos: grafo.snapshot.source_manifest.map((m) => ({
      path: m.path, source_hash: m.source_hash, ts: unidadesTs.get(m.path) ?? null, md: estruturaDe.get(m.path) ?? null,
    })),
  };
  let reaproveitamento: Reaproveitamento | null = null;
  if (plano) {
    const parcial = motivoTs === null, afetados = [...plano.ts.afetados].sort(compararUtf8);
    reaproveitamento = {
      mudanca: { alterados: plano.mudanca.alterados.length, novos: plano.mudanca.novos.length, removidos: plano.mudanca.removidos.length },
      ts: {
        modo: !parcial ? 'inteiro' : afetados.length ? 'parcial' : 'reaproveitado', motivo: motivoTs,
        reextraidos: parcial ? afetados : fontesTs.map((f) => f.path), programa: parcial ? tsDaBase?.programa ?? 0 : fontesTs.length,
        reaproveitados: parcial ? fontesTs.length - afetados.length : 0,
      },
      md: { reextraidos: fontesMd.filter((f) => !plano.md.has(f.path)).map((f) => f.path), reaproveitados: plano.md.size },
    };
  }
  return { grafo, digest, relatorio, unidades, reaproveitamento };
}
