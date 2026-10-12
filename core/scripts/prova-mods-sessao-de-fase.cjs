#!/usr/bin/env node
/**
 * RM-059 (T0.1): a prova de que um mod carrega numa sessao de fase (`claude --bg`).
 *
 * O plano dos mods so deixa os mods de papel `fase` (Freio, Portao, Clima, Mensageiro) comecarem depois
 * desta resposta. O script grava o mod de sonda `ork-sonda-fase` numa pasta nova, confere se o `claude`
 * existe no PATH minimo do sandbox do `ork verify` e, fora do ensaio, abre uma sessao `claude --bg` com
 * a sonda por `--plugin-dir`, uma marca no env por `--settings` e `--allowedTools` so para `true`. A
 * sonda grava em `registro.jsonl` o que viu: `session.start`, `classic.SessionStart` e
 * `classic.PostToolBatch`, a marca lida por `$.env.get`, as ferramentas `Task*` de `$.tool.list()` e o
 * `permission_mode`. O script espera o registro, para a sessao com `claude stop` e imprime as quatro
 * respostas e o veredito sugerido, que a condutora copia para
 * `docs/roadmap/evidencias/mods-sessao-de-fase.md`.
 *
 *   node core/scripts/prova-mods-sessao-de-fase.cjs [--ensaio] [--cwd DIR] [--saida DIR] [--prazo S] [--json]
 *
 * `--ensaio` grava a sonda e imprime o comando sem abrir sessao nem chamar o `claude`. `--cwd` e onde a
 * sessao roda: um repositorio que o Claude Code ja confia, ou uma worktree dele. Nada de credencial e
 * lido ou gravado aqui; a sessao herda o login de quem roda o script. O env da sessao perde
 * `ORK_DISPATCH_*`, `ORK_CANAL` e `ORK_HITL_*`, para a sonda nunca escrever no ledger de uma thread.
 * Sai 0 com o resumo, 1 quando a sessao nao registrou nada no prazo e 2 em erro de uso ou sem `claude`.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');

/** O PATH do sandbox do `ork verify` (core/src/verify-sandbox.ts). */
const PATH_DO_SANDBOX = '/usr/local/bin:/usr/bin:/bin';
const NOME_DA_SONDA = 'ork-sonda-fase';
const REGISTRO = 'registro.jsonl';
const PRAZO_PADRAO_S = 180;
const FORMATO = 'ork.prova-mods-sessao-de-fase/v1';
/** Prefixos e nomes que nao vao para a sessao da sonda: identidade de despacho e ingresso humano. */
const SEM_ESTES = [/^ORK_DISPATCH_/, /^ORK_CANAL$/, /^ORK_HITL_/];
const PROMPT = 'Sonda de mod do Orkastery (RM-059, T0.1): rode o comando true com a ferramenta Bash ' +
  'duas vezes, em chamadas paralelas no mesmo turno, e responda apenas OK.';

