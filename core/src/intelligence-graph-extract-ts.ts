/**
 * RM-031 KG2 (D2 a D4): extrator `ork.ts-ast` de TypeScript e JavaScript.
 *
 * O compilador chega por parametro e roda num host em memoria que so enxerga o manifesto: sem
 * biblioteca padrao, sem disco e sem resolver para dentro de `node_modules` (D2). A raiz virtual
 * deriva do conteudo do manifesto, entao especificador que sobe acima da raiz ou e absoluto nunca
 * cai de volta num arquivo do repositorio. Import e chamada so viram aresta quando o binder liga o
 * nome a uma declaracao do repositorio por escopo lexico ou por um import deste arquivo; despacho
 * por tipo inferido, global compartilhado entre scripts, alvo ambiguo e import em que o compilador
 * e o runtime divergem ficam fora e sao contados (D3). Simbolo e declaracao de topo ou membro de
 * classe de topo, pelo nome declarado (D4); nome que o contrato recusaria nao vira no.
 */
import type * as TS from 'typescript';
import type { AchadoDeAresta, Achados, FonteDeTexto, RefDeNo, Trecho } from './intelligence-graph-extract';
import { caminhoDaCitacao } from './intelligence-graph-extract-md';

export interface EntradaTs {
  /** Fontes TS/JS ja decodificadas, em ordem de caminho. */
  fontes: readonly FonteDeTexto[];
  /** Todos os caminhos do manifesto: o host so resolve para eles. */
  arquivos: readonly string[];
  /** Texto de qualquer fonte do manifesto (JSON importado, `package.json` de diretorio). */
  texto: (caminho: string) => string | undefined;
  /** Raiz virtual absoluta, sem barra no fim, que nenhum caminho do repositorio consegue nomear. */
  raiz: string;
  /** Regra de texto do contrato para `fragment`: nome recusado nao vira simbolo. */
  aceitaFragmento: (fragmento: string) => boolean;
  /** D16: se o V8 do Node aceita cada texto como CommonJS (`cjs`) ou como ESM (`esm`), na mesma ordem, em lote. */
  sintaxe: (pedidos: readonly { texto: string; formato: 'cjs' | 'esm' }[]) => readonly boolean[];
  extrator: string;
  /**
   * RM-031 KG4 (D3): so estes arquivos tem os achados extraidos; as outras fontes so dao contexto ao
   * programa parcial (fecho direto e globais). Ausente, todas as fontes.
   */
  emitir?: ReadonlySet<string>;
}

/** RM-031 KG4 (D3): o que o incremental guarda de cada arquivo TS/JS extraido. */
export interface UnidadeTs {
  /** Caminhos do manifesto a que as referencias de modulo do arquivo resolvem: compilador, runtime e implementacao. */
  dependencias: string[];
  /** Bases das resolucoes relativas; caminho novo ou removido que casa uma delas (`casaSonda`) pode mudar a resolucao. */
  sondas: string[];
  achados: Achados;
}

export interface ResultadoTs {
  /** Uma por arquivo extraido (todas as fontes, ou as de `emitir`), em ordem de caminho. */
  unidades: Map<string, UnidadeTs>;
  /** Arquivos do programa com declaracao no escopo global ou aumento de modulo, ordenados. */
  globais: string[];
  /** Alvos TS/JS das fontes que nao estao entre elas: o programa parcial precisa crescer antes de extrair. */
  faltantes: string[];
}

/** Extensoes que o extrator TS le; as do `extensaoDe` do KG2. */
const EXTENSOES_DO_PROGRAMA = ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'];
const DECLARACOES_TS = ['.d.ts', '.d.mts', '.d.cts'];

/** KG5: candidatos literais; dist -> src e uma convencao de citacao, nunca prova de import. */
function candidatosDaCitacao(base: string): string[][] {
  const formas = (p: string): string[] => {
    const semJs = p.replace(/\.(?:[cm]?js|jsx)$/, '');
    if (semJs !== p) return [semJs + '.ts', semJs + '.tsx', semJs + '.mts', semJs + '.cts'];
    if (/\.[^/]+$/.test(p)) return [];
    return EXTENSOES_DO_PROGRAMA.flatMap((ext) => [p + ext, p + '/index' + ext]);
  };
  const grupos = [[base], formas(base)];
  const fonte = base.replace(/(^|\/)dist\//, '$1src/');
  if (fonte !== base) grupos.push([fonte], formas(fonte));
  return grupos;
}

/** A base sem a extensao (o TypeScript troca `.js` por `.ts`, e `.d.ts` conta inteira). */
function semExtensao(base: string): string {
  const nome = base.slice(base.lastIndexOf('/') + 1);
  for (const d of DECLARACOES_TS) if (nome.endsWith(d) && nome.length > d.length) return base.slice(0, -d.length);
  const i = nome.lastIndexOf('.');
  return i <= 0 ? base : base.slice(0, base.length - (nome.length - i));
}

/**
 * RM-031 KG4 (D3): o caminho `p`, novo ou removido, pode mudar uma resolucao de base `base`? O
 * TypeScript e o Node so tentam a base exata, a base com extensao, a base como pasta (`index`,
 * `package.json`) e o mesmo sem a extensao; base vazia (a raiz) casa tudo.
 */
export function casaSonda(base: string, p: string): boolean {
  if (base === '') return true;
  if (p === base || p.startsWith(`${base}.`) || p.startsWith(`${base}/`)) return true;
  const sem = semExtensao(base);
  return sem !== base && (p === sem || p.startsWith(`${sem}.`) || p.startsWith(`${sem}/`));
}

/** D2: opcoes fixas do compilador, descritas por nome para entrar no `config_hash`. */
export const OPCOES_TS_DESCRITAS = Object.freeze({
  allowJs: true, checkJs: false, esModuleInterop: true, jsx: 'preserve', module: 'commonjs', moduleResolution: 'node10',
  noLib: true, resolveJsonModule: true, target: 'es2022', types: [] as string[], node_modules: 'fora-da-resolucao',
});

const EXTENSOES_JS = ['.cjs', '.js', '.jsx', '.mjs'];

/**
 * B3: o especificador ESM e URL. A leitura como URL so coincide com o caminho literal quando nao ha
 * busca nem fragmento (`?`, `#`), escape (`%`), barra invertida (vira `/`), espaco nem controle (a URL
 * apara as pontas e descarta tab e quebra de linha) e quando o ultimo segmento e um nome (barra final,
 * `.` e `..` apontam para pasta, que o ESM nao importa).
 */
function urlComoCaminho(especificador: string): boolean {
  for (let i = 0; i < especificador.length; i++) {
    const c = especificador.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x23 || c === 0x25 || c === 0x3f || c === 0x5c) return false;
  }
  const ultimo = especificador.slice(especificador.lastIndexOf('/') + 1);
  return ultimo !== '' && ultimo !== '.' && ultimo !== '..';
}
/** Texto sem surrogate solto (o `JSON.parse` aceita o escape de D800 sem par; o leitor do Node, nao). */
function textoBemFormado(t: string): boolean {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = t.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

function opcoes(ts: typeof TS): TS.CompilerOptions {
  return {
    allowJs: true, checkJs: false, esModuleInterop: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, noLib: true, resolveJsonModule: true, target: ts.ScriptTarget.ES2022,
    types: [], noEmit: true, skipLibCheck: true,
  };
}

const extensao = (p: string): string => {
  const nome = p.slice(p.lastIndexOf('/') + 1), i = nome.lastIndexOf('.');
  return i <= 0 ? '' : nome.slice(i).toLowerCase();
};
const emNodeModules = (p: string): boolean => p.split('/').includes('node_modules');

/** Caminho relativo a raiz de um especificador relativo; `null` se sair do repositorio. */
function caminhoLiteral(de: string, especificador: string): string | null {
  if (!especificador.startsWith('./') && !especificador.startsWith('../')) return null;
  const partes = [...de.split('/').slice(0, -1), ...especificador.split('/')], r: string[] = [];
  for (const p of partes) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (!r.length) return null;
      r.pop();
    } else r.push(p);
  }
  return r.join('/');
}

