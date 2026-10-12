#!/usr/bin/env node
/**
 * RM-059 (fatia F8): a prova de que o dialogo nativo do Claude Code abre quando quem pede a nota do MASTER e o Ritual
 * (`ork-ritual`, pelo `$.mcp.call` da ferramenta `ork_request_master_note`).
 *
 * O botao "Dar a nota" chama a ferramenta so com o `threadId`; o nucleo pede ao host um formulario (elicitation) com a
 * nota de 0 a 5 e o porque, e grava o MASTER com `avaliadoPor` `mcp-local:claude-code` e o recibo assinado do ingresso
 * local. Os tipos do Claude Code dizem que a chamada do plugin e a concessao, e nao dizem se a elicitation dela chega ao
 * dialogo: isso so se prova numa sessao interativa do dono, e a sessao de fase nao abre uma. Este roteiro deixa a prova
 * pronta:
 *
 *   node core/scripts/prova-ritual-nota-nativa.cjs --preparar [--saida DIR] [--json]
 *     cria, numa pasta temporaria nova fora do repositorio e de qualquer projeto, uma copia minima do estado (git,
 *     `orkastery.yaml` do `init` do nucleo e uma thread sintetica em #Auto, entregue e aceita por omissao, como o
 *     condutor faz depois do SHIP). Grava o `mcp-prova.json` com so o servidor `orkastery` dessa copia e imprime o comando
 *     da sessao interativa com a ponte e o Ritual por `--plugin-dir`.
 *   node core/scripts/prova-ritual-nota-nativa.cjs --conferir DIR [--json]
 *     le o ledger da copia e diz o que aconteceu: o `master_done` com `autorizadoPor` `mcp-local:claude-code` e o recibo
 *     conferido (o dialogo abriu e gravou), so o pedido de nota (o dialogo foi pedido e fechou sem nota) ou nada; imprime
 *     a linha de veredito para `docs/roadmap/evidencias/mods-nota-nativa.md`.
 *   node core/scripts/prova-ritual-nota-nativa.cjs --ensaio [--json]
 *     prepara, confere (sem resposta, o veredito fica pendente) e apaga a copia; nao abre sessao nem chama o `claude`.
 *
 * O roteiro nunca le nem grava o `.orkastery/` do projeto e nunca da nota nenhuma: quem da a nota e o dono, no dialogo.
 * Usa o `core/dist` (rode `npm --prefix core run build` antes). O processo tira do proprio ambiente a identidade de
 * despacho e o projeto fixado, para o ledger da copia nao herdar a sessao de quem roda, e desliga a publicacao em
 * segundo plano que o MASTER dispara (fabrica e rede da pessoa): no proprio processo, no servidor MCP da copia e na
 * sessao do dono, a copia nunca e publicada. Sai 0 com o resumo e 2 em erro de uso ou sem o `core/dist`.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '../..');
const DIST = path.join(RAIZ, 'core/dist');
const FORMATO = 'ork.prova-ritual-nota-nativa/v1';
const ARQUIVO_DA_PROVA = 'prova-nota.json';
const ARQUIVO_DO_MCP = 'mcp-prova.json';
const PONTE = path.join(RAIZ, 'adapters/claude-code/mods/ork-ponte');
const RITUAL = path.join(RAIZ, 'adapters/claude-code/mods/ork-ritual');
const PENDENTE = 'Veredito: pendente do dono';
const IDENTIDADE = 'mcp-local:claude-code';
/** O que nao entra no ambiente do roteiro nem no da sessao do dono: despacho de fase e projeto fixado. */
const SEM_ESTES = ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO'];
/** O MASTER publica em segundo plano a fabrica e a rede da pessoa; a copia de prova nunca. */
const SEM_PUBLICAR = { ORK_FABRICA_PUBLICAR: '0', ORK_REDE_PUBLICAR: '0' };

class ErroDeUso extends Error {}

function doNucleo(modulo) {
  const arquivo = path.join(DIST, `${modulo}.js`);
  if (!fs.existsSync(arquivo)) throw new ErroDeUso(`falta ${path.relative(RAIZ, arquivo)}: rode npm --prefix core run build`);
  return require(arquivo);
}

function semIdentidadeDeDespacho() {
  for (const nome of SEM_ESTES) delete process.env[nome];
  Object.assign(process.env, SEM_PUBLICAR);
}

/**
 * A copia fica fora do repositorio e fora de qualquer projeto do Orkastery (nenhuma pasta acima tem `orkastery.yaml`).
 * Confere o caminho pedido ANTES de criar qualquer coisa: a parte que ja existe pelo caminho real, o resto como pedido.
 */
