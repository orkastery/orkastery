/**
 * RM-059 (T0.9): o canario de eventos dos mods e o job `mods` do CI. Tudo roda sem o Claude Code: o
 * binario e um arquivo falso com os nomes, e o `claude` do `--com-plugin` e um falso que registra os
 * argumentos. O canario contra o binario de verdade roda no job do CI e na maquina local.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exigirCatalogo } from '../src/catalogo';

interface Canario {
  CONTRATO: string[];
  CONTROLE: string;
  nomesDoMod(dir: string): string[];
  procurar(arquivo: string, nomes: string[]): { achados: string[]; faltando: string[] };
  comoNoBinario(nome: string): string;
}

const RAIZ = exigirCatalogo(path.resolve(__dirname, '../../..'));
const SCRIPT = path.join(RAIZ, 'core', 'scripts', 'canario-eventos-mods.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const canario: Canario = require(SCRIPT);
const EXEMPLO = path.join(RAIZ, 'core', 'test', 'fixtures', 'mods', 'ork-exemplo');

function comDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-canario-mods-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Um "binario" com os nomes como o Claude Code os guarda (o classico sem prefixo), entre bytes nulos. */
function binarioFalso(dir: string, nomes: string[], antes = 0): string {
  const arquivo = path.join(dir, 'claude-falso.bin');
  const corpo = Buffer.from(nomes.map((n) => canario.comoNoBinario(n)).join('\u0000'), 'utf8');
  fs.writeFileSync(arquivo, Buffer.concat([Buffer.alloc(antes, 0x61), corpo]));
  return arquivo;
}

/** Um `claude` falso: diz a versao, registra cada chamada e reprova o comando de `CANARIO_FALHA`. */
function claudeFalso(dir: string): { comando: string; registro: string } {
  const registro = path.join(dir, 'chamadas.log');
  const comando = path.join(dir, 'claude');
  fs.writeFileSync(comando, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('2.1.296 (Claude Code)'); process.exit(0); }",
    `fs.appendFileSync(${JSON.stringify(registro)}, args.join(' ') + '\\n');`,
    "process.exit(process.env.CANARIO_FALHA && args[1] === process.env.CANARIO_FALHA ? 1 : 0);",
  ].join('\n') + '\n');
  fs.chmodSync(comando, 0o755);
  return { comando, registro };
}

function rodar(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, timeout: 120000 });
  return { codigo: r.status, saida: r.stdout, json: args.includes('--json') ? JSON.parse(r.stdout) : null };
}

test('S1 com todos os nomes do contrato no binario e o controle ausente, o canario aprova', () => {
  comDir((dir) => {
    const binario = binarioFalso(dir, canario.CONTRATO);
    const r = rodar(['--binario', binario, '--mods', path.join(dir, 'sem-mods'), '--json']);
    assert.equal(r.codigo, 0, r.saida);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.nomes.faltando, []);
    assert.equal(r.json.controle.achado, false);
    assert.equal(r.json.nomes.procurados.length, canario.CONTRATO.length);
  });
});

test('S2 o build que tira um evento ou uma chamada reprova e diz qual', () => {
  comDir((dir) => {
    const binario = binarioFalso(dir, canario.CONTRATO.filter((n) => n !== 'classic.PostToolBatch' && n !== 'mcp.call'));
    const r = rodar(['--binario', binario, '--mods', path.join(dir, 'sem-mods'), '--json']);
    assert.equal(r.codigo, 1);
    assert.deepEqual(r.json.nomes.faltando, ['classic.PostToolBatch', 'mcp.call']);
    const t = rodar(['--binario', binario, '--mods', path.join(dir, 'sem-mods')]);
    assert.match(t.saida, /FALTANDO {3}classic\.PostToolBatch, mcp\.call/);
    assert.match(t.saida, /resultado {2}REPROVADO/);
  });
});

test('S3 o controle achado reprova: o arquivo procurado nao e o binario', () => {
  comDir((dir) => {
    const binario = binarioFalso(dir, [...canario.CONTRATO, canario.CONTROLE]);
    const r = rodar(['--binario', binario, '--mods', path.join(dir, 'sem-mods'), '--json']);
    assert.equal(r.codigo, 1);
    assert.equal(r.json.controle.achado, true);
    assert.equal(rodar(['--binario', SCRIPT, '--mods', path.join(dir, 'sem-mods'), '--json']).json.controle.achado, true,
      'o proprio script tem o nome de controle');
  });
});

