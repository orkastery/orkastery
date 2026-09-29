/**
 * RM-031 KG2 (D5, D6): extratores `ork.md-structure` e `ork.id-mention`.
 *
 * Markdown: secao por titulo ATX, com a ancora no slug do GitHub; link inline e imagem viram
 * `references` da secao onde estao; frontmatter com `id` e `tipo` vira artefato, com `derived_from`
 * para as fontes declaradas e `references` para pai, roadmap, features e simbolos. Codigo cercado
 * (tambem dentro de citacao e de lista), codigo indentado, bloco HTML, span de codigo (tambem em
 * varias linhas) e comentario HTML nao geram link. A leitura e conservadora: na duvida entre
 * codigo e texto, o trecho e tratado como codigo e nao gera aresta. ID citado em texto so vira
 * aresta quando existe um artefato com aquele ID. O que nao resolve fica no relatorio.
 */
import type { AchadoDeAresta, Achados, FonteDeTexto, RefDeNo, Trecho } from './intelligence-graph-extract';
import { lerYaml, type ValorYaml } from './yaml';

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
/** Destino de link maior que o teto de caminho do contrato nunca resolve: nem e lido. */
const TETO_DO_DESTINO = 1024;
/** Titulo maior que isso daria slug acima do teto de fragmento. */
const TETO_DO_TITULO = 2048;
/** Linha de frontmatter maior que isso nao vai ao leitor de YAML, que e quadratico em linha longa. */
const TETO_DA_LINHA_DE_FRONTMATTER = 4096;
type Chave = keyof typeof CHAVES_DO_FRONTMATTER;

interface Linha { inicio: number; texto: string }
interface Secao { slug: string | null; inicio: number; fim: number }
interface Link { destino: string; inicio: number; fim: number }
interface ValorPosicionado { chave: Chave; valor: string; inicio: number; fim: number }
interface Estrutura {
  fonte: FonteDeTexto;
  /** Titulos em ordem; `slug` nulo quando o contrato o recusaria (o trecho fica no arquivo). */
  secoes: Secao[];
  links: Link[];
  /** Linhas de texto fora de codigo, com comentario HTML e destino de link apagados. */
  textoDeMencao: Linha[];
  frontmatter: { dados: Record<string, ValorYaml>; valores: ValorPosicionado[] } | null;
  frontmatterInvalido: boolean;
}

/** Linhas do texto a partir de `desde` (o BOM fica fora), com os offsets no texto inteiro. */
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

/** Troca o trecho por espacos, mantendo as quebras de linha (o span de codigo atravessa linha). */
const apagar = (s: string, de: number, ate: number): string => s.slice(0, de) + s.slice(de, ate).replace(/[^\n]/g, ' ') + s.slice(ate);
const escapado = (s: string, i: number): boolean => {
  let n = 0;
  for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) n++;
  return n % 2 === 1;
};
/** Colunas de recuo no inicio da linha; tab avanca ate o proximo multiplo de 4. */
const indentacao = (s: string): number => {
  let colunas = 0;
  for (const c of s) {
    if (c === ' ') colunas++;
    else if (c === '\t') colunas += 4 - (colunas % 4);
    else break;
  }
  return colunas;
};

/** Apaga comentario HTML (que pode atravessar linhas), mantendo os offsets. */
function semComentario(texto: string, estado: { aberto: boolean }): string {
  let s = texto, i = 0;
  while (i < s.length) {
    if (estado.aberto) {
      const f = s.indexOf('-->', i);
      if (f < 0) return apagar(s, i, s.length);
      s = apagar(s, i, f + 3);
      i = f + 3;
      estado.aberto = false;
    } else {
      const a = s.indexOf('<!--', i);
      if (a < 0) return s;
      estado.aberto = true;
      i = a;
    }
  }
  return s;
}

/**
 * Apaga span de codigo: sequencia de crases fechada pela proxima de mesmo tamanho, no paragrafo
 * inteiro (o span atravessa linha). Cada tamanho guarda um ponteiro, entao a varredura e linear.
 */
function semCodigo(s: string): string {
  const corridas: { pos: number; n: number }[] = [];
  for (let i = 0; i < s.length;) {
    if (s[i] !== '`' || escapado(s, i)) {
      i++;
      continue;
    }
    let n = 0;
    while (s[i + n] === '`') n++;
    corridas.push({ pos: i, n });
    i += n;
  }
  const porTamanho = new Map<number, number[]>();
  corridas.forEach((c, k) => {
    const lista = porTamanho.get(c.n);
    if (lista) lista.push(k);
    else porTamanho.set(c.n, [k]);
  });
  const ponteiro = new Map<number, number>();
  let r = s;
  for (let k = 0; k < corridas.length;) {
    const c = corridas[k], lista = porTamanho.get(c.n) as number[];
    let p = ponteiro.get(c.n) ?? 0;
    while (p < lista.length && lista[p] <= k) p++;
    ponteiro.set(c.n, p);
    if (p >= lista.length) {
      k++;
      continue;
    }
    const fecha = corridas[lista[p]];
    r = apagar(r, c.pos, fecha.pos + fecha.n);
    k = lista[p] + 1;
  }
  return r;
}

