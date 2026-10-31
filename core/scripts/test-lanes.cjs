#!/usr/bin/env node
/**
 * RM-072 (fatia 1 do Agile Check): as lanes de teste deste projeto.
 *
 * O Classic roda a suite inteira num comando so (`npm test`: build, build:test e `node --test dist-test/test/*.test.js`).
 * O Agile roda o mesmo glob em duas lanes ao mesmo tempo, sem build dentro (o preparo do verify compila uma vez e a
 * guarda do produto confere): a `hermetica`, que e o conjunto do `test:ci`, e a `integracao`, que sao os arquivos de
 * `src/integracoes-locais.ts` (Docker, OrkMind, sandbox real). A uniao das duas e o glob do `npm test`, e a lista de cada
 * uma vai ao relatorio do CHECK (`ORK_CHECK_RELATORIO`), que o verify grava.
 *
 * O ambiente e o do `npm test`: a casa do `ork` temporaria (como `casa-temporaria.cjs`) e o resto como vem de quem chama
 * (inclusive `ORK_TESTE_EXIGE_AMBIENTE`, que o CI hospedado liga). As duas lanes juntas nao passam da CPU da maquina: a `hermetica` roda dois arquivos a
 * menos que as CPUs (a varredura e a `integracao`, que o verify encadeia depois dela, correm ao lado), e a `integracao`, dois
 * arquivos por vez, na prioridade de sempre (o `nice` so baixava o processo do teste, nunca os containers dele).
 *
 * Orcamento por arquivo: os arquivos rodam do mais longo para o mais curto pela ultima duracao medida (a cauda comeca
 * cedo e corre junto do resto). A duracao de cada arquivo vem do reporter `reporter-duracoes.mjs`, ao lado do TAP, e
 * fica em `$XDG_CACHE_HOME/orkastery/check/duracoes-<lane>.json`; quem passa
 * do orcamento (`ORK_CHECK_ORCAMENTO_MS`, padrao 120 s) e acusado no relatorio, sem reprovar: o veredito e o dos testes.
 * O cache de compilacao do Node (`NODE_COMPILE_CACHE`) fica em `$XDG_CACHE_HOME/orkastery/check/compile-cache`.
 *
 *   node scripts/test-lanes.cjs hermetica|integracao
 *   node scripts/test-lanes.cjs --conferir     confere as listas contra o glob do npm test e sai
 *
 * Para os testes do proprio script: `ORK_LANES_DIR` troca a pasta dos testes e `ORK_LANES_INTEGRACAO` (nomes separados por
 * virgula) troca a lista de integracao.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const CORE = path.resolve(__dirname, '..');
const DIR_DOS_TESTES = path.join(CORE, 'dist-test', 'test');
const LANES = ['hermetica', 'integracao'];
const ORCAMENTO_PADRAO_MS = 120000;
const REPORTER = path.join(__dirname, 'reporter-duracoes.mjs');
const CONCORRENCIA_DA_INTEGRACAO = 2;
const ENV_TMPFS = 'ORK_CHECK_TMPFS';
const ENV_CPUS_APOS_VARREDURA = 'ORK_CHECK_CPUS_DA_LANE_APOS_VARREDURA';
const ENV_CPUS_APOS_RESERVA = 'ORK_CHECK_CPUS_DA_LANE_APOS_RESERVA';
const ENV_SINAL_DA_RESERVA = 'ORK_CHECK_RESERVA_DEVOLVIDA';
const ENV_CONTAINERS_DA_LANE = 'ORK_CHECK_CONTAINERS_DA_LANE';
const TMPFS_MAGIC = 0x01021994;

/**
 * Quantos arquivos a lane roda ao mesmo tempo. O agendador passa a fatia calculada para esta rodada; sem ela, vale o
 * contrato anterior (dois na integracao e CPUs menos duas na hermetica).
 */
function concorrenciaDaLane(lane, cpus = os.availableParallelism(), limiteDoGrupo = Number(process.env.ORK_CHECK_CPUS_DA_LANE)) {
  if (Number.isFinite(limiteDoGrupo) && limiteDoGrupo > 0) return Math.max(1, Math.min(cpus, Math.floor(limiteDoGrupo)));
  return lane === 'integracao' ? CONCORRENCIA_DA_INTEGRACAO : Math.max(1, cpus - 2);
}

