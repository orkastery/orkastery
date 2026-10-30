/**
 * RM-061, fatia F2b: `ork master` (o indice das entregas), `ork master [<thread>] --aceitar-omissao` e
 * `ork master pedir` em ingles. O MASTER log, o POSTMORTEM e o pedido de nota nascem em pt-BR e ficam iguais
 * nas duas linguas; o erro da entrega que o MASTER exige volta no locale do comando. Os nomes comecam por
 * "locale en F2b master:" para cada claim rodar so o seu. O pt-BR byte a byte fica com o snapshot.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { dadoDoLedger } from './locale-f2b-apoio';

function entregar(c: Cenario, id: string): void {
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(c.dir, 'README.md'))).digest('hex');
  const r = ork(c, PT, false, 'thread', 'entrega', id, '--arquivo', 'README.md', '--sha256', sha256, '--por', 'teste');
  assert.equal(r.status, 0, r.stderr + r.stdout);
}

function preparar(c: Cenario): void {
  for (const nome of ['Primeira', 'Segunda', 'Aberta']) {
    assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--modo', 'auto', '--sem-worktree').status, 0);
  }
  entregar(c, 'loc-primeira');
  entregar(c, 'loc-segunda');
}

test('locale en F2b master: indice, aceite por omissao e pedido de nota saem em ingles', () => {
  const c = cenario('master-en');
  try {
    const vazio = ork(c, EN, false, 'master');
    assert.equal(vazio.stdout, 'No delivery waiting for a decision. To also see the ones that have not shipped yet: `ork master --todas`\n');
    preparar(c);
    const indice = ork(c, EN, false, 'master');
    assert.equal(indice.status, 0, indice.stderr);
    const l = indice.stdout.split('\n');
    assert.equal(l[0], 'Deliveries (2), with the index already derived from the ledger. Nobody typed the number.');
    assert.match(l[2], /^ {2}ID +SLUG +MODE +PHASE +STATUS +SHIPPED +INDEX +WHERE IT CAME FROM$/);
    assert.match(l[4], /^ {2}loc-primeira +loc-primeira-full +#Auto +GOAL +open +yes +5\/5 +no setbacks$/);
    assert.ok(indice.stdout.includes('\nSHIPPED AND ACCEPTED, unless you say otherwise.\n'), indice.stdout);
    assert.ok(indice.stdout.includes('\nFixed classes: '), indice.stdout);

    const ensaio = ork(c, { ...EN, CLAUDECODE: '1' }, false, 'master', '--aceitar-omissao', '--dry-run');
    assert.equal(ensaio.status, 0, ensaio.stderr);
    assert.equal(ensaio.stdout, 'Dry run (--dry-run): nothing was written.\nWould close by default: 2.\n' +
      '  loc-primeira         index 5/5\n  loc-segunda          index 5/5\n');
    assert.equal(ensaio.stderr, '\nwarning: master.omissao-sem-thread: an agent process (claude-code) would close 2 threads, ' +
      'including those of other parallel workstreams.\n  To close only yours: ork master <thread-id> --aceitar-omissao\n');

    const pedirSem = ork(c, EN, false, 'master', 'pedir', 'loc-aberta');
    assert.equal(pedirSem.status, 1);
    assert.equal(pedirSem.stderr, 'error: MASTER needs a delivery: ship_done or an existing artifact with a verified hash\n');
    assert.equal(ork(c, EN, false, 'master', 'pedir').stderr, 'error: usage: ork master pedir <thread> [--formato telegram|terminal|json]\n');
    const terminal = ork(c, EN, false, 'master', 'pedir', 'loc-segunda', '--formato', 'terminal');
    assert.equal(terminal.status, 0, terminal.stderr);
    assert.match(terminal.stdout, /^Score for delivery loc-segunda \(Segunda\)\n- With no score, the default acceptance stands, with the index derived from the ledger next to it\.\nReply: ([A-Z0-9]{4}) <0 to 5> <why>, for example: \1 4 delivered what I asked for\.\n$/);
    const telegram = ork(c, EN, false, 'master', 'pedir', 'loc-segunda');
    assert.match(telegram.stdout, /^🧾 Score for delivery loc-segunda \(Segunda\)\n• With no score/);

    const fora = ork(c, EN, false, 'master', 'loc-aberta', '--aceitar-omissao');
    assert.equal(fora.status, 1);
    assert.equal(fora.stderr, 'thread loc-aberta has not shipped yet (no ship_done in the ledger); record the delivery first: ork ship registrar-pr loc-aberta\n');
    const aceite = ork(c, EN, false, 'master', 'loc-primeira', '--aceitar-omissao');
    assert.equal(aceite.stdout, 'Accepted by default: 1. The index and its inputs went to the ledger.\n  loc-primeira         index 5/5\n\n' +
      'Disagree? A human score overrides it, and the record of the default acceptance stays.\n');
    assert.equal(ork(c, EN, false, 'master', 'loc-primeira', '--aceitar-omissao').stdout,
      'thread loc-primeira already has a MASTER recorded; nothing to accept.\n');
    const comAceitas = ork(c, EN, false, 'master');
    assert.ok(comAceitas.stdout.includes('\nAccepted by default (1): what went through without you looking.\n'), comAceitas.stdout);
    assert.match(comAceitas.stdout, /\n {2}ID +INDEX +RECORDED SCORE +ACCEPTED AT\n/);
    assert.match(comAceitas.stdout, /\nTimes in America\/New_York, E[SD]T\.\n/);

    const textos = [indice.stdout, ensaio.stdout, ensaio.stderr, terminal.stdout, telegram.stdout, fora.stderr, aceite.stdout, comAceitas.stdout].join('\n');
    assert.deepEqual(linhasEmPortugues(textos, ['(Segunda)']), []);
    // Controle do detector: o mesmo indice em pt-BR e acusado.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'master').stdout).length >= 3, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2b master: MASTER log, POSTMORTEM, aceite e pedido de nota gravados nao mudam com a lingua', () => {
  const a = cenario('master-dado-pt'), b = cenario('master-dado-en');
  try {
    const gravado = (c: Cenario, locale: Record<string, string>) => {
      preparar(c);
      assert.equal(ork(c, locale, false, 'master', 'loc-primeira', '--aceitar-omissao').status, 0);
      assert.equal(ork(c, locale, false, 'master', 'pedir', 'loc-segunda').status, 0);
      const dir = path.join(c.dir, '.orkastery', 'threads', 'loc-primeira');
      const arquivos = fs.readdirSync(dir).filter((f) => /MASTER|POSTMORTEM/.test(f)).sort()
        .map((f) => `${f}\n${fs.readFileSync(path.join(dir, f), 'utf8')}`).join('\n');
      // O aceite e o pedido de nota vao ao ledger; o codigo do pedido e sorteado.
      const ledger = JSON.stringify([dadoDoLedger(c, 'loc-primeira', ['aceite_por_omissao', 'master_done']),
        dadoDoLedger(c, 'loc-segunda', ['master_nota_pedida'])]).replace(/"codigo":"[A-Z0-9]+"/g, '"codigo":"<codigo>"');
      assert.ok(ledger.includes('master_nota_pedida') && ledger.includes('aceite_por_omissao'), ledger);
      return `${arquivos}\n${ledger}`.split(c.dir).join('<dir>').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>')
        .replace(/[0-9a-f]{64}/g, '<sha256>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>');
    };
    const pt = gravado(a, PT), en = gravado(b, EN);
    assert.ok(pt.includes('Aceita por omissao'), 'o registro e pt-BR');
    assert.equal(en, pt);
  } finally { a.limpar(); b.limpar(); }
});

test('locale en F2b master: os --json e a rota privada fora da lista seguem pt-BR com LANG en', () => {
  const c = cenario('master-fora');
  try {
    preparar(c);
    // A F3e completou as rotas de master no catálogo; `privado` segue fora e os contratos JSON nunca entram.
    for (const args of [['privado'], ['master', '--json'], ['master', '--aceitar-omissao', '--dry-run', '--json'],
      ['master', 'pedir', 'loc-segunda', '--formato', 'json']]) {
      const pt = ork(c, PT, false, ...args), en = ork(c, EN, false, ...args);
      const semId = (t: string) => t.replace(/"pedidoId": "[^"]+"/g, '').replace(/"criadoEm": "[^"]+"/g, '');
      assert.equal(semId(en.stdout), semId(pt.stdout), args.join(' '));
      assert.equal(en.stderr, pt.stderr, args.join(' '));
    }
  } finally { c.limpar(); }
});
