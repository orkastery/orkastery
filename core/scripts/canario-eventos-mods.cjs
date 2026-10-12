#!/usr/bin/env node
/**
 * RM-059 (T0.9): canario de eventos dos mods do Claude Code.
 *
 * A API de mods esta em acesso antecipado e muda entre releases sem aviso (R1 do GOAL da thread
 * ork-modsorquestr). Este canario junta os eventos e as chamadas de `$` que os mods do Orkastery usam
 * (o contrato fixo dos 10 mods do plano e o que os mods de `adapters/claude-code/mods/` chamam de fato)
 * e procura cada nome no binario do `claude`: o build que tirar um deles reprova aqui, antes de um mod
 * cair calado numa sessao. O evento classico e procurado sem o prefixo `classic.`, porque o binario
 * monta o nome completo. Um nome de controle inventado precisa ficar ausente, senao a busca nao
 * discrimina nada.
 *
 * Com `--com-plugin`, roda antes `claude plugin validate --strict` e `claude plugin test` em cada mod:
 * e o passo do job `mods` do CI, com o Claude Code fixado do registro do npm e sem credencial.
 *
 *   node core/scripts/canario-eventos-mods.cjs [--json]       canario no binario do claude do PATH
 *   node core/scripts/canario-eventos-mods.cjs --com-plugin   validate e test de cada mod, depois o canario
 *   [--binario ARQ]   procura neste arquivo em vez do binario do claude (os testes usam um falso)
 *   [--claude CMD]    o claude que roda --version, validate e test (padrao: o do PATH)
 *   [--mods DIR]      a pasta dos mods (padrao: adapters/claude-code/mods da raiz do repositorio)
 *
 * Sai 0 com tudo achado e todo mod aprovado; 1 com nome faltando, controle achado ou mod reprovado; 2
 * com uso errado, `claude` ausente ou o invólucro do npm sem o binario nativo.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..', '..');
const MODS = 'adapters/claude-code/mods';

/**
 * Os eventos e as chamadas de `$` dos 10 mods do plano (campos "Evento/hook" e "Chamadas da API" do
 * plano da ork-modsorquestr), mais o `classic.SessionStart` dos `watchPaths` da ponte. Mudar esta
 * lista e mudar o contrato que o canario protege: vai junto com o plano.
 */
const CONTRATO = [
  'classic.PostToolBatch', 'classic.FileChanged', 'classic.SessionStart', 'classic.TaskCreated',
  'classic.TaskCompleted', 'classic.TeammateIdle', 'session.start', 'session.send', 'session.receive',
  'ui.render', 'ui.press', 'command.run', 'turn.complete',
  'mcp.call', 'process.run', 'process.spawn', 'state.get', 'state.set', 'store.get', 'store.set',
  'clock.every', 'ui.notify', 'ui.toast', 'ui.status', 'ui.open', 'ui.invalidate', 'fs.stat',
  'session.usage', 'env.get',
];
/** Nome que nenhum build tem: se ele aparecer, o arquivo procurado nao e o binario. */
const CONTROLE = 'classic.OrkEventoInexistenteDeControle';
/** O invólucro do npm sem o binario nativo tem poucos bytes; o binario do Claude Code, centenas de MB. */
const MENOR_BINARIO = 8 * 1024 * 1024;
const BLOCO = 16 * 1024 * 1024;
const MODULO = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const FORA_DO_MODULO = new Set(['test', 'tests', '__tests__', 'types', '.claude-plugin', 'node_modules']);

/** Os arquivos de modulo de um mod: fonte do hooks module, fora de testes, tipos e manifesto. */
function arquivosDoModulo(dir) {
  const achados = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const alvo = path.join(dir, e.name);
    if (e.isDirectory()) { if (!FORA_DO_MODULO.has(e.name)) achados.push(...arquivosDoModulo(alvo)); continue; }
    if (e.isFile() && MODULO.test(e.name) && !/\.(?:test|spec)\.[a-z]+$/.test(e.name)) achados.push(alvo);
  }
  return achados;
}

