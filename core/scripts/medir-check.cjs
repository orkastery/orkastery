#!/usr/bin/env node
/**
 * RM-072 (D20 da ork-check5x): a medicao do Agile Check e do Classic Check numa copia descartavel do projeto.
 *
 *   node core/scripts/medir-check.cjs [--agile N] [--classic N] [--saida <arquivo.json>] [--prazo-min M]
 *                                     [--cache-compartilhado] [--manter]
 *
 * Clona o HEAD da worktree numa pasta temporaria sem sequencia hexadecimal de 8 caracteres no caminho, liga o
 * `node_modules` do core por link, abre uma thread sem worktree com tres claims representativas desta thread e roda o
 * `ork verify` da worktree (`core/dist/index.js`) com `--check agile` N vezes seguidas (3 por padrao) e `--check classic`
 * N vezes (1). A copia tem `.orkastery`, `ORKASTERY_HOME` e `TMPDIR` proprios, e `XDG_CACHE_HOME` proprio sem
 * `--cache-compartilhado` (a primeira rodada do Agile paga o cache frio); nenhuma variavel `ORK_*` desta sessao passa.
 *
 * A duracao de cada rodada sai do `verify_run` do ledger da copia. O pico de memoria e a maior soma, numa amostra por
 * segundo, do RSS da arvore de processos do verify com a memoria dos containers da varredura (`ork-security-scan-*`,
 * pelo `memory.current` do cgroup); RSS soma pagina compartilhada mais de uma vez, entao o numero e um teto. Sai 0 com
 * todas as rodadas medidas, mesmo que o verify reprove (o veredito vai no resumo).
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const CLI = path.join(RAIZ, 'core', 'dist', 'index.js');
const TETO_DA_RODADA_MS = 3 * 60 * 1000;
const TETO_DO_PICO_BYTES = 4 * 1024 ** 3;
const PREFIXO_DOS_CONTAINERS = 'ork-security-scan-';

/** Tres claims desta thread, como foram registradas: preparo na frente, preparo no meio e a suite do motor do Agile. */
const CLAIMS_REPRESENTATIVAS = [
  { arquivo: 'core/src/check-modo.ts', alegacao: 'medicao: o modo do CHECK e os testes vizinhos do verify',
    verificar: "npm --prefix core run build && npm --prefix core run build:test && node --test-reporter=tap core/dist-test/test/check-modo.test.js | awk '/^ *not ok/{f++} /# SKIP/{s++} /^ *ok [0-9]+ - CM[0-9]+:/{p++} END{exit !(p>=12 && f==0 && s==0)}' && node --test core/dist-test/test/verify.test.js core/dist-test/test/verify-compilacao-unica.test.js core/dist-test/test/locale-verify.test.js core/dist-test/test/rm044-paridade-cli-md.test.js core/dist-test/test/locale-ajuda.test.js" },
  { arquivo: 'docs/referencia/cli.md', alegacao: 'medicao: a referencia do CLI com o --check e a paridade dela',
    verificar: "grep -q -- '--check classic\\|agile' docs/referencia/cli.md && grep -q 'Agile Check (padrão)' docs/referencia/cli.md && npm --prefix core run build && npm --prefix core run build:test && node --test core/dist-test/test/rm044-paridade-cli-md.test.js" },
  { arquivo: 'core/src/check-agil.ts', alegacao: 'medicao: o motor do Agile Check',
    verificar: "npm --prefix core run build && npm --prefix core run build:test && node --test-reporter=tap core/dist-test/test/check-agil.test.js | awk '/^ *not ok/{f++} /# SKIP/{s++} /^ *ok [0-9]+ - AG[0-9]+:/{p++} END{exit !(p>=20 && f==0 && s==0)}'" },
];

/** A pasta temporaria de base: a do sistema, ou `/tmp` quando ela tem sequencia hexadecimal de 8 (o id de um job). */
function pastaDeBase(tmpdir) {
  return /[0-9a-f]{8}/i.test(tmpdir) ? '/tmp' : tmpdir;
}

/** As rodadas do ledger da copia: cada `verify_run`, com o modo, o veredito e as duracoes. */
function lerRodadas(texto) {
  const rodadas = [];
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue;
    let e;
    try { e = JSON.parse(linha); } catch { continue; }
    if (!e || e.tipo !== 'verify_run') continue;
    rodadas.push({
      modo: e.check && typeof e.check.modo === 'string' ? e.check.modo : null,
      origem: e.check && typeof e.check.origem === 'string' ? e.check.origem : null,
      ok: e.veredito === 'verdade sustentada',
      motivos: Array.isArray(e.motivos) ? e.motivos : [],
      duracaoMs: typeof e.duracaoMs === 'number' ? e.duracaoMs : null,
      preparoMs: e.preparo && typeof e.preparo.duracaoMs === 'number' ? e.preparo.duracaoMs : null,
      comandos: Array.isArray(e.comandos) ? e.comandos.map((c) => ({ nome: c.nome, ok: c.ok === true,
        duracaoMs: typeof c.duracaoMs === 'number' ? c.duracaoMs : null, ...(Array.isArray(c.lanes) ? { lanes: c.lanes } : {}) })) : [],
      claims: Array.isArray(e.claims) ? e.claims.map((c) => ({ id: c.id, duracaoMs: typeof c.duracaoMs === 'number' ? c.duracaoMs : null })) : [],
      pecas: e.agile && Array.isArray(e.agile.pecas) ? e.agile.pecas : [],
    });
  }
  return rodadas;
}

