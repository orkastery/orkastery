/**
 * Fatia 2 do ensaio de primeira experiencia da 0.5.0 (thread ork-ensaiofatia2): os achados P1 a P3 e
 * P5 a P9 e os registros R2, R3, R5 e R7 do relatorio da ork-ensaioprimei. Os nomes comecam por
 * "fatia 2 <ID>:" para que cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente; nenhum teste depende de `claude`,
 * `codex`, horario ou fuso de quem roda.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec, GITIGNORE_DA_MAQUINA, ignorarPastaNoGit, noPath } from '../src/util';
import { init } from '../src/init';
import { ONDE_FICAM_OS_SEGREDOS, PAUTA_ONBOARDING, validarConteudo } from '../src/onboarding';
import { analisarComando } from '../src/claim-lint';
import { DICA_DO_MOTIVO } from '../src/licoes';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { montarPanoramaDaRede, textoDoPanoramaDaRede } from '../src/network-roadmap';
import { blocosDoRuntime, checarDespachoPeloCodex, checarRuntimeClaude } from '../src/doctor';
import { consultarSessoes } from '../src/adapters/claude-bg';
import { exigirManifesto } from '../src/manifest';
import { MODOS } from '../src/modos';
import { editarBloco } from '../src/setup';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { ship } from '../src/ship';
import { ehEnsaio, lerLedger } from '../src/ledger';
import { planejar } from '../src/board';
import { montarMonitor } from '../src/orquestracao';
import { operationalSources } from '../src/maestro-runtime';
import { MaestroReader } from '../src/maestro-sources';
import { ajustarManifesto, dirTemporario, projetoTemporario } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const RAIZ = path.resolve(__dirname, '../../..');
const PATH_ATUAL = process.env.PATH ?? '/usr/bin:/bin';
const ler = (relativo: string): string => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

/** A CLI do HEAD, com HOME proprio e so o PATH pedido e LANG no ambiente. */
function ork(dir: string, casa: string, caminho: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: caminho, LANG: 'C.UTF-8' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Diretorio de binarios so com o git: sem `which`, sem `claude` e sem `codex`. */
function binSoComGit(nome: string): string {
  const bin = dirTemporario(nome);
  const git = noPath('git', { PATH: PATH_ATUAL });
  assert.ok(git, 'git no PATH de quem roda');
  fs.symlinkSync(path.resolve(git), path.join(bin, 'git'));
  return bin;
}

test('fatia 2 R3: noPath acha o binario sem o which', () => {
  const bin = dirTemporario('fatia2-path');
  const casa = dirTemporario('fatia2-path-casa');
  const p = projetoTemporario('fatia2-path-projeto');
  try {
    const exe = path.join(bin, 'ferramenta-da-fatia2');
    fs.writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'sem-execucao'), 'texto\n', { mode: 0o644 });
    // So este diretorio no PATH: o `which` nao existe aqui, e a busca e do proprio processo.
    assert.equal(noPath('ferramenta-da-fatia2', { PATH: bin }), exe);
    assert.equal(noPath('sem-execucao', { PATH: bin }), null, 'arquivo sem bit de execucao');
    assert.equal(noPath('nao-existe', { PATH: bin }), null);
    assert.equal(noPath('ferramenta-da-fatia2', { PATH: `${path.delimiter}${bin}` }), exe, 'entrada vazia do PATH e pulada');
    assert.equal(noPath(exe, { PATH: '' }), exe, 'nome com barra e conferido direto');

    // O sintoma do ensaio: com o git no PATH e sem o `which`, o doctor dizia que o git faltava.
    const git = noPath('git', { PATH: PATH_ATUAL });
    assert.ok(git, 'git no PATH de quem roda');
    fs.symlinkSync(path.resolve(git), path.join(bin, 'git'));
    const r = ork(p.dir, casa, bin, 'doctor');
    assert.match(r.stdout, /^ {2}\[ok\] {3}git {2,}\S*git$/m, r.stdout);
    assert.doesNotMatch(r.stdout, /nao encontrado no PATH/);
    assert.equal(exec('git', ['--version'], p.dir, 10000, { PATH: bin }).ok, true);
  } finally { p.limpar(); limpar(bin, casa); }
});

