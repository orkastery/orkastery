/**
 * RM-031, correcao de empacotamento: o grafo de codigo funciona em quem instala o `ork` pelo npm.
 *
 * Grupos: "grafo no pacote: dependencias" (os pacotes que os analisadores carregam sao dependencias
 * de runtime com versao exata, e os docs dizem quantas dependencias o pacote tem), "lockfile" (o
 * fecho dos analisadores nao fica marcado dev, e nenhum pacote de producao roda script de instalacao),
 * "doctor" (o check analisadores do grafo), "status" (a correcao no `ork grafo status`), "script" (as
 * partes puras da prova de instalacao limpa, que roda no CI com o registro do npm; aqui, sem rede, os
 * conferidores leem a saida real do `ork grafo` e do doctor), "workflow" (o passo da prova no CI e no
 * `publicar.yml`) e "docs" (o que continua valendo nos docs depois da correcao, sem depender de texto
 * que a proxima fatia reescreve). A instalacao sem os analisadores e uma
 * copia do `dist` com o `node_modules` do checkout ligado pacote a pacote, menos os analisadores: o
 * mesmo que a 0.5.1 do npm tinha.
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, test } from 'node:test';
import { checar, relatorio } from '../src/doctor';
import { raizDoEstado } from '../src/estado-thread';
import { checarAnalisadoresDoGrafo, correcaoDosAnalisadores, descreverVersoes, executarGrafo } from '../src/intelligence-graph-cli';
import { PACOTES_DOS_ANALISADORES, pacotesDosAnalisadores, versoesDosAnalisadores } from '../src/intelligence-graph-parsers';
import { noPath } from '../src/util';
import { VERSAO_DO_ORK } from '../src/versao';
import { init } from '../src/init';
import { dirTemporario, projetoTemporario } from './apoio';

const prova = require('../../scripts/provar-grafo-instalado.cjs');

const CORE = path.resolve(__dirname, '../..');
const RAIZ = path.resolve(CORE, '..');

interface Pacote { version: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
interface EntradaDoLock { version?: string; dev?: boolean; hasInstallScript?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

const ler = (rel: string): string => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const pacote = (): Pacote => JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8'));
const lock = (): { packages: Record<string, EntradaDoLock> } => JSON.parse(fs.readFileSync(path.join(CORE, 'package-lock.json'), 'utf8'));
const instalado = (nome: string): string => JSON.parse(fs.readFileSync(path.join(CORE, 'node_modules', nome, 'package.json'), 'utf8')).version;

test('grafo no pacote: dependencias: cada pacote que os analisadores carregam e dependencia de runtime com a versao exata instalada', () => {
  const p = pacote(), raiz = lock().packages[''];
  for (const nome of PACOTES_DOS_ANALISADORES) {
    const versao = p.dependencies?.[nome] ?? '';
    assert.match(versao, /^\d+\.\d+\.\d+$/, `${nome}: versao exata em dependencies (${versao || 'ausente'})`);
    assert.equal(versao, instalado(nome), `${nome}: a versao do node_modules`);
    assert.equal(raiz.dependencies?.[nome], versao, `${nome}: a raiz do lockfile`);
    assert.equal(p.devDependencies?.[nome], undefined, `${nome} fora de devDependencies`);
    assert.equal(p.optionalDependencies?.[nome], undefined, `${nome} fora de optionalDependencies`);
    assert.equal(raiz.devDependencies?.[nome], undefined, `${nome} fora das devDependencies do lockfile`);
  }
  // Os rotulos dos extratores do KG2 saem dessas versoes (a do Node vem de quem roda).
  const v = versoesDosAnalisadores(), d = p.dependencies as Record<string, string>;
  assert.equal(v.typescript, d.typescript);
  assert.equal(v.markdown, `micromark.${d.micromark}.gfm-table.${d['micromark-extension-gfm-table']}`);
});

test('grafo no pacote: dependencias: o quickstart, os READMEs e o SECURITY dizem quantas dependencias de runtime o pacote tem', () => {
  const n = Object.keys(pacote().dependencies ?? {}).length;
  const extenso = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze'][n];
  assert.ok(extenso, `${n} dependências: estenda a lista por extenso`);
  assert.ok(ler('docs/comecar/quickstart.md').includes(`com ${extenso} dependências de runtime`), 'quickstart');
  assert.ok(ler('README.md').includes(`| Runtime dependencies | ${n}, pinned |`), 'README.md');
  assert.ok(ler('README.pt-BR.md').includes(`| Dependências de runtime | ${n}, com versão fixa |`), 'README.pt-BR.md');
  assert.match(ler('SECURITY.md'), new RegExp(`\\| Depend[eê]ncias de runtime \\| \\*\\*${extenso}\\*\\*, com versão fixa em \`core/package\\.json\``), 'SECURITY.md');
  assert.ok(ler('docs/produto/SYS-01-nucleo-ork.md').includes(`com ${extenso} dependências de runtime com versão fixa`), 'SYS-01');
});

test('grafo no pacote: lockfile: o fecho dos analisadores esta no lockfile com a versao instalada e nenhum pacote dele e dev', () => {
  const pacotes = lock().packages;
  const fecho = pacotesDosAnalisadores();
  assert.ok(fecho.length >= PACOTES_DOS_ANALISADORES.length, fecho.join(' '));
  for (const item of fecho) {
    const arroba = item.lastIndexOf('@'), nome = item.slice(0, arroba), versao = item.slice(arroba + 1);
    const entrada = pacotes[`node_modules/${nome}`];
    assert.ok(entrada, `${item} fora do lockfile`);
    assert.equal(entrada.version, versao, `${nome}: a versao do lockfile`);
    assert.notEqual(entrada.dev, true, `${nome} marcado dev: o npm ci --omit=dev e quem instala do npm o perderiam`);
  }
});

test('grafo no pacote: lockfile: nenhum pacote de producao roda script de instalacao, como o SECURITY diz', () => {
  const comScript = Object.entries(lock().packages)
    .filter(([caminho, e]) => caminho !== '' && e.dev !== true && e.hasInstallScript === true).map(([caminho]) => caminho);
  assert.deepEqual(comScript, []);
});

// ---------------------------------------------------------------------------
// doctor e status

const RECUSA_DO_TS = 'grafo.parser.indisponivel: typescript';
const falha = (motivo: string) => (): never => { throw new Error(motivo); };
const CORRECAO_DO_NPM = `npm install -g @orkastery/cli@${VERSAO_DO_ORK}`;

let copia: { dir: string; cli: string; bin: string } | null = null;
/**
 * A instalacao que a 0.5.1 do npm tinha: o pacote com as dependencias de runtime e sem os
 * analisadores. O `dist` do checkout e copiado, e cada pacote do `node_modules` e ligado, menos os
 * cinco que os analisadores carregam. Feita uma vez por arquivo; o `after` a apaga.
 */