/**
 * A regra das tres rodadas consecutivas: tres rodadas seguidas do Agile, todas aprovadas e cada uma dentro do teto. Uma
 * rodada do Classic, reprovada, sem duracao ou acima do teto no meio quebra a sequencia.
 */
function tresConsecutivas(rodadas, tetoMs) {
  let seguidas = [];
  for (let i = 0; i < rodadas.length; i++) {
    const r = rodadas[i];
    const vale = r.modo === 'agile' && r.ok && typeof r.duracaoMs === 'number' && r.duracaoMs <= tetoMs;
    seguidas = vale ? [...seguidas, i] : [];
    if (seguidas.length === 3) return { ok: true, rodadas: seguidas };
  }
  return { ok: false, rodadas: [] };
}

/** O RSS somado de um processo e de todos os descendentes, numa tabela pid -> { ppid, rss }. */
function rssDaArvore(raiz, processos) {
  const filhos = new Map();
  for (const [pid, p] of processos) {
    if (!filhos.has(p.ppid)) filhos.set(p.ppid, []);
    filhos.get(p.ppid).push(pid);
  }
  let total = 0;
  const pilha = [raiz];
  const visto = new Set();
  while (pilha.length) {
    const pid = pilha.pop();
    if (visto.has(pid)) continue;
    visto.add(pid);
    total += processos.get(pid)?.rss ?? 0;
    pilha.push(...(filhos.get(pid) ?? []));
  }
  return total;
}

/** A maior soma da arvore com os containers entre as amostras, e em qual amostra. */
function picoAgregado(amostras) {
  let pico = { bytes: 0, amostra: -1, arvore: 0, containers: 0 };
  amostras.forEach((a, i) => {
    const soma = a.arvore + a.containers;
    if (soma > pico.bytes) pico = { bytes: soma, amostra: i, arvore: a.arvore, containers: a.containers };
  });
  return pico;
}

/** A tabela de processos do /proc (pid, ppid e RSS em bytes). */
function lerProcessos() {
  const pagina = 4096;
  const tabela = new Map();
  for (const nome of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(nome)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${nome}/stat`, 'utf8');
      const depois = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const rss = Number(fs.readFileSync(`/proc/${nome}/statm`, 'utf8').split(' ')[1]) * pagina;
      tabela.set(Number(nome), { ppid: Number(depois[1]), rss });
    } catch { /* o processo acabou entre a lista e a leitura */ }
  }
  return tabela;
}

/** A memoria dos containers da varredura em execucao, pelo cgroup de cada um. */
function memoriaDosContainers() {
  const r = spawnSync('docker', ['ps', '--no-trunc', '--filter', `name=${PREFIXO_DOS_CONTAINERS}`, '--format', '{{.ID}}'],
    { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return 0;
  let total = 0;
  for (const id of r.stdout.split('\n').filter(Boolean)) {
    try { total += Number(fs.readFileSync(`/sys/fs/cgroup/system.slice/docker-${id}.scope/memory.current`, 'utf8')); } catch { /* acabou */ }
  }
  return total;
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function ork(cwd, env, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ork ${args.join(' ')} saiu ${r.status}: ${r.stdout}${r.stderr}`);
  return r.stdout;
}

/** Uma rodada do verify com amostra de memoria por segundo; o log vai para um arquivo da copia. */
function rodada(copia, env, thread, modo, log, prazoMs) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'w');
    const inicio = Date.now();
    const p = spawn(process.execPath, [CLI, 'verify', thread, '--check', modo], { cwd: copia, env, stdio: ['ignore', fd, fd] });
    const amostras = [];
    const amostrar = () => { try { amostras.push({ arvore: rssDaArvore(p.pid, lerProcessos()), containers: memoriaDosContainers() }); } catch { /* segue */ } };
    const relogio = setInterval(amostrar, 1000);
    const prazo = setTimeout(() => { p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 10000).unref(); }, prazoMs);
    p.on('close', (code, sinal) => {
      clearInterval(relogio);
      clearTimeout(prazo);
      fs.closeSync(fd);
      resolve({ code, sinal, paredeMs: Date.now() - inicio, pico: picoAgregado(amostras), amostras: amostras.length });
    });
  });
}

