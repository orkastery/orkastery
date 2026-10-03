#!/usr/bin/env node
'use strict';
/**
 * RM-031 (pacote do npm): prova que o grafo de codigo roda em quem instala o `ork` pelo npm.
 *
 * Empacota o `@orkastery/cli` desta arvore (`npm pack`, com o `prepack` de verdade), instala o
 * tarball global num prefixo e num HOME de um diretorio temporario, com ambiente limpo, e num
 * repositorio novo roda `ork init`, `ork grafo status`, `ork grafo indexar`, `ork grafo chamadores`
 * e o `ork doctor`. Depois tira o `typescript` da instalacao e confere que o doctor aponta a falta
 * com a correcao e que o grafo recusa. A unica rede e a do registro do npm, para as dependencias do
 * pacote: o cache do runner hospedado so tem os tarballs do `npm ci`, sem os metadados que o
 * `--offline` pediria. A instalacao roda com `--ignore-scripts` (nenhuma dependencia do pacote tem
 * script de instalacao) e a prova nunca roda num job com credencial de publicacao: as transitivas
 * vem do registro, sem lockfile. Roda no CI (job `nucleo` e o job `provar-grafo` do `publicar.yml`),
 * fora da suite hermetica.
 *
 *   node core/scripts/provar-grafo-instalado.cjs            prova e imprime as medidas em JSON
 *   node core/scripts/provar-grafo-instalado.cjs --manter   deixa o diretorio temporario no disco
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { DIRETORIOS, ARQUIVOS } = require('./preparar-pacote.js');

const CORE = path.resolve(__dirname, '..');
const PRAZO_DO_NPM_MS = 600_000;
const PRAZO_DO_ORK_MS = 180_000;
/**
 * O `timeout` na frente encerra o comando no prazo. Com `--foreground` ele fica no grupo de processos
 * da prova: Ctrl-C ou o prazo de quem roda a prova (o `ork verify`) alcancam o npm e o ork junto, e o
 * `finally` limpa o temporario. Sem ele, o `timeout` abriria grupo proprio e sobreviveria ao node.
 */
const TIMEOUT_BIN = '/usr/bin/timeout';
/** As copias que o `prepack` monta em `core/` e o `postpack` tira, pela lista do proprio script. */
const COPIAS_DO_PREPACK = [...DIRETORIOS, ...ARQUIVOS];
const ALVO = 'src/soma.ts#soma';
const CHAMADOR = 'symbol src/dobro.ts#dobro';
const CHAMADO = `symbol ${ALVO}`;

