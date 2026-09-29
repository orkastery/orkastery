/**
 * RM-031 KG2 (D2 a D4): extrator `ork.ts-ast` de TypeScript e JavaScript.
 *
 * O compilador chega por parametro e roda num host em memoria que so enxerga o manifesto: sem
 * biblioteca padrao, sem `node_modules`, sem disco (D2). Import e chamada so viram aresta quando o
 * binder liga o nome a uma declaracao do repositorio por escopo lexico ou por import; despacho por
 * tipo inferido, global compartilhado entre scripts e alvo ambiguo ficam fora e sao contados (D3).
 * Simbolo e declaracao de topo ou membro de classe de topo, pelo nome declarado (D4).
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
  extrator: string;
}

/** D2: opcoes fixas do compilador, descritas por nome para entrar no `config_hash`. */
export const OPCOES_TS_DESCRITAS = Object.freeze({
  allowJs: true, checkJs: false, esModuleInterop: true, jsx: 'preserve', module: 'commonjs', moduleResolution: 'node10',
  noLib: true, resolveJsonModule: true, target: 'es2022', types: [] as string[],
});

function opcoes(ts: typeof TS): TS.CompilerOptions {
  return {
    allowJs: true, checkJs: false, esModuleInterop: true, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, noLib: true, resolveJsonModule: true, target: ts.ScriptTarget.ES2022,
    types: [], noEmit: true, skipLibCheck: true,
  };
}

const RAIZ = '/';
const absoluto = (p: string): string => `${RAIZ}${p}`;
const relativo = (p: string): string => p.slice(RAIZ.length);