function exigirForaDeProjeto(alvo) {
  let existente = path.resolve(alvo);
  const resto = [];
  while (!fs.existsSync(existente)) {
    resto.unshift(path.basename(existente));
    existente = path.dirname(existente);
  }
  const base = fs.realpathSync(existente);
  const real = path.join(base, ...resto);
  const raiz = fs.realpathSync(RAIZ);
  if (real === raiz || real.startsWith(raiz + path.sep)) throw new ErroDeUso(`a copia precisa ficar fora do repositorio: ${real}`);
  for (let d = base; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'orkastery.yaml'))) throw new ErroDeUso(`a copia precisa ficar fora de um projeto do Orkastery: ${d}`);
    if (path.dirname(d) === d) break;
  }
  return real;
}

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.name=prova da nota', '-c', 'user.email=prova@exemplo.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`git ${args[0]} saiu ${r.status}: ${(r.stderr || '').trim().slice(0, 200)}`);
  return (r.stdout || '').trim();
}

/**
 * O comando da sessao interativa do dono na copia: a ponte e o Ritual por `--plugin-dir`, so o servidor da copia, sem a
 * identidade de despacho e sem a publicacao em segundo plano.
 */
function montarComando(dir) {
  const argv = ['claude', '--plugin-dir', PONTE, '--plugin-dir', RITUAL, '--strict-mcp-config', '--mcp-config', path.join(dir, ARQUIVO_DO_MCP)];
  const definir = Object.entries(SEM_PUBLICAR).map(([n, v]) => `${n}=${v}`).join(' ');
  const linha = `cd ${dir} && env ${SEM_ESTES.map((n) => `-u ${n}`).join(' ')} ${definir} ${argv.join(' ')}`;
  return { argv, sem: [...SEM_ESTES], env: { ...SEM_PUBLICAR }, linha };
}

/** Prepara a copia minima do estado com uma entrega aceita por omissao, como o condutor deixa depois do SHIP. */
function prepararCopia(opcoes = {}) {
  semIdentidadeDeDespacho();
  const { init } = doNucleo('init');
  const { exigirManifesto } = doNucleo('manifest');
  const { novaThread, dirThread } = doNucleo('thread');
  const { registrar, TIPOS_DE_EVENTO } = doNucleo('ledger');
  const { aceitarPorOmissao } = doNucleo('master');
  const base = exigirForaDeProjeto(opcoes.saida ? path.resolve(opcoes.saida) : os.tmpdir());
  fs.mkdirSync(base, { recursive: true });
  const dir = exigirForaDeProjeto(fs.mkdtempSync(path.join(base, 'ork-prova-nota-')));
  git(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# copia de prova da nota pelo dialogo nativo\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'inicial']);
  const merge = git(dir, ['rev-parse', 'HEAD']);
  init(dir, { nome: 'prova-nota', abbrev: 'prn' });
  const carregado = exigirManifesto(dir);
  const { thread } = novaThread(carregado, { nome: 'prova da nota nativa', modo: 'auto' });
  registrar(dirThread(dir, thread.id), thread.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: thread.base?.branch ?? 'main', para: 'main',
    mergeSha: merge, pushVerificado: false });
  aceitarPorOmissao(dir, thread.id);
  const servidor = { mcpServers: { orkastery: { command: process.execPath,
    args: [path.join(DIST, 'index.js'), 'mcp', 'serve', '--project', dir, '--host', 'claude-code'], env: { ...SEM_PUBLICAR } } } };
  fs.writeFileSync(path.join(dir, ARQUIVO_DO_MCP), JSON.stringify(servidor, null, 2) + '\n');
  const prova = { formato: FORMATO, raiz: dir, thread: thread.id };
  fs.writeFileSync(path.join(dir, ARQUIVO_DA_PROVA), JSON.stringify(prova, null, 2) + '\n');
  return { ...prova, comando: montarComando(dir) };
}

/**
 * O que o ledger da copia diz da nota. So o `master_done` gravado pelo ingresso local do Claude Code, com o recibo
 * conferido, prova o dialogo; o pedido de nota sem esse `master_done` diz que o dialogo foi pedido e fechou sem nota.
 */
