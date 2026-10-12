#!/usr/bin/env node
/**
 * RM-059 (T0.5): a guarda estatica dos mods do Orkastery no Claude Code.
 *
 * Mods nao tem sandbox e rodam como o usuario. A regra (D5 do plano dos mods) e que nenhum mod aprova gate,
 * permissao, nota do MASTER, push ou tag pelo dono, nem fala como o dono. A lista do que isso proibe mora
 * num arquivo so, `adapters/claude-code/mods/autoridade.json`, que a guarda em tempo de execucao da ponte
 * tambem le; o casamento e o mesmo, `adapters/claude-code/mods/ork-ponte/hooks/guarda.ts`, transpilado aqui
 * com o TypeScript do `core`. A varredura le o fonte pela AST (comentario nao conta; teste do mod nao entra)
 * e e melhor esforco: argv montado em tempo de execucao escapa dela, e a ponte o pega na hora.
 *
 *   node core/scripts/checar-mods.cjs [--json] [--com-claude] [--autoridade ARQ] [pasta...]
 *
 * Sem pasta, confere cada mod em `adapters/claude-code/mods/`. Por mod: manifesto (nome igual a pasta, sem
 * chave de papel), `orkastery-mod.json` na convencao `ork.mod/v1`, `hooks.json` com modulos que existem,
 * pelo menos um `*.test.ts`, e no fonte: gancho proibido (inclusive por `*` e `classic.*`), `tool.check`
 * com `allow`, `$.prompt.submit`, `$.session.append` com linha de usuario, argv e linha de comando da
 * lista, leitura de `ORK_HITL_*` e de `.hermes/.env`, gancho reservado a ponte, e faixa ou `watchPaths`
 * fora da ponte (D7 do plano dos mods). `--com-claude` tambem roda `claude plugin validate --json --strict`
 * e `claude plugin test` (o sandbox do `ork verify` nao tem o `claude`: D2 da thread ork-rm059ponte).
 * Sai 0 sem achado, 1 com achado e 2 em erro de uso, de lista ou sem o TypeScript do `core`.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '../..');
const PASTA_DOS_MODS = 'adapters/claude-code/mods';
const AUTORIDADE = `${PASTA_DOS_MODS}/autoridade.json`;
const GUARDA = `${PASTA_DOS_MODS}/ork-ponte/hooks/guarda.ts`;
const PONTE = 'ork-ponte';
const FORMATO = 'ork.checar-mods/v1';
const FONTE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
/** Teste do mod (nome `*.test.*` ou pasta `test`, `tests`, `__tests__`): nao carrega na sessao e nao entra. */
const DE_TESTE = /(\.test\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$)|(^|\/)(test|tests|__tests__)\//;
/** Chamadas cujo texto so vai para a tela do dono: o texto delas nao e lido como linha de comando. */
const EXIBICAO = ['ui.toast', 'ui.status', 'ui.notify', 'ui.log', 'ui.notice', 'ork.faixa', 'ork.mostrado'];
/** T0.6: os ganchos da guarda em tempo de execucao que a ponte registra, cada um com `.catch` que fecha. */
const GUARDA_DA_PONTE = ['process.run', 'process.spawn', 'plugin.register', 'prompt.submit', 'session.append', 'env.get', 'fs.read'];
const PAPEIS = ['dono', 'fase'];
const CHAVES_DO_PAPEL = ['formato', 'papeis', 'claudeCodeMinimo'];
const CHAVES_FORA_DO_MANIFESTO = ['formato', 'papeis', 'claudeCodeMinimo', 'orkastery'];
const MINIMO_DO_CLAUDE = [2, 1, 287];
/** D7 do plano dos mods: recursos que nao somam entre mods e por isso so a ponte usa. */
const SO_A_PONTE = {
  faixa: { regra: 'faixa-da-ponte', porque: 'a faixa acima do prompt e uma so; o mod publica a linha por $.ork.faixa' },
  watchPaths: { regra: 'watchpaths-da-ponte', porque: 'os watchPaths se fundem e a ultima escrita vence; o mod pede por $.ork.vigiar' },
};

class ErroDeUso extends Error {}

function typescript(raiz) {
  try {
    return require(require.resolve('typescript', { paths: [path.join(raiz, 'core')] }));
  } catch {
    throw new ErroDeUso('o TypeScript do core nao esta instalado: rode npm --prefix core ci');
  }
}