function criarHost(ts: typeof TS, e: EntradaTs): TS.CompilerHost {
  const arquivos = new Set(e.arquivos), dirs = new Set<string>([RAIZ]);
  for (const p of e.arquivos) {
    const partes = p.split('/');
    for (let i = 1; i < partes.length; i++) dirs.add(absoluto(partes.slice(0, i).join('/')));
  }
  const dentro = (p: string): string | null => (p.startsWith(RAIZ) ? relativo(p) : null);
  return {
    getSourceFile: (nome, alvo) => {
      const p = dentro(nome), t = p === null ? undefined : e.texto(p);
      return t === undefined ? undefined : ts.createSourceFile(nome, t, alvo, true);
    },
    getDefaultLibFileName: () => absoluto('__sem-biblioteca__.d.ts'),
    writeFile: () => undefined,
    getCurrentDirectory: () => RAIZ,
    getDirectories: () => [],
    fileExists: (nome) => {
      const p = dentro(nome);
      return p !== null && arquivos.has(p);
    },
    readFile: (nome) => {
      const p = dentro(nome);
      return p === null || !arquivos.has(p) ? undefined : e.texto(p);
    },
    directoryExists: (nome) => dirs.has(nome.length > 1 && nome.endsWith('/') ? nome.slice(0, -1) : nome),
    realpath: (p) => p,
    getCanonicalFileName: (p) => p,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
}

export function extrairTypeScript(e: EntradaTs, ts: typeof TS): Achados {
  const saida: Achados = { nos: [], arestas: [], diagnosticos: [], lacunas: [] };
  if (e.fontes.length === 0) return saida;
  const host = criarHost(ts, e), opts = opcoes(ts);
  const programa = ts.createProgram(e.fontes.map((f) => absoluto(f.path)), opts, host);
  const checker = programa.getTypeChecker();
  const cache = ts.createModuleResolutionCache(RAIZ, (p) => p, opts);
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

  /** D4: fragmento do no de uma declaracao, ou `null` quando ela nao e simbolo do grafo. */
  function fragmentoDe(d: TS.Node): string | null {
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

  const refDe = (d: TS.Node): RefDeNo | null => {
    const fragment = fragmentoDe(d);
    return fragment === null ? null : { kind: 'symbol', path: relativo(d.getSourceFile().fileName), fragment };
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
      refs.set(`${r.path}#${r.fragment}`, r);
    }
    return refs.size === 1 ? { ref: [...refs.values()][0], categoria: '' } : { ref: null, categoria: 'chamada-alvo-ambiguo' };
  }

  function resolver(especificador: string, de: string): string | null {
    const r = ts.resolveModuleName(especificador, absoluto(de), opts, host, cache).resolvedModule;
    if (!r || r.isExternalLibraryImport) return null;
    const p = relativo(r.resolvedFileName);
    return arquivos.has(p) ? p : null;
  }

  for (const fonte of e.fontes) {
    const sf = programa.getSourceFile(absoluto(fonte.path));
    if (!sf) {
      saida.lacunas.push({ categoria: 'fonte-nao-lida', path: fonte.path, inicio: null, detalhe: null });
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

    // Declaracoes de topo e membros de classe de topo (D4).
    const declarar = (d: TS.Node): RefDeNo | null => {
      const r = refDe(d);
      if (r) {
        saida.nos.push(r);
        aresta('declares', arquivo, r, trecho(d));
      }
      return r;
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
            if (!rm) continue;
            saida.nos.push(rm);
            aresta('contains', r, rm, trecho(m));
            simbolosDoTopo.set(m, rm);
          }
        }
      }
    }

    const importar = (especificador: string, t: Trecho): string | null => {
      const alvo = resolver(especificador, fonte.path);
      if (alvo === null) diagnostico('unresolved-import', especificador);
      else aresta('imports', arquivo, { kind: 'file', path: alvo, fragment: null }, t);
      return alvo;
    };
    const simboloImportado = (nome: TS.Node, t: Trecho): void => {
      const { ref } = alvoDo(semAlias(checker.getSymbolAtLocation(nome)));
      if (ref) aresta('imports', arquivo, ref, t);
      else lacuna('import-sem-simbolo', nome);
    };
    const literal = (n: TS.Node | undefined): string | null =>
      n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

    /** D3: alvo de chamada pela ligacao lexica do callee, nunca pelo tipo inferido do objeto. */
    function alvoDaChamada(callee: TS.Expression): { ref: RefDeNo | null; categoria: string } {
      if (ts.isIdentifier(callee)) {
        const s0 = checker.getSymbolAtLocation(callee), viaImport = !!s0 && (s0.flags & S.Alias) !== 0;
        const r = alvoDo(semAlias(s0));
        if (r.ref && r.ref.path !== fonte.path && !viaImport) return { ref: null, categoria: 'chamada-global-entre-arquivos' };
        return r;
      }
      if (!ts.isPropertyAccessExpression(callee)) return { ref: null, categoria: 'chamada-nao-resolvida' };
      const objeto = callee.expression;
      if (objeto.kind === K.ThisKeyword || objeto.kind === K.SuperKeyword) return alvoDo(semAlias(checker.getSymbolAtLocation(callee.name)));
      if (!ts.isIdentifier(objeto)) return { ref: null, categoria: 'chamada-por-tipo' };
      const s0 = checker.getSymbolAtLocation(objeto), dono = semAlias(s0);
      if (!dono || (dono.flags & (S.Class | S.Enum | S.ValueModule | S.NamespaceModule)) === 0) return { ref: null, categoria: 'chamada-por-tipo' };
      // Modulo externo (SourceFile) so e alcancado por import ou require; namespace de outro script, nao.
      const porModulo = (s0 !== undefined && (s0.flags & S.Alias) !== 0) || (dono.declarations ?? []).some((d) => ts.isSourceFile(d));
      const r = alvoDo(semAlias(checker.getSymbolAtLocation(callee.name)));
      if (r.ref && r.ref.path !== fonte.path && !porModulo) return { ref: null, categoria: 'chamada-global-entre-arquivos' };
      return r;
    }

    const chamada = (n: TS.CallExpression | TS.NewExpression, atual: RefDeNo | null): void => {
      if (!atual) {
        lacuna('chamada-fora-de-simbolo', n);
        return;
      }
      const { ref, categoria } = alvoDaChamada(n.expression);
      if (!ref) {
        lacuna(categoria, n, categoria === 'chamada-alvo-ambiguo' || categoria === 'chamada-global-entre-arquivos' ? n.expression.getText(sf) : null);
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
        if (esp !== null && importar(esp, trecho(n)) !== null && n.importClause) {
          const ic = n.importClause;
          if (ic.name) simboloImportado(ic.name, trecho(ic.name));
          if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) for (const el of ic.namedBindings.elements) simboloImportado(el.name, trecho(el));
        }
        return;
      }
      if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
        const esp = literal(n.moduleSpecifier);
        if (esp !== null && importar(esp, trecho(n)) !== null && n.exportClause && ts.isNamedExports(n.exportClause)) {
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
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const ehImportDinamico = callee.kind === K.ImportKeyword;
        const ehRequire = ts.isIdentifier(callee) && callee.text === 'require' && n.arguments.length === 1
          && !(checker.getSymbolAtLocation(callee)?.declarations ?? []).length;
        if (ehImportDinamico || ehRequire) {
          const esp = literal(n.arguments[0]);
          if (esp !== null) importar(esp, trecho(n));
          else diagnostico('dynamic-resolution', n.arguments[0] ? n.arguments[0].getText(sf) : '');
        } else chamada(n, proximo);
      } else if (ts.isNewExpression(n)) chamada(n, proximo);
      ts.forEachChild(n, (filho) => visitar(filho, proximo));
    };
    for (const st of sf.statements) visitar(st, null);
  }
  return saida;
}
