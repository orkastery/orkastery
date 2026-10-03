/**
 * RM-031 KG2 (D5, D6, D15): extratores `ork.md-structure` e `ork.id-mention`.
 *
 * A estrutura do Markdown vem de um analisador CommonMark recebido por parametro (o micromark com
 * a tabela GFM, D15), nunca de varredura propria: codigo cercado ou indentado, bloco e trecho HTML,
 * citacao, lista e tabela seguem a especificacao. Secao por titulo ATX ou setext, com a ancora no
 * slug do GitHub; link inline e imagem viram `references` da secao onde estao; frontmatter com `id`
 * e `tipo` vira artefato, com `derived_from` para as fontes declaradas e `references` para pai,
 * roadmap, features e simbolos. ID citado em texto so vira aresta quando existe um artefato com
 * aquele ID; em codigo e HTML nao conta, em span de codigo conta. O que nao resolve fica no relatorio.
 */
import type { AchadoDeAresta, Achados, FonteDeTexto, RefDeNo, Trecho } from './intelligence-graph-extract';
import { lerYaml, type ValorYaml } from './yaml';

/** Evento do analisador: entrada ou saida de um token, com o offset no texto (unidades UTF-16). */
export interface EventoMd { entrada: boolean; tipo: string; inicio: number; fim: number }

export interface EntradaMd {
  /** Fontes Markdown ja decodificadas, em ordem de caminho. */
  fontes: readonly FonteDeTexto[];
  /** Fontes de codigo onde se procuram IDs citados. */
  codigo: readonly FonteDeTexto[];
  /** Todos os caminhos do manifesto. */
  arquivos: readonly string[];
  /** Simbolos provados pelo extrator de codigo, por `caminho#fragmento`; `null` quando a chave e ambigua. */
  simbolos: ReadonlyMap<string, RefDeNo | null>;
  /** Regra de texto do contrato para `fragment`: secao ou artefato recusado nao vira no. */
  aceitaFragmento: (fragmento: string) => boolean;
  /** D15: analisador CommonMark (micromark com tabela GFM). */
  analisar: (texto: string) => readonly EventoMd[];
  /** Decodificador de referencia de caractere do micromark (`eacute`, `#233`, `#xE9`); `null` se nao e entidade. */
  referencia: (valor: string) => string | null;
  extratorMd: string;
  extratorId: string;
}

/** D6: ID de artefato governado (`RM-031`, `FEAT-018`). */
export const PADRAO_DE_ID = /^[A-Z][A-Z0-9]*-[0-9]+$/;
const MENCAO = /\b[A-Z][A-Z0-9]*-[0-9]+\b/g;
/** D6: chaves do frontmatter que viram aresta, com o tipo e o destino. */
export const CHAVES_DO_FRONTMATTER = Object.freeze({
  pai: 'references:artifact', roadmap: 'references:artifact', features: 'references:artifact',
  'fontes.codigo': 'derived_from:file', 'fontes.testes': 'derived_from:file', 'fontes.docs': 'derived_from:file',
  'fontes.simbolos': 'references:symbol',
} as const);
/** Tokens cujo texto nao e prosa: nao geram mencao de ID (o span de codigo, `codeText`, gera). */
export const TOKENS_SEM_MENCAO = Object.freeze([
  'autolink', 'codeFenced', 'codeIndented', 'definition', 'htmlFlow', 'htmlText', 'resourceDestinationString', 'resourceTitleString',
]);
/** Titulo maior que isso daria slug acima do teto de fragmento. */
const TETO_DO_TITULO = 2048;
/** Linha de frontmatter maior que isso nao vai ao leitor de YAML, que e quadratico em linha longa. */
const TETO_DA_LINHA_DE_FRONTMATTER = 4096;
/**
 * A tabela GFM do micromark e quadratica nas linhas: acima disso, somando as linhas dos blocos que tem
 * uma linha delimitadora de tabela (`| --- |`, `--- | ---`), o corpo nao e analisado.
 */