/** O modulo da sonda: cada gancho acrescenta uma linha JSON ao registro ao lado da pasta da sonda. */
const MODULO_DA_SONDA = [
  "import type { Register } from 'claude-code'",
  '',
  '// Sonda da RM-059 (T0.1): registra o que esta sessao entrega a um mod. So le e anexa ao registro.',
  "const REGISTRO = '" + REGISTRO + "'",
  '',
  'export const register: Register = on => {',
  "  on('session.start', async ($, e, next) => {",
  "    const marca = await $.env.get('ORK_SONDA_MARCA')",
  "    const despacho = await $.env.get('ORK_DISPATCH_ID')",
  '    const ferramentas = (await $.tool.list()).map(t => t.name)',
  '    const versao = await $.session.version()',
  "    const arquivo = $.plugin.root + '/../' + REGISTRO",
  "    const antes = await $.fs.read(arquivo).catch(() => '')",
  "    const linha = { evento: 'session.start', marca: marca ?? null, comDespacho: despacho !== undefined,",
  "      task: ferramentas.filter(n => n.startsWith('Task')), versao: versao.version, interativa: e.isInteractive }",
  "    await $.fs.write(arquivo, String(antes) + JSON.stringify(linha) + '\\n')",
  '    return next(e)',
  '  })',
  "  on('classic.SessionStart', async ($, e, next) => {",
  "    const arquivo = $.plugin.root + '/../' + REGISTRO",
  "    const antes = await $.fs.read(arquivo).catch(() => '')",
  "    const linha = { evento: 'classic.SessionStart', origem: e.source, permissao: e.permission_mode ?? null }",
  "    await $.fs.write(arquivo, String(antes) + JSON.stringify(linha) + '\\n')",
  '    return next(e)',
  '  })',
  "  on('classic.PostToolBatch', async ($, e, next) => {",
  "    const arquivo = $.plugin.root + '/../' + REGISTRO",
  "    const antes = await $.fs.read(arquivo).catch(() => '')",
  "    const linha = { evento: 'classic.PostToolBatch', chamadas: e.tool_calls.length,",
  "      ferramentas: e.tool_calls.map(c => c.tool_name), permissao: e.permission_mode ?? null }",
  "    await $.fs.write(arquivo, String(antes) + JSON.stringify(linha) + '\\n')",
  '    return next(e)',
  '  })',
  '}',
  '',
].join('\n');

/** O teste do kit da sonda, para `claude plugin test` conferir a propria sonda antes da sessao. */
const TESTE_DA_SONDA = [
  "import { test, expect, mock } from 'claude-code/testing'",
  '',
  "test('a sonda anexa uma linha por evento classico', async ($, on) => {",
  "  let gravado = ''",
  "  on('fs.read', () => ({ value: gravado }))",
  "  on('fs.write', ($2, e) => { gravado = e.text; return { value: undefined } })",
  "  mock.env(on, { ORK_SONDA_MARCA: 'm1' })",
  "  on('classic.SessionStart', () => ({}))",
  "  on('classic.PostToolBatch', () => ({}))",
  "  await $.classic.SessionStart({ source: 'startup' })",
  "  await $.classic.PostToolBatch({ tool_calls: [{ tool_name: 'Bash', tool_input: {}, tool_use_id: 't1' }] })",
  "  const linhas = gravado.trim().split('\\n').map(l => JSON.parse(l))",
  "  expect(linhas.map(l => l.evento)).toEqual(['classic.SessionStart', 'classic.PostToolBatch'])",
  '  expect(linhas[1].chamadas).toBe(1)',
  '})',
  '',
].join('\n');

function uso(msg) {
  if (msg) console.error(msg);
  console.error('uso: node core/scripts/prova-mods-sessao-de-fase.cjs [--ensaio] [--cwd DIR] [--saida DIR] [--prazo S] [--json]');
  return 2;
}

