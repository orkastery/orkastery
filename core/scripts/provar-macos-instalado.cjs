#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const core = path.join(repo, 'core');
const fixtureDoProjeto = path.join(core, 'test', 'fixtures', 'pacote-portatil');

const CATEGORIAS_DO_LACO = new Set(['secret', 'dependency', 'sast', 'iac', 'workflow']);
const FALTA_DE_RUNTIME_DE_CONTAINER = new Set(['docker-missing', 'docker-daemon-down']);

function dispensadaPeloScan(item, ferramentas) {
  const saidas = [
    path.join(core, 'dist', 'security-scan', 'report.js'),
    path.join(core, 'dist-test', 'src', 'security-scan', 'report.js'),
  ];
  const modulo = saidas.find((arquivo) => fs.existsSync(arquivo));
  if (!modulo) throw Error('classificador de dispensas do security scan não foi compilado');
  return require(modulo).isExcusedUnscanned(item, ferramentas);
}

function classificarSecurityScan(relatorio, codigo) {
  if (!relatorio || relatorio.schema !== 'ork.security-scan/v1' || !Array.isArray(relatorio.tools) || !Array.isArray(relatorio.findings)) {
    throw Error('security scan não devolveu relatório ork.security-scan/v1');
  }
  const ferramentas = relatorio.tools.filter((item) => CATEGORIAS_DO_LACO.has(item.category));
  if (ferramentas.length === 0) throw Error('security scan não informou ferramentas do laço');
  if (relatorio.findings.some((item) => item.status === 'new' && item.loop === true)) {
    throw Error('security scan encontrou achado novo no laço');
  }
  const semExecucao = ferramentas.filter((item) => item.state !== 'ran' && !dispensadaPeloScan(item, relatorio.tools));
  if (semExecucao.length === 0) {
    if (codigo !== 0) throw Error(`security scan coberto saiu com código ${codigo}`);
    return { estado: 'coberto', ferramentas: ferramentas.map((item) => item.name) };
  }
  if (codigo === 0) throw Error('security scan saiu verde com ferramenta do laço que não rodou');
  const motivoInvalido = semExecucao.find((item) => item.state !== 'unavailable' || !FALTA_DE_RUNTIME_DE_CONTAINER.has(item.reason));
  if (motivoInvalido) {
    throw Error(`security scan não cobriu ${motivoInvalido.name}: ${motivoInvalido.state}/${motivoInvalido.reason ?? 'sem motivo'}`);
  }
  return { estado: 'nao-coberto-sem-runtime-de-container', ferramentas: semExecucao.map((item) => item.name) };
}

function resolverNoPath(nome, env = process.env) {
  const extensoes = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of String(env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extensao of extensoes) {
      const candidato = path.join(dir, `${nome}${extensao}`);
      try { if (fs.statSync(candidato).isFile()) return fs.realpathSync(candidato); } catch { /* próximo candidato */ }
    }
  }
  return null;
}