export const TETO_DE_LINHAS_DE_TABELA = 2000;
const DELIMITADOR_DE_TABELA = /^[\s>]*[|:\- \t]+$/;
/** Tokens do titulo cujo texto entra no slug, como o GitHub o renderiza. */
const TEXTO_DO_TITULO = new Set(['data', 'codeTextData', 'characterEscapeValue', 'autolinkProtocol', 'autolinkEmail']);
/** Tokens do titulo que nao aparecem no texto renderizado: destino, rotulo de referencia e imagem. */
const FORA_DO_TEXTO_DO_TITULO = new Set(['resource', 'reference', 'image']);
export type Chave = keyof typeof CHAVES_DO_FRONTMATTER;

interface Linha { inicio: number; texto: string }
export interface Secao { slug: string | null; inicio: number; fim: number }
export interface Link { destino: string; inicio: number; fim: number }
export interface ValorPosicionado { chave: Chave; valor: string; inicio: number; fim: number }
interface Estrutura {
  fonte: FonteDeTexto;
  /** Titulos em ordem; `slug` nulo quando o contrato o recusaria (o trecho fica no arquivo). */
  secoes: Secao[];
  links: Link[];
  citacoes: Link[];
  /** Linhas de prosa, com codigo, HTML, frontmatter e destino de link apagados. */
  textoDeMencao: Linha[];
  frontmatter: { dados: Record<string, ValorYaml>; valores: ValorPosicionado[] } | null;
  frontmatterInvalido: boolean;
  /** Corpo nao analisado por passar do teto de linhas de tabela. */
  tabelaGrande: boolean;
}

/** Linhas do texto a partir de `desde`, com os offsets no texto inteiro. */
function linhasDe(texto: string, desde = 0): Linha[] {
  const r: Linha[] = [];
  let inicio = desde;
  for (;;) {
    const fim = texto.indexOf('\n', inicio);
    const bruto = texto.slice(inicio, fim < 0 ? texto.length : fim);
    r.push({ inicio, texto: bruto.endsWith('\r') ? bruto.slice(0, -1) : bruto });
    if (fim < 0) return r;
    inicio = fim + 1;
  }
}

/** Troca os trechos por espacos, mantendo as quebras de linha e os offsets, numa passada so. */
function apagarTrechos(texto: string, trechos: readonly [number, number][]): string {
  if (!trechos.length) return texto;
  const ordenados = [...trechos].sort((a, b) => a[0] - b[0]), partes: string[] = [];
  let pos = 0;
  for (const [de, ate] of ordenados) {
    const i = Math.max(de, pos);
    if (ate <= i) continue;
    partes.push(texto.slice(pos, i), texto.slice(i, ate).replace(/[^\r\n]/g, ' '));
    pos = ate;
  }
  partes.push(texto.slice(pos));
  return partes.join('');
}

