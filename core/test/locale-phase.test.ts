/**
 * RM-061, fatia F2a: `ork phase list` e `ork phase run` (o resumo do despacho, a simulacao, o pedido
 * repetido e a moldura das recusas) em ingles, com o runtime falso do `apoio.ts`. Os nomes comecam por
 * "locale en F2a phase:" para cada claim rodar so o seu. O pt-BR byte a byte fica com o snapshot.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Cenario, cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

/** A decisao autonoma do despacho e dado do ledger (pt-BR): sai como foi gravada. */
const DECISAO = /bloco [A-Z-]+ segue sem pausa humana|#TAG #\w+ no pedido do builder/g;

test('locale en F2a phase: phase run (simulacao, despacho, pedido repetido) e phase list saem em ingles', () => {
  const c = cenario('phase-en');
  try {
    assert.equal(ork(c, EN, true, 'thread', 'new', 'My slice', '--modo', 'auto').status, 0);
    const ensaio = ork(c, EN, true, 'phase', 'run', 'loc-myslice', 'GOAL', '--prompt', 'map the goal', '--dry-run');
    assert.equal(ensaio.status, 0, ensaio.stderr);
    const e = ensaio.stdout.split('\n');
    assert.equal(e[0], 'Dry run (--dry-run): nothing was dispatched.');
    assert.equal(e[1], '  session slug   : loc-myslice-full');
    assert.equal(e[4], '  pause at end   : no');
    assert.equal(e[6], '  model/effort   : opus/high');
    assert.match(e[7], /^ {2}command {8}: claude --bg "<prompt>" --name loc-myslice-full /);

    const despacho = ork(c, EN, true, 'phase', 'run', 'loc-myslice', 'GOAL', '--prompt', 'map the goal');
    assert.equal(despacho.status, 0, despacho.stderr);
    const d = despacho.stdout.split('\n');
    assert.equal(d[0], 'Phase GOAL dispatched as a background agent.');
    assert.equal(d[1], '  sessionId      : 11111111-2222-3333-4444-555555555555');
    assert.equal(d[2], '  session slug   : loc-myslice-full (product "loc", subject "myslice", phases "full")');
    assert.equal(d[6], '  model/effort   : opus/high (recorded in the ledger, see `ork phase list`)');
    assert.equal(d[7], '  verified in the runtime: yes');
    assert.equal(d[8], '  pause at block end: no (autonomous decision in the ledger)');
    assert.equal(d[10], 'Follow: claude attach 11111111-2222-3333-4444-555555555555  |  ork phase list loc-myslice');

    const repetido = ork(c, EN, true, 'phase', 'run', 'loc-myslice', 'GOAL', '--prompt', 'map the goal');
    assert.equal(repetido.status, 0, repetido.stderr);
    assert.match(repetido.stdout, /^Request already in progress: phase GOAL of thread loc-myslice runs with this same prompt \(sha256 [0-9a-f]{12}\) since \d{4}-\d{2}-\d{2} \d{2}:\d{2} \([^)]+\)\. No new session was opened and no quota was spent\.\n/);
    assert.match(repetido.stdout, /\n {2}conducted now by cli, session 11111111, phase GOAL, since \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n {2}follow: ork conducao status loc-myslice && ork sessions logs 11111111\n$/);

    const lista = ork(c, EN, true, 'phase', 'list', 'loc-myslice');
    assert.equal(lista.status, 0, lista.stderr);
    assert.match(lista.stdout, /^ {2}WHEN +EVENT +DETAIL\n/);
    assert.match(lista.stdout, /phase_dispatch {13}GOAL \| loc-myslice-full \| session 11111111 \| model opus\/high\n/);
    assert.match(lista.stdout, /phase_dispatch_verified {4}GOAL \| loc-myslice-full \| session 11111111 \| in the runtime: yes\n/);
    assert.match(lista.stdout, /\nTimes in America\/New_York, E[SD]T\.\n$/);
    const textos = [ensaio.stdout, despacho.stdout, repetido.stdout, lista.stdout].join('\n').replace(DECISAO, ' ');
    assert.deepEqual(linhasEmPortugues(textos, [c.dir]), []);
    // Controle do detector: a mesma tabela em pt-BR e acusada.
    assert.ok(linhasEmPortugues(ork(c, PT, true, 'phase', 'list', 'loc-myslice').stdout.replace(DECISAO, ' '), [c.dir]).length >= 3,
      'o detector acha o pt-BR');
  } finally { c.limpar(); }
});

