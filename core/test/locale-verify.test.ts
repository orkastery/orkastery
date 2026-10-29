/**
 * RM-061, fatia F2b: `ork verify` e `ork verify --baseline` em ingles. O relatorio, a classificacao e o
 * veredito saem pelo catalogo; o detalhe da claim reexecutada vai ao ledger em pt-BR e sai remontado no
 * locale (G2); o motivo tipado e o texto da claim (dado de quem a registrou) saem iguais. Os nomes comecam
 * por "locale en F2b verify:" para cada claim rodar so o seu. O pt-BR byte a byte fica com o snapshot.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { comVerify, dadoDoLedger } from './locale-f2b-apoio';
import { ativarLocale, ligarRemontagem, msg, remontar, textoDoCatalogo } from '../src/locale';

/** Os textos das claims sao dado (pt-BR de quem as registrou). */
const CLAIMS = ['o readme existe', 'reprova sempre', 'sem comando'];

function comClaims(c: ReturnType<typeof cenario>, id: string): void {
  comVerify(c);
  assert.equal(ork(c, PT, false, 'thread', 'new', 'Verificar', '--modo', 'auto', '--sem-worktree').status, 0);
  assert.equal(ork(c, PT, false, 'claims', 'add', id, 'README.md', '--claim', CLAIMS[0], '--verificar', 'test -f README.md').status, 0);
  assert.equal(ork(c, PT, false, 'claims', 'add', id, 'README.md', '--claim', CLAIMS[1], '--verificar', 'false').status, 0);
  assert.equal(ork(c, PT, false, 'claims', 'add', id, 'README.md', '--claim', CLAIMS[2]).status, 0);
}

test('locale en F2b verify: baseline, relatorio, classificacao e veredito saem em ingles', () => {
  const c = cenario('verify-en');
  const id = 'loc-verificar';
  try {
    comClaims(c, id);
    fs.writeFileSync(path.join(c.dir, 'passa.txt'), 'sim\n');
    const base = ork(c, EN, false, 'verify', id, '--baseline');
    assert.equal(base.status, 0, base.stderr);
    assert.equal(base.stdout.split('\n')[0], `Baseline recorded for thread ${id}.`);
    assert.match(base.stdout, /\n {2}test {7}passed {2}test -f passa\.txt\n/);
    fs.rmSync(path.join(c.dir, 'passa.txt'));
    const r = ork(c, EN, false, 'verify', id);
    assert.equal(r.status, 1, r.stderr);
    const l = r.stdout.split('\n');
    assert.equal(l[0], `ork verify for thread ${id}`);
    assert.match(l[1], /^ {2}real HEAD {3}[0-9a-f]{40}$/);
    assert.equal(l[2], `  directory   ${c.dir}`);
    // RM-072 (D1): todo CHECK diz o modo e a origem; o nome de produto e o mesmo nas duas linguas.
    assert.equal(l[3], '  check       Agile Check (default: the manifest does not declare check.mode)');
    assert.match(l[4], /^ {2}baseline {4}[0-9a-f]{8} from \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(America\/New_York, E[SD]T\)$/);
    assert.match(l[5], /^ {2}steal {7}(\S+% in the run \(\/proc\/stat; above 40%, a failing clock-bound test gets no verdict\)|not measured .*)$/);
    assert.ok(r.stdout.includes('\nClaims rerun on the real HEAD:\n  C1  verified: yes  o readme existe\n      file: README.md\n' +
      '      command(s): test -f README.md\n  C2  verified: NO  reprova sempre\n'), r.stdout);
    assert.ok(r.stdout.includes('      typed reason: claims.failed (command "false" exited with code 1)\n'), r.stdout);
    assert.ok(r.stdout.includes('  C3  verified: NO  sem comando\n      file: README.md\n      no verification command\n' +
      '      typed reason: claims.unverifiable (no verification command declared)\n'), r.stdout);
    assert.ok(r.stdout.includes('\nManifest verify commands:\n  build      ok  true\n  test       FAILED (exit 1)  test -f passa.txt\n'), r.stdout);
    assert.ok(r.stdout.includes('\nClassification: 1 regression(s), 0 pre-existing, 0 failure(s) without a baseline\n' +
      '  regression     test: test -f passa.txt\n'), r.stdout);
    assert.ok(r.stdout.endsWith('\nVerdict: FAILED. Typed reasons: claims.failed, claims.unverifiable, verify.regression\n'), r.stdout);
    assert.deepEqual(linhasEmPortugues(`${base.stdout}\n${r.stdout}`, [...CLAIMS, c.dir]), []);
    // Controle do detector: o mesmo relatorio em pt-BR e acusado.
    assert.ok(linhasEmPortugues(ork(c, PT, false, 'verify', id).stdout, [...CLAIMS, c.dir]).length >= 5, 'o detector acha o pt-BR');
    // Uso e verde, tambem em ingles.
    const uso = ork(c, EN, false, 'verify');
    assert.equal(uso.status, 2);
    assert.equal(uso.stderr, 'usage: ork verify <thread-id> [--baseline] [--so-claims] [--check classic|agile] [--canal C] [--esperar [min]]\n');
  } finally { c.limpar(); }
});