/** D5: ancora como o GitHub gera do texto renderizado: minusculas, sem pontuacao, espaco vira hifen. */
export function slugDeTexto(texto: string): string {
  return texto.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

/** Slugs repetidos no mesmo arquivo ganham `-1`, `-2`, como no GitHub. */
function contadorDeSlugs(): (base: string) => string {
  const vistos = new Map<string, number>();
  return (base) => {
    if (!vistos.has(base)) {
      vistos.set(base, 0);
      return base;
    }
    let n = vistos.get(base) as number, s: string;
    do s = `${base}-${++n}`;
    while (vistos.has(s));
    vistos.set(base, n);
    vistos.set(s, 0);
    return s;
  };
}

/** Posicao de cada valor das chaves do D6, lida linha a linha e conferida contra o leitor de YAML. */
function valoresPosicionados(linhas: Linha[], dados: Record<string, ValorYaml>): ValorPosicionado[] {
  const r: ValorPosicionado[] = [], pilha: { indent: number; chave: string }[] = [];
  const chaveDe = (indent: number): string => pilha.filter((p) => p.indent < indent).map((p) => p.chave).join('.');
  const valorDe = (caminho: string): ValorYaml | undefined => {
    let v: ValorYaml | undefined = dados;
    for (const k of caminho.split('.')) v = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ValorYaml>)[k] : undefined;
    return v;
  };
  // Um conjunto por chave: conferir cada item da lista fica linear no tamanho do frontmatter.
  const conjuntos = new Map<string, Set<string>>();
  const aceita = (caminho: string, valor: string): boolean => {
    let c = conjuntos.get(caminho);
    if (!c) {
      const v = valorDe(caminho);
      c = new Set(Array.isArray(v) ? v.map(String) : v !== null && v !== undefined ? [String(v)] : []);
      conjuntos.set(caminho, c);
    }
    return c.has(valor);
  };
  const escalar = (caminho: string, bruto: string, desde: number): void => {
    if (!(caminho in CHAVES_DO_FRONTMATTER)) return;
    // Comentario YAML comeca em `#` depois de espaco; busca linear, sem retrocesso em espaco longo.
    const comentario = bruto.search(/\s#/);
    let t = comentario < 0 ? bruto : bruto.slice(0, comentario), ini = desde + (bruto.length - bruto.trimStart().length);
    t = t.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      t = t.slice(1, -1);
      ini++;
    }
    if (t && t !== 'null' && t !== '~' && aceita(caminho, t)) r.push({ chave: caminho as Chave, valor: t, inicio: ini, fim: ini + t.length });
  };
  for (const l of linhas) {
    if (!l.texto.trim() || l.texto.trimStart().startsWith('#')) continue;
    const indent = l.texto.length - l.texto.trimStart().length;
    const item = /^(\s*)-\s+(.*)$/.exec(l.texto);
    if (item) {
      escalar(chaveDe(indent + 1), item[2], l.inicio + l.texto.length - item[2].length);
      continue;
    }
    const m = /^(\s*)([A-Za-z0-9_-]+):(\s*)(.*)$/.exec(l.texto);
    if (!m) continue;
    while (pilha.length && pilha[pilha.length - 1].indent >= indent) pilha.pop();
    pilha.push({ indent, chave: m[2] });
    const caminho = pilha.map((p) => p.chave).join('.'), resto = m[4], desde = l.inicio + l.texto.length - resto.length;
    if (resto.startsWith('[')) {
      const fecha = resto.indexOf(']');
      if (fecha < 0) continue;
      let pos = 1;
      for (const parte of resto.slice(1, fecha).split(',')) {
        escalar(caminho, parte, desde + pos);
        pos += parte.length + 1;
      }
    } else if (resto.trim()) escalar(caminho, resto, desde);
  }
  return r;
}

