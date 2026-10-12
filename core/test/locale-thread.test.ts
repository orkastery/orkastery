/**
 * RM-061, fatia F2a: `ork thread new` e `ork thread status` em ingles, a linha de conducao e o slug
 * descrito. Os nomes comecam por "locale en F2a thread:" para cada claim rodar so o seu. O pt-BR
 * byte a byte fica com o snapshot (`locale-f2a-snapshot`).
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { linhaDeConducao, quemConduz } from '../src/conducao-texto';
import { descreverSlug } from '../src/phase';
import { definirFusoDoDono } from '../src/horario';
import { ativarLocale } from '../src/locale';
import { ConducaoAtual } from '../src/types';
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

function conducao(dono: object, operacao: string, sessao: string | null): ConducaoAtual {
  return { thread: 'loc-x', canal: 'cli', sessao, fase: 'GO', desde: '2025-09-19T18:16:00.000Z', promptSha256: 'ab'.repeat(32),
    operacao, dono, expiraEm: '2025-09-19T19:16:00.000Z', identidade: '00000000-0000-0000-0000-000000000000' } as unknown as ConducaoAtual;
}

test('locale en F2a thread: thread new e thread status saem em ingles', () => {
  const c = cenario('thread-en');
  try {
    const nova = ork(c, EN, true, 'thread', 'new', 'My slice', '--modo', 'auto');
    assert.equal(nova.status, 0, nova.stderr);
    const l = nova.stdout.split('\n');
    assert.equal(l[0], 'Thread created.');
    assert.equal(l[1], '  id         loc-myslice');
    assert.equal(l[3], '  name       My slice');
    assert.equal(l[4], '  mode       #Auto (0 planned human pauses)');
    assert.equal(l[5], '  cycle      default for the mode');
    assert.equal(l[6], '  phase      GOAL');
    assert.equal(l[7], '  status     open');
    assert.match(nova.stdout, /\n {2}planned blocks\n {4}full {3}GOAL-PLAN-GO-CHECK-SHIP-MASTER no planned human pause\n/);
    assert.match(nova.stdout, /\n {2}3-part slug: product "loc", subject "myslice", phases "full"\n/);
    assert.match(nova.stdout, /\n {2}worktree: created by the `worktree\.por_thread` key in orkastery\.yaml; to create without it, use `--sem-worktree`\n/);
    assert.match(nova.stdout, /\n {2}state: \.orkastery\/threads\/loc-myslice\/thread\.json\n\nNext step: `ork phase run loc-myslice GOAL --prompt "<request>"`\n$/);
    const status = ork(c, EN, true, 'thread', 'status', 'loc-myslice');
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /^Thread loc-myslice\n/);
    assert.match(status.stdout, /\n {2}conduction nobody right now\n/);
    assert.match(status.stdout, /\n {2}no session dispatched yet\n\n {2}planned human pauses in this mode: 0\n$/);
    assert.deepEqual(linhasEmPortugues(nova.stdout + status.stdout, [c.dir]), []);
    // Controle do detector: o mesmo status em pt-BR e acusado.
    assert.ok(linhasEmPortugues(ork(c, PT, true, 'thread', 'status', 'loc-myslice').stdout, [c.dir]).length >= 5, 'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2a thread: #Classic em simulacao, criterios de pronto e os avisos da criacao', () => {
  const c = cenario('thread-avisos');
  try {
    const classic = ork(c, EN, true, 'thread', 'new', 'Other', '--modo', 'classic', '--dry-run');
    assert.match(classic.stdout, /^Dry run \(--dry-run\): nothing was written\.\n/);
    assert.match(classic.stdout, /\n {2}mode {7}#Classic \(3 planned human pauses\)\n/);
    assert.match(classic.stdout, /\n {4}goal {3}GOAL {15}planned pause: goal\n/);
    assert.match(classic.stdout, /\n {4}f34 {4}GO-CHECK {11}planned pause: evidence, with push authorized in advance\n/);
    assert.match(classic.stdout, /\n {2}worktree: would be created by the `worktree\.por_thread` key in orkastery\.yaml/);
    const rm = ork(c, EN, true, 'thread', 'new', 'RM-123 thing', '--modo', 'auto', '--sem-worktree', '--exige-runtime-diferente',
      '--done', 'build passes :: npm run build');
    assert.equal(rm.status, 0, rm.stderr);
    assert.match(rm.stdout, /\n {2}validation CHECK on a runtime other than the GO one \(required by the thread\)\n {2}done when \(1 executable criterion\)\n/);
    assert.match(rm.stderr, /^Warning: RM-123 in the name does not link the thread to the roadmap\./);
    assert.match(rm.stderr, /\nWarning: thread loc-rm123thing has no worktree \(`--sem-worktree`\): it works at the project root, on the base branch main, and `ork ship` refuses the delivery under `push_direto_na_base` \(block\)/);
    assert.deepEqual(linhasEmPortugues(classic.stdout + rm.stdout + rm.stderr, [c.dir]), []);
  } finally { c.limpar(); }
});

test('locale en F2a thread: os erros de uso de thread new e thread status saem em ingles', () => {
  const c = cenario('thread-erros');
  try {
    const casos: Array<[string[], RegExp]> = [
      [['thread', 'new'], /^usage: ork thread new <name> --modo <MODE>\n$/],
      [['thread', 'new', 'x', '--modo', 'nenhum'], /^modo\.desconhecido: "nenhum" is not a conduction mode\. Use one of: #Classic, #Maestro, #Auto, #Fast\.\n$/],
      [['thread', 'new', 'x', '--done', 'sem comando'], /^error: done\.sem-comando: "sem comando" has no command\. Use `--done/],
      [['thread', 'new', 'x', '--done', ':: npm test'], /^error: done\.incompleto: ":: npm test" needs a criterion AND a command\n$/],
      [['thread', 'new', 'x', '--ciclo', 'nenhum'], /^invalid cycle variant: "nenhum"\. Use one of: greenfield, /],
      [['thread', 'new', 'x', '--ciclo', 'merge-branch', '--sem-worktree'], /^usage: the merge-branch cycle requires an isolated worktree/],
      [['thread', 'new', 'x', '--worktree', 'auto', '--sem-worktree'], /^usage: `--worktree` and `--sem-worktree` exclude each other; use one of them\n$/],
      [['thread', 'status'], /^usage: ork thread status <thread-id>\n$/],
      [['thread', 'status', 'loc-nada'], /^error: thread "loc-nada" not found in /],
      [['thread', 'qualquer'], /^unknown subcommand: thread qualquer\n$/],
    ];
    for (const [args, esperado] of casos) {
      const r = ork(c, EN, true, ...args);
      assert.match(r.stderr, esperado, args.join(' '));
      assert.notEqual(r.status, 0, args.join(' '));
    }
  } finally { c.limpar(); }
});

test('locale en F2a thread: a linha de conducao, quem conduz e o slug descrito em ingles', () => {
  definirFusoDoDono('America/New_York');
  ativarLocale('en');
  try {
    const sessao = conducao({ tipo: 'sessao', sessionId: '33333333-4444-5555-6666-777777777777' }, 'phase.run', '33333333-4444-5555-6666-777777777777');
    assert.equal(linhaDeConducao(sessao, { agora: '2025-09-19T20:00:00.000Z' }), 'conducted now by cli, session 33333333, phase GO, since 2025-09-19 14:16');
    assert.equal(quemConduz(conducao({ tipo: 'processo', pid: 4321 }, 'retry.run', null)), 'process 4321 (phase retry)');
    assert.equal(quemConduz(conducao({ tipo: 'reserva', por: 'dono' }, 'handoff', null)), 'reserved by dono');
    assert.equal(quemConduz(conducao({ tipo: 'outro' }, 'handoff', null)), 'reservation of whoever took over');
    assert.equal(descreverSlug('loc-x-full-2'), 'product "loc", subject "x", phases "full", rotation 2');
  } finally { ativarLocale(undefined); definirFusoDoDono(undefined); }
  // Sem ativar, o pt-BR de sempre: as outras superficies (board, monitor, pulse, MCP) nao mudam.
  assert.equal(descreverSlug('loc-x-full'), 'produto "loc", assunto "x", fases "full"');
});

test('locale en F2a thread: o dado gravado por thread new e o --json do status nao mudam com a lingua', () => {
  const pt = cenario('thread-dado-pt'), en = cenario('thread-dado-en');
  const normalizar = (c: Cenario, texto: string) => texto.split(c.dir).join('<DIR>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<T>').replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/"(identidade|eventId|pid|sessionId)": ?("[^"]*"|\d+)/g, '"$1":<X>');
  try {
    for (const [c, locale] of [[pt, PT], [en, EN]] as const) {
      const r = ork(c, locale, true, 'thread', 'new', 'Dado', '--modo', 'classic', '--done', 'ok :: true');
      assert.equal(r.status, 0, r.stderr);
    }
    const ler = (c: Cenario, arquivo: string) => normalizar(c, fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', 'loc-dado', arquivo), 'utf8'));
    assert.equal(ler(en, 'thread.json'), ler(pt, 'thread.json'));
    assert.equal(ler(en, 'ledger.jsonl'), ler(pt, 'ledger.jsonl'));
    assert.equal(normalizar(en, ork(en, EN, true, 'thread', 'status', 'loc-dado', '--json').stdout),
      normalizar(pt, ork(pt, PT, true, 'thread', 'status', 'loc-dado', '--json').stdout));
  } finally { pt.limpar(); en.limpar(); }
});

test('locale en F2a thread: thread new --from-finding segue em pt-BR com LANG=en_US', () => {
  const c = cenario('thread-negativo');
  try {
    assert.equal(ork(c, PT, true, 'thread', 'new', 'Lista', '--modo', 'auto', '--sem-worktree').status, 0);
    // A F3b levou `thread list` ao catalogo (locale-thread-f3b); o achado de auditoria segue fora (G2 da F3b).
    for (const args of [['thread', 'new', 'x', '--from-finding', 'A9']]) {
      const pt = ork(c, PT, true, ...args), en = ork(c, EN, true, ...args);
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.equal(en.stderr, pt.stderr, args.join(' '));
    }
  } finally { c.limpar(); }
});