function instalacaoSemAnalisadores(): { dir: string; cli: string; bin: string } {
  if (copia) return copia;
  const dir = dirTemporario('rm031-sem-analisadores'), raiz = path.join(dir, 'instalacao');
  // O que o pacote publica e o `ork` le no caminho do doctor e do grafo: o codigo, os schemas e os assets.
  for (const pasta of ['dist', 'schemas', 'assets']) fs.cpSync(path.join(CORE, pasta), path.join(raiz, pasta), { recursive: true });
  fs.copyFileSync(path.join(CORE, 'package.json'), path.join(raiz, 'package.json'));
  const modulos = path.join(raiz, 'node_modules'), fora = new Set<string>(PACOTES_DOS_ANALISADORES);
  fs.mkdirSync(modulos);
  for (const nome of fs.readdirSync(path.join(CORE, 'node_modules'))) {
    if (!nome.startsWith('.') && !fora.has(nome)) fs.symlinkSync(path.join(CORE, 'node_modules', nome), path.join(modulos, nome));
  }
  // So o git no PATH: o doctor nao sonda claude nem codex, e o check do grafo nao depende deles.
  const bin = path.join(dir, 'bin'), git = noPath('git');
  assert.ok(git, 'git no PATH de quem roda');
  fs.mkdirSync(bin);
  fs.symlinkSync(path.resolve(git), path.join(bin, 'git'));
  copia = { dir, cli: path.join(raiz, 'dist', 'index.js'), bin };
  return copia;
}
after(() => { if (copia) fs.rmSync(copia.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** A CLI da instalacao sem os analisadores, num projeto, com HOME proprio. */
function orkSemAnalisadores(dir: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const inst = instalacaoSemAnalisadores();
  const r = spawnSync(process.execPath, [inst.cli, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120_000, env: { HOME: path.join(inst.dir, 'casa'), PATH: inst.bin, LANG: 'C.UTF-8' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** `ork grafo` pelo modulo, com a saida capturada. */
function grafo(dir: string, ...argv: string[]): string {
  const partes: string[] = [];
  assert.equal(executarGrafo(argv, { raiz: dir, estado: raizDoEstado(dir), escrever: (t) => partes.push(t) }), 0);
  return partes.join('\n');
}

test('grafo no pacote: doctor: com os analisadores na instalacao, o check e ok com as versoes no formato do grafo status', () => {
  const c = checarAnalisadoresDoGrafo(VERSAO_DO_ORK);
  assert.deepEqual([c.nome, c.nivel, c.correcao], ['analisadores do grafo', 'ok', undefined]);
  assert.equal(c.detalhe, descreverVersoes(versoesDosAnalisadores()));
  assert.match(c.detalhe, /^typescript \d+\.\d+\.\d+, javascript node\.\S+, markdown micromark\.\S+\.gfm-table\.\S+, unicode \S+$/);
});

test('grafo no pacote: doctor: sem um analisador, warn com a recusa, o que deixa de rodar e a correcao do npm na versao do ork', () => {
  const c = checarAnalisadoresDoGrafo(VERSAO_DO_ORK, falha(RECUSA_DO_TS));
  assert.equal(c.nivel, 'warn', 'o grafo nao e condicao do despacho: nunca fail');
  assert.equal(c.detalhe, `${RECUSA_DO_TS}: o ork grafo indexar recusa nesta instalacao, e sem o indice as consultas e as tools ork_grafo_* tambem`);
  assert.equal(c.correcao, `reinstale o ork global, que traz os analisadores como dependencias: ${CORRECAO_DO_NPM}`
    + ' (instalado dentro de um projeto ou pelo npx, o npm deixa os analisadores fora do pacote do ork, e o grafo os recusa)');
  // Pacote fora da instalacao (o npm icou para o projeto): a mesma correcao.
  const fora = checarAnalisadoresDoGrafo(VERSAO_DO_ORK, falha('grafo.parser.indisponivel: micromark fora da instalacao do ork'));
  assert.equal(fora.correcao, c.correcao);
  // Sem a versao (o worker do MCP nao a passa), ou com a desconhecida, a correcao instala a ultima publicada.
  const semVersao = 'reinstale o ork global, que traz os analisadores como dependencias: npm install -g @orkastery/cli'
    + ' (instalado dentro de um projeto ou pelo npx, o npm deixa os analisadores fora do pacote do ork, e o grafo os recusa)';
  assert.equal(checarAnalisadoresDoGrafo(undefined, falha(RECUSA_DO_TS)).correcao, semVersao);
  assert.equal(checarAnalisadoresDoGrafo('0.0.0-desconhecida', falha('grafo.parser.indisponivel: instalacao do ork nao encontrada')).correcao, semVersao);
  // O relatorio imprime a correcao debaixo da linha, e o doctor sai 0 por esse check.
  const texto = relatorio([c]);
  assert.match(texto, /^ {2}\[warn\] analisadores do grafo {2}grafo\.parser\.indisponivel: typescript: /m);
  assert.ok(texto.includes(`correcao: reinstale o ork global, que traz os analisadores como dependencias: ${CORRECAO_DO_NPM}`), texto);
  assert.match(texto, /Veredito: PRONTO \(1 warn\)/);
});

test('grafo no pacote: doctor: Node sem require de ESM pede o Node 20.19 ou 22.12, nao a reinstalacao', () => {
  const c = checarAnalisadoresDoGrafo(VERSAO_DO_ORK, falha('grafo.parser.indisponivel: micromark (ERR_REQUIRE_ESM)'));
  assert.equal(c.nivel, 'warn');
  assert.equal(c.correcao, `o micromark e so ESM, e este Node (${process.version}) nao o carrega por require: use Node 20.19, 22.12 ou mais novo, `
    + 'sem a opcao --no-experimental-require-module (na linha de comando ou no NODE_OPTIONS)');
  assert.equal(correcaoDosAnalisadores('grafo.parser.indisponivel: micromark (ERR_REQUIRE_ESM)'), c.correcao);
});

test('grafo no pacote: doctor: o check carrega os analisadores de verdade, e no Node sem require de ESM avisa com a correcao do Node', (t) => {
  if (!process.allowedNodeEnvironmentFlags.has('--no-experimental-require-module')) {
    t.skip('este Node nao tem --no-experimental-require-module');
    return;
  }
  // So a carga real (e nao a leitura dos package.json) ve o Node que nao carrega o micromark por require.
  const cli = path.resolve(__dirname, '../src/intelligence-graph-cli.js');
  const r = spawnSync(process.execPath, ['--no-experimental-require-module', '-e',
    `process.stdout.write(JSON.stringify(require(${JSON.stringify(cli)}).checarAnalisadoresDoGrafo('9.9.9')))`],
  { encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  assert.equal(c.nivel, 'warn');
  assert.match(c.detalhe, /^grafo\.parser\.indisponivel: micromark \(ERR_REQUIRE_ESM\): o ork grafo indexar recusa/);
  assert.match(c.correcao, /use Node 20\.19, 22\.12 ou mais novo, sem a opcao --no-experimental-require-module/);
});

test('grafo no pacote: doctor: o checar traz o check que o index.ts passa logo depois do node, e sem ele o doctor nao abre o grafo', () => {
  const dir = dirTemporario('rm031-doctor-ordem');
  try {
    const nomes = checar(dir, undefined, undefined, () => checarAnalisadoresDoGrafo(VERSAO_DO_ORK)).map((c) => c.nome);
    assert.equal(nomes[nomes.indexOf('node') + 1], 'analisadores do grafo', nomes.join(', '));
    // Fronteira do KG1: o doctor nao importa a familia do grafo; o check so vem de quem a abre.
    assert.ok(!checar(dir).some((c) => c.nome === 'analisadores do grafo'));
    // Que o `index.ts` passa o check, prova o `ork doctor` de verdade, no teste da instalacao sem os analisadores.
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('grafo no pacote: doctor: na instalacao sem os analisadores, o ork doctor de verdade da warn com a correcao', () => {
  const p = projetoTemporario('rm031-doctor-sem');
  try {
    const r = orkSemAnalisadores(p.dir, 'doctor');
    const linhas = r.stdout.split('\n'), i = linhas.findIndex((l) => l.includes(' analisadores do grafo '));
    assert.ok(i > 0, r.stdout + r.stderr);
    assert.match(linhas[i], /^ {2}\[warn\] analisadores do grafo +grafo\.parser\.indisponivel: typescript: o ork grafo indexar recusa/);
    assert.match(linhas[i + 1], new RegExp(`^ +correcao: reinstale o ork global, que traz os analisadores como dependencias: ${CORRECAO_DO_NPM.replace(/[.@/]/g, '\\$&')}`));
  } finally {
    p.limpar();
  }
});

test('grafo no pacote: status: com os analisadores, o campo correcao e null e o texto nao tem a linha', () => {
  const p = projetoTemporario('rm031-status-com');
  try {
    const status = JSON.parse(grafo(p.dir, 'status', '--json'));
    assert.deepEqual([status.erro, status.correcao, status.indice_do_head], [null, null, 'ausente']);
    assert.ok(!/^ {2}correcao /m.test(grafo(p.dir, 'status')));
  } finally {
    p.limpar();
  }
});

test('grafo no pacote: status: erro que nao e dos analisadores nao ganha a correcao deles', () => {
  const p = projetoTemporario('rm031-status-outro-erro');
  try {
    const partes: string[] = [];
    const ctx = { raiz: p.dir, estado: raizDoEstado(p.dir), repositorio: 'nome com espaco', versao: VERSAO_DO_ORK, escrever: (x: string) => partes.push(x) };
    assert.equal(executarGrafo(['status', '--json'], ctx), 0);
    const status = JSON.parse(partes.join('\n'));
    assert.equal(status.indice_do_head, 'indisponivel');
    assert.ok(status.erro && !status.erro.startsWith('grafo.parser.indisponivel'), status.erro);
    assert.equal(status.correcao, null);
    partes.length = 0;
    assert.equal(executarGrafo(['status'], ctx), 0);
    assert.ok(!partes.join('\n').includes('sem os analisadores'), partes.join('\n'));
    assert.ok(!/^ {2}correcao /m.test(partes.join('\n')));
  } finally {
    p.limpar();
  }
});

test('grafo no pacote: status: sem os analisadores na instalacao, o status diz a correcao do doctor no texto e no --json', () => {
  const p = projetoTemporario('rm031-status-sem');
  try {
    const json = orkSemAnalisadores(p.dir, 'grafo', 'status', '--json');
    assert.equal(json.status, 0, json.stderr);
    const status = JSON.parse(json.stdout);
    assert.deepEqual([status.indice_do_head, status.erro], ['indisponivel', RECUSA_DO_TS]);
    assert.equal(status.correcao, correcaoDosAnalisadores(RECUSA_DO_TS, VERSAO_DO_ORK), 'o index.ts passa a versao ao status');
    assert.ok(status.correcao.includes(CORRECAO_DO_NPM), status.correcao);
    const texto = orkSemAnalisadores(p.dir, 'grafo', 'status');
    assert.equal(texto.status, 0, texto.stderr);
    assert.ok(texto.stdout.includes(`\n  analisadores    ${RECUSA_DO_TS}\n  correcao        ${status.correcao}\n`), texto.stdout);
  } finally {
    p.limpar();
  }
});

// ---------------------------------------------------------------------------
// script

test('grafo no pacote: script: o ambiente da prova nao leva nada de quem chama, e o PATH poe o ork instalado e o Node de quem roda na frente', () => {
  const antes = { ...process.env };
  process.env.ORK_VAZAMENTO_DE_TESTE = 'vazou';
  process.env.ORKASTERY_VAZAMENTO_DE_TESTE = 'vazou';
  try {
    const env = prova.ambienteLimpo('/tmp/base', '/opt/node/bin/node') as Record<string, string>;
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'PATH', 'TZ', 'npm_config_audit', 'npm_config_cache', 'npm_config_fund',
      'npm_config_prefix', 'npm_config_update_notifier']);
    assert.deepEqual([env.HOME, env.npm_config_prefix, env.npm_config_cache], ['/tmp/base/home', '/tmp/base/npm', '/tmp/base/npm-cache']);
    assert.deepEqual(env.PATH.split(path.delimiter).slice(0, 2), ['/tmp/base/npm/bin', '/opt/node/bin']);
    assert.ok(!Object.values(env).includes('vazou'));
    assert.ok(!env.PATH.split(path.delimiter).includes(path.join(antes.HOME ?? '/sem-home', '.local', 'bin')), 'nada do HOME de quem roda');
  } finally {
    delete process.env.ORK_VAZAMENTO_DE_TESTE;
    delete process.env.ORKASTERY_VAZAMENTO_DE_TESTE;
  }
});

test('grafo no pacote: script: o pack nao usa rede, e a instalacao e global, do tarball, pelo registro', () => {
  const c = prova.comandos('/c/core', '/tmp/base', '/tmp/base/pacote.tgz');
  assert.deepEqual(c.pack, { bin: 'npm', args: ['pack', '--offline', '--pack-destination', '/tmp/base'], cwd: '/c/core' });
  assert.deepEqual(c.instalar, { bin: 'npm', args: ['install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', '/tmp/base/pacote.tgz'], cwd: '/tmp/base' });
  assert.deepEqual([c.ork, c.instalacao], ['/tmp/base/npm/bin/ork', '/tmp/base/npm/lib/node_modules/@orkastery/cli']);
});

test('grafo no pacote: script: scripts de instalacao nas dependencias diretas e aninhadas reprovam com a lista', () => {
  const dir = dirTemporario('rm031-scripts-instalacao');
  const pacotes = [
    'node_modules/direta',
    'node_modules/@escopo/direta',
    'node_modules/direta/node_modules/indireta',
    'node_modules/@escopo/direta/node_modules/@outro/indireta',
  ];
  const gravar = (p: string, scripts: Record<string, string>): void => {
    fs.mkdirSync(path.join(dir, p), { recursive: true });
    fs.writeFileSync(path.join(dir, p, 'package.json'), JSON.stringify({ name: path.basename(p), version: '1.0.0', scripts }));
  };
  try {
    for (const p of pacotes) gravar(p, { test: 'node teste.js', prepare: 'node preparar.js' });
    // O package.json de exemplo dentro de um pacote nao e uma dependencia instalada.
    gravar('node_modules/direta/exemplos/app', { install: 'node exemplo.js' });
    assert.doesNotThrow(() => prova.conferirScriptsDeInstalacao(dir));
    // Cada mutacao isolada tem de reprovar, seja qual for o hook ou a profundidade.
    for (const p of pacotes) {
      for (const hook of ['preinstall', 'install', 'postinstall']) {
        gravar(p, { [hook]: 'node instalar.js' });
        assert.throws(() => prova.conferirScriptsDeInstalacao(dir), {
          message: `prova.scripts de instalacao: dependencias instaladas com scripts:\n${p}/package.json: ${hook}`,
        });
        gravar(p, {});
      }
    }
    for (const p of pacotes) gravar(p, { postinstall: 'node depois.js', preinstall: 'node antes.js', install: 'node instalar.js' });
    assert.throws(() => prova.conferirScriptsDeInstalacao(dir), {
      message: 'prova.scripts de instalacao: dependencias instaladas com scripts:\n'
        + pacotes.map((p) => `${p}/package.json: preinstall, install, postinstall`).sort().join('\n'),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('grafo no pacote: script: o prazo usa o timeout em primeiro plano, e o codigo de saida decide o passo', () => {
  // `--foreground`: o timeout fica no grupo da prova, e o sinal de quem a roda alcanca o npm e o ork junto.
  assert.deepEqual(prova.comandoComPrazo('npm', ['pack'], 61_000, process.execPath), [process.execPath, ['--foreground', '--kill-after=15', '61', 'npm', 'pack']]);
  assert.deepEqual(prova.comandoComPrazo('npm', ['pack'], 61_000, path.join(CORE, 'nao-existe')), ['npm', ['pack']]);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  assert.throws(() => prova.rodar('teste', process.execPath, ['-e', 'process.exit(3)'], CORE, env, 60_000),
    /^Error: prova\.teste: node -e process\.exit\(3\) saiu com status 3/);
  assert.equal(prova.rodar('teste', process.execPath, ['-e', 'process.exit(3)'], CORE, env, 60_000, [3]).status, 3);
  assert.deepEqual(prova.COPIAS_DO_PREPACK, ['skills', 'references', 'eval', 'adapters', 'monitor', 'LICENSE'], 'a lista do preparar-pacote.js');
});

test('grafo no pacote: script: as versoes esperadas saem das dependencias do pacote e batem com os analisadores do checkout', () => {
  const v = versoesDosAnalisadores();
  assert.deepEqual(prova.esperadoDoPacote(pacote()), { typescript: v.typescript, javascript: v.javascript, markdown: v.markdown });
  assert.throws(() => prova.esperadoDoPacote({ dependencies: { ...pacote().dependencies, typescript: '^5.9.3' } }),
    /^Error: prova\.pacote: typescript sem versao exata em dependencies \(\^5\.9\.3\)$/);
  assert.throws(() => prova.esperadoDoPacote({}), /^Error: prova\.pacote: typescript sem versao exata em dependencies \(ausente\)$/);
});

test('grafo no pacote: script: os conferidores aceitam a saida real do ork grafo no repositorio de ensaio e recusam a ruim dizendo o passo', () => {
  const dir = dirTemporario('rm031-script-repo');
  try {
    prova.criarRepositorio(dir, { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, LANG: 'C.UTF-8' });
    init(dir, { nome: 'ensaio', abbrev: 'ens' });
    const esperado = prova.esperadoDoPacote(pacote());
    const antes = JSON.parse(grafo(dir, 'status', '--json'));
    prova.conferirStatus(antes, esperado, 'ausente');
    const indice = JSON.parse(grafo(dir, 'indexar', '--json'));
    prova.conferirIndice(indice);
    prova.conferirChamadores(JSON.parse(grafo(dir, 'chamadores', 'src/soma.ts#soma', '--json')));
    prova.conferirStatus(JSON.parse(grafo(dir, 'status', '--json')), esperado, 'presente');

    assert.throws(() => prova.conferirStatus(antes, esperado, 'presente'), /^Error: prova\.status: indice do HEAD ausente, presente esperado$/);
    assert.throws(() => prova.conferirStatus({ ...antes, erro: RECUSA_DO_TS, correcao: 'x' }, esperado, 'ausente'),
      /^Error: prova\.status: analisadores indisponiveis: grafo\.parser\.indisponivel: typescript$/);
    assert.throws(() => prova.conferirStatus({ ...antes, analisadores: { ...antes.analisadores, typescript: '0.0.1' } }, esperado, 'ausente'),
      new RegExp(`^Error: prova\\.status: typescript 0\\.0\\.1 na instalacao, ${esperado.typescript.replace(/\./g, '\\.')} no pacote$`));
    assert.throws(() => prova.conferirStatus({ ...antes, correcao: 'reinstale' }, esperado, 'ausente'), /^Error: prova\.status: correcao sem erro/);
    assert.throws(() => prova.conferirIndice({ ...indice, estado: 'existente' }), /^Error: prova\.indexar: estado existente, criado esperado$/);
    const semChamada = { ...indice, manifesto: { ...indice.manifesto, contagens: { ...indice.manifesto.contagens, arestas: { ...indice.manifesto.contagens.arestas, calls: 0 } } } };
    assert.throws(() => prova.conferirIndice(semChamada), /^Error: prova\.indexar: nenhuma aresta calls no indice$/);
    assert.throws(() => prova.conferirChamadores({ arestas: [] }),
      /^Error: prova\.chamadores: a aresta calls de symbol src\/dobro\.ts#dobro para symbol src\/soma\.ts#soma pelo ork\.ts-ast nao veio \(0 aresta\(s\)\)$/);
    const resposta = JSON.parse(grafo(dir, 'chamadores', 'src/soma.ts#soma', '--json'));
    const semTsAst = { ...resposta, arestas: resposta.arestas.map((a: { evidencias: { extractor_id: string }[] }) => ({
      ...a, evidencias: a.evidencias.map((e) => ({ ...e, extractor_id: 'ork.outro' })) })) };
    assert.throws(() => prova.conferirChamadores(semTsAst), /^Error: prova\.chamadores: a aresta calls .* pelo ork\.ts-ast nao veio/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('grafo no pacote: script: a linha do doctor sai do relatorio de verdade, com a correcao quando ha', () => {
  const ok = prova.linhaDoDoctor(relatorio([{ nome: 'node', nivel: 'ok', detalhe: process.version }, checarAnalisadoresDoGrafo(VERSAO_DO_ORK)]));
  assert.deepEqual([ok.nivel, ok.correcao], ['ok', null]);
  const semTs = prova.linhaDoDoctor(relatorio([{ nome: 'node', nivel: 'ok', detalhe: process.version }, checarAnalisadoresDoGrafo(VERSAO_DO_ORK, falha(RECUSA_DO_TS))]));
  assert.equal(semTs.nivel, 'warn');
  assert.equal(semTs.correcao, correcaoDosAnalisadores(RECUSA_DO_TS, VERSAO_DO_ORK));
  prova.conferirDoctorSemCompilador(semTs, VERSAO_DO_ORK);
  assert.throws(() => prova.conferirDoctorSemCompilador(ok, VERSAO_DO_ORK), /^Error: prova\.doctor sem typescript: nivel ok, warn esperado/);
  assert.throws(() => prova.conferirDoctorSemCompilador(semTs, '9.9.9'), /^Error: prova\.doctor sem typescript: sem a correcao npm install -g @orkastery\/cli@9\.9\.9/);
  const outraRecusa = { ...semTs, linha: semTs.linha.replace('grafo.parser.indisponivel: typescript', 'grafo.parser.indisponivel: micromark') };
  assert.throws(() => prova.conferirDoctorSemCompilador(outraRecusa, VERSAO_DO_ORK), /^Error: prova\.doctor sem typescript: sem a recusa/);
  assert.throws(() => prova.linhaDoDoctor('ork doctor: o que vale nesta maquina agora\n'), /^Error: prova\.doctor: o relatorio nao traz o check analisadores do grafo$/);
});

test('grafo no pacote: script: a medida soma bytes e blocos dos arquivos sem seguir link simbolico', () => {
  const dir = dirTemporario('rm031-script-medida');
  try {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', 'um.txt'), 'x'.repeat(10));
    fs.writeFileSync(path.join(dir, 'a', 'b', 'dois.txt'), 'y'.repeat(5));
    fs.symlinkSync(CORE, path.join(dir, 'a', 'link'));
    const m = prova.medirInstalacao(dir);
    assert.deepEqual([m.bytes, m.arquivos], [15, 2]);
    assert.ok(m.disco >= 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// workflow

const PASSO_DA_PROVA = 'run: node core/scripts/provar-grafo-instalado.cjs';

test('grafo no pacote: workflow: o CI roda a prova no job nucleo, na matriz de Node, depois dos testes, sem credencial de publicacao', () => {
  const ci = ler('.github/workflows/ci.yml');
  const nucleo = ci.slice(ci.indexOf('\n  nucleo:'), ci.indexOf('\n# Nota deliberada'));
  assert.ok(nucleo.length > 20, 'o job nucleo existe');
  assert.match(nucleo, /\n {6}- uses: actions\/checkout@v4\n {8}with:\n {10}persist-credentials: false\n/, 'o checkout do nucleo nao guarda credenciais');
  assert.match(nucleo, /node-version: \$\{\{ matrix\.node \}\}/, 'roda em cada Node da matriz');
  const passo = nucleo.indexOf(PASSO_DA_PROVA), testes = nucleo.indexOf('run: npm run test:ci');
  assert.ok(testes > 0 && passo > testes, 'o passo da prova vem depois dos testes do nucleo');
  assert.equal(ci.split(PASSO_DA_PROVA).length - 1, 1, 'so no job nucleo');
  assert.doesNotMatch(ci, /id-token/, 'o CI nao tem credencial de publicacao');
});

test('grafo no pacote: workflow: o publicar.yml so publica depois da prova, que roda num job sem o id-token, com as conferencias de versao intactas', () => {
  const pub = ler('.github/workflows/publicar.yml');
  const iProva = pub.indexOf('\n  provar-grafo:'), iPublicar = pub.indexOf('\n  publicar:');
  assert.ok(iProva > 0 && iPublicar > iProva, 'os jobs provar-grafo e publicar');
  const prova = pub.slice(iProva, iPublicar), publicar = pub.slice(iPublicar);
  assert.ok(prova.includes(PASSO_DA_PROVA), 'a prova no job dela');
  assert.match(prova, /\n {4}permissions:\n {6}contents: read\n/, 'o job da prova so le');
  assert.doesNotMatch(prova, /id-token/, 'a prova nunca ve a credencial de publicacao');
  assert.match(prova, /\n {6}- uses: actions\/checkout@v4\n {8}with:\n {10}persist-credentials: false\n/, 'o checkout da prova nao guarda credenciais');
  assert.match(publicar, /\n {4}needs: provar-grafo\n/, 'o publicar espera a prova');
  assert.doesNotMatch(publicar, /^\s+(?:-\s+)?(?:if|'if'|"if")\s*:/m, 'nenhum if pode publicar com a prova reprovada');
  assert.ok(!publicar.includes(PASSO_DA_PROVA), 'a prova nao roda no job que publica');
  const onde = (trecho: string): number => {
    const i = publicar.indexOf(trecho);
    assert.ok(i > 0, `job publicar sem: ${trecho}`);
    return i;
  };
  assert.ok(onde('run: node core/dist/index.js eval --so-canarios') < onde('run: npm publish --access public'));
  onde('test "v$(node -p "require(\'./core/package.json\').version")" = "$GITHUB_REF_NAME"');
  onde('test "$(node -p "require(\'./core/package.json\').repository.url")" = "git+https://github.com/$GITHUB_REPOSITORY.git"');
  onde('run: git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
});

// ---------------------------------------------------------------------------
// docs

test('grafo no pacote: docs: a pagina da RM-031 registra a correcao de empacotamento', () => {
  // O Próximo passo e reescrito a cada fatia: o que ele diz agora fica na claim da thread, nao aqui.
  assert.match(ler('docs/roadmap/RM-031-grafo-de-codigo.md'), /`ork-rm031grafofu`/);
});

test('grafo no pacote: docs: os contratos e a referencia da CLI dizem que os analisadores vem com o pacote e citam o check do doctor', () => {
  assert.doesNotMatch(ler('docs/referencia/contratos/extracao-grafo-kg2.md').replace(/\s+/g, ' '), /markdownlint do core já instala/);
  for (const arquivo of ['docs/referencia/contratos/indice-grafo-kg3.md', 'docs/referencia/contratos/consumo-grafo-kg5.md', 'docs/referencia/cli.md']) {
    const texto = ler(arquivo).replace(/\s+/g, ' ');
    assert.doesNotMatch(texto, /não são dependências de runtime|que não são dependências|e o pacote publicado `@orkastery\/cli` 0\.5\.0 não/, arquivo);
    assert.match(texto, /são dependências (de runtime )?do pacote/, arquivo);
    assert.match(texto, /"analisadores do grafo"/, arquivo);
  }
  assert.match(ler('docs/referencia/cli.md').replace(/\s+/g, ' '), /o grafo pede Node 20\.19, 22\.12 ou mais novo/);
});

test('grafo no pacote: docs: as amostras do doctor no quickstart trazem o check dos analisadores logo depois do node', () => {
  const amostras = [...ler('docs/comecar/quickstart.md').matchAll(/```text\n(ork doctor: o que vale nesta maquina agora\n[\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(amostras.length, 2, 'antes e depois do ork init');
  for (const a of amostras) assert.match(a, /\n {2}\[ok\] {3}node +v\S+\n {2}\[ok\] {3}analisadores do grafo +typescript \d/);
});