/** Quantos blocos os modos permitidos do manifesto somam. */
function blocosPermitidos(raiz: string): number {
  return exigirManifesto(raiz).manifesto.conduction.allowed_modes.reduce((n, m) => n + MODOS[m].blocos.length, 0);
}

test('fatia 2 P1: doctor so reprova o claude-bg quando um bloco permitido despacha por ele', () => {
  const p = projetoTemporario('fatia2-doctor');
  try {
    // Com o claude, como antes.
    assert.equal(checarRuntimeClaude(p.carregado, '/opt/bin/claude', '2.1.0').nivel, 'ok');
    // Sem o claude, sem manifesto: vale o padrao (todo bloco no claude-bg) e reprova.
    assert.equal(checarRuntimeClaude(null, null, null).nivel, 'fail');

    // Setup padrao: todo bloco dos modos permitidos despacha pelo claude-bg.
    const padrao = checarRuntimeClaude(p.carregado, null, null);
    assert.equal(padrao.nivel, 'fail');
    const total = blocosPermitidos(p.dir);
    assert.ok(padrao.detalhe.startsWith(`binario \`claude\` fora do PATH; ${total} bloco(s) dos modos permitidos despacham por ele (#Classic 1, `),
      padrao.detalhe);
    assert.match(padrao.correcao ?? '', /so com o Codex, passe cada bloco para ele \(ork setup <modo> --bloco N --runtime codex --model <modelo>\)/);

    // So os modos permitidos contam: com allowed_modes [auto] e o bloco do #Auto no Codex, a falta e aviso.
    ajustarManifesto(p, /default_mode: classic/, 'default_mode: auto');
    ajustarManifesto(p, /allowed_modes: \[[^\]]*\]/, 'allowed_modes: [auto]');
    assert.equal(editarBloco(p.dir, 'auto', 1, { runtime: 'codex', model: 'gpt-5.5' }).ok, true);
    const soAuto = checarRuntimeClaude(p.carregado, null, null);
    assert.equal(soAuto.nivel, 'warn', soAuto.detalhe);
    assert.equal(soAuto.detalhe, 'binario `claude` fora do PATH (opcional: nenhum bloco dos modos permitidos despacha pelo claude-bg)');
    assert.deepEqual(blocosDoRuntime(p.carregado, 'claude-bg'), { principal: [], fallback: [] }, 'o #Classic no claude-bg nao e permitido');

    // Fallback no claude-bg avisa, sem reprovar.
    assert.equal(editarBloco(p.dir, 'auto', 1, { fallback: ['claude-bg:opus'] }).ok, true);
    const comFallback = checarRuntimeClaude(exigirManifesto(p.dir), null, null);
    assert.equal(comFallback.nivel, 'warn');
    assert.match(comFallback.detalhe, /o fallback de 1 bloco\(s\) cai nele e falharia: #Auto 1\)$/);

    // Todos os modos de volta e todos os blocos no Codex: a falta continua aviso.
    ajustarManifesto(p, /allowed_modes: \[auto\]/, 'allowed_modes: [classic, maestro, auto, fast]');
    for (const modo of p.carregado.manifesto.conduction.allowed_modes) {
      MODOS[modo].blocos.forEach((_, i) => assert.equal(editarBloco(p.dir, modo, i + 1, { runtime: 'codex', model: 'gpt-5.5' }).ok, true));
    }
    assert.equal(checarRuntimeClaude(exigirManifesto(p.dir), null, null).nivel, 'warn');
  } finally { p.limpar(); }
});