/** Transpila um modulo TypeScript de mod e o roda num escopo proprio; modulo puro so importa tipos. */
function carregarModuloDoMod(arquivo, raiz = RAIZ) {
  const ts = typescript(raiz);
  const saida = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), {
    fileName: arquivo,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
    },
  });
  const modulo = { exports: {} };
  const exigir = (id) => { throw new Error(`modulo puro do mod nao importa valor: ${id}`); };
  new Function('exports', 'require', 'module', saida.outputText)(modulo.exports, exigir, modulo);
  return modulo.exports;
}

function carregarAutoridade(arquivo, guarda) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { throw new ErroDeUso(`lista de autoridade ausente: ${arquivo}`); }
  try { return guarda.lerAutoridade(texto); } catch (e) { throw new ErroDeUso(`lista de autoridade invalida (${arquivo}): ${e.message}`); }
}

function listarArquivos(dir) {
  const saida = [];
  for (const nome of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, nome);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      // Os tipos que o motor deita em `.claude-plugin/types/` nao sao do mod.
      if (nome === 'node_modules' || (nome === 'types' && path.basename(dir) === '.claude-plugin')) continue;
      saida.push(...listarArquivos(abs));
    } else if (st.isFile()) saida.push(abs);
  }
  return saida;
}

function versaoAoMenos(texto, minimo) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(texto));
  if (!m) return false;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (v[i] !== minimo[i]) return v[i] > minimo[i];
  return true;
}

function lerJson(arquivo) {
  try { return { valor: JSON.parse(fs.readFileSync(arquivo, 'utf8')) }; } catch (e) { return { erro: e.code === 'ENOENT' ? 'ausente' : e.message }; }
}

