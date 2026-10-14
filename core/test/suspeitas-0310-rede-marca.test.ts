/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): a marca da rede
 * (`~/.orkastery/rede/publicada.json`) guarda a ultima publicacao e a reserva D7 dos projetos.
 *
 * 1. Escrita nao atomica: um leitor concorrente (o `ork network status`, o `doctor`, o
 *    `publicarRede` fora da trava) nao pode ver o arquivo vazio ou cortado.
 * 2. Queda no meio da escrita: o processo morto depois do truncamento nao pode deixar a marca
 *    ilegivel, porque sem ela a proxima publicacao perde a reserva D7 e o doctor ve "nenhuma batida".
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const MODULO = path.resolve(__dirname, '../src/rede.js');

/** Uma marca grande (muitos projetos), para a escrita levar tempo e a janela ficar visivel. */
const MARCA = `(n) => ({ assinatura: 'a' + n, em: new Date().toISOString(), commit: 'c'.repeat(40), casa: 'github.com/p/r',
  forja: 'github', maquina: 'm1', projetos: Array.from({ length: 4000 }, (_, i) => ({ nome: 'p' + i, remoto: null, caminho: '/srv/p' + i })) })`;

test('suspeitas 03/10: leitor concorrente nunca ve a marca da rede vazia ou cortada', async () => {
  const dir = dirTemporario('susp0310-marca-leitor');
  let processo: ReturnType<typeof spawn> | null = null;
  try {
    const pronto = path.join(dir, 'temporario-pronto'), seguir = path.join(dir, 'seguir');
    const escritor = `const { gravarMarca } = require(${JSON.stringify(MODULO)}); const marca = ${MARCA};` +
      `gravarMarca(marca(0)); const fs = require('fs'), rename = fs.renameSync;` +
      `fs.renameSync = (de, para) => { fs.writeFileSync(${JSON.stringify(pronto)}, '1');` +
      `const p = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(${JSON.stringify(seguir)})) Atomics.wait(p, 0, 0, 10);` +
      `rename(de, para); }; gravarMarca(marca(1));`;
    const escritorProcesso = spawn(process.execPath, ['-e', escritor], { env: { ...process.env, ORK_USUARIO_DIR: dir } });
    processo = escritorProcesso;
    let stderr = '';
    escritorProcesso.stderr.on('data', d => { stderr += String(d); });
    const saiu = new Promise<number | null>((resolve, reject) => {
      escritorProcesso.on('error', reject); escritorProcesso.on('close', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      if (fs.existsSync(pronto)) return resolve();
      const watcher = fs.watch(dir, () => { if (fs.existsSync(pronto)) { watcher.close(); resolve(); } });
      escritorProcesso.on('close', code => { if (!fs.existsSync(pronto)) { watcher.close(); reject(new Error(`escritor saiu ${code}: ${stderr}`)); } });
    });
    const ler = (nome: string) => {
      const saida = path.join(dir, nome);
      const r = spawnSync(process.execPath, ['-e', `const fs = require('fs'), m = require(${JSON.stringify(MODULO)}).lerMarcaDaRede();` +
        `fs.writeFileSync(${JSON.stringify(saida)}, m ? m.assinatura : 'ILEGIVEL');`],
        { env: { ...process.env, ORK_USUARIO_DIR: dir }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(saida, 'utf8');
    };
    assert.equal(ler('leitura-antes'), 'a0', 'durante a troca, o leitor ve a marca anterior inteira');
    fs.writeFileSync(seguir, '1');
    assert.equal(await saiu, 0, stderr);
    assert.equal(ler('leitura-depois'), 'a1', 'depois da troca, o leitor ve a marca nova inteira');
  } finally {
    if (processo?.exitCode === null) processo.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('suspeitas 03/10: queda no meio da escrita deixa a marca anterior legivel (injecao de falha)', () => {
  const dir = dirTemporario('susp0310-marca-queda');
  try {
    // Primeiro a marca boa; depois uma escrita que morre logo depois de abrir (e truncar) o destino,
    // como o SIGKILL do cron entre o open(O_TRUNC) e o write.
    const codigo = `const fs = require('fs'); const { gravarMarca, lerMarcaDaRede } = require(${JSON.stringify(MODULO)}); const marca = ${MARCA};` +
      `gravarMarca(marca(1)); if (!lerMarcaDaRede()) process.exit(3);` +
      `fs.writeFileSync = (alvo) => { fs.closeSync(fs.openSync(alvo, 'w')); process.kill(process.pid, 'SIGKILL'); };` +
      `gravarMarca(marca(2));`;
    const r = spawnSync(process.execPath, ['-e', codigo], { env: { ...process.env, ORK_USUARIO_DIR: dir }, encoding: 'utf8' });
    assert.equal(r.signal, 'SIGKILL', `o filho morreu no meio da escrita: ${r.status} ${r.stderr}`);
    const lido = spawnSync(process.execPath, ['-e', `const m = require(${JSON.stringify(MODULO)}).lerMarcaDaRede(); process.stdout.write(m ? m.assinatura : 'ILEGIVEL');`],
      { env: { ...process.env, ORK_USUARIO_DIR: dir }, encoding: 'utf8' });
    assert.equal(lido.stdout, 'a1', 'a marca anterior continua legivel depois da queda');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('suspeitas 03/10: SIGKILL real durante escritas seguidas nunca deixa a marca ilegivel', async () => {
  const dir = dirTemporario('susp0310-marca-kill');
  try {
    const codigo = `const { gravarMarca } = require(${JSON.stringify(MODULO)}); const marca = ${MARCA};` +
      `gravarMarca(marca(0)); process.stdout.write('pronto'); for (let i = 1; ; i++) gravarMarca(marca(i));`;
    let ilegiveis = 0;
    for (let rodada = 0; rodada < 12; rodada++) {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(process.execPath, ['-e', codigo], { env: { ...process.env, ORK_USUARIO_DIR: dir } });
        p.stdout.once('data', () => setTimeout(() => p.kill('SIGKILL'), 20 + Math.floor(Math.random() * 60)));
        p.on('error', reject);
        p.on('close', () => resolve());
      });
      const lido = spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(MODULO)}).lerMarcaDaRede() ? 'ok' : 'ILEGIVEL');`],
        { env: { ...process.env, ORK_USUARIO_DIR: dir }, encoding: 'utf8' });
      if (lido.stdout !== 'ok') ilegiveis++;
    }
    assert.equal(ilegiveis, 0, `${ilegiveis} de 12 quedas deixaram a marca ilegivel`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
