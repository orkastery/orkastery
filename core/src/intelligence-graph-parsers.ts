/**
 * RM-031 KG3 (D1): os analisadores do extrator do grafo, carregados da instalacao do `ork` que
 * roda. Sucede o adaptador do micromark e o juiz de sintaxe que o comando provisorio do KG2 levava
 * em `core/scripts/` (KG2 D15 e D16), com o mesmo comportamento e as mesmas versoes.
 *
 * `typescript` e os pacotes do micromark so valem dentro da instalacao do `ork` que roda (o
 * `node_modules` do pacote `@orkastery/cli` que contem este modulo), nunca do diretorio atual, do
 * `NODE_PATH` nem de uma pasta acima, como a do projeto que instalou o `ork` como dependencia: o
 * repositorio lido e dado, e codigo dele nunca e carregado. Eles nao sao dependencias de runtime do
 * pacote publicado (D1: dependencia nova e decisao de produto); onde faltam ou estao fora da
 * instalacao, a recusa e `grafo.parser.indisponivel: <pacote>`. `pacotesDosAnalisadores` lista o
 * fecho de dependencias deles, com versao, para a chave do indice (CHECK rodada 1, A10).
 *
 * O juiz de sintaxe e o V8 do Node que roda a extracao, o mesmo que carregaria o arquivo. CommonJS
 * compila aqui, em funcao com as variaveis do modulo, como o carregador faz. ESM compila num unico
 * processo filho por chamada, com `vm.SourceTextModule`, que so analisa o modulo, sem ligar nem
 * avaliar. O filho roda sem ambiente e com argumentos fixos; o veredito volta estruturado no stdout
 * e o stderr nunca e lido. Nada e executado.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import type * as TS from 'typescript';
import type { Parser } from './intelligence-graph-extract';
import type { EventoMd } from './intelligence-graph-extract-md';

/** Os unicos pacotes que o nucleo carrega para extrair: o compilador e o micromark com a tabela GFM. */
export const PACOTES_DOS_ANALISADORES = [
  'typescript', 'micromark', 'micromark-extension-gfm-table', 'decode-named-character-reference',
  'micromark-util-decode-numeric-character-reference',
] as const;
type Pacote = typeof PACOTES_DOS_ANALISADORES[number];

/** As versoes que entram nas dos extratores (KG2): lidas sem carregar o compilador, para a chave do indice. */
export interface VersoesDosAnalisadores {
  typescript: string;
  /** `node.<versao>`, a do juiz de sintaxe. */
  javascript: string;
  /** `micromark.<versao>.gfm-table.<versao>`. */
  markdown: string;
  unicode: string;
}

const NOME_DA_INSTALACAO = '@orkastery/cli';

function lerJson(arquivo: string): { name?: unknown; version?: unknown; dependencies?: unknown; optionalDependencies?: unknown } | null {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return null;
  }
}

/** A raiz do pacote `@orkastery/cli` que contem este modulo: `dist/` ou `dist-test/src/` ficam abaixo dela. */
function raizDaInstalacao(): string {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    if (lerJson(path.join(dir, 'package.json'))?.name === NOME_DA_INSTALACAO) return dir;
    if (path.dirname(dir) === dir) throw new Error('grafo.parser.indisponivel: instalacao do ork nao encontrada');
  }
}

/**
 * O `node_modules` da instalacao pelo caminho real: o `require.resolve` devolve o caminho real do
 * pacote, e o `node_modules` pode ser link simbolico (clone com as dependencias ligadas, pnpm).
 * CHECK rodada 2 (R2-B1): comparar o caminho sem resolver recusava a instalacao inteira.
 */
function modulosDaInstalacao(raiz: string): string | null {
  try {
    return fs.realpathSync(path.join(raiz, 'node_modules'));
  } catch {
    return null;
  }
}