/** A varredura do fonte de um arquivo do mod, pela AST. */
function varrerFonte(ctx, arquivo, texto, ehPonte) {
  const { ts, guarda, autoridade } = ctx;
  const achados = [];
  const tipo = /\.(tsx|jsx)$/.test(arquivo) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(arquivo) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2022, true, tipo);
  const linha = (no) => fonte.getLineAndCharacterOfPosition(no.getStart(fonte)).line + 1;
  const achar = (no, a) => achados.push({ regra: a.regra, porque: a.porque, arquivo, linha: linha(no) });
  const textoDe = (no) => (no && (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) ? no.text : undefined);
  const nomeDe = (no) => (no.name && (ts.isIdentifier(no.name) || ts.isStringLiteral(no.name)) ? no.name.text : undefined);
  const cadeia = (expr) => {
    const nomes = [];
    let e = expr;
    while (ts.isPropertyAccessExpression(e)) { nomes.unshift(e.name.text); e = e.expression; }
    if (ts.isIdentifier(e)) nomes.unshift(e.text);
    return nomes;
  };
  const temPropriedade = (no, nome, valor) => {
    let achou = false;
    const ver = (n) => {
      if (achou) return;
      if (ts.isPropertyAssignment(n) && nomeDe(n) === nome && textoDe(n.initializer) === valor) achou = true;
      ts.forEachChild(n, ver);
    };
    ver(no);
    return achou;
  };
  const valoresDe = (no) => {
    const t = textoDe(no);
    if (t !== undefined) return [t];
    return no && ts.isArrayLiteralExpression(no) ? no.elements.map(textoDe).filter((x) => x !== undefined) : [];
  };
  const ganchos = [];
  const decisoes = [];
  const comCatch = [];
  const visitar = (no, exibicao) => {
    if (ts.isCallExpression(no)) {
      if (ts.isIdentifier(no.expression) && no.expression.text === 'on' && no.arguments.length >= 2) {
        const evento = textoDe(no.arguments[0]);
        if (evento !== undefined) {
          const matcher = no.arguments.length >= 3 && ts.isObjectLiteralExpression(no.arguments[1]) ? no.arguments[1] : undefined;
          ganchos.push({ evento, matcher, no });
          // `on(...).catch(handler)`: a registracao tem quem responda no lugar do gancho que falha.
          const acima = no.parent;
          if (acima && ts.isPropertyAccessExpression(acima) && acima.name.text === 'catch' && acima.parent && ts.isCallExpression(acima.parent)
            && acima.parent.arguments.length === 1) comCatch.push(evento);
        }
      }
      const final = cadeia(no.expression).slice(-2).join('.');
      for (const c of autoridade.chamadasProibidas) {
        if (final !== c.chamada) continue;
        if (c.tipo === undefined || no.arguments.some((arg) => temPropriedade(arg, 'type', c.tipo))) achar(no, { regra: c.id, porque: c.porque });
      }
      if (final === 'env.get') {
        const a = guarda.avaliarAmbiente(autoridade, textoDe(no.arguments[0]));
        if (a) achar(no, a);
      }
    }
    // Texto que so vai para a tela do dono (toast, status, faixa) nao e linha de comando; array continua conferido.
    // Caminho e variavel da lista contam em qualquer literal; leitura como linha de comando, so com mais de uma
    // palavra (palavra solta como `'env'` ou `'set'` e codigo, nao comando).
    if ((ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) && !exibicao) {
      const a = guarda.avaliarCitacao(autoridade, no.text) ?? (/\s/.test(no.text.trim()) ? guarda.avaliarTexto(autoridade, no.text) : null);
      if (a) achar(no, a);
    }
    if (ts.isTemplateExpression(no) && !exibicao) {
      const montado = no.head.text + no.templateSpans.map((s) => ` X ${s.literal.text}`).join('');
      const a = guarda.avaliarTexto(autoridade, montado);
      if (a) achar(no, a);
    }
    if (ts.isArrayLiteralExpression(no) && no.elements.length > 0 && no.elements.every((el) => textoDe(el) !== undefined)) {
      const a = guarda.avaliarArgv(autoridade, no.elements.map(textoDe));
      if (a) achar(no, a);
    }
    if ((ts.isPropertyAssignment(no) || ts.isShorthandPropertyAssignment(no) || ts.isPropertyAccessExpression(no)) && !ehPonte) {
      const nome = ts.isPropertyAccessExpression(no) ? no.name.text : nomeDe(no);
      if (nome === 'watchPaths') achar(no, SO_A_PONTE.watchPaths);
    }
    if (ts.isPropertyAssignment(no) && nomeDe(no) !== undefined) decisoes.push(no);
    if (ts.isCallExpression(no)) {
      // Os argumentos de uma chamada de exibicao sao texto de tela; qualquer outra chamada volta a ser conferida.
      const deExibicao = EXIBICAO.includes(cadeia(no.expression).slice(-2).join('.'));
      visitar(no.expression, false);
      for (const arg of no.arguments) visitar(arg, deExibicao);
      return;
    }
    ts.forEachChild(no, (filho) => visitar(filho, exibicao));
  };
  visitar(fonte, false);
  for (const g of ganchos) {
    const a = guarda.avaliarEventos(autoridade, [g.evento], ehPonte);
    if (a) achar(g.no, a);
    const componentes = g.matcher
      ? g.matcher.properties.filter((p) => ts.isPropertyAssignment(p) && nomeDe(p) === 'component').flatMap((p) => valoresDe(p.initializer))
      : [];
    for (const proibido of autoridade.ganchosProibidos) {
      if (proibido.componente !== undefined && guarda.sobrepoe(g.evento, proibido.evento) && componentes.includes(proibido.componente)) {
        achar(g.no, { regra: proibido.id, porque: proibido.porque });
      }
    }
    if (!ehPonte && guarda.sobrepoe(g.evento, 'ui.render') && componentes.includes('AbovePrompt')) achar(g.no, SO_A_PONTE.faixa);
  }
  for (const d of autoridade.decisoesProibidas) {
    if (!ganchos.some((g) => guarda.sobrepoe(g.evento, d.evento))) continue;
    for (const no of decisoes) if (nomeDe(no) === 'decision' && textoDe(no.initializer) === d.decisao) achar(no, { regra: d.id, porque: d.porque });
  }
  return { achados, comCatch };
}

function rodarClaude(args, opcoes) {
  return spawnSync('claude', args, { encoding: 'utf8', timeout: 300000, ...opcoes });
}