/**
 * RM-031 KG4 (D3): modulo vazio fora da raiz virtual (nenhum caminho do manifesto o nomeia, e nada o
 * resolve), so para ler o escopo global do checker sem local que esconda global de mesmo nome.
 */
const TEXTO_DO_SINTETICO = 'export {};\n';

function criarHost(ts: typeof TS, e: EntradaTs, sintetico: string): TS.CompilerHost {
  const arquivos = new Set(e.arquivos), dirs = new Set<string>([e.raiz]);
  for (const p of e.arquivos) {
    const partes = p.split('/');
    for (let i = 1; i < partes.length; i++) dirs.add(`${e.raiz}/${partes.slice(0, i).join('/')}`);
  }
  const dentro = (nome: string): string | null => (nome.startsWith(`${e.raiz}/`) ? nome.slice(e.raiz.length + 1) : null);
  // A resolucao de modulo nunca entra em node_modules, mesmo versionado: pacote de terceiro e externo.
  const resolvivel = (nome: string): string | null => {
    const p = dentro(nome);
    return p !== null && !emNodeModules(p) ? p : null;
  };
  return {
    getSourceFile: (nome, alvo) => {
      if (nome === sintetico) return ts.createSourceFile(nome, TEXTO_DO_SINTETICO, alvo, true);
      const p = dentro(nome), t = p === null ? undefined : e.texto(p);
      return t === undefined ? undefined : ts.createSourceFile(nome, t, alvo, true);
    },
    getDefaultLibFileName: () => `${e.raiz}/__sem-biblioteca__.d.ts`,
    writeFile: () => undefined,
    getCurrentDirectory: () => e.raiz,
    getDirectories: () => [],
    fileExists: (nome) => {
      const p = resolvivel(nome);
      return p !== null && arquivos.has(p);
    },
    readFile: (nome) => {
      const p = resolvivel(nome);
      return p === null || !arquivos.has(p) ? undefined : e.texto(p);
    },
    directoryExists: (nome) => {
      const n = nome.length > 1 && nome.endsWith('/') ? nome.slice(0, -1) : nome, p = n === e.raiz ? '' : resolvivel(n);
      return p !== null && dirs.has(n);
    },
    realpath: (p) => p,
    getCanonicalFileName: (p) => p,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
}

export function extrairTypeScript(e: EntradaTs, ts: typeof TS): ResultadoTs {
  const resultado: ResultadoTs = { unidades: new Map(), globais: [], faltantes: [] };
  if (e.fontes.length === 0) return resultado;
  const absoluto = (p: string): string => `${e.raiz}/${p}`;
  const relativo = (p: string): string | null => (p.startsWith(`${e.raiz}/`) ? p.slice(e.raiz.length + 1) : null);
  const sintetico = `${e.raiz}-escopo-global.ts`;
  const host = criarHost(ts, e, sintetico), opts = opcoes(ts);
  const programa = ts.createProgram([...e.fontes.map((f) => absoluto(f.path)), sintetico], opts, host);
  const checker = programa.getTypeChecker();
  const cache = ts.createModuleResolutionCache(e.raiz, (p) => p, opts);
  const arquivos = new Set(e.arquivos);
  const S = ts.SymbolFlags, K = ts.SyntaxKind;

  const ehTopo = (n: TS.Node): boolean => !!n.parent && ts.isSourceFile(n.parent);
  const exportaDefault = (n: TS.Declaration): boolean => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Default) !== 0;
  const variavelDoTopo = (d: TS.VariableDeclaration): boolean =>
    ts.isVariableDeclarationList(d.parent) && ts.isVariableStatement(d.parent.parent) && ehTopo(d.parent.parent);
  const membroDeClasse = (n: TS.Node): n is TS.ClassElement =>
    ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)
    || ts.isConstructorDeclaration(n);
  const nomeDe = (n: TS.Node | undefined): string | null =>
    n && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) ? n.text : null;
  const nomeDaClasse = (c: TS.ClassDeclaration): string | null => (c.name ? c.name.text : exportaDefault(c) ? 'default' : null);

  /** D4: nome do simbolo de uma declaracao, antes da regra de texto do contrato. */
  function nomeDoSimbolo(d: TS.Node): string | null {
    if (ts.isBindingElement(d)) {
      let p: TS.Node = d;
      while (ts.isBindingElement(p) || ts.isObjectBindingPattern(p) || ts.isArrayBindingPattern(p)) p = p.parent;
      return ts.isVariableDeclaration(p) && variavelDoTopo(p) && ts.isIdentifier(d.name) ? d.name.text : null;
    }
    if (ts.isVariableDeclaration(d)) return variavelDoTopo(d) && ts.isIdentifier(d.name) ? d.name.text : null;
    if (ts.isFunctionDeclaration(d)) return ehTopo(d) ? (d.name ? d.name.text : exportaDefault(d) ? 'default' : null) : null;
    if (ts.isClassDeclaration(d)) return ehTopo(d) ? nomeDaClasse(d) : null;
    if (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isEnumDeclaration(d)) return ehTopo(d) ? d.name.text : null;
    if (ts.isModuleDeclaration(d)) {
      return ehTopo(d) && ts.isIdentifier(d.name) && (d.flags & ts.NodeFlags.GlobalAugmentation) === 0 ? d.name.text : null;
    }
    // `export default nome` so reexporta: o import resolve ate a declaracao de `nome`.
    if (ts.isExportAssignment(d)) return ehTopo(d) && !d.isExportEquals && !ts.isIdentifier(d.expression) ? 'default' : null;
    if (membroDeClasse(d) && ts.isClassDeclaration(d.parent) && ehTopo(d.parent)) {
      const classe = nomeDaClasse(d.parent), membro = ts.isConstructorDeclaration(d) ? 'constructor' : nomeDe(d.name);
      return classe !== null && membro !== null ? `${classe}.${membro}` : null;
    }
    return null;
  }

  /** Ref do simbolo; nome que o contrato recusaria (vazio, longo, com controle) nao vira no. */
  const refDe = (d: TS.Node): RefDeNo | null => {
    const fragment = nomeDoSimbolo(d), path = relativo(d.getSourceFile().fileName);
    return fragment === null || path === null || !e.aceitaFragmento(fragment) ? null : { kind: 'symbol', path, fragment };
  };
  const semAlias = (s: TS.Symbol | undefined): TS.Symbol | undefined => (s && s.flags & S.Alias ? checker.getAliasedSymbol(s) : s);

  /** O alvo precisa cair num no so: declaracao fora do grafo ou em mais de um no nao liga. */
  function alvoDo(s: TS.Symbol | undefined): { ref: RefDeNo | null; categoria: string } {
    const decls = s?.declarations ?? [];
    if (decls.length === 0) return { ref: null, categoria: 'chamada-nao-resolvida' };
    const refs = new Map<string, RefDeNo>();
    for (const d of decls) {
      const r = refDe(d);
      if (!r) return { ref: null, categoria: 'chamada-alvo-fora-do-grafo' };
      refs.set(`${r.path}\u0000${r.fragment}`, r);
    }
    return refs.size === 1 ? { ref: [...refs.values()][0], categoria: '' } : { ref: null, categoria: 'chamada-alvo-ambiguo' };
  }

  /** Resolucao do compilador, restrita ao manifesto e fora de node_modules. */
  function resolver(especificador: string, de: string): string | null {
    const r = ts.resolveModuleName(especificador, absoluto(de), opts, host, cache).resolvedModule;
    const p = r && !r.isExternalLibraryImport ? relativo(r.resolvedFileName) : null;
    return p !== null && arquivos.has(p) && !emNodeModules(p) ? p : null;
  }

  const literal = (n: TS.Node | undefined): string | null =>
    n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  const ehRequire = (n: TS.Node): n is TS.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression)
    && n.expression.text === 'require' && n.arguments.length === 1 && !(checker.getSymbolAtLocation(n.expression)?.declarations ?? []).length;
  const ehImportDinamico = (n: TS.Node): n is TS.CallExpression => ts.isCallExpression(n) && n.expression.kind === K.ImportKeyword;

  /** Declaracao local que liga um nome a um modulo: import, `import = require` ou `require` atribuido. */
  function ehImportLocal(d: TS.Declaration, sf: TS.SourceFile): boolean {
    if (d.getSourceFile() !== sf) return false;
    if (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d)) return true;
    if (ts.isImportEqualsDeclaration(d)) return ts.isExternalModuleReference(d.moduleReference);
    let v: TS.Node = d;
    while (ts.isBindingElement(v) || ts.isObjectBindingPattern(v) || ts.isArrayBindingPattern(v)) v = v.parent;
    return ts.isVariableDeclaration(v) && !!v.initializer && ehRequire(v.initializer);
  }
  const viaImportLocal = (s: TS.Symbol | undefined, sf: TS.SourceFile): boolean =>
    !!s && (s.flags & S.Alias) !== 0 && (s.declarations ?? []).some((d) => ehImportLocal(d, sf));

  /** O nome importado so traz tipo: o alvo existe e nao tem valor (interface, tipo). */
  const semValor = (nome: TS.Node): boolean => {
    const s0 = checker.getSymbolAtLocation(nome), alvo = s0 && s0.flags & S.Alias ? checker.getAliasedSymbol(s0) : s0;
    return !!alvo && (alvo.declarations?.length ?? 0) > 0 && (alvo.flags & S.Value) === 0;
  };
  /**
   * Chave do especificador de um no de import. `t`: so traz tipo (`import type`, nomes que so sao tipo,
   * `import('x').T`) e some na compilacao, entao segue o compilador; so vale em fonte TypeScript, porque
   * JavaScript nao e compilado e o import roda (B-R1). `d`: `import()`, que o Node resolve como ESM.
   * `r`: `require` literal. `v`: o resto.
   */
  function chaveDoImport(n: TS.Node, compilado: boolean): string | null {
    let esp: string | null = null, tipo = 'v';
    if (ts.isImportDeclaration(n)) {
      esp = literal(n.moduleSpecifier);
      const ic = n.importClause, nomes = ic?.namedBindings && ts.isNamedImports(ic.namedBindings) ? ic.namedBindings.elements : [];
      const soTipo = compilado && !!ic && (ic.isTypeOnly || (!(ic.namedBindings && ts.isNamespaceImport(ic.namedBindings))
        && (!ic.name || semValor(ic.name)) && (!!ic.name || nomes.length > 0) && nomes.every((el) => el.isTypeOnly || semValor(el.name))));
      if (soTipo) tipo = 't';
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      esp = literal(n.moduleSpecifier);
      const nomes = n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements : null;
      if (compilado && (n.isTypeOnly || (nomes && nomes.length > 0 && nomes.every((el) => el.isTypeOnly || semValor(el.name))))) tipo = 't';
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      esp = literal(n.moduleReference.expression);
      if (compilado && n.isTypeOnly) tipo = 't';
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      esp = literal(n.argument.literal);
      tipo = 't';
    } else if (ehImportDinamico(n)) {
      esp = literal(n.arguments[0]);
      tipo = 'd';
    } else if (ehRequire(n)) {
      esp = literal(n.arguments[0]);
      tipo = 'r';
    }
    return esp === null ? null : `${tipo}\u0000${esp}`;
  }
  const especificadorDaChave = (chave: string): string => chave.slice(2);
  /** Fonte TypeScript, que o compilador transforma; JavaScript roda como esta. */
  const compiladoEm = (arquivo: string): boolean => !EXTENSOES_JS.includes(extensao(arquivo));
  /** Chaves de todos os imports dentro de um no. */
  function especificadoresEm(raiz: TS.Node, literais?: Map<TS.Node, string>): string[] {
    const r: string[] = [], compilado = compiladoEm(raiz.getSourceFile().fileName);
    const coletar = (n: TS.Node): void => {
      const chave = chaveDoImport(n, compilado);
      if (chave !== null) {
        r.push(chave);
        const esp = ts.isImportDeclaration(n) || ts.isExportDeclaration(n) ? n.moduleSpecifier
          : ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) ? n.moduleReference.expression
            : ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) ? n.argument.literal
              : ts.isCallExpression(n) ? n.arguments[0] : undefined;
        if (esp) literais?.set(esp, chave);
      }
      ts.forEachChild(n, coletar);
    };
    coletar(raiz);
    return r;
  }

  const DECLARACOES: [string, string][] = [['.d.ts', '.js'], ['.d.cts', '.cjs'], ['.d.mts', '.mjs']];
  const existe = (p: string): string | null => (p !== '' && arquivos.has(p) && !emNodeModules(p) ? p : null);
  /** Implementacao ao lado de um arquivo de declaracao: e ela que roda. */
  function implementacaoDe(declaracao: string): string | null {
    for (const [ext, impl] of DECLARACOES) if (declaracao.endsWith(ext)) return existe(declaracao.slice(0, -ext.length) + impl);
    return null;
  }
  const junta = (pasta: string, nome: string): string => (pasta ? `${pasta}/${nome}` : nome);

  /** JSON como o `JSON.parse` do Node o le, sem o BOM; `undefined` se nao for JSON. */
  function lerJson(caminho: string): unknown {
    const bruto = e.texto(caminho);
    if (bruto === undefined) return undefined;
    try {
      return JSON.parse(bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto) as unknown;
    } catch {
      return undefined;
    }
  }
  /**
   * package.json como o Node 22 o le: BOM ignorado, raiz objeto, `name` e `type` texto sem surrogate
   * solto quando presentes. Fora disso o Node lanca `ERR_INVALID_PACKAGE_CONFIG` e o resultado e `null`.
   */
  const pacotes = new Map<string, Record<string, unknown> | null>();
  function lerPacote(caminho: string): Record<string, unknown> | null {
    const lido = pacotes.get(caminho);
    if (lido !== undefined) return lido;
    let r: Record<string, unknown> | null = null;
    const v = lerJson(caminho);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const texto = (k: string): boolean => !(k in o) || (typeof o[k] === 'string' && textoBemFormado(o[k] as string));
      if (texto('name') && texto('type')) r = o;
    }
    pacotes.set(caminho, r);
    return r;
  }

  /**
   * Resolucao do Node para especificador relativo: exato em ESM; em CommonJS, primeiro como arquivo
   * (exato, `.js`, `.json`, `.node`) e depois como pasta (`main` do package.json, `index`). Barra
   * final, `.` e `..` so valem como pasta. package.json invalido faz o Node falhar; `main` absoluto ou
   * que sai do repositorio aponta para fora do que o manifesto ve, e nao liga.
   */
  function resolverNode(de: string, especificador: string, esm: boolean): string | null {
    const base = caminhoLiteral(de, especificador === '.' || especificador === '..' ? `./${especificador}` : especificador);
    if (base === null) return null;
    if (esm) return existe(base);
    const comoArquivo = (p: string): string | null => (p ? existe(p) ?? existe(`${p}.js`) ?? existe(`${p}.json`) ?? existe(`${p}.node`) : null);
    const comoIndice = (p: string): string | null => existe(junta(p, 'index.js')) ?? existe(junta(p, 'index.json')) ?? existe(junta(p, 'index.node'));
    const comoPasta = (p: string): string | null => {
      const arquivoDoPacote = junta(p, 'package.json');
      if (existe(arquivoDoPacote)) {
        const pacote = lerPacote(arquivoDoPacote);
        if (pacote === null) return null;
        const main = pacote.main;
        if (typeof main === 'string' && main) {
          // `main` e relativo a pasta, mesmo quando comeca com ponto (`.`, `..`, `.oculto.js`).
          const m = main.startsWith('/') ? null : caminhoLiteral(arquivoDoPacote, `./${main}`);
          if (m === null) return null;
          const r = comoArquivo(m) ?? comoIndice(m);
          if (r !== null) return r;
        }
      }
      return comoIndice(p);
    };
    const soPasta = especificador.endsWith('/') || /(^|\/)\.\.?$/.test(especificador);
    return soPasta ? comoPasta(base) : comoArquivo(base) ?? comoPasta(base);
  }

  /** package.json mais proximo acima do arquivo: `type` e se o Node o consegue ler. */
  const escopos = new Map<string, { invalido: boolean; tipo: unknown }>();
  function escopoDe(arquivo: string): { invalido: boolean; tipo: unknown } {
    const caminho: string[] = [];
    let dir = arquivo.includes('/') ? arquivo.slice(0, arquivo.lastIndexOf('/')) : '';
    let r: { invalido: boolean; tipo: unknown } | undefined;
    for (;;) {
      r = escopos.get(dir);
      if (r) break;
      caminho.push(dir);
      const pacote = junta(dir, 'package.json');
      if (arquivos.has(pacote)) {
        const lido = lerPacote(pacote);
        r = lido === null ? { invalido: true, tipo: undefined } : { invalido: false, tipo: lido.type };
        break;
      }
      if (dir === '') {
        r = { invalido: false, tipo: undefined };
        break;
      }
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
    for (const d of caminho) escopos.set(d, r);
    return r;
  }

  const VARIAVEIS_DO_CJS = new Set(['require', 'module', 'exports', '__filename', '__dirname']);
  /**
   * Sintaxe que o Node 22 so aceita em ESM: import e export estaticos, `import.meta`, `await` no topo e
   * `let`/`const`/`class` no topo que declara variavel do CommonJS, tambem por desestruturacao. Em `.js`
   * sem `type`, e ela que leva o Node a tentar ESM quando o CommonJS nao compila.
   */
  const nomesDaLigacao = (b: TS.BindingName): string[] => (ts.isIdentifier(b) ? [b.text]
    : b.elements.flatMap((el) => (ts.isBindingElement(el) ? nomesDaLigacao(el.name) : [])));
  function sintaxeEsm(sf: TS.SourceFile): boolean {
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isExportAssignment(st)) return true;
      if (ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === K.ExportKeyword)) return true;
      if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0
        && st.declarationList.declarations.some((d) => nomesDaLigacao(d.name).some((x) => VARIAVEIS_DO_CJS.has(x)))) return true;
      if (ts.isClassDeclaration(st) && st.name && VARIAVEIS_DO_CJS.has(st.name.text)) return true;
    }
    let achou = false;
    const visitar = (n: TS.Node, topo: boolean): void => {
      if (achou) return;
      if ((ts.isMetaProperty(n) && n.keywordToken === K.ImportKeyword)
        || (topo && (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && !!n.awaitModifier)))) {
        achou = true;
        return;
      }
      const dentro = topo && !ts.isFunctionLike(n) && !ts.isClassStaticBlockDeclaration(n);
      ts.forEachChild(n, (f) => visitar(f, dentro));
    };
    visitar(sf, true);
    return achou;
  }

  /**
   * Como o Node 22 carrega a fonte JavaScript: `esm`, `cjs` ou `falha`. O juiz de sintaxe e o V8 do Node
   * (D16), alem do parser do TypeScript: `.mjs` so como ESM, `.cjs` so como CommonJS, `.js` pelo `type`
   * do escopo e, sem ele, como o Node 22 detecta: CommonJS se compila, senao ESM se tem sintaxe de ESM e
   * compila como tal. `.jsx` nao tem formato ESM no Node e so carrega por `require`, como CommonJS.
   * Escopo invalido tambem e `falha`.
   */
  const formatos = new Map<string, 'esm' | 'cjs' | 'falha'>();
  {
    // Decidido de uma vez para toda fonte JavaScript: uma chamada ao juiz, que compila o ESM em lote.
    const regras: { caminho: string; regra: 'esm' | 'cjs' | 'ambiguo'; esmPossivel: boolean }[] = [];
    for (const f of e.fontes) {
      const ext = extensao(f.path), sf = programa.getSourceFile(absoluto(f.path));
      if (!EXTENSOES_JS.includes(ext)) continue;
      if (!sf || sf.fileName !== absoluto(f.path) || programa.getSyntacticDiagnostics(sf).length > 0) {
        formatos.set(f.path, 'falha');
        continue;
      }
      const escopo = ext === '.mjs' || ext === '.cjs' ? null : escopoDe(f.path);
      const regra = (r: 'esm' | 'cjs' | 'ambiguo', esmPossivel: boolean): void => {
        regras.push({ caminho: f.path, regra: r, esmPossivel });
      };
      if (escopo?.invalido) formatos.set(f.path, 'falha');
      else if (ext === '.mjs' || (ext === '.js' && escopo?.tipo === 'module')) regra('esm', true);
      else if (ext === '.cjs' || ext === '.jsx' || escopo?.tipo === 'commonjs') regra('cjs', false);
      else regra('ambiguo', sintaxeEsm(sf));
    }
    const pedidos: { texto: string; formato: 'cjs' | 'esm' }[] = [];
    const indices = regras.map((r) => {
      const texto = e.texto(r.caminho) ?? '', i: { cjs: number; esm: number } = { cjs: -1, esm: -1 };
      if (r.regra !== 'esm') i.cjs = pedidos.push({ texto, formato: 'cjs' }) - 1;
      if (r.esmPossivel) i.esm = pedidos.push({ texto, formato: 'esm' }) - 1;
      return i;
    });
    const aceitos = pedidos.length ? e.sintaxe(pedidos) : [];
    const aceito = (i: number): boolean => i >= 0 && aceitos[i] === true;
    regras.forEach((r, k) => {
      const cjs = aceito(indices[k].cjs), esm = aceito(indices[k].esm);
      if (r.regra === 'esm') formatos.set(r.caminho, esm ? 'esm' : 'falha');
      else formatos.set(r.caminho, cjs ? 'cjs' : r.regra === 'ambiguo' && esm ? 'esm' : 'falha');
    });
  }
  const formatoDe = (caminho: string): 'esm' | 'cjs' | 'falha' => formatos.get(caminho) ?? 'falha';

  /**
   * Alvo que o Node carrega de verdade. Por `import`: `.js`, `.mjs` e `.cjs` (JSON pede atributo e
   * extensao desconhecida falha). Por `require`: `.js` e `.cjs` em CommonJS, e `.json` que e JSON. O
   * `.js` so carrega com o proprio escopo valido; o resto (TypeScript por remocao de tipos, `.node`, sem
   * extensao, ESM por `require`) fica fora por nao ser provado.
   */
  function carregavel(alvo: string, porImport: boolean): boolean {
    const ext = extensao(alvo);
    if (ext === '.json') return !porImport && lerJson(alvo) !== undefined;
    if (ext !== '.js' && ext !== '.cjs' && ext !== '.mjs') return false;
    const formato = formatoDe(alvo);
    return porImport ? formato !== 'falha' : formato === 'cjs';
  }

  /**
   * Alvo do especificador para o Node: `import()` resolve como ESM em qualquer formato; import estatico,
   * so em ESM; `require`, so em CommonJS e com o escopo de quem importa valido (o Node le esse escopo e
   * lanca erro). Especificador nao relativo vai a node_modules e fica sem alvo. Em ESM o especificador e
   * URL: so liga o que a URL le como o caminho literal (`urlComoCaminho`).
   */
  /** KG4 (D3): `bruto` e o caminho que a resolucao do Node achou, antes de conferir se ele carrega. */
  function alvoNoNode(de: string, chave: string): { alvo: string | null; bruto: string | null } {
    const esp = especificadorDaChave(chave), formato = formatoDe(de);
    const relativoAoArquivo = esp === '.' || esp === '..' || esp.startsWith('./') || esp.startsWith('../');
    if (!relativoAoArquivo || formato === 'falha') return { alvo: null, bruto: null };
    let alvo: string | null;
    if (chave[0] === 'd' || (chave[0] === 'v' && formato === 'esm')) alvo = urlComoCaminho(esp) ? resolverNode(de, esp, true) : null;
    else if (chave[0] === 'r' && formato === 'cjs' && !escopoDe(de).invalido) alvo = resolverNode(de, esp, false);
    else return { alvo: null, bruto: null };
    return { alvo: alvo !== null && carregavel(alvo, chave[0] !== 'r') ? alvo : null, bruto: alvo };
  }

  /**
   * KG4 (D3): os nomes de modulo que o TypeScript coleta do arquivo para o programa (import, export,
   * require, import(), tipo importado, inclusive no JSDoc de JavaScript). Sem a lista, nao ha como provar
   * as dependencias e a extracao falha, em vez de reaproveitar sem prova.
   */
  const nomesDeModulo = (sf: TS.SourceFile): string[] => {
    const imports = (sf as unknown as { imports?: readonly TS.StringLiteralLike[] }).imports;
    if (!Array.isArray(imports)) throw new Error('extracao.interna.typescript-sem-imports');
    return imports.map((n) => n.text);
  };
  /** Caminho relativo a raiz por segmentos; `null` se sobe acima da raiz. */
  const normalizar = (partes: readonly string[]): string | null => {
    const r: string[] = [];
    for (const p of partes) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (!r.length) return null;
        r.pop();
      } else r.push(p);
    }
    return r.join('/');
  };
  /** KG4 (D3): base de uma resolucao relativa como o TypeScript a ve (a barra invertida tambem separa); `null` se nao e relativa ou sai da raiz. */
  const baseDaSonda = (de: string, nome: string): string | null =>
    (/^\.\.?($|[\\/])/.test(nome) ? normalizar([...de.split('/').slice(0, -1), ...nome.replace(/\\/g, '/').split('/')]) : null);
  /** `/// <reference path>`: relativo ao arquivo, com ou sem `./`. */
  const baseDaReferencia = (de: string, nome: string): string | null =>
    (nome.startsWith('/') || nome.startsWith('\\') ? null : normalizar([...de.split('/').slice(0, -1), ...nome.replace(/\\/g, '/').split('/')]));

  /**
   * KG4 (D3): a resolucao de uma pasta le o `package.json` dela, e `main`, `types` e `typings` podem
   * apontar para fora da base: os alvos entram como sondas, tambem com a barra invertida trocada, como o
   * TypeScript le. `typesVersions` remapeia qualquer caminho, e entao a sonda casa tudo; o mesmo vale
   * para `package.json` que nao e JSON estrito (CHECK, A1: o TypeScript aceita comentario e virgula
   * final). Mudanca no proprio `package.json` extrai o TypeScript inteiro.
   */
  const sondasDoPacote = (base: string, sondas: Set<string>): void => {
    for (const pasta of new Set([base, semExtensao(base)])) {
      const arquivo = junta(pasta, 'package.json');
      if (!arquivos.has(arquivo)) continue;
      const v = lerJson(arquivo);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        sondas.add('');
        continue;
      }
      const o = v as Record<string, unknown>;
      if ('typesVersions' in o) sondas.add('');
      for (const campo of ['main', 'types', 'typings']) {
        const alvo = o[campo];
        if (typeof alvo !== 'string' || !alvo) continue;
        for (const forma of new Set([alvo, alvo.replace(/\\/g, '/')])) {
          const t = forma.startsWith('/') ? null : caminhoLiteral(arquivo, `./${forma}`);
          if (t !== null) sondas.add(t);
        }
      }
    }
  };
  const sondar = (base: string | null, sondas: Set<string>): void => {
    if (base === null) return;
    sondas.add(base);
    sondasDoPacote(base, sondas);
  };

  // Primeira passada, em todos os arquivos: o alvo de cada especificador para o compilador e para o
  // runtime. Onde divergem, a aresta de import vai ao que roda e nenhum simbolo passa por ali (D3).
  const resolucoes = new Map<string, Map<string, { alvo: string | null; divergente: boolean; doCompilador: string | null }>>();
  const divergentesGlobais = new Set<string>();
  // KG4 (D3): por fonte, os caminhos a que as referencias de modulo resolvem e as bases das relativas.
  const dependenciasDe = new Map<string, Set<string>>(), sondasDe = new Map<string, Set<string>>();
  const citacoesDe = new Map<string, { alvo: string; trecho: Trecho }[]>();
  for (const fonte of e.fontes) {
    const sf = programa.getSourceFile(absoluto(fonte.path));
    if (!sf || sf.fileName !== absoluto(fonte.path)) continue;
    const ext = extensao(fonte.path), mapa = new Map<string, { alvo: string | null; divergente: boolean; doCompilador: string | null }>();
    const dependencias = new Set<string>(), sondas = new Set<string>();
    const literaisDeModulo = new Map<TS.Node, string>();
    for (const chave of especificadoresEm(sf, literaisDeModulo)) {
      if (mapa.has(chave)) continue;
      const esp = especificadorDaChave(chave), doCompilador = resolver(esp, fonte.path);
      sondar(baseDaSonda(fonte.path, esp), sondas);
      let alvo = doCompilador, divergente = false;
      // Import so de tipo nao roda: vale o que o compilador liga. Fonte JavaScript roda no Node, e onde
      // o Node falha (formato, escopo, alvo que nao carrega) nao ha aresta.
      if (chave[0] !== 't' && EXTENSOES_JS.includes(ext)) {
        const runtime = alvoNoNode(fonte.path, chave);
        if (runtime.bruto !== null) dependencias.add(runtime.bruto);
        if (runtime.alvo !== doCompilador) {
          divergente = true;
          alvo = runtime.alvo;
        }
      }
      const impl = chave[0] !== 't' && !divergente && doCompilador !== null ? implementacaoDe(doCompilador) : null;
      if (impl !== null) {
        divergente = true;
        alvo = impl;
      }
      for (const x of [doCompilador, alvo]) if (x !== null) dependencias.add(x);
      mapa.set(chave, { alvo, divergente, doCompilador });
      if (divergente) divergentesGlobais.add(`${fonte.path}\u0000${chave}`);
    }
    // Strings so em testes/scripts. Comentarios, interpolacoes e concatenacoes nao sao avaliados.
    const citacoes: { alvo: string; trecho: Trecho }[] = [];
    if (/(?:^|\/)(?:tests?|__tests__|scripts?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(fonte.path)) {
      const citar = (literal: string, n: TS.Node): void => {
        const base = caminhoDaCitacao(fonte.path, literal);
        if (base === null) return;
        const grupos = candidatosDaCitacao(base);
        // Inclui ausentes: criar/remover candidato invalida a unidade incremental.
        for (const grupo of grupos) for (const p of grupo) sondas.add(p);
        for (const grupo of grupos) {
          const presentes = grupo.filter((p) => arquivos.has(p));
          if (!presentes.length) continue;
          if (presentes.length === 1 && presentes[0] !== fonte.path) {
            dependencias.add(presentes[0]);
            citacoes.push({ alvo: presentes[0], trecho: { path: fonte.path, inicio: n.getStart(sf), fim: n.getEnd() } });
          }
          break; // Ambiguidade nao autoriza escolher uma fonte nem tentar outro grupo.
        }
      };
      const literais = (n: TS.Node): void => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          const chave = literaisDeModulo.get(n);
          // O resolver de import ja provou esta ocorrencia; outra string igual ainda pode citar.
          if (chave !== undefined && mapa.get(chave)?.alvo != null) return;
          citar(n.text, n);
          // Codigo citado por fixture: so argumentos literais de require/import dentro da string.
          for (const m of n.text.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g)) citar(m[2], n);
        }
        ts.forEachChild(n, literais);
      };
      literais(sf);
    }
    citacoesDe.set(fonte.path, citacoes);
    // O que o TypeScript coleta e a varredura nao ve (tipo importado no JSDoc) tambem liga o checker a outro arquivo.
    for (const nome of nomesDeModulo(sf)) {
      sondar(baseDaSonda(fonte.path, nome), sondas);
      const alvo = resolver(nome, fonte.path);
      if (alvo !== null) dependencias.add(alvo);
    }
    for (const r of sf.referencedFiles) {
      const base = baseDaReferencia(fonte.path, r.fileName);
      if (base === null) continue;
      sondas.add(base);
      for (const x of [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}.js`, `${base}.jsx`]) if (arquivos.has(x)) dependencias.add(x);
    }
    resolucoes.set(fonte.path, mapa);
    dependenciasDe.set(fonte.path, dependencias);
    sondasDe.set(fonte.path, sondas);
  }

  // KG4 (D3): no programa parcial, todo alvo TS/JS das fontes precisa ser fonte, para ter formato e
  // resolucoes; senao o caminho cresce e a extracao recomeca.
  if (e.emitir) {
    const noPrograma = new Set(e.fontes.map((f) => f.path)), faltantes = new Set<string>();
    for (const dependencias of dependenciasDe.values()) {
      for (const d of dependencias) {
        if (!noPrograma.has(d) && EXTENSOES_DO_PROGRAMA.includes(extensao(d)) && e.texto(d) !== undefined) faltantes.add(d);
      }
    }
    if (faltantes.size) return { ...resultado, faltantes: [...faltantes].sort() };
  }

  // B-N2: modulo que importa, direto ou por outro modulo, um arquivo com import divergente pode reexportar
  // o que o compilador liga e o runtime nao (`export *`, `module.exports = require(...)`). O fecho segue
  // o grafo de import inteiro, e so vale para simbolo que nao e declarado no proprio salto.
  const dependentes = new Map<string, Set<string>>();
  for (const [p, mapa] of resolucoes) {
    for (const r of mapa.values()) {
      for (const alvo of [r.doCompilador, r.alvo]) {
        if (alvo === null) continue;
        let d = dependentes.get(alvo);
        if (!d) dependentes.set(alvo, (d = new Set()));
        d.add(p);
      }
    }
  }
  const contaminados = new Set([...divergentesGlobais].map((k) => k.slice(0, k.indexOf('\u0000'))));
  for (const fila = [...contaminados]; fila.length;) {
    for (const d of dependentes.get(fila.pop() as string) ?? []) {
      if (!contaminados.has(d)) {
        contaminados.add(d);
        fila.push(d);
      }
    }
  }

  /**
   * A cadeia de alias passa por um import divergente: num salto dela, ou num modulo intermediario que
   * reexporta o que o compilador liga e o runtime nao (`module.exports = require('./a.js')`).
   */
  const especificadoresDaDeclaracao = new Map<TS.Node, string[]>();
  function cadeiaDivergente(s: TS.Symbol | undefined, destino: string | null): boolean {
    const vistos = new Set<TS.Symbol>();
    for (let atual = s; atual && (atual.flags & S.Alias) !== 0 && !vistos.has(atual); atual = checker.getImmediateAliasedSymbol(atual)) {
      vistos.add(atual);
      for (const d of atual.declarations ?? []) {
        const p = relativo(d.getSourceFile().fileName);
        if (p === null) continue;
        let topo: TS.Node = d;
        while (topo.parent && !ts.isSourceFile(topo.parent)) topo = topo.parent;
        let esps = especificadoresDaDeclaracao.get(topo);
        if (!esps) especificadoresDaDeclaracao.set(topo, (esps = especificadoresEm(topo)));
        for (const esp of esps) {
          if (divergentesGlobais.has(`${p}\u0000${esp}`)) return true;
          const salto = resolucoes.get(p)?.get(esp)?.doCompilador ?? null;
          if (salto !== null && salto !== destino && contaminados.has(salto)) return true;
        }
      }
    }
    return false;
  }

  for (const fonte of e.fontes) {
    if (e.emitir && !e.emitir.has(fonte.path)) continue;
    // KG4 (D2): os achados ficam por arquivo, com as dependencias e as sondas, para as unidades do indice.
    const saida: Achados = { nos: [], arestas: [], diagnosticos: [], lacunas: [] };
    resultado.unidades.set(fonte.path, {
      dependencias: [...(dependenciasDe.get(fonte.path) ?? [])].sort(), sondas: [...(sondasDe.get(fonte.path) ?? [])].sort(), achados: saida,
    });
    const sf = programa.getSourceFile(absoluto(fonte.path));
    // Fonte que o compilador trocou por outra (pacote duplicado) nao e lida: o no seria do outro arquivo.
    if (!sf || sf.fileName !== absoluto(fonte.path)) {
      saida.lacunas.push({ categoria: sf ? 'fonte-redirecionada' : 'fonte-nao-lida', path: fonte.path, inicio: null, detalhe: null });
      continue;
    }
    const arquivo: RefDeNo = { kind: 'file', path: fonte.path, fragment: null };
    const trecho = (n: TS.Node, fim = n.getEnd()): Trecho => ({ path: fonte.path, inicio: n.getStart(sf), fim });
    const aresta = (kind: AchadoDeAresta['kind'], from: RefDeNo, to: RefDeNo, t: Trecho): void => {
      saida.arestas.push({ kind, from, to, extrator: e.extrator, metodo: 'ast', trecho: t });
    };
    for (const c of citacoesDe.get(fonte.path) ?? []) aresta('cites', arquivo, { kind: 'file', path: c.alvo, fragment: null }, c.trecho);
    const lacuna = (categoria: string, n: TS.Node | null, detalhe: string | null = null): void => {
      saida.lacunas.push({ categoria, path: fonte.path, inicio: n ? n.getStart(sf) : null, detalhe });
    };
    const diagnostico = (kind: 'unresolved-import' | 'dynamic-resolution', reference: string): void => {
      saida.diagnosticos.push({ kind, path: fonte.path, reference: reference.replace(/\s+/g, ' '), extrator: e.extrator });
    };

    const alvos = resolucoes.get(fonte.path) ?? new Map<string, { alvo: string | null; divergente: boolean; doCompilador: string | null }>();
    // Arquivo que o compilador ligou no lugar do que roda: nenhuma chamada deste arquivo vai a ele.
    const divergentes = new Set([...alvos.values()].filter((r) => r.divergente && r.doCompilador !== null).map((r) => r.doCompilador as string));
    // AN3: classes importadas por nome aqui; `this` e `super` so ligam a membro delas em outro arquivo.
    const classesImportadas = new Set<TS.Symbol>();
    const importada = (nome: TS.Node | undefined): void => {
      const s0 = nome ? checker.getSymbolAtLocation(nome) : undefined;
      if (!s0 || (s0.flags & S.Alias) === 0) return;
      const alvo = checker.getAliasedSymbol(s0), arquivoDoAlvo = alvo.declarations?.[0] ? relativo(alvo.declarations[0].getSourceFile().fileName) : null;
      if (cadeiaDivergente(s0, arquivoDoAlvo)) return;
      if (alvo.flags & S.Class) classesImportadas.add(alvo);
      // Modulo importado inteiro (`* as ns`, `import = require`, `require` atribuido): as classes que ele exporta.
      else if (alvo.flags & S.ValueModule) {
        for (const x of checker.getExportsOfModule(alvo)) {
          const c = semAlias(x), arquivoDaClasse = c?.declarations?.[0] ? relativo(c.declarations[0].getSourceFile().fileName) : null;
          // B-N1: a classe pode chegar por reexport divergente; confere a cadeia ate o arquivo dela.
          if (c && c.flags & S.Class && !cadeiaDivergente(s0, arquivoDaClasse)) classesImportadas.add(c);
        }
      }
    };
    const nomesDoPadrao = (n: TS.BindingName): void => {
      if (ts.isIdentifier(n)) importada(n);
      else for (const el of n.elements) if (ts.isBindingElement(el)) nomesDoPadrao(el.name);
    };
    const juntarImportadas = (n: TS.Node): void => {
      if (ts.isImportClause(n)) importada(n.name);
      else if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n)) importada(n.name);
      else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) importada(n.name);
      else if (ts.isVariableDeclaration(n) && n.initializer && ehRequire(n.initializer)) nomesDoPadrao(n.name);
      ts.forEachChild(n, juntarImportadas);
    };
    juntarImportadas(sf);

    // Declaracoes de topo e membros de classe de topo (D4).
    const declarar = (d: TS.Node): RefDeNo | null => {
      const r = refDe(d);
      if (r && r.path === fonte.path) {
        saida.nos.push(r);
        aresta('declares', arquivo, r, trecho(d));
        return r;
      }
      if (nomeDoSimbolo(d) !== null) lacuna('simbolo-recusado', d);
      return null;
    };
    const elementos = (padrao: TS.BindingPattern, visitar: (d: TS.BindingElement) => void): void => {
      for (const el of padrao.elements) {
        if (!ts.isBindingElement(el)) continue;
        if (ts.isIdentifier(el.name)) visitar(el);
        else elementos(el.name, visitar);
      }
    };
    const simbolosDoTopo = new Map<TS.Node, RefDeNo | null>();
    for (const st of sf.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) simbolosDoTopo.set(d, declarar(d));
          else elementos(d.name, (el) => { declarar(el); });
        }
      } else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)
        || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st) || ts.isExportAssignment(st)) {
        const r = declarar(st);
        simbolosDoTopo.set(st, r);
        if (r && ts.isClassDeclaration(st)) {
          for (const m of st.members) {
            const rm = refDe(m);
            if (!rm) {
              if (nomeDoSimbolo(m) !== null) lacuna('simbolo-recusado', m);
              continue;
            }
            saida.nos.push(rm);
            aresta('contains', r, rm, trecho(m));
            simbolosDoTopo.set(m, rm);
          }
        }
      }
    }

    const importar = (chave: string, t: Trecho): { alvo: string | null; divergente: boolean } => {
      const r = alvos.get(chave) ?? { alvo: null, divergente: false }, especificador = especificadorDaChave(chave);
      if (r.alvo === null) diagnostico('unresolved-import', especificador);
      else aresta('imports', arquivo, { kind: 'file', path: r.alvo, fragment: null }, t);
      if (r.divergente) saida.lacunas.push({ categoria: 'import-divergente', path: fonte.path, inicio: t.inicio, detalhe: especificador });
      return r;
    };
    const simboloImportado = (nome: TS.Node, t: Trecho): void => {
      const s0 = checker.getSymbolAtLocation(nome), { ref } = alvoDo(semAlias(s0));
      if (ref && !divergentes.has(ref.path) && !cadeiaDivergente(s0, ref.path)) aresta('imports', arquivo, ref, t);
      else lacuna('import-sem-simbolo', nome);
    };

    /** D3: alvo de chamada pela ligacao lexica do callee, nunca pelo tipo inferido do objeto. */
    function alvoDaChamada(callee: TS.Expression): { ref: RefDeNo | null; categoria: string } {
      let r: { ref: RefDeNo | null; categoria: string }, ligado: boolean, alias: TS.Symbol | undefined;
      if (ts.isIdentifier(callee)) {
        alias = checker.getSymbolAtLocation(callee);
        r = alvoDo(semAlias(alias));
        ligado = viaImportLocal(alias, sf as TS.SourceFile);
      } else if (ts.isPropertyAccessExpression(callee)) {
        const objeto = callee.expression;
        if (objeto.kind === K.ThisKeyword || objeto.kind === K.SuperKeyword) {
          // Membro de outro arquivo so liga se a classe que o declara foi importada por nome aqui.
          const membro = semAlias(checker.getSymbolAtLocation(callee.name)), classe = membro?.declarations?.[0]?.parent;
          const simboloDaClasse = classe && ts.isClassDeclaration(classe) && classe.name ? checker.getSymbolAtLocation(classe.name) : undefined;
          r = alvoDo(membro);
          ligado = !!simboloDaClasse && classesImportadas.has(simboloDaClasse);
        } else if (ts.isIdentifier(objeto)) {
          alias = checker.getSymbolAtLocation(objeto);
          const dono = semAlias(alias);
          if (!dono || (dono.flags & (S.Class | S.Enum | S.ValueModule | S.NamespaceModule)) === 0) return { ref: null, categoria: 'chamada-por-tipo' };
          r = alvoDo(semAlias(checker.getSymbolAtLocation(callee.name)));
          ligado = viaImportLocal(alias, sf as TS.SourceFile);
        } else return { ref: null, categoria: 'chamada-por-tipo' };
      } else return { ref: null, categoria: 'chamada-nao-resolvida' };
      if (!r.ref) return r;
      if (cadeiaDivergente(alias, r.ref.path)) return { ref: null, categoria: 'chamada-por-import-divergente' };
      // Alvo em outro arquivo so com ligacao deste arquivo: import local, nunca global de script.
      if (r.ref.path !== fonte.path && !ligado) return { ref: null, categoria: 'chamada-global-entre-arquivos' };
      if (divergentes.has(r.ref.path)) return { ref: null, categoria: 'chamada-por-import-divergente' };
      return r;
    }

    const chamada = (n: TS.CallExpression | TS.NewExpression, atual: RefDeNo | null): void => {
      if (!atual) {
        lacuna('chamada-fora-de-simbolo', n);
        return;
      }
      const { ref, categoria } = alvoDaChamada(n.expression);
      if (!ref) {
        const listada = categoria === 'chamada-alvo-ambiguo' || categoria === 'chamada-global-entre-arquivos' || categoria === 'chamada-por-import-divergente';
        lacuna(categoria, n, listada ? n.expression.getText(sf) : null);
        return;
      }
      // O trecho vai do inicio da chamada ao parentese de abertura: `soma(`, `new Classe(`.
      const fim = n.arguments ? n.arguments.pos : n.expression.getEnd();
      aresta('calls', atual, ref, trecho(n, fim));
    };

    const compilado = compiladoEm(fonte.path);
    const visitar = (n: TS.Node, atual: RefDeNo | null): void => {
      const proximo = simbolosDoTopo.has(n) ? (simbolosDoTopo.get(n) ?? null) : atual;
      const chave = chaveDoImport(n, compilado);
      if (ts.isImportDeclaration(n)) {
        const r = chave === null ? null : importar(chave, trecho(n));
        if (r && r.alvo !== null && !r.divergente && n.importClause) {
          const ic = n.importClause;
          if (ic.name) simboloImportado(ic.name, trecho(ic.name));
          if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) for (const el of ic.namedBindings.elements) simboloImportado(el.name, trecho(el));
        }
        return;
      }
      if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
        const r = chave === null ? null : importar(chave, trecho(n));
        if (r && r.alvo !== null && !r.divergente && n.exportClause && ts.isNamedExports(n.exportClause)) {
          for (const el of n.exportClause.elements) simboloImportado(el.name, trecho(el));
        }
        return;
      }
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
        if (chave !== null) importar(chave, trecho(n));
        return;
      }
      if (ts.isImportTypeNode(n) && chave !== null) importar(chave, trecho(n));
      if (ehRequire(n) || ehImportDinamico(n)) {
        if (chave !== null) importar(chave, trecho(n));
        else diagnostico('dynamic-resolution', n.arguments[0] ? n.arguments[0].getText(sf) : '');
      } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) chamada(n, proximo);
      ts.forEachChild(n, (filho) => visitar(filho, proximo));
    };
    for (const st of sf.statements) visitar(st, null);
  }

  // KG4 (D3): quem declara no escopo global (visto de um modulo vazio, sem local que o esconda) ou
  // aumenta modulo alcanca arquivo que nao o importa; mudanca nele reextrai o TypeScript inteiro.
  const doEscopoGlobal = programa.getSourceFile(sintetico);
  if (!doEscopoGlobal) throw new Error('extracao.interna.escopo-global');
  const globais = new Set<string>();
  for (const simbolo of checker.getSymbolsInScope(doEscopoGlobal, -1 as TS.SymbolFlags)) {
    for (const d of simbolo.declarations ?? []) {
      const p = relativo(d.getSourceFile().fileName);
      if (p !== null) globais.add(p);
    }
  }
  for (const sf of programa.getSourceFiles()) {
    const aumentos = (sf as unknown as { moduleAugmentations?: readonly unknown[] }).moduleAugmentations, p = relativo(sf.fileName);
    if (p !== null && aumentos && aumentos.length) globais.add(p);
  }
  resultado.globais = [...globais].sort();
  return resultado;
}
