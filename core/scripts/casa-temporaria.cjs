#!/usr/bin/env node
/**
 * RM-063 (fatia 3, achado b): roda um comando com a casa do ork (`ORKASTERY_HOME`) numa pasta temporaria.
 *
 * Provas e testes que rodam o `ork` registraram projetos de `/tmp` e da pasta dos jobs do Claude Code no
 * `~/.orkastery/projetos.json` real de quem rodou a suite. O `npm test` passa por aqui: a suite inteira, inclusive o
 * arquivo de teste que nao importa `test/apoio.ts`, grava o registro de projetos, a maquina, a rede e o registro das
 * sessoes numa casa que some no fim. Quem ja exporta `ORKASTERY_HOME` escolheu a propria casa e e respeitado.
 *
 *   node scripts/casa-temporaria.cjs <comando> [argumentos...]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [comando, ...argumentos] = process.argv.slice(2);
if (!comando) {
  process.stderr.write('uso: node scripts/casa-temporaria.cjs <comando> [argumentos...]\n');
  process.exit(2);
}
const env = { ...process.env };
let casa = null;
if (!(env.ORKASTERY_HOME || '').trim()) {
  casa = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-casa-'));
  env.ORKASTERY_HOME = casa;
}
const r = spawnSync(comando, argumentos, { stdio: 'inherit', env });
if (casa) fs.rmSync(casa, { recursive: true, force: true });
if (r.error) {
  process.stderr.write(`casa-temporaria: ${r.error.message}\n`);
  process.exit(1);
}
process.exit(r.status ?? 1);
