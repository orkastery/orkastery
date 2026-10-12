#!/usr/bin/env node
/**
 * RM-061 (CLI em ingles e pt-BR): o contador de mensagens de saida, pelo metodo do PR #113. O script
 * original do #113 nao foi versionado; este o reimplementa pelo metodo que o PR descreve (D3 da thread
 * ork-rm061f2a), e a medida antes e depois de cada fatia sai do mesmo script.
 *
 * Metodo, pela arvore sintatica do TypeScript em `core/src` (recursivo):
 *   - literal com texto de pessoa: string, template sem e com interpolacao, com duas palavras ou mais;
 *   - em posicao de saida: argumento de `console.*` e de `process.std*.write`, de `Error(...)` (e de
 *     `new XxxError(...)`), de `.push(...)`, valor de `return` (e de corpo de arrow function), ou valor
 *     de campo de texto (`detalhe`, `correcao`, `mensagem` e afins), atravessando parenteses, `+`,
 *     ternario, template, `[...].join(...)` e chamada comum (`return erro(..., 'texto')`);
 *   - catalogo: as folhas do objeto ingles de `locale.ts` e dos `locale-*.ts` (texto, funcao ou item de
 *     lista; cada entrada de mapa de nomes conta como uma). O catalogo nao entra na contagem de saida.
 *   - cobertura = entradas do catalogo / (entradas do catalogo + literais de saida fora dele).
 *
 * Uso: node core/scripts/contar-mensagens-de-saida.cjs [--json] [diretorio, padrao core/src]
 * Sai 0 com a medida; 2 com uso errado ou diretorio inexistente.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const CAMPOS_DE_TEXTO = new Set(['detalhe', 'correcao', 'mensagem', 'texto', 'titulo', 'resumo', 'aviso', 'erro', 'pergunta',
  'descricao', 'explicacao', 'razao', 'linha', 'dica', 'acao', 'proximoPasso', 'motivoTexto', 'causa']);
const CATALOGO = /^locale(-[a-z]+)?\.ts$/;
/** Duas palavras de duas letras ou mais separadas por espaco (com pontuacao em volta): texto de pessoa. */
const TEXTO_DE_PESSOA = /\p{L}{2,}[,;:.!?)"'`]*\s+[("'`]*\p{L}{2,}/u;

function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

function textoDoLiteral(no) {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) return no.text;
  if (ts.isTemplateExpression(no)) return [no.head.text, ...no.templateSpans.map((s) => s.literal.text)].join(' ');
  return null;
}

/** O literal esta em posicao de saida? Sobe pelos invólucros ate achar um destino. */
function emPosicaoDeSaida(no) {
  let atual = no;
  for (let passo = 0; passo < 12 && atual.parent; passo++) {
    const pai = atual.parent;
    if (ts.isParenthesizedExpression(pai) || ts.isTemplateSpan(pai) || ts.isTemplateExpression(pai) || ts.isAsExpression(pai)) { atual = pai; continue; }
    if (ts.isBinaryExpression(pai) && pai.operatorToken.kind === ts.SyntaxKind.PlusToken) { atual = pai; continue; }
    if (ts.isConditionalExpression(pai) && atual !== pai.condition) { atual = pai; continue; }
    if (ts.isArrayLiteralExpression(pai)) {
      // `[a, b].join(...)`: a lista vira texto.
      const acima = pai.parent;
      if (acima && ts.isPropertyAccessExpression(acima) && acima.name.text === 'join') { atual = acima.parent; continue; }
      if (acima && (ts.isCallExpression(acima) || ts.isNewExpression(acima))) { atual = pai; continue; }
      return false;
    }
    if (ts.isReturnStatement(pai)) return true;
    if (ts.isArrowFunction(pai) && pai.body === atual) return true;
    if (ts.isPropertyAssignment(pai) && pai.initializer === atual) {
      const nome = pai.name && (ts.isIdentifier(pai.name) || ts.isStringLiteral(pai.name)) ? pai.name.text : '';
      return CAMPOS_DE_TEXTO.has(nome);
    }
    if (ts.isCallExpression(pai) || ts.isNewExpression(pai)) {
      if (!(pai.arguments || []).includes(atual)) return false;
      const alvo = pai.expression;
      const nome = ts.isIdentifier(alvo) ? alvo.text : ts.isPropertyAccessExpression(alvo) ? alvo.name.text : '';
      const dono = ts.isPropertyAccessExpression(alvo) ? alvo.expression.getText() : '';
      if (dono === 'console') return true;
      if (/^process\.(stdout|stderr)$/.test(dono) && nome === 'write') return true;
      if (/Error$/.test(nome)) return true;
      if (nome === 'push') return true;
      // Chamada comum (`erro(..., 'texto')`, `resultado('codigo', texto)`): o texto segue com o valor dela.
      atual = pai;
      continue;
    }
    return false;
  }
  return false;
}