/** Sem `node_modules` na instalacao, nada esta dentro dela. */
const dentro = (modulos: string | null, alvo: string): boolean => modulos !== null && alvo.startsWith(modulos + path.sep);

/**
 * Resolve a entrada do pacote a partir da instalacao e sobe ate o `package.json` com o nome dele,
 * sem sair do pacote. O `exports` do micromark nao expoe o `package.json`, e um `package.json` de
 * subpasta (`{ "type": "module" }`) nao tem nome. Entrada fora do `node_modules` da instalacao
 * (pasta acima, `NODE_PATH`, pasta global) e recusada antes de qualquer leitura dela.
 */
function pacoteDe(nome: Pacote): { entrada: string; dir: string; versao: string } {
  const raiz = raizDaInstalacao();
  let entrada: string;
  try {
    entrada = require.resolve(nome, { paths: [raiz] });
  } catch {
    throw new Error(`grafo.parser.indisponivel: ${nome}`);
  }
  if (!dentro(modulosDaInstalacao(raiz), entrada)) throw new Error(`grafo.parser.indisponivel: ${nome} fora da instalacao do ork`);
  for (let dir = path.dirname(entrada); path.basename(dir) !== 'node_modules' && path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    const dados = lerJson(path.join(dir, 'package.json'));
    if (dados && dados.name === nome && typeof dados.version === 'string') return { entrada, dir, versao: dados.version };
  }
  throw new Error(`grafo.parser.indisponivel: ${nome} sem package.json`);
}

/**
 * O `package.json` da dependencia `dep` vista de `de`, pela busca do Node, sem sair da instalacao.
 * Tudo em caminho real: `de` vem do `require.resolve`, e o topo e a pasta real que contem o
 * `node_modules` da instalacao.
 */
function pacoteInstalado(modulos: string | null, dep: string, de: string): string | null {
  if (modulos === null) return null;
  const topo = path.dirname(modulos);
  for (let dir = de; dir === topo || dir.startsWith(topo + path.sep); dir = path.dirname(dir)) {
    if (path.basename(dir) !== 'node_modules') {
      const arquivo = path.join(dir, 'node_modules', dep, 'package.json');
      if (fs.existsSync(arquivo)) {
        const real = fs.realpathSync(arquivo);
        return dentro(modulos, real) ? real : null;
      }
    }
    if (dir === topo) break;
  }
  return null;
}

/**
 * CHECK rodada 1 (A10): o fecho de dependencias dos analisadores, `nome@versao` ordenado. O parser
 * de CommonMark (`micromark-core-commonmark`) e os utilitarios mudam o grafo sem mudar a versao do
 * micromark: a chave do indice precisa deles.
 */
export function pacotesDosAnalisadores(): string[] {
  const modulos = modulosDaInstalacao(raizDaInstalacao()), vistos = new Map<string, string>();
  const fila = PACOTES_DOS_ANALISADORES.map((p) => path.join(pacoteDe(p).dir, 'package.json'));
  while (fila.length) {
    const arquivo = fila.shift() as string;
    const dados = lerJson(arquivo);
    if (!dados || typeof dados.name !== 'string' || typeof dados.version !== 'string') throw new Error(`grafo.parser.indisponivel: ${arquivo} ilegivel`);
    const chave = `${dados.name}@${dados.version}`;
    if (vistos.has(arquivo)) continue;
    vistos.set(arquivo, chave);
    const deps = { ...(dados.optionalDependencies as object ?? {}), ...(dados.dependencies as object ?? {}) };
    for (const dep of Object.keys(deps).sort()) {
      const achado = pacoteInstalado(modulos, dep, path.dirname(arquivo));
      if (achado && !vistos.has(achado)) fila.push(achado);
      else if (!achado) vistos.set(`${arquivo}\u0000${dep}`, `${dep}@ausente`);
    }
  }
  return [...new Set(vistos.values())].sort();
}