test('locale en F2a phase: erros de uso e a moldura das recusas saem em ingles', () => {
  const c = cenario('phase-recusas');
  try {
    assert.equal(ork(c, EN, true, 'thread', 'new', 'Refusal', '--modo', 'auto', '--sem-worktree').status, 0);
    const casos: Array<[string[], RegExp]> = [
      [['phase', 'run', 'loc-refusal', 'GOAL'], /^usage: ork phase run <thread-id> <PHASE> --prompt "<text>"\n$/],
      [['phase', 'run', 'loc-refusal', 'NADA', '--prompt', 'x'], /^error: invalid phase: "NADA" \(expected one of GOAL, PLAN, GO, CHECK, SHIP, MASTER\)\n$/],
      [['phase', 'run', 'loc-refusal', 'GOAL', '--prompt', 'x', '--esperar', '0'], /^error: usage: --esperar \[minutes\], from 1 to 1440 \(no value: 30\)\n$/],
      [['phase', 'list'], /^usage: ork phase list <thread-id>\n$/],
      [['phase', 'list', 'loc-nada'], /^error: thread "loc-nada" not found in /],
      [['phase', 'qualquer'], /^unknown subcommand: phase qualquer\n$/],
      [['phase'], /^missing subcommand: phase\n$/],
    ];
    for (const [args, esperado] of casos) {
      const r = ork(c, EN, true, ...args);
      assert.match(r.stderr, esperado, args.join(' '));
      assert.notEqual(r.status, 0, args.join(' '));
    }
    // Policy de custo bloqueia: a moldura e inglesa; detalhe e correcao sao dado da policy avaliada.
    const bloqueado = ork(c, { ...EN, ANTHROPIC_BASE_URL: 'https://exemplo.invalid' }, true, 'phase', 'run', 'loc-refusal', 'GOAL', '--prompt', 'x');
    assert.equal(bloqueado.status, 1);
    assert.match(bloqueado.stderr, /^Dispatch BLOCKED by the typed gate: cost\.violation\n {2}\[block\] policy provider: [^\n]+\n {11}fix: [^\n]+\n {2}the prompt was not written to disk; gate_blocked event in the loc-refusal ledger\n$/);
  } finally { c.limpar(); }
});

test('locale en F2a phase: o dado gravado pelo despacho (prompt, sha256, ledger, thread.json) nao muda com a lingua', () => {
  const pt = cenario('phase-dado-pt'), en = cenario('phase-dado-en');
  const normalizar = (c: Cenario, texto: string) => texto.split(c.dir).join('<DIR>').split(c.stub).join('<STUB>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<T>').replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/\b[0-9a-f]{64}\b/g, '<SHA256>').replace(/-goal-[0-9a-f]{8}\.md/g, '-goal-<H>.md')
    .replace(/\b\d{2}\/\d{2}(\/\d{4})? \d{2}:\d{2}\b/g, '<DATA>')
    .replace(/<prompt:[0-9a-f]{8}>/g, '<prompt:<H>>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/"(identidade|eventId|pid|startTime|bootId|dispatchId|identidadeDoDespacho|id|token|nonce|correlacao|pedidoId)": ?("[^"]*"|\d+|\{[^}]*\})/g, '"$1":<X>');
  try {
    for (const [c, locale] of [[pt, PT], [en, EN]] as const) {
      assert.equal(ork(c, locale, true, 'thread', 'new', 'Data', '--modo', 'auto', '--sem-worktree').status, 0);
      const r = ork(c, locale, true, 'phase', 'run', 'loc-data', 'GOAL', '--prompt', 'same request');
      assert.equal(r.status, 0, r.stderr);
    }
    const dir = (c: Cenario) => path.join(c.dir, '.orkastery', 'threads', 'loc-data');
    const prompts = (c: Cenario) => fs.readdirSync(path.join(dir(c), 'prompts')).map((f) => normalizar(c, fs.readFileSync(path.join(dir(c), 'prompts', f), 'utf8')));
    assert.deepEqual(prompts(en), prompts(pt));
    assert.deepEqual(fs.readdirSync(path.join(dir(en), 'prompts')).map((f) => f.replace(/-goal-[0-9a-f]{8}\.md/, '')),
      fs.readdirSync(path.join(dir(pt), 'prompts')).map((f) => f.replace(/-goal-[0-9a-f]{8}\.md/, '')));
    const ledger = (c: Cenario) => fs.readFileSync(path.join(dir(c), 'ledger.jsonl'), 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.tipo !== 'session_watcher_started' && e.tipo !== 'session_sensor_registered')
      .map((e) => normalizar(c, JSON.stringify(e)));
    assert.deepEqual(ledger(en), ledger(pt));
    assert.equal(normalizar(en, fs.readFileSync(path.join(dir(en), 'thread.json'), 'utf8')),
      normalizar(pt, fs.readFileSync(path.join(dir(pt), 'thread.json'), 'utf8')));
  } finally { pt.limpar(); en.limpar(); }
});

test('locale en F2a phase (negativo): os --json e a rota privada seguem em pt-BR com LANG=en_US', () => {
  const c = cenario('phase-negativo');
  try {
    assert.equal(ork(c, PT, true, 'thread', 'new', 'Fora', '--modo', 'auto', '--sem-worktree').status, 0);
    // Retry e master digest entraram no catálogo; os contratos --json e `privado` seguem fora.
    for (const args of [['retry', 'policy', '--json'], ['retry', 'list', '--json'], ['privado']]) {
      const pt = ork(c, PT, true, ...args), en = ork(c, EN, true, ...args);
      assert.equal(en.stdout, pt.stdout, args.join(' '));
      assert.equal(en.stderr, pt.stderr, args.join(' '));
      assert.equal(en.status, pt.status, args.join(' '));
    }
  } finally { c.limpar(); }
});
