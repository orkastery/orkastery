#!/usr/bin/env node
/**
 * RM-072 (D14 da ork-check5x): o contrato de paridade do `tsgo` (o TypeScript 7 nativo, pacote `@typescript/native-preview`)
 * contra o `tsc` 5.9.3 do Classic, no mesmo commit.
 *
 *   node scripts/tsgo-paridade.cjs [--resumo] [--saida <arquivo.json>]
 *
 * 1. Typecheck: o conjunto de diagnosticos (arquivo, linha, codigo) dos dois compiladores e o mesmo na arvore limpa e numa
 *    copia com mutantes de erro de tipo (atribuicao errada, retorno errado, parametro sem tipo, chamada sem argumento,
 *    propriedade que nao existe, importacao que nao existe e variavel sem uso), e cada mutante e acusado.
 * 2. Emit: o JavaScript que o `tsgo` emite para `dist` e `dist-test` e o mesmo que o `tsc` 5.9.3 emite, token a token (as
 *    folhas da arvore do proprio `typescript` 5.9.3, sem espaco nem comentario), com os mesmos arquivos. Os dois emitem do
 *    zero numa pasta temporaria: o `dist` da arvore pode ter vindo de qualquer um deles.
 *
 * O `tsc` le `tsconfig.json` e `tsconfig.test.json` (os do Classic); o `tsgo` le `tsconfig.tsgo.json` e
 * `tsconfig.tsgo.test.json` (os do preparo do Agile). Sai 0 so com as duas paridades e 3 quando o `tsgo` nao esta instalado.
 * Imprime um JSON (ou, com `--resumo`, uma linha) e grava o JSON em `--saida`. `ORK_TSGO_CORE` troca a pasta do core (os
 * testes usam uma arvore pequena).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CORE = path.resolve(process.env.ORK_TSGO_CORE || path.join(__dirname, '..'));
const TSC = path.join(CORE, 'node_modules', 'typescript', 'bin', 'tsc');
const TSGO = path.join(CORE, 'node_modules', '@typescript', 'native-preview', 'bin', 'tsgo');

/** O arquivo dos mutantes na copia: cada linha e um erro de tipo que os dois compiladores tem de acusar igual. */
const ARQUIVO_DOS_MUTANTES = path.join('src', 'mutantes-da-paridade.ts');
const MUTANTES = [
  'import { naoExiste } from "./nao-existe-na-paridade";',
  'function exigeUm(x: number): number { return x; }',
  'export const mutanteImportacao = naoExiste;',
  'export const mutanteAtribuicao: number = "texto";',
  'export function mutanteRetorno(): string { return 1; }',
  'export function mutanteSemTipo(x) { return x; }',
  'export const mutanteChamada = exigeUm();',
  'export const mutantePropriedade = (null as unknown as { a: number }).b;',
  'export function mutanteSemUso(): number { const sobra = 1; return 2; }',
];
/** Quantos erros os mutantes acima geram no minimo (a linha da funcao auxiliar e a do uso da importacao nao contam). */
const ERROS_DOS_MUTANTES = 7;

/** Roda o compilador e devolve a saida, o codigo e o tempo, sem bloquear os outros que rodam junto. */
function rodar(bin, args, cwd) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    let saida = '';
    const p = spawn(process.execPath, [bin, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
    p.on('error', (e) => resolve({ saida: String(e), status: 1, ms: Date.now() - inicio }));
    p.on('close', (status) => resolve({ saida, status: status ?? 1, ms: Date.now() - inicio }));
  });
}

async function versao(bin) {
  if (!fs.existsSync(bin)) return null;
  const r = await rodar(bin, ['--version'], CORE);
  return r.status === 0 ? r.saida.trim().replace(/^Version /, '') : null;
}

/** Os diagnosticos de `--pretty false` (`arquivo(linha,coluna): error TSnnnn: ...`) como `arquivo:linha:TSnnnn`, ordenados. */
function diagnosticos(saida, cwd) {
  return saida.split('\n').map((l) => /^(.+?)\((\d+),\d+\): error (TS\d+):/.exec(l.trim()))
    .filter(Boolean).map((m) => `${path.relative(cwd, path.resolve(cwd, m[1])).split(path.sep).join('/')}:${m[2]}:${m[3]}`).sort();
}