/** `claude plugin validate --json --strict` e `claude plugin test`, so com `--com-claude` (no host). */
function conferirComClaude(ctx, dir, rel) {
  const achados = [];
  const v = rodarClaude(['plugin', 'validate', '--json', '--strict', dir]);
  let relatorio = null;
  try { relatorio = JSON.parse(v.stdout); } catch { /* tratado abaixo */ }
  if (!relatorio || relatorio.success !== true) {
    const motivo = relatorio ? [...(relatorio.manifest?.errors ?? []), ...(relatorio.manifest?.warnings ?? [])].map((e) => e.message).join('; ') : (v.stderr || '').trim();
    achados.push({ regra: 'claude-validate', porque: `claude plugin validate --strict reprovou: ${motivo.slice(0, 300) || `saiu ${v.status}`}`, arquivo: rel, linha: 0 });
  }
  for (const nota of (relatorio?.contents ?? []).flatMap((c) => c.notes ?? [])) {
    const ganchos = /hooks: (.+)$/.exec(nota);
    if (ganchos) {
      const eventos = ganchos[1].split(', ').map((h) => h.replace(/\{.*\}$/, '').trim());
      const a = ctx.guarda.avaliarEventos(ctx.autoridade, eventos, path.basename(dir) === PONTE);
      if (a) achados.push({ ...a, arquivo: rel, linha: 0 });
    }
    const leituras = /env reads: (.+)$/.exec(nota);
    if (leituras && leituras[1] !== 'nothing') {
      for (const nome of leituras[1].split(', ')) {
        const a = ctx.guarda.avaliarAmbiente(ctx.autoridade, nome.trim());
        if (a) achados.push({ ...a, arquivo: rel, linha: 0 });
      }
    }
  }
  const t = rodarClaude(['plugin', 'test', dir]);
  if (t.status !== 0) achados.push({ regra: 'claude-test', porque: `claude plugin test saiu ${t.status}`, arquivo: rel, linha: 0 });
  return achados;
}

/** Confere um mod (a pasta que tem `.claude-plugin/plugin.json`). */
function checarMod(ctx, dir) {
  const rel = path.relative(ctx.raiz, dir) || dir;
  const nome = path.basename(dir);
  const ehPonte = nome === PONTE;
  const achados = [];
  const achar = (regra, porque, arquivo = rel) => achados.push({ regra, porque, arquivo, linha: 0 });

  const manifesto = lerJson(path.join(dir, '.claude-plugin/plugin.json'));
  if (manifesto.erro) achar('manifesto', `manifesto .claude-plugin/plugin.json ${manifesto.erro}`);
  else {
    if (manifesto.valor.name !== nome) achar('manifesto-nome', `o nome do manifesto (${manifesto.valor.name}) e diferente da pasta (${nome})`);
    for (const chave of CHAVES_FORA_DO_MANIFESTO) {
      if (chave in manifesto.valor) achar('manifesto-chave', `${chave} nao vai no plugin.json: o papel mora no orkastery-mod.json`);
    }
  }

  const papel = lerJson(path.join(dir, 'orkastery-mod.json'));
  if (papel.erro) achar('papel', `orkastery-mod.json ${papel.erro}`);
  else {
    const p = papel.valor;
    const extras = Object.keys(p).filter((k) => !CHAVES_DO_PAPEL.includes(k));
    if (extras.length) achar('papel-chave', `orkastery-mod.json com chave fora da convencao: ${extras.join(', ')}`);
    if (p.formato !== 'ork.mod/v1') achar('papel-formato', `orkastery-mod.json com formato ${String(p.formato)}; o esperado e ork.mod/v1`);
    if (!Array.isArray(p.papeis) || p.papeis.length === 0 || p.papeis.some((x) => !PAPEIS.includes(x)) || new Set(p.papeis).size !== p.papeis.length) {
      achar('papel-papeis', 'papeis precisa ser uma lista sem repeticao de dono e fase');
    }
    if (!versaoAoMenos(p.claudeCodeMinimo, MINIMO_DO_CLAUDE)) achar('papel-minimo', `claudeCodeMinimo precisa ser semver de ${MINIMO_DO_CLAUDE.join('.')} para cima`);
  }

  const ganchos = lerJson(path.join(dir, 'hooks/hooks.json'));
  if (ganchos.erro) achar('hooks', `hooks/hooks.json ${ganchos.erro}`);
  else {
    const modulos = Array.isArray(ganchos.valor.modules) ? ganchos.valor.modules : [];
    if (modulos.length === 0) achar('hooks', 'hooks/hooks.json sem modules');
    for (const m of modulos) if (!fs.existsSync(path.join(dir, 'hooks', m))) achar('hooks', `modulo ausente: hooks/${m}`);
  }

  const arquivos = listarArquivos(dir);
  if (!arquivos.some((a) => /\.test\.tsx?$/.test(a))) achar('sem-teste', 'o mod precisa de pelo menos um *.test.ts para o claude plugin test');
  const comCatch = new Set();
  for (const arquivo of arquivos.filter((a) => FONTE.test(a) && !DE_TESTE.test(path.relative(dir, a)))) {
    const r = varrerFonte(ctx, path.relative(ctx.raiz, arquivo) || arquivo, fs.readFileSync(arquivo, 'utf8'), ehPonte);
    achados.push(...r.achados);
    for (const evento of r.comCatch) comCatch.add(evento);
  }
  if (ehPonte) {
    const faltam = GUARDA_DA_PONTE.filter((evento) => !comCatch.has(evento));
    if (faltam.length) achar('ponte-guarda', `a ponte precisa registrar com .catch os ganchos da guarda: ${faltam.join(', ')}`);
  }
  if (ctx.comClaude) achados.push(...conferirComClaude(ctx, dir, rel));
  return { mod: nome, pasta: rel, ok: achados.length === 0, achados };
}

