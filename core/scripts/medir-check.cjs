#!/usr/bin/env node
/**
 * RM-072 (D20 da ork-check5x): a medicao do Agile Check e do Classic Check numa copia descartavel do projeto.
 *
 *   node core/scripts/medir-check.cjs [--agile N] [--classic N] [--saida <arquivo.json>] [--prazo-min M]
 *                                     [--cache-compartilhado] [--manter] [--commit <ref>]
 *   node core/scripts/medir-check.cjs --bancada [--pares N] [--por-arquivo N] [--commit <ref>] [--saida <arquivo.json>]
 *                                     [--linha-de-base <bancada.json>] [--claims-de <claims.jsonl>] [--carga-max L]
 *                                     [--janela-quieta-s S] [--espera-max-min M] [--prazo-min M]
 *   node core/scripts/medir-check.cjs --bancada --reanalisar <saida.json.d/bruto.json> [--saida <arquivo.json>]
 *
 * Clona o HEAD da worktree (ou o `--commit`), na mesma branch, numa pasta descartavel sem sequencia hexadecimal de 8 caracteres no caminho e
 * fora de pasta temporaria (`$XDG_CACHE_HOME/orkastery/medir-check/`: a suite trata `/tmp` e o `TMPDIR` como efemeros),
 * liga o `node_modules` do core por link, abre uma thread sem worktree com tres claims representativas desta thread e
 * roda o `ork verify` da worktree (`core/dist/index.js`) com `--check agile` N vezes seguidas (3 por padrao) e
 * `--check classic` N vezes (1). A copia nao tem remoto (nada dela chega ao repositorio de verdade); o `main` e o
 * `origin/main` dela apontam para a base da thread (o merge-base do HEAD com o `origin/<base>` da worktree), para a
 * varredura e a barreira de dado privado lerem o mesmo diff da thread. A copia tem `HOME`, `.orkastery` e `TMPDIR`
 * proprios, sem `ORKASTERY_HOME` (como numa maquina de verdade: a casa do `ork` sai do `HOME`, e o `npm test` e as lanes
 * criam a casa temporaria de cada rodada), `TMPDIR` curto em `/tmp/ork-mc-*` (texto que corta caminho longo cortaria o
 * comando junto, como numa maquina de verdade nao corta) e `XDG_CACHE_HOME` proprio sem `--cache-compartilhado` (a primeira
 * rodada do Agile paga o cache frio); nenhuma variavel `ORK_*` desta sessao passa. Com `--saida`, o log de cada rodada vai
 * para a pasta `<saida>.d/`. Parada por prazo ou por sinal encerra a arvore do verify, os containers da copia e as pastas.
 *
 * A duracao de cada rodada sai do `verify_run` do ledger da copia. O pico de memoria e a maior soma, numa amostra por
 * segundo, do RSS da arvore de processos do verify com a memoria dos containers da varredura (`ork-security-scan-*`,
 * como o `docker stats` conta: `memory.current` menos o cache de arquivo inativo); RSS soma pagina compartilhada mais de
 * uma vez, entao o numero e um teto. Sai 0 com
 * todas as rodadas medidas, mesmo que o verify reprove (o veredito vai no resumo).
 *
 * RM-074 (M0, a bancada): `--bancada` roda N pares (3 por padrao) no mesmo commit, em sequencia: o Agile, o Classic e um
 * passe por arquivo, que roda cada arquivo de teste sozinho sob o `/usr/bin/time` (parede, `user`, `sys` e o pico do maior
 * processo, com os filhos que ele esperou) e conta os testes pelo TAP. Antes de cada rodada e de cada passe, espera a carga
 * de 1 minuto ficar abaixo de `--carga-max` (2) por `--janela-quieta-s` (120 s) sem outro `ork verify`, `node --test` ou
 * lane na maquina, e grava a espera; cada rodada grava o roubo de CPU (`steal`, pelo `/proc/stat`) e a CPU da arvore do
 * verify (sem os containers). O JSON traz a razao Classic/Agile de cada par, a eficiencia de paralelismo de cada lane (a
 * CPU da lane no passe dividida pelos nucleos, contra a parede da lane no `verify_run`), o corte de CPU contra a
 * `--linha-de-base` (sem ela, contra a media desta medicao), a variacao entre rodadas e as sondas 1 a 5 da pagina da
 * RM-074 refeitas. Os metadados sao o commit, os nucleos e a memoria; o nome da maquina, a casa e as pastas da copia saem
 * redigidos de todo texto. Cada rodada e cada passe vao para `<saida>.d/bruto.json` assim que terminam (com o grafo dos
 * testes e o historico no fim); `--reanalisar` refaz as contas sobre esse arquivo, sem copia e sem rodar nada.
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
const TEMPO = '/usr/bin/time';
const FORMATO_DO_TEMPO = '%e %U %S %M';
const PRAZO_DO_ARQUIVO_MS = 20 * 60 * 1000;

/** Tres claims desta thread, como foram registradas: preparo na frente, preparo no meio e a suite do motor do Agile. */
const CLAIMS_REPRESENTATIVAS = [
  { arquivo: 'core/src/check-modo.ts', alegacao: 'medicao: o modo do CHECK e os testes vizinhos do verify',
    verificar: "npm --prefix core run build && npm --prefix core run build:test && node --test-reporter=tap core/dist-test/test/check-modo.test.js | awk '/^ *not ok/{f++} /# SKIP/{s++} /^ *ok [0-9]+ - CM[0-9]+:/{p++} END{exit !(p>=12 && f==0 && s==0)}' && node --test core/dist-test/test/verify.test.js core/dist-test/test/verify-compilacao-unica.test.js core/dist-test/test/locale-verify.test.js core/dist-test/test/rm044-paridade-cli-md.test.js core/dist-test/test/locale-ajuda.test.js" },
  { arquivo: 'docs/referencia/cli.md', alegacao: 'medicao: a referencia do CLI com o --check e a paridade dela',
    verificar: "grep -q -- '--check classic\\|agile' docs/referencia/cli.md && grep -q 'Agile Check (padrão)' docs/referencia/cli.md && npm --prefix core run build && npm --prefix core run build:test && node --test core/dist-test/test/rm044-paridade-cli-md.test.js" },
  { arquivo: 'core/src/check-agil.ts', alegacao: 'medicao: o motor do Agile Check',
    verificar: "npm --prefix core run build && npm --prefix core run build:test && node --test-reporter=tap core/dist-test/test/check-agil.test.js | awk '/^ *not ok/{f++} /# SKIP/{s++} /^ *ok [0-9]+ - AG[0-9]+:/{p++} END{exit !(p>=20 && f==0 && s==0)}'" },
];

/**
 * Onde as copias nascem: no cache do usuario, fora de pasta temporaria (a suite trata `/tmp` e o `TMPDIR` como efemeros, e o
 * projeto de verdade nao mora la). Caminho com sequencia hexadecimal de 8 (o id de um job) vira o cache padrao do `HOME`.
 */
