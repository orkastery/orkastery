/**
 * RM-061, fatia F2a (D14 da thread ork-rm061f2a): os erros que os comandos cobertos imprimem e que nascem
 * fora do texto deles. O manifesto ausente, `thread new --slug` e `--roadmap`, `phase run --runtime` e o
 * modelo ao trocar de runtime saem pelo catalogo (`ErroDoCatalogo`, remontado no locale do comando); o
 * aviso de preferencia invalida que o manifesto grava sai traduzido na impressao. Em pt-BR e com `--json`
 * o texto segue o da base, e nada disso grava estado. Os nomes comecam por "locale en F2a erros:".
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ativarLocale, comLocale, ErroDoCatalogo, mensagemDoErro, msg } from '../src/locale';
import { validarPreferencias } from '../src/experiencia';
import { exec } from '../src/util';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';

const REGEX = '\\^\\[a-z0-9\\]\\{1,3\\}-';

test('locale en F2a erros: manifesto ausente, --slug, --roadmap, --runtime e o modelo ao trocar de runtime saem em ingles', () => {
  const fora = cenario('erros-fora', false);
  try {
    const r = ork(fora, EN, false, 'onboarding');
    assert.equal(r.status, 1);
    assert.equal(r.stderr, `error: \`orkastery.yaml\` not found in ${fora.dir} or any parent directory; run \`ork init\` first.\n`);
    assert.equal(ork(fora, EN, false, 'thread', 'new', 'Demo', '--modo', 'auto').stderr, r.stderr);
  } finally { fora.limpar(); }

  const c = cenario('erros-en');
  try {
    const threads = path.join(c.dir, '.orkastery', 'threads');
    const slug = ork(c, EN, false, 'thread', 'new', 'Demo', '--modo', 'auto', '--sem-worktree', '--slug', 'xx');
    assert.equal(slug.status, 1);
    assert.match(slug.stderr, new RegExp(`^error: invalid slug: "xx" \\(canonical regex: ${REGEX}`));
    const inexistente = ork(c, EN, false, 'thread', 'new', 'Demo', '--modo', 'auto', '--sem-worktree', '--roadmap', 'RM-999');
    assert.equal(inexistente.stderr, 'error: roadmap.item: RM-999 does not exist in `docs/roadmap`\n');
    assert.equal(ork(c, EN, false, 'thread', 'new', 'Demo', '--modo', 'auto', '--sem-worktree', '--roadmap', 'qualquer').stderr,
      'error: roadmap.item: "qualquer" is not a roadmap item (expected RM-NNN)\n');
    // Nenhuma das recusas criou thread.
    assert.deepEqual(fs.existsSync(threads) ? fs.readdirSync(threads) : [], []);

    assert.equal(ork(c, PT, false, 'thread', 'new', 'Rt', '--modo', 'auto', '--sem-worktree').status, 0);
    const ledger = path.join(threads, 'loc-rt', 'ledger.jsonl');
    const antes = fs.readFileSync(ledger, 'utf8');
    const runtime = ork(c, EN, true, 'phase', 'run', 'loc-rt', 'GOAL', '--prompt', 'x', '--runtime', 'bogus');
    assert.equal(runtime.status, 1);
    assert.equal(runtime.stderr, 'error: unknown dispatch runtime: "bogus" (supported: claude-bg, codex, grok)\n');
    const modelo = ork(c, EN, true, 'phase', 'run', 'loc-rt', 'GOAL', '--prompt', 'x', '--runtime', 'codex');
    assert.equal(modelo.status, 1);
    assert.equal(modelo.stderr, 'error: setup.model.required: switching the runtime from claude-bg to codex needs a model; ' +
      'pass `--runtime codex --model <model>` for this dispatch. The project setup stays as it is.\n');
    assert.equal(fs.readFileSync(ledger, 'utf8'), antes, 'as recusas nao gravam no ledger');
    const textos = [slug.stderr, inexistente.stderr, runtime.stderr, modelo.stderr].join('\n');
    assert.deepEqual(linhasEmPortugues(textos), []);
  } finally { c.limpar(); }
});

test('locale en F2a erros: thread new --pedido em ingles, com o pedido gravado igual nas duas linguas', () => {
  const pt = cenario('pedido-pt'), en = cenario('pedido-en');
  try {
    const r = ork(en, EN, false, 'thread', 'new', 'Pedido', '--modo', 'auto', '--sem-worktree', '--pedido', 'map the goal');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\n {2}request: saved to \.orkastery\/threads\/loc-pedido\/pedido\.md \(sha256 [0-9a-f]{8}, 12 bytes\); `ork prompt render` uses it when `--pedido` is missing\n/);
    const p = ork(pt, PT, false, 'thread', 'new', 'Pedido', '--modo', 'auto', '--sem-worktree', '--pedido', 'map the goal');
    assert.match(p.stdout, /\n {2}pedido: guardado em \.orkastery\/threads\/loc-pedido\/pedido\.md \(sha256 [0-9a-f]{8}, 12 bytes\); o ork prompt render o usa quando falta --pedido\n/);
    const pedido = (c: typeof pt) => fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', 'loc-pedido', 'pedido.md'), 'utf8');
    const meta = (c: typeof pt) => JSON.parse(fs.readFileSync(path.join(c.dir, '.orkastery', 'threads', 'loc-pedido', 'thread.json'), 'utf8')).pedido;
    assert.equal(pedido(en), pedido(pt));
    assert.deepEqual(meta(en), meta(pt));
    assert.equal(ork(en, EN, false, 'thread', 'new', 'Outro', '--modo', 'auto', '--sem-worktree', '--pedido').stderr,
      'usage: --pedido "<builder request text>"\n');
    assert.equal(ork(en, EN, false, 'thread', 'new', 'Outro', '--modo', 'auto', '--sem-worktree', '--pedido', '   ').stderr,
      'usage: thread.pedido.invalido: the request is empty\n');
    assert.equal(ork(pt, PT, false, 'thread', 'new', 'Outro', '--modo', 'auto', '--sem-worktree', '--pedido', '   ').stderr,
      'uso: thread.pedido.invalido: o pedido esta vazio\n');
  } finally { pt.limpar(); en.limpar(); }
});

test('locale en F2a erros: os demais erros de argumento de thread new saem em ingles e o pt-BR segue o da base', () => {
  const c = cenario('erros-thread');
  try {
    exec('git', ['branch', 'ork/loc-zzz-full'], c.dir);
    const casos: Array<[string[], string, string]> = [
      [['x', '--modo', 'fast', '--ciclo', 'goal-plan', '--sem-worktree', '--dry-run'],
        'the goal-plan cycle redraws the blocks, and mode #Fast has a single block (GO): create the thread without `--ciclo` or pick a full-cycle mode',
        'o ciclo goal-plan redesenha os blocos e o modo #Fast tem um bloco so (GO): crie a thread sem --ciclo ou escolha um modo de ciclo completo'],
      [['###', '--modo', 'auto', '--sem-worktree', '--dry-run'],
        'name "###" does not produce a valid subject (expected [a-z0-9])', 'nome "###" nao produz assunto valido (esperado [a-z0-9])'],
      [['x', '--modo', 'auto', '--ciclo', 'merge-branch', '--dry-run'],
        'the merge-branch cycle starts from a branch that already exists: pass `--branch <branch>`',
        'o ciclo merge-branch parte de uma branch que ja existe: informe --branch <branch>'],
      [['x', '--modo', 'auto', '--ciclo', 'merge-branch', '--branch', 'nao-existe', '--dry-run'],
        'branch "nao-existe" does not exist in this repository', 'branch "nao-existe" nao existe neste repositorio'],
      [['x', '--modo', 'auto', '--branch', 'foo', '--dry-run'],
        '`--branch` only applies with `--ciclo merge-branch`', '--branch so vale com --ciclo merge-branch'],
      [['zzz', '--modo', 'auto'],
        'the branch ork/loc-zzz-full already exists, and `worktree.por_thread` asks for the thread worktree: remove it or create the thread with `--sem-worktree`',
        'a branch ork/loc-zzz-full já existe, e a chave worktree.por_thread pede a worktree da thread: tire-a ou crie com --sem-worktree'],
    ];
    for (const [args, en, pt] of casos) {
      assert.equal(ork(c, EN, false, 'thread', 'new', ...args).stderr, `error: ${en}\n`, args.join(' '));
      assert.equal(ork(c, PT, false, 'thread', 'new', ...args).stderr, `erro: ${pt}\n`, args.join(' '));
    }
    assert.deepEqual(fs.readdirSync(path.join(c.dir, '.orkastery', 'threads')).filter((d) => !d.startsWith('.')), []);
  } finally { c.limpar(); }
});

test('locale en F2a erros: em pt-BR e com --json as mensagens seguem as da base', () => {
  const fora = cenario('erros-fora-pt', false);
  try {
    assert.equal(ork(fora, PT, false, 'onboarding').stderr,
      `erro: manifesto orkastery.yaml nao encontrado a partir de ${fora.dir}. Rode: ork init\n`);
    // Comando sem projeto e fora da lista (D2) com LANG=en_US: segue pt-BR. A F3e levou `brain`; `privado` segue fora.
    const privado = ork(fora, EN, false, 'privado');
    assert.equal(privado.status, 2);
    assert.equal(privado.stderr, 'uso: ork privado varrer [--base REF] [--json]\n');
  } finally { fora.limpar(); }
  const c = cenario('erros-pt');
  try {
    for (const locale of [PT, EN]) {
      // pt-BR inteiro; com --json o locale nao e ativado e a mensagem e a da base.
      const json = locale === EN ? ['--json'] : [];
      assert.match(ork(c, locale, false, 'thread', 'new', 'Demo', '--modo', 'auto', '--sem-worktree', '--slug', 'xx', ...json).stderr,
        new RegExp(`^erro: slug invalido: "xx" \\(regex canonica: ${REGEX}`));
      assert.equal(ork(c, locale, false, 'thread', 'new', 'Demo', '--modo', 'auto', '--sem-worktree', '--roadmap', 'RM-999', ...json).stderr,
        'erro: roadmap.item: RM-999 nao existe em docs/roadmap\n');
    }
    assert.equal(ork(c, PT, false, 'thread', 'new', 'Rt', '--modo', 'auto', '--sem-worktree').status, 0);
    assert.equal(ork(c, PT, true, 'phase', 'run', 'loc-rt', 'GOAL', '--prompt', 'x', '--runtime', 'bogus').stderr,
      'erro: runtime de despacho desconhecido: "bogus" (homologados: claude-bg, codex, grok)\n');
    assert.equal(ork(c, PT, true, 'phase', 'run', 'loc-rt', 'GOAL', '--prompt', 'x', '--runtime', 'codex').stderr,
      'erro: setup.model.required: ao trocar runtime de claude-bg para codex, informe --runtime codex --model <modelo> para este despacho; ' +
      'o setup do projeto permanece intacto.\n');
  } finally { c.limpar(); }
});

test('locale en F2a erros: o aviso de preferencia invalida sai inteiro em ingles em experiencia show e no doctor', () => {
  const c = cenario('erros-aviso');
  try {
    fs.appendFileSync(path.join(c.dir, 'orkastery.yaml'), '\nowner:\n  depth: "funda"\n');
    const gravado = 'experiencia.config.invalid: owner.depth exige curta ou detalhada; vale o padrão até corrigir';
    const traduzido = 'experiencia.config.invalid: `owner.depth` requires `curta` or `detalhada`; the default is used for now';
    const show = ork(c, EN, false, 'experiencia', 'show');
    assert.match(show.stdout, new RegExp(`\\nWarning: ${traduzido.replace(/[.`]/g, '\\$&')}; \`ork adapter install\` skips the package ` +
      'until `ork onboarding set maestro` fixes it\\.\\n$'));
    assert.deepEqual(linhasEmPortugues(show.stdout), []);
    // O --json leva o aviso como o manifesto gravou, nas duas linguas.
    assert.deepEqual(JSON.parse(ork(c, EN, false, 'experiencia', 'show', '--json').stdout).avisos, [gravado]);
    assert.ok(ork(c, PT, false, 'experiencia', 'show').stdout.includes(`\nAviso: ${gravado}; o adapter install pula o pacote`));
    const doctor = ork(c, EN, false, 'doctor');
    assert.ok(doctor.stdout.includes(traduzido), doctor.stdout);
    assert.ok(ork(c, PT, false, 'doctor').stdout.includes(gravado));
  } finally { c.limpar(); }
});

test('locale en F2a erros: cada aviso de validarPreferencias tem traducao, e o desconhecido sai inteiro', () => {
  const sufixo = '; vale o padrão até corrigir';
  const entradas: unknown[] = ['x', { language: '!!' }, { timezone: 'Nada/Lugar' }, { depth: 'x' }, { experience: 'x' }];
  for (const entrada of entradas) {
    let aviso = '';
    try { validarPreferencias(entrada); } catch (e) { aviso = (e as Error).message + sufixo; }
    assert.ok(aviso.startsWith('experiencia.config.invalid: '), JSON.stringify(entrada));
    assert.equal(msg('pt-BR').onboarding.avisoDaPreferencia(aviso), aviso);
    const en = msg('en').onboarding.avisoDaPreferencia(aviso);
    assert.notEqual(en, aviso, aviso);
    assert.deepEqual(linhasEmPortugues(en), [], en);
  }
  const outro = 'owner.timezone invalido ("x"): usando o fuso do sistema';
  assert.equal(msg('en').onboarding.avisoDaPreferencia(outro), outro);
});

test('locale en F2a erros: ErroDoCatalogo nasce no locale ativo e a entrada o remonta no locale do comando', () => {
  ativarLocale('en');
  try {
    const e = comLocale('pt-BR', () => new ErroDoCatalogo((m) => m.cli.manifestoNaoEncontrado('a.yaml', '/x')));
    assert.equal(e.message, 'manifesto a.yaml nao encontrado a partir de /x. Rode: ork init');
    assert.equal(mensagemDoErro(e), '`a.yaml` not found in /x or any parent directory; run `ork init` first.');
    assert.equal(comLocale('pt-BR', () => mensagemDoErro(e)), e.message);
    assert.equal(mensagemDoErro(new Error('como veio')), 'como veio');
  } finally { ativarLocale(undefined); }
});
