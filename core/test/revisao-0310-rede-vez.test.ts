/**
 * Revisao das entregas da madrugada de 03/10 (thread ork-revisaodasen): o teto de 14 min da RM-053
 * (D9) lia e gravava a marca da tentativa sem trava. Varios processos na mesma batida (um cron de
 * pulse por projeto, mais os eventos de thread) liam a marca velha e todos tomavam a vez.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';

const MODULO = path.resolve(__dirname, '../src/rede-adesao.js');
const PROCESSOS = 12;

function rodada(dir: string): Promise<string> {
  const largada = Date.now() + 1500;
  const codigo = `const { tomarVezDePublicar } = require(${JSON.stringify(MODULO)});` +
    `while (Date.now() < ${largada}) {} process.stdout.write(tomarVezDePublicar() ? 'T' : 'F');`;
  return Promise.all(Array.from({ length: PROCESSOS }, () => new Promise<string>((resolve, reject) => {
    const filho = spawn(process.execPath, ['-e', codigo], { env: { ...process.env, ORK_USUARIO_DIR: dir } });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += String(d); });
    filho.on('error', reject);
    filho.on('close', () => resolve(saida));
  }))).then((s) => s.join(''));
}

test('revisao 03/10: na mesma batida, um so processo toma a vez de publicar na rede', async () => {
  for (let i = 0; i < 3; i++) {
    const dir = dirTemporario('rev0310-rede-vez');
    try {
      const vezes = await rodada(dir);
      assert.equal(vezes.length, PROCESSOS, `todo processo respondeu: ${vezes}`);
      assert.equal([...vezes].filter((c) => c === 'T').length, 1, `mais de um processo tomou a vez: ${vezes}`);
      assert.ok(!fs.existsSync(path.join(dir, 'rede', 'tentativa.lock')), 'a trava e solta depois da vez');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

/**
 * Instavel no CI (03/10, push da RM-031 e da RM-008: `FFFTFFFFFTFF`). A hora era o parametro padrao,
 * lida ANTES da trava: o processo que perdia a CPU entre ler a hora e pegar a trava achava a marca do
 * vencedor "no futuro", tratava como relogio que voltou e tomava a vez tambem. A injecao abaixo poe a
 * vez inteira de outro processo exatamente nesse intervalo, sem depender da sorte do escalonador.
 */
test('vez de publicar: quem perde a CPU entre ler a hora e pegar a trava nao toma a vez do vencedor', () => {
  const dir = dirTemporario('vez-preempcao');
  try {
    const outro = `process.stdout.write(require(${JSON.stringify(MODULO)}).tomarVezDePublicar() ? 'T' : 'F');`;
    const codigo = `const fs = require('node:fs'), cp = require('node:child_process'); const mkdir = fs.mkdirSync; let antes = '';` +
      `fs.mkdirSync = function (alvo, ...resto) {` +
      `  if (!antes && String(alvo).endsWith('tentativa.lock')) antes = cp.spawnSync(process.execPath, ['-e', ${JSON.stringify(outro)}], { env: process.env, encoding: 'utf8' }).stdout || '?';` +
      `  return mkdir.call(this, alvo, ...resto); };` +
      `const eu = require(${JSON.stringify(MODULO)}).tomarVezDePublicar() ? 'T' : 'F'; process.stdout.write(antes + eu);`;
    const r = spawnSync(process.execPath, ['-e', codigo], { env: { ...process.env, ORK_USUARIO_DIR: dir }, encoding: 'utf8' });
    assert.equal(r.stdout, 'TF', `o outro processo vence e este, que leu a hora antes dele, perde a vez: ${r.stdout} ${r.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** Sob carga, opt-in: `ORK_VEZ_CARGA=N` roda N rodadas com todos os nucleos ocupados (a prova da correcao). */
test('vez de publicar: N rodadas sob carga, sempre um vencedor', { skip: !process.env.ORK_VEZ_CARGA && 'opt-in: ORK_VEZ_CARGA=N' }, async () => {
  const n = Number(process.env.ORK_VEZ_CARGA);
  const carga = Array.from({ length: os.cpus().length }, () => spawn(process.execPath, ['-e', 'for(;;){}']));
  try {
    const ruins: string[] = [];
    for (let i = 0; i < n; i++) {
      const dir = dirTemporario('vez-carga');
      try {
        const vezes = await rodada(dir);
        if (vezes.length !== PROCESSOS || [...vezes].filter((c) => c === 'T').length !== 1) ruins.push(vezes);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    }
    assert.deepEqual(ruins, [], `rodadas com mais de um vencedor em ${n}`);
  } finally { for (const p of carga) p.kill('SIGKILL'); }
});