/** O pool dinamico so existe na hermetica do grupo paralelo, com sinal e cota final maiores que a inicial. */
function planoDoPool(lane, cpus = os.availableParallelism(), env = process.env) {
  const inicial = concorrenciaDaLane(lane, cpus, Number(env.ORK_CHECK_CPUS_DA_LANE));
  const intermediariaInformada = Number(env[ENV_CPUS_APOS_VARREDURA]);
  const informada = Number(env[ENV_CPUS_APOS_RESERVA]);
  const final = Number.isFinite(informada) && informada > 0 ? Math.max(inicial, Math.min(cpus, Math.floor(informada))) : inicial;
  const aposVarredura = Number.isFinite(intermediariaInformada) && intermediariaInformada > 0
    ? Math.max(inicial, Math.min(final, Math.floor(intermediariaInformada))) : inicial;
  const sinal = env[ENV_SINAL_DA_RESERVA];
  return lane === 'hermetica' && sinal && final > inicial ? { inicial, aposVarredura, final, sinal } : null;
}

/** Linhas completas e monotonicas do sinal; duplicata, regressao e excesso nunca abrem vaga. */
function degrausDaReserva(texto, vagasAtuais, final, vistos = new Set()) {
  let vagas = vagasAtuais;
  const aplicados = [];
  for (const linha of texto.split('\n').filter(Boolean)) {
    let r;
    try { r = JSON.parse(linha); } catch { continue; }
    if (r?.contrato !== 'ork.check.reserva-devolvida/v2' || !['varredura', 'integracao'].includes(r.origem)
      || vistos.has(r.origem) || !Number.isInteger(r.vagas) || !Number.isInteger(r.vagasGanhas)
      || r.vagas < vagas || r.vagas > final || r.vagasGanhas !== r.vagas - vagas || typeof r.em !== 'string') continue;
    vistos.add(r.origem);
    vagas = r.vagas;
    aplicados.push({ origem: r.origem, em: r.em, vagasGanhas: r.vagasGanhas, vagas });
  }
  return { vagas, aplicados };
}
const MINIMO_DA_HERMETICA = 100;

/** A pasta dos testes e a lista de integracao: as do nucleo, ou as do ambiente nos testes do script. */
function origem() {
  const dir = process.env.ORK_LANES_DIR ? path.resolve(process.env.ORK_LANES_DIR) : DIR_DOS_TESTES;
  const integracao = process.env.ORK_LANES_INTEGRACAO !== undefined
    ? new Set(process.env.ORK_LANES_INTEGRACAO.split(',').map((n) => n.trim()).filter(Boolean))
    : require(path.join(CORE, 'dist', 'integracoes-locais.js')).TESTES_DE_INTEGRACAO_LOCAL;
  return { dir, integracao };
}

/** As listas das lanes a partir do que o build de teste gerou; a de integracao e a lista unica do nucleo. */
function listasDasLanes(dir = origem().dir, integracao = origem().integracao) {
  const todos = fs.readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort();
  for (const nome of integracao) {
    if (!todos.includes(nome)) throw new Error(`lane de integracao obsoleta: ${nome} nao existe em dist-test/test`);
  }
  const lanes = { hermetica: todos.filter((n) => !integracao.has(n)), integracao: todos.filter((n) => integracao.has(n)) };
  if (!process.env.ORK_LANES_DIR && lanes.hermetica.length < MINIMO_DA_HERMETICA) {
    throw new Error(`lane hermetica pequena demais: ${lanes.hermetica.length} arquivos`);
  }
  return { todos, ...lanes };
}