function principal() {
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-pacote-portatil-'));
  const pacotes = path.join(temporario, 'pacotes');
  const prefixo = path.join(temporario, 'instalado');
  const projeto = path.join(temporario, 'projeto');
  const home = path.join(temporario, 'home');
  const binDoPrefixo = path.join(prefixo, 'bin');
  const ambiente = {
    ...process.env,
    HOME: home,
    PATH: [binDoPrefixo, process.env.PATH ?? ''].filter(Boolean).join(path.delimiter),
    NO_COLOR: '1',
    NPM_CONFIG_CACHE: path.join(temporario, 'npm-cache'),
  };
  const executar = (bin, args, cwd, opcoes = {}) => cp.execFileSync(bin, args, {
    cwd,
    env: { ...ambiente, ...opcoes.env },
    encoding: 'utf8',
    stdio: opcoes.capturar ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });
  const executarComSaida = (bin, args, cwd, opcoes = {}) => {
    try { return { codigo: 0, stdout: executar(bin, args, cwd, { ...opcoes, capturar: true }) }; }
    catch (e) {
      return { codigo: Number.isInteger(e.status) ? e.status : -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
    }
  };
  try {
    fs.mkdirSync(pacotes); fs.mkdirSync(home);
    executar('npm', ['pack', '--silent', '--pack-destination', pacotes], core, { capturar: true });
    const gerados = fs.readdirSync(pacotes).filter((arquivo) => arquivo.endsWith('.tgz'));
    if (gerados.length !== 1) throw Error('npm pack não produziu um único tarball');
    const nome = gerados[0];
    const tarball = path.join(pacotes, nome);
    executar('npm', ['install', '-g', '--prefix', prefixo, '--no-audit', '--no-fund', '--no-package-lock', tarball], temporario);

    const ork = path.join(binDoPrefixo, process.platform === 'win32' ? 'ork.cmd' : 'ork');
    if (!fs.existsSync(ork)) throw Error('binário do pacote instalado não encontrado');
    const entradaInstalada = path.join(prefixo, 'lib', 'node_modules', '@orkastery', 'cli', 'dist', 'index.js');
    if (resolverNoPath('ork', ambiente) !== fs.realpathSync(entradaInstalada)) throw Error('ork resolvido no PATH não pertence ao tarball instalado');

    fs.mkdirSync(projeto);
    executar('git', ['init', '-q'], projeto);
    executar('git', ['config', 'user.name', 'Ork CI'], projeto);
    executar('git', ['config', 'user.email', 'ork-ci@example.invalid'], projeto);
    fs.cpSync(fixtureDoProjeto, projeto, { recursive: true });
    executar('git', ['add', '--', 'package.json', 'package-lock.json'], projeto);
    executar('git', ['commit', '-qm', 'inicio'], projeto);

    executar('ork', ['demo'], projeto);
    executar('ork', ['init', '--name', 'portable-package-proof', '--abbrev', 'prt'], projeto);
    executar('git', ['add', '--all'], projeto);
    executar('git', ['commit', '-qm', 'ork init'], projeto);

    const doctor = executarComSaida('ork', ['doctor', '--json'], projeto);
    let relatorio;
    try { relatorio = JSON.parse(doctor.stdout); }
    catch { throw Error(`doctor não devolveu JSON válido (código ${doctor.codigo})`); }
    const checks = Array.isArray(relatorio.checks) ? relatorio.checks : [];
    for (const nomeDoCheck of ['trava portátil', 'shell do verify']) {
      const check = checks.find((item) => item.nome === nomeDoCheck);
      if (!check || check.nivel === 'fail') throw Error(`doctor reprovou ${nomeDoCheck}`);
    }

    const criada = executar('ork', ['thread', 'new', 'primeira thread portátil', '--modo', 'fast'], projeto, { capturar: true });
    const threadId = /^\s*id\s+(\S+)\s*$/m.exec(criada)?.[1];
    const worktreeBruta = /^\s*worktree\s+(.+?)\s*$/m.exec(criada)?.[1];
    if (!threadId || !worktreeBruta) throw Error('thread new não informou id e worktree');
    const worktree = path.resolve(projeto, worktreeBruta);
    if (!fs.statSync(worktree).isDirectory() || worktree === projeto) throw Error('thread new não criou worktree isolada');

    executar('ork', ['claims', 'add', threadId, 'package.json', '--claim', 'o pacote da fixture tem script de teste',
      '--verificar', "node -e \"const p=require('./package.json');process.exit(typeof p.scripts?.test==='string'?0:1)\""], worktree);
    executar('ork', ['verify', threadId, '--so-claims'], worktree);
    executar('npm', ['run', 'build'], worktree);
    executar('npm', ['test'], worktree);
    const scan = executarComSaida('ork', ['security-scan', '--json'], worktree, { env: { ORK_SECURITY_SCAN_REQUIRED: '1' } });
    let relatorioDoScan;
    try { relatorioDoScan = JSON.parse(scan.stdout); }
    catch { throw Error(`security scan não devolveu JSON válido (código ${scan.codigo})`); }
    const coberturaDoScan = classificarSecurityScan(relatorioDoScan, scan.codigo);

    process.stdout.write(JSON.stringify({ contrato: 'ork.prova-pacote-portatil/v1', plataforma: process.platform, pacote: nome,
      demo: 'ok', init: 'ok', doctor: 'capacidades-ok', worktree: 'ok', claimsAdd: 'ok', claims: 'ok', build: 'ok', test: 'ok',
      securityScan: coberturaDoScan.estado }) + '\n');
  } finally {
    fs.rmSync(temporario, { recursive: true, force: true });
  }
}

module.exports = { classificarSecurityScan, resolverNoPath };
if (require.main === module) principal();