function estruturar(fonte: FonteDeTexto, aceitaFragmento: (f: string) => boolean, analisar: EntradaMd['analisar'], referencia: EntradaMd['referencia']): Estrutura {
  // O BOM nao e conteudo: sem ele, o primeiro titulo e o frontmatter sao lidos.
  const desde = fonte.texto.charCodeAt(0) === 0xfeff ? 1 : 0;
  const todas = linhasDe(fonte.texto, desde);
  let fimDoFrontmatter = desde, frontmatter: Estrutura['frontmatter'] = null, frontmatterInvalido = false;
  if (todas[0]?.texto === '---') {
    const fim = todas.findIndex((l, i) => i > 0 && (l.texto === '---' || l.texto === '...'));
    if (fim > 0) {
      fimDoFrontmatter = todas[fim].inicio + todas[fim].texto.length;
      const bruto = todas.slice(1, fim);
      try {
        if (bruto.some((l) => l.texto.length > TETO_DA_LINHA_DE_FRONTMATTER)) throw new Error('frontmatter.linha-longa');
        const dados = lerYaml(bruto.map((l) => l.texto).join('\n'));
        if (dados && typeof dados === 'object' && !Array.isArray(dados)) frontmatter = { dados, valores: valoresPosicionados(bruto, dados) };
      } catch {
        frontmatterInvalido = true;
      }
    }
  }
  // O analisador ve o corpo sem o BOM (como o GitHub) e com o frontmatter em espacos; os offsets dele
  // contam a partir do fim do BOM, e `desde` os devolve ao texto inteiro.
  const corpo = apagarTrechos(fonte.texto.slice(desde), [[0, fimDoFrontmatter - desde]]);
  const no = (i: number): number => i + desde;
  // A linha do corpo de uma tabela nao precisa de `|`: conta o bloco inteiro que tem delimitador. Linha e
  // linha em branco como o CommonMark as ve: fim de linha LF, CRLF ou CR, e branca so com espaco e tab.
  let linhasDeTabela = 0, bloco = 0, comDelimitador = false;
  for (const l of [...corpo.split(/\r\n|\r|\n/), '']) {
    if (/^[ \t]*$/.test(l)) {
      if (comDelimitador) linhasDeTabela += bloco;
      bloco = 0;
      comDelimitador = false;
      continue;
    }
    bloco++;
    if (l.includes('|') && l.includes('-') && DELIMITADOR_DE_TABELA.test(l)) comDelimitador = true;
  }
  if (linhasDeTabela > TETO_DE_LINHAS_DE_TABELA) {
    return { fonte, secoes: [], links: [], citacoes: [], textoDeMencao: [], frontmatter, frontmatterInvalido, tabelaGrande: true };
  }
  const secoes: Secao[] = [], links: Link[] = [], semMencao: [number, number][] = [];
  const citacoes: Link[] = [];
  // Parte do destino: o texto e se ele e cru (dado) ou decodificado (escape, referencia).
  type ParteDoDestino = [texto: string, cru: boolean];
  const slug = contadorDeSlugs(), abertos: { inicio: number; fim: number; destino: ParteDoDestino[] | null; descartado: boolean }[] = [];
  // B5: referencia de caractere pelo decodificador do micromark (as entidades do HTML5); a crua fica.
  const decodificada = (i: number, f: number): string => referencia(corpo.slice(i + 1, f - 1)) ?? corpo.slice(i, f);
  // Destino do link como o CommonMark o le: dado, escape e referencia, montados dos eventos.
  let destinoAberto: ParteDoDestino[] | null = null;
  // Rodadas 7 e 8, B1: so o espaco e o tab crus das pontas saem, antes de decodificar (`<a.md >` vira
  // `a.md`); VT, FF e a referencia que decodifica em espaco (`&Tab;`, `&nbsp;`) ficam, como no GitHub.
  const destinoAparado = (partes: ParteDoDestino[]): string => {
    const r = partes.map(([t, cru]) => [t, cru] as ParteDoDestino);
    while (r.length && r[0][1]) {
      r[0][0] = r[0][0].replace(/^[ \t]+/, '');
      if (r[0][0]) break;
      r.shift();
    }
    while (r.length && r[r.length - 1][1]) {
      r[r.length - 1][0] = r[r.length - 1][0].replace(/[ \t]+$/, '');
      if (r[r.length - 1][0]) break;
      r.pop();
    }
    return r.map(([t]) => t).join('');
  };
  // A-N4: o slug sai do texto que o GitHub renderiza no titulo (dado, codigo, escape, entidade e endereco
  // de autolink), sem marcador de enfase, HTML, destino de link, rotulo de referencia nem texto
  // alternativo de imagem. Nada e aparado: o espaco antes de uma imagem no fim vira hifen, como no
  // GitHub (B-R2), e a quebra de linha fora de codigo nao vira espaco (B-P2).
  let titulo: { inicio: number; fim: number; partes: string[]; noTexto: number; foraDoTexto: number; noCodigo: number } | null = null;
  // Tabela GFM: celula alem das colunas do cabecalho e descartada pelo GitHub, e o link nela tambem.
  let colunas = 0, noCabecalho = false, celula = 0, emExcesso = false;
  for (const e of analisar(corpo)) {
    if (e.entrada) {
      if (e.tipo === 'table') colunas = 0;
      else if (e.tipo === 'tableHead') noCabecalho = true;
      else if (e.tipo === 'tableRow') celula = 0;
      else if (e.tipo === 'tableHeader' && noCabecalho) colunas++;
      else if (e.tipo === 'tableData' && ++celula > colunas) {
        emExcesso = true;
        semMencao.push([e.inicio, e.fim]);
      }
      // Titulo, lido em paralelo: o texto dele junta dado, codigo, escape e entidade.
      if (e.tipo === 'codeTextData' && !emExcesso) citacoes.push({
        destino: corpo.slice(e.inicio, e.fim), inicio: no(e.inicio), fim: no(e.fim),
      });
      if (e.tipo === 'atxHeading' || e.tipo === 'setextHeading') titulo = { inicio: no(e.inicio), fim: no(e.fim), partes: [], noTexto: 0, foraDoTexto: 0, noCodigo: 0 };
      else if (titulo) {
        if (e.tipo === 'atxHeadingText' || e.tipo === 'setextHeadingText') titulo.noTexto++;
        else if (FORA_DO_TEXTO_DO_TITULO.has(e.tipo)) titulo.foraDoTexto++;
        else if (e.tipo === 'codeText') titulo.noCodigo++;
        else if (titulo.noTexto > 0 && titulo.foraDoTexto === 0) {
          if (TEXTO_DO_TITULO.has(e.tipo)) titulo.partes.push(corpo.slice(e.inicio, e.fim));
          else if (e.tipo === 'characterReference') titulo.partes.push(decodificada(e.inicio, e.fim));
          // Em span de codigo a quebra de linha vira espaco (CommonMark); fora dele, o GitHub a descarta.
          else if (e.tipo === 'codeTextLineEnding' || (e.tipo === 'lineEnding' && titulo.noCodigo > 0)) titulo.partes.push(' ');
        }
      }
      // Link e imagem, tambem dentro de titulo.
      if (e.tipo === 'link' || e.tipo === 'image') abertos.push({ inicio: no(e.inicio), fim: no(e.fim), destino: null, descartado: emExcesso });
      else if (e.tipo === 'resourceDestinationString' && abertos.length && !abertos[abertos.length - 1].destino) {
        destinoAberto = abertos[abertos.length - 1].destino = [];
      } else if (destinoAberto) {
        if (e.tipo === 'data') destinoAberto.push([corpo.slice(e.inicio, e.fim), true]);
        else if (e.tipo === 'characterEscapeValue') destinoAberto.push([corpo.slice(e.inicio, e.fim), false]);
        else if (e.tipo === 'characterReference') destinoAberto.push([decodificada(e.inicio, e.fim), false]);
      }
      if ((TOKENS_SEM_MENCAO as readonly string[]).includes(e.tipo)) semMencao.push([e.inicio, e.fim]);
      continue;
    }
    if (e.tipo === 'tableHead') noCabecalho = false;
    else if (e.tipo === 'tableData') emExcesso = false;
    else if (titulo && (e.tipo === 'atxHeadingText' || e.tipo === 'setextHeadingText')) titulo.noTexto--;
    else if (titulo && FORA_DO_TEXTO_DO_TITULO.has(e.tipo)) titulo.foraDoTexto--;
    else if (titulo && e.tipo === 'codeText') titulo.noCodigo--;
    else if (e.tipo === 'resourceDestinationString') destinoAberto = null;
    if ((e.tipo === 'atxHeading' || e.tipo === 'setextHeading') && titulo) {
      // Todo titulo abre uma secao: sem texto ou com slug recusado, o trecho sob ele fica no arquivo,
      // nunca na secao anterior.
      const texto = titulo.partes.join('');
      const base = texto && texto.length <= TETO_DO_TITULO ? slugDeTexto(texto) : '';
      const s = base ? slug(base) : null;
      secoes.push({ slug: s !== null && aceitaFragmento(s) ? s : null, inicio: titulo.inicio, fim: titulo.fim });
      titulo = null;
    } else if (e.tipo === 'link' || e.tipo === 'image') {
      const l = abertos.pop();
      if (l?.destino && !l.descartado) links.push({ destino: destinoAparado(l.destino), inicio: l.inicio, fim: l.fim });
    }
  }
  const textoDeMencao = linhasDe(apagarTrechos(corpo, semMencao)).map((l) => ({ inicio: no(l.inicio), texto: l.texto }));
  return { fonte, secoes: secoes.sort((a, b) => a.inicio - b.inicio), links, citacoes, textoDeMencao, frontmatter, frontmatterInvalido, tabelaGrande: false };
}