function lerArgs(argv) {
  const o = { ensaio: false, json: false, cwd: process.cwd(), saida: null, prazo: PRAZO_PADRAO_S };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ensaio') o.ensaio = true;
    else if (a === '--json') o.json = true;
    else if (a === '--cwd' || a === '--saida' || a === '--prazo') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} exige valor`);
      if (a === '--prazo') {
        if (!/^\d+$/.test(v) || Number(v) < 10 || Number(v) > 1800) throw new Error('--prazo: segundos entre 10 e 1800');
        o.prazo = Number(v);
      } else o[a.slice(2)] = path.resolve(v);
    } else throw new Error(`opcao desconhecida: ${a}`);
  }
  return o;
}

/** Grava a sonda em `<dir>/ork-sonda-fase` e devolve a pasta do plugin. */
function gravarSonda(dir) {
  const raiz = path.join(dir, NOME_DA_SONDA);
  const arquivos = {
    '.claude-plugin/plugin.json': JSON.stringify({
      name: NOME_DA_SONDA, version: '0.1.0', author: { name: 'Orkastery' },
      description: 'Sonda da RM-059: o que uma sessao de fase entrega a um mod',
    }, null, 2) + '\n',
    'hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }, null, 2) + '\n',
    'hooks/register.ts': MODULO_DA_SONDA,
    'test/sonda.test.ts': TESTE_DA_SONDA,
  };
  for (const [rel, texto] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true });
    fs.writeFileSync(path.join(raiz, rel), texto);
  }
  return raiz;
}

/** O argv exato do `claude --bg` da prova. */
function montarComando({ sonda, marca, nome }) {
  // --strict-mcp-config como no despacho de fase: sem ele a sessao para na tela de aprovacao do MCP do projeto.
  return ['claude', '--bg', PROMPT, '--name', nome, '--plugin-dir', sonda, '--strict-mcp-config',
    '--settings', JSON.stringify({ env: { ORK_SONDA_MARCA: marca } }), '--allowedTools', 'Bash(true)'];
}

/** O env da sessao: sem identidade de despacho nem ingresso humano, com a marca velha no ambiente. */
function ambienteDaSessao(base, marcaVelha) {
  const env = {};
  const removidas = [];
  for (const [k, v] of Object.entries(base)) {
    if (SEM_ESTES.some((re) => re.test(k))) removidas.push(k);
    else env[k] = v;
  }
  env.ORK_SONDA_MARCA = marcaVelha;
  return { env, removidas: removidas.sort() };
}

/** Onde o `claude` esta no PATH do sandbox do verify, ou null (pergunta 4). */
function claudeNoPathDoSandbox(home) {
  const r = spawnSync('/bin/sh', ['-c', 'command -v claude'], {
    env: { PATH: PATH_DO_SANDBOX, HOME: home }, encoding: 'utf8', timeout: 10000,
  });
  const achado = (r.stdout || '').trim();
  return r.status === 0 && achado ? achado : null;
}

function lerRegistro(arquivo) {
  if (!fs.existsSync(arquivo)) return [];
  return fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

/** As quatro respostas e o veredito sugerido, a partir do registro da sonda. */
function resumir(registros, { marca, marcaVelha, claudeNoSandbox }) {
  const de = (ev) => registros.filter((r) => r && r.evento === ev);
  const inicio = de('session.start');
  const lote = de('classic.PostToolBatch');
  const classico = de('classic.SessionStart');
  const marcaLida = inicio.length ? inicio[0].marca : null;
  const task = [...new Set(inicio.flatMap((r) => Array.isArray(r.task) ? r.task : []))].sort();
  const permissoes = [...new Set([...classico, ...lote].map((r) => r.permissao).filter(Boolean))].sort();
  const carregou = { sessionStart: inicio.length > 0, classicSessionStart: classico.length > 0, postToolBatch: lote.length > 0 };
  let veredito = 'inconclusivo: a sonda nao registrou nada; confira login, confianca do diretorio e o debug log';
  if (carregou.sessionStart && carregou.postToolBatch) veredito = 'mod carrega em sessao --bg e recebe classic.PostToolBatch';
  else if (carregou.sessionStart) veredito = 'mod carrega em sessao --bg, mas classic.PostToolBatch nao chegou: plano B do Freio (T2.4)';
  else if (registros.length) veredito = 'registro parcial: sem session.start; plano B do Freio (T2.4)';
  return {
    formato: FORMATO,
    carregou,
    p1Env: { marcaLida, esperada: marca, ok: marcaLida === marca, leuMarcaVelha: marcaLida === marcaVelha },
    p2Task: { ferramentas: task, ok: task.includes('TaskCreate') },
    p3Permissao: { modos: permissoes },
    p4Sandbox: { claudeNoPath: claudeNoSandbox, ok: claudeNoSandbox !== null },
    vereditoSugerido: veredito,
  };
}

function idDaSessao(saida) {
  const uuid = saida.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const curto = saida.match(/\b[0-9a-f]{8}\b/i);
  return curto ? curto[0] : null;
}

function esperar(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function imprimir(o, resultado) {
  if (o.json) { console.log(JSON.stringify(resultado, null, 2)); return; }
  const linhas = [`Prova de mod em sessao de fase (${FORMATO})`, `sonda: ${resultado.sonda}`];
  if (resultado.ensaio) {
    linhas.push('ensaio: nada foi aberto; o comando seria', `  ${resultado.comando.map((a) => JSON.stringify(a)).join(' ')}`);
    linhas.push(`variaveis removidas do env da sessao: ${resultado.removidas.join(', ') || 'nenhuma'}`);
    linhas.push(`P4: claude no PATH do sandbox do verify: ${resultado.p4Sandbox.claudeNoPath ?? 'nao'}`);
  } else {
    const r = resultado.resumo;
    linhas.push(`carregou: session.start=${r.carregou.sessionStart} classic.SessionStart=${r.carregou.classicSessionStart} classic.PostToolBatch=${r.carregou.postToolBatch}`);
    linhas.push(`P1 env do --settings lido por $.env.get: ${r.p1Env.ok} (lido ${JSON.stringify(r.p1Env.marcaLida)})`);
    linhas.push(`P2 ferramentas Task: ${r.p2Task.ferramentas.join(', ') || 'nenhuma'}`);
    linhas.push(`P3 modo de permissao: ${r.p3Permissao.modos.join(', ') || 'nao registrado'}`);
    linhas.push(`P4 claude no PATH do sandbox do verify: ${r.p4Sandbox.claudeNoPath ?? 'nao'}`);
    linhas.push(`Veredito sugerido: ${r.vereditoSugerido}`);
  }
  console.log(linhas.join('\n'));
}

function main(argv) {
  let o;
  try { o = lerArgs(argv); } catch (e) { return uso(e.message); }
  const saida = o.saida ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-mods-'));
  fs.mkdirSync(saida, { recursive: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-home-'));
  const sonda = gravarSonda(saida);
  const marca = randomUUID();
  const marcaVelha = `velha-${randomUUID()}`;
  const nome = `${NOME_DA_SONDA}-${marca.slice(0, 8)}`;
  const comando = montarComando({ sonda, marca, nome });
  const { env, removidas } = ambienteDaSessao(process.env, marcaVelha);
  const claudeNoSandbox = claudeNoPathDoSandbox(home);
  fs.rmdirSync(home, { recursive: false });
  if (o.ensaio) {
    imprimir(o, { formato: FORMATO, ensaio: true, sonda, comando, removidas, p4Sandbox: { claudeNoPath: claudeNoSandbox } });
    return 0;
  }
  if (spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30000 }).status !== 0) {
    console.error('claude nao encontrado no PATH de quem roda a prova');
    return 2;
  }
  const aberto = spawnSync(comando[0], comando.slice(1), { cwd: o.cwd, env, encoding: 'utf8', timeout: 120000 });
  const id = idDaSessao(`${aberto.stdout || ''}\n${aberto.stderr || ''}`);
  const registro = path.join(saida, REGISTRO);
  const limite = Date.now() + o.prazo * 1000;
  while (Date.now() < limite && !lerRegistro(registro).some((r) => r.evento === 'classic.PostToolBatch')) esperar(2000);
  if (id) spawnSync('claude', ['stop', id], { cwd: o.cwd, env, encoding: 'utf8', timeout: 60000 });
  const registros = lerRegistro(registro);
  const resumo = resumir(registros, { marca, marcaVelha, claudeNoSandbox });
  imprimir(o, { formato: FORMATO, ensaio: false, sonda, sessao: id, abriu: aberto.status, resumo });
  return registros.length ? 0 : 1;
}

module.exports = { gravarSonda, montarComando, ambienteDaSessao, claudeNoPathDoSandbox, resumir, idDaSessao, lerArgs,
  PATH_DO_SANDBOX, FORMATO };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
