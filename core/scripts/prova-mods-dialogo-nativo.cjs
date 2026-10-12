#!/usr/bin/env node
/**
 * RM-059 (T5.1): a prova de que o dialogo nativo do Claude Code abre quando o pedido vem de um mod (`$.mcp.call`).
 *
 * A Mesa do Dono (`ork-mesa`) chama `ork_request_decision` so com `threadId` e `pedidoId`, e o nucleo abre o dialogo
 * nativo do host (elicitation) e grava a resposta com o recibo do ingresso local. Os tipos do Claude Code dizem que a
 * chamada do plugin e a concessao, e nao dizem se a elicitation dela chega ao dialogo: isso so se prova numa sessao
 * interativa do dono, e a sessao de fase nao abre uma. Este roteiro deixa a prova pronta:
 *
 *   node core/scripts/prova-mods-dialogo-nativo.cjs --preparar [--saida DIR] [--json]
 *     cria, numa pasta temporaria nova fora do repositorio, uma copia minima do estado (git, `orkastery.yaml` do
 *     `init` do nucleo, uma thread sintetica em #Classic com a fase GOAL concluida) e abre nela, pelo proprio nucleo
 *     (`abrirPedidoGate`), uma pergunta `ork.hitl/v2` de teste. Grava o `mcp-prova.json` com so o servidor
 *     `orkastery` dessa copia e imprime o comando da sessao interativa com a ponte e a Mesa por `--plugin-dir`.
 *   node core/scripts/prova-mods-dialogo-nativo.cjs --conferir DIR [--json]
 *     le o ledger da copia e diz o que aconteceu com o pedido de teste: `human_gate` com `autorizadoPor`
 *     `mcp-local:claude-code` (o dialogo abriu e gravou), so `hitl_channel_selected` (o dialogo foi pedido e nao
 *     houve resposta) ou nada; imprime a linha de veredito para `docs/roadmap/evidencias/mods-dialogo-nativo.md`.
 *   node core/scripts/prova-mods-dialogo-nativo.cjs --ensaio [--json]
 *     prepara, confere (sem resposta, o veredito fica pendente) e apaga a copia; nao abre sessao nem chama o `claude`.
 *
 * O roteiro nunca le nem grava o `.orkastery/` do projeto e nunca responde nada: quem responde e o dono, no dialogo.
 * Usa o `core/dist` (rode `npm --prefix core run build` antes). O processo tira do proprio ambiente a identidade de
 * despacho e o projeto fixado, para o ledger da copia nao herdar a sessao de quem roda. Sai 0 com o resumo e 2 em
 * erro de uso ou sem o `core/dist`.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '../..');
const DIST = path.join(RAIZ, 'core/dist');
const FORMATO = 'ork.prova-mods-dialogo-nativo/v1';
const ARQUIVO_DA_PROVA = 'prova-dialogo.json';
const ARQUIVO_DO_MCP = 'mcp-prova.json';
const PONTE = path.join(RAIZ, 'adapters/claude-code/mods/ork-ponte');
const MESA = path.join(RAIZ, 'adapters/claude-code/mods/ork-mesa');
const PENDENTE = 'Veredito: pendente do dono';
/** O que nao entra no ambiente do roteiro nem no da sessao do dono: despacho de fase e projeto fixado. */
const SEM_ESTES = ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO'];

class ErroDeUso extends Error {}

function doNucleo(modulo) {
  const arquivo = path.join(DIST, `${modulo}.js`);
  if (!fs.existsSync(arquivo)) throw new ErroDeUso(`falta ${path.relative(RAIZ, arquivo)}: rode npm --prefix core run build`);
  return require(arquivo);
}

function semIdentidadeDeDespacho() {
  for (const nome of SEM_ESTES) delete process.env[nome];
}

/**
 * A copia fica fora do repositorio e fora de qualquer projeto do Orkastery (nenhuma pasta acima tem `orkastery.yaml`):
 * ela nunca e, nem fica dentro de, o estado de um projeto. Confere o caminho pedido ANTES de criar qualquer coisa: a
 * parte que ja existe pelo caminho real, o resto como foi pedido.
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
  const r = spawnSync('git', ['-c', 'user.name=prova do dialogo', '-c', 'user.email=prova@exemplo.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`git ${args[0]} saiu ${r.status}: ${(r.stderr || '').trim().slice(0, 200)}`);
}

/** O comando da sessao interativa do dono na copia: a ponte e a Mesa por `--plugin-dir`, so o servidor da copia. */
function montarComando(dir) {
  const argv = ['claude', '--plugin-dir', PONTE, '--plugin-dir', MESA, '--strict-mcp-config', '--mcp-config', path.join(dir, ARQUIVO_DO_MCP)];
  const linha = `cd ${dir} && env ${SEM_ESTES.map((n) => `-u ${n}`).join(' ')} ${argv.join(' ')}`;
  return { argv, sem: [...SEM_ESTES], linha };
}