function conferirCopia(dir) {
  semIdentidadeDeDespacho();
  const { lerLedger, TIPOS_DE_EVENTO } = doNucleo('ledger');
  const { dirThread } = doNucleo('thread');
  const { masterRatificado } = doNucleo('master');
  const arquivo = path.join(dir, ARQUIVO_DA_PROVA);
  if (!fs.existsSync(arquivo)) throw new ErroDeUso(`nao e uma copia de prova (falta ${ARQUIVO_DA_PROVA}): ${dir}`);
  const prova = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (prova.formato !== FORMATO) throw new ErroDeUso(`formato da prova desconhecido: ${String(prova.formato)}`);
  const eventos = lerLedger(dirThread(dir, prova.thread));
  const nota = eventos.filter((e) => e.tipo === TIPOS_DE_EVENTO.masterConcluido && e.autorizadoPor === IDENTIDADE).at(-1);
  const pedida = eventos.some((e) => e.tipo === TIPOS_DE_EVENTO.notaPedida);
  const recibo = nota ? masterRatificado(dir, prova.thread) : false;
  const veredito = nota && recibo
    ? `Veredito: o diálogo nativo abre pelo $.mcp.call do Ritual e grava a nota ${String(nota.score)}/5 com autorizadoPor ${IDENTIDADE} e recibo conferido`
    : nota ? `Veredito: a nota chegou com ${IDENTIDADE}, mas o recibo não confere; repita e anote o que viu`
      : pedida ? 'Veredito: o diálogo foi pedido pelo Ritual e fechou sem nota; repita respondendo'
        : PENDENTE;
  return { formato: FORMATO, raiz: dir, thread: prova.thread, respondido: !!nota, recibo, pedida,
    autorizadoPor: nota ? String(nota.autorizadoPor) : null, score: nota ? nota.score : null, veredito };
}

/** O ensaio: prepara, confere sem resposta e apaga a copia. Nao abre sessao nem chama o `claude`. */
function ensaio(opcoes = {}) {
  const preparo = prepararCopia(opcoes);
  try {
    return { ensaio: true, preparo, conferencia: conferirCopia(preparo.raiz) };
  } finally {
    fs.rmSync(preparo.raiz, { recursive: true, force: true });
  }
}

function lerArgs(argv) {
  const o = { modo: null, saida: undefined, dir: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--preparar' || a === '--ensaio') {
      if (o.modo) throw new ErroDeUso('um modo so: --preparar, --conferir ou --ensaio');
      o.modo = a.slice(2);
    } else if (a === '--conferir') {
      if (o.modo) throw new ErroDeUso('um modo so: --preparar, --conferir ou --ensaio');
      if (argv[i + 1] === undefined) throw new ErroDeUso('--conferir exige a pasta da copia');
      o.modo = 'conferir';
      o.dir = path.resolve(argv[++i]);
    } else if (a === '--saida') {
      if (argv[i + 1] === undefined) throw new ErroDeUso('--saida exige pasta');
      o.saida = argv[++i];
    } else throw new ErroDeUso(`opcao desconhecida: ${a}`);
  }
  if (!o.modo) throw new ErroDeUso('escolha --preparar, --conferir DIR ou --ensaio');
  return o;
}

function texto(r) {
  if (r.ensaio) return [`ensaio: copia em ${r.preparo.raiz}, thread ${r.preparo.thread}`, r.conferencia.veredito].join('\n');
  if (r.comando) {
    return [
      `copia pronta em ${r.raiz}`,
      `thread ${r.thread}, entregue e aceita por omissao`,
      'abra a sessao interativa do dono na copia:',
      `  ${r.comando.linha}`,
      'nela: /nota, Dar a nota no cartao da entrega, de a nota e o porque no dialogo nativo; depois:',
      `  node core/scripts/prova-ritual-nota-nativa.cjs --conferir ${r.raiz}`,
    ].join('\n');
  }
  return [`${r.thread}: ${r.respondido ? `nota ${r.score}/5 por ${r.autorizadoPor}` : r.pedida ? 'pedido de nota sem nota' : 'nada gravado'}`, r.veredito].join('\n');
}

function main(argv) {
  let o;
  let r;
  try {
    o = lerArgs(argv);
    r = o.modo === 'preparar' ? prepararCopia({ saida: o.saida }) : o.modo === 'conferir' ? conferirCopia(o.dir) : ensaio({ saida: o.saida });
  } catch (e) {
    if (!(e instanceof ErroDeUso)) throw e;
    console.error(`prova-ritual-nota-nativa: ${e.message}`);
    console.error('uso: node core/scripts/prova-ritual-nota-nativa.cjs --preparar [--saida DIR] | --conferir DIR | --ensaio [--json]');
    return 2;
  }
  console.log(o.json ? JSON.stringify(r, null, 2) : texto(r));
  return 0;
}

module.exports = { prepararCopia, conferirCopia, ensaio, montarComando, lerArgs, FORMATO, PENDENTE, ErroDeUso };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
