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
  extrator: string;
}

/** D2: opcoes fixas do compilador, descritas por nome para entrar no `config_hash`. */
export const OPCOES_TS_DESCRITAS = Object.freeze({
  allowJs: true, checkJs: false, esModuleInterop: true, jsx: 'preserve', module: 'commonjs', moduleResolution: 'node10',
  noLib: true, resolveJsonModule: true, target: 'es2022', types: [] as string[], node_modules: 'fora-da-resolucao',
});

const EXTENSOES_JS = ['.cjs', '.js', '.jsx', '.mjs'];

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

function criarHost(ts: typeof TS, e: EntradaTs): TS.CompilerHost {
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

export function extrairTypeScript(e: EntradaTs, ts: typeof TS): Achados {
  const saida: Achados = { nos: [], arestas: [], diagnosticos: [], lacunas: [] };
  if (e.fontes.length === 0) return saida;
  const absoluto = (p: string): string => `${e.raiz}/${p}`;
  const relativo = (p: string): string | null => (p.startsWith(`${e.raiz}/`) ? p.slice(e.raiz.length + 1) : null);
  const host = criarHost(ts, e), opts = opcoes(ts);
  const programa = ts.createProgram(e.fontes.map((f) => absoluto(f.path)), opts, host);
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

  /** Especificadores literais de import, reexport, `import =`, tipo importado, `require` e `import()`. */
  function especificadoresEm(raiz: TS.Node): string[] {
    const r: string[] = [];
    const coletar = (n: TS.Node): void => {
      let esp: string | null = null;
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) esp = literal(n.moduleSpecifier);
      else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) esp = literal(n.moduleReference.expression);
      else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) esp = literal(n.argument.literal);
      else if (ehRequire(n) || ehImportDinamico(n)) esp = literal(n.arguments[0]);
      if (esp !== null) r.push(esp);
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
  /** Resolucao do Node para especificador relativo: exato em ESM; em CommonJS, extensao, `main` e `index`. */
  function resolverNode(de: string, especificador: string, esm: boolean): string | null {
    const base = caminhoLiteral(de, especificador);
    if (base === null) return null;
    if (esm) return existe(base);
    const comoArquivo = (p: string): string | null => existe(p) ?? existe(`${p}.js`) ?? existe(`${p}.json`) ?? existe(`${p}.node`);
    const pacote = existe(`${base}/package.json`) ? e.texto(`${base}/package.json`) : undefined;
    if (pacote !== undefined) {
      try {
        const main: unknown = JSON.parse(pacote).main;
        const m = typeof main === 'string' && main ? caminhoLiteral(`${base}/package.json`, main.startsWith('.') ? main : `./${main}`) : null;
        const r = m === null ? null : comoArquivo(m) ?? existe(`${m}/index.js`) ?? existe(`${m}/index.json`);
        if (r !== null) return r;
      } catch {
        // package.json invalido: o Node cai no index, como abaixo.
      }
    }
    return comoArquivo(base) ?? existe(`${base}/index.js`) ?? existe(`${base}/index.json`) ?? existe(`${base}/index.node`);
  }

  // Primeira passada, em todos os arquivos: o alvo de cada especificador para o compilador e para o
  // runtime. Onde divergem, a aresta de import vai ao que roda e nenhum simbolo passa por ali (D3).
  const resolucoes = new Map<string, Map<string, { alvo: string | null; divergente: boolean; doCompilador: string | null }>>();
  const divergentesGlobais = new Set<string>();
  for (const fonte of e.fontes) {
    const sf = programa.getSourceFile(absoluto(fonte.path));
    if (!sf || sf.fileName !== absoluto(fonte.path)) continue;
    const ext = extensao(fonte.path), mapa = new Map<string, { alvo: string | null; divergente: boolean; doCompilador: string | null }>();
    for (const esp of especificadoresEm(sf)) {
      if (mapa.has(esp)) continue;
      const doCompilador = resolver(esp, fonte.path);
      let alvo = doCompilador, divergente = false;
      if (EXTENSOES_JS.includes(ext) && (esp.startsWith('./') || esp.startsWith('../'))) {
        const runtime = resolverNode(fonte.path, esp, ext === '.mjs');
        if (runtime !== doCompilador) {
          divergente = true;
          alvo = runtime ?? doCompilador;
        }
      }
      const impl = !divergente && doCompilador !== null ? implementacaoDe(doCompilador) : null;
      if (impl !== null) {
        divergente = true;
        alvo = impl;
      }
      mapa.set(esp, { alvo, divergente, doCompilador });
      if (divergente) divergentesGlobais.add(`${fonte.path}\u0000${esp}`);
    }
    resolucoes.set(fonte.path, mapa);
  }

  const comDivergencia = new Set([...divergentesGlobais].map((k) => k.slice(0, k.indexOf('\u0000'))));

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
          if (salto !== null && salto !== destino && comDivergencia.has(salto)) return true;
        }
      }
    }
    return false;
  }

  for (const fonte of e.fontes) {
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
    };
    const nomesDoPadrao = (n: TS.BindingName): void => {
      if (ts.isIdentifier(n)) importada(n);
      else for (const el of n.elements) if (ts.isBindingElement(el)) nomesDoPadrao(el.name);
    };
    const juntarImportadas = (n: TS.Node): void => {
      if (ts.isImportClause(n)) importada(n.name);
      else if (ts.isImportSpecifier(n)) importada(n.name);
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

    const importar = (especificador: string, t: Trecho): { alvo: string | null; divergente: boolean } => {
      const r = alvos.get(especificador) ?? { alvo: null, divergente: false };
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

    const visitar = (n: TS.Node, atual: RefDeNo | null): void => {
      const proximo = simbolosDoTopo.has(n) ? (simbolosDoTopo.get(n) ?? null) : atual;
      if (ts.isImportDeclaration(n)) {
        const esp = literal(n.moduleSpecifier);
        const r = esp === null ? null : importar(esp, trecho(n));
        if (r && r.alvo !== null && !r.divergente && n.importClause) {
          const ic = n.importClause;
          if (ic.name) simboloImportado(ic.name, trecho(ic.name));
          if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) for (const el of ic.namedBindings.elements) simboloImportado(el.name, trecho(el));
        }
        return;
      }
      if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
        const esp = literal(n.moduleSpecifier);
        const r = esp === null ? null : importar(esp, trecho(n));
        if (r && r.alvo !== null && !r.divergente && n.exportClause && ts.isNamedExports(n.exportClause)) {
          for (const el of n.exportClause.elements) simboloImportado(el.name, trecho(el));
        }
        return;
      }
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
        const esp = literal(n.moduleReference.expression);
        if (esp !== null) importar(esp, trecho(n));
        return;
      }
      if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
        const esp = literal(n.argument.literal);
        if (esp !== null) importar(esp, trecho(n));
      }
      if (ehRequire(n) || ehImportDinamico(n)) {
        const esp = literal(n.arguments[0]);
        if (esp !== null) importar(esp, trecho(n));
        else diagnostico('dynamic-resolution', n.arguments[0] ? n.arguments[0].getText(sf) : '');
      } else if (ts.isCallExpression(n) || ts.isNewExpression(n)) chamada(n, proximo);
      ts.forEachChild(n, (filho) => visitar(filho, proximo));
    };
    for (const st of sf.statements) visitar(st, null);
  }
  return saida;
}