/** O ambiente de cada comando: nada de quem chama; HOME, prefixo e cache do npm no temporario. */
function ambienteLimpo(base, node = process.execPath) {
  return {
    HOME: path.join(base, 'home'),
    // O `ork` instalado vem antes; o Node e o npm sao os de quem roda a prova (a matriz do CI).
    PATH: [path.join(base, 'npm', 'bin'), path.dirname(node), '/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter),
    LANG: 'C.UTF-8',
    TZ: 'UTC',
    npm_config_prefix: path.join(base, 'npm'),
    npm_config_cache: path.join(base, 'npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };
}

/** Os comandos do npm: o pack nao usa rede; a instalacao busca as dependencias no registro. */
function comandos(core, base, tarball) {
  return {
    pack: { bin: 'npm', args: ['pack', '--offline', '--pack-destination', base], cwd: core },
    instalar: { bin: 'npm', args: ['install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', tarball], cwd: base },
    ork: path.join(base, 'npm', 'bin', 'ork'),
    instalacao: path.join(base, 'npm', 'lib', 'node_modules', '@orkastery', 'cli'),
  };
}

function falhar(passo, detalhe) {
  throw new Error(`prova.${passo}: ${detalhe}`);
}

/** As versoes que os rotulos dos extratores tem de mostrar, lidas das dependencias do pacote. */
function esperadoDoPacote(pacote, versaoDoNode = process.versions.node) {
  const d = (pacote && pacote.dependencies) || {};
  for (const nome of ['typescript', 'micromark', 'micromark-extension-gfm-table']) {
    if (!/^\d+\.\d+\.\d+$/.test(d[nome] || '')) falhar('pacote', `${nome} sem versao exata em dependencies (${d[nome] || 'ausente'})`);
  }
  return {
    typescript: d.typescript,
    javascript: `node.${versaoDoNode}`,
    markdown: `micromark.${d.micromark}.gfm-table.${d['micromark-extension-gfm-table']}`,
  };
}

/** `ork grafo status --json`: analisadores com as versoes do pacote, sem erro, e o indice do HEAD no estado pedido. */
function conferirStatus(status, esperado, indice) {
  if (!status || status.erro !== null) falhar('status', `analisadores indisponiveis: ${status ? status.erro : 'sem resposta'}`);
  for (const [chave, valor] of Object.entries(esperado)) {
    const achado = status.analisadores ? status.analisadores[chave] : undefined;
    if (achado !== valor) falhar('status', `${chave} ${achado} na instalacao, ${valor} no pacote`);
  }
  if (status.correcao !== null) falhar('status', `correcao sem erro: ${status.correcao}`);
  if (status.indice_do_head !== indice) falhar('status', `indice do HEAD ${status.indice_do_head}, ${indice} esperado`);
}

/** `ork grafo indexar --json`: o indice nasce, com as arestas que o repositorio de ensaio tem. */
function conferirIndice(resultado) {
  if (!resultado || resultado.estado !== 'criado') falhar('indexar', `estado ${resultado ? resultado.estado : 'ausente'}, criado esperado`);
  const arestas = (resultado.manifesto && resultado.manifesto.contagens && resultado.manifesto.contagens.arestas) || {};
  for (const tipo of ['calls', 'imports', 'references']) {
    if (!(arestas[tipo] >= 1)) falhar('indexar', `nenhuma aresta ${tipo} no indice`);
  }
}

/** `ork grafo chamadores --json`: a aresta `calls` de `dobro` para `soma`, provada pelo `ork.ts-ast`. */
function conferirChamadores(resposta) {
  const arestas = (resposta && resposta.arestas) || [];
  const achou = arestas.some((a) => a.kind === 'calls' && a.from === CHAMADOR && a.to === CHAMADO
    && (a.evidencias || []).some((e) => e.extractor_id === 'ork.ts-ast'));
  if (!achou) falhar('chamadores', `a aresta calls de ${CHAMADOR} para ${CHAMADO} pelo ork.ts-ast nao veio (${arestas.length} aresta(s))`);
}

/** A linha do check no relatorio do `ork doctor` e a correcao logo abaixo dela, quando ha. */
function linhaDoDoctor(texto) {
  const linhas = String(texto).split('\n');
  const i = linhas.findIndex((l) => /^\s+\[(?:ok|warn|FAIL)\]\s+analisadores do grafo\s{2,}/.test(l));
  if (i < 0) falhar('doctor', 'o relatorio nao traz o check analisadores do grafo');
  const nivel = /\[(ok|warn|FAIL)\]/.exec(linhas[i])[1];
  const correcao = /^\s+correcao: (.*)$/.exec(linhas[i + 1] || '');
  return { nivel, linha: linhas[i].trim(), correcao: correcao ? correcao[1] : null };
}

/** O doctor sem o `typescript`: `warn`, com a recusa e a correcao do npm na versao do pacote. */
function conferirDoctorSemCompilador(doctor, versao) {
  if (doctor.nivel !== 'warn') falhar('doctor sem typescript', `nivel ${doctor.nivel}, warn esperado: ${doctor.linha}`);
  if (!doctor.linha.includes('grafo.parser.indisponivel: typescript')) falhar('doctor sem typescript', `sem a recusa: ${doctor.linha}`);
  const correcao = `npm install -g @orkastery/cli@${versao}`;
  if (!doctor.correcao || !doctor.correcao.includes(correcao)) falhar('doctor sem typescript', `sem a correcao ${correcao}: ${doctor.correcao}`);
}

/** O executavel e os argumentos de um comando com prazo: o `timeout` em primeiro plano, quando existe. */
function comandoComPrazo(bin, args, prazoMs, timeoutBin = TIMEOUT_BIN) {
  const segundos = Math.ceil(prazoMs / 1000);
  return fs.existsSync(timeoutBin) ? [timeoutBin, ['--foreground', '--kill-after=15', String(segundos), bin, ...args]] : [bin, args];
}

function rodar(passo, bin, args, cwd, env, prazoMs, aceitos = [0]) {
  const segundos = Math.ceil(prazoMs / 1000);
  const [exe, argv] = comandoComPrazo(bin, args, prazoMs);
  const r = spawnSync(exe, argv, { cwd, env, encoding: 'utf8', timeout: prazoMs + 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.signal || !aceitos.includes(r.status)) {
    const saida = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-20).join('\n');
    const como = r.error ? r.error.code : r.signal || (r.status === 124 ? `prazo de ${segundos} s` : `status ${r.status}`);
    falhar(passo, `${path.basename(bin)} ${args.join(' ')} saiu com ${como}\n${saida}`);
  }
  return r;
}

function jsonDe(passo, r) {
  try {
    return JSON.parse(r.stdout);
  } catch {
    return falhar(passo, `a saida nao e JSON: ${r.stdout.slice(0, 300)}`);
  }
}

/** Bytes, espaco em disco (blocos, como o `du`) e arquivos da instalacao, sem seguir link simbolico. */
function medirInstalacao(dir) {
  let bytes = 0, disco = 0, arquivos = 0;
  const pilha = [dir];
  while (pilha.length) {
    const atual = pilha.pop();
    for (const e of fs.readdirSync(atual, { withFileTypes: true })) {
      const f = path.join(atual, e.name);
      if (e.isDirectory()) pilha.push(f);
      else if (e.isFile()) {
        const st = fs.lstatSync(f);
        bytes += st.size; disco += st.blocks * 512; arquivos++;
      }
    }
  }
  return { bytes, disco, arquivos };
}

/** O repositorio de ensaio: uma funcao, quem a chama por import e um Markdown com link para ela. */
function criarRepositorio(dir, env) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'soma.ts'), 'export function soma(a: number, b: number): number {\n  return a + b;\n}\n');
  fs.writeFileSync(path.join(dir, 'src', 'dobro.ts'),
    "import { soma } from './soma';\n\nexport function dobro(x: number): number {\n  return soma(x, x);\n}\n");
  fs.writeFileSync(path.join(dir, 'README.md'), '# Ensaio do grafo\n\nVeja [a soma](src/soma.ts).\n');
  const git = (...args) => rodar('repositorio', 'git', args, dir, env, 60_000);
  git('init', '-q', '-b', 'main');
  git('add', '--', 'src/soma.ts', 'src/dobro.ts', 'README.md');
  git('-c', 'user.name=ensaio', '-c', 'user.email=ensaio@exemplo.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'inicial');
}

function provar(opcoes = {}) {
  const core = opcoes.core || CORE;
  const pacote = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
  const esperado = esperadoDoPacote(pacote);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ork-grafo-instalado-')));
  const env = ambienteLimpo(base);
  // O `postpack` tira as copias; se o pack cair no meio, a limpeza tira as que esta prova criou.
  const copiasNovas = COPIAS_DO_PREPACK.filter((n) => !fs.existsSync(path.join(core, n)));
  const inicio = Date.now();
  try {
    fs.mkdirSync(env.HOME, { recursive: true });
    const semTarball = comandos(core, base, '');
    rodar('pack', semTarball.pack.bin, semTarball.pack.args, semTarball.pack.cwd, env, PRAZO_DO_NPM_MS);
    const tarballs = fs.readdirSync(base).filter((n) => n.endsWith('.tgz'));
    if (tarballs.length !== 1) falhar('pack', `${tarballs.length} tarball(s) em ${base}, um esperado`);
    const tarball = path.join(base, tarballs[0]);
    const c = comandos(core, base, tarball);
    const instalado = rodar('instalar', c.instalar.bin, c.instalar.args, c.instalar.cwd, env, PRAZO_DO_NPM_MS);
    const npm = rodar('npm', 'npm', ['--version'], base, env, 60_000).stdout.trim();

    const repo = path.join(base, 'repo');
    criarRepositorio(repo, env);
    const ork = (passo, args, aceitos) => rodar(passo, c.ork, args, repo, env, PRAZO_DO_ORK_MS, aceitos);
    ork('init', ['init']);
    conferirStatus(jsonDe('status', ork('status', ['grafo', 'status', '--json'])), esperado, 'ausente');
    const indice = jsonDe('indexar', ork('indexar', ['grafo', 'indexar', '--json']));
    conferirIndice(indice);
    conferirChamadores(jsonDe('chamadores', ork('chamadores', ['grafo', 'chamadores', ALVO, '--json'])));
    conferirStatus(jsonDe('status', ork('status', ['grafo', 'status', '--json'])), esperado, 'presente');
    // Sem o `claude` no PATH o doctor sai 1 (bloqueado); o que conta aqui e o check do grafo.
    const doctor = linhaDoDoctor(ork('doctor', ['doctor'], [0, 1]).stdout);
    if (doctor.nivel !== 'ok') falhar('doctor', doctor.linha);
    const medida = medirInstalacao(c.instalacao);

    // Sem o compilador dentro da instalacao: o doctor avisa com a correcao, e o grafo recusa.
    fs.rmSync(path.join(c.instalacao, 'node_modules', 'typescript'), { recursive: true, force: true });
    conferirDoctorSemCompilador(linhaDoDoctor(ork('doctor sem typescript', ['doctor'], [0, 1]).stdout), pacote.version);
    const recusa = ork('indexar sem typescript', ['grafo', 'indexar'], [1]);
    if (!`${recusa.stdout}\n${recusa.stderr}`.includes('grafo.parser.indisponivel: typescript')) {
      falhar('indexar sem typescript', `sem a recusa grafo.parser.indisponivel: typescript: ${recusa.stderr.trim()}`);
    }
    const semCompilador = jsonDe('status sem typescript', ork('status sem typescript', ['grafo', 'status', '--json']));
    if (semCompilador.indice_do_head !== 'indisponivel' || !String(semCompilador.correcao).includes(`npm install -g @orkastery/cli@${pacote.version}`)) {
      falhar('status sem typescript', `indice ${semCompilador.indice_do_head}, correcao ${semCompilador.correcao}`);
    }

    const pacotes = /added (\d+) packages?/.exec(instalado.stdout);
    return {
      ok: true,
      origem: 'tarball do npm pack desta arvore, instalado com npm install -g em prefixo e HOME temporarios',
      versao: pacote.version, node: process.version, npm,
      tarball: { nome: tarballs[0], bytes: fs.statSync(tarball).size },
      instalacao: { pacotes: pacotes ? Number(pacotes[1]) : null, bytes: medida.bytes, disco: medida.disco, arquivos: medida.arquivos },
      analisadores: esperado,
      indice: { chave: indice.chave, arestas: indice.manifesto.contagens.arestas },
      doctor: { comTypescript: doctor.nivel, semTypescript: 'warn' },
      ms: Date.now() - inicio,
      ...(opcoes.manter ? { diretorio: base } : {}),
    };
  } finally {
    if (!opcoes.manter) fs.rmSync(base, { recursive: true, force: true });
    for (const n of copiasNovas) fs.rmSync(path.join(core, n), { recursive: true, force: true });
  }
}

module.exports = {
  ambienteLimpo, comandos, comandoComPrazo, esperadoDoPacote, conferirStatus, conferirIndice, conferirChamadores, linhaDoDoctor,
  conferirDoctorSemCompilador, criarRepositorio, medirInstalacao, rodar, provar, COPIAS_DO_PREPACK,
};

if (require.main === module) {
  // Ctrl-C ou o prazo de quem roda a prova: o sinal chega tambem ao comando em curso (mesmo grupo), e o
  // node, que nao morre no meio, ve o spawnSync voltar com o comando morto; o passo falha e o `finally`
  // limpa o temporario. O handler so impede a morte imediata do node.
  for (const sinal of ['SIGINT', 'SIGTERM']) process.once(sinal, () => { if (!process.exitCode) process.exitCode = 1; });
  try {
    console.log(JSON.stringify(provar({ manter: process.argv.includes('--manter') }), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