export function versoesDosAnalisadores(): VersoesDosAnalisadores {
  const versoes = Object.fromEntries(PACOTES_DOS_ANALISADORES.map((p) => [p, pacoteDe(p).versao])) as Record<Pacote, string>;
  return {
    typescript: versoes.typescript,
    javascript: `node.${process.versions.node}`,
    markdown: `micromark.${versoes.micromark}.gfm-table.${versoes['micromark-extension-gfm-table']}`,
    unicode: String(process.versions.unicode),
  };
}

/** O micromark e so ESM: o `require` de ESM do Node carrega; onde ele nao existe, a recusa e tipada. */
function carregar(nome: Pacote): any {
  const { entrada } = pacoteDe(nome);
  try {
    return require(entrada);
  } catch (e) {
    throw new Error(`grafo.parser.indisponivel: ${nome} (${(e as NodeJS.ErrnoException).code ?? 'erro ao carregar'})`);
  }
}

interface TokenMd { type: string; start: { offset: number }; end: { offset: number } }

/**
 * KG2 D15: `analisar(texto)` devolve os eventos do micromark com o offset no texto (unidades UTF-16);
 * `referencia(valor)` decodifica uma referencia de caractere (`eacute`, `#233`, `#xE9`) com as
 * funcoes que o micromark usa ao gerar HTML, e devolve `null` se o nome nao e entidade do HTML5.
 */
function carregarMarkdown(versao: string): Parser['markdown'] {
  const { parse, postprocess, preprocess } = carregar('micromark');
  const { gfmTable } = carregar('micromark-extension-gfm-table');
  const { decodeNamedCharacterReference } = carregar('decode-named-character-reference');
  const { decodeNumericCharacterReference } = carregar('micromark-util-decode-numeric-character-reference');
  if (typeof parse !== 'function' || typeof postprocess !== 'function' || typeof preprocess !== 'function' || typeof gfmTable !== 'function'
    || typeof decodeNamedCharacterReference !== 'function' || typeof decodeNumericCharacterReference !== 'function') {
    throw new Error('grafo.parser.indisponivel: micromark sem a API esperada');
  }
  const extensions = [gfmTable()];
  const referencia = (valor: string): string | null => {
    if (valor[0] !== '#') return decodeNamedCharacterReference(valor) || null;
    const hexa = valor[1] === 'x' || valor[1] === 'X';
    return decodeNumericCharacterReference(valor.slice(hexa ? 2 : 1), hexa ? 16 : 10);
  };
  const analisar = (texto: string): EventoMd[] =>
    (postprocess(parse({ extensions }).document().write(preprocess()(texto, undefined, true))) as [string, TokenMd][])
      .map(([tipo, token]) => ({ entrada: tipo === 'enter', tipo: token.type, inicio: token.start.offset, fim: token.end.offset }));
  return { analisar, referencia, versao };
}

const VARIAVEIS_DO_CJS = ['exports', 'require', 'module', '__filename', '__dirname'];
/** O V8 encerra a linha, e a linha `#!`, em LF, CR, U+2028 e U+2029. */
const FIM_DE_LINHA = new Set([0x0a, 0x0d, 0x2028, 0x2029]);
/** Processo filho: le os textos por stdin e devolve 1 (aceito), 0 (SyntaxError), 3 (pilha estourada) ou 2 (outro erro). */
const FILHO = `
const vm = require('node:vm');
const partes = [];
process.stdin.on('data', (c) => partes.push(c));
process.stdin.on('end', () => {
  const textos = JSON.parse(Buffer.concat(partes).toString('utf8'));
  const r = textos.map((t) => {
    try { new vm.SourceTextModule(t); return 1; } catch (e) { return e instanceof SyntaxError ? 0 : e instanceof RangeError ? 3 : 2; }
  });
  process.stdout.write(JSON.stringify(r));
});
`;

/**
 * Como o carregador do Node le a fonte: a linha `#!` do inicio em branco e, so no ESM, sem o BOM (o
 * carregador CommonJS recusa BOM antes do `#!`).
 */