function opcoes(args) {
  const valor = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; };
  return { agile: Number(valor('--agile', '3')), classic: Number(valor('--classic', '1')), saida: valor('--saida', null),
    prazoMs: Number(valor('--prazo-min', '60')) * 60000, compartilhado: args.includes('--cache-compartilhado'), manter: args.includes('--manter') };
}

async function principal(args) {
  const o = opcoes(args);
  const head = git(RAIZ, 'rev-parse', 'HEAD');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(pastaDeBase(os.tmpdir()), 'ork-medir-check-')));
  if (/[0-9a-f]{8}/i.test(base)) throw new Error(`a pasta da medicao tem sequencia hexadecimal de 8: ${base}`);
  const copia = path.join(base, 'projeto');
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ORK_|ORKASTERY_|NODE_TEST_CONTEXT$)/.test(k)) env[k] = v;
  for (const d of ['tmp', 'casa', 'cache']) fs.mkdirSync(path.join(base, d));
  Object.assign(env, { TMPDIR: path.join(base, 'tmp'), ORKASTERY_HOME: path.join(base, 'casa') });
  if (!o.compartilhado) env.XDG_CACHE_HOME = path.join(base, 'cache');
  try {
    git(base, 'clone', '--quiet', '--no-checkout', RAIZ, copia);
    git(copia, 'checkout', '--quiet', '--detach', head);
    fs.symlinkSync(path.join(RAIZ, 'core', 'node_modules'), path.join(copia, 'core', 'node_modules'));
    ork(copia, env, 'thread', 'new', 'medicao do check', '--modo', 'auto', '--sem-worktree');
    const threads = fs.readdirSync(path.join(copia, '.orkastery', 'threads'))
      .filter((n) => fs.existsSync(path.join(copia, '.orkastery', 'threads', n, 'thread.json')));
    if (threads.length !== 1) throw new Error(`esperava uma thread na copia, achei ${threads.length}`);
    const [thread] = threads;
    for (const c of CLAIMS_REPRESENTATIVAS) ork(copia, env, 'claims', 'add', thread, c.arquivo, '--claim', c.alegacao, '--verificar', c.verificar);
    const ledger = path.join(copia, '.orkastery', 'threads', thread, 'ledger.jsonl');
    const resultado = [];
    const fila = [...Array(o.agile).fill('agile'), ...Array(o.classic).fill('classic')];
    for (const [i, modo] of fila.entries()) {
      const r = await rodada(copia, env, thread, modo, path.join(base, `rodada-${i + 1}-${modo}.log`), o.prazoMs);
      const doLedger = lerRodadas(fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '');
      const ultima = doLedger.length > resultado.length ? doLedger[doLedger.length - 1] : null;
      resultado.push({ n: i + 1, pedido: modo, saida: r.code, sinal: r.sinal, paredeMs: r.paredeMs, picoBytes: r.pico.bytes,
        picoArvore: r.pico.arvore, picoContainers: r.pico.containers, amostras: r.amostras, ...(ultima ?? { modo: null, ok: false, duracaoMs: null }) });
      process.stderr.write(`medir-check: rodada ${i + 1} (${modo}) ${ultima?.duracaoMs ?? '?'} ms no ledger, ${r.paredeMs} ms de parede, ` +
        `pico ${(r.pico.bytes / 1024 ** 3).toFixed(2)} GiB, saida ${r.code}\n`);
    }
    const resumo = {
      contrato: 'ork.medir-check/v1', head, cache: o.compartilhado ? 'compartilhado' : 'isolado',
      maquina: { cpus: os.availableParallelism(), memoriaBytes: os.totalmem() },
      rodadas: resultado,
      tresConsecutivas: { tetoMs: TETO_DA_RODADA_MS, ...tresConsecutivas(resultado, TETO_DA_RODADA_MS) },
      pico: { tetoBytes: TETO_DO_PICO_BYTES, bytes: Math.max(0, ...resultado.map((r) => r.picoBytes)) },
    };
    resumo.pico.dentro = resumo.pico.bytes <= TETO_DO_PICO_BYTES;
    const texto = JSON.stringify(resumo, null, 1) + '\n';
    if (o.saida) fs.writeFileSync(o.saida, texto);
    process.stdout.write(texto);
    return 0;
  } finally {
    if (o.manter) process.stderr.write(`medir-check: copia mantida em ${base}\n`);
    else fs.rmSync(base, { recursive: true, force: true });
  }
}

module.exports = { lerRodadas, tresConsecutivas, rssDaArvore, picoAgregado, pastaDeBase, CLAIMS_REPRESENTATIVAS };

if (require.main === module) {
  principal(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`medir-check: ${e.message}\n`); process.exit(1); });
}