function pastaDasCopias(cache, home = os.homedir()) {
  const pasta = path.join(cache, 'orkastery', 'medir-check');
  return /[0-9a-f]{8}/i.test(pasta) ? path.join(home, '.cache', 'orkastery', 'medir-check') : pasta;
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
        duracaoMs: typeof c.duracaoMs === 'number' ? c.duracaoMs : null, ...(Array.isArray(c.lanes) ? { lanes: c.lanes } : {}),
        // O comando que reprova leva o porque, para a rodada ser lida depois de a copia sumir.
        ...(c.ok === true ? {} : { causa: c.causa ?? null, testeQueCaiu: Array.isArray(c.testeQueCaiu) ? c.testeQueCaiu.slice(0, 10) : [],
          trecho: typeof c.trecho === 'string' ? c.trecho.slice(0, 600) : null }) })) : [],
      claims: Array.isArray(e.claims) ? e.claims.map((c) => ({ id: c.id, duracaoMs: typeof c.duracaoMs === 'number' ? c.duracaoMs : null,
        ...(c.verificado === false ? { verificado: false, motivo: c.motivo ?? null } : {}) })) : [],
      pecas: e.agile && Array.isArray(e.agile.pecas) ? e.agile.pecas : [],
      // RM-074: a contagem de cada lane e o arquivo com a lista inteira, que a bancada le antes de a copia sumir.
      ...(e.agile && Array.isArray(e.agile.lanes) ? { lanesDoAgile: e.agile.lanes } : {}),
      ...(e.agile && typeof e.agile.evidencia === 'string' ? { evidenciaDasLanes: e.agile.evidencia } : {}),
      ...(Array.isArray(e.falhasSemBaseline) && e.falhasSemBaseline.length ? { falhasSemBaseline: e.falhasSemBaseline } : {}),
      ...(Array.isArray(e.regressoes) && e.regressoes.length ? { regressoes: e.regressoes } : {}),
      // O resumo da barreira de dado privado ja vem sem o valor casado e sem o termo da lista local.
      ...(e.dadoPrivado ? { dadoPrivado: e.dadoPrivado } : {}),
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

/**
 * A memoria dos containers da varredura em execucao, como o `docker stats` a conta: o `memory.current` do cgroup de cada um
 * menos o cache de arquivo inativo (o banco do Trivy lido do disco nao e memoria do processo).
 */
