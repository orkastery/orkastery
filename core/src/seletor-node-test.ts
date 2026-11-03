/** RM-074 M10: seleção conservadora de testes compilados pelo fecho de dependências. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export type MotivoDaSelecaoNode = 'selecionada' | 'sem-mudancas' | 'fora-do-mapeamento'
  | 'caminho-nao-resolvido';

export interface PlanoDaSelecaoNode {
  modo: 'selecionada' | 'inteira';
  motivo: MotivoDaSelecaoNode;
  arquivos: string[];
  alterados: string[];
  ambiguidade?: { arquivo: string; pedido: string };
  sempre?: {
    processoFilho: string[];
    dependenciaIncerta: string[];
  };
  incertezas?: Array<{
    testes: string[];
    arquivo: string;
    linha: number;
    forma: string;
  }>;
}

interface Dependencias {
  locais: Array<{ pedido: string; linha: number; forma: string }>;
  modulos: string[];
  arquivos: string[];
  incertezas: Array<{ linha: number; forma: string }>;
}

interface ContextoEstatico {
  arquivo: string;
  distTest: string;
  fonte: ts.SourceFile;
  constantes: Map<string, ts.Expression>;
  ligacoesPath: LigacoesDeModulo;
  parametros?: Map<string, ts.Expression>;
}

const FUNCOES_DE_FS = new Set(['readFileSync', 'readFile', 'existsSync', 'statSync']);
const MODULOS_FS = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const MODULOS_PATH = new Set(['path', 'node:path']);
const MODULOS_NATIVOS_SEGUROS = new Set([
  'path', 'node:path', 'assert', 'node:assert', 'node:assert/strict', 'util', 'node:util',
  'events', 'node:events', 'crypto', 'node:crypto', 'url', 'node:url', 'os', 'node:os',
  'test', 'node:test', 'buffer', 'node:buffer', 'timers', 'node:timers',
  'string_decoder', 'node:string_decoder',
]);
const MODULOS_NATIVOS = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'readline/promises', 'repl', 'sqlite', 'stream',
  'stream/consumers', 'stream/promises', 'stream/web', 'string_decoder', 'sys', 'test',
  'test/reporters', 'timers', 'timers/promises', 'tls', 'trace_events', 'tty', 'url',
  'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);
const CAPACIDADES_GLOBAIS = new Set([
  'require', 'module', 'exports', 'process', 'global', 'globalThis', 'Reflect', 'Proxy',
  'eval', 'Function', 'WebAssembly', 'arguments',
  // Permanecem conservadoras por compatibilidade com as contraprovas da rodada anterior.
  'createRequire', 'Worker',
]);
const HELPERS_DE_INTEROPERABILIDADE = new Set([
  '__importStar', '__importDefault', '__createBinding', '__setModuleDefault',
]);

interface LigacaoDeCapacidade {
  tipo: 'fs' | 'outra';
  origem: string;
}

interface LigacoesDeModulo {
  pedidos: ReadonlySet<string>;
  namespaces: Set<string>;
  funcoes: Map<string, string>;
}

function barras(arquivo: string): string {
  return arquivo.split(path.sep).join('/');
}

function dentro(raiz: string, arquivo: string): boolean {
  const relativo = path.relative(raiz, arquivo);
  return relativo !== '' && !relativo.startsWith(`..${path.sep}`) && !path.isAbsolute(relativo);
}

function candidatosDeArquivo(alvo: string): string[] {
  return [alvo, `${alvo}.js`, `${alvo}.json`, `${alvo}.ts`, path.join(alvo, 'index.js')];
}

function resolverModulo(distTest: string, arquivo: string, pedido: string): string | null {
  const alvo = path.resolve(path.dirname(arquivo), pedido);
  return candidatosDeArquivo(alvo).find((candidato) => dentro(distTest, candidato)
    && fs.statSync(candidato, { throwIfNoEntry: false })?.isFile()) ?? null;
}

function resolverArquivo(distTest: string, pedido: string): string | null {
  const core = path.dirname(distTest);
  return candidatosDeArquivo(path.resolve(pedido)).find((candidato) => dentro(core, candidato)
    && fs.statSync(candidato, { throwIfNoEntry: false })?.isFile()) ?? null;
}

function nomeDaPropriedade(expressao: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expressao)) return expressao.name.text;
  if (ts.isElementAccessExpression(expressao) && expressao.argumentExpression
    && (ts.isStringLiteral(expressao.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(expressao.argumentExpression))) {
    return expressao.argumentExpression.text;
  }
  return ts.isIdentifier(expressao) ? expressao.text : null;
}

function pedidoDeRequire(expressao: ts.Expression): string | null {
  if (!ts.isCallExpression(expressao) || !ts.isIdentifier(expressao.expression)
    || expressao.expression.text !== 'require' || expressao.arguments.length !== 1) return null;
  const argumento = expressao.arguments[0];
  return argumento && (ts.isStringLiteral(argumento) || ts.isNoSubstitutionTemplateLiteral(argumento))
    ? argumento.text : null;
}

function desembrulharExpressao(expressao: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expressao)) return desembrulharExpressao(expressao.expression);
  if (ts.isBinaryExpression(expressao) && expressao.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return desembrulharExpressao(expressao.right);
  }
  return expressao;
}

function eNamespaceDoModulo(expressao: ts.Expression, ligacoes: LigacoesDeModulo): boolean {
  const no = desembrulharExpressao(expressao);
  if (ts.isIdentifier(no)) return ligacoes.namespaces.has(no.text);
  const pedido = pedidoDeRequire(no);
  if (pedido !== null) return ligacoes.pedidos.has(pedido);
  if (ts.isCallExpression(no) && ts.isIdentifier(no.expression)
    && ['__importStar', '__importDefault'].includes(no.expression.text) && no.arguments.length === 1) {
    return eNamespaceDoModulo(no.arguments[0], ligacoes);
  }
  return ts.isPropertyAccessExpression(no)
    && nomeDaPropriedade(no) === 'default' && eNamespaceDoModulo(no.expression, ligacoes);
}

function operacaoDoModulo(expressao: ts.Expression, ligacoes: LigacoesDeModulo): string | null {
  const no = desembrulharExpressao(expressao);
  if (ts.isIdentifier(no)) return ligacoes.funcoes.get(no.text) ?? null;
  if (ts.isPropertyAccessExpression(no)
    && eNamespaceDoModulo(no.expression, ligacoes)) return nomeDaPropriedade(no);
  return null;
}

function coletarLigacoesDoModulo(fonte: ts.SourceFile, pedidos: ReadonlySet<string>): LigacoesDeModulo {
  const ligacoes: LigacoesDeModulo = { pedidos, namespaces: new Set(), funcoes: new Map() };
  let mudou = true;
  while (mudou) {
    mudou = false;
    const registrar = (no: ts.Node): void => {
      if (ts.isVariableDeclaration(no) && no.initializer) {
        if (ts.isIdentifier(no.name)) {
          if (eNamespaceDoModulo(no.initializer, ligacoes) && !ligacoes.namespaces.has(no.name.text)) {
            ligacoes.namespaces.add(no.name.text); mudou = true;
          } else {
            const operacao = operacaoDoModulo(no.initializer, ligacoes);
            if (operacao !== null && ligacoes.funcoes.get(no.name.text) !== operacao) {
              ligacoes.funcoes.set(no.name.text, operacao); mudou = true;
            }
          }
        } else if (ts.isObjectBindingPattern(no.name) && eNamespaceDoModulo(no.initializer, ligacoes)) {
          for (const item of no.name.elements) {
            if (!ts.isIdentifier(item.name)) continue;
            const propriedade = item.propertyName && (ts.isIdentifier(item.propertyName)
              || ts.isStringLiteral(item.propertyName)) ? item.propertyName.text : item.name.text;
            if (propriedade === 'promises') {
              if (!ligacoes.namespaces.has(item.name.text)) {
                ligacoes.namespaces.add(item.name.text); mudou = true;
              }
            } else if (ligacoes.funcoes.get(item.name.text) !== propriedade) {
              ligacoes.funcoes.set(item.name.text, propriedade); mudou = true;
            }
          }
        }
      } else if (ts.isBinaryExpression(no) && no.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(no.left)) {
        if (eNamespaceDoModulo(no.right, ligacoes) && !ligacoes.namespaces.has(no.left.text)) {
          ligacoes.namespaces.add(no.left.text); mudou = true;
        } else {
          const operacao = operacaoDoModulo(no.right, ligacoes);
          if (operacao !== null && ligacoes.funcoes.get(no.left.text) !== operacao) {
            ligacoes.funcoes.set(no.left.text, operacao); mudou = true;
          }
        }
      }
      ts.forEachChild(no, registrar);
    };
    registrar(fonte);
  }
  return ligacoes;
}

function eRequireResolve(expressao: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(expressao) && ts.isIdentifier(expressao.expression)
    && expressao.expression.text === 'require' && expressao.name.text === 'resolve';
}

function constantesDoModulo(fonte: ts.SourceFile): Map<string, ts.Expression> {
  const constantes = new Map<string, ts.Expression>();
  for (const declaracao of fonte.statements) {
    if (!ts.isVariableStatement(declaracao) || !(declaracao.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const item of declaracao.declarationList.declarations) {
      if (ts.isIdentifier(item.name) && item.initializer) constantes.set(item.name.text, item.initializer);
    }
  }
  return constantes;
}

function avaliarCaminho(no: ts.Expression, contexto: ContextoEstatico, visitados = new Set<string>()): string | null {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) return no.text;
  if (ts.isIdentifier(no)) {
    if (no.text === '__dirname') return path.dirname(contexto.arquivo);
    const parametro = contexto.parametros?.get(no.text);
    if (parametro) return avaliarCaminho(parametro, { ...contexto, parametros: undefined }, visitados);
    if (visitados.has(no.text)) return null;
    const constante = contexto.constantes.get(no.text);
    if (!constante || ts.isFunctionLike(constante)) return null;
    const proximos = new Set(visitados); proximos.add(no.text);
    return avaliarCaminho(constante, contexto, proximos);
  }
  if (ts.isCallExpression(no) && eRequireResolve(no.expression) && no.arguments.length === 1) {
    const pedido = avaliarCaminho(no.arguments[0], contexto, visitados);
    if (!pedido || (!pedido.startsWith('.') && !path.isAbsolute(pedido))) return null;
    if (path.isAbsolute(pedido)) return resolverArquivo(contexto.distTest, pedido);
    return resolverModulo(contexto.distTest, contexto.arquivo, pedido);
  }
  if (ts.isCallExpression(no)) {
    const operacaoPath = operacaoDoModulo(no.expression, contexto.ligacoesPath);
    if (!operacaoPath || !['join', 'resolve'].includes(operacaoPath)) return null;
    const partes = no.arguments.map((argumento) => avaliarCaminho(argumento, contexto, visitados));
    if (partes.some((parte) => parte === null)) return null;
    return operacaoPath === 'join' ? path.join(...partes as string[]) : path.resolve(...partes as string[]);
  }
  return null;
}

function avaliarPedidoDeRequire(no: ts.Expression, contexto: ContextoEstatico): string | null {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) return no.text;
  if (!ts.isIdentifier(no)) return avaliarCaminho(no, contexto);
  const constante = contexto.constantes.get(no.text);
  if (!constante || !ts.isCallExpression(constante)) return null;
  const operacaoPath = operacaoDoModulo(constante.expression, contexto.ligacoesPath);
  return operacaoPath && ['join', 'resolve'].includes(operacaoPath) ? avaliarCaminho(constante, contexto) : null;
}

function linhaDoNo(fonte: ts.SourceFile, no: ts.Node): number {
  return fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1;
}

function coletarNomesDeBinding(nome: ts.BindingName, nomes: Set<string>): void {
  if (ts.isIdentifier(nome)) nomes.add(nome.text);
  else for (const item of nome.elements) {
    if (!ts.isOmittedExpression(item)) coletarNomesDeBinding(item.name, nomes);
  }
}

function capacidadesGlobaisSombreadas(fonte: ts.SourceFile): Set<string> {
  const declarados = new Set<string>();
  const visitar = (no: ts.Node): void => {
    if (ts.isVariableDeclaration(no) || ts.isParameter(no) || ts.isBindingElement(no)) {
      coletarNomesDeBinding(no.name, declarados);
    } else if ((ts.isFunctionDeclaration(no) || ts.isFunctionExpression(no)
      || ts.isClassDeclaration(no) || ts.isClassExpression(no)) && no.name) declarados.add(no.name.text);
    else if (ts.isImportClause(no) && no.name) declarados.add(no.name.text);
    else if (ts.isNamespaceImport(no)) declarados.add(no.name.text);
    else if (ts.isImportSpecifier(no)) declarados.add(no.name.text);
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return new Set([...declarados].filter((nome) => CAPACIDADES_GLOBAIS.has(nome)));
}

function eChamadaDiretaDeRequire(no: ts.CallExpression, sombreado: boolean): boolean {
  return !sombreado && ts.isIdentifier(no.expression) && no.expression.text === 'require';
}

function usoSeguroDeRequire(no: ts.Identifier, sombreado: boolean): boolean {
  if (sombreado) return false;
  const pai = no.parent;
  if (ts.isCallExpression(pai) && pai.expression === no) return true;
  return ts.isPropertyAccessExpression(pai) && pai.expression === no && pai.name.text === 'resolve'
    && ts.isCallExpression(pai.parent) && pai.parent.expression === pai;
}

function eModuloNativo(pedido: string): boolean {
  return pedido.startsWith('node:') || MODULOS_NATIVOS.has(pedido);
}

function eHelperDeImportacao(no: ts.Expression, helpers: ReadonlySet<string>): no is ts.Identifier {
  return ts.isIdentifier(no) && helpers.has(no.text)
    && (no.text === '__importStar' || no.text === '__importDefault');
}

function ePedidoDeArquivo(pedido: string): boolean {
  return pedido.startsWith('.') || path.isAbsolute(pedido);
}

function eModuloSemCargaDeArquivo(pedido: string): boolean {
  return MODULOS_FS.has(pedido) || (eModuloNativo(pedido) && MODULOS_NATIVOS_SEGUROS.has(pedido));
}

function helpersEmitidosPeloTypescript(fonte: ts.SourceFile): Set<string> {
  const helpers = new Set<string>();
  for (const declaracao of fonte.statements) {
    if (!ts.isVariableStatement(declaracao)) continue;
    for (const item of declaracao.declarationList.declarations) {
      if (!ts.isIdentifier(item.name) || !HELPERS_DE_INTEROPERABILIDADE.has(item.name.text) || !item.initializer) continue;
      const inicial = desembrulharExpressao(item.initializer);
      if (!ts.isBinaryExpression(inicial) || inicial.operatorToken.kind !== ts.SyntaxKind.BarBarToken) continue;
      const guarda = desembrulharExpressao(inicial.left);
      if (ts.isBinaryExpression(guarda) && guarda.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        && guarda.left.kind === ts.SyntaxKind.ThisKeyword && ts.isPropertyAccessExpression(guarda.right)
        && guarda.right.expression.kind === ts.SyntaxKind.ThisKeyword && guarda.right.name.text === item.name.text) {
        helpers.add(item.name.text);
      }
    }
  }
  return helpers;
}

function origemDaCapacidade(expressao: ts.Expression,
  ligacoes: ReadonlyMap<string, LigacaoDeCapacidade>,
  helpers: ReadonlySet<string>): LigacaoDeCapacidade | null {
  const no = desembrulharExpressao(expressao);
  if (ts.isIdentifier(no)) return ligacoes.get(no.text) ?? null;
  const pedido = pedidoDeRequire(no);
  if (pedido !== null) {
    if (MODULOS_FS.has(pedido)) return { tipo: 'fs', origem: pedido };
    if (!ePedidoDeArquivo(pedido) && !MODULOS_NATIVOS_SEGUROS.has(pedido)) {
      return { tipo: 'outra', origem: pedido };
    }
    return null;
  }
  if (ts.isCallExpression(no) && eHelperDeImportacao(no.expression, helpers) && no.arguments.length === 1) {
    return origemDaCapacidade(no.arguments[0], ligacoes, helpers);
  }
  if (ts.isPropertyAccessExpression(no) && ['default', 'promises'].includes(no.name.text)) {
    return origemDaCapacidade(no.expression, ligacoes, helpers);
  }
  return null;
}

function coletarLigacoesDeCapacidade(fonte: ts.SourceFile): {
  ligacoes: Map<string, LigacaoDeCapacidade>;
  importacoesFsSeguras: Set<ts.Identifier>;
  helpers: Set<string>;
} {
  const ligacoes = new Map<string, LigacaoDeCapacidade>();
  const importacoesFsSeguras = new Set<ts.Identifier>();
  const helpers = helpersEmitidosPeloTypescript(fonte);
  let mudou = true;
  while (mudou) {
    mudou = false;
    const ligar = (nome: ts.BindingName, origem: LigacaoDeCapacidade, simplesSeguro: boolean): void => {
      if (ts.isIdentifier(nome)) {
        const anterior = ligacoes.get(nome.text);
        if (!anterior) {
          ligacoes.set(nome.text, origem); mudou = true;
        } else if ((anterior.tipo !== origem.tipo || anterior.origem !== origem.origem)
          && anterior.origem !== 'múltiplas capacidades') {
          ligacoes.set(nome.text, { tipo: 'outra', origem: 'múltiplas capacidades' }); mudou = true;
        }
        if (origem.tipo === 'fs' && simplesSeguro) importacoesFsSeguras.add(nome);
        return;
      }
      for (const item of nome.elements) {
        if (!ts.isOmittedExpression(item)) ligar(item.name,
          { tipo: 'outra', origem: `${origem.origem} desestruturado` }, false);
      }
    };
    const visitar = (no: ts.Node): void => {
      if (ts.isVariableDeclaration(no) && no.initializer) {
        const origem = origemDaCapacidade(no.initializer, ligacoes, helpers);
        if (origem) {
          const inicial = desembrulharExpressao(no.initializer);
          const importacaoDireta = pedidoDeRequire(inicial) !== null
            || (ts.isCallExpression(inicial) && eHelperDeImportacao(inicial.expression, helpers));
          ligar(no.name, origem, importacaoDireta);
        }
      } else if (ts.isBinaryExpression(no) && no.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(no.left)) {
        const origem = origemDaCapacidade(no.right, ligacoes, helpers);
        if (origem) ligar(no.left, origem, false);
      }
      ts.forEachChild(no, visitar);
    };
    visitar(fonte);
  }
  return { ligacoes, importacoesFsSeguras, helpers };
}

function eNomeDePropriedade(no: ts.Identifier): boolean {
  const pai = no.parent;
  return (ts.isPropertyAccessExpression(pai) && pai.name === no)
    || (ts.isPropertyAssignment(pai) && pai.name === no)
    || (ts.isMethodDeclaration(pai) && pai.name === no)
    || (ts.isBindingElement(pai) && pai.propertyName === no)
    || (ts.isLabeledStatement(pai) && pai.label === no)
    || (ts.isBreakOrContinueStatement(pai) && pai.label === no);
}

function eAlvoDeEscrita(no: ts.Expression): boolean {
  const pai = no.parent;
  return (ts.isBinaryExpression(pai) && pai.left === no
      && pai.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && pai.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
    || ((ts.isPrefixUnaryExpression(pai) || ts.isPostfixUnaryExpression(pai))
      && (pai.operator === ts.SyntaxKind.PlusPlusToken || pai.operator === ts.SyntaxKind.MinusMinusToken))
    || (ts.isDeleteExpression(pai) && pai.expression === no);
}

function usoSeguroDeProcesso(no: ts.Identifier): boolean {
  const membro = no.parent;
  if (!ts.isPropertyAccessExpression(membro) || membro.expression !== no) return false;
  if (membro.name.text === 'platform') return !eAlvoDeEscrita(membro);
  if (membro.name.text !== 'env') return false;
  const variavel = membro.parent;
  return ts.isPropertyAccessExpression(variavel) && variavel.expression === membro && !eAlvoDeEscrita(variavel);
}

function usoSeguroDeExportacao(no: ts.Identifier): boolean {
  if (no.text === 'exports') {
    const propriedade = no.parent;
    if (ts.isPropertyAccessExpression(propriedade) && propriedade.expression === no) {
      return ts.isBinaryExpression(propriedade.parent) && propriedade.parent.left === propriedade
        && propriedade.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    }
    const chamada = no.parent;
    return ts.isCallExpression(chamada) && chamada.arguments[0] === no
      && ts.isPropertyAccessExpression(chamada.expression)
      && ts.isIdentifier(chamada.expression.expression) && chamada.expression.expression.text === 'Object'
      && chamada.expression.name.text === 'defineProperty';
  }
  const exports = no.parent;
  if (!ts.isPropertyAccessExpression(exports) || exports.expression !== no || exports.name.text !== 'exports') return false;
  const alvo = ts.isPropertyAccessExpression(exports.parent) && exports.parent.expression === exports
    ? exports.parent : exports;
  return ts.isBinaryExpression(alvo.parent) && alvo.parent.left === alvo
    && alvo.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

function chamadaDiretaDaPropriedade(propriedade: ts.PropertyAccessExpression): ts.CallExpression | null {
  let atual: ts.Expression = propriedade;
  while (ts.isParenthesizedExpression(atual.parent) && atual.parent.expression === atual) atual = atual.parent;
  if (ts.isBinaryExpression(atual.parent) && atual.parent.operatorToken.kind === ts.SyntaxKind.CommaToken
    && atual.parent.right === atual) atual = atual.parent;
  while (ts.isParenthesizedExpression(atual.parent) && atual.parent.expression === atual) atual = atual.parent;
  return ts.isCallExpression(atual.parent) && atual.parent.expression === atual ? atual.parent : null;
}

function usoSeguroDeFs(no: ts.Identifier, importacoesSeguras: ReadonlySet<ts.Identifier>): boolean {
  if (importacoesSeguras.has(no)) return true;
  const pai = no.parent;
  if (!ts.isPropertyAccessExpression(pai) || pai.expression !== no) return false;
  let propriedade: ts.PropertyAccessExpression = pai;
  if (propriedade.name.text === 'default') {
    const operacao = propriedade.parent;
    if (!ts.isPropertyAccessExpression(operacao) || operacao.expression !== propriedade) return false;
    propriedade = operacao;
  }
  return FUNCOES_DE_FS.has(propriedade.name.text) && chamadaDiretaDaPropriedade(propriedade) !== null;
}

function requireDeFsEstaEmImportacaoSegura(chamada: ts.CallExpression, helpers: ReadonlySet<string>): boolean {
  let atual: ts.Expression = chamada;
  const pai = atual.parent;
  if (ts.isCallExpression(pai) && pai.arguments.includes(atual) && ts.isIdentifier(pai.expression)
    && helpers.has(pai.expression.text)) {
    if (!eHelperDeImportacao(pai.expression, helpers)) return true;
    atual = pai;
  }
  return ts.isVariableDeclaration(atual.parent) && atual.parent.initializer === atual
    && ts.isIdentifier(atual.parent.name);
}

function chamadasDeFs(no: ts.Node, ligacoes: LigacoesDeModulo): Array<{ chamada: ts.CallExpression; operacao: string }> {
  const chamadas: Array<{ chamada: ts.CallExpression; operacao: string }> = [];
  const visitar = (filho: ts.Node): void => {
    if (ts.isCallExpression(filho)) {
      const operacao = operacaoDoModulo(filho.expression, ligacoes);
      if (operacao !== null) chamadas.push({ chamada: filho, operacao });
    }
    ts.forEachChild(filho, visitar);
  };
  visitar(no);
  return chamadas;
}

function wrappersDeFs(fonte: ts.SourceFile, ligacoes: LigacoesDeModulo): Map<string, {
  parametros: string[];
  chamadas: Array<{ chamada: ts.CallExpression; operacao: string }>;
  no: ts.Node;
}> {
  const wrappers = new Map<string, {
    parametros: string[];
    chamadas: Array<{ chamada: ts.CallExpression; operacao: string }>;
    no: ts.Node;
  }>();
  for (const declaracao of fonte.statements) {
    if (ts.isFunctionDeclaration(declaracao) && declaracao.name && declaracao.body) {
      const chamadas = chamadasDeFs(declaracao.body, ligacoes);
      if (chamadas.length) wrappers.set(declaracao.name.text, {
        parametros: declaracao.parameters.map((p) => ts.isIdentifier(p.name) ? p.name.text : ''), chamadas,
        no: declaracao,
      });
    } else if (ts.isVariableStatement(declaracao)) {
      for (const item of declaracao.declarationList.declarations) {
        if (ts.isIdentifier(item.name) && item.initializer && (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))) {
          const chamadas = chamadasDeFs(item.initializer.body, ligacoes);
          if (chamadas.length) wrappers.set(item.name.text, {
            parametros: item.initializer.parameters.map((p) => ts.isIdentifier(p.name) ? p.name.text : ''), chamadas,
            no: item,
          });
        }
      }
    }
  }
  return wrappers;
}

function dependenciasDoArquivo(distTest: string, arquivo: string): Dependencias {
  const texto = fs.readFileSync(arquivo, 'utf8');
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const ligacoesFs = coletarLigacoesDoModulo(fonte, MODULOS_FS);
  const ligacoesPath = coletarLigacoesDoModulo(fonte, MODULOS_PATH);
  const { ligacoes: capacidadesLocais, importacoesFsSeguras, helpers } = coletarLigacoesDeCapacidade(fonte);
  const contexto: ContextoEstatico = {
    arquivo, distTest, fonte, constantes: constantesDoModulo(fonte), ligacoesPath,
  };
  const wrappers = wrappersDeFs(fonte, ligacoesFs);
  const locais: Dependencias['locais'] = [], modulos: string[] = [], arquivos: string[] = [];
  const incertezas = new Map<string, { linha: number; forma: string }>();
  const wrappersInvocados = new Set<string>();
  const sombreadas = capacidadesGlobaisSombreadas(fonte);
  const marcar = (no: ts.Node, forma: string): void => {
    const linha = linhaDoNo(fonte, no);
    incertezas.set(`${linha}:${forma}`, { linha, forma });
  };
  const registrarFs = (chamada: ts.CallExpression, operacao: string, ctx = contexto): void => {
    if (!FUNCOES_DE_FS.has(operacao)) {
      marcar(chamada, `operação de fs fora da lista segura: ${operacao}`);
      return;
    }
    const argumento = chamada.arguments[0];
    const resolvido = argumento ? avaliarCaminho(argumento, ctx) : null;
    const arquivoResolvido = resolvido ? resolverArquivo(distTest, resolvido) : null;
    if (arquivoResolvido) arquivos.push(arquivoResolvido);
    else marcar(argumento ?? chamada, `caminho de fs não resolvido em ${operacao}`);
  };
  const diagnosticos = (fonte as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const diagnostico of diagnosticos) {
    const linha = diagnostico.start === undefined ? 1
      : fonte.getLineAndCharacterOfPosition(diagnostico.start).line + 1;
    const forma = 'arquivo não analisado por inteiro: erro de sintaxe';
    incertezas.set(`${linha}:${forma}`, { linha, forma });
  }
  const formaDaCapacidade = (no: ts.Identifier): string => {
    const pai = no.parent;
    if (no.text === 'require') return 'uso de require fora de chamada direta';
    if (no.text === 'module' && ts.isPropertyAccessExpression(pai) && pai.expression === no) {
      return `module.${pai.name.text}`;
    }
    if (no.text === 'process' && ts.isPropertyAccessExpression(pai) && pai.expression === no) {
      return `process.${pai.name.text}`;
    }
    if (['globalThis', 'global', 'process', 'module', 'require'].includes(no.text)
      && ts.isElementAccessExpression(pai) && pai.expression === no) return 'acesso computado em objeto sensível';
    if (no.text === 'Worker' && ts.isNewExpression(pai) && pai.expression === no) return 'construtor Worker';
    if (no.text === 'createRequire') return 'createRequire';
    return `capacidade em posição não segura: ${no.text}`;
  };
  const validarCapacidades = (no: ts.Node): void => {
    if (ts.isWithStatement(no)) marcar(no, 'capacidade em posição não segura: with');
    if (ts.isMetaProperty(no) && no.keywordToken === ts.SyntaxKind.ImportKeyword) {
      marcar(no, 'capacidade em posição não segura: import.meta');
    }
    if (ts.isCallExpression(no) && no.expression.kind === ts.SyntaxKind.ImportKeyword) {
      marcar(no, 'capacidade em posição não segura: importação dinâmica');
    }
    if (ts.isIdentifier(no) && !eNomeDePropriedade(no)) {
      if (CAPACIDADES_GLOBAIS.has(no.text)) {
        if (sombreadas.has(no.text)) marcar(no, `sombreamento de capacidade: ${no.text}`);
        else if (no.text === 'require' && usoSeguroDeRequire(no, false)) { /* posição segura */ }
        else if ((no.text === 'module' || no.text === 'exports') && usoSeguroDeExportacao(no)) { /* posição segura */ }
        else if (no.text === 'process' && usoSeguroDeProcesso(no)) { /* posição segura */ }
        else marcar(no, formaDaCapacidade(no));
      } else {
        const ligacao = capacidadesLocais.get(no.text);
        if (ligacao && !(ligacao.tipo === 'fs' && usoSeguroDeFs(no, importacoesFsSeguras))) {
          marcar(no, `capacidade de ${ligacao.origem} em posição não segura`);
        }
      }
    }
    ts.forEachChild(no, validarCapacidades);
  };
  validarCapacidades(fonte);
  const visitar = (no: ts.Node): void => {
    if (ts.isVariableDeclaration(no) && ts.isIdentifier(no.name) && wrappers.has(no.name.text)) return;
    if (ts.isFunctionDeclaration(no) && no.name && wrappers.has(no.name.text)) return;
    if (ts.isCallExpression(no)) {
      if (eChamadaDiretaDeRequire(no, sombreadas.has('require'))) {
        const argumento = no.arguments[0];
        const pedido = no.arguments.length === 1 && argumento ? avaliarPedidoDeRequire(argumento, contexto) : null;
        if (!pedido) marcar(argumento ?? no, 'require com caminho não resolvido');
        else if (pedido.startsWith('.')) locais.push({
          pedido, linha: linhaDoNo(fonte, no), forma: `require(${pedido})`,
        });
        else if (path.isAbsolute(pedido)) {
          const resolvido = resolverArquivo(distTest, pedido);
          if (resolvido) modulos.push(resolvido); else marcar(argumento ?? no, `require não resolvido: ${pedido}`);
        } else if (MODULOS_FS.has(pedido)) {
          if (!requireDeFsEstaEmImportacaoSegura(no, helpers)) marcar(no, `capacidade de ${pedido} fora de importação segura`);
        } else if (!eModuloSemCargaDeArquivo(pedido)) {
          marcar(no, `módulo fora da lista segura: ${pedido}`);
        }
      } else if (!sombreadas.has('require') && eRequireResolve(no.expression)) {
        const argumento = no.arguments[0];
        const pedido = no.arguments.length === 1 && argumento ? avaliarPedidoDeRequire(argumento, contexto) : null;
        if (!pedido) marcar(argumento ?? no, 'require.resolve com caminho não resolvido');
        else if (pedido.startsWith('.')) locais.push({
          pedido, linha: linhaDoNo(fonte, no), forma: `require.resolve(${pedido})`,
        });
        else if (path.isAbsolute(pedido)) {
          const resolvido = resolverArquivo(distTest, pedido);
          if (resolvido) modulos.push(resolvido); else marcar(argumento ?? no, `require.resolve não resolvido: ${pedido}`);
        } else if (!eModuloSemCargaDeArquivo(pedido)) marcar(no, `módulo fora da lista segura: ${pedido}`);
      } else {
        const operacaoFs = operacaoDoModulo(no.expression, ligacoesFs);
        if (operacaoFs !== null) registrarFs(no, operacaoFs);
        else if (ts.isIdentifier(no.expression) && wrappers.has(no.expression.text)) {
          const wrapper = wrappers.get(no.expression.text)!;
          wrappersInvocados.add(no.expression.text);
          const parametros = new Map<string, ts.Expression>();
          wrapper.parametros.forEach((nome, i) => { if (nome && no.arguments[i]) parametros.set(nome, no.arguments[i]); });
          for (const { chamada, operacao } of wrapper.chamadas) registrarFs(chamada, operacao, { ...contexto, parametros });
        }
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  for (const [nome, wrapper] of wrappers) {
    if (!wrappersInvocados.has(nome)) marcar(wrapper.no, `wrapper de fs não invocado: ${nome}`);
  }
  const locaisUnicos = new Map(locais.map((item) => [`${item.pedido}:${item.linha}`, item]));
  return {
    locais: [...locaisUnicos.values()], modulos: [...new Set(modulos)], arquivos: [...new Set(arquivos)],
    incertezas: [...incertezas.values()],
  };
}

/** Extensão do fonte TypeScript que corresponde ao teste compilado. */
const EXTENSAO_DO_FONTE = '.ts';

function caminhoDeFonte(distTest: string, arquivo: string): string {
  if (dentro(distTest, arquivo)) {
    const relativo = barras(path.relative(distTest, arquivo));
    return `core/${relativo.replace(/\.js$/, EXTENSAO_DO_FONTE)}`;
  }
  const core = path.dirname(distTest);
  if (dentro(core, arquivo)) return `core/${barras(path.relative(core, arquivo))}`;
  return barras(arquivo);
}

/** Processo filho e referências ao produto inteiro ficam sempre na seleção. */
export function testeSobeProcesso(texto: string): boolean {
  return /\b(?:spawn|spawnSync|exec|execFile|execFileSync|execSync|fork)\b/.test(texto)
    || /dist[\\/]index\.js/.test(texto) || /(?:^|[\\/])scripts(?:[\\/]|['"])/m.test(texto);
}

/**
 * Cada teste tem seu próprio fecho. Só arquivos formados por cargas que o seletor resolve participam do grafo;
 * qualquer outra forma prende o teste e deixa causa, arquivo e linha no plano.
 */
export function planejarSelecaoNode(distTest: string, arquivosDaLane: readonly string[], alteradosRecebidos: readonly string[]): PlanoDaSelecaoNode {
  const completos = [...new Set(arquivosDaLane)].sort();
  const alterados = [...new Set(alteradosRecebidos.map(barras))].sort();
  const inteira = (motivo: Exclude<MotivoDaSelecaoNode, 'selecionada'>,
    ambiguidade?: PlanoDaSelecaoNode['ambiguidade']): PlanoDaSelecaoNode =>
    ({ modo: 'inteira', motivo, arquivos: completos, alterados, ...(ambiguidade ? { ambiguidade } : {}) });
  if (alterados.length === 0) return inteira('sem-mudancas');
  if (alterados.some((arquivo) => !/^core\/(?:src|test)\//.test(arquivo))) return inteira('fora-do-mapeamento');

  const dirDosTestes = path.join(distTest, 'test');
  const cache = new Map<string, Dependencias>();
  const ler = (arquivo: string): Dependencias => {
    const existente = cache.get(arquivo);
    if (existente) return existente;
    const lido = dependenciasDoArquivo(distTest, arquivo);
    cache.set(arquivo, lido);
    return lido;
  };
  const fechos = new Map<string, Set<string>>();
  const processos = new Set<string>();
  const incertos = new Set<string>();
  const causas = new Map<string, {
    testes: Set<string>; arquivo: string; linha: number; forma: string;
  }>();
  const registrarCausa = (teste: string, arquivo: string, linha: number, forma: string): void => {
    const arquivoFonte = caminhoDeFonte(distTest, arquivo);
    const chave = `${arquivoFonte}:${linha}:${forma}`;
    const existente = causas.get(chave);
    if (existente) existente.testes.add(teste);
    else causas.set(chave, { testes: new Set([teste]), arquivo: arquivoFonte, linha, forma });
    incertos.add(teste);
  };
  for (const nome of completos) {
    const raiz = path.join(dirDosTestes, nome);
    if (!fs.statSync(raiz, { throwIfNoEntry: false })?.isFile()) {
      return inteira('caminho-nao-resolvido', { arquivo: caminhoDeFonte(distTest, raiz), pedido: nome });
    }
    if (testeSobeProcesso(fs.readFileSync(raiz, 'utf8'))) processos.add(nome);
    const vistos = new Set<string>([raiz]);
    const arquivosLidos = new Set<string>();
    const pilha = [raiz];
    while (pilha.length) {
      const atual = pilha.pop()!;
      const dependencias = ler(atual);
      for (const incerteza of dependencias.incertezas) {
        registrarCausa(nome, atual, incerteza.linha, incerteza.forma);
      }
      for (const dependencia of dependencias.locais) {
        const resolvido = resolverModulo(distTest, atual, dependencia.pedido);
        if (!resolvido) {
          registrarCausa(nome, atual, dependencia.linha, `caminho local não resolvido: ${dependencia.forma}`);
          continue;
        }
        if (!vistos.has(resolvido)) { vistos.add(resolvido); pilha.push(resolvido); }
      }
      for (const resolvido of dependencias.modulos) {
        if (!vistos.has(resolvido)) { vistos.add(resolvido); pilha.push(resolvido); }
      }
      for (const resolvido of dependencias.arquivos) arquivosLidos.add(resolvido);
    }
    fechos.set(nome, new Set([...vistos, ...arquivosLidos].map((arquivo) => caminhoDeFonte(distTest, arquivo))));
  }

  const mudou = new Set(alterados);
  const selecionados = completos.filter((nome) => processos.has(nome) || incertos.has(nome)
    || [...(fechos.get(nome) ?? [])].some((arquivo) => mudou.has(arquivo)));
  const incertezas = [...causas.values()].map((causa) => ({
    ...causa, testes: [...causa.testes].sort(),
  })).sort((a, b) => a.arquivo.localeCompare(b.arquivo) || a.linha - b.linha
    || a.forma.localeCompare(b.forma));
  return { modo: 'selecionada', motivo: 'selecionada', arquivos: selecionados, alterados,
    sempre: { processoFilho: [...processos].sort(), dependenciaIncerta: [...incertos].sort() },
    incertezas };
}
