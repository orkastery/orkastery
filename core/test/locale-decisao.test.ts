/**
 * RM-061, fatia F3b: `ork decisao placar` e o uso de `ork decisao` em ingles. A tabela, o limiar e a taxa de reversao
 * saem pelo catalogo; a fase de cada linha e o `--json` sao dado. A F3c leva as recusas de `ork decisao registrar`
 * ao mesmo catalogo sem mudar o contrato HITL v2. Os nomes comecam por "locale en F3b decisao:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cobreLocale } from '../src/locale';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

const CAMPOS = ['--decidido', 'usar a fila', '--porque', 'menos carga', '--como-mudar', 'trocar a flag', '--custo-agora', 'nenhum',
  '--custo-depois', 'baixo', '--quem', 'sessao GO', '--evidencia', 'medida local', '--criterio', 'medicao:wc -l x'];

test('locale en F3b decisao: placar e o uso saem em ingles, e o --json do placar e igual', () => {
  const c = cenario('decisao-f3b');
  try {
    assert.equal(ork(c, PT, false, 'thread', 'new', 'loc-d', '--sem-worktree', '--modo', 'auto').status, 0);
    const vazio = ork(c, EN, false, 'decisao', 'placar', 'loc-locd');
    assert.equal(vazio.status, 0, vazio.stderr);
    assert.match(vazio.stdout, /^ {2}PHASE {2}DECIDED {2}INFORMED {2}QUESTIONS {2}REVERTED {2}NO TRAIL {2}THRESHOLD\n/);
    assert.match(vazio.stdout, /\n\nreversal rate of informed decisions: no informed decision yet\n$/);
    assert.equal(ork(c, PT, false, 'decisao', 'registrar', 'loc-locd', ...CAMPOS).status, 0);
    const placar = ork(c, EN, false, 'decisao', 'placar', 'loc-locd');
    assert.match(placar.stdout, /\n {2}GOAL {3}1 {8}1 {9}0 {10}0 {9}0 {9}ok\n/);
    assert.match(placar.stdout, /\n\nreversal rate of informed decisions: 0%\n$/);
    assert.deepEqual(linhasEmPortugues(placar.stdout), []);
    assert.equal(ork(c, EN, false, 'decisao', 'placar', 'loc-locd', '--json').stdout, ork(c, PT, false, 'decisao', 'placar', 'loc-locd', '--json').stdout);
    assert.equal(ork(c, EN, false, 'decisao').stderr, 'error: usage: ork decisao registrar|placar <thread-id>\n');
    assert.equal(ork(c, EN, false, 'decisao', 'voar', 'x').stderr, 'error: usage: ork decisao registrar|placar <thread-id>\n');
    assert.equal(ork(c, EN, false, 'decisao', 'placar').stderr, 'error: usage: ork decisao placar <thread-id> [--json]\n');
    // owner.language en-US vence o LANG pt-BR.
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.match(ork(c, PT, false, 'decisao', 'placar', 'loc-locd').stdout, /^ {2}PHASE {2}DECIDED /);
  } finally { c.limpar(); }
});

test('locale en F3c decisao: as recusas de decisao registrar saem em ingles e preservam flags e contrato', () => {
  assert.ok(cobreLocale(['decisao', 'registrar', 'x'], {}));
  assert.ok(cobreLocale(['decisao', 'placar', 'x'], {}));
  assert.ok(cobreLocale(['decisao'], {}));
  const c = cenario('decisao-f3b-negativo');
  try {
    assert.equal(ork(c, PT, false, 'thread', 'new', 'loc-n', '--sem-worktree', '--modo', 'auto').status, 0);
    for (const args of [['registrar', 'loc-locn', '--decidido', 'x'], ['registrar', 'loc-locn', ...CAMPOS.slice(0, -2), '--criterio', 'palpite:x'],
      ['registrar', 'loc-locn', ...CAMPOS.slice(0, -2), '--criterio', 'ledger:nao-existe'], ['registrar']]) {
      const en = ork(c, EN, false, 'decisao', ...args);
      assert.notEqual(en.status, 0, args.join(' '));
      assert.match(en.stderr, /^error: /, args.join(' '));
      assert.doesNotMatch(en.stderr, /\b(erro|exige|critério|decisão|falta)\b/i, args.join(' '));
    }
    assert.match(ork(c, EN, false, 'decisao', 'registrar', 'loc-locn', '--decidido', 'x').stderr,
      /decisao registrar requires --porque/);
    assert.match(ork(c, EN, false, 'decisao', 'registrar', 'loc-locn', ...CAMPOS.slice(0, -2), '--criterio', 'ledger:nao-existe').stderr,
      /informed decision: the criterion does not resolve/);
  } finally { c.limpar(); }
});