test('fatia 2 P1: despacho pelo codex vale quando um bloco permitido despacha por ele', () => {
  const p = projetoTemporario('fatia2-codex');
  const bin = binSoComGit('fatia2-codex-bin');
  const casa = dirTemporario('fatia2-codex-casa');
  try {
    // runtime.adapter: claude-bg e nenhum bloco no Codex: o check nao sai.
    assert.equal(checarDespachoPeloCodex(p.carregado, null, null), null);

    assert.equal(editarBloco(p.dir, 'auto', 1, { runtime: 'codex', model: 'gpt-5.5' }).ok, true);
    const semCodex = checarDespachoPeloCodex(exigirManifesto(p.dir), null, null);
    assert.equal(semCodex?.nivel, 'fail');
    assert.equal(semCodex?.detalhe, '1 bloco(s) dos modos permitidos no codex (#Auto 1), mas o binario `codex` esta fora do PATH');
    assert.equal(checarDespachoPeloCodex(exigirManifesto(p.dir), '/opt/bin/codex', { ok: false })?.nivel, 'fail', 'sandbox quebrado');
    assert.equal(checarDespachoPeloCodex(exigirManifesto(p.dir), '/opt/bin/codex', { ok: true })?.nivel, 'ok');

    // runtime.adapter: codex sozinho segue com o texto de antes.
    const q = projetoTemporario('fatia2-codex-adapter');
    try {
      ajustarManifesto(q, /adapter: claude-bg/, 'adapter: codex');
      assert.equal(checarDespachoPeloCodex(q.carregado, null, null)?.detalhe,
        'runtime.adapter: codex, mas o binario `codex` esta fora do PATH');
    } finally { q.limpar(); }

    // A CLI, sem claude nem codex no PATH: os dois checks reprovam, cada um com a origem.
    const r = ork(p.dir, casa, bin, 'doctor');
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /^ {2}\[FAIL\] despacho pelo codex +1 bloco\(s\) dos modos permitidos no codex \(#Auto 1\)/m, r.stdout);
    assert.match(r.stdout, /^ {2}\[FAIL\] runtime claude-bg +binario `claude` fora do PATH; \d+ bloco\(s\)/m);
  } finally { p.limpar(); limpar(bin, casa); }
});

test('fatia 2 P1: sessions sem o binario claude diz fonte ausente com a correcao', () => {
  const p = projetoTemporario('fatia2-sessions');
  const bin = binSoComGit('fatia2-sessions-bin');
  const casa = dirTemporario('fatia2-sessions-casa');
  try {
    const texto = ork(p.dir, casa, bin, 'sessions');
    assert.equal(texto.status, 0, texto.stdout + texto.stderr);
    assert.match(texto.stdout, /^Fontes: claude agents --json \(ausente\);/m);
    assert.match(texto.stdout, /^Ausente: binário `claude` fora do PATH: nenhuma sessão claude-bg a listar; correção: .*instale o Claude Code/m);
    assert.doesNotMatch(texto.stdout, /código -1/);

    const json = ork(p.dir, casa, bin, 'sessions', '--json');
    assert.equal(json.status, 0, json.stderr);
    const inventario = JSON.parse(json.stdout) as { ok: boolean; fontes: { origem: string; ok: boolean; ausente?: boolean; correcao?: string }[] };
    const fonte = inventario.fontes.find((f) => f.origem.startsWith('claude agents'));
    assert.deepEqual([inventario.ok, fonte?.ok, fonte?.ausente], [true, true, true]);
    assert.match(fonte?.correcao ?? '', /instale o Claude Code/);

    // Para os outros leitores a consulta segue falha: ausencia nao prova que nada vive.
    const consulta = consultarSessoes(undefined, false, { PATH: bin });
    assert.deepEqual([consulta.ok, consulta.ausente], [false, true]);

    // Outra falha do claude (existe e sai 3) continua deixando o inventario incompleto.
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    const falha = ork(p.dir, casa, bin, 'sessions');
    assert.equal(falha.status, 1);
    assert.match(falha.stdout, /claude agents --json \(FALHA\)/);
    assert.match(falha.stdout, /^Falha: claude agents falhou \(código 3\)$/m);
  } finally { p.limpar(); limpar(bin, casa); }
});

test('fatia 2 P1: quickstart e guia de modos documentam o caminho so com Codex', () => {
  for (const arquivo of ['docs/comecar/quickstart.md', 'docs/guias/modos.md']) {
    const doc = ler(arquivo).replace(/\s+/g, ' ');
    assert.ok(doc.includes('Só com o Codex'), arquivo);
    assert.ok(doc.includes('`ork setup <modo> --bloco N --runtime codex --model <modelo>`'), arquivo);
    assert.match(doc, /o `ork doctor` reprova a falta do `claude` (?:só )?enquanto algum bloco de modo permitido despachar/i, arquivo);
  }
});

test('fatia 2 P2: ship --dry-run grava o gate com dryRun e board, monitor e maestro o ignoram', () => {
  const p = projetoTemporario('fatia2-dryrun');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'pedido de ensaio', modo: 'classic', criarWorktree: true });
    const dir = dirThread(p.dir, thread.id);
    const estados = new Map<string, string>();
    const agora = () => new Date().toISOString();
    const situacao = () => planejar(p.carregado, { agora: agora(), estados }).vagas.find((v) => v.thread === thread.id)?.situacao;
    const paradas = () => montarMonitor(p.carregado, { agora: agora(), estados }).linhas.find((l) => l.thread === thread.id)?.paradas ?? [];
    const maestro = () => operationalSources(new MaestroReader(p.dir), [lerThread(p.dir, thread.id)], [], agora());
    assert.notEqual(situacao(), 'pausada', 'antes do ensaio');

    const ensaio = ship(p.carregado, thread.id, { para: 'main', dryRun: true });
    assert.deepEqual([ensaio.dryRun, ensaio.motivo], [true, 'human.pending']);
    const gate = lerLedger(dir).filter((e) => e.tipo === 'gate_blocked').at(-1);
    assert.equal(gate?.dryRun, true, 'o gate do ensaio leva dryRun');
    assert.equal(ehEnsaio(gate!), true);
    assert.notEqual(situacao(), 'pausada', 'board e escalonador ignoram o ensaio');
    assert.deepEqual(paradas(), [], 'o monitor (o pulse) nao abre parada');
    const doEnsaio = maestro();
    assert.deepEqual(doEnsaio.blockers?.items ?? [], [], 'o maestro nao lista bloqueio');
    assert.deepEqual(doEnsaio.ship?.items ?? [], [], 'nem entrega incompleta');

    // O ship de verdade, barrado pela pausa do #Classic, continua pausando a thread.
    const real = ship(p.carregado, thread.id, { para: 'main' });
    assert.deepEqual([real.dryRun, real.motivo], [false, 'human.pending']);
    assert.equal(lerLedger(dir).filter((e) => e.tipo === 'gate_blocked').at(-1)?.dryRun, undefined);
    assert.equal(situacao(), 'pausada');
    assert.ok(paradas().some((x) => x.motivo === 'human.pending'));
    assert.ok((maestro().blockers?.items ?? []).length > 0);
  } finally { p.limpar(); }
});

