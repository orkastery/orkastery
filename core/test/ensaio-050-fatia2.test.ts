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
import { exec, noPath } from '../src/util';
import { blocosDoRuntime, checarDespachoPeloCodex, checarRuntimeClaude } from '../src/doctor';
import { consultarSessoes } from '../src/adapters/claude-bg';
import { exigirManifesto } from '../src/manifest';
import { MODOS } from '../src/modos';
import { editarBloco } from '../src/setup';
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