/** Os eventos (`on('evento'`) e as chamadas de `$` (`$.noun.metodo(`) que o fonte de um mod usa. */
function nomesDoMod(dir) {
  const nomes = new Set();
  for (const arquivo of arquivosDoModulo(dir)) {
    const texto = fs.readFileSync(arquivo, 'utf8');
    for (const m of texto.matchAll(/\bon\(\s*(['"`])([A-Za-z][\w.-]*)\1/g)) nomes.add(m[2]);
    for (const m of texto.matchAll(/\$\.([a-z][A-Za-z]*)\.([a-z][A-Za-z]*)\s*\(/g)) nomes.add(`${m[1]}.${m[2]}`);
  }
  return [...nomes].sort();
}

/** As pastas de mod (com `orkastery-mod.json`) da pasta dos mods; vazio quando ela nao existe. */
function modsDaPasta(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'orkastery-mod.json')))
    .map((e) => e.name).sort();
}

/** O nome como ele aparece no binario: o evento classico vem sem o prefixo. */
const comoNoBinario = (nome) => (nome.startsWith('classic.') ? nome.slice('classic.'.length) : nome);

/**
 * Procura cada nome no arquivo, em blocos, com a sobra do bloco anterior para o nome que cruza a
 * fronteira. Devolve os achados e os que faltam, pelos nomes pedidos.
 */
function procurar(arquivo, nomes) {
  const pendentes = new Map(nomes.map((n) => [n, Buffer.from(comoNoBinario(n), 'utf8')]));
  const maior = Math.max(1, ...[...pendentes.values()].map((b) => b.length));
  const buf = Buffer.alloc(BLOCO + maior);
  const fd = fs.openSync(arquivo, 'r');
  try {
    let posicao = 0;
    let sobra = 0;
    for (;;) {
      const lidos = fs.readSync(fd, buf, sobra, BLOCO, posicao);
      if (lidos <= 0) break;
      posicao += lidos;
      const janela = buf.subarray(0, sobra + lidos);
      for (const [nome, bytes] of pendentes) if (janela.indexOf(bytes) >= 0) pendentes.delete(nome);
      if (pendentes.size === 0) break;
      sobra = Math.min(maior - 1, janela.length);
      janela.copy(buf, 0, janela.length - sobra);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { achados: nomes.filter((n) => !pendentes.has(n)), faltando: nomes.filter((n) => pendentes.has(n)) };
}

/** O executavel `nome` do PATH, ou null. */
function noPath(nome) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const alvo = path.join(dir, nome);
    try {
      fs.accessSync(alvo, fs.constants.X_OK);
      if (fs.statSync(alvo).isFile()) return alvo;
    } catch { /* segue */ }
  }
  return null;
}

/** As ultimas linhas da saida, para o relatorio. */
const fim = (r) => `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-6).join('\n').slice(-600);

function opcao(argv, nome) {
  const i = argv.indexOf(nome);
  if (i < 0) return undefined;
  const valor = argv[i + 1];
  if (valor === undefined || valor.startsWith('--')) throw new Error(`uso: ${nome} pede um valor`);
  return valor;
}

/** Roda o canario e devolve o relatorio e o codigo de saida. */
function canario(argv) {
  const comPlugin = argv.includes('--com-plugin');
  const pastaDosMods = path.resolve(opcao(argv, '--mods') || path.join(RAIZ, MODS));
  const claude = opcao(argv, '--claude') || noPath('claude');
  const binarioPedido = opcao(argv, '--binario');
  const relatorio = {
    formato: 'ork.canario-mods/v1', ok: false, claude: { comando: claude, versao: null, binario: null },
    mods: modsDaPasta(pastaDosMods), plugin: [], nomes: { contrato: CONTRATO.length, dosMods: 0, procurados: [], faltando: [] },
    controle: { nome: CONTROLE, achado: null }, erro: null,
  };
  const recusa = (erro) => ({ relatorio: { ...relatorio, erro }, codigo: 2 });
  if (!claude && (comPlugin || !binarioPedido)) return recusa('claude fora do PATH: instale o Claude Code ou passe --claude e --binario');
  if (claude) {
    const v = spawnSync(claude, ['--version'], { encoding: 'utf8', timeout: 60000 });
    relatorio.claude.versao = v.status === 0 ? (v.stdout || '').trim().split('\n')[0] : null;
  }
  let binario = binarioPedido ? path.resolve(binarioPedido) : null;
  if (!binario) {
    binario = fs.realpathSync(claude);
    const bytes = fs.statSync(binario).size;
    if (bytes < MENOR_BINARIO) return recusa(`o claude achado (${binario}, ${bytes} bytes) e o invólucro, sem o binario nativo: rode o postinstall do pacote`);
  }
  if (!fs.existsSync(binario) || !fs.statSync(binario).isFile()) return recusa(`binario ${binario} nao existe`);
  relatorio.claude.binario = binario;
  let pluginOk = true;
  if (comPlugin) {
    for (const mod of relatorio.mods) {
      const dir = path.join(pastaDosMods, mod);
      for (const args of [['plugin', 'validate', '--strict', dir], ['plugin', 'test', dir]]) {
        const r = spawnSync(claude, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
        const ok = r.status === 0;
        pluginOk = pluginOk && ok;
        relatorio.plugin.push({ mod, comando: `claude ${args.slice(0, -1).join(' ')}`, ok, codigo: r.status, saida: ok ? '' : fim(r) });
      }
    }
  }
  const dosMods = relatorio.mods.flatMap((mod) => nomesDoMod(path.join(pastaDosMods, mod)));
  const nomes = [...new Set([...CONTRATO, ...dosMods])];
  relatorio.nomes.dosMods = new Set(dosMods).size;
  relatorio.nomes.procurados = nomes;
  const busca = procurar(binario, [...nomes, CONTROLE]);
  relatorio.nomes.faltando = busca.faltando.filter((n) => n !== CONTROLE);
  relatorio.controle.achado = busca.achados.includes(CONTROLE);
  relatorio.ok = pluginOk && relatorio.nomes.faltando.length === 0 && !relatorio.controle.achado;
  return { relatorio, codigo: relatorio.ok ? 0 : 1 };
}

function texto(r) {
  const linhas = ['canario dos mods do Claude Code'];
  if (r.erro) return [...linhas, `  erro       ${r.erro}`].join('\n');
  linhas.push(`  claude     ${r.claude.versao || 'versao nao lida'}; procurado em ${r.claude.binario}`);
  linhas.push(`  mods       ${r.mods.length ? `${r.mods.length}: ${r.mods.join(', ')}` : `nenhum em ${MODS}`}`);
  for (const p of r.plugin) linhas.push(`  plugin     ${p.mod}: ${p.comando} ${p.ok ? 'ok' : `REPROVOU (codigo ${p.codigo})`}${p.saida ? `\n             ${p.saida.split('\n').join('\n             ')}` : ''}`);
  linhas.push(`  nomes      ${r.nomes.procurados.length} procurados (${r.nomes.contrato} do contrato do plano, ${r.nomes.dosMods} dos mods), ${r.nomes.procurados.length - r.nomes.faltando.length} achados`);
  if (r.nomes.faltando.length) linhas.push(`  FALTANDO   ${r.nomes.faltando.join(', ')}`);
  linhas.push(`  controle   ${r.controle.nome} ${r.controle.achado ? 'ACHADO: o arquivo procurado nao e o binario do Claude Code' : 'ausente, como deve'}`);
  linhas.push(`  resultado  ${r.ok ? 'ok' : 'REPROVADO'}`);
  return linhas.join('\n');
}

function main(argv) {
  let saida;
  try {
    saida = canario(argv);
  } catch (e) {
    saida = { relatorio: { formato: 'ork.canario-mods/v1', ok: false, erro: e.message }, codigo: 2 };
  }
  console.log(argv.includes('--json') ? JSON.stringify(saida.relatorio, null, 2) : texto(saida.relatorio));
  return saida.codigo;
}

module.exports = { CONTRATO, CONTROLE, MODS, nomesDoMod, modsDaPasta, procurar, comoNoBinario, canario };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
