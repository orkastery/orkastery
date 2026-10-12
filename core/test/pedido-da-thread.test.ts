/**
 * RM-059 (T6.0): o pedido do builder guardado na criacao da thread (`ork thread new --pedido`) e usado
 * pelo `ork prompt render` quando falta `--pedido`. A thread criada sem pedido continua como antes, com
 * o texto de exemplo, e o pedido editado fora do nucleo nunca vira prompt.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { lerLedger } from '../src/ledger';
import { ARQUIVO_DO_PEDIDO, dirThread, lerThread, novaThread, pedidoDaThread, prepararPedido, TETO_DO_PEDIDO } from '../src/thread';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PEDIDO = '  Implementar a fatia X do plano dos mods.\n\nCriterio: o teste Y passa, sem tocar em Z. #Auto\n';
const TEXTO = PEDIDO.trim();
const SHA = createHash('sha256').update(TEXTO).digest('hex');

function ork(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
}

test('S1 a thread criada com pedido guarda o texto em pedido.md, e o sha256 no thread.json e no thread_created', () => {
  const p = projetoTemporario('pedido-guarda');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'com pedido', modo: 'auto', pedido: PEDIDO });
    assert.deepEqual(thread.pedido, { arquivo: 'pedido.md', sha256: SHA, bytes: Buffer.byteLength(TEXTO) });
    assert.deepEqual(lerThread(p.dir, thread.id).pedido, thread.pedido);
    const arquivo = path.join(dirThread(p.dir, thread.id), ARQUIVO_DO_PEDIDO);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), TEXTO);
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600, 'so o dono le, como o thread.json');
    const criada = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'thread_created') as Record<string, unknown> | undefined;
    assert.deepEqual(criada?.pedido, thread.pedido);
    assert.deepEqual(pedidoDaThread(p.dir, lerThread(p.dir, thread.id)), { texto: TEXTO, sha256: SHA });
  } finally { p.limpar(); }
});

test('S2 sem pedido nada muda: nem campo, nem arquivo, nem campo no ledger', () => {
  const p = projetoTemporario('pedido-sem');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sem pedido', modo: 'auto' });
    assert.equal('pedido' in lerThread(p.dir, thread.id), false);
    assert.equal(fs.existsSync(path.join(dirThread(p.dir, thread.id), ARQUIVO_DO_PEDIDO)), false);
    const criada = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'thread_created') as Record<string, unknown> | undefined;
    assert.equal(criada && 'pedido' in criada, false);
    assert.equal(pedidoDaThread(p.dir, lerThread(p.dir, thread.id)), null);
  } finally { p.limpar(); }
});

test('S3 pedido vazio ou acima de 64 KiB recusa antes de gravar, e o ensaio nao grava nada', () => {
  const p = projetoTemporario('pedido-recusa');
  try {
    assert.throws(() => novaThread(p.carregado, { nome: 'vazio', modo: 'auto', pedido: ' \n\t ' }), /thread\.pedido\.invalido: o pedido esta vazio/);
    assert.throws(() => novaThread(p.carregado, { nome: 'grande', modo: 'auto', pedido: 'a'.repeat(TETO_DO_PEDIDO + 1) }),
      /thread\.pedido\.invalido: o pedido tem 65537 bytes, e o teto e 65536/);
    assert.equal(prepararPedido('a'.repeat(TETO_DO_PEDIDO)).meta.bytes, TETO_DO_PEDIDO);
    for (const id of ['ork-vazio', 'ork-grande']) assert.equal(fs.existsSync(dirThread(p.dir, id)), false, `${id} nao nasceu`);
    const ensaio = novaThread(p.carregado, { nome: 'ensaio', modo: 'auto', pedido: PEDIDO, dryRun: true });
    assert.equal(ensaio.gravada, false);
    assert.equal(ensaio.thread.pedido?.sha256, SHA);
    assert.equal(fs.existsSync(dirThread(p.dir, ensaio.thread.id)), false);
  } finally { p.limpar(); }
});

test('S4 o render sem --pedido usa o guardado e diz isso; --pedido vence; thread sem pedido segue com o exemplo', () => {
  const p = projetoTemporario('pedido-render');
  try {
    const com = novaThread(p.carregado, { nome: 'com pedido', modo: 'auto', pedido: PEDIDO }).thread;
    const sem = novaThread(p.carregado, { nome: 'sem pedido', modo: 'auto' }).thread;
    const guardado = ork(p.dir, 'prompt', 'render', com.id, 'GOAL');
    assert.equal(guardado.status, 0, guardado.stderr);
    assert.ok(guardado.stdout.includes(TEXTO), 'o prompt leva o pedido guardado');
    assert.ok(guardado.stdout.includes(`# pedido guardado na criacao da thread (sha256 ${SHA.slice(0, 8)})`));
    assert.equal(guardado.stdout.includes('<pedido do builder>'), false);
    const explicito = ork(p.dir, 'prompt', 'render', com.id, 'GOAL', '--pedido', 'outro pedido, dito agora');
    assert.equal(explicito.status, 0);
    assert.ok(explicito.stdout.includes('outro pedido, dito agora'));
    assert.equal(explicito.stdout.includes(TEXTO), false);
    assert.equal(explicito.stdout.includes('# pedido guardado'), false);
    const antiga = ork(p.dir, 'prompt', 'render', sem.id, 'GOAL');
    assert.equal(antiga.status, 0);
    assert.ok(antiga.stdout.includes('<pedido do builder>'));
    assert.equal(antiga.stdout.includes('# pedido guardado'), false);
  } finally { p.limpar(); }
});

test('S5 pedido editado fora do nucleo ou apagado vira erro tipado no render, e --pedido ainda resolve', () => {
  const p = projetoTemporario('pedido-adulterado');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'adulterado', modo: 'auto', pedido: PEDIDO });
    const arquivo = path.join(dirThread(p.dir, thread.id), ARQUIVO_DO_PEDIDO);
    fs.writeFileSync(arquivo, `${TEXTO}\nlinha acrescentada depois`);
    const editado = ork(p.dir, 'prompt', 'render', thread.id, 'GOAL');
    assert.equal(editado.status, 1);
    assert.match(editado.stderr, new RegExp(`thread\\.pedido\\.divergente: pedido\\.md da thread ${thread.id} nao bate com o sha256 gravado na criacao \\(${SHA.slice(0, 8)}\\)`));
    assert.equal(ork(p.dir, 'prompt', 'render', thread.id, 'GOAL', '--pedido', 'explicito').status, 0);
    fs.rmSync(arquivo);
    const apagado = ork(p.dir, 'prompt', 'render', thread.id, 'GOAL');
    assert.equal(apagado.status, 1);
    assert.match(apagado.stderr, /thread\.pedido\.ausente/);
    fs.symlinkSync(path.join(p.dir, 'README.md'), arquivo);
    assert.match(ork(p.dir, 'prompt', 'render', thread.id, 'GOAL').stderr, /thread\.pedido\.divergente: pedido\.md da thread .* nao abre como arquivo comum/);
  } finally { p.limpar(); }
});

test('S6 o CLI guarda o pedido no thread new e recusa --pedido sem texto', () => {
  const p = projetoTemporario('pedido-cli');
  try {
    const criada = ork(p.dir, 'thread', 'new', 'pelo cli', '--modo', 'auto', '--sem-worktree', '--pedido', PEDIDO);
    assert.equal(criada.status, 0, criada.stderr);
    assert.match(criada.stdout, /pedido: guardado em \.orkastery\/threads\/ork-pelocli\/pedido\.md \(sha256 [0-9a-f]{8}, \d+ bytes\)/);
    assert.equal(lerThread(p.dir, 'ork-pelocli').pedido?.sha256, SHA);
    assert.equal(ork(p.dir, 'thread', 'new', 'sem texto', '--modo', 'auto', '--pedido').status, 2);
  } finally { p.limpar(); }
});