test('locale en F2b verify: owner.language en-US vence o LANG pt-BR, e o verde diz VERIFIED', () => {
  const c = cenario('verify-owner');
  try {
    comVerify(c);
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.equal(ork(c, PT, false, 'thread', 'new', 'Verde', '--modo', 'auto', '--sem-worktree').status, 0);
    fs.writeFileSync(path.join(c.dir, 'passa.txt'), 'sim\n');
    const base = ork(c, PT, false, 'verify', 'loc-verde', '--baseline');
    assert.equal(base.stdout.split('\n')[0], 'Baseline recorded for thread loc-verde.');
    const r = ork(c, PT, false, 'verify', 'loc-verde');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('\nClaims rerun on the real HEAD:\n  (no claim recorded in this thread)\n'), r.stdout);
    assert.ok(r.stdout.endsWith('\nVerdict: VERIFIED (no blocking reason).\n'), r.stdout);
  } finally { c.limpar(); }
});

test('locale en F2b verify: o ledger e a baseline gravados nao mudam com a lingua', () => {
  const pt = cenario('verify-dado-pt'), en = cenario('verify-dado-en');
  try {
    const gravado = (c: ReturnType<typeof cenario>, locale: Record<string, string>) => {
      comClaims(c, 'loc-verificar');
      fs.writeFileSync(path.join(c.dir, 'passa.txt'), 'sim\n');
      ork(c, locale, false, 'verify', 'loc-verificar', '--baseline');
      fs.rmSync(path.join(c.dir, 'passa.txt'));
      ork(c, locale, false, 'verify', 'loc-verificar');
      return dadoDoLedger(c, 'loc-verificar', ['baseline_recorded', 'verify_run', 'gate_blocked']);
    };
    const dadoPt = gravado(pt, PT), dadoEn = gravado(en, EN);
    assert.ok(JSON.stringify(dadoPt).includes('comando \\"false\\" saiu com codigo 1'), 'o detalhe gravado e pt-BR');
    assert.deepEqual(JSON.parse(JSON.stringify(dadoEn).split(en.dir).join('<dir>')), JSON.parse(JSON.stringify(dadoPt).split(pt.dir).join('<dir>')));
  } finally { pt.limpar(); en.limpar(); }
});

test('locale en F2b verify: os --json e a rota privada seguem pt-BR com LANG en', () => {
  const c = cenario('verify-fora');
  try {
    // Retry e master digest entraram no catálogo; os contratos --json e `privado` seguem fora.
    for (const args of [['retry', 'policy', '--json'], ['retry', 'list', '--json'], ['privado']]) {
      const pt = ork(c, PT, false, ...args), en = ork(c, EN, false, ...args);
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.equal(en.stderr, pt.stderr, args.join(' '));
      assert.equal(en.status, pt.status, args.join(' '));
    }
  } finally { c.limpar(); }
});

test('locale en F2b verify: a remontagem so guarda com o registro ligado e devolve o resto como veio', () => {
  try {
    ligarRemontagem(false);
    ativarLocale('pt-BR');
    const semRegistro = textoDoCatalogo((m) => m.verify.claimSaiu('false', 1));
    ativarLocale('en');
    assert.equal(remontar(semRegistro), semRegistro, 'sem registro, o texto sai como veio');
    ligarRemontagem(true);
    ativarLocale('pt-BR');
    const gravado = textoDoCatalogo((m) => m.verify.claimSaiu('false', 1));
    assert.equal(gravado, 'comando "false" saiu com codigo 1');
    ativarLocale('en');
    assert.equal(remontar(gravado), 'command "false" exited with code 1');
    assert.equal(remontar('dado de outro processo'), 'dado de outro processo');
    assert.equal(msg().verify.verdade, 'Verdict: VERIFIED (no blocking reason).');
  } finally { ligarRemontagem(false); ativarLocale(undefined); }
});