const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Uma copia do core com src, test e as tsconfig de verdade, o node_modules por link e o arquivo dos mutantes. */
function copiaComMutantes(dir) {
  for (const d of ['src', 'test']) {
    if (fs.existsSync(path.join(CORE, d))) fs.cpSync(path.join(CORE, d), path.join(dir, d), { recursive: true });
  }
  for (const f of fs.readdirSync(CORE).filter((n) => /^tsconfig.*\.json$/.test(n))) fs.copyFileSync(path.join(CORE, f), path.join(dir, f));
  fs.symlinkSync(path.join(CORE, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, ARQUIVO_DOS_MUTANTES), `// mutantes da paridade do tsgo\n${MUTANTES.join('\n')}\n`);
}

/**
 * Os tokens de um arquivo JavaScript pela arvore do `typescript` 5.9.3: as folhas da arvore (o parser reescaneia regex e
 * template no contexto certo), sem espaco, sem comentario e sem JSDoc. Dois arquivos com os mesmos tokens so diferem em
 * espaco, quebra de linha ou comentario.
 */
function tokens(ts, texto) {
  const sf = ts.createSourceFile('emit.js', texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const lista = [];
  const jsdoc = (k) => k >= ts.SyntaxKind.FirstJSDocNode && k <= ts.SyntaxKind.LastJSDocNode;
  const visitar = (n) => {
    if (jsdoc(n.kind)) return;
    const filhos = n.getChildren(sf);
    if (filhos.length === 0) {
      if (n.kind !== ts.SyntaxKind.EndOfFileToken) lista.push(`${n.kind}:${n.getText(sf)}`);
      return;
    }
    for (const f of filhos) visitar(f);
  };
  visitar(sf);
  return lista;
}

/** Os arquivos `.js` de uma pasta, relativos e ordenados. */
function arquivosJs(dir) {
  const lista = [];
  const andar = (rel) => {
    if (!fs.existsSync(path.join(dir, rel))) return;
    for (const nome of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = path.join(rel, nome);
      if (fs.statSync(path.join(dir, r)).isDirectory()) andar(r);
      else if (nome.endsWith('.js')) lista.push(r.split(path.sep).join('/'));
    }
  };
  andar('');
  return lista;
}

/** Compara o emit do `tsgo` com o do `tsc`, arquivo por arquivo: os mesmos arquivos e os mesmos tokens em cada um. */
function compararEmit(ts, doTsgo, doTsc) {
  const a = arquivosJs(doTsgo), b = arquivosJs(doTsc);
  const resultado = { arquivos: a.length, bytesIguais: 0, tokensIguais: 0, diferentes: [],
    soNoTsgo: a.filter((r) => !b.includes(r)), soNoTsc: b.filter((r) => !a.includes(r)) };
  for (const r of a.filter((x) => b.includes(x))) {
    const ta = fs.readFileSync(path.join(doTsgo, r), 'utf8'), tb = fs.readFileSync(path.join(doTsc, r), 'utf8');
    if (ta === tb) { resultado.bytesIguais++; resultado.tokensIguais++; continue; }
    const ka = tokens(ts, ta), kb = tokens(ts, tb);
    if (iguais(ka, kb)) { resultado.tokensIguais++; continue; }
    const i = ka.findIndex((t, k) => t !== kb[k]);
    resultado.diferentes.push({ arquivo: r, token: i < 0 ? ka.length : i, tsgo: ka[i < 0 ? ka.length : i] ?? null, tsc: kb[i < 0 ? ka.length : i] ?? null });
  }
  return resultado;
}

/** As duas paridades; o temporario fica numa pasta so, apagada no fim. */
async function paridade() {
  const [tsc, tsgo] = await Promise.all([versao(TSC), versao(TSGO)]);
  if (!tsgo) return { erro: 3, tsc, tsgo };
  const ts = require(path.join(CORE, 'node_modules', 'typescript'));
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-tsgo-paridade-')));
  try {
    const copia = path.join(tmp, 'copia');
    fs.mkdirSync(copia);
    copiaComMutantes(copia);
    const emit = (bin, projeto, saida) => rodar(bin, ['-p', projeto, '--outDir', path.join(tmp, saida), '--incremental', 'false',
      '--pretty', 'false'], CORE);
    const checar = (bin, projeto, cwd) => rodar(bin, ['-p', projeto, '--noEmit', '--incremental', 'false', '--pretty', 'false'], cwd);
    // O emit de `dist-test` cobre src e test, entao os diagnosticos dele sao os do typecheck limpo.
    const [tscTest, tscSrc, tscMut, tsgoTest, tsgoSrc, tsgoMut] = await Promise.all([
      emit(TSC, 'tsconfig.test.json', 'tsc/dist-test'), emit(TSC, 'tsconfig.json', 'tsc/dist'), checar(TSC, 'tsconfig.test.json', copia),
      emit(TSGO, 'tsconfig.tsgo.test.json', 'tsgo/dist-test'), emit(TSGO, 'tsconfig.tsgo.json', 'tsgo/dist'),
      checar(TSGO, 'tsconfig.tsgo.test.json', copia),
    ]);
    // O src entra nos dois programas: o mesmo erro aparece duas vezes e conta uma.
    const unicos = (l) => [...new Set(l)];
    const limpo = { tsc: unicos(diagnosticos(tscTest.saida + tscSrc.saida, CORE)), tsgo: unicos(diagnosticos(tsgoTest.saida + tsgoSrc.saida, CORE)),
      msTsc: tscTest.ms, msTsgo: tsgoTest.ms };
    const mutantes = { tsc: diagnosticos(tscMut.saida, copia), tsgo: diagnosticos(tsgoMut.saida, copia) };
    const doMutante = (l) => l.filter((d) => d.startsWith(ARQUIVO_DOS_MUTANTES.split(path.sep).join('/') + ':')).length;
    const typecheck = { limpo, mutantes, acusadosTsc: doMutante(mutantes.tsc), acusadosTsgo: doMutante(mutantes.tsgo) };
    typecheck.paridade = iguais(limpo.tsc, limpo.tsgo) && iguais(mutantes.tsc, mutantes.tsgo) && typecheck.acusadosTsc >= ERROS_DOS_MUTANTES;
    const dist = compararEmit(ts, path.join(tmp, 'tsgo', 'dist'), path.join(tmp, 'tsc', 'dist'));
    const distTest = compararEmit(ts, path.join(tmp, 'tsgo', 'dist-test'), path.join(tmp, 'tsc', 'dist-test'));
    const status = { tsc: [tscSrc.status, tscTest.status], tsgo: [tsgoSrc.status, tsgoTest.status] };
    // Arvore com erro de tipo nao tem emit para comparar como produto: a paridade do emit exige os dois sem erro.
    const emitIgual = [...status.tsc, ...status.tsgo].every((s) => s === 0) && [dist, distTest]
      .every((e) => e.arquivos > 0 && e.diferentes.length === 0 && e.soNoTsgo.length === 0 && e.soNoTsc.length === 0);
    return { contrato: 'ork.tsgo-paridade/v1', tsc, tsgo, typecheck, emit: { status, dist, distTest, paridade: emitIgual },
      paridade: typecheck.paridade && emitIgual };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function resumo(r) {
  const t = r.typecheck, e = r.emit;
  return `tsgo-paridade: tsc ${r.tsc}, tsgo ${r.tsgo}; typecheck ${t.paridade ? 'igual' : 'DIFERENTE'} ` +
    `(limpo ${t.limpo.tsc.length}/${t.limpo.tsgo.length} erros, mutantes ${t.mutantes.tsc.length}/${t.mutantes.tsgo.length}; ` +
    `${t.limpo.msTsc} ms contra ${t.limpo.msTsgo} ms); emit ${e.paridade ? 'igual' : 'DIFERENTE'} token a token ` +
    `(dist ${e.dist.tokensIguais}/${e.dist.arquivos}, dist-test ${e.distTest.tokensIguais}/${e.distTest.arquivos}; ` +
    `bytes iguais ${e.dist.bytesIguais + e.distTest.bytesIguais})\n`;
}

async function principal(args) {
  const r = await paridade();
  if (r.erro === 3) {
    process.stderr.write('tsgo-paridade: o tsgo (@typescript/native-preview) nao esta instalado no core; rode npm --prefix core ci\n');
    return 3;
  }
  const i = args.indexOf('--saida');
  if (i >= 0 && args[i + 1]) fs.writeFileSync(args[i + 1], JSON.stringify(r, null, 1) + '\n');
  process.stdout.write(args.includes('--resumo') ? resumo(r) : JSON.stringify(r, null, 1) + '\n');
  return r.paridade ? 0 : 1;
}

module.exports = { diagnosticos, tokens, compararEmit, MUTANTES, ERROS_DOS_MUTANTES };

if (require.main === module) principal(process.argv.slice(2)).then((c) => process.exit(c));
