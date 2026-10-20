/**
 * RM-061, fatia F2b: `ork retry plan` e `ork retry run` em ingles. O plano, a execucao e a politica por
 * motivo (porque e correcao) saem pelo catalogo; a razao e o detalhe que o processo monta vao ao ledger em
 * pt-BR e saem remontados no locale (G2); o detalhe lido do ledger (gravado pelo verify) sai como foi
 * gravado. Motivo, acao e bloqueio saem iguais nas duas linguas (G4): o condutor procura `auth-missing` e
 * `quota-exhausted` na saida. Os nomes comecam por "locale en F2b retry:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { comVerify, dadoDoLedger } from './locale-f2b-apoio';
import { comLocale, msg } from '../src/locale';
import { POLITICA_DE_RETRY, tabelaDaPolitica } from '../src/retry';

/** O detalhe do gate foi gravado pelo verify (dado do ledger, pt-BR) e a claim e de quem a registrou. */
const DADOS = ['C1: comando "false" saiu com codigo 1', 'reprova sempre'];
/** O mesmo dado como o detector o ve (ele tira o que esta entre aspas antes de descontar os dados). */
const DADOS_DO_DETECTOR = ['C1: comando', 'saiu com codigo 1', 'reprova sempre'];

function preparar(c: Cenario): void {
  comVerify(c);
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Falha', '--modo', 'auto', '--sem-worktree').status, 0);
  assert.equal(ork(c, PT, false, 'claims', 'add', 'loc-falha', 'README.md', '--claim', DADOS[1], '--verificar', 'false').status, 0);
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Limpa', '--modo', 'auto', '--sem-worktree').status, 0);
  fs.writeFileSync(path.join(c.dir, 'passa.txt'), 'sim\n');
  ork(c, PT, false, 'verify', 'loc-falha', '--so-claims');
}

