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
}

interface Dependencias {
  locais: string[];
  arquivos: string[];
  incertezas: string[];
}

interface ContextoEstatico {
  arquivo: string;
  distTest: string;
  fonte: ts.SourceFile;
  constantes: Map<string, ts.Expression>;
  parametros?: Map<string, ts.Expression>;
}

const FUNCOES_DE_FS = new Set(['readFileSync', 'readFile', 'existsSync', 'statSync']);
const MODULOS_FS = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const MODULOS_VM = new Set(['vm', 'node:vm']);
const MODULOS_GLOB = new Set(['glob']);

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
  return (ts.isPropertyAccessExpression(no) || ts.isElementAccessExpression(no))
    && nomeDaPropriedade(no) === 'promises' && eNamespaceDoModulo(no.expression, ligacoes);
}

function operacaoDoModulo(expressao: ts.Expression, ligacoes: LigacoesDeModulo): string | null {
  const no = desembrulharExpressao(expressao);
  if (ts.isIdentifier(no)) return ligacoes.funcoes.get(no.text) ?? null;
  if ((ts.isPropertyAccessExpression(no) || ts.isElementAccessExpression(no))
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
  if (ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression)
    && ['join', 'resolve'].includes(no.expression.name.text)) {
    const partes = no.arguments.map((argumento) => avaliarCaminho(argumento, contexto, visitados));
    if (partes.some((parte) => parte === null)) return null;
    return no.expression.name.text === 'join' ? path.join(...partes as string[]) : path.resolve(...partes as string[]);
  }
  return null;
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
}> {
  const wrappers = new Map<string, {
    parametros: string[];
    chamadas: Array<{ chamada: ts.CallExpression; operacao: string }>;
  }>();
  for (const declaracao of fonte.statements) {
    if (ts.isFunctionDeclaration(declaracao) && declaracao.name && declaracao.body) {
      const chamadas = chamadasDeFs(declaracao.body, ligacoes);
      if (chamadas.length) wrappers.set(declaracao.name.text, {
        parametros: declaracao.parameters.map((p) => ts.isIdentifier(p.name) ? p.name.text : ''), chamadas,
      });
    } else if (ts.isVariableStatement(declaracao)) {
      for (const item of declaracao.declarationList.declarations) {
        if (ts.isIdentifier(item.name) && item.initializer && (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))) {
          const chamadas = chamadasDeFs(item.initializer.body, ligacoes);
          if (chamadas.length) wrappers.set(item.name.text, {
            parametros: item.initializer.parameters.map((p) => ts.isIdentifier(p.name) ? p.name.text : ''), chamadas,
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
  const contexto: ContextoEstatico = { arquivo, distTest, fonte, constantes: constantesDoModulo(fonte) };
  const ligacoesFs = coletarLigacoesDoModulo(fonte, MODULOS_FS);
  const ligacoesVm = coletarLigacoesDoModulo(fonte, MODULOS_VM);
  const ligacoesGlob = coletarLigacoesDoModulo(fonte, MODULOS_GLOB);
  const wrappers = wrappersDeFs(fonte, ligacoesFs);
  const locais: string[] = [], arquivos: string[] = [], incertezas: string[] = [];
  const wrappersInvocados = new Set<string>();
  const registrarFs = (chamada: ts.CallExpression, operacao: string, ctx = contexto): void => {
    if (!FUNCOES_DE_FS.has(operacao)) {
      incertezas.push(chamada.getText(fonte));
      return;
    }
    const argumento = chamada.arguments[0];
    const resolvido = argumento ? avaliarCaminho(argumento, ctx) : null;
    const arquivoResolvido = resolvido ? resolverArquivo(distTest, resolvido) : null;
    if (arquivoResolvido) arquivos.push(arquivoResolvido);
    else incertezas.push(argumento?.getText(fonte) ?? '<ausente>');
  };
  const visitar = (no: ts.Node): void => {
    if (ts.isVariableDeclaration(no) && ts.isIdentifier(no.name) && wrappers.has(no.name.text)) return;
    if (ts.isFunctionDeclaration(no) && no.name && wrappers.has(no.name.text)) return;
    if (ts.isNewExpression(no) && ((ts.isIdentifier(no.expression) && no.expression.text === 'Function')
      || operacaoDoModulo(no.expression, ligacoesVm) !== null)) {
      incertezas.push(no.getText(fonte));
    }
    if (ts.isCallExpression(no)) {
      if (ts.isIdentifier(no.expression) && no.expression.text === 'require') {
        const argumento = no.arguments[0];
        if (no.arguments.length !== 1 || !argumento || !(ts.isStringLiteral(argumento)
          || ts.isNoSubstitutionTemplateLiteral(argumento))) {
          incertezas.push(argumento?.getText(fonte) ?? '<ausente>');
        } else if (argumento.text.startsWith('.')) locais.push(argumento.text);
        else if (path.isAbsolute(argumento.text)) incertezas.push(argumento.text);
      } else if (eRequireResolve(no.expression)) {
        const argumento = no.arguments[0];
        const pedido = argumento ? avaliarCaminho(argumento, contexto) : null;
        if (!pedido) incertezas.push(argumento?.getText(fonte) ?? '<ausente>');
        else if (pedido.startsWith('.')) locais.push(pedido);
        else if (path.isAbsolute(pedido)) {
          const resolvido = resolverArquivo(distTest, pedido);
          if (resolvido) arquivos.push(resolvido); else incertezas.push(pedido);
        }
      } else {
        const operacaoFs = operacaoDoModulo(no.expression, ligacoesFs);
        if (operacaoFs !== null) registrarFs(no, operacaoFs);
        else if ((ts.isIdentifier(no.expression) && ['eval', 'Function'].includes(no.expression.text))
          || no.expression.kind === ts.SyntaxKind.ImportKeyword
          || operacaoDoModulo(no.expression, ligacoesVm) !== null
          || operacaoDoModulo(no.expression, ligacoesGlob) !== null) {
          incertezas.push(no.getText(fonte));
        } else if (ts.isIdentifier(no.expression) && wrappers.has(no.expression.text)) {
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
  for (const nome of wrappers.keys()) if (!wrappersInvocados.has(nome)) incertezas.push(`${nome}(<indeterminado>)`);
  return { locais: [...new Set(locais)], arquivos: [...new Set(arquivos)], incertezas: [...new Set(incertezas)] };
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
 * Cada teste tem seu próprio fecho. Dependência incerta prende somente esse teste; os fechos inteiramente resolvidos
 * continuam selecionáveis. Pacotes e módulos `node:` não participam do mapa porque não aparecem no diff da F5.
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
      if (dependencias.incertezas.length) incertos.add(nome);
      for (const pedido of dependencias.locais) {
        const resolvido = resolverModulo(distTest, atual, pedido);
        if (!resolvido) { incertos.add(nome); continue; }
        if (!vistos.has(resolvido)) { vistos.add(resolvido); pilha.push(resolvido); }
      }
      for (const resolvido of dependencias.arquivos) arquivosLidos.add(resolvido);
    }
    fechos.set(nome, new Set([...vistos, ...arquivosLidos].map((arquivo) => caminhoDeFonte(distTest, arquivo))));
  }

  const mudou = new Set(alterados);
  const selecionados = completos.filter((nome) => processos.has(nome) || incertos.has(nome)
    || [...(fechos.get(nome) ?? [])].some((arquivo) => mudou.has(arquivo)));
  return { modo: 'selecionada', motivo: 'selecionada', arquivos: selecionados, alterados,
    sempre: { processoFilho: [...processos].sort(), dependenciaIncerta: [...incertos].sort() } };
}