function pastasDosMods(raiz) {
  const base = path.join(raiz, PASTA_DOS_MODS);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).sort().map((n) => path.join(base, n))
    .filter((d) => fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, '.claude-plugin/plugin.json')));
}

/** A conferencia inteira: carrega o casamento e a lista e confere cada pasta. */
function checarMods({ raiz = RAIZ, pastas, autoridade: arquivoDaAutoridade, comClaude = false } = {}) {
  const ts = typescript(raiz);
  const guarda = carregarModuloDoMod(path.join(raiz, GUARDA), raiz);
  const autoridade = carregarAutoridade(arquivoDaAutoridade ?? path.join(raiz, AUTORIDADE), guarda);
  const alvos = pastas && pastas.length ? pastas.map((p) => path.resolve(p)) : pastasDosMods(raiz);
  for (const p of alvos) {
    if (!fs.existsSync(path.join(p, '.claude-plugin/plugin.json'))) throw new ErroDeUso(`nao e pasta de mod (sem .claude-plugin/plugin.json): ${p}`);
  }
  if (comClaude && spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30000 }).status !== 0) {
    throw new ErroDeUso('--com-claude exige o claude no PATH');
  }
  const ctx = { raiz, ts, guarda, autoridade, comClaude };
  const mods = alvos.map((d) => checarMod(ctx, d));
  return { formato: FORMATO, ok: mods.every((m) => m.ok), mods };
}

function lerArgs(argv) {
  const o = { json: false, comClaude: false, autoridade: undefined, pastas: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--com-claude') o.comClaude = true;
    else if (a === '--autoridade') {
      if (argv[i + 1] === undefined) throw new ErroDeUso('--autoridade exige arquivo');
      o.autoridade = path.resolve(argv[++i]);
    } else if (a.startsWith('--')) throw new ErroDeUso(`opcao desconhecida: ${a}`);
    else o.pastas.push(a);
  }
  return o;
}

function main(argv) {
  let resultado;
  let o;
  try {
    o = lerArgs(argv);
    resultado = checarMods({ pastas: o.pastas, autoridade: o.autoridade, comClaude: o.comClaude });
  } catch (e) {
    if (!(e instanceof ErroDeUso)) throw e;
    console.error(`checar-mods: ${e.message}`);
    console.error('uso: node core/scripts/checar-mods.cjs [--json] [--com-claude] [--autoridade ARQ] [pasta...]');
    return 2;
  }
  if (o.json) console.log(JSON.stringify(resultado, null, 2));
  else {
    if (resultado.mods.length === 0) console.log('checar-mods: nenhum mod em adapters/claude-code/mods');
    for (const m of resultado.mods) {
      console.log(`${m.ok ? 'ok' : 'REPROVADO'} ${m.mod} (${m.pasta})`);
      for (const a of m.achados) console.log(`  ${a.arquivo}${a.linha ? `:${a.linha}` : ''} ${a.regra}: ${a.porque}`);
    }
  }
  return resultado.ok ? 0 : 1;
}

module.exports = { checarMods, checarMod, varrerFonte, carregarModuloDoMod, versaoAoMenos, ErroDeUso, FORMATO };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