test('locale en F2b retry: retry plan e retry run saem em ingles, com motivo e acao iguais', () => {
  const c = cenario('retry-en');
  try {
    preparar(c);
    const uso = ork(c, EN, false, 'retry', 'plan');
    assert.equal(uso.status, 2);
    assert.equal(uso.stderr, 'usage: ork retry plan <thread-id> [--motivo M] [--fase F]\n');

    const limpa = ork(c, EN, false, 'retry', 'plan', 'loc-limpa');
    assert.equal(limpa.status, 0, limpa.stderr);
    assert.equal(limpa.stdout, 'Retry plan for thread loc-limpa\n  mode            auto\n  phase           GOAL\n' +
      '  typed reason    (no pending failure)\n  detail          no failed gate in the ledger of this thread\n  action          sem-retry\n' +
      '  attempts        0 of 3 before escalation\n  effort          high\n  automatic       no\n  blocked by      gate.sem-reprovacao\n' +
      '  reason          nothing to repeat: the thread ledger has no pending typed failure\n');

    const plano = ork(c, EN, false, 'retry', 'plan', 'loc-falha');
    assert.equal(plano.status, 0, plano.stderr);
    assert.ok(plano.stdout.includes('  typed reason    claims.failed\n  detail          C1: comando "false" saiu com codigo 1\n' +
      '  action          corrigir-dirigido\n'), plano.stdout);
    assert.ok(plano.stdout.includes(`  reason          ${POLITICA_DE_RETRY['claims.failed'].porque === msg('pt-BR').retry.politica['claims.failed'].porque
      ? msg('en').retry.politica['claims.failed'].porque : '?'}\n`), plano.stdout);

    // C5 da F2b: o motivo tipado sai igual, e o grep do condutor casa nas duas linguas.
    const cota = ork(c, EN, false, 'retry', 'run', 'loc-limpa', '--motivo', 'runtime.quota-exhausted', '--fase', 'GO');
    assert.match(cota.stdout, /auth-missing|quota-exhausted/);
    assert.match(ork(c, PT, false, 'retry', 'run', 'loc-limpa', '--motivo', 'runtime.quota-exhausted', '--fase', 'GO').stdout, /auth-missing|quota-exhausted/);
    assert.ok(cota.stdout.includes('\nRun: nothing run\n  no dispatch with a written prompt for runtime.quota-exhausted in GO: ' +
      'run the phase again with `ork phase run`\n'), cota.stdout);

    const run = ork(c, EN, false, 'retry', 'run', 'loc-falha', '--dry-run');
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes('\nRun: action taken\n  1 fix(es) in round 1\n\nGO-FIX round 1: FX1 (type B, claims.failed)\n'), run.stdout);
    const sem = ork(c, EN, false, 'retry', 'run', 'loc-limpa');
    assert.equal(sem.status, 1);
    assert.ok(sem.stdout.endsWith('\nRun: nothing run\n  nothing to repeat: the thread ledger has no pending typed failure\n'), sem.stdout);

    const textos = [limpa.stdout, plano.stdout, cota.stdout, run.stdout, sem.stdout].join('\n');
    assert.deepEqual(linhasEmPortugues(textos, DADOS_DO_DETECTOR), []);
    // Controle do detector: o mesmo plano em pt-BR e acusado.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'retry', 'plan', 'loc-limpa').stdout, DADOS_DO_DETECTOR).length >= 4, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2b retry: a politica tem ingles para os 26 motivos, e o --json do plano e o ledger nao mudam', () => {
  const en = msg('en').retry.politica, pt = msg('pt-BR').retry.politica;
  assert.deepEqual(Object.keys(en), Object.keys(POLITICA_DE_RETRY));
  for (const [motivo, p] of Object.entries(POLITICA_DE_RETRY)) {
    assert.equal(p.porque, pt[motivo as keyof typeof pt].porque, motivo);
    assert.equal(p.correcao, pt[motivo as keyof typeof pt].correcao, motivo);
    assert.notEqual(en[motivo as keyof typeof en].porque, p.porque, motivo);
  }
  const a = cenario('retry-dado-pt'), b = cenario('retry-dado-en');
  try {
    preparar(a); preparar(b);
    for (const args of [['retry', 'plan', 'loc-falha', '--json'], ['retry', 'plan', 'loc-limpa', '--json']]) {
      const pt = ork(a, PT, false, ...args), en2 = ork(a, EN, false, ...args);
      assert.equal(en2.stdout, pt.stdout, args.join(' '));
    }
    ork(a, PT, false, 'retry', 'run', 'loc-falha');
    ork(b, EN, false, 'retry', 'run', 'loc-falha');
    ork(a, PT, false, 'retry', 'run', 'loc-limpa');
    ork(b, EN, false, 'retry', 'run', 'loc-limpa');
    const tipos = ['retry_planned', 'retry_attempt', 'retry_escalated', 'gate_blocked', 'go_fix_opened'];
    const dado = (c: Cenario) => JSON.stringify([...dadoDoLedger(c, 'loc-falha', tipos), ...dadoDoLedger(c, 'loc-limpa', tipos)])
      .split(c.dir).join('<dir>');
    const dadoPt = dado(a);
    assert.ok(dadoPt.includes('nao ha o que repetir'), 'a razao gravada e pt-BR');
    assert.deepEqual(JSON.parse(dado(b)), JSON.parse(dadoPt));
  } finally { a.limpar(); b.limpar(); }
});

test('locale en F3d retry complementar: policy, parse, list, resume e cancel tem catalogo bilingue', () => {
  const pt = msg('pt-BR').retry.complementar;
  const en = msg('en').retry.complementar;
  assert.notEqual(en.usoParse, pt.usoParse);
  assert.notEqual(en.usoCancel, pt.usoCancel);
  assert.notEqual(en.filaVazia, pt.filaVazia);
  assert.notEqual(en.retomadaVazia, pt.retomadaVazia);
  assert.notEqual(en.desconhecido('x'), pt.desconhecido('x'));

  const politicaPt = comLocale('pt-BR', () => tabelaDaPolitica());
  const politicaEn = comLocale('en', () => tabelaDaPolitica());
  assert.match(politicaPt, /^POLITICA DE RETRY/m);
  assert.match(politicaEn, /^RETRY POLICY/m);
  assert.match(politicaEn, /reason.*action.*automatic.*fix/m);
  assert.doesNotMatch(politicaEn, /motivo|acao|automatica|correcao/i);
});
