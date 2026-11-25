#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const core = path.join(repo, 'core');
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-pacote-portatil-'));
const pacotes = path.join(temporario, 'pacotes');
const prefixo = path.join(temporario, 'instalado');
const projeto = path.join(temporario, 'projeto');

function executar(bin, args, cwd, opcoes = {}) {
  return cp.execFileSync(bin, args, {
    cwd,
    env: { ...process.env, NO_COLOR: '1', NPM_CONFIG_CACHE: path.join(temporario, 'npm-cache') },
    encoding: 'utf8',
    stdio: opcoes.capturar ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
  });
}

function executarComSaida(bin, args, cwd) {
  try { return { codigo: 0, stdout: executar(bin, args, cwd, { capturar: true }) }; }
  catch (e) {
    return { codigo: Number.isInteger(e.status) ? e.status : -1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

try {
  fs.mkdirSync(pacotes);
  executar('npm', ['pack', '--silent', '--pack-destination', pacotes], core, { capturar: true });
  const gerados = fs.readdirSync(pacotes).filter((arquivo) => arquivo.endsWith('.tgz'));
  if (gerados.length !== 1) throw Error('npm pack não produziu um único tarball');
  const nome = gerados[0];
  const tarball = path.join(pacotes, nome);
  executar('npm', ['install', '--prefix', prefixo, '--no-audit', '--no-fund', '--no-package-lock', tarball], temporario);

  const ork = path.join(prefixo, 'node_modules', '.bin', process.platform === 'win32' ? 'ork.cmd' : 'ork');
  if (!fs.existsSync(ork)) throw Error('binário do pacote instalado não encontrado');

  fs.mkdirSync(projeto);
  executar('git', ['init', '-q'], projeto);
  executar('git', ['config', 'user.name', 'Ork CI'], projeto);
  executar('git', ['config', 'user.email', 'ork-ci@example.invalid'], projeto);
  fs.writeFileSync(path.join(projeto, 'package.json'), JSON.stringify({
    name: 'portable-package-proof', private: true,
    scripts: { build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' },
  }, null, 2) + '\n');
  executar('git', ['add', '--', 'package.json'], projeto);
  executar('git', ['commit', '-qm', 'inicio'], projeto);

  executar(ork, ['demo'], projeto);
  executar(ork, ['init', '--name', 'portable-package-proof', '--abbrev', 'prt'], projeto);
  executar('git', ['add', '--all'], projeto);
  executar('git', ['commit', '-qm', 'ork init'], projeto);

  const doctor = executarComSaida(ork, ['doctor', '--json'], projeto);
  let relatorio;
  try { relatorio = JSON.parse(doctor.stdout); }
  catch { throw Error(`doctor não devolveu JSON válido (código ${doctor.codigo})`); }
  const checks = Array.isArray(relatorio.checks) ? relatorio.checks : [];
  for (const nomeDoCheck of ['trava portátil', 'shell do verify']) {
    const check = checks.find((item) => item.nome === nomeDoCheck);
    if (!check || check.nivel === 'fail') throw Error(`doctor reprovou ${nomeDoCheck}`);
  }

  const criada = executar(ork, ['thread', 'new', 'primeira thread portátil', '--modo', 'fast'], projeto, { capturar: true });
  const threadId = /^\s*id\s+(\S+)\s*$/m.exec(criada)?.[1];
  const worktreeBruta = /^\s*worktree\s+(.+?)\s*$/m.exec(criada)?.[1];
  if (!threadId || !worktreeBruta) throw Error('thread new não informou id e worktree');
  const worktree = path.resolve(projeto, worktreeBruta);
  if (!fs.statSync(worktree).isDirectory() || worktree === projeto) throw Error('thread new não criou worktree isolada');

  executar(ork, ['claims', 'add', threadId, 'package.json', '--claim', 'o pacote da fixture tem script de teste',
    '--verificar', 'test -f package.json'], worktree);
  executar(ork, ['verify', threadId], worktree);

  process.stdout.write(JSON.stringify({ contrato: 'ork.prova-pacote-portatil/v1', plataforma: process.platform, pacote: nome,
    demo: 'ok', init: 'ok', doctor: 'capacidades-ok', worktree: 'ok', claimsAdd: 'ok', verify: 'ok' }) + '\n');
} finally {
  fs.rmSync(temporario, { recursive: true, force: true });
}