/** Repositorio novo com um commit (e o `.gitignore` do usuario, quando pedido). */
function repoComCommit(nome: string, gitignoreDoUsuario?: string): string {
  const dir = dirTemporario(nome);
  exec('git', ['init', '-q', '-b', 'main'], dir);
  for (const [k, v] of [['user.email', 'teste@orkastery.local'], ['user.name', 'Teste Orkastery'], ['commit.gpgsign', 'false']]) {
    exec('git', ['config', k, v], dir);
  }
  fs.writeFileSync(path.join(dir, 'README.md'), '# fatia 2\n');
  const arquivos = ['README.md'];
  if (gitignoreDoUsuario !== undefined) { fs.writeFileSync(path.join(dir, '.gitignore'), gitignoreDoUsuario); arquivos.push('.gitignore'); }
  exec('git', ['add', '--', ...arquivos], dir);
  assert.ok(exec('git', ['commit', '-q', '-m', 'inicial'], dir).ok, 'commit inicial');
  return dir;
}

const naoRastreados = (dir: string): string => exec('git', ['status', '--porcelain', '--untracked-files=all'], dir).stdout;

test('fatia 2 P3: init cria .orkastery/.gitignore com * sem tocar no .gitignore do usuario', () => {
  const dir = repoComCommit('fatia2-init', 'node_modules/\n');
  const rastreado = repoComCommit('fatia2-init-rastreado');
  const casa = dirTemporario('fatia2-init-casa');
  const cli = repoComCommit('fatia2-init-cli');
  try {
    const doUsuario = fs.readFileSync(path.join(dir, '.gitignore'));
    const r = init(dir, { nome: 'ensaio', abbrev: 'ens' });
    assert.equal(r.estadoIgnorado, true);
    assert.equal(fs.readFileSync(path.join(dir, '.orkastery/.gitignore'), 'utf8'), GITIGNORE_DA_MAQUINA);
    assert.match(GITIGNORE_DA_MAQUINA, /^\*$/m);
    assert.deepEqual(fs.readFileSync(path.join(dir, '.gitignore')), doUsuario, 'o .gitignore do usuario fica byte a byte');

    // Depois do uso, o estado nao aparece para o `git add`; o manifesto e o AGENTS.md, sim.
    fs.writeFileSync(path.join(dir, '.orkastery/ledger.jsonl'), '{}\n');
    fs.mkdirSync(path.join(dir, '.orkastery/private'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.orkastery/private/segredo'), 'x\n');
    const status = naoRastreados(dir);
    assert.doesNotMatch(status, /\.orkastery/);
    assert.match(status, /orkastery\.yaml/);

    // Existente nao e sobrescrito, nem no init --force.
    fs.writeFileSync(path.join(dir, '.orkastery/.gitignore'), '# do dono\nthreads/\n');
    assert.equal(init(dir, { force: true, nome: 'ensaio', abbrev: 'ens' }).estadoIgnorado, false);
    assert.equal(fs.readFileSync(path.join(dir, '.orkastery/.gitignore'), 'utf8'), '# do dono\nthreads/\n');

    // O projeto que versiona o proprio estado segue versionando: nada de .gitignore novo.
    fs.mkdirSync(path.join(rastreado, '.orkastery/threads/ens-x'), { recursive: true });
    fs.writeFileSync(path.join(rastreado, '.orkastery/threads/ens-x/thread.json'), '{}\n');
    exec('git', ['add', '--', '.orkastery/threads/ens-x/thread.json'], rastreado);
    assert.ok(exec('git', ['commit', '-q', '-m', 'estado versionado'], rastreado).ok);
    assert.equal(init(rastreado, { nome: 'ensaio', abbrev: 'ens' }).estadoIgnorado, false);
    assert.equal(fs.existsSync(path.join(rastreado, '.orkastery/.gitignore')), false);
    // Pasta fora do repositorio nao recebe nada.
    assert.equal(ignorarPastaNoGit(casa, dir), false);

    // A CLI diz que deixou o estado fora do git.
    const saida = ork(cli, casa, PATH_ATUAL, 'init');
    assert.equal(saida.status, 0, saida.stderr);
    assert.match(saida.stdout, /^ {2}estado {6}\.orkastery\/ fora do git \(\.orkastery\/\.gitignore com \*; o seu \.gitignore fica como está\)$/m);
  } finally { limpar(dir, rastreado, casa, cli); }
});

test('fatia 2 P3: a pasta de worktrees ganha .gitignore com * quando o ork a cria', () => {
  const p = projetoTemporario('fatia2-worktrees');
  const q = projetoTemporario('fatia2-worktrees-existente');
  try {
    const pasta = path.join(p.dir, '.claude/worktrees');
    assert.equal(fs.existsSync(pasta), false);
    novaThread(p.carregado, { nome: 'primeira com worktree', modo: 'auto', criarWorktree: true });
    assert.equal(fs.readFileSync(path.join(pasta, '.gitignore'), 'utf8'), GITIGNORE_DA_MAQUINA);
    assert.doesNotMatch(naoRastreados(p.dir), /\.claude\/worktrees|\.orkastery/);
    // A segunda worktree encontra a pasta e o arquivo; nada muda.
    fs.writeFileSync(path.join(pasta, '.gitignore'), GITIGNORE_DA_MAQUINA + '# conferido\n');
    novaThread(p.carregado, { nome: 'segunda com worktree', modo: 'auto', criarWorktree: true });
    assert.equal(fs.readFileSync(path.join(pasta, '.gitignore'), 'utf8'), GITIGNORE_DA_MAQUINA + '# conferido\n');

    // Pasta que ja existia antes do ork nao ganha o arquivo: quem a criou cuida dela.
    fs.mkdirSync(path.join(q.dir, '.claude/worktrees'), { recursive: true });
    novaThread(q.carregado, { nome: 'outra com worktree', modo: 'auto', criarWorktree: true });
    assert.equal(fs.existsSync(path.join(q.dir, '.claude/worktrees/.gitignore')), false);
  } finally { p.limpar(); q.limpar(); }
});

const FRASE_DOS_SEGREDOS = 'no ambiente do processo ou no cofre do host (no Hermes, ~/.hermes/.env)';
/** Texto comparavel entre codigo e doc: sem crase e com um espaco so. */
const semCraseNemQuebra = (t: string): string => t.replace(/`/g, '').replace(/\s+/g, ' ');
const SEGREDO_SO_NO_HERMES = /(?:somente|só) em ~\/\.hermes\/\.env|(?:ficam|valores) (?:somente )?em ~\/\.hermes\/\.env/i;

test('fatia 2 P5: segredos no ambiente do processo ou no cofre do host, no onboarding e na ajuda', () => {
  assert.equal(ONDE_FICAM_OS_SEGREDOS, FRASE_DOS_SEGREDOS);
  for (const etapa of ['credenciais', 'bancos'] as const) {
    const pergunta = PAUTA_ONBOARDING.find((x) => x.etapa === etapa)?.pergunta ?? '';
    assert.ok(pergunta.includes(FRASE_DOS_SEGREDOS), etapa);
    assert.doesNotMatch(pergunta, SEGREDO_SO_NO_HERMES, etapa);
  }
  assert.throws(() => validarConteudo('credenciais', { campo: 'livre' }),
    (e: Error) => e.message.startsWith('onboarding.input.invalid') && e.message.includes(FRASE_DOS_SEGREDOS));

  const casa = dirTemporario('fatia2-ajuda-casa');
  try {
    const ajuda = ork(casa, casa, PATH_ATUAL, '--help');
    assert.equal(ajuda.status, 0, ajuda.stderr);
    assert.ok(semCraseNemQuebra(ajuda.stdout).includes(`Segredos ficam ${FRASE_DOS_SEGREDOS}`), 'ajuda do onboarding');
    assert.doesNotMatch(ajuda.stdout, SEGREDO_SO_NO_HERMES);
  } finally { limpar(casa); }

  // Guia, quickstart, regra da feature, skill, comando do Claude Code e tool do OpenClaw (fonte e dist).
  for (const arquivo of ['docs/guias/onboarding.md', 'docs/comecar/quickstart.md', 'docs/produto/FEAT-023-onboarding-do-projeto.md',
    'skills/core/onboarding/SKILL.md', 'marketplaces/claude-code/orkastery/skills/core/onboarding/SKILL.md',
    'marketplaces/codex/orkastery/skills/core/onboarding/SKILL.md', 'adapters/claude-code/commands/onboarding.md',
    'marketplaces/claude-code/orkastery/commands/onboarding.md', 'adapters/openclaw/src/index.ts', 'adapters/openclaw/dist/index.js']) {
    const texto = semCraseNemQuebra(ler(arquivo));
    assert.ok(texto.includes(FRASE_DOS_SEGREDOS), `${arquivo}: frase nova ausente`);
    assert.doesNotMatch(texto, SEGREDO_SO_NO_HERMES, `${arquivo}: frase antiga`);
  }
});

test('fatia 2 P6: correcao do lint de suite inteira e generica e o modulo segue puro', () => {
  for (const comando of ['npm test', 'npm test -- relatorio', 'npm --prefix core test']) {
    const [achado] = analisarComando(comando);
    assert.equal(achado?.regra, 'suite-inteira', comando);
    assert.doesNotMatch(achado.correcao, /--prefix core|test:ci/, 'o script do Orkastery nao vale em outro projeto');
    assert.match(achado.correcao, /só o teste da claim/);
    assert.match(achado.correcao, /script hermético do projeto/);
  }
  // O modulo continua puro: nada de disco, processo ou leitura do projeto.
  const fonte = ler('core/src/claim-lint.ts');
  assert.doesNotMatch(fonte, /from 'node:|require\(/);
  assert.doesNotMatch(fonte, /npm --prefix core/);
  // A dica de ci.failed das licoes tinha o mesmo texto do Orkastery.
  assert.doesNotMatch(DICA_DO_MOTIVO['ci.failed'], /--prefix core|test:ci/);
  assert.match(DICA_DO_MOTIVO['ci.failed'], /`ci\.command` do manifesto/);
  const linha = ler('docs/guias/verificacao.md').split('\n').find((l) => l.startsWith('| a suíte inteira'));
  assert.ok(linha, 'linha do lint no guia de verificacao');
  assert.doesNotMatch(linha, /test:ci/);
  assert.match(linha, /script hermético do projeto/);
});

test('fatia 2 P7: roadmap status diz o fuso logo abaixo do titulo', () => {
  // Com remoto: o panorama da rede le o roadmap do clone (sem remoto, ele so registra a lacuna).
  const p = projetoTemporario('fatia2-roadmap', true);
  const casa = dirTemporario('fatia2-roadmap-casa');
  try {
    const status = montarStatusDoRoadmap(p.dir, { quando: '2026-10-02T03:00:00.000Z', projeto: 'orkastery' });
    const brasilia = textoDoStatusDoRoadmap(status, 'America/Sao_Paulo').split('\n');
    assert.equal(brasilia[0], 'Roadmap do Orkastery (02/10, 00:00)', 'o titulo aprovado nao muda');
    assert.equal(brasilia[1], 'Horários de Brasília.');
    assert.deepEqual(textoDoStatusDoRoadmap(status, 'UTC').split('\n').slice(0, 2), ['Roadmap do Orkastery (02/10, 03:00)', 'Horários em UTC.']);
    assert.doesNotMatch(textoDoStatusDoRoadmap(status, 'UTC', { legenda: false }), /Horários/, 'sem a legenda para quem ja a diz');

    // A CLI: titulo, fuso e, so depois, o projeto consultado da RM-052.
    ajustarManifesto(p, '# timezone: "America/Sao_Paulo"', 'timezone: "America/Sao_Paulo"');
    const cli = ork(p.dir, casa, PATH_ATUAL, 'roadmap', 'status');
    assert.equal(cli.status, 0, cli.stderr);
    const linhas = cli.stdout.split('\n');
    assert.match(linhas[0], /^Roadmap do Orkastery \(\d{2}\/\d{2}, \d{2}:\d{2}\)$/);
    assert.equal(linhas[1], 'Horários de Brasília.');
    assert.match(linhas[2], /^Projeto consultado: /);
    assert.equal(linhas.filter((l) => l.startsWith('Horários')).length, 1, 'o fuso uma vez por mensagem');

    // O panorama da rede diz o fuso no fim; o bloco do status nao repete a legenda.
    const panorama = montarPanoramaDaRede({ cwd: p.dir, quando: '2026-10-02T03:00:00.000Z', maquina: 'pc-a', semRemoto: true,
      registro: path.join(casa, 'projetos.json') });
    assert.ok(panorama.projetos[0]?.roadmap, 'o panorama leu o roadmap do projeto');
    const texto = textoDoPanoramaDaRede(panorama).split('\n');
    assert.ok(texto.includes('Roadmap do Orkastery (02/10, 00:00)'));
    assert.deepEqual(texto.filter((l) => /Horários/.test(l)), ['Horários de Brasília.']);
    assert.equal(texto.at(-1), 'Horários de Brasília.');
  } finally { p.limpar(); limpar(casa); }
});