/** Prepara a copia minima do estado com a pergunta de teste aberta pelo proprio nucleo. */
function prepararCopia(opcoes = {}) {
  semIdentidadeDeDespacho();
  const { init } = doNucleo('init');
  const { exigirManifesto } = doNucleo('manifest');
  const { novaThread, gravarThread, dirThread } = doNucleo('thread');
  const { registrar } = doNucleo('ledger');
  const { abrirPedidoGate } = doNucleo('hitl-gates');
  const base = exigirForaDeProjeto(opcoes.saida ? path.resolve(opcoes.saida) : os.tmpdir());
  fs.mkdirSync(base, { recursive: true });
  const dir = exigirForaDeProjeto(fs.mkdtempSync(path.join(base, 'ork-prova-dialogo-')));
  git(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# copia de prova do dialogo nativo\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'inicial']);
  init(dir, { nome: 'prova-dialogo', abbrev: 'prv' });
  const carregado = exigirManifesto(dir);
  const { thread } = novaThread(carregado, { nome: 'prova do dialogo nativo', modo: 'classic' });
  thread.faseAtual = 'GOAL';
  gravarThread(dir, thread);
  registrar(dirThread(dir, thread.id), thread.id, 'phase_result', { fase: 'GOAL', motivo: 'human.pending' });
  const pedido = abrirPedidoGate(dir, thread.id, 'human.pending');
  const servidor = { mcpServers: { orkastery: { command: process.execPath,
    args: [path.join(DIST, 'index.js'), 'mcp', 'serve', '--project', dir, '--host', 'claude-code'] } } };
  fs.writeFileSync(path.join(dir, ARQUIVO_DO_MCP), JSON.stringify(servidor, null, 2) + '\n');
  const prova = { formato: FORMATO, raiz: dir, thread: thread.id, pedidoId: pedido.id, codigo: pedido.codigo ?? null,
    contrato: pedido.contrato, alternativas: (pedido.alternativas ?? []).map((a) => a.letra) };
  fs.writeFileSync(path.join(dir, ARQUIVO_DA_PROVA), JSON.stringify(prova, null, 2) + '\n');
  return { ...prova, comando: montarComando(dir) };
}

/**
 * O que o ledger da copia diz do pedido de teste. So a resposta gravada pelo ingresso local do Claude Code prova o
 * dialogo; o canal escolhido sem resposta diz que o dialogo foi pedido e fechou sem efeito.
 */
function conferirCopia(dir) {
  semIdentidadeDeDespacho();
  const { lerLedger } = doNucleo('ledger');
  const { dirThread } = doNucleo('thread');
  const arquivo = path.join(dir, ARQUIVO_DA_PROVA);
  if (!fs.existsSync(arquivo)) throw new ErroDeUso(`nao e uma copia de prova (falta ${ARQUIVO_DA_PROVA}): ${dir}`);
  const prova = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (prova.formato !== FORMATO) throw new ErroDeUso(`formato da prova desconhecido: ${String(prova.formato)}`);
  const eventos = lerLedger(dirThread(dir, prova.thread)).filter((e) => e.pedidoId === prova.pedidoId);
  const gate = eventos.find((e) => e.tipo === 'human_gate');
  const escolhido = eventos.filter((e) => e.tipo === 'hitl_channel_selected').map((e) => String(e.canal));
  const autorizadoPor = gate ? String(gate.autorizadoPor ?? '') : null;
  const pelaMesa = autorizadoPor !== null && autorizadoPor.startsWith('mcp-local:claude-code');
  const veredito = pelaMesa
    ? `Veredito: o diálogo nativo abre pelo $.mcp.call e grava human_gate com autorizadoPor ${autorizadoPor} (${String(gate.estado)})`
    : gate ? `Veredito: o pedido foi respondido por outro canal (${autorizadoPor || 'sem autorizadoPor'}); repita pela Mesa`
      : escolhido.includes('claude-code') ? 'Veredito: o diálogo foi pedido pela Mesa e fechou sem resposta gravada; repita respondendo'
        : PENDENTE;
  return { formato: FORMATO, raiz: dir, thread: prova.thread, pedidoId: prova.pedidoId, respondido: !!gate, pelaMesa,
    autorizadoPor, estado: gate ? String(gate.estado ?? '') : null, canaisEscolhidos: escolhido, veredito };
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
  if (r.ensaio) return [`ensaio: copia em ${r.preparo.raiz}, pedido ${r.preparo.pedidoId} (codigo ${r.preparo.codigo})`, r.conferencia.veredito].join('\n');
  if (r.comando) {
    return [
      `copia pronta em ${r.raiz}`,
      `thread ${r.thread}, pedido ${r.pedidoId} (codigo ${r.codigo}, alternativas ${r.alternativas.join(', ')})`,
      'abra a sessao interativa do dono na copia:',
      `  ${r.comando.linha}`,
      'nela: /mesa, Decidir no cartao do pedido, responda no dialogo nativo; depois:',
      `  node core/scripts/prova-mods-dialogo-nativo.cjs --conferir ${r.raiz}`,
    ].join('\n');
  }
  return [`pedido ${r.pedidoId} da ${r.thread}: ${r.respondido ? `respondido (${r.autorizadoPor})` : 'sem resposta gravada'}`, r.veredito].join('\n');
}

function main(argv) {
  let o;
  let r;
  try {
    o = lerArgs(argv);
    r = o.modo === 'preparar' ? prepararCopia({ saida: o.saida }) : o.modo === 'conferir' ? conferirCopia(o.dir) : ensaio({ saida: o.saida });
  } catch (e) {
    if (!(e instanceof ErroDeUso)) throw e;
    console.error(`prova-mods-dialogo-nativo: ${e.message}`);
    console.error('uso: node core/scripts/prova-mods-dialogo-nativo.cjs --preparar [--saida DIR] | --conferir DIR | --ensaio [--json]');
    return 2;
  }
  console.log(o.json ? JSON.stringify(r, null, 2) : texto(r));
  return 0;
}

module.exports = { prepararCopia, conferirCopia, ensaio, montarComando, lerArgs, FORMATO, PENDENTE, ErroDeUso };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