test('S4 o nome que cruza a fronteira do bloco de 16 MiB e achado', () => {
  comDir((dir) => {
    const binario = binarioFalso(dir, ['mcp.call'], 16 * 1024 * 1024 - 3);
    assert.deepEqual(canario.procurar(binario, ['mcp.call', 'process.run']), { achados: ['mcp.call'], faltando: ['process.run'] });
  });
});

test('S5 os nomes de um mod saem do fonte do modulo, fora dos testes', () => {
  assert.deepEqual(canario.nomesDoMod(EXEMPLO), ['classic.SessionStart', 'ui.status']);
  comDir((dir) => {
    const mod = path.join(dir, 'ork-x');
    fs.cpSync(EXEMPLO, mod, { recursive: true });
    fs.writeFileSync(path.join(mod, 'hooks', 'extra.ts'),
      "export const f = (on: any) => { on(\"turn.complete\", async ($: any) => { await $.mcp.call('orkastery', 'ork_maestro', {}) }); on('telemetry.*', () => 1) }\n");
    assert.deepEqual(canario.nomesDoMod(mod), ['classic.SessionStart', 'mcp.call', 'turn.complete', 'ui.status']);
  });
});

test('S6 --com-plugin roda validate --strict e test em cada mod, e o test reprovado reprova o canario', () => {
  comDir((dir) => {
    const mods = path.join(dir, 'mods');
    for (const nome of ['ork-a', 'ork-b']) fs.cpSync(EXEMPLO, path.join(mods, nome), { recursive: true });
    fs.mkdirSync(path.join(mods, 'sem-declaracao'));
    const binario = binarioFalso(dir, canario.CONTRATO);
    const falso = claudeFalso(dir);
    const ok = rodar(['--com-plugin', '--claude', falso.comando, '--binario', binario, '--mods', mods, '--json']);
    assert.equal(ok.codigo, 0, ok.saida);
    assert.deepEqual(ok.json.mods, ['ork-a', 'ork-b']);
    assert.equal(ok.json.claude.versao, '2.1.296 (Claude Code)');
    assert.deepEqual(fs.readFileSync(falso.registro, 'utf8').trim().split('\n'), [
      `plugin validate --strict ${path.join(mods, 'ork-a')}`, `plugin test ${path.join(mods, 'ork-a')}`,
      `plugin validate --strict ${path.join(mods, 'ork-b')}`, `plugin test ${path.join(mods, 'ork-b')}`,
    ]);
    const reprovado = rodar(['--com-plugin', '--claude', falso.comando, '--binario', binario, '--mods', mods, '--json'],
      { ...process.env, CANARIO_FALHA: 'test' });
    assert.equal(reprovado.codigo, 1);
    assert.deepEqual(reprovado.json.plugin.filter((p: { ok: boolean }) => !p.ok).map((p: { mod: string }) => p.mod), ['ork-a', 'ork-b']);
  });
});

test('S7 sem claude no PATH e sem --binario, sai 2 dizendo o que falta; o invólucro do npm tambem sai 2', () => {
  comDir((dir) => {
    const semClaude = rodar(['--json'], { ...process.env, PATH: path.join(dir, 'vazio') });
    assert.equal(semClaude.codigo, 2);
    assert.match(semClaude.json.erro, /claude fora do PATH/);
    const falso = claudeFalso(dir);
    const involucro = rodar(['--json', '--mods', path.join(dir, 'sem-mods')], { ...process.env, PATH: dir });
    assert.equal(involucro.codigo, 2);
    assert.ok(involucro.json.erro.startsWith(`o claude achado (${falso.comando}, `), involucro.json.erro);
    assert.match(involucro.json.erro, /bytes\) e o invólucro, sem o binario nativo/);
  });
});

test('S8 o job mods do CI instala o Claude Code fixado, sem credencial, e roda o canario com --com-plugin', () => {
  const ci = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  mods:\n'));
  assert.ok(ci.includes('\n  mods:\n'), 'job mods no ci.yml');
  assert.match(job, /npm install --global --no-audit --no-fund @anthropic-ai\/claude-code@\d+\.\d+\.\d+\n/);
  assert.match(job, /run: node core\/scripts\/canario-eventos-mods\.cjs --com-plugin\n/);
  assert.match(job, /DISABLE_AUTOUPDATER: '1'/);
  assert.match(job, /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'/);
  assert.match(job, /persist-credentials: false/);
  assert.doesNotMatch(job, /ANTHROPIC_API_KEY|secrets\./);
});
