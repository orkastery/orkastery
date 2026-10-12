/**
 * RM-061, fatia F3b: o resto de `ork thread` em ingles (`list`, `close` e `entrega`). A tabela, o vazio e as fechadas
 * omitidas saem pelo catalogo, com o status traduzido so na impressao; as recusas de `close` e `entrega` vem do
 * catalogo e a entrada do CLI as remonta no locale do comando. O `--json` e o resultado JSON do `close` e da `entrega`
 * nao mudam, nem o que eles gravam. Negativo: `thread new --from-finding` segue em pt-BR (G2). Os nomes comecam por
 * "locale en F3b thread:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chaveDoLocale, cobreLocale } from '../src/locale';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

const SEM_DATA = (t: string) => t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');

test('locale en F3b thread: thread list sai em ingles, com o status pelo id e o --json igual', () => {
  const c = cenario('thread-f3b-lista');
  try {
    const vazio = ork(c, EN, false, 'thread', 'list');
    assert.equal(vazio.status, 0, vazio.stderr);
    assert.equal(vazio.stdout, 'No open or paused thread (use `--todas` to see the closed ones). ' +
      'Create one with `ork thread new "<name>" --modo classic`.\n');
    assert.equal(ork(c, EN, false, 'thread', 'list', '--todas').stdout,
      'No thread in `.orkastery/threads`. Create one with `ork thread new "<name>" --modo classic`.\n');
    for (const nome of ['loc-a', 'loc-b']) assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--sem-worktree').status, 0);
    assert.equal(ork(c, PT, false, 'thread', 'close', 'loc-locb', '--motivo', 'engano', '--por', 'teste', '--justificativa', 'aberta por engano').status, 0);
    const lista = ork(c, EN, false, 'thread', 'list');
    assert.equal(lista.status, 0, lista.stderr);
    const l = lista.stdout.split('\n');
    assert.match(l[0], /^ {2}ID {8}SLUG {11}MODE {6}PHASE {2}STATUS {2}PAUSES {2}SESSIONS$/);
    assert.match(l[2], /^ {2}loc-loca {2}loc-loca-goal {2}#Classic {2}GOAL {3}open {4}3 {7}0$/);
    assert.equal(l.slice(3).join('\n'), '\n  1 closed thread(s) hidden. Use `--todas` to see all.\n');
    const todas = ork(c, EN, false, 'thread', 'list', '--todas');
    assert.match(todas.stdout, /\n {2}loc-locb {2}loc-locb-goal {2}#Classic {2}GOAL {3}closed {2}3 {7}0\n$/);
    assert.deepEqual(linhasEmPortugues(`${lista.stdout}\n${todas.stdout}`), []);
    // O --json e o mesmo nas duas linguas, inclusive o status gravado.
    for (const args of [['thread', 'list', '--json'], ['thread', 'list', '--todas', '--json']]) {
      assert.equal(ork(c, EN, false, ...args).stdout, ork(c, PT, false, ...args).stdout, args.join(' '));
    }
    // owner.language en-US vence o LANG pt-BR.
    assert.equal(ork(c, PT, false, 'onboarding', 'set', 'maestro', '--conteudo', '{"owner":{"language":"en-US"}}', '--por', 'teste').status, 0);
    assert.match(ork(c, PT, false, 'thread').stdout, /\n {2}1 closed thread\(s\) hidden\. Use `--todas` to see all\.\n$/);
  } finally { c.limpar(); }
});

test('locale en F3b thread: as recusas de close e entrega saem em ingles e o que se grava nao muda', () => {
  const c = cenario('thread-f3b-close');
  try {
    for (const nome of ['loc-a', 'loc-b', 'loc-c']) assert.equal(ork(c, PT, false, 'thread', 'new', nome, '--sem-worktree').status, 0);
    const erro = (...args: string[]) => {
      const r = ork(c, EN, false, ...args);
      assert.equal(r.status, 1, args.join(' '));
      assert.equal(r.stdout, '', args.join(' '));
      return r.stderr;
    };
    assert.equal(erro('thread', 'close'), 'error: pass the thread id\n');
    assert.equal(erro('thread', 'close', 'loc-loca', '--motivo', 'cansei', '--por', 'teste', '--justificativa', 'sem uso'),
      'error: the reason must be `orfa`, `engano` or `superada`\n');
    assert.equal(erro('thread', 'close', 'loc-loca', '--motivo', 'orfa', '--por', 'teste'), 'error: closing needs an author and a justification\n');
    assert.equal(erro('thread', 'close', 'loc-nada', '--motivo', 'orfa', '--por', 'teste', '--justificativa', 'sem uso'),
      `error: thread "loc-nada" not found in ${path.join(c.dir, '.orkastery', 'threads')}\n`);
    assert.equal(erro('thread', 'entrega', 'loc-loca', '--arquivo', 'README.md', '--sha256', 'ab'.repeat(32)),
      'error: an artifact needs an open thread and an explicit author\n');
    assert.equal(erro('thread', 'entrega', 'loc-loca', '--arquivo', 'README.md', '--sha256', 'x', '--por', 'teste'), 'error: invalid sha256\n');
    assert.equal(erro('thread', 'entrega', 'loc-loca', '--arquivo', '.orkastery', '--sha256', 'ab'.repeat(32), '--por', 'teste'),
      'error: the artifact must be a regular file\n');
    assert.equal(erro('thread', 'entrega', 'loc-loca', '--arquivo', 'README.md', '--sha256', 'ab'.repeat(32), '--por', 'teste'),
      'error: the artifact hash does not match\n');
    const fora = fs.mkdtempSync(path.join(path.dirname(c.dir), 'ork-locale-thread-f3b-fora-'));
    try {
      fs.writeFileSync(path.join(fora, 'x.txt'), 'x\n');
      assert.equal(erro('thread', 'entrega', 'loc-loca', '--arquivo', path.join(fora, 'x.txt'), '--sha256', 'ab'.repeat(32), '--por', 'teste'),
        'error: the artifact must be inside the project\n');
    } finally { fs.rmSync(fora, { recursive: true, force: true }); }
    // O fechamento em ingles grava o mesmo que em pt-BR: o resultado e o ledger, normalizados os horarios.
    const ledger = (id: string) => SEM_DATA(fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', id, 'ledger.jsonl'), 'utf8'))
      .replace(/"eventId":"[^"]*"/g, '"eventId":"<ID>"').replace(new RegExp(id, 'g'), '<THREAD>');
    const en = ork(c, EN, false, 'thread', 'close', 'loc-loca', '--motivo', 'engano', '--por', 'teste', '--justificativa', 'aberta por engano');
    const pt = ork(c, PT, false, 'thread', 'close', 'loc-locb', '--motivo', 'engano', '--por', 'teste', '--justificativa', 'aberta por engano');
    assert.equal(en.status, 0, en.stderr);
    const semIds = (t: string) => SEM_DATA(t).replace(/loc-loc[ab]/g, '<THREAD>').replace(/"(nome|assunto)": "[^"]*"/g, '"$1": "<X>"');
    assert.equal(semIds(en.stdout), semIds(pt.stdout));
    assert.equal(ledger('loc-loca'), ledger('loc-locb'));
    assert.equal(erro('thread', 'close', 'loc-loca', '--motivo', 'orfa', '--por', 'teste', '--justificativa', 'aberta por engano'),
      'error: the thread was already closed for another reason\n');
    assert.equal(erro('thread', 'entrega', 'loc-loca', '--arquivo', 'README.md', '--sha256', 'ab'.repeat(32), '--por', 'teste'),
      'error: an artifact needs an open thread and an explicit author\n');
    // A entrega em ingles devolve o mesmo JSON.
    const sha = createHash('sha256').update(fs.readFileSync(path.join(c.dir, 'README.md'))).digest('hex');
    const entrega = ork(c, EN, false, 'thread', 'entrega', 'loc-locc', '--arquivo', 'README.md', '--sha256', sha, '--por', 'teste');
    assert.equal(entrega.status, 0, entrega.stderr);
    assert.deepEqual(JSON.parse(entrega.stdout), { tipo: 'artefato', arquivo: 'README.md', sha256: sha });
    assert.equal(erro('thread', 'close', 'loc-locc', '--motivo', 'orfa', '--por', 'teste', '--justificativa', 'ja entregue'),
      'error: a delivered or scored thread needs MASTER, not an administrative close\n');
  } finally { c.limpar(); }
});

test('locale en F3b thread (negativo): thread new --from-finding segue em pt-BR, byte a byte', () => {
  assert.equal(chaveDoLocale(['thread', 'list'], {}), 'thread list');
  assert.equal(chaveDoLocale(['thread', 'close', 'x'], {}), 'thread close');
  assert.equal(chaveDoLocale(['thread', 'entrega', 'x'], {}), 'thread entrega');
  for (const [posicionais, opcoes] of [[['thread', 'list'], {}], [['thread'], {}], [['thread', 'close', 'x'], {}], [['thread', 'entrega', 'x'], {}]] as const) {
    assert.ok(cobreLocale([...posicionais], opcoes), posicionais.join(' '));
  }
  assert.equal(cobreLocale(['thread', 'list'], { json: true }), false);
  assert.equal(cobreLocale(['thread', 'new'], { 'from-finding': 'F1' }), false);
  const c = cenario('thread-f3b-achado');
  try {
    const pt = ork(c, PT, false, 'thread', 'new', '--from-finding', 'nao-existe');
    const en = ork(c, EN, false, 'thread', 'new', '--from-finding', 'nao-existe');
    assert.notEqual(pt.status, 0);
    assert.equal(en.stdout, pt.stdout);
    assert.equal(en.stderr, pt.stderr);
  } finally { c.limpar(); }
});