/** As folhas de um objeto literal do catalogo: texto, funcao, item de lista e entrada de mapa. */
function folhasDoCatalogo(objeto) {
  let n = 0;
  for (const p of objeto.properties) {
    const valor = ts.isPropertyAssignment(p) ? p.initializer : null;
    if (!valor) continue;
    let v = valor;
    while (ts.isAsExpression(v) || ts.isParenthesizedExpression(v) || ts.isSatisfiesExpression?.(v)) v = v.expression;
    if (ts.isObjectLiteralExpression(v)) n += folhasDoCatalogo(v);
    else if (ts.isArrayLiteralExpression(v)) n += v.elements.length;
    // Texto, template, concatenacao, ternario ou funcao: uma entrada. Numero (largura) e referencia a
    // outra familia (contada no arquivo dela) nao contam.
    else if (!ts.isIdentifier(v) && !ts.isNumericLiteral(v)) n += 1;
  }
  return n;
}

/** O objeto ingles do arquivo de catalogo: `const EN` em `locale.ts`, `export const X_EN` nas familias. */
function entradasDoCatalogo(fonte) {
  let n = 0;
  const visitar = (no) => {
    if (ts.isVariableDeclaration(no) && ts.isIdentifier(no.name) && /(^|_)EN$/.test(no.name.text) && no.initializer) {
      let v = no.initializer;
      while (ts.isAsExpression(v) || ts.isParenthesizedExpression(v)) v = v.expression;
      if (ts.isObjectLiteralExpression(v)) n += folhasDoCatalogo(v);
      return;
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return n;
}

function medir(raiz) {
  const todos = arquivos(raiz).sort();
  const porArquivo = [];
  let literais = 0, saida = 0, entradas = 0;
  const catalogo = [];
  for (const arquivo of todos) {
    const rel = path.relative(raiz, arquivo).split(path.sep).join('/');
    const fonte = ts.createSourceFile(arquivo, fs.readFileSync(arquivo, 'utf8'), ts.ScriptTarget.ES2022, true);
    if (CATALOGO.test(path.basename(arquivo))) {
      const n = entradasDoCatalogo(fonte);
      entradas += n;
      catalogo.push({ arquivo: rel, entradas: n });
      continue;
    }
    let doArquivo = 0;
    const visitar = (no) => {
      const texto = textoDoLiteral(no);
      if (texto !== null) {
        if (TEXTO_DE_PESSOA.test(texto)) {
          literais++;
          if (emPosicaoDeSaida(no)) doArquivo++;
        }
        if (ts.isTemplateExpression(no)) ts.forEachChild(no, visitar);
        return;
      }
      ts.forEachChild(no, visitar);
    };
    visitar(fonte);
    saida += doArquivo;
    if (doArquivo) porArquivo.push({ arquivo: rel, saida: doArquivo });
  }
  porArquivo.sort((a, b) => b.saida - a.saida || a.arquivo.localeCompare(b.arquivo));
  return {
    schema: 'ork.locale-cobertura/v1',
    arquivos: todos.length,
    literaisComTexto: literais,
    emPosicaoDeSaida: saida,
    arquivosComSaida: porArquivo.length,
    maiores: porArquivo.slice(0, 10),
    /** Todos os arquivos com literal de saida fora do catalogo: o que falta migrar, por arquivo. */
    porArquivo,
    catalogo: { entradas, arquivos: catalogo },
    cobertura: entradas + saida ? Number((entradas / (entradas + saida)).toFixed(4)) : 0,
  };
}

function principal(argv) {
  const json = argv.includes('--json');
  const resto = argv.filter((a) => a !== '--json');
  if (resto.length > 1 || resto.some((a) => a.startsWith('-'))) {
    process.stderr.write('uso: node core/scripts/contar-mensagens-de-saida.cjs [--json] [diretorio]\n');
    return 2;
  }
  const raiz = path.resolve(resto[0] || path.join(__dirname, '..', 'src'));
  if (!fs.existsSync(raiz) || !fs.statSync(raiz).isDirectory()) {
    process.stderr.write(`contador: diretorio inexistente: ${raiz}\n`);
    return 2;
  }
  const m = medir(raiz);
  if (json) { process.stdout.write(JSON.stringify(m, null, 2) + '\n'); return 0; }
  const linhas = [
    `Arquivos .ts: ${m.arquivos}`,
    `Literais com texto de pessoa: ${m.literaisComTexto}`,
    `Em posicao de saida, fora do catalogo: ${m.emPosicaoDeSaida}, em ${m.arquivosComSaida} arquivos`,
    `Entradas do catalogo: ${m.catalogo.entradas} (${m.catalogo.arquivos.map((a) => `${a.arquivo} ${a.entradas}`).join(', ')})`,
    `Cobertura: ${(m.cobertura * 100).toFixed(1)}%`,
    `Maiores: ${m.maiores.map((a) => `${a.arquivo} ${a.saida}`).join(', ')}`,
  ];
  process.stdout.write(linhas.join('\n') + '\n');
  return 0;
}

module.exports = { medir };
if (require.main === module) process.exitCode = principal(process.argv.slice(2));