/** Link achado numa linha: offsets na linha do link inteiro (`i`, `f`) e do destino (`di`, `df`). */
interface LinkDaLinha { destino: string; i: number; f: number; di: number; df: number }

/** Links inline e imagens de uma linha ja sem codigo e sem comentario; colchetes pareados por pilha. */
function linksDa(mascara: string, original: string): LinkDaLinha[] {
  const par = new Map<number, number>(), pilha: number[] = [];
  for (let i = 0; i < mascara.length; i++) {
    const c = mascara[i];
    if ((c !== '[' && c !== ']') || escapado(mascara, i)) continue;
    if (c === '[') pilha.push(i);
    else if (pilha.length) par.set(pilha.pop() as number, i);
  }
  const r: LinkDaLinha[] = [];
  for (const [i, j] of [...par.entries()].sort((a, b) => a[0] - b[0])) {
    if (mascara[j + 1] !== '(') continue;
    let k = j + 2;
    while (mascara[k] === ' ' || mascara[k] === '\t') k++;
    let di: number, df: number;
    if (mascara[k] === '<') {
      const fim = mascara.indexOf('>', k);
      if (fim < 0 || fim - k > TETO_DO_DESTINO) continue;
      di = k + 1;
      df = fim;
      k = fim + 1;
    } else {
      di = k;
      let p = 0;
      const limite = Math.min(mascara.length, k + TETO_DO_DESTINO + 1);
      for (; k < limite; k++) {
        const c = mascara[k];
        if (c === '\\') {
          k++;
          continue;
        }
        if (c === '(') p++;
        else if (c === ')') {
          if (p === 0) break;
          p--;
        } else if (c === ' ' || c === '\t') break;
      }
      if (k >= limite && limite < mascara.length) continue;
      df = k;
    }
    while (mascara[k] === ' ' || mascara[k] === '\t') k++;
    const aspa = mascara[k];
    if (aspa === '"' || aspa === "'" || aspa === '(') {
      const fecha = mascara.indexOf(aspa === '(' ? ')' : aspa, k + 1);
      if (fecha < 0) continue;
      k = fecha + 1;
      while (mascara[k] === ' ' || mascara[k] === '\t') k++;
    }
    if (mascara[k] !== ')' || di >= df) continue;
    const inicio = i > 0 && mascara[i - 1] === '!' && !escapado(mascara, i - 1) ? i - 1 : i;
    r.push({ destino: original.slice(di, df), i: inicio, f: k + 1, di, df });
  }
  return r;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

/** D5: ancora como o GitHub gera: entidades decodificadas, minusculas, sem pontuacao, espaco vira hifen. */
export function slugDoGithub(titulo: string): string {
  return titulo
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#[0-9]{1,7}|#x[0-9a-fA-F]{1,6}|[a-z]+);/g, (m, e: string) => {
      if (e[0] !== '#') return ENTIDADES[e] ?? m;
      const c = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : m;
    })
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
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

