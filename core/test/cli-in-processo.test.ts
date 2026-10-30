/** RM-074 M1: paridade byte a byte do harness da CLI com o processo filho. */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { cliExigeProcessoFilho, cliNoProcesso } from './cli-in-processo';
import { VERSAO_DO_ORK } from '../src/versao';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const RAIZ = path.resolve(__dirname, '../../..');

function ambiente(casa: string, lang = 'C.UTF-8'): NodeJS.ProcessEnv {
  return { HOME: casa, ORKASTERY_HOME: path.join(casa, '.orkastery'), LANG: lang, TZ: 'America/Sao_Paulo',
    PATH: process.env.PATH ?? '/usr/bin:/bin', ORK_REDE_PUBLICAR: '0', ORK_FABRICA_PUBLICAR: '0' };
}

function filho(cwd: string, env: NodeJS.ProcessEnv, args: string[], entrada?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8',
    ...(entrada === undefined ? {} : { input: entrada }) });
  return r.error && (r.error as NodeJS.ErrnoException).code === 'EPERM'
    ? null : { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function paridade(cwd: string, env: NodeJS.ProcessEnv, args: string[], esperadoSemProcesso: ReturnType<typeof cliNoProcesso>, entrada?: string) {
  const interno = cliNoProcesso({ cwd, env, args, ...(entrada === undefined ? {} : { entrada }) });
  assert.deepEqual(interno, filho(cwd, env, args, entrada) ?? esperadoSemProcesso, args.join(' '));
}

test('CIP1: sucesso e erro de uso sao byte a byte iguais ao processo filho', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-cli-processo-'));
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-cli-processo-casa-'));
  try {
    const env = ambiente(casa);
    paridade(dir, env, ['version'], { status: 0, stdout: `${VERSAO_DO_ORK}\n`, stderr: '' });
    paridade(dir, env, ['modos', '--do-pedido', '#Auto'], { status: 0, stdout: 'auto\n', stderr: '' });
    paridade(dir, env, ['modos', '--do-pedido', '#Look'], { status: 2, stdout: '',
      stderr: 'modo.aposentado: #Look foi aposentado e nao abre trabalho novo. Use #Classic ou #Auto. ' +
        'Thread ja gravada em #Look continua abrindo normalmente.\n' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

test('CIP2: cwd, ambiente, argv, exitCode e descritores voltam ao valor anterior', () => {
  const antes = { cwd: process.cwd(), lang: process.env.LANG, argv: [...process.argv], exitCode: process.exitCode,
    stdout: process.stdout.write, stderr: process.stderr.write, exit: process.exit };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-cli-restaura-'));
  try {
    const r = cliNoProcesso({ cwd: dir, env: ambiente(dir, 'en_US.UTF-8'), args: ['help'] });
    assert.equal(r.status, 0);
    assert.equal(process.cwd(), antes.cwd);
    assert.equal(process.env.LANG, antes.lang);
    assert.deepEqual(process.argv, antes.argv);
    assert.equal(process.exitCode, antes.exitCode);
    assert.equal(process.stdout.write, antes.stdout);
    assert.equal(process.stderr.write, antes.stderr);
    assert.equal(process.exit, antes.exit);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CIP3: stdin e erro lancado preservam a moldura do executavel', () => {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-cli-stdin-casa-'));
  try {
    const env = ambiente(casa);
    const args = ['sessions', 'event', '--tipo', 'permission_request', '--sessao', 'synthetic'];
    const entrada = '{nao e json}\n';
    assert.deepEqual(cliNoProcesso({ cwd: RAIZ, env, args, entrada }), { status: 1, stdout: '',
      stderr: "evento recusado: Expected property name or '}' in JSON at position 1 (line 1 column 2)\n" });
  } finally {
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

test('CIP4: mcp install com --project relativo e absoluto permanece no processo filho', () => {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-cli-mcp-casa-'));
  try {
    const env = ambiente(casa);
    const relativo = ['mcp', 'install', '--project', 'loja', '--host', 'claude-code'];
    const absoluto = ['mcp', 'install', '--project', RAIZ, '--host', 'claude-code', '--dry-run'];
    for (const args of [relativo, absoluto]) {
      assert.equal(cliExigeProcessoFilho(args), true);
      assert.throws(() => cliNoProcesso({ cwd: RAIZ, env, args }),
        /cli\.in-processo\.assincrona: mcp install exige processo filho/);
    }
    assert.equal(process.cwd(), RAIZ);
  } finally {
    fs.rmSync(casa, { recursive: true, force: true });
  }
});