function memoriaDosContainers() {
  const r = spawnSync('docker', ['ps', '--no-trunc', '--filter', `name=${PREFIXO_DOS_CONTAINERS}`, '--format', '{{.ID}}'],
    { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return 0;
  let total = 0;
  for (const id of r.stdout.split('\n').filter(Boolean)) {
    const dir = `/sys/fs/cgroup/system.slice/docker-${id}.scope`;
    try {
      const atual = Number(fs.readFileSync(`${dir}/memory.current`, 'utf8'));
      const inativo = Number(/^inactive_file (\d+)$/m.exec(fs.readFileSync(`${dir}/memory.stat`, 'utf8'))?.[1] ?? 0);
      total += Math.max(0, atual - inativo);
    } catch { /* o container acabou entre a lista e a leitura */ }
  }
  return total;
}

/** Encerra um processo e todos os descendentes dele (as lanes rodam em grupos proprios do `timeout(1)`). */
function encerrarArvore(raiz, sinal = 'SIGTERM') {
  const filhos = new Map();
  for (const [pid, p] of lerProcessos()) {
    if (!filhos.has(p.ppid)) filhos.set(p.ppid, []);
    filhos.get(p.ppid).push(pid);
  }
  const todos = [];
  const pilha = [raiz];
  while (pilha.length) {
    const pid = pilha.pop();
    if (todos.includes(pid)) continue;
    todos.push(pid);
    pilha.push(...(filhos.get(pid) ?? []));
  }
  for (const pid of todos.reverse()) { try { process.kill(pid, sinal); } catch { /* ja acabou */ } }
  return todos.length;
}

/** Remove os containers da varredura que montam as pastas da copia (a parada no meio deixa os que estavam rodando). */
function removerContainersDaCopia(pastas) {
  const r = spawnSync('docker', ['ps', '--no-trunc', '--filter', `name=${PREFIXO_DOS_CONTAINERS}`, '--format', '{{.ID}}'],
    { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return;
  for (const id of r.stdout.split('\n').filter(Boolean)) {
    const montagens = spawnSync('docker', ['inspect', '--format', '{{range .Mounts}}{{.Source}} {{end}}', id], { encoding: 'utf8', timeout: 5000 });
    if (montagens.stdout.split(' ').some((m) => pastas.some((p) => m.startsWith(p)))) spawnSync('docker', ['rm', '-f', id], { timeout: 15000 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// RM-074 (M0): as contas da bancada. Puras, sobre numeros ja medidos; os testes usam numeros sinteticos.

/** A razao do par: a parede do Classic dividida pela do Agile no mesmo commit (3 = o Agile tres vezes mais rapido). */
function razao(classicMs, agileMs) {
  return typeof classicMs === 'number' && typeof agileMs === 'number' && classicMs > 0 && agileMs > 0 ? classicMs / agileMs : null;
}

/**
 * A eficiencia de paralelismo: a CPU total dividida pelos nucleos, contra a parede (1 = todos os nucleos ocupados a parede
 * inteira; a lane de integracao, dois arquivos por vez, fica baixa por construcao).
 */
function eficiencia(cpuMs, nucleos, paredeMs) {
  return typeof cpuMs === 'number' && cpuMs > 0 && nucleos > 0 && typeof paredeMs === 'number' && paredeMs > 0
    ? cpuMs / nucleos / paredeMs : null;
}

/** O corte de CPU contra a linha de base, em fracao (0,49 = 49% a menos; negativo = mais CPU que a base). */
function corte(cpuMs, baseMs) {
  return typeof cpuMs === 'number' && cpuMs >= 0 && typeof baseMs === 'number' && baseMs > 0 ? 1 - cpuMs / baseMs : null;
}

/**
 * A variacao entre rodadas de uma grandeza: contagem, minimo, maximo, media, desvio padrao amostral, coeficiente de
 * variacao (desvio sobre a media) e amplitude relativa (maximo menos minimo, sobre a media). Valor que nao e numero sai.
 */
function variacao(valores) {
  const v = valores.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  const desvio = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - media) ** 2, 0) / (v.length - 1)) : 0;
  const min = Math.min(...v), max = Math.max(...v);
  return { n: v.length, min, max, media, desvio, cv: media ? desvio / media : null, amplitude: media ? (max - min) / media : null };
}

/** A mediana e o quantil por interpolacao linear (q de 0 a 1) de uma lista de numeros. */
function quantil(valores, q) {
  const v = [...valores].sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q, i = Math.floor(pos);
  return i + 1 < v.length ? v[i] + (v[i + 1] - v[i]) * (pos - i) : v[i];
}

/** A linha agregada `cpu` do /proc/stat: o total das oito primeiras colunas e o `steal`, em jiffies. */
function lerCpuStat(texto) {
  const linha = String(texto).split('\n').find((l) => /^cpu\s/.test(l));
  if (!linha) return null;
  const n = linha.trim().split(/\s+/).slice(1, 9).map(Number);
  if (n.length < 8 || n.some((x) => !Number.isFinite(x))) return null;
  return { total: n.reduce((a, b) => a + b, 0), steal: n[7] };
}

/** O roubo de CPU entre duas leituras do /proc/stat, em percentual do tempo das CPUs no intervalo. */
function stealPct(antes, depois) {
  if (!antes || !depois) return null;
  const total = depois.total - antes.total;
  return total > 0 ? ((depois.steal - antes.steal) / total) * 100 : null;
}

/**
 * Onde comeca a sequencia final de amostras quietas (carga de 1 minuto abaixo do limite e nenhuma outra suite), ou null.
 * A maquina esta quieta quando a ultima amostra fica pelo menos a janela inteira depois desse inicio.
 */
function inicioQuieto(amostras, limite) {
  let inicio = null;
  for (const a of amostras) inicio = a.carga < limite && a.outros === 0 ? (inicio ?? a.t) : null;
  return inicio;
}

function quieta(amostras, limite, janelaMs) {
  const inicio = inicioQuieto(amostras, limite);
  return inicio !== null && amostras[amostras.length - 1].t - inicio >= janelaMs;
}

/** O processo e de verify ou de suite: o `ork verify` (ou `index.js verify`), um `node --test` ou uma lane. */
function eSuite(args) {
  if (!Array.isArray(args) || !args.length) return false;
  const nome = (s) => String(s).split('/').pop();
  if (args.some((a) => nome(a) === 'test-lanes.cjs')) return true;
  if (/^node(js)?$/.test(nome(args[0])) && args.includes('--test')) return true;
  const i = args.indexOf('verify');
  return i > 0 && /^(ork|index\.js)$/.test(nome(args[i - 1]));
}

/** O que o `/usr/bin/time -f '%e %U %S %M'` grava: a ultima linha (antes dela vem o aviso de saida ou de sinal). */
function lerTempo(texto) {
  const ultima = String(texto).trim().split('\n').pop()?.trim() ?? '';
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+)$/.exec(ultima);
  return m ? { paredeMs: Math.round(Number(m[1]) * 1000), userMs: Math.round(Number(m[2]) * 1000), sysMs: Math.round(Number(m[3]) * 1000),
    picoKb: Number(m[4]) } : null;
}

/** O rodape do TAP de um arquivo: testes, aprovados, falhas, cancelados, pulados e pendentes. */
function contarTap(texto) {
  const c = {};
  for (const m of String(texto).matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gm)) c[m[1]] = Number(m[2]);
  return c;
}

/**
 * Sonda 1: a concentracao da parede por arquivo (o reporter de duracoes, sob concorrencia). A parte de cada lane, a dos N
 * mais caros, os arquivos acima do orcamento da F2 da RM-072 (2,6% da soma) e da meta da RM-074 (1,3%) e a cauda.
 */
function concentracao(duracoes, lanes = {}) {
  const pares = Object.entries(duracoes).filter(([, ms]) => typeof ms === 'number' && ms >= 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const soma = pares.reduce((s, [, ms]) => s + ms, 0);
  if (!soma) return null;
  const somaDe = (lista) => lista.reduce((s, [, ms]) => s + ms, 0) / soma;
  const topo = {};
  for (const n of [5, 10, 20, 50, 100]) topo[n] = somaDe(pares.slice(0, n));
  const porLane = {};
  for (const [lane, arquivos] of Object.entries(lanes)) {
    const conjunto = new Set(arquivos);
    porLane[lane] = somaDe(pares.filter(([a]) => conjunto.has(a)));
  }
  return {
    arquivos: pares.length, porLane, topo,
    maiores: pares.slice(0, 5).map(([arquivo, ms]) => ({ arquivo, parte: ms / soma })),
    acimaDoOrcamento: pares.filter(([, ms]) => ms / soma > 0.026).map(([arquivo, ms]) => ({ arquivo, parte: ms / soma })),
    acimaDaMeta: pares.filter(([, ms]) => ms / soma > 0.013).length,
    comPeloMenos022: pares.filter(([, ms]) => ms / soma >= 0.0022).length,
    abaixoDe0022: pares.filter(([, ms]) => ms / soma < 0.00022).length,
  };
}

/**
 * Sonda 2: o custo isolado dos N arquivos de maior parede sob concorrencia na sonda 1. Por arquivo: testes, a parte da
 * CPU da suite, a CPU de sistema (valor e parte), a CPU por parede, a parede sozinho contra a concorrente e o pico.
 */
function custoDosMaiores(porArquivo, concorrente = {}, n = 10) {
  const linhas = Object.entries(porArquivo).filter(([, m]) => typeof m.userMs === 'number' && typeof m.sysMs === 'number')
    .map(([arquivo, m]) => ({ arquivo, ...m, cpuMs: m.userMs + m.sysMs }));
  const cpuDaSuite = linhas.reduce((s, l) => s + l.cpuMs, 0);
  const testesDaSuite = linhas.reduce((s, l) => s + (l.testes ?? 0), 0);
  if (!cpuDaSuite) return null;
  const maiores = linhas.filter((l) => typeof concorrente[l.arquivo] === 'number')
    .sort((a, b) => concorrente[b.arquivo] - concorrente[a.arquivo] || (a.arquivo < b.arquivo ? -1 : 1)).slice(0, n);
  const somaCpu = maiores.reduce((s, l) => s + l.cpuMs, 0);
  const somaTestes = maiores.reduce((s, l) => s + (l.testes ?? 0), 0);
  return {
    arquivos: maiores.map((l) => ({ arquivo: l.arquivo, testes: l.testes ?? null, parteDaCpu: l.cpuMs / cpuDaSuite,
      cpuMs: l.cpuMs, sistemaMs: l.sysMs, parteDoSistema: l.cpuMs ? l.sysMs / l.cpuMs : null,
      cpuPorParede: l.paredeMs ? l.cpuMs / l.paredeMs : null,
      sozinhoContraConcorrente: concorrente[l.arquivo] ? l.paredeMs / concorrente[l.arquivo] : null, picoKb: l.picoKb ?? null })),
    soma: { testes: somaTestes, parteDosTestes: testesDaSuite ? somaTestes / testesDaSuite : null, parteDaCpu: somaCpu / cpuDaSuite },
  };
}

/**
 * Sonda 3, a parte estatica: quantos comandos de claim rodam teste pelo `node`, quantos rodam arquivo que alguma lane
 * tambem roda e quantos trazem um build na cadeia.
 */
function claimsQueRepetem(comandos, arquivosDasLanes) {
  const lanes = new Set(arquivosDasLanes);
  let comNodeTest = 0, repetemALane = 0, comBuild = 0;
  for (const comando of comandos) {
    const texto = String(comando);
    // Um passo `node` que roda teste: com `--test`, ou com um arquivo `.test.js` (o `node:test` roda os casos sozinho).
    const passos = texto.split(/&&|\|\||[;|]/).filter((p) => /^\s*node\s/.test(p) && (/\s--test(\s|$)/.test(p) || /\.test\.js\b/.test(p)));
    const arquivos = passos.flatMap((p) => [...p.matchAll(/dist-test\/test\/([\w.-]+\.test\.js)/g)].map((m) => m[1]));
    if (passos.length) comNodeTest++;
    if (arquivos.some((a) => lanes.has(a))) repetemALane++;
    if (/\brun build\b|\btsc\b/.test(texto)) comBuild++;
  }
  return { total: comandos.length, comNodeTest, repetemALane, comBuild };
}

/** Sonda 3, pelo ledger: a soma das claims e cada lane em fracao da parede da rodada. */
function pesoNaRodada(rodada) {
  if (!rodada || !(rodada.duracaoMs > 0)) return null;
  const claims = rodada.claims.reduce((s, c) => s + (c.duracaoMs ?? 0), 0);
  const test = rodada.comandos.find((c) => c.nome === 'test');
  const lanes = {};
  for (const l of test?.lanes ?? []) lanes[l.lane] = l.duracaoMs / rodada.duracaoMs;
  const varredura = rodada.comandos.find((c) => c.nome === 'security_scan');
  return { claims: claims / rodada.duracaoMs, test: test?.duracaoMs != null ? test.duracaoMs / rodada.duracaoMs : null, lanes,
    varredura: varredura?.duracaoMs != null ? varredura.duracaoMs / rodada.duracaoMs : null,
    preparo: rodada.preparoMs != null ? rodada.preparoMs / rodada.duracaoMs : null };
}

/**
 * Sonda 4, a selecao de um diff: os testes cujo fecho de `require` alcanca um arquivo alterado (estatico) e, no modo
 * conservador, tambem todo teste que sobe processo quando o diff toca `core/src` (a CLI depende do produto inteiro).
 */
function selecionarPorDiff(fechos, sobeProcesso, alterados) {
  const mudou = new Set(alterados);
  const estatico = Object.keys(fechos).filter((t) => [...fechos[t]].some((f) => mudou.has(f)));
  const tocaSrc = alterados.some((f) => f.startsWith('core/src/'));
  const conservador = new Set(estatico);
  if (tocaSrc) for (const t of sobeProcesso) if (t in fechos) conservador.add(t);
  return { estatico, conservador: [...conservador] };
}

/**
 * Sonda 4 inteira, sobre o grafo e uma lista de diffs (do mais novo para o mais velho): a estrutura (modulos alcancados,
 * os da maioria, a cadeia dos `locale-*`) e, por janela, os testes selecionados e o tempo deles em fracao da soma das
 * duracoes (mediana, minimo, maximo e o terceiro quartil do conservador).
 */
function sondaDoGrafo(fechos, sobeProcesso, diffs, duracoes, janelas = [60, 200]) {
  const testes = Object.keys(fechos);
  const alcance = new Map();
  for (const t of testes) for (const f of fechos[t]) if (f.startsWith('core/src/')) alcance.set(f, (alcance.get(f) ?? 0) + 1);
  const soma = testes.reduce((s, t) => s + (duracoes[t] ?? 0), 0);
  const tempo = (lista) => (soma ? lista.reduce((s, t) => s + (duracoes[t] ?? 0), 0) / soma : null);
  const porJanela = {};
  for (const w of janelas) {
    const sel = diffs.slice(0, w).map((d) => selecionarPorDiff(fechos, sobeProcesso, d));
    const est = sel.map((s) => s.estatico.length), con = sel.map((s) => s.conservador.length);
    const tEst = sel.map((s) => tempo(s.estatico)).filter((x) => x !== null), tCon = sel.map((s) => tempo(s.conservador)).filter((x) => x !== null);
    porJanela[w] = { commits: sel.length,
      estatico: { mediana: quantil(est, 0.5), min: est.length ? Math.min(...est) : null, max: est.length ? Math.max(...est) : null, tempoMediana: quantil(tEst, 0.5) },
      conservador: { mediana: quantil(con, 0.5), min: con.length ? Math.min(...con) : null, max: con.length ? Math.max(...con) : null,
        tempoMediana: quantil(tCon, 0.5), tempoTerceiroQuartil: quantil(tCon, 0.75) } };
  }
  return {
    testes: testes.length, sobeProcesso: sobeProcesso.filter((t) => t in fechos).length, modulosAlcancados: alcance.size,
    modulosDaMaioria: [...alcance.values()].filter((n) => n >= testes.length / 2).length,
    cadeiaLocale: testes.filter((t) => [...fechos[t]].some((f) => /^core\/src\/locale-[^/]*\.ts$/.test(f))).length,
    janelas: porJanela,
  };
}

/** Sonda 5: as pecas do Agile que cairam para o equivalente do Classic numa rodada. */
function pecasEmFallback(rodada) {
  const pecas = Array.isArray(rodada?.pecas) ? rodada.pecas : [];
  return { total: pecas.length, fallback: pecas.filter((p) => p && p.estado === 'fallback').map((p) => p.peca) };
}

/** Troca cada trecho sensivel (a casa, o nome da maquina, as pastas da copia) por um rotulo, em todo texto de um valor. */
function redigir(valor, trocas) {
  const ordem = trocas.filter(([de]) => de && de.length > 1).sort((a, b) => b[0].length - a[0].length);
  const texto = (s) => ordem.reduce((t, [de, para]) => t.split(de).join(para), s);
  const andar = (v) => (typeof v === 'string' ? texto(v) : Array.isArray(v) ? v.map(andar)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [texto(k), andar(x)])) : v);
  return andar(valor);
}

// ---------------------------------------------------------------------------------------------------------------------
// A execucao: a copia, o verify, o passe por arquivo e a espera por carga quieta.

/** O processo medido agora (o verify ou o arquivo do passe), para a parada por sinal encerrar a arvore dele. */
let emCurso = null;

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function ork(cwd, env, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ork ${args.join(' ')} saiu ${r.status}: ${r.stdout}${r.stderr}`);
  return r.stdout;
}

/**
 * Roda um comando com a saida num arquivo e prazo; com `memoria`, amostra por segundo o RSS da arvore e os containers.
 * Com `tempo`, o comando roda sob o `/usr/bin/time`, que grava a CPU dos filhos esperados nesse arquivo.
 */
function executar(cmd, args, { cwd, env, log, prazoMs, memoria = false, tempo = null }) {
  return new Promise((resolve) => {
    const fd = fs.openSync(log, 'w');
    const inicio = Date.now();
    const [bin, argv] = tempo ? [TEMPO, ['-f', FORMATO_DO_TEMPO, '-o', tempo, cmd, ...args]] : [cmd, args];
    const p = spawn(bin, argv, { cwd, env, stdio: ['ignore', fd, fd] });
    emCurso = p.pid;
    const amostras = [];
    const amostrar = () => { try { amostras.push({ arvore: rssDaArvore(p.pid, lerProcessos()), containers: memoriaDosContainers() }); } catch { /* segue */ } };
    const relogio = memoria ? setInterval(amostrar, 1000) : null;
    const prazo = setTimeout(() => { encerrarArvore(p.pid); setTimeout(() => encerrarArvore(p.pid, 'SIGKILL'), 10000).unref(); }, prazoMs);
    p.on('close', (code, sinal) => {
      emCurso = null;
      if (relogio) clearInterval(relogio);
      clearTimeout(prazo);
      fs.closeSync(fd);
      resolve({ code, sinal, paredeMs: Date.now() - inicio, pico: picoAgregado(amostras), amostras: amostras.length });
    });
  });
}

/** Uma rodada do verify com amostra de memoria por segundo; o log vai para um arquivo da copia. */
function rodada(copia, env, thread, modo, log, prazoMs, tempo = null) {
  return executar(process.execPath, [CLI, 'verify', thread, '--check', modo], { cwd: copia, env, log, prazoMs, memoria: true, tempo });
}

function lerOuVazio(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8'); } catch { return ''; }
}

function lerCpuStatAgora() {
  return lerCpuStat(lerOuVazio('/proc/stat'));
}

/** Os processos de verify ou de suite fora desta medicao (nem ela, nem os descendentes, nem quem a chamou). */
function outrasSuites() {
  const tabela = lerProcessos();
  const meus = new Set();
  const filhos = new Map();
  for (const [pid, p] of tabela) { if (!filhos.has(p.ppid)) filhos.set(p.ppid, []); filhos.get(p.ppid).push(pid); }
  const pilha = [process.pid];
  while (pilha.length) { const pid = pilha.pop(); if (meus.has(pid)) continue; meus.add(pid); pilha.push(...(filhos.get(pid) ?? [])); }
  for (let pid = process.ppid; pid > 1 && !meus.has(pid); pid = tabela.get(pid)?.ppid ?? 0) meus.add(pid);
  let n = 0;
  for (const pid of tabela.keys()) {
    if (meus.has(pid)) continue;
    const args = lerOuVazio(`/proc/${pid}/cmdline`).split('\0').filter(Boolean);
    if (eSuite(args)) n++;
  }
  return n;
}

/**
 * Espera a maquina quieta: carga de 1 minuto abaixo do limite, sem outra suite, pela janela inteira; amostra a cada 5 s
 * e desiste no teto (a rodada segue, e a espera fica registrada como estourada).
 */
async function esperarQuieta({ limite, janelaMs, tetoMs, passoMs = 5000 }) {
  const inicio = Date.now();
  const amostras = [];
  for (;;) {
    const carga = Number(lerOuVazio('/proc/loadavg').split(' ')[0]);
    amostras.push({ t: Date.now(), carga, outros: outrasSuites() });
    if (quieta(amostras, limite, janelaMs)) break;
    if (Date.now() - inicio >= tetoMs) {
      return { esperaMs: Date.now() - inicio, quieta: false, amostras: amostras.length,
        cargaMax: Math.max(...amostras.map((a) => a.carga)), outrasSuitesMax: Math.max(...amostras.map((a) => a.outros)) };
    }
    await new Promise((ok) => setTimeout(ok, passoMs));
  }
  return { esperaMs: Date.now() - inicio, quieta: true, amostras: amostras.length,
    cargaMax: Math.max(...amostras.map((a) => a.carga)), outrasSuitesMax: Math.max(...amostras.map((a) => a.outros)) };
}

/** O fecho de `require` relativo de cada teste compilado, em caminhos de fonte (`core/src/x.ts`, `core/test/x.ts`). */
function fechosDeRequire(distTest) {
  const fonte = (abs) => `core/${path.relative(distTest, abs).split(path.sep).join('/').replace(/\.js$/, '.ts')}`;
  const diretos = new Map();
  const requires = (arquivo) => {
    if (diretos.has(arquivo)) return diretos.get(arquivo);
    const lista = [];
    for (const m of lerOuVazio(arquivo).matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
      const alvo = path.resolve(path.dirname(arquivo), m[1]);
      const achado = [alvo, `${alvo}.js`, path.join(alvo, 'index.js')]
        .find((c) => c.startsWith(distTest + path.sep) && fs.existsSync(c) && fs.statSync(c).isFile());
      if (achado) lista.push(achado);
    }
    diretos.set(arquivo, lista);
    return lista;
  };
  const fechos = {};
  const sobeProcesso = [];
  const dirTestes = path.join(distTest, 'test');
  for (const nome of fs.readdirSync(dirTestes).filter((n) => n.endsWith('.test.js')).sort()) {
    const raiz = path.join(dirTestes, nome);
    const visto = new Set([raiz]);
    const pilha = [raiz];
    while (pilha.length) for (const r of requires(pilha.pop())) if (!visto.has(r)) { visto.add(r); pilha.push(r); }
    fechos[nome] = new Set([...visto].map(fonte));
    if (/\bspawn|\bexecFile|dist\/index\.js/.test(lerOuVazio(raiz))) sobeProcesso.push(nome);
  }
  return { fechos, sobeProcesso };
}

/** Os arquivos alterados de cada commit sem merge que tocou `core/src` ou `core/test`, do mais novo para o mais velho. */
function diffsDoHistorico(copia, n) {
  const texto = git(copia, 'log', '--no-merges', `-n${n}`, '--name-only', '--format=@@%H', '--', 'core/src', 'core/test');
  return texto.split('@@').map((b) => b.trim().split('\n').slice(1).filter(Boolean)).filter((l) => l.length);
}

/** Um passe por arquivo: cada arquivo de teste sozinho, em sequencia, sob o `/usr/bin/time`, com a casa do `ork` temporaria. */
async function passePorArquivo(core, env, arquivos, pasta) {
  const casa = fs.mkdtempSync(path.join(env.TMPDIR, 'ork-casa-'));
  const medidas = {};
  const antes = lerCpuStatAgora();
  const inicio = Date.now();
  try {
    for (const nome of arquivos) {
      const tempo = path.join(pasta, 'tempo.txt'), tap = path.join(pasta, 'tap.txt');
      fs.rmSync(tempo, { force: true });
      const r = await executar(process.execPath, ['--test', '--test-reporter=tap', path.join('dist-test', 'test', nome)],
        { cwd: core, env: { ...env, ORKASTERY_HOME: casa }, log: tap, prazoMs: PRAZO_DO_ARQUIVO_MS, tempo });
      const t = lerTempo(lerOuVazio(tempo));
      const c = contarTap(lerOuVazio(tap));
      medidas[nome] = { paredeMs: t?.paredeMs ?? r.paredeMs, userMs: t?.userMs ?? null, sysMs: t?.sysMs ?? null, picoKb: t?.picoKb ?? null,
        testes: c.tests ?? null, falhas: c.fail ?? null, saida: r.code };
    }
  } finally {
    fs.rmSync(casa, { recursive: true, force: true });
  }
  return { paredeMs: Date.now() - inicio, stealPct: stealPct(antes, lerCpuStatAgora()), medidas };
}

function opcoes(args) {
  const valor = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; };
  const pares = Number(valor('--pares', '3'));
  return { agile: Number(valor('--agile', '3')), classic: Number(valor('--classic', '1')), saida: valor('--saida', null),
    prazoMs: Number(valor('--prazo-min', '60')) * 60000, compartilhado: args.includes('--cache-compartilhado'), manter: args.includes('--manter'),
    commit: valor('--commit', null), bancada: args.includes('--bancada'), pares, porArquivo: Number(valor('--por-arquivo', String(pares))),
    linhaDeBase: valor('--linha-de-base', null), claimsDe: valor('--claims-de', null), cargaMax: Number(valor('--carga-max', '2')),
    janelaMs: Number(valor('--janela-quieta-s', '120')) * 1000, esperaMaxMs: Number(valor('--espera-max-min', '60')) * 60000,
    reanalisar: valor('--reanalisar', null) };
}

/**
 * A copia descartavel, com a thread e as claims representativas: devolve as pastas, o ambiente, o ledger e a limpeza.
 * Com `--commit`, a copia sai desse commit (numa branch propria) e a base da thread e o merge-base dele com a base.
 */
function prepararCopia(o) {
  const head = git(RAIZ, 'rev-parse', o.commit ? `${o.commit}^{commit}` : 'HEAD');
  const cacheDeVerdade = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const copias = pastaDasCopias(cacheDeVerdade);
  fs.mkdirSync(copias, { recursive: true, mode: 0o700 });
  const base = fs.realpathSync(fs.mkdtempSync(path.join(copias, 'ork-medir-check-')));
  if (/[0-9a-f]{8}/i.test(base)) throw new Error(`a pasta da medicao tem sequencia hexadecimal de 8: ${base}`);
  const copia = path.join(base, 'projeto');
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ORK_|ORKASTERY_|NODE_TEST_CONTEXT$)/.test(k)) env[k] = v;
  for (const d of ['home', 'cache']) fs.mkdirSync(path.join(base, d));
  const tmp = fs.realpathSync(fs.mkdtempSync('/tmp/ork-mc-'));
  Object.assign(env, { TMPDIR: tmp, HOME: path.join(base, 'home'),
    XDG_CACHE_HOME: o.compartilhado ? cacheDeVerdade : path.join(base, 'cache') });
  const limpar = () => {
    removerContainersDaCopia([base, tmp]);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (o.manter) process.stderr.write(`medir-check: copia mantida em ${base}\n`);
    else fs.rmSync(base, { recursive: true, force: true });
  };
  try {
    const branch = o.commit ? 'medir-check' : git(RAIZ, 'rev-parse', '--abbrev-ref', 'HEAD');
    const { carregarManifesto } = require(path.join(RAIZ, 'core', 'dist', 'manifest.js'));
    const baseBranch = carregarManifesto(RAIZ)?.manifesto.worktree.base_branch || 'main';
    // A base da thread: o merge-base com o `origin/<base>`, senao com a branch local, senao o proprio HEAD (checkout raso).
    const baseDaThread = [`origin/${baseBranch}`, baseBranch].map((ref) => {
      try { return git(RAIZ, 'merge-base', head, ref); } catch { return null; }
    }).find(Boolean) ?? head;
    git(base, 'clone', '--quiet', '--no-checkout', RAIZ, copia);
    git(copia, 'checkout', '--quiet', ...(branch === 'HEAD' ? ['--detach', head] : ['-B', branch, head]));
    git(copia, 'remote', 'remove', 'origin');
    git(copia, 'update-ref', `refs/heads/${baseBranch}`, baseDaThread);
    git(copia, 'update-ref', `refs/remotes/origin/${baseBranch}`, baseDaThread);
    fs.symlinkSync(path.join(RAIZ, 'core', 'node_modules'), path.join(copia, 'core', 'node_modules'));
    // O `.gitignore` casa `node_modules/` so como pasta; o link sujaria a arvore e levaria o destino dele ao diff da thread.
    fs.appendFileSync(path.join(copia, '.git', 'info', 'exclude'), '\n/core/node_modules\n');
    ork(copia, env, 'thread', 'new', 'medicao do check', '--modo', 'auto', '--sem-worktree');
    const threads = fs.readdirSync(path.join(copia, '.orkastery', 'threads'))
      .filter((n) => fs.existsSync(path.join(copia, '.orkastery', 'threads', n, 'thread.json')));
    if (threads.length !== 1) throw new Error(`esperava uma thread na copia, achei ${threads.length}`);
    const [thread] = threads;
    for (const c of CLAIMS_REPRESENTATIVAS) ork(copia, env, 'claims', 'add', thread, c.arquivo, '--claim', c.alegacao, '--verificar', c.verificar);
    const ledger = path.join(copia, '.orkastery', 'threads', thread, 'ledger.jsonl');
    return { head, branch, baseDaThread, base, copia, tmp, env, thread, ledger, limpar };
  } catch (e) {
    limpar();
    throw e;
  }
}

/** Liga a parada por sinal: encerra o processo medido e limpa a copia. Devolve o desligamento. */
function pararPorSinal(limpar) {
  const parar = (sinal) => {
    process.stderr.write(`medir-check: ${sinal}, encerrando o verify em curso e a copia\n`);
    if (emCurso) encerrarArvore(emCurso);
    limpar();
    process.exit(sinal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGTERM', parar);
  process.once('SIGINT', parar);
  return () => { process.removeListener('SIGTERM', parar); process.removeListener('SIGINT', parar); };
}

function ultimaRodada(ledger, jaLidas) {
  const doLedger = lerRodadas(fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '');
  return doLedger.length > jaLidas ? doLedger[doLedger.length - 1] : null;
}

async function principal(args) {
  const o = opcoes(args);
  if (o.bancada && o.reanalisar) return escreverBancada(JSON.parse(fs.readFileSync(o.reanalisar, 'utf8')), o);
  if (o.bancada) return bancada(o);
  const c = prepararCopia(o);
  const desligar = pararPorSinal(c.limpar);
  const logs = o.saida ? `${o.saida}.d` : null;
  if (logs) fs.mkdirSync(logs, { recursive: true });
  try {
    const resultado = [];
    const fila = [...Array(o.agile).fill('agile'), ...Array(o.classic).fill('classic')];
    for (const [i, modo] of fila.entries()) {
      const log = path.join(c.base, `rodada-${i + 1}-${modo}.log`);
      const r = await rodada(c.copia, c.env, c.thread, modo, log, o.prazoMs);
      if (logs) fs.copyFileSync(log, path.join(logs, path.basename(log)));
      const ultima = ultimaRodada(c.ledger, resultado.length);
      resultado.push({ n: i + 1, pedido: modo, saida: r.code, sinal: r.sinal, paredeMs: r.paredeMs, picoBytes: r.pico.bytes,
        picoArvore: r.pico.arvore, picoContainers: r.pico.containers, amostras: r.amostras, ...(ultima ?? { modo: null, ok: false, duracaoMs: null }) });
      process.stderr.write(`medir-check: rodada ${i + 1} (${modo}) ${ultima?.duracaoMs ?? '?'} ms no ledger, ${r.paredeMs} ms de parede, ` +
        `pico ${(r.pico.bytes / 1024 ** 3).toFixed(2)} GiB, saida ${r.code}\n`);
    }
    const resumo = {
      contrato: 'ork.medir-check/v1', head: c.head, branch: c.branch, base: c.baseDaThread, cache: o.compartilhado ? 'compartilhado' : 'isolado',
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
    desligar();
    c.limpar();
  }
}

/** As listas de cada lane: a evidencia que o verify gravou na copia, senao as do `test-lanes.cjs` da copia. */
function listasDaCopia(copia, rodadaAgile) {
  if (rodadaAgile?.evidenciaDasLanes) {
    try {
      const dados = JSON.parse(fs.readFileSync(path.join(copia, rodadaAgile.evidenciaDasLanes), 'utf8'));
      return Object.fromEntries(dados.lanes.map((l) => [l.lane, l.arquivos]));
    } catch { /* cai para as listas do script */ }
  }
  const l = require(path.join(copia, 'core', 'scripts', 'test-lanes.cjs')).listasDasLanes();
  return { hermetica: l.hermetica, integracao: l.integracao };
}

/** A parede por arquivo sob concorrencia que o reporter das lanes deixou no cache da copia, so dos arquivos das lanes. */
function duracoesDoReporter(xdg, lanes) {
  const todas = {};
  for (const lane of Object.keys(lanes)) {
    let dados = {};
    try { dados = JSON.parse(fs.readFileSync(path.join(xdg, 'orkastery', 'check', `duracoes-${lane}.json`), 'utf8')); } catch { /* sem cache */ }
    for (const a of lanes[lane]) if (typeof dados[a] === 'number') todas[a] = dados[a];
  }
  return todas;
}

/** Os comandos de claim de um `claims.jsonl`: o ultimo registro de cada id, com o `verificar` em texto. */
function comandosDeClaims(texto) {
  const porId = new Map();
  for (const linha of String(texto).split('\n')) {
    let c;
    try { c = JSON.parse(linha); } catch { continue; }
    if (c && c.id && c.verificar !== undefined) porId.set(c.id, Array.isArray(c.verificar) ? c.verificar.join(' && ') : String(c.verificar));
  }
  return [...porId.values()];
}

/**
 * RM-074 (M0): os pares Agile e Classic e o passe por arquivo no mesmo commit, com a espera por carga quieta e o roubo de
 * CPU de cada rodada; devolve o JSON da bancada com as contas e as sondas.
 */
async function bancada(o) {
  if (!fs.existsSync(TEMPO)) throw new Error(`a bancada precisa do GNU time em ${TEMPO}`);
  const c = prepararCopia(o);
  const desligar = pararPorSinal(c.limpar);
  const logs = o.saida ? `${o.saida}.d` : c.base;
  fs.mkdirSync(logs, { recursive: true });
  const nucleos = os.availableParallelism();
  const core = path.join(c.copia, 'core');
  const espera = () => esperarQuieta({ limite: o.cargaMax, janelaMs: o.janelaMs, tetoMs: o.esperaMaxMs });
  const avisar = (texto) => process.stderr.write(`medir-check: ${texto}\n`);
  const bruto = { commit: c.head, base: c.baseDaThread, cache: o.compartilhado ? 'compartilhado' : 'isolado', nucleos,
    memoriaBytes: os.totalmem(), pastas: { copia: c.copia, base: c.base, tmp: c.tmp }, rodadas: [], passes: [], lanes: null, fechos: null,
    sobeProcesso: [], diffs: [], claimsRef: null };
  const guardar = () => fs.writeFileSync(path.join(logs, 'bruto.json'), JSON.stringify(bruto) + '\n');
  try {
    const { rodadas, passes } = bruto;
    let lanes = null;
    for (let k = 1; k <= o.pares; k++) {
      for (const modo of ['agile', 'classic']) {
        const esperou = await espera();
        avisar(`par ${k} ${modo}: esperou ${Math.round(esperou.esperaMs / 1000)} s (quieta: ${esperou.quieta})`);
        const log = path.join(logs, `par-${k}-${modo}.log`);
        const tempo = path.join(logs, `par-${k}-${modo}.tempo`);
        const antes = lerCpuStatAgora();
        const r = await rodada(c.copia, c.env, c.thread, modo, log, o.prazoMs, tempo);
        const steal = stealPct(antes, lerCpuStatAgora());
        const ultima = ultimaRodada(c.ledger, rodadas.length);
        const cpu = lerTempo(lerOuVazio(tempo));
        const registro = { par: k, pedido: modo, espera: esperou, stealPct: steal, saida: r.code, sinal: r.sinal, paredeMs: r.paredeMs,
          cpuDaArvoreMs: cpu ? cpu.userMs + cpu.sysMs : null, userMs: cpu?.userMs ?? null, sysMs: cpu?.sysMs ?? null,
          picoBytes: r.pico.bytes, picoArvore: r.pico.arvore, picoContainers: r.pico.containers, amostras: r.amostras,
          ...(ultima ?? { modo: null, ok: false, duracaoMs: null, comandos: [], claims: [], pecas: [] }) };
        if (modo === 'agile') {
          lanes = listasDaCopia(c.copia, ultima);
          registro.duracoesPorArquivo = duracoesDoReporter(c.env.XDG_CACHE_HOME, lanes);
        }
        rodadas.push(registro);
        bruto.lanes = lanes;
        guardar();
        avisar(`par ${k} ${modo}: ${ultima?.duracaoMs ?? '?'} ms no ledger, steal ${steal?.toFixed(1) ?? '?'}%, saida ${r.code}`);
      }
      if (k <= o.porArquivo) {
        const esperou = await espera();
        avisar(`passe ${k}: esperou ${Math.round(esperou.esperaMs / 1000)} s (quieta: ${esperou.quieta})`);
        const arquivos = [...(lanes?.hermetica ?? []), ...(lanes?.integracao ?? [])].sort();
        const pasta = fs.mkdtempSync(path.join(c.tmp, 'passe-'));
        const p = await passePorArquivo(core, c.env, arquivos, pasta);
        passes.push({ passe: k, espera: esperou, ...p });
        guardar();
        avisar(`passe ${k}: ${arquivos.length} arquivos, steal ${p.stealPct?.toFixed(1) ?? '?'}%`);
      }
    }
    const { fechos, sobeProcesso } = fechosDeRequire(path.join(core, 'dist-test'));
    bruto.fechos = Object.fromEntries(Object.entries(fechos).map(([t, f]) => [t, [...f].sort()]));
    bruto.sobeProcesso = sobeProcesso;
    bruto.diffs = diffsDoHistorico(c.copia, 200);
    bruto.claimsRef = o.claimsDe ? comandosDeClaims(fs.readFileSync(o.claimsDe, 'utf8')) : null;
    guardar();
    return escreverBancada(bruto, o);
  } finally {
    desligar();
    c.limpar();
  }
}

/** O JSON com profundidade: indentado ate o nivel dado e compacto abaixo dele (a tabela por arquivo, uma linha cada). */
function jsonRaso(valor, nivel = 3, recuo = '') {
  if (nivel <= 0 || valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  const dentro = recuo + ' ';
  const itens = Array.isArray(valor) ? valor.map((v) => jsonRaso(v, nivel - 1, dentro))
    : Object.entries(valor).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}: ${jsonRaso(v, nivel - 1, dentro)}`);
  if (!itens.length) return Array.isArray(valor) ? '[]' : '{}';
  const [abre, fecha] = Array.isArray(valor) ? ['[', ']'] : ['{', '}'];
  return `${abre}\n${itens.map((i) => dentro + i).join(',\n')}\n${recuo}${fecha}`;
}

/** As contas sobre o bruto da bancada, redigidas, no `--saida` e no stdout. */
function escreverBancada(bruto, o) {
  const linhaDeBase = o.linhaDeBase ? JSON.parse(fs.readFileSync(o.linhaDeBase, 'utf8')) : null;
  const fechos = Object.fromEntries(Object.entries(bruto.fechos ?? {}).map(([t, f]) => [t, new Set(f)]));
  const resumo = analisarBancada({ rodadas: bruto.rodadas, passes: bruto.passes, lanes: bruto.lanes ?? {}, nucleos: bruto.nucleos,
    linhaDeBase, fechos, sobeProcesso: bruto.sobeProcesso ?? [], diffs: bruto.diffs ?? [], claimsRef: bruto.claimsRef ?? null });
  const saida = {
    contrato: 'ork.medir-check.bancada/v1', commit: bruto.commit, base: bruto.base, cache: bruto.cache,
    maquina: { nucleos: bruto.nucleos, memoriaBytes: bruto.memoriaBytes, node: process.version, plataforma: process.platform },
    criterios: { cargaMax: o.cargaMax, janelaQuietaMs: o.janelaMs, esperaMaxMs: o.esperaMaxMs, pares: bruto.rodadas.filter((r) => r.pedido === 'agile').length,
      porArquivo: bruto.passes.length },
    claims: CLAIMS_REPRESENTATIVAS,
    ...resumo,
  };
  const p = bruto.pastas ?? {};
  const trocas = [[p.copia, '<copia>'], [p.base, '<bancada>'], [p.tmp, '<tmp>'], [RAIZ, '<raiz>'], [os.homedir(), '~'], [os.hostname(), '<maquina>']];
  const texto = jsonRaso(redigir(saida, trocas), 4) + '\n';
  if (o.saida) fs.writeFileSync(o.saida, texto);
  process.stdout.write(texto);
  return 0;
}

/**
 * As contas da bancada sobre as rodadas e os passes ja medidos: a razao de cada par, a CPU da suite por passe e por lane,
 * a eficiencia de cada lane, o corte de CPU, a variacao entre rodadas e as sondas 1 a 5.
 */
function analisarBancada({ rodadas, passes, lanes, nucleos, linhaDeBase = null, fechos = {}, sobeProcesso = [], diffs = [], claimsRef = null }) {
  const laneDe = {};
  for (const [lane, arquivos] of Object.entries(lanes)) for (const a of arquivos) laneDe[a] = lane;
  const cpuDoPasse = (p) => {
    const porLane = {};
    let total = 0;
    for (const [a, m] of Object.entries(p.medidas)) {
      const cpu = (m.userMs ?? 0) + (m.sysMs ?? 0);
      total += cpu;
      const lane = laneDe[a] ?? 'fora';
      porLane[lane] = (porLane[lane] ?? 0) + cpu;
    }
    return { total, porLane };
  };
  const cpuPorPasse = passes.map((p) => ({ passe: p.passe, ...cpuDoPasse(p), testes: Object.values(p.medidas).reduce((s, m) => s + (m.testes ?? 0), 0),
    arquivosComFalha: Object.entries(p.medidas).filter(([, m]) => m.saida !== 0).map(([a]) => a) }));
  const testeDe = (a) => passes.map((p) => p.medidas[a]?.testes).find((n) => typeof n === 'number') ?? null;
  const porLane = {};
  for (const [lane, arquivos] of Object.entries(lanes)) {
    porLane[lane] = { arquivos: arquivos.length, testes: arquivos.reduce((s, a) => s + (testeDe(a) ?? 0), 0), lista: arquivos };
  }
  const pares = [];
  const ks = [...new Set(rodadas.map((r) => r.par))];
  for (const k of ks) {
    const a = rodadas.find((r) => r.par === k && r.pedido === 'agile');
    const cl = rodadas.find((r) => r.par === k && r.pedido === 'classic');
    const passe = cpuPorPasse.find((p) => p.passe === k) ?? cpuPorPasse[cpuPorPasse.length - 1] ?? null;
    const laneMs = (r, lane) => r?.comandos.find((x) => x.nome === 'test')?.lanes?.find((l) => l.lane === lane)?.duracaoMs ?? null;
    const testMs = (r) => r?.comandos.find((x) => x.nome === 'test')?.duracaoMs ?? null;
    const ef = {};
    for (const lane of Object.keys(lanes)) ef[lane] = passe ? eficiencia(passe.porLane[lane], nucleos, laneMs(a, lane)) : null;
    pares.push({
      par: k, ambosAprovados: !!(a?.ok && cl?.ok),
      razao: razao(cl?.duracaoMs, a?.duracaoMs), razaoDaCpu: razao(cl?.cpuDaArvoreMs, a?.cpuDaArvoreMs),
      picoAgileSobreClassic: a?.picoBytes && cl?.picoBytes ? a.picoBytes / cl.picoBytes : null,
      eficiencia: { ...ef, suiteNoAgile: passe ? eficiencia(passe.total, nucleos, testMs(a)) : null,
        suiteNoClassic: passe ? eficiencia(passe.total, nucleos, testMs(cl)) : null },
      stealPct: { agile: a?.stealPct ?? null, classic: cl?.stealPct ?? null },
    });
  }
  const baseCpu = linhaDeBase?.cpuDaSuite?.variacao?.media ?? variacao(cpuPorPasse.map((p) => p.total))?.media ?? null;
  const cortes = cpuPorPasse.map((p) => ({ passe: p.passe, corte: corte(p.total, baseCpu) }));
  const agiles = rodadas.filter((r) => r.pedido === 'agile');
  const classics = rodadas.filter((r) => r.pedido === 'classic');
  const sonda1 = agiles.map((r) => ({ par: r.par, ...concentracao(r.duracoesPorArquivo ?? {}, lanes) }));
  const sonda2 = passes.map((p, i) => ({ passe: p.passe, ...custoDosMaiores(p.medidas, agiles[i]?.duracoesPorArquivo ?? {}, 10) }));
  const arquivosDasLanes = Object.values(lanes).flat();
  const sonda3 = {
    bancada: claimsQueRepetem(CLAIMS_REPRESENTATIVAS.map((c) => c.verificar), arquivosDasLanes),
    ...(claimsRef ? { referencia: claimsQueRepetem(claimsRef, arquivosDasLanes) } : {}),
    peso: rodadas.map((r) => ({ par: r.par, modo: r.pedido, ...pesoNaRodada(r) })),
  };
  const sonda4 = Object.keys(fechos).length ? agiles.map((r) => ({ par: r.par, ...sondaDoGrafo(fechos, sobeProcesso, diffs, r.duracoesPorArquivo ?? {}) })) : [];
  const sonda5 = agiles.map((r) => ({ par: r.par, ...pecasEmFallback(r) }));
  const porArquivo = Object.keys(laneDe).sort().map((a) => ({ arquivo: a, lane: laneDe[a], testes: testeDe(a),
    passes: passes.map((p) => p.medidas[a] ?? null), concorrenteMs: agiles.map((r) => r.duracoesPorArquivo?.[a] ?? null) }));
  return {
    lanes: porLane,
    pares,
    variacao: {
      razao: variacao(pares.map((p) => p.razao)),
      razaoDaCpu: variacao(pares.map((p) => p.razaoDaCpu)),
      agileMs: variacao(agiles.map((r) => r.duracaoMs)), classicMs: variacao(classics.map((r) => r.duracaoMs)),
      cpuDaSuiteMs: variacao(cpuPorPasse.map((p) => p.total)),
      eficiencia: Object.fromEntries([...Object.keys(lanes), 'suiteNoAgile', 'suiteNoClassic']
        .map((l) => [l, variacao(pares.map((p) => p.eficiencia[l]))])),
      stealPct: variacao([...rodadas.map((r) => r.stealPct), ...passes.map((p) => p.stealPct)]),
      picoAgileSobreClassic: variacao(pares.map((p) => p.picoAgileSobreClassic)),
    },
    cpuDaSuite: { porPasse: cpuPorPasse.map(({ arquivosComFalha: _f, ...resto }) => resto), variacao: variacao(cpuPorPasse.map((p) => p.total)),
      arquivosComFalha: [...new Set(cpuPorPasse.flatMap((p) => p.arquivosComFalha))] },
    corte: { base: linhaDeBase ? 'linha de base' : 'media desta medicao', baseMs: baseCpu, porPasse: cortes },
    sondas: { 1: sonda1, 2: sonda2, 3: sonda3, 4: sonda4, 5: sonda5 },
    rodadas: rodadas.map(({ duracoesPorArquivo: _d, ...resto }) => resto),
    passes: passes.map(({ medidas: _m, ...resto }) => resto),
    porArquivo,
  };
}

module.exports = { lerRodadas, tresConsecutivas, rssDaArvore, picoAgregado, pastaDasCopias, encerrarArvore, CLAIMS_REPRESENTATIVAS,
  razao, eficiencia, corte, variacao, quantil, lerCpuStat, stealPct, quieta, eSuite, lerTempo, contarTap, concentracao,
  custoDosMaiores, claimsQueRepetem, pesoNaRodada, selecionarPorDiff, sondaDoGrafo, pecasEmFallback, redigir, comandosDeClaims,
  fechosDeRequire, analisarBancada, jsonRaso };

if (require.main === module) {
  principal(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`medir-check: ${e.message}\n`); process.exit(1); });
}