/** Titulo ATX sem regex de retrocesso: ate 3 espacos, 1 a 6 `#`, espaco ou fim, sequencia de fecho opcional. */
function tituloAtx(linha: string): { inicio: number; texto: string } | null {
  let i = 0;
  while (i < 3 && linha[i] === ' ') i++;
  const inicio = i;
  let n = 0;
  while (linha[i + n] === '#') n++;
  if (n < 1 || n > 6) return null;
  const depois = linha[i + n];
  if (depois !== undefined && depois !== ' ' && depois !== '\t') return null;
  let fim = linha.length;
  while (fim > i + n && (linha[fim - 1] === ' ' || linha[fim - 1] === '\t')) fim--;
  let corpo = linha.slice(i + n, fim);
  let f = corpo.length;
  while (f > 0 && corpo[f - 1] === '#') f--;
  if (f === 0 || corpo[f - 1] === ' ' || corpo[f - 1] === '\t') corpo = corpo.slice(0, f);
  return { inicio, texto: corpo.trim() };
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
  const aceita = (caminho: string, valor: string): boolean => {
    const v = valorDe(caminho);
    return Array.isArray(v) ? v.map(String).includes(valor) : v !== null && v !== undefined && String(v) === valor;
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

/** Marcadores de citacao (`>`) no inicio da linha: o conteudo comeca depois deles. */
function semCitacao(linha: string): number {
  let i = 0;
  for (;;) {
    let j = i;
    while (j < i + 3 && linha[j] === ' ') j++;
    if (linha[j] !== '>') return i;
    i = j + 1;
    if (linha[i] === ' ') i++;
  }
}

function estruturar(fonte: FonteDeTexto, aceitaFragmento: (f: string) => boolean): Estrutura {
  // O BOM nao e conteudo: sem ele, o primeiro titulo e o frontmatter sao lidos.
  const todas = linhasDe(fonte.texto, fonte.texto.charCodeAt(0) === 0xfeff ? 1 : 0);
  let corpo = todas, frontmatter: Estrutura['frontmatter'] = null, frontmatterInvalido = false;
  if (todas[0]?.texto === '---') {
    const fim = todas.findIndex((l, i) => i > 0 && (l.texto === '---' || l.texto === '...'));
    if (fim > 0) {
      corpo = todas.slice(fim + 1);
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
  const secoes: Secao[] = [], links: Link[] = [], textoDeMencao: Linha[] = [];
  const slug = contadorDeSlugs(), comentario = { aberto: false };
  let cerca: { c: string; n: number; indent: number } | null = null;
  // Codigo indentado so abre onde um paragrafo nao continua: inicio, linha em branco, titulo, cerca.
  let emHtml = false, emCodigoIndentado = false, podeCodigoIndentado = true;
  let paragrafo: Linha[] = [];

  // Paragrafo inteiro: o span de codigo atravessa linha; link e mencao sao lidos por linha.
  const fecharParagrafo = (): void => {
    if (!paragrafo.length) return;
    const juntas = semCodigo(paragrafo.map((l) => l.texto).join('\n')).split('\n');
    paragrafo.forEach((l, k) => {
      let mencao = l.texto;
      for (const x of linksDa(juntas[k], l.texto)) {
        links.push({ destino: x.destino, inicio: l.inicio + x.i, fim: l.inicio + x.f });
        mencao = apagar(mencao, x.di, x.df);
      }
      textoDeMencao.push({ inicio: l.inicio, texto: mencao });
    });
    paragrafo = [];
  };

  for (const l of corpo) {
    const q = semCitacao(l.texto), conteudo = l.texto.slice(q);
    if (cerca) {
      const f = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/.exec(conteudo);
      if (f && f[2][0] === cerca.c && f[2].length >= cerca.n && indentacao(f[1]) <= cerca.indent + 3) {
        cerca = null;
        podeCodigoIndentado = true;
      }
      continue;
    }
    if (!conteudo.trim()) {
      fecharParagrafo();
      emHtml = false;
      podeCodigoIndentado = true;
      continue;
    }
    // Cerca em qualquer indentacao e dentro de citacao: dentro de lista ela ainda e codigo.
    const abre = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(conteudo);
    if (abre && !(abre[2][0] === '`' && abre[3].includes('`'))) {
      fecharParagrafo();
      cerca = { c: abre[2][0], n: abre[2].length, indent: indentacao(abre[1]) };
      continue;
    }
    // Codigo indentado: 4 espacos depois de linha em branco. Continuacao de lista cai aqui tambem.
    if (indentacao(conteudo) >= 4 && (podeCodigoIndentado || emCodigoIndentado) && !paragrafo.length) {
      emCodigoIndentado = true;
      continue;
    }
    emCodigoIndentado = false;
    podeCodigoIndentado = false;
    const semHtml = semComentario(l.texto, comentario);
    // Bloco HTML ate a proxima linha em branco: o Markdown dentro dele nao e lido.
    if (emHtml || /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s>/]|$)/.test(semHtml.slice(q))) {
      fecharParagrafo();
      emHtml = true;
      continue;
    }
    const titulo = tituloAtx(semHtml.slice(q));
    if (titulo) {
      fecharParagrafo();
      const base = titulo.texto.length <= TETO_DO_TITULO ? slugDoGithub(titulo.texto) : '';
      if (base) {
        const s = slug(base);
        secoes.push({ slug: aceitaFragmento(s) ? s : null, inicio: l.inicio + q + titulo.inicio, fim: l.inicio + semHtml.trimEnd().length });
      } else if (titulo.texto) secoes.push({ slug: null, inicio: l.inicio + q + titulo.inicio, fim: l.inicio + semHtml.trimEnd().length });
      paragrafo = [{ inicio: l.inicio, texto: apagar(semHtml, 0, q) }];
      fecharParagrafo();
      podeCodigoIndentado = true;
      continue;
    }
    paragrafo.push({ inicio: l.inicio, texto: apagar(semHtml, 0, q) });
  }
  fecharParagrafo();
  return { fonte, secoes, links, textoDeMencao, frontmatter, frontmatterInvalido };
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

const decodificar = (t: string): string | null => {
  try {
    return decodeURIComponent(t);
  } catch {
    return null;
  }
};

export function extrairMarkdown(e: EntradaMd): Achados {
  const saida: Achados = { nos: [], arestas: [], diagnosticos: [], lacunas: [] };
  const arquivos = new Set(e.arquivos), diretorios = new Set<string>();
  for (const p of e.arquivos) {
    const partes = p.split('/');
    for (let i = 1; i < partes.length; i++) diretorios.add(partes.slice(0, i).join('/'));
  }
  const estruturas = e.fontes.map((f) => estruturar(f, e.aceitaFragmento));
  const slugs = new Map(estruturas.map((s) => [s.fonte.path, new Set(s.secoes.map((x) => x.slug).filter((x): x is string => x !== null))]));
  const aresta = (kind: AchadoDeAresta['kind'], from: RefDeNo, to: RefDeNo, extrator: string, metodo: AchadoDeAresta['metodo'], t: Trecho): void => {
    saida.arestas.push({ kind, from, to, extrator, metodo, trecho: t });
  };
  const lacuna = (categoria: string, path: string, inicio: number | null, detalhe: string | null): void => {
    saida.lacunas.push({ categoria, path, inicio, detalhe });
  };

  // D6: artefatos; ID repetido em dois arquivos nao prova destino e fica fora dos dois.
  const donos = new Map<string, string[]>();
  for (const s of estruturas) {
    if (s.frontmatterInvalido) lacuna('frontmatter-invalido', s.fonte.path, 0, null);
    const nome = s.fonte.path.slice(s.fonte.path.lastIndexOf('/') + 1), d = s.frontmatter?.dados;
    if (!d || nome.startsWith('_') || typeof d.id !== 'string' || !PADRAO_DE_ID.test(d.id) || typeof d.tipo !== 'string' || !d.tipo) continue;
    if (!e.aceitaFragmento(d.id)) {
      lacuna('artefato-recusado', s.fonte.path, 0, null);
      continue;
    }
    donos.set(d.id, [...(donos.get(d.id) ?? []), s.fonte.path]);
  }
  const artefatos = new Map<string, RefDeNo>();
  for (const [id, caminhos] of donos) {
    if (caminhos.length === 1) artefatos.set(id, { kind: 'artifact', path: caminhos[0], fragment: id });
    else for (const p of caminhos) lacuna('artefato-id-repetido', p, 0, id);
  }
  for (const r of artefatos.values()) saida.nos.push(r);

  // Trecho sob titulo recusado fica no arquivo: atribuir a secao anterior seria outra secao.
  const secaoEm = (s: Estrutura, arquivo: RefDeNo, o: number): RefDeNo => {
    let atual: Secao | null = null;
    for (const x of s.secoes) {
      if (x.inicio > o) break;
      atual = x;
    }
    return atual && atual.slug !== null ? { kind: 'section', path: arquivo.path, fragment: atual.slug } : arquivo;
  };
  const mencoes = (fonte: FonteDeTexto, linhas: readonly Linha[], origem: (o: number) => RefDeNo): void => {
    for (const l of linhas) {
      for (const m of l.texto.matchAll(MENCAO)) {
        const alvo = artefatos.get(m[0]), inicio = l.inicio + (m.index as number);
        if (!alvo) {
          lacuna('id-sem-artefato', fonte.path, inicio, m[0]);
          continue;
        }
        aresta('references', origem(inicio), alvo, e.extratorId, 'text-location', { path: fonte.path, inicio, fim: inicio + m[0].length });
      }
    }
  };

  for (const s of estruturas) {
    const path = s.fonte.path, arquivo: RefDeNo = { kind: 'file', path, fragment: null };
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
      const destino = k.destino.trim();
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
      const alvo = caminhoDecodificado === '' ? path : resolverCaminho(path, caminhoDecodificado);
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

    const artefato = s.frontmatter && typeof s.frontmatter.dados.id === 'string' ? artefatos.get(s.frontmatter.dados.id) : undefined;
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
    mencoes(s.fonte, s.textoDeMencao, (o) => secaoEm(s, arquivo, o));
  }
  for (const f of e.codigo) {
    const arquivo: RefDeNo = { kind: 'file', path: f.path, fragment: null };
    mencoes(f, linhasDe(f.texto), () => arquivo);
  }
  return saida;
}
