/**
 * RM-061, fatia F2b: `ork ship` e `ork ship registrar-pr` em ingles. A moldura, o bloqueio, os passos do
 * ensaio e a prova do push saem pelo catalogo; a razao da autorizacao, o detalhe e a correcao do bloqueio e
 * o motivo do `registrar-pr` vao ao ledger ou ao `--json` em pt-BR e saem remontados no locale (G2). Os
 * nomes comecam por "locale en F2b ship:" para cada claim rodar so o seu. O pt-BR fica com o snapshot.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { comVerify, dadoDoLedger } from './locale-f2b-apoio';
import { exec } from '../src/util';

/** Prepara a thread `loc-entrega` (claim que passa) e a `loc-pausa` (#Classic), com a branch `feature` a frente. */
function preparar(c: Cenario): void {
  comVerify(c);
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Entrega', '--modo', 'auto', '--sem-worktree').status, 0);
  assert.equal(ork(c, PT, false, 'claims', 'add', 'loc-entrega', 'README.md', '--claim', 'o readme existe', '--verificar', 'test -f README.md').status, 0);
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Pausa', '--modo', 'classic', '--sem-worktree').status, 0);
  fs.writeFileSync(path.join(c.dir, 'passa.txt'), 'sim\n');
  exec('git', ['add', '--', 'orkastery.yaml'], c.dir);
  exec('git', ['commit', '-q', '-m', 'verify'], c.dir);
  exec('git', ['checkout', '-q', '-b', 'feature'], c.dir);
  fs.writeFileSync(path.join(c.dir, 'NOVO.md'), 'novo\n');
  exec('git', ['add', '--', 'NOVO.md'], c.dir);
  exec('git', ['commit', '-q', '-m', 'novo'], c.dir);
  exec('git', ['checkout', '-q', 'main'], c.dir);
}

test('locale en F2b ship: ensaio, bloqueio e entrega saem em ingles', () => {
  const c = cenario('ship-en');
  try {
    preparar(c);
    const uso = ork(c, EN, false, 'ship');
    assert.equal(uso.status, 2);
    assert.equal(uso.stderr, 'usage: ork ship <thread-id> --para <branch> [--de <branch>] [--dry-run]\n');

    const ensaio = ork(c, EN, false, 'ship', 'loc-entrega', '--para', 'main', '--de', 'feature', '--dry-run');
    assert.equal(ensaio.status, 0, ensaio.stderr);
    const e = ensaio.stdout.split('\n');
    assert.equal(e[0], 'ork ship (--dry-run, nothing was run): thread loc-entrega');
    assert.match(e[1], /^ {2}from {10}feature @ [0-9a-f]{8}$/);
    assert.match(e[2], /^ {2}to {12}main @ [0-9a-f]{8}$/);
    assert.equal(e[3], "  authorization AUTHORIZED by #TAG #Auto in the builder's request (by mode)");
    assert.equal(e[4], '                mode #Auto ships inside a block with no pause: the #TAG is the prior authorization');
    assert.match(e[5], /^ {2}verification {2}passed at HEAD [0-9a-f]{8} \(1\/1 claims, 2\/2 commands\)$/);
    assert.equal(e[6], '  ci            not required');
    assert.equal(e[7], '  lease         main-tree free');
    assert.equal(e[9], 'Steps the real ship would run, in this order:');
    assert.equal(e[10], `  merge tree: ${c.dir} (the tree with main checked out; clean)`);
    assert.equal(e[11], '  git merge --no-ff feature -m "<ship message>"');
    assert.equal(e[12], '  no push: remote "origin" not configured: local merge done, no push to prove');

    const pausa = ork(c, EN, false, 'ship', 'loc-pausa', '--para', 'main');
    assert.equal(pausa.status, 1);
    assert.ok(pausa.stdout.includes('  authorization WAITING FOR HUMAN AUTHORIZATION\n                mode #Classic pauses at the push and ' +
      'no human authorization is recorded yet. Authorize it at delivery: `ork ship loc-pausa --para <branch> --autorizar-push <who>`\n'), pausa.stdout);
    assert.ok(pausa.stdout.includes('\nBLOCKED. Typed reason: human.pending\n  detail    mode #Classic pauses at the push'), pausa.stdout);
    assert.ok(pausa.stdout.endsWith('  fix       ork ship loc-pausa --para <branch> --autorizar-push <who>\n'), pausa.stdout);

    const destino = ork(c, EN, false, 'ship', 'loc-entrega', '--para', 'missing-branch', '--de', 'feature');
    assert.equal(destino.status, 1);
    assert.ok(destino.stdout.endsWith('\nBLOCKED. Typed reason: artifact.missing\n  detail    target branch "missing-branch" does not exist in this repository\n' +
      '  fix       create the target branch or pass another one with `--para`\n'), destino.stdout);

    const entrega = ork(c, EN, false, 'ship', 'loc-entrega', '--para', 'main', '--de', 'feature');
    assert.equal(entrega.status, 0, entrega.stderr);
    assert.match(entrega.stdout, /\n {2}lease {9}main-tree taken by loc-entrega and released at the end\n\n`--no-ff` merge done: [0-9a-f]{40}\n/);
    assert.ok(entrega.stdout.includes('\nPush not proven: remote "origin" not configured: local merge done, no push to prove\n\nEvidence (commands run):\n'),
      entrega.stdout);
    assert.ok(entrega.stdout.endsWith('\nLedger: `ork phase list loc-entrega`  (ship_done event)\n'), entrega.stdout);
    const incorporada = ork(c, EN, false, 'ship', 'loc-entrega', '--para', 'main', '--de', 'feature');
    assert.match(incorporada.stdout, /\nNothing to merge: feature was already in main, brought in by [0-9a-f]{40}\.\n/);

    const textos = [ensaio.stdout, pausa.stdout, destino.stdout, entrega.stdout, incorporada.stdout].join('\n');
    assert.deepEqual(linhasEmPortugues(textos, [c.dir, 'o readme existe']), []);
    // Controle do detector: o mesmo bloqueio em pt-BR e acusado.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'ship', 'loc-pausa', '--para', 'main').stdout, [c.dir]).length >= 3, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2b ship: registrar-pr em ingles, com o --json igual nas duas linguas', () => {
  const c = cenario('ship-pr');
  const remoto = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-loc-remoto-'));
  try {
    preparar(c);
    // Com o remoto legivel, a ausencia de merge segue "nenhum merge"; sem remoto o fetch falha e a recusa e sem-leitura.
    exec('git', ['init', '-q', '--bare', '-b', 'main', remoto], c.dir);
    exec('git', ['remote', 'add', 'origin', remoto], c.dir);
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], c.dir).ok, true);
    const uso = ork(c, EN, false, 'ship', 'registrar-pr');
    assert.equal(uso.status, 2);
    assert.equal(uso.stderr, 'usage: ork ship registrar-pr <thread-id> [--repo <owner/name> --pr <n>] | --todas [--remoto R] [--json] [--dry-run]\n');
    const ensaio = ork(c, EN, false, 'ship', 'registrar-pr', 'loc-entrega', '--dry-run');
    assert.equal(ensaio.status, 0, ensaio.stderr);
    assert.equal(ensaio.stdout, 'Dry run (--dry-run): nothing was written.\n  loc-entrega          no merge      no ship(loc-entrega) merge on origin/main\n');
    const externo = ork(c, EN, false, 'ship', 'registrar-pr', 'loc-entrega', '--repo', 'dono/externo', '--pr', '7', '--dry-run');
    assert.equal(externo.status, 1);
    assert.ok(externo.stdout.endsWith('  loc-entrega          refused       repository dono/externo is not declared in `ci.external_repositories` of `orkastery.yaml`\n'),
      externo.stdout);
    const todas = ork(c, EN, false, 'ship', 'registrar-pr', '--todas', '--dry-run');
    assert.equal(todas.stdout, 'Dry run (--dry-run): nothing was written.\nNo open thread with a ship(<thread>) merge on the base.\n');
    // O --json e contrato: igual nas duas linguas, com o motivo em pt-BR.
    for (const args of [['ship', 'registrar-pr', 'loc-entrega', '--dry-run', '--json'], ['ship', 'registrar-pr', '--todas', '--dry-run', '--json']]) {
      const pt = ork(c, PT, false, ...args), en = ork(c, EN, false, ...args);
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.equal(en.status, pt.status, args.join(' '));
    }
    assert.match(ork(c, EN, false, 'ship', 'registrar-pr', 'loc-entrega', '--dry-run', '--json').stdout, /"motivo": "nenhum merge ship\(loc-entrega\) em origin\/main"/);
  } finally { c.limpar(); fs.rmSync(remoto, { recursive: true, force: true }); }
});

