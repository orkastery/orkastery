#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..');
const core = path.join(repo, 'core');
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-pacote-macos-'));
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
  fs.writeFileSync(path.join(projeto, 'package.json'), '{"name":"macos-package-proof","private":true}\n');
  executar('git', ['add', '--', 'package.json'], projeto);
  executar('git', ['commit', '-qm', 'inicio'], projeto);

  executar(ork, ['demo'], projeto);
  executar(ork, ['init', '--name', 'macos-package-proof', '--abbrev', 'mac'], projeto);
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

  executar(ork, ['thread', 'new', 'primeira thread no macOS', '--modo', 'fast', '--sem-worktree'], projeto);

  const verifyInstalado = path.join(prefixo, 'node_modules', '@orkastery', 'cli', 'dist', 'verify.js');
  executar(process.execPath, ['-e', [
    "const v=require(process.argv[1]);",
    "const r=v.executar('pacote','true',process.argv[2],5000);",
    "if(!r.ok||r.executado===false||r.shell?.caminho!=='/bin/bash')throw Error(JSON.stringify(r));",
  ].join(''), verifyInstalado, projeto], projeto);

  process.stdout.write(JSON.stringify({ contrato: 'ork.prova-macos-pacote/v1', pacote: nome,
    demo: 'ok', init: 'ok', doctor: 'capacidades-ok', threadNew: 'ok', verify: 'ok' }) + '\n');
} finally {
  fs.rmSync(temporario, { recursive: true, force: true });
}