/** Caminho relativo a raiz a partir do arquivo do link; `null` se sair do repositorio. */
function resolverCaminho(base: string, destino: string): string | null {
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
  const partes = (destino.startsWith('/') ? destino.slice(1) : dir ? `${dir}/${destino}` : destino).split('/'), r: string[] = [];
  for (const p of partes) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (!r.length) return null;
      r.pop();
    } else r.push(p);
  }
  return r.join('/');
}

/** Citacao nao e resolucao de runtime: so caminho literal dentro do manifesto. */
export function caminhoDaCitacao(base: string, literal: string, modulo = false): string | null {
  if (!literal || /[\s\\:#?%\u0000-\u001f\u007f]/u.test(literal) || literal.startsWith('/') || literal.startsWith('~')) return null;
  if (literal.split('/').some((p) => p === '.git' || p === '.orkastery')) return null;
  // Palavras e diretorios nao sao citacoes de arquivo. Modulos podem omitir extensao.
  if (!modulo && (!literal.includes('/') || !/\.(?:[cm]?[jt]sx?|json|md|markdown|ya?ml|toml|py|rs|go|c|h|css|html|svg|png|jpe?g|gif|webp|pdf|txt|sh|sql)$/i.test(literal))) return null;
  if (['', '.', '..'].includes(literal.split('/').at(-1)!)) return null;
  const caminho = literal.startsWith('./') || literal.startsWith('../') ? resolverCaminho(base, literal) : literal;
  return caminho || null;
}

const decodificar = (t: string): string | null => {
  try {
    return decodeURIComponent(t);
  } catch {
    return null;
  }
};

/**
 * RM-031 KG4 (D4): a estrutura de um Markdown no formato que as unidades do indice guardam. E funcao
 * pura dos bytes (e das versoes dos analisadores, que entram na chave): a ligacao entre arquivos so le
 * isto, entao a estrutura de um arquivo que nao mudou vale na revisao seguinte. Do frontmatter fica so
 * o que a ligacao usa: o `id` (quando e texto), se o `tipo` e texto nao vazio e os valores posicionados.
 */
export interface EstruturaMd {
  path: string;
  secoes: Secao[];
  links: Link[];
  /** Caminhos em codigo inline; a existencia do alvo e conferida em cada ligacao. */
  citacoes: Link[];
  /** IDs citados na prosa, com o offset no texto, na ordem de leitura. */
  mencoes: { inicio: number; id: string }[];
  frontmatter: { id: string | null; tipo: boolean; valores: ValorPosicionado[] } | null;
  frontmatterInvalido: boolean;
  tabelaGrande: boolean;
}

export function estruturarMarkdown(fonte: FonteDeTexto, e: Pick<EntradaMd, 'aceitaFragmento' | 'analisar' | 'referencia'>): EstruturaMd {
  const s = estruturar(fonte, e.aceitaFragmento, e.analisar, e.referencia);
  const mencoes: EstruturaMd['mencoes'] = [];
  for (const l of s.textoDeMencao) for (const m of l.texto.matchAll(MENCAO)) mencoes.push({ inicio: l.inicio + (m.index as number), id: m[0] });
  const d = s.frontmatter?.dados;
  return {
    path: fonte.path, secoes: s.secoes, links: s.links, citacoes: s.citacoes, mencoes,
    frontmatter: s.frontmatter && d
      ? { id: typeof d.id === 'string' ? d.id : null, tipo: typeof d.tipo === 'string' && d.tipo !== '', valores: s.frontmatter.valores }
      : null,
    frontmatterInvalido: s.frontmatterInvalido, tabelaGrande: s.tabelaGrande,
  };
}

/** A ligacao entre arquivos recebe as estruturas prontas (as da extracao ou as reaproveitadas). */
export interface EntradaDaLigacaoMd extends Omit<EntradaMd, 'fontes' | 'analisar' | 'referencia'> {
  /** Uma por fonte Markdown, em ordem de caminho. */
  estruturas: readonly EstruturaMd[];
}

export function extrairMarkdown(e: EntradaMd): Achados {
  return ligarMarkdown({ ...e, estruturas: e.fontes.map((f) => estruturarMarkdown(f, e)) });
}

export function ligarMarkdown(e: EntradaDaLigacaoMd): Achados {
  const saida: Achados = { nos: [], arestas: [], diagnosticos: [], lacunas: [] };
  const arquivos = new Set(e.arquivos), diretorios = new Set<string>();
  for (const p of e.arquivos) {
    const partes = p.split('/');
    for (let i = 1; i < partes.length; i++) diretorios.add(partes.slice(0, i).join('/'));
  }
  const estruturas = e.estruturas;
  const slugs = new Map(estruturas.map((s) => [s.path, new Set(s.secoes.map((x) => x.slug).filter((x): x is string => x !== null))]));
  const aresta = (kind: AchadoDeAresta['kind'], from: RefDeNo, to: RefDeNo, extrator: string, metodo: AchadoDeAresta['metodo'], t: Trecho): void => {
    saida.arestas.push({ kind, from, to, extrator, metodo, trecho: t });
  };
  const lacuna = (categoria: string, path: string, inicio: number | null, detalhe: string | null): void => {
    saida.lacunas.push({ categoria, path, inicio, detalhe });
  };

  // D6: artefatos; ID repetido em dois arquivos nao prova destino e fica fora dos dois.
  const donos = new Map<string, string[]>();
  for (const s of estruturas) {
    if (s.frontmatterInvalido) lacuna('frontmatter-invalido', s.path, 0, null);
    if (s.tabelaGrande) lacuna('markdown-tabela-grande', s.path, null, null);
    const nome = s.path.slice(s.path.lastIndexOf('/') + 1), d = s.frontmatter;
    if (!d || nome.startsWith('_') || d.id === null || !PADRAO_DE_ID.test(d.id) || !d.tipo) continue;
    if (!e.aceitaFragmento(d.id)) {
      lacuna('artefato-recusado', s.path, 0, null);
      continue;
    }
    donos.set(d.id, [...(donos.get(d.id) ?? []), s.path]);
  }
  const artefatos = new Map<string, RefDeNo>();
  for (const [id, caminhos] of donos) {
    if (caminhos.length === 1) artefatos.set(id, { kind: 'artifact', path: caminhos[0], fragment: id });
    else for (const p of caminhos) lacuna('artefato-id-repetido', p, 0, id);
  }
  for (const r of artefatos.values()) saida.nos.push(r);

  // Trecho sob titulo recusado fica no arquivo: atribuir a secao anterior seria outra secao.
  const secaoEm = (s: EstruturaMd, arquivo: RefDeNo, o: number): RefDeNo => {
    // Ultima secao que comeca ate `o`, por busca binaria (as secoes estao em ordem de inicio).
    let baixo = 0, alto = s.secoes.length;
    while (baixo < alto) {
      const meio = (baixo + alto) >> 1;
      if (s.secoes[meio].inicio <= o) baixo = meio + 1;
      else alto = meio;
    }
    const atual = baixo > 0 ? s.secoes[baixo - 1] : null;
    return atual && atual.slug !== null ? { kind: 'section', path: arquivo.path, fragment: atual.slug } : arquivo;
  };
  const mencao = (path: string, inicio: number, id: string, origem: (o: number) => RefDeNo): void => {
    const alvo = artefatos.get(id);
    if (!alvo) lacuna('id-sem-artefato', path, inicio, id);
    else aresta('references', origem(inicio), alvo, e.extratorId, 'text-location', { path, inicio, fim: inicio + id.length });
  };

  for (const s of estruturas) {
    const path = s.path, arquivo: RefDeNo = { kind: 'file', path, fragment: null };
    const citar = (alvo: string | null, k: Link, metodo: AchadoDeAresta['metodo']): void => {
      if (alvo !== null && alvo !== path && arquivos.has(alvo)) aresta('cites', secaoEm(s, arquivo, k.inicio),
        { kind: 'file', path: alvo, fragment: null }, e.extratorMd, metodo, { path, inicio: k.inicio, fim: k.fim });
    };
    for (const k of s.citacoes) citar(caminhoDaCitacao(path, k.destino), k, 'text-location');
    for (const x of s.secoes) {
      if (x.slug === null) {
        lacuna('secao-recusada', path, x.inicio, null);
        continue;
      }
      const r: RefDeNo = { kind: 'section', path, fragment: x.slug };
      saida.nos.push(r);
      aresta('contains', arquivo, r, e.extratorMd, 'structured', { path, inicio: x.inicio, fim: x.fim });
    }

    for (const k of s.links) {
      const origem = secaoEm(s, arquivo, k.inicio), t: Trecho = { path, inicio: k.inicio, fim: k.fim };
      const destino = k.destino;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(destino)) {
        lacuna('link-externo', path, k.inicio, null);
        continue;
      }
      const cerquilha = destino.indexOf('#');
      const parteDoCaminho = (cerquilha < 0 ? destino : destino.slice(0, cerquilha)).replace(/\?.*$/, '');
      const ancora = cerquilha < 0 ? null : decodificar(destino.slice(cerquilha + 1));
      const caminhoDecodificado = decodificar(parteDoCaminho);
      if (caminhoDecodificado === null) {
        lacuna('link-invalido', path, k.inicio, destino);
        continue;
      }
      const relativo = caminhoDecodificado === '' ? path : resolverCaminho(path, caminhoDecodificado);
      // Links seguem o diretorio do documento; a citacao tambem admite caminho desde a raiz.
      const literal = caminhoDaCitacao(path, caminhoDecodificado);
      // Uma referencia ao arquivo ou a uma secao ja representa esta ocorrencia do link.
      if (relativo === null || !arquivos.has(relativo)) citar(literal, k, 'explicit-link');
      const alvo = relativo;
      if (alvo === null) {
        lacuna('link-fora-do-repositorio', path, k.inicio, destino);
        continue;
      }
      if (!arquivos.has(alvo)) {
        lacuna(alvo === '' || diretorios.has(alvo) ? 'link-para-diretorio' : 'link-sem-alvo', path, k.inicio, destino);
        continue;
      }
      const secoesDoAlvo = slugs.get(alvo);
      if (ancora && secoesDoAlvo?.has(ancora)) {
        aresta('references', origem, { kind: 'section', path: alvo, fragment: ancora }, e.extratorMd, 'explicit-link', t);
        continue;
      }
      // P6: ancora que nao bate fica declarada; o link ainda prova a referencia ao arquivo.
      if (ancora && secoesDoAlvo) lacuna('ancora-nao-resolvida', path, k.inicio, destino);
      if (alvo === path) continue;
      aresta('references', origem, { kind: 'file', path: alvo, fragment: null }, e.extratorMd, 'explicit-link', t);
    }

    const artefato = s.frontmatter && s.frontmatter.id !== null ? artefatos.get(s.frontmatter.id) : undefined;
    if (artefato && artefato.path === path && s.frontmatter) {
      for (const v of s.frontmatter.valores) {
        const [kind, destino] = CHAVES_DO_FRONTMATTER[v.chave].split(':') as [AchadoDeAresta['kind'], string];
        const t: Trecho = { path, inicio: v.inicio, fim: v.fim };
        // B4: o simbolo e procurado pela chave inteira; caminho com `#` nao e cortado no meio.
        const alvo = destino === 'artifact' ? artefatos.get(v.valor)
          : destino === 'file' ? (arquivos.has(v.valor) ? { kind: 'file' as const, path: v.valor, fragment: null } : undefined)
            : e.simbolos.get(v.valor) ?? undefined;
        if (alvo) aresta(kind, artefato, alvo, e.extratorMd, 'structured', t);
        else lacuna('frontmatter-sem-alvo', path, v.inicio, `${v.chave}: ${v.valor}`);
      }
    }
    for (const m of s.mencoes) mencao(path, m.inicio, m.id, (o) => secaoEm(s, arquivo, o));
  }
  for (const f of e.codigo) {
    const arquivo: RefDeNo = { kind: 'file', path: f.path, fragment: null };
    for (const l of linhasDe(f.texto)) for (const m of l.texto.matchAll(MENCAO)) mencao(f.path, l.inicio + (m.index as number), m[0], () => arquivo);
  }
  return saida;
}
