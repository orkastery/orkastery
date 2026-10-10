/**
 * RM-052 (T6): Hermes e Claude Code com o projeto explicito.
 *
 * Os scripts do Hermes declaram `ORK_PROJETO_EXPLICITO=1` (o gateway nao tem cwd de projeto) e
 * repassam `--projeto <nome>` como dado; a skill do Hermes, o `/ork` do Claude Code e o bootstrap
 * comum mandam passar o projeto pedido e nunca deduzir o roadmap do board ou do panorama.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { instalarAdaptador } from '../src/hosts';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { registrarProjeto } from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function projeto(nome: string, abbrev: string): ProjetoDeTeste {
  const p = projetoTemporario(`projeto-alvo-hosts-${nome}`);
  init(p.dir, { nome, abbrev, force: true });
  p.carregado = exigirManifesto(p.dir);
  return p;
}

function sh(script: string, args: string[], cwd: string, env: Record<string, string>) {
  const base = { ...process.env };
  delete base.ORK_PROJETO; delete base.ORK_PROJETO_EXPLICITO;
  return spawnSync('/bin/sh', [script, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...base, ...env } });
}

test('scripts do Hermes: ORK_PROJETO_EXPLICITO=1 por padrao, --projeto passa como dado e o abrir-thread le o modo no projeto pedido', () => {
  const p = projeto('orkastery', 'ork');
  try {
    const install = instalarAdaptador('hermes', { projeto: p.dir });
    const chamadas = path.join(p.dir, 'chamadas');
    const falso = path.join(p.dir, 'ork falso');
    fs.writeFileSync(falso, `#!/bin/sh\nprintf "%s|" "$ORK_PROJETO_EXPLICITO" "$@" >> "${chamadas}"; printf "\\n" >> "${chamadas}"\n` +
      'case " $* " in *" modos "*) echo auto ;; esac\n', { mode: 0o755 });
    const env = { ORK_BIN: falso };
    for (const nome of ['ork-maestro.sh', 'ork-roadmap-status.sh', 'ork-brain.sh']) {
      const bin = path.join(install.destino, 'bin', nome);
      const texto = fs.readFileSync(bin, 'utf8');
      assert.match(texto, /export ORK_PROJETO_EXPLICITO="\$\{ORK_PROJETO_EXPLICITO:-1\}"/, nome);
    }
    fs.writeFileSync(path.join(install.destino, 'bin', 'ork-brain.sh'),
      fs.readFileSync(path.join(install.destino, 'bin', 'ork-brain.sh'), 'utf8').replace(/"[^"]*" brain/, '"$ORK_BIN" brain'));
    assert.equal(sh(path.join(install.destino, 'bin/ork-roadmap-status.sh'), ['--projeto', 'orkastery'], p.dir, env).status, 0);
    assert.equal(sh(path.join(install.destino, 'bin/ork-maestro.sh'), ['--projeto', 'a b; $(id)'], p.dir, env).status, 0);
    assert.equal(sh(path.join(install.destino, 'bin/ork-brain.sh'), ['status'], p.dir, { ...env, ORK_PROJETO_EXPLICITO: '0' }).status, 0);
    const abrir = sh(path.join(install.destino, 'bin/ork-abrir-thread.sh'), ['Nome', 'pedido #Auto', '--projeto', 'orkastery'], p.dir, env);
    assert.equal(abrir.status, 0, abrir.stderr);
    assert.deepEqual(fs.readFileSync(chamadas, 'utf8').trim().split('\n'), [
      '1|roadmap|status|--projeto|orkastery|',
      '1|maestro|--json|--projeto|a b; $(id)|',
      '0|brain|status|',
      '1|--projeto|orkastery|modos|--do-pedido|pedido #Auto|',
      '1|thread|new|Nome|--mode|auto|--projeto|orkastery|',
    ]);
    assert.equal(fs.existsSync(path.join(p.dir, 'INJETADO')), false);
  } finally { p.limpar(); }
});

test('Hermes de ponta a ponta com o ork real: gateway no cwd de outro projeto devolve a escolha; com --projeto, o pedido', () => {
  const a = projeto('orkastery', 'ork'), gateway = projeto('workspace', 'wor');
  const usuario = dirTemporario('projeto-alvo-hosts-usuario');
  const anterior = process.env.ORK_USUARIO_DIR;
  try {
    process.env.ORK_USUARIO_DIR = usuario;
    registrarProjeto(a.dir, 'init'); registrarProjeto(gateway.dir, 'init');
    const install = instalarAdaptador('hermes', { projeto: gateway.dir });
    const bin = path.join(install.destino, 'bin/ork-roadmap-status.sh');
    const env = { ORK_BIN: ORK, ORK_USUARIO_DIR: usuario };
    const escolha = sh(bin, [], gateway.dir, env);
    assert.equal(escolha.status, 4, escolha.stdout + escolha.stderr);
    assert.match(escolha.stdout, /^projeto\.escolha: 2 projetos conhecidos/);
    assert.ok(!/Roadmap do Workspace/.test(escolha.stdout), 'o projeto do cwd nunca sai como o pedido');
    const pedido = sh(bin, ['--projeto', 'orkastery'], gateway.dir, env);
    assert.equal(pedido.status, 0, pedido.stderr);
    const linhas = pedido.stdout.split('\n');
    assert.match(linhas[0], /^Roadmap do Orkastery /);
    // Fatia 2 do ensaio da 0.5.0 (P7): o fuso vem logo abaixo do titulo, e o projeto consultado em seguida.
    assert.match(linhas[1], /^Horários (?:de Brasília|em .+)\.$/);
    assert.match(linhas[2], /^Projeto consultado: orkastery \(ork\) · .* · pela opção --projeto$/);
  } finally { process.env.ORK_USUARIO_DIR = anterior; a.limpar(); gateway.limpar(); fs.rmSync(usuario, { recursive: true, force: true }); }
});

test('RM-052 (fatia 2, L4): a skill do Hermes manda --projeto em todo ork do terminal, dentro do teto de linhas', () => {
  const p = projeto('orkastery', 'ork');
  try {
    const hermes = instalarAdaptador('hermes', { projeto: p.dir });
    const skill = fs.readFileSync(path.join(hermes.destino, 'skills/orkastery-devmaster/SKILL.md'), 'utf8');
    // Fora dos wrappers (que declaram o modo host), o `ork` do terminal do Hermes resolvia pelo cwd do gateway.
    assert.ok(skill.includes('No terminal, todo `ork` leva `--projeto <nome>` do projeto pedido; sem ele, quem escolhe é o cwd do gateway.'),
      'a regra do terminal');
    assert.ok(skill.split('\n').length <= 170, 'a skill do Hermes segue no teto de hosts.test');
  } finally { p.limpar(); }
});

test('skill do Hermes, /ork do Claude Code e bootstrap comum: projeto pedido, cabecalho lido e roadmap so da fonte do roadmap', () => {
  const p = projeto('orkastery', 'ork');
  try {
    const hermes = instalarAdaptador('hermes', { projeto: p.dir });
    const skill = fs.readFileSync(path.join(hermes.destino, 'skills/orkastery-devmaster/SKILL.md'), 'utf8');
    for (const trecho of ['vai como `--projeto <nome>`', 'projeto.escolha', 'nunca escolha pelo cwd', '"Projeto consultado"',
      '`ork roadmap status --projeto <nome>`', 'zero threads nunca é roadmap vazio']) assert.ok(skill.includes(trecho), trecho);

    const claude = instalarAdaptador('claude-code', { projeto: p.dir });
    const ork = fs.readFileSync(path.join(claude.destino, 'commands/ork.md'), 'utf8');
    for (const trecho of ['projeto.fora-do-servidor', '`--projeto <nome>`', 'zero threads nao e roadmap vazio',
      'Leia "Projeto consultado" e "Não lido"']) assert.ok(ork.includes(trecho), trecho);

    const bootstrap = fs.readFileSync(path.join(claude.destino, 'skills/core/orkastery-bootstrap/SKILL.md'), 'utf8');
    for (const trecho of ['O projeto de cada consulta é explícito (RM-052)', '`--projeto <nome>` no CLI',
      'zero threads nunca é roadmap vazio', 'a frase não abre outra orquestração']) assert.ok(bootstrap.includes(trecho), trecho);
  } finally { p.limpar(); }
});