function comoOCarregadorLe(texto: string, formato: 'cjs' | 'esm'): string {
  const t = formato === 'esm' && texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  if (!t.startsWith('#!')) return t;
  let fim = 2;
  while (fim < t.length && !FIM_DE_LINHA.has(t.charCodeAt(fim))) fim++;
  return ' '.repeat(fim) + t.slice(fim);
}

/** KG2 D16: o juiz de sintaxe do JavaScript, em lote e com cache por texto dentro de uma extracao. */
export function criarJuizDeSintaxe(): Parser['javascript'] {
  const vistos = new Map<string, boolean>();
  const cjs = (texto: string): boolean => {
    try {
      vm.compileFunction(texto, VARIAVEIS_DO_CJS);
      return true;
    } catch (e) {
      if (e instanceof SyntaxError) return false;
      throw e;
    }
  };
  const esmEmLote = (textos: string[]): boolean[] => {
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', FILHO], {
      input: JSON.stringify(textos), encoding: 'utf8', env: {}, maxBuffer: 64 * 1024 * 1024, timeout: 600000,
    });
    if (r.error || r.signal || r.status !== 0) {
      throw new Error(`sintaxe.esm.indisponivel: ${r.error ? (r.error as NodeJS.ErrnoException).code ?? 'erro' : r.signal ?? `status ${r.status}`}`);
    }
    let vereditos: unknown = null;
    try {
      vereditos = JSON.parse(r.stdout);
    } catch {
      vereditos = null;
    }
    if (!Array.isArray(vereditos) || vereditos.length !== textos.length || vereditos.some((v) => ![0, 1, 2, 3].includes(v))) {
      throw new Error('sintaxe.esm.indisponivel: resposta invalida do filho');
    }
    // Pilha estourada no V8 do filho: o extrator a trata como a propria (`extracao.limite.pilha`).
    if (vereditos.includes(3)) throw new RangeError('Maximum call stack size exceeded no juiz de sintaxe ESM');
    if (vereditos.includes(2)) throw new Error('sintaxe.esm.indisponivel: erro que nao e de sintaxe no filho');
    return vereditos.map((v) => v === 1);
  };
  const sintaxe = (pedidos: readonly { texto: string; formato: 'cjs' | 'esm' }[]): boolean[] => {
    const chaves = pedidos.map((p) => p.formato + createHash('sha256').update(p.texto).digest('hex'));
    const esm = new Map<string, string>();
    pedidos.forEach((p, i) => {
      if (vistos.has(chaves[i]) || esm.has(chaves[i])) return;
      const t = comoOCarregadorLe(p.texto, p.formato);
      if (p.formato === 'cjs') vistos.set(chaves[i], cjs(t));
      else esm.set(chaves[i], t);
    });
    if (esm.size) {
      const lista = [...esm];
      const r = esmEmLote(lista.map(([, t]) => t));
      lista.forEach(([k], i) => vistos.set(k, r[i]));
    }
    return chaves.map((k) => vistos.get(k) as boolean);
  };
  return { sintaxe, versao: `node.${process.versions.node}` };
}

/**
 * O `Parser` do extrator do KG2, com o compilador e o micromark desta instalacao. Confere que o
 * compilador carregado e o da versao lida para a chave do indice.
 */
export function carregarAnalisadores(): Parser {
  const versoes = versoesDosAnalisadores();
  const ts = carregar('typescript') as typeof TS;
  if (!ts || typeof ts.createProgram !== 'function' || ts.version !== versoes.typescript) {
    throw new Error(`grafo.parser.indisponivel: typescript ${ts.version} carregado, ${versoes.typescript} no package.json`);
  }
  return { ts, unicode: versoes.unicode, markdown: carregarMarkdown(versoes.markdown), javascript: criarJuizDeSintaxe() };
}