/** O que o glob do `npm test` (`dist-test/test/*.test.js`, expandido pelo shell) entrega, sem o caminho. */
function globDoNpmTest() {
  const r = spawnSync('bash', ['-c', 'for f in dist-test/test/*.test.js; do printf "%s\\n" "${f##*/}"; done'], { cwd: CORE, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`glob do npm test falhou: ${r.stderr}`);
  return r.stdout.split('\n').filter(Boolean).sort();
}

function conferir() {
  const l = listasDasLanes();
  const glob = globDoNpmTest();
  const uniao = [...l.hermetica, ...l.integracao].sort();
  const repetidos = l.hermetica.filter((n) => l.integracao.includes(n));
  const erros = [];
  if (repetidos.length) erros.push(`arquivo nas duas lanes: ${repetidos.join(', ')}`);
  if (JSON.stringify(uniao) !== JSON.stringify(glob)) {
    const falta = glob.filter((n) => !uniao.includes(n)), sobra = uniao.filter((n) => !glob.includes(n));
    erros.push(`a uniao das lanes nao e o glob do npm test (fora das lanes: ${falta.join(', ') || 'nenhum'}; fora do glob: ${sobra.join(', ') || 'nenhum'})`);
  }
  if (erros.length) {
    process.stderr.write(`test-lanes: ${erros.join('; ')}\n`);
    return 1;
  }
  process.stdout.write(`lanes conferidas: ${glob.length} arquivos no glob do npm test = ${l.hermetica.length} na hermetica + ` +
    `${l.integracao.length} na integracao\n`);
  return 0;
}

function dirDoCache() {
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.cache'), 'orkastery', 'check');
}

/** Confere filesystem em memoria, espaco e escrita sem depender do nome ou do tamanho de uma maquina. */
function sondarTmpfs(dir) {
  try {
    if (!path.isAbsolute(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, motivo: 'candidato-ausente' };
    const s = fs.statfsSync(dir, { bigint: true });
    if (Number(s.type) !== TMPFS_MAGIC) return { ok: false, motivo: 'filesystem-nao-e-tmpfs' };
    const teste = fs.mkdtempSync(path.join(dir, 'ork-check-sonda-'));
    try { fs.writeFileSync(path.join(teste, 'gravavel'), 'ok', { mode: 0o600 }); }
    finally { fs.rmSync(teste, { recursive: true, force: true }); }
    return { ok: true, livres: Number(s.bavail * s.bsize) };
  } catch (e) {
    return { ok: false, motivo: `sonda-falhou:${String(e.code || e.message)}` };
  }
}

/**
 * O tmpfs e opt-in ate a bancada provar ganho. `auto` exige ao menos um quarto da memoria livre e espaco no tmpfs
 * equivalente ao menor entre um quarto da memoria livre e um decimo da memoria total; qualquer duvida usa disco.
 */
function selecionarTemporario({ chave = process.env[ENV_TMPFS], disco = os.tmpdir(),
  candidatos = [process.env.XDG_RUNTIME_DIR, '/dev/shm'].filter(Boolean), memoriaLivre = os.freemem(), memoriaTotal = os.totalmem(),
  sondar = sondarTmpfs } = {}) {
  if (chave !== 'auto') return { diretorio: disco, estado: 'fallback', motivo: chave ? `chave-${chave}` : 'desligado-por-padrao' };
  if (!(memoriaTotal > 0) || memoriaLivre / memoriaTotal < 0.25) {
    return { diretorio: disco, estado: 'fallback', motivo: 'memoria-livre-sem-folga' };
  }
  const necessario = Math.min(memoriaLivre / 4, memoriaTotal / 10);
  const motivos = [];
  for (const candidato of [...new Set(candidatos)]) {
    const r = sondar(candidato);
    if (r.ok && r.livres >= necessario) return { diretorio: candidato, estado: 'agile', motivo: 'tmpfs-gravavel-com-folga' };
    motivos.push(`${candidato}:${r.ok ? 'espaco-sem-folga' : r.motivo}`);
  }
  return { diretorio: disco, estado: 'fallback', motivo: motivos.length ? motivos.join(';') : 'sem-candidato-tmpfs' };
}

function lerDuracoes(arquivo) {
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
  } catch { return {}; }
}

/** Do mais longo para o mais curto pela ultima duracao; arquivo sem medida vai antes (pode ser o longo novo). */
function ordenarPorDuracao(arquivos, duracoes) {
  const conhecida = (n) => (typeof duracoes[n] === 'number' && Number.isFinite(duracoes[n]) ? duracoes[n] : null);
  return [...arquivos].sort((a, b) => {
    const da = conhecida(a), db = conhecida(b);
    if (da === null && db === null) return a < b ? -1 : a > b ? 1 : 0;
    if (da === null) return -1;
    if (db === null) return 1;
    return db - da || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/**
 * As duracoes por arquivo que o reporter `reporter-duracoes.mjs` escreveu (caminho absoluto para ms), pelo nome do
 * arquivo. O TAP de varios arquivos nao diz o arquivo dos testes que passam; o reporter le os eventos do runner.
 */
function lerDuracoesDoReporter(arquivo) {
  let bruto = {};
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return {}; }
  const fonte = bruto && bruto.versao === 2 && bruto.duracoes && typeof bruto.duracoes === 'object' ? bruto.duracoes : bruto;
  const duracoes = {};
  for (const [caminho, ms] of Object.entries(fonte)) {
    if (typeof ms === 'number' && Number.isFinite(ms)) duracoes[path.basename(caminho)] = Math.round(ms);
  }
  return duracoes;
}

/** Resultados nominais do reporter; formato antigo de so duracoes nao inventa evidencia. */
function lerResultadosDoReporter(arquivo) {
  let bruto;
  try { bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return []; }
  if (!bruto || bruto.versao !== 2 || !Array.isArray(bruto.testes)) return [];
  return bruto.testes.filter((t) => t && typeof t.arquivo === 'string' && typeof t.nome === 'string'
    && ['pass', 'fail', 'skip', 'todo'].includes(t.estado))
    .map((t) => ({ arquivo: path.basename(t.arquivo), nome: t.nome, nesting: Number.isInteger(t.nesting) ? t.nesting : 0, estado: t.estado }));
}

/** Mesmo ambiente funcional entre a lane e a claim; variaveis de transporte/runner nao mudam o teste. */
function assinaturaDoAmbiente(env) {
  const ignorada = (nome) => nome.startsWith('npm_') || nome.startsWith('NPM_')
    || ['ORK_CHECK_RELATORIO', 'ORK_CHECK_CPUS_DA_LANE', ENV_CPUS_APOS_VARREDURA, ENV_CPUS_APOS_RESERVA, ENV_SINAL_DA_RESERVA,
      ENV_CONTAINERS_DA_LANE, 'ORK_CHECK_CPUS_DOCKER',
      'NODE_TEST_CONTEXT', 'NODE_COMPILE_CACHE', 'PWD', 'OLDPWD', 'SHLVL', '_', 'INIT_CWD'].includes(nome);
  const pares = Object.entries(env).filter(([nome, valor]) => valor !== undefined && !ignorada(nome))
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(pares)).digest('hex');
}

function relatar(linha) {
  const arquivo = process.env.ORK_CHECK_RELATORIO;
  if (!arquivo) return;
  try { fs.appendFileSync(arquivo, JSON.stringify(linha) + '\n'); } catch { /* o relatorio e evidencia, nao condicao do teste */ }
}

/** Soma um campo do sumario TAP de cada processo de arquivo. */
function totalDoTap(resultados, campo) {
  return resultados.reduce((total, r) => {
    const m = new RegExp(`^# ${campo} ([0-9]+)$`, 'm').exec(r.tap);
    return total + Number(m?.[1] ?? 0);
  }, 0);
}

/** Um TAP valido: cada arquivo conserva seu TAP inteiro como subteste do pool. */
function emitirTapDoPool(resultados, duracaoMs) {
  process.stdout.write('TAP version 13\n');
  resultados.forEach((r, i) => {
    process.stdout.write(`# Subtest: ${r.arquivo}\n`);
    process.stdout.write(r.tap.trimEnd().split('\n').map((linha) => `    ${linha}`).join('\n') + '\n');
    process.stdout.write(`${r.code === 0 ? 'ok' : 'not ok'} ${i + 1} - ${r.arquivo}\n`);
  });
  process.stdout.write(`1..${resultados.length}\n`);
  for (const campo of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    process.stdout.write(`# ${campo} ${totalDoTap(resultados, campo)}\n`);
  }
  process.stdout.write(`# duration_ms ${duracaoMs}\n`);
}

/**
 * Pool LPT da hermetica. Cada arquivo conserva o isolamento do runner e grava TAP/reporter proprios; o controlador
 * so abre vagas novas quando o grupo cria o sinal depois de varredura e integracao.
 */
function rodarPoolDeArquivos({ arquivos, dir, env, pastaDaLane, plano }) {
  const inicio = Date.now();
  const resultados = new Array(arquivos.length);
  let proximo = 0, ativos = 0, concluidos = 0, vagas = plano.inicial;
  const vistos = new Set();
  const caminho = (nome) => (process.env.ORK_LANES_DIR ? path.join(dir, nome) : path.join('dist-test', 'test', nome));
  const observarSinal = () => {
    if (!fs.existsSync(plano.sinal)) return;
    let texto = '';
    try { texto = fs.readFileSync(plano.sinal, 'utf8'); } catch { return; }
    const lidos = degrausDaReserva(texto, vagas, plano.final, vistos);
    vagas = lidos.vagas;
    for (const registro of lidos.aplicados) relatar({ tipo: 'peca', peca: 'agendador-cpu', estado: 'agile',
      motivo: `${registro.origem} devolveu ${registro.vagasGanhas} vaga(s) aos ${Math.round((Date.parse(registro.em) - inicio) / 1000)} s `
        + `da lane; hermetica passou a ${registro.vagas} vagas`, devolvidaEm: registro.em });
  };
  return new Promise((resolve) => {
    const lancar = () => {
      observarSinal();
      while (ativos < vagas && proximo < arquivos.length) {
        const i = proximo++, arquivo = arquivos[i];
        const tap = path.join(pastaDaLane, `${i}.tap`), reporter = path.join(pastaDaLane, `${i}.json`);
        const args = ['--test', '--test-concurrency=1', '--test-reporter=tap', `--test-reporter-destination=${tap}`,
          `--test-reporter=${REPORTER}`, `--test-reporter-destination=${reporter}`, caminho(arquivo)];
        ativos++;
        const filho = spawn(process.execPath, args, { cwd: CORE, env, stdio: ['ignore', 'ignore', 'inherit'] });
        filho.on('close', (code, signal) => {
          resultados[i] = { arquivo, code: code ?? (signal ? 1 : 1), tap: (() => { try { return fs.readFileSync(tap, 'utf8'); } catch { return ''; } })(),
            medidas: lerDuracoesDoReporter(reporter), testes: lerResultadosDoReporter(reporter) };
          ativos--; concluidos++;
          if (concluidos === arquivos.length) {
            clearInterval(sonda);
            emitirTapDoPool(resultados, Date.now() - inicio);
            resolve({ code: resultados.some((r) => r.code !== 0) ? 1 : 0,
              medidas: Object.assign({}, ...resultados.map((r) => r.medidas)), testes: resultados.flatMap((r) => r.testes) });
          } else lancar();
        });
      }
    };
    const sonda = setInterval(lancar, 25);
    lancar();
  });
}

function rodarLane(lane) {
  const { dir } = origem();
  const listas = listasDasLanes();
  const cache = dirDoCache();
  const arquivoDeDuracoes = path.join(cache, `duracoes-${lane}.json`);
  const anteriores = lerDuracoes(arquivoDeDuracoes);
  const arquivos = ordenarPorDuracao(listas[lane], anteriores);
  const orcamento = Number(process.env.ORK_CHECK_ORCAMENTO_MS) > 0 ? Number(process.env.ORK_CHECK_ORCAMENTO_MS) : ORCAMENTO_PADRAO_MS;
  relatar({ tipo: 'lista', lane, arquivos: [...listas[lane]] });
  const temporario = selecionarTemporario();
  relatar({ tipo: 'peca', peca: 'tmpfs-das-lanes', estado: temporario.estado, motivo: temporario.motivo,
    ...(temporario.estado === 'fallback' ? { fallback: 'disco' } : {}) });
  const pastaDaLane = fs.mkdtempSync(path.join(temporario.diretorio, 'ork-lanes-'));
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: CORE, encoding: 'utf8' }).stdout.trim();

  // O ambiente e o de quem chama, como no `npm test`: quem exporta ORK_TESTE_EXIGE_AMBIENTE exige as dependencias nos dois
  // modos (S4 do CHECK).
  const env = { ...process.env };
  // A lane e sempre uma rodada de topo: sob outro `node --test`, o pai marca o filho com NODE_TEST_CONTEXT e o `node
  // --test` da lane falaria o protocolo do runner, sem o TAP e sem o reporter das duracoes.
  delete env.NODE_TEST_CONTEXT;
  // O modo, o relatorio e o plano de CPU sao da rodada do verify, nao dos testes: o teste que roda a varredura
  // gravaria pecas no relatorio da rodada, o que confia no modo padrao rodaria no modo do verify, e os testes que
  // conferem concorrencia ou argv do Docker observariam a fatia da lane. A propria lane ja consumiu a fatia acima,
  // ao montar --test-concurrency; so o node --test filho deve ficar sem ela.
  delete env.ORK_CHECK_MODO;
  delete env.ORK_CHECK_RELATORIO;
  delete env.ORK_CHECK_CPUS_DA_LANE;
  delete env[ENV_CPUS_APOS_VARREDURA];
  delete env[ENV_CPUS_APOS_RESERVA];
  delete env[ENV_SINAL_DA_RESERVA];
  delete env.ORK_CHECK_CPUS_DOCKER;
  env.TMPDIR = pastaDaLane;
  let casa = null;
  if (!(env.ORKASTERY_HOME || '').trim()) { casa = fs.mkdtempSync(path.join(pastaDaLane, 'ork-casa-')); env.ORKASTERY_HOME = casa; }
  const ambiente = assinaturaDoAmbiente(env);
  try {
    fs.mkdirSync(path.join(cache, 'compile-cache'), { recursive: true });
    env.NODE_COMPILE_CACHE = path.join(cache, 'compile-cache');
  } catch (e) {
    relatar({ tipo: 'peca', peca: 'compile-cache', estado: 'fallback', motivo: String(e.code || e.message), fallback: 'sem cache de compilacao' });
  }
  const terminar = ({ code, medidas, testes }) => {
      try {
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(arquivoDeDuracoes, JSON.stringify({ ...anteriores, ...medidas }, null, 1) + '\n');
      } catch { /* sem cache de duracao, a proxima rodada usa a ordem alfabetica */ }
      const acima = Object.entries(medidas).filter(([, ms]) => ms > orcamento).sort((a, b) => b[1] - a[1])
        .map(([arquivo, ms]) => ({ arquivo, ms }));
      const maiores = Object.entries(medidas).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([arquivo, ms]) => ({ arquivo, ms }));
      relatar({ tipo: 'duracoes', lane, orcamentoMs: orcamento, medidos: Object.keys(medidas).length, acima, maiores });
      relatar({ tipo: 'resultados', lane, head, ambiente, testes });
      fs.rmSync(pastaDaLane, { recursive: true, force: true });
      return code;
  };
  const plano = planoDoPool(lane);
  if (plano) return rodarPoolDeArquivos({ arquivos, dir, env, pastaDaLane, plano }).then(terminar);
  const arquivoDoReporter = path.join(pastaDaLane, 'duracoes.json');
  const args = ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER}`, `--test-reporter-destination=${arquivoDoReporter}`,
    `--test-concurrency=${concorrenciaDaLane(lane)}`,
    ...arquivos.map((n) => (process.env.ORK_LANES_DIR ? path.join(dir, n) : path.join('dist-test', 'test', n)))];
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, args, { cwd: CORE, env, stdio: ['ignore', 'pipe', 'inherit'] });
    filho.stdout.on('data', (d) => process.stdout.write(d));
    filho.on('close', (code, signal) => resolve(terminar({ code: code ?? (signal ? 1 : 1),
      medidas: lerDuracoesDoReporter(arquivoDoReporter), testes: lerResultadosDoReporter(arquivoDoReporter) })));
  });
}

module.exports = { listasDasLanes, ordenarPorDuracao, lerDuracoesDoReporter, lerResultadosDoReporter, assinaturaDoAmbiente,
  globDoNpmTest, concorrenciaDaLane, planoDoPool, degrausDaReserva, selecionarTemporario, sondarTmpfs, ENV_TMPFS,
  ENV_CPUS_APOS_VARREDURA, ENV_CPUS_APOS_RESERVA, ENV_SINAL_DA_RESERVA, LANES, REPORTER };

if (require.main === module) {
  const [alvo] = process.argv.slice(2);
  if (alvo === '--conferir') process.exitCode = conferir();
  else if (!LANES.includes(alvo)) {
    process.stderr.write(`uso: test-lanes.cjs ${LANES.join('|')} | --conferir\n`);
    process.exitCode = 2;
  }
  else rodarLane(alvo).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`test-lanes: ${e.message}\n`); process.exitCode = 1; });
}