test('locale en F2b ship: o que o ship grava nao muda com a lingua', () => {
  const pt = cenario('ship-dado-pt'), en = cenario('ship-dado-en');
  try {
    const gravado = (c: Cenario, locale: Record<string, string>) => {
      preparar(c);
      ork(c, locale, false, 'ship', 'loc-pausa', '--para', 'main');
      ork(c, locale, false, 'ship', 'loc-entrega', '--para', 'missing-branch', '--de', 'feature');
      ork(c, locale, false, 'ship', 'loc-entrega', '--para', 'main', '--de', 'feature', '--dry-run');
      ork(c, locale, false, 'ship', 'loc-entrega', '--para', 'main', '--de', 'feature');
      const tipos = ['ship_blocked', 'gate_blocked', 'ship_started', 'ship_done', 'gate_passed'];
      return JSON.stringify([...dadoDoLedger(c, 'loc-pausa', tipos), ...dadoDoLedger(c, 'loc-entrega', tipos)]).split(c.dir).join('<dir>');
    };
    const dadoPt = gravado(pt, PT), dadoEn = gravado(en, EN);
    assert.ok(dadoPt.includes('ainda nao ha autorizacao humana registrada'), 'a razao gravada e pt-BR');
    assert.ok(dadoPt.includes('branch de destino \\"missing-branch\\" nao existe neste repositorio'), 'o detalhe gravado e pt-BR');
    assert.deepEqual(JSON.parse(dadoEn), JSON.parse(dadoPt));
  } finally { pt.limpar(); en.limpar(); }
});

test('locale en F2b ship: thread inexistente sai no locale do comando em ship, registrar-pr, master e retry', () => {
  const c = cenario('ship-inexistente');
  try {
    for (const args of [['ship', 'nada', '--para', 'main'], ['ship', 'registrar-pr', 'nada'], ['master', 'pedir', 'nada'],
      ['master', 'nada', '--aceitar-omissao'], ['retry', 'plan', 'nada']]) {
      const en = ork(c, EN, false, ...args), pt = ork(c, PT, false, ...args);
      assert.notEqual(en.status, 0, args.join(' '));
      assert.equal(en.status, pt.status, args.join(' '));
      assert.ok(en.stderr.includes('thread "nada" not found in '), `${args.join(' ')}\n${en.stderr}`);
      assert.ok(pt.stderr.includes('thread "nada" nao encontrada em '), `${args.join(' ')}\n${pt.stderr}`);
    }
  } finally { c.limpar(); }
});
