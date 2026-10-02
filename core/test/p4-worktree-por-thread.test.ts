/**
 * P4 do ensaio da 0.5.0 (thread ork-p4worktreepo): `worktree.por_thread` passa a valer no `ork thread new`.
 *
 * Com a chave verdadeira, a thread nasce com a worktree e a branch dela sem `--worktree auto`; com a chave falsa ou
 * ausente, nada muda; `--sem-worktree` cria sem ela e diz o que isso faz no SHIP; o `--dry-run` mostra a worktree
 * que seria criada. Os nomes comecam por "p4 worktree:" para que cada claim rode so o seu.
 *
 * A CLI roda com HOME temporario e so PATH e LANG no ambiente, como no ensaio-050: `thread new` registra o projeto
 * em `~/.orkastery/projetos.json`, e o teste nao pode tocar no HOME de quem roda.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { registrarAchadoDaRodada, rodarAuditoria, verificarRodada } from '../src/auditrun';
import { init } from '../src/init';
import { lerLedger } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import { avaliarPolicies } from '../src/policies';
import {
  avisoDaWorktree, avisoDeChaveSemCommit, avisoDeThreadSemWorktree, avisoDeWorktreeQueFalharia, dirThread, lerThread, linhaDaWorktree,
  listarIds, novaThread, pedidoDeWorktree,
} from '../src/thread';
import { COMMIT_DESCONHECIDO, exec } from '../src/util';
import { ajustarManifesto, commitar, dirTemporario, ProjetoDeTeste, projetoTemporario, shaDaBranch } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

const LINHA_DA_CHAVE = '  worktree: criada pela chave worktree.por_thread do orkastery.yaml; para criar sem ela, use --sem-worktree';

function eventoDe(raiz: string, id: string, tipo: string): Record<string, unknown> | undefined {
  return lerLedger(dirThread(raiz, id)).find((e) => e.tipo === tipo) as Record<string, unknown> | undefined;
}

function branchExiste(raiz: string, branch: string): boolean {
  return exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`], raiz).ok;
}

/** A CLI do HEAD, com HOME proprio e sem as variaveis de quem roda o teste. */
function ork(dir: string, casa: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { HOME: casa, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', ORK_FABRICA_PUBLICAR: '0' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function limpar(...dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** A thread `id` nasceu na raiz do projeto, como antes do P4: sem worktree, sem branch e sem a linha da chave. */
function nasceuNaRaiz(p: ProjetoDeTeste, r: { status: number | null; stdout: string; stderr: string }, id: string, slug: string): void {
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /  base      main @ [0-9a-f]{8}\n  worktree  \(raiz do projeto\)\n/);
  assert.doesNotMatch(r.stdout, /  worktree: /);
  assert.doesNotMatch(r.stderr, /worktree/);
  assert.equal(branchExiste(p.dir, `ork/${slug}`), false, `branch ork/${slug}`);
  assert.equal(fs.existsSync(path.join(p.dir, '.claude/worktrees', id)), false);
  assert.equal(lerThread(p.dir, id).worktree, null);
  assert.equal(eventoDe(p.dir, id, 'worktree_created'), undefined);
}

test('p4 worktree: manifesto le a chave ausente como false', () => {
  const p = projetoTemporario('p4-manifesto');
  try {
    assert.equal(p.carregado.manifesto.worktree.por_thread, true, 'o modelo do ork init grava a chave verdadeira');
    ajustarManifesto(p, /\n  por_thread: true/, '\n  por_thread: false');
    assert.equal(p.carregado.manifesto.worktree.por_thread, false, 'chave falsa');
    ajustarManifesto(p, /\n  por_thread: false/, '');
    assert.equal(p.carregado.manifesto.worktree.por_thread, false, 'chave ausente');
    assert.equal(p.carregado.manifesto.worktree.dir, '.claude/worktrees', 'o resto do bloco segue lido');
    ajustarManifesto(p, /\nworktree:\n(?:  .*\n)+/, '\n');
    assert.equal(p.carregado.manifesto.worktree.por_thread, false, 'bloco worktree ausente');
    assert.equal(p.carregado.manifesto.worktree.base_branch, 'main');
    fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), '\nworktree:\n  por_thread: "sim"\n');
    assert.equal(exigirManifesto(p.dir).manifesto.worktree.por_thread, false, 'valor que nao e booleano YAML vale o padrao');
  } finally { p.limpar(); }
});

test('p4 worktree: pedido resolve flags e chave', () => {
  assert.deepEqual(pedidoDeWorktree({}, true), { criar: true, dir: null, origem: 'chave' });
  assert.deepEqual(pedidoDeWorktree({}, false), { criar: false, dir: null, origem: 'nenhuma' });
  for (const chave of [true, false]) {
    assert.deepEqual(pedidoDeWorktree({ worktree: 'auto' }, chave), { criar: true, dir: null, origem: 'flag' });
    assert.deepEqual(pedidoDeWorktree({ worktree: true }, chave), { criar: true, dir: null, origem: 'flag' });
    assert.deepEqual(pedidoDeWorktree({ worktree: 'outra/pasta' }, chave), { criar: false, dir: 'outra/pasta', origem: 'diretorio' });
    assert.deepEqual(pedidoDeWorktree({ semWorktree: true }, chave), { criar: false, dir: null, origem: 'sem-worktree' });
  }
  assert.throws(() => pedidoDeWorktree({ worktree: 'auto', semWorktree: true }, true), /^Error: uso: --worktree e --sem-worktree se excluem/);
  assert.throws(() => pedidoDeWorktree({ worktree: 'outra/pasta', semWorktree: true }, false), /se excluem/);
  assert.throws(() => pedidoDeWorktree({ semWorktree: 'nome' }, true), /uso: --sem-worktree não leva valor \(recebeu "nome"\)/);
  for (const vazio of ['', '  ']) {
    assert.throws(() => pedidoDeWorktree({ worktree: vazio }, true), /^Error: uso: --worktree pede auto ou um diretório que já existe$/);
  }
});

test('p4 worktree: previsao do dry-run e a criacao usam a mesma pasta e branch', () => {
  const p = projetoTemporario('p4-previsao');
  try {
    const base = shaDaBranch(p.dir, 'main');
    const dir = path.join(p.dir, '.claude/worktrees/ork-prevista');
    const simulada = novaThread(p.carregado, { nome: 'prevista', modo: 'auto', criarWorktree: true, origemDaWorktree: 'chave', dryRun: true });
    assert.equal(simulada.gravada, false);
    assert.equal(simulada.worktreePor, 'chave');
    assert.equal(simulada.thread.worktree, dir);
    assert.deepEqual(simulada.thread.base, { branch: 'ork/ork-prevista-full', commit: base });
    assert.equal(fs.existsSync(dir), false, 'o ensaio nao cria a worktree');
    assert.equal(branchExiste(p.dir, 'ork/ork-prevista-full'), false, 'nem a branch');
    assert.deepEqual(listarIds(p.dir), [], 'nem a thread');

    const criada = novaThread(p.carregado, { nome: 'prevista', modo: 'auto', criarWorktree: true, origemDaWorktree: 'chave' });
    assert.equal(criada.worktreePor, 'chave');
    assert.equal(criada.thread.worktree, simulada.thread.worktree);
    assert.deepEqual(criada.thread.base, simulada.thread.base);
    assert.equal(eventoDe(p.dir, criada.thread.id, 'worktree_created')?.origem, 'chave');
    assert.equal(eventoDe(p.dir, criada.thread.id, 'thread_created')?.semWorktree, undefined);

    const pelaFlag = novaThread(p.carregado, { nome: 'pela flag', modo: 'auto', criarWorktree: true });
    assert.equal(pelaFlag.worktreePor, 'flag');
    assert.equal(eventoDe(p.dir, pelaFlag.thread.id, 'worktree_created')?.origem, 'flag');

    // Ciclo merge-branch: a previsao parte da branch que ja existe, como o `git worktree add` faria.
    exec('git', ['branch', 'tarefa-antiga'], p.dir);
    const doCiclo = novaThread(p.carregado, { nome: 'do ciclo', modo: 'auto', variante: 'merge-branch', branch: 'tarefa-antiga', dryRun: true });
    assert.equal(doCiclo.worktreePor, 'ciclo');
    assert.equal(doCiclo.thread.worktree, path.join(p.dir, '.claude/worktrees/ork-dociclo'));
    assert.deepEqual(doCiclo.thread.base, { branch: 'tarefa-antiga', commit: base });

    const naRaiz = novaThread(p.carregado, { nome: 'na raiz', modo: 'auto', dryRun: true });
    assert.equal(naRaiz.worktreePor, null);
    assert.equal(naRaiz.thread.worktree, null);
    assert.deepEqual(naRaiz.thread.base, { branch: 'main', commit: base });
  } finally { p.limpar(); }
});

test('p4 worktree: sem commit a chave deixa a thread na raiz', () => {
  const dir = dirTemporario('p4-sem-commit');
  try {
    exec('git', ['init', '-q', '-b', 'main'], dir);
    init(dir, { nome: 'orkastery', abbrev: 'ork' });
    const carregado = exigirManifesto(dir);
    assert.equal(carregado.manifesto.worktree.por_thread, true);

    const simulada = novaThread(carregado, { nome: 'sem commit', modo: 'auto', criarWorktree: true, origemDaWorktree: 'chave', dryRun: true });
    assert.equal(simulada.worktreePor, null);
    assert.equal(simulada.thread.worktree, null);
    assert.equal(avisoDaWorktree('chave', simulada, carregado.manifesto), avisoDeChaveSemCommit(false));

    const criada = novaThread(carregado, { nome: 'sem commit', modo: 'auto', criarWorktree: true, origemDaWorktree: 'chave' });
    assert.equal(criada.gravada, true);
    assert.equal(criada.worktreePor, null);
    assert.equal(criada.thread.worktree, null);
    assert.equal(criada.thread.base.commit, COMMIT_DESCONHECIDO);
    assert.equal(fs.existsSync(path.join(dir, '.claude/worktrees')), false);
    assert.equal(eventoDe(dir, criada.thread.id, 'worktree_created'), undefined);
    assert.equal(avisoDaWorktree('chave', criada, carregado.manifesto),
      'Aviso: worktree.por_thread pede a worktree da thread, mas o repositório ainda não tem commit: ' +
      'a thread nasceu na raiz do projeto, sem worktree.');

    // A flag explicita segue com o erro do git de antes, sem gravar nada; o ensaio diz que a criacao recusaria.
    const ensaioDaFlag = novaThread(carregado, { nome: 'com flag', modo: 'auto', criarWorktree: true, dryRun: true });
    assert.equal(ensaioDaFlag.worktreePor, null);
    assert.equal(ensaioDaFlag.thread.worktree, null);
    assert.deepEqual(ensaioDaFlag.worktreeFalharia,
      { motivo: 'sem-commit', dir: path.join(dir, '.claude/worktrees/ork-comflag'), branch: 'ork/ork-comflag-full', por: 'flag' });
    assert.throws(() => novaThread(carregado, { nome: 'com flag', modo: 'auto', criarWorktree: true }), /git worktree add falhou/);
    assert.deepEqual(listarIds(dir), [criada.thread.id]);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('p4 worktree: ciclo que exige worktree recusa --sem-worktree', () => {
  const p = projetoTemporario('p4-ciclo');
  try {
    exec('git', ['branch', 'tarefa-antiga'], p.dir);
    const casos = [
      { variante: 'greenfield' as const },
      { variante: 'feature-xl-faseada' as const },
      { variante: 'merge-branch' as const, branch: 'tarefa-antiga' },
    ];
    for (const caso of casos) {
      for (const dryRun of [true, false]) {
        assert.throws(
          () => novaThread(p.carregado, { nome: `ciclo ${caso.variante}`, modo: 'classic', ...caso, origemDaWorktree: 'sem-worktree', dryRun }),
          new RegExp(`o ciclo ${caso.variante} exige worktree isolada: crie a thread sem --sem-worktree ou escolha outro ciclo`));
      }
    }
    assert.deepEqual(listarIds(p.dir), [], 'a recusa sai antes de gravar');
    assert.equal(fs.existsSync(path.join(p.dir, '.claude/worktrees')), false);

    // O ciclo que nao exige worktree aceita a saida explicita, e o rastro diz que ela foi pedida.
    const gap = novaThread(p.carregado, { nome: 'gap sem', modo: 'classic', variante: 'gap', origemDaWorktree: 'sem-worktree' });
    assert.equal(gap.thread.worktree, null);
    assert.equal(gap.worktreePor, null);
    assert.equal(eventoDe(p.dir, gap.thread.id, 'thread_created')?.semWorktree, true);
    // Sem a flag, o ciclo cria a worktree como antes, e a origem e o ciclo.
    const greenfield = novaThread(p.carregado, { nome: 'greenfield ok', modo: 'classic', variante: 'greenfield' });
    assert.equal(greenfield.worktreePor, 'ciclo');
    assert.ok(greenfield.thread.worktree);
    assert.equal(eventoDe(p.dir, greenfield.thread.id, 'worktree_created')?.origem, 'ciclo');
  } finally { p.limpar(); }
});

test('p4 worktree: aviso do --sem-worktree diz o que acontece no ship', () => {
  const p = projetoTemporario('p4-aviso');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sem worktree', modo: 'auto', origemDaWorktree: 'sem-worktree' });
    const m = p.carregado.manifesto;
    assert.equal(m.policies?.push_direto_na_base, 'block', 'o modelo do ork init barra o push direto na base');
    const correcao = `Antes do GO, ork worktree ensure ${thread.id} cria a worktree e a branch da thread; ` +
      'depois do GO, os commits já estão na base e o ship não os separa.';
    const barra = avisoDeThreadSemWorktree(thread, m);
    assert.equal(barra, `Aviso: thread ${thread.id} sem worktree (--sem-worktree): ela trabalha na raiz do projeto, na branch base main, ` +
      `e o ork ship barra a entrega por push_direto_na_base (block): não há branch de thread para mergear. ${correcao}`);
    assert.match(avisoDeThreadSemWorktree(thread, { ...m, policies: { ...m.policies, push_direto_na_base: 'warn' } }),
      /, e o ork ship avisa push_direto_na_base \(warn\) e empurra a base direto, sem branch de thread\. Antes do GO/);
    const desligada = avisoDeThreadSemWorktree(thread, { ...m, policies: { ...m.policies, push_direto_na_base: 'off' } });
    assert.match(desligada, /, e o ork ship empurra a base direto, sem branch de thread \(push_direto_na_base desligada\)\. Antes do GO/);
    assert.equal(avisoDeThreadSemWorktree(thread, { ...m, policies: undefined }), desligada);
    const ensure = `Antes do GO, ork worktree ensure ${thread.id} cria a worktree e a branch da thread.`;
    const outraBranch = avisoDeThreadSemWorktree({ ...thread, base: { ...thread.base, branch: 'tarefa' } }, m);
    assert.equal(outraBranch, `Aviso: thread ${thread.id} sem worktree (--sem-worktree): ela trabalha na raiz do projeto, na branch tarefa, ` +
      'e o ork ship entrega essa branch como estiver, com o que mais entrar nela; com --para tarefa, a entrega vira push direto, ' +
      `que a policy push_direto_na_base confere. ${ensure}`);
    assert.doesNotMatch(outraBranch, /depois do GO/, 'fora da base, os commits ficam na branch da raiz');
    assert.equal(avisoDeThreadSemWorktree({ ...thread, base: { ...thread.base, branch: 'HEAD' } }, m),
      `Aviso: thread ${thread.id} sem worktree (--sem-worktree): ela trabalha na raiz do projeto, com o HEAD destacado, fora de qualquer ` +
      `branch, e o ork ship não tem branch de origem para entregar. ${ensure}`);
    assert.equal(avisoDeThreadSemWorktree({ ...thread, base: { branch: 'desconhecida', commit: COMMIT_DESCONHECIDO } }, m),
      `Aviso: thread ${thread.id} sem worktree (--sem-worktree): ela trabalha na raiz do projeto, num repositório ainda sem commit, ` +
      'fora de qualquer branch, e o ork ship não tem branch de origem para entregar. Faça o primeiro commit e siga o aviso de thread sem base.',
      'sem commit, nem o ensure tem de onde partir');
    assert.equal(avisoDeThreadSemWorktree(thread, m, false), barra.replace(
      `Aviso: thread ${thread.id} sem worktree (--sem-worktree): ela trabalha`,
      `Aviso: sem worktree (--sem-worktree), a thread ${thread.id} trabalharia`), 'o ensaio fala da thread que nasceria');

    assert.equal(avisoDaWorktree('sem-worktree', { thread, gravada: true, worktreePor: null }, m), barra);
    assert.equal(avisoDaWorktree('sem-worktree', { thread, gravada: false, worktreePor: null }, m), avisoDeThreadSemWorktree(thread, m, false));
    const pasta = { dir: 'pasta/da/thread', branch: 'ork/thread-full' };
    assert.equal(avisoDeWorktreeQueFalharia({ motivo: 'pasta-existe', ...pasta, por: 'chave' }),
      'Aviso: a pasta pasta/da/thread já existe, e a criação de verdade recusaria a worktree da thread: tire a pasta ou crie com --sem-worktree.');
    assert.equal(avisoDeWorktreeQueFalharia({ motivo: 'branch-existe', ...pasta, por: 'flag' }),
      'Aviso: a branch ork/thread-full já existe, e a criação de verdade recusaria a worktree da thread: tire a branch ou crie com --sem-worktree.');
    assert.equal(avisoDeWorktreeQueFalharia({ motivo: 'pasta-existe', ...pasta, por: 'ciclo' }),
      'Aviso: a pasta pasta/da/thread já existe, e a criação de verdade recusaria a worktree da thread: tire a pasta.', 'o ciclo recusa --sem-worktree');
    assert.equal(avisoDeWorktreeQueFalharia({ motivo: 'sem-commit', ...pasta, por: 'flag' }),
      'Aviso: o repositório ainda não tem commit, e a criação de verdade recusaria a worktree da thread no git worktree add: faça o primeiro commit antes.');
    for (const origem of ['flag', 'chave', 'diretorio', 'nenhuma'] as const) {
      assert.equal(avisoDaWorktree(origem, { thread, gravada: true, worktreePor: origem === 'flag' || origem === 'chave' ? origem : null }, m), null, origem);
    }

    assert.equal(linhaDaWorktree('chave', true), LINHA_DA_CHAVE);
    assert.equal(linhaDaWorktree('chave', false),
      '  worktree: seria criada pela chave worktree.por_thread do orkastery.yaml; para criar sem ela, use --sem-worktree');
    assert.equal(linhaDaWorktree('flag', false), '  worktree: seria criada pelo --worktree auto');
    assert.equal(linhaDaWorktree('ciclo', false, 'greenfield'), '  worktree: seria criada pelo ciclo greenfield, que exige worktree isolada');
    for (const por of ['flag', 'ciclo'] as const) assert.equal(linhaDaWorktree(por, true, 'greenfield'), null, `criacao por ${por} sai como antes`);
    assert.equal(linhaDaWorktree(null, false), null);
  } finally { p.limpar(); }
});

test('p4 worktree: chave verdadeira cria a worktree sem flag', () => {
  const p = projetoTemporario('p4-cli-verdadeira');
  const casa = dirTemporario('p4-cli-verdadeira-casa');
  try {
    const base = shaDaBranch(p.dir, 'main');
    const r = ork(p.dir, casa, 'thread', 'new', 'pela chave', '--modo', 'auto');
    assert.equal(r.status, 0, r.stderr);
    const dir = path.join(p.dir, '.claude/worktrees/ork-pelachave');
    assert.ok(r.stdout.includes(`  base      ork/ork-pelachave-full @ ${base.slice(0, 8)}\n  worktree  ${dir}\n`), r.stdout);
    assert.ok(r.stdout.includes(`\n${LINHA_DA_CHAVE}\n  estado: .orkastery/threads/ork-pelachave/thread.json\n`), r.stdout);
    assert.doesNotMatch(r.stderr, /Aviso/);
    const lista = exec('git', ['worktree', 'list', '--porcelain'], p.dir).stdout;
    assert.ok(lista.includes(`worktree ${dir}\n`), lista);
    assert.ok(lista.includes('branch refs/heads/ork/ork-pelachave-full\n'), lista);
    assert.deepEqual(lerThread(p.dir, 'ork-pelachave').base, { branch: 'ork/ork-pelachave-full', commit: base });
    assert.equal(lerThread(p.dir, 'ork-pelachave').worktree, dir);
    assert.equal(eventoDe(p.dir, 'ork-pelachave', 'worktree_created')?.origem, 'chave');
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: chave falsa nao cria worktree', () => {
  const p = projetoTemporario('p4-cli-falsa');
  const casa = dirTemporario('p4-cli-falsa-casa');
  try {
    ajustarManifesto(p, /\n  por_thread: true/, '\n  por_thread: false');
    nasceuNaRaiz(p, ork(p.dir, casa, 'thread', 'new', 'chave falsa', '--modo', 'auto'), 'ork-chavefalsa', 'ork-chavefalsa-full');
    const simulada = ork(p.dir, casa, 'thread', 'new', 'simulada', '--modo', 'auto', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.match(simulada.stdout, /  worktree  \(raiz do projeto\)\n/);
    assert.doesNotMatch(simulada.stdout, /  worktree: /);
    assert.equal(fs.existsSync(path.join(p.dir, '.claude/worktrees')), false);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: chave ausente nao cria worktree', () => {
  const p = projetoTemporario('p4-cli-ausente');
  const casa = dirTemporario('p4-cli-ausente-casa');
  try {
    ajustarManifesto(p, /\n  por_thread: true/, '');
    nasceuNaRaiz(p, ork(p.dir, casa, 'thread', 'new', 'chave ausente', '--modo', 'auto'), 'ork-chaveausente', 'ork-chaveausente-full');
    ajustarManifesto(p, /\nworktree:\n(?:  .*\n)+/, '\n');
    nasceuNaRaiz(p, ork(p.dir, casa, 'thread', 'new', 'bloco ausente', '--modo', 'auto'), 'ork-blocoausente', 'ork-blocoausente-full');
    assert.equal(fs.existsSync(path.join(p.dir, '.claude/worktrees')), false);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: --sem-worktree cria sem worktree e avisa o ship', () => {
  const p = projetoTemporario('p4-cli-sem');
  const casa = dirTemporario('p4-cli-sem-casa');
  try {
    const r = ork(p.dir, casa, 'thread', 'new', 'sem worktree', '--modo', 'auto', '--sem-worktree');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /  base      main @ [0-9a-f]{8}\n  worktree  \(raiz do projeto\)\n/);
    assert.doesNotMatch(r.stdout, /  worktree: /);
    assert.ok(r.stderr.includes('Aviso: thread ork-semworktree sem worktree (--sem-worktree): ela trabalha na raiz do projeto, ' +
      'na branch base main, e o ork ship barra a entrega por push_direto_na_base (block): não há branch de thread para mergear. ' +
      'Antes do GO, ork worktree ensure ork-semworktree cria a worktree e a branch da thread; ' +
      'depois do GO, os commits já estão na base e o ship não os separa.\n'), r.stderr);
    assert.equal(fs.existsSync(path.join(p.dir, '.claude/worktrees')), false);
    assert.equal(eventoDe(p.dir, 'ork-semworktree', 'thread_created')?.semWorktree, true);

    // O que o aviso diz e o que a policy faz com as entradas que o ship usa (origem = branch da thread).
    const thread = lerThread(p.dir, 'ork-semworktree');
    const violacoes = avaliarPolicies(p.carregado.manifesto,
      { gate: 'ship', de: thread.base.branch, para: 'main', baseBranch: 'main', threadId: thread.id });
    assert.ok(violacoes.some((v) => v.policy === 'push_direto_na_base' && v.severidade === 'block'), JSON.stringify(violacoes));

    // A correcao do aviso vale antes do GO.
    const ensure = ork(p.dir, casa, 'worktree', 'ensure', 'ork-semworktree');
    assert.equal(ensure.status, 0, ensure.stdout + ensure.stderr);
    assert.equal(lerThread(p.dir, 'ork-semworktree').worktree, path.join(p.dir, '.claude/worktrees/ork-semworktree'));

    const simulada = ork(p.dir, casa, 'thread', 'new', 'simulada sem', '--modo', 'auto', '--sem-worktree', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.match(simulada.stdout, /  worktree  \(raiz do projeto\)\n/);
    assert.match(simulada.stderr, /^Aviso: sem worktree \(--sem-worktree\), a thread ork-simuladasem trabalharia na raiz do projeto, na branch base main/m);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: flags explicitas continuam valendo', () => {
  const p = projetoTemporario('p4-cli-flags');
  const casa = dirTemporario('p4-cli-flags-casa');
  const existente = dirTemporario('p4-cli-flags-existente');
  try {
    ajustarManifesto(p, /\n  por_thread: true/, '\n  por_thread: false');
    const auto = ork(p.dir, casa, 'thread', 'new', 'pela flag', '--modo', 'auto', '--worktree', 'auto');
    assert.equal(auto.status, 0, auto.stderr);
    assert.ok(auto.stdout.includes(`  worktree  ${path.join(p.dir, '.claude/worktrees/ork-pelaflag')}\n`), auto.stdout);
    assert.doesNotMatch(auto.stdout, /  worktree: /, 'quem pediu a flag sabe de onde veio a worktree');
    assert.ok(branchExiste(p.dir, 'ork/ork-pelaflag-full'));
    assert.equal(eventoDe(p.dir, 'ork-pelaflag', 'worktree_created')?.origem, 'flag');

    ajustarManifesto(p, /\n  por_thread: false/, '\n  por_thread: true');
    const reusa = ork(p.dir, casa, 'thread', 'new', 'reusa dir', '--modo', 'auto', '--worktree', existente);
    assert.equal(reusa.status, 0, reusa.stderr);
    assert.ok(reusa.stdout.includes(`  worktree  ${existente}\n`), reusa.stdout);
    assert.match(reusa.stdout, /  base      main @ /);
    assert.doesNotMatch(reusa.stdout, /  worktree: /);
    assert.equal(branchExiste(p.dir, 'ork/ork-reusadir-full'), false, 'a chave nao cria worktree por cima do --worktree DIR');
    assert.equal(eventoDe(p.dir, 'ork-reusadir', 'worktree_created'), undefined);

    const ambos = ork(p.dir, casa, 'thread', 'new', 'ambos', '--modo', 'auto', '--worktree', 'auto', '--sem-worktree');
    assert.equal(ambos.status, 2);
    assert.match(ambos.stderr, /^uso: --worktree e --sem-worktree se excluem; use um dos dois$/m);
    const comValor = ork(p.dir, casa, 'thread', 'new', 'com valor', '--modo', 'auto', '--sem-worktree', 'extra');
    assert.equal(comValor.status, 2);
    assert.match(comValor.stderr, /uso: --sem-worktree não leva valor \(recebeu "extra"\)/);
    const ciclo = ork(p.dir, casa, 'thread', 'new', 'ciclo sem', '--modo', 'classic', '--ciclo', 'greenfield', '--sem-worktree');
    assert.equal(ciclo.status, 2);
    assert.match(ciclo.stderr, /^uso: o ciclo greenfield exige worktree isolada: crie a thread sem --sem-worktree ou escolha outro ciclo$/m);
    // A recusa do ciclo sai antes da reserva do roadmap: sem remoto, a reserva diria roadmap.sem-remoto.
    const comRoadmap = ork(p.dir, casa, 'thread', 'new', 'ciclo com item', '--modo', 'classic', '--ciclo', 'greenfield',
      '--sem-worktree', '--roadmap', 'RM-001');
    assert.equal(comRoadmap.status, 2, comRoadmap.stderr);
    assert.match(comRoadmap.stderr, /^uso: o ciclo greenfield exige worktree isolada/m);
    assert.doesNotMatch(comRoadmap.stderr, /roadmap\./);
    for (const vazio of ['--worktree=', '--worktree=  ']) {
      const r = ork(p.dir, casa, 'thread', 'new', 'vazio', '--modo', 'auto', vazio);
      assert.equal(r.status, 2, `${vazio}: ${r.stderr}`);
      assert.match(r.stderr, /^uso: --worktree pede auto ou um diretório que já existe$/m);
    }
    assert.deepEqual(listarIds(p.dir), ['ork-pelaflag', 'ork-reusadir'], 'as recusas nao gravam thread');
  } finally { p.limpar(); limpar(casa, existente); }
});

test('p4 worktree: --dry-run mostra a worktree prevista', () => {
  const p = projetoTemporario('p4-cli-dryrun');
  const casa = dirTemporario('p4-cli-dryrun-casa');
  try {
    const base = shaDaBranch(p.dir, 'main').slice(0, 8);
    const dir = path.join(p.dir, '.claude/worktrees/ork-prevista');
    const simulada = ork(p.dir, casa, 'thread', 'new', 'prevista', '--modo', 'auto', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.ok(simulada.stdout.startsWith('Simulacao (--dry-run), nada foi gravado.\n'), simulada.stdout);
    assert.ok(simulada.stdout.includes(`  base      ork/ork-prevista-full @ ${base}\n  worktree  ${dir}\n`), simulada.stdout);
    assert.ok(simulada.stdout.includes(
      '\n  worktree: seria criada pela chave worktree.por_thread do orkastery.yaml; para criar sem ela, use --sem-worktree\n'), simulada.stdout);
    assert.equal(fs.existsSync(dir), false);
    assert.equal(branchExiste(p.dir, 'ork/ork-prevista-full'), false);
    assert.deepEqual(listarIds(p.dir), []);

    // A criacao de verdade usa a pasta e a branch que o ensaio mostrou.
    const criada = ork(p.dir, casa, 'thread', 'new', 'prevista', '--modo', 'auto');
    assert.equal(criada.status, 0, criada.stderr);
    assert.ok(criada.stdout.includes(`  base      ork/ork-prevista-full @ ${base}\n  worktree  ${dir}\n`), criada.stdout);

    ajustarManifesto(p, /\n  por_thread: true/, '\n  por_thread: false');
    const pelaFlag = ork(p.dir, casa, 'thread', 'new', 'outra prevista', '--modo', 'auto', '--worktree', 'auto', '--dry-run');
    assert.equal(pelaFlag.status, 0, pelaFlag.stderr);
    assert.ok(pelaFlag.stdout.includes(`  worktree  ${path.join(p.dir, '.claude/worktrees/ork-outraprevist')}\n`), pelaFlag.stdout);
    assert.ok(pelaFlag.stdout.includes('\n  worktree: seria criada pelo --worktree auto\n'), pelaFlag.stdout);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: sem commit pelo CLI a thread nasce na raiz com os dois avisos', () => {
  const dir = dirTemporario('p4-cli-sem-commit');
  const casa = dirTemporario('p4-cli-sem-commit-casa');
  try {
    exec('git', ['init', '-q', '-b', 'main'], dir);
    assert.equal(ork(dir, casa, 'init').status, 0);
    const simulada = ork(dir, casa, 'thread', 'new', 'primeira', '--modo', 'auto', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.match(simulada.stdout, /  worktree  \(raiz do projeto\)\n/);
    assert.doesNotMatch(simulada.stdout, /  worktree: /);
    assert.ok(simulada.stderr.includes(`${avisoDeChaveSemCommit(false)}\n`), simulada.stderr);

    const pelaFlag = ork(dir, casa, 'thread', 'new', 'pela flag', '--modo', 'auto', '--worktree', 'auto', '--dry-run');
    assert.equal(pelaFlag.status, 0, pelaFlag.stderr);
    assert.match(pelaFlag.stdout, /  worktree  \(raiz do projeto\)\n/);
    assert.doesNotMatch(pelaFlag.stdout, /  worktree: /);
    assert.ok(pelaFlag.stderr.includes('Aviso: o repositório ainda não tem commit, e a criação de verdade recusaria a worktree da thread ' +
      'no git worktree add: faça o primeiro commit antes.\n'), pelaFlag.stderr);

    const criada = ork(dir, casa, 'thread', 'new', 'primeira', '--modo', 'auto');
    assert.equal(criada.status, 0, criada.stderr);
    assert.match(criada.stdout, /  worktree  \(raiz do projeto\)\n/);
    const chave = criada.stderr.indexOf(avisoDeChaveSemCommit(true));
    const semBase = criada.stderr.indexOf('nasceu sem base');
    assert.ok(chave >= 0 && semBase > chave, `aviso da chave antes do aviso de sem base:\n${criada.stderr}`);
    assert.equal(fs.existsSync(path.join(dir, '.claude/worktrees')), false);
  } finally { limpar(dir, casa); }
});

test('p4 worktree: achado segue a chave e aceita --sem-worktree', () => {
  const p = projetoTemporario('p4-cli-achado');
  const casa = dirTemporario('p4-cli-achado-casa');
  try {
    commitar(p.dir, 'src/dupe.ts', 'export const a = 1;\nexport const a2 = 1;\n', 'duplicacao');
    const rodada = rodarAuditoria(p.carregado, 'reuse', { quando: new Date(2026, 8, 3, 2, 30), dryRun: true });
    const achado = (titulo: string) => registrarAchadoDaRodada(p.carregado, rodada.id, {
      regra: 'RU1', severidade: 'maior', titulo, arquivo: 'src/dupe.ts:2',
      alegacao: 'src/dupe.ts declara o mesmo valor duas vezes', verificar: ['grep -q "export const a2" src/dupe.ts'],
      impacto: 'duas fontes de verdade', fix: 'manter uma constante so', irreversivel: 'nenhum', estimativa: '1h',
    });
    const primeiro = achado('utilitario duplicado');
    const segundo = achado('outro utilitario duplicado');
    assert.equal(verificarRodada(p.carregado, rodada.id).ok, true);

    const conflito = ork(p.dir, casa, 'thread', 'new', 'conflito', '--from-finding', primeiro.id, '--worktree', 'auto', '--sem-worktree');
    assert.equal(conflito.status, 2);
    assert.match(conflito.stderr, /uso: --worktree e --sem-worktree se excluem/);

    const pelaChave = ork(p.dir, casa, 'thread', 'new', 'tirar duplicacao', '--from-finding', primeiro.id, '--modo', 'classic');
    assert.equal(pelaChave.status, 0, pelaChave.stderr);
    assert.ok(pelaChave.stdout.includes(`\n${LINHA_DA_CHAVE}\n`), pelaChave.stdout);
    const id = /  id        (\S+)\n/.exec(pelaChave.stdout)?.[1] ?? '';
    assert.equal(lerThread(p.dir, id).worktree, path.join(p.dir, '.claude/worktrees', id));
    assert.equal(eventoDe(p.dir, id, 'worktree_created')?.origem, 'chave');

    const sem = ork(p.dir, casa, 'thread', 'new', 'outra sem', '--from-finding', segundo.id, '--modo', 'classic', '--sem-worktree');
    assert.equal(sem.status, 0, sem.stderr);
    assert.match(sem.stdout, /  worktree  \(raiz do projeto\)\n/);
    assert.match(sem.stderr, /^Aviso: thread \S+ sem worktree \(--sem-worktree\): ela trabalha na raiz do projeto, na branch base main/m);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: modelo do init documenta a chave', () => {
  const p = projetoTemporario('p4-modelo');
  try {
    const yaml = fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8');
    const bloco = /\nworktree:\n((?:  .*\n)+)/.exec(yaml)?.[1] ?? '';
    assert.equal(bloco,
      `  base_branch: "main"\n  dir: ".claude/worktrees"\n` +
      '  # true: o ork thread new cria a worktree e a branch da thread sem flag (--sem-worktree cria sem);\n' +
      '  # false ou ausente: só com --worktree auto\n' +
      '  por_thread: true\n');
  } finally { p.limpar(); }
});

test('p4 worktree: docs e ajuda dizem o comportamento novo', () => {
  const RAIZ = path.resolve(__dirname, '../../..');
  const ler = (arquivo: string): string => fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');

  const quickstart = ler('docs/comecar/quickstart.md');
  assert.match(quickstart, /\n  por_thread: true +# o ork thread new cria a worktree da thread sem flag; --sem-worktree cria sem\n/);
  assert.ok(quickstart.includes('\nork thread new "corrigir o filtro de data do relatorio" --modo classic\n'));
  assert.ok(quickstart.includes(`\n${LINHA_DA_CHAVE}\n  estado: .orkastery/threads/prd-corrigirofil/thread.json\n`));
  const passo4 = quickstart.slice(quickstart.indexOf('## 4.'), quickstart.indexOf('## 5.'));
  for (const trecho of ['grava `worktree.por_thread: true`', 'com a chave `false` ou ausente, a worktree só nasce com',
    'O `--dry-run` mostra a worktree que seria criada', '`--sem-worktree`', '`push_direto_na_base`']) {
    assert.ok(passo4.replace(/\s+/g, ' ').includes(trecho), `quickstart, passo 4: ${trecho}`);
  }

  const modos = ler('docs/guias/modos.md');
  const secao = modos.slice(modos.indexOf('\n## A worktree da thread\n'), modos.indexOf('\n## Uma thread começa a partir de um achado\n'));
  assert.ok(secao.length > 100, 'guia de modos: secao da worktree antes da thread que nasce de um achado');
  for (const trecho of ['`worktree.por_thread: true`', 'Com a chave `false` ou ausente, nada muda', '`--worktree auto`',
    '`--worktree <DIR>`', '`--sem-worktree`', '`ork worktree ensure <thread>`', '`--dry-run`',
    '`greenfield`, `merge-branch` e `feature-xl-faseada` exigem a worktree e recusam `--sem-worktree`']) {
    assert.ok(secao.replace(/\s+/g, ' ').includes(trecho), `guia de modos: ${trecho}`);
  }

  assert.ok(secao.includes('`push_direto_na_base: block`, o padrão do `ork init`'), 'guia de modos: o bloqueio depende da policy');

  // A amostra do doctor diz o tamanho do manifesto que o `ork init` do passo 3 grava; o comentario da chave o mudou.
  const novo = dirTemporario('p4-docs-manifesto');
  try {
    exec('git', ['init', '-q', '-b', 'main'], novo);
    init(novo, { nome: 'meu-produto', abbrev: 'prd' });
    const bytes = fs.statSync(path.join(novo, 'orkastery.yaml')).size;
    assert.ok(quickstart.includes(`/caminho/do/seu/projeto/orkastery.yaml (${bytes} B de 16384)`), `quickstart: manifesto com ${bytes} B`);
  } finally { limpar(novo); }

  const cli = ler('docs/referencia/cli.md');
  assert.ok(cli.includes('A pasta é a da árvore principal, mesmo com o comando rodando de dentro de outra worktree'));
  assert.ok(cli.includes('`[--slug S] [--assunto A] [--worktree auto\\|DIR] [--sem-worktree] [--ciclo C] [--dry-run]`'));
  assert.ok(cli.includes('| ↳ worktree | Com `worktree.por_thread: true`, o que o `ork init` grava, a thread nasce com a worktree'));
  assert.ok(cli.includes('a worktree segue a mesma regra do `ork thread new`, com `--worktree auto` e `--sem-worktree` |'));
  assert.ok(ler('docs/produto/FEAT-001-thread-e-seis-fases.md').includes(
    'Com `worktree.por_thread: true` (o que o `ork init` grava) ou com `--worktree auto`, a thread ganha uma worktree'));
  assert.ok(ler('docs/produto/FEAT-007-worktree-e-leases.md').includes(
    'thread criada com `worktree.por_thread: true` (sem flag) ou com `--worktree auto`, ou depois por `ork worktree ensure`'));

  const casa = dirTemporario('p4-ajuda-casa');
  try {
    const ajuda = ork(casa, casa, '--help');
    assert.equal(ajuda.status, 0, ajuda.stderr);
    assert.ok(ajuda.stdout.includes(
      '        [--sem-worktree]                         cria sem worktree (na branch base, o ship barra a entrega com\n' +
      '                                                 push_direto_na_base: block, o padrão do ork init); com\n' +
      '                                                 worktree.por_thread: true, a worktree nasce sem flag\n'), ajuda.stdout);
    assert.ok(ajuda.stdout.includes('        [--modo M] [--worktree auto] [--sem-worktree] [--dry-run]\n'), ajuda.stdout);
  } finally { limpar(casa); }
});

test('p4 worktree: thread nova de dentro de outra worktree nasce na arvore principal', () => {
  const p = projetoTemporario('p4-cli-aninhada');
  const casa = dirTemporario('p4-cli-aninhada-casa');
  try {
    // Manifesto commitado: a worktree da mae tem o proprio orkastery.yaml, e o ork rodado nela acha a raiz ali.
    exec('git', ['add', '--', 'orkastery.yaml'], p.dir);
    assert.ok(exec('git', ['commit', '-q', '-m', 'ork init'], p.dir).ok);
    const mae = ork(p.dir, casa, 'thread', 'new', 'thread mae', '--modo', 'auto');
    assert.equal(mae.status, 0, mae.stderr);
    const dirMae = path.join(p.dir, '.claude/worktrees/ork-threadmae');
    assert.ok(fs.existsSync(path.join(dirMae, 'orkastery.yaml')));

    const dirFilha = path.join(p.dir, '.claude/worktrees/ork-threadfilha');
    const simulada = ork(dirMae, casa, 'thread', 'new', 'thread filha', '--modo', 'auto', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.ok(simulada.stdout.includes(`  worktree  ${dirFilha}\n`), simulada.stdout);
    const filha = ork(dirMae, casa, 'thread', 'new', 'thread filha', '--modo', 'auto');
    assert.equal(filha.status, 0, filha.stderr);
    assert.ok(filha.stdout.includes(`  worktree  ${dirFilha}\n`), filha.stdout);
    assert.equal(lerThread(p.dir, 'ork-threadfilha').worktree, dirFilha);
    assert.equal(fs.existsSync(path.join(dirMae, '.claude/worktrees')), false, 'nada aninhado na pasta da mae');

    // O release da mae nao leva o trabalho da filha.
    fs.writeFileSync(path.join(dirFilha, 'trabalho.txt'), 'da filha\n');
    const release = ork(p.dir, casa, 'worktree', 'release', 'ork-threadmae');
    assert.equal(release.status, 0, release.stdout + release.stderr);
    assert.equal(fs.readFileSync(path.join(dirFilha, 'trabalho.txt'), 'utf8'), 'da filha\n');
    assert.ok(exec('git', ['worktree', 'list', '--porcelain'], p.dir).stdout.includes(`worktree ${dirFilha}\n`));
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: --dry-run diz quando a criacao recusaria a worktree', () => {
  const p = projetoTemporario('p4-cli-recusaria');
  const casa = dirTemporario('p4-cli-recusaria-casa');
  try {
    // Id ocupado: o ensaio mostra o id livre que a criacao usaria, e a worktree dele.
    assert.equal(ork(p.dir, casa, 'thread', 'new', 'prevista', '--modo', 'auto').status, 0);
    const segunda = ork(p.dir, casa, 'thread', 'new', 'prevista', '--modo', 'auto', '--dry-run');
    assert.equal(segunda.status, 0, segunda.stderr);
    assert.match(segunda.stdout, /  id        ork-prevista2\n/);
    assert.ok(segunda.stdout.includes(`  worktree  ${path.join(p.dir, '.claude/worktrees/ork-prevista2')}\n`), segunda.stdout);
    assert.match(segunda.stdout, /  base      ork\/ork-prevista2-full @ /);

    // Pasta da worktree ja existe: o ensaio avisa em vez de prever, e a criacao recusa dizendo que a chave pediu.
    const orfa = path.join(p.dir, '.claude/worktrees/ork-orfa');
    fs.mkdirSync(orfa, { recursive: true });
    const ensaioOrfa = ork(p.dir, casa, 'thread', 'new', 'orfa', '--modo', 'auto', '--dry-run');
    assert.equal(ensaioOrfa.status, 0, ensaioOrfa.stderr);
    assert.match(ensaioOrfa.stdout, /  worktree  \(raiz do projeto\)\n/);
    assert.doesNotMatch(ensaioOrfa.stdout, /  worktree: /);
    assert.ok(ensaioOrfa.stderr.includes(`Aviso: a pasta ${orfa} já existe, e a criação de verdade recusaria a worktree da thread: ` +
      'tire a pasta ou crie com --sem-worktree.\n'), ensaioOrfa.stderr);
    const criadaOrfa = ork(p.dir, casa, 'thread', 'new', 'orfa', '--modo', 'auto');
    assert.equal(criadaOrfa.status, 1);
    assert.ok(criadaOrfa.stderr.includes(`a pasta ${orfa} já existe, e a chave worktree.por_thread pede a worktree da thread: ` +
      'tire-a ou crie com --sem-worktree'), criadaOrfa.stderr);
    assert.equal(listarIds(p.dir).includes('ork-orfa'), false, 'a recusa nao grava a thread');
    assert.equal(ork(p.dir, casa, 'thread', 'new', 'orfa', '--modo', 'auto', '--sem-worktree').status, 0, 'a saida explicita passa');

    // Branch da worktree ja existe: o mesmo, pela branch.
    exec('git', ['branch', 'ork/ork-ocupada-full'], p.dir);
    const ensaioBranch = ork(p.dir, casa, 'thread', 'new', 'ocupada', '--modo', 'auto', '--dry-run');
    assert.ok(ensaioBranch.stderr.includes('Aviso: a branch ork/ork-ocupada-full já existe, e a criação de verdade recusaria a worktree ' +
      'da thread: tire a branch ou crie com --sem-worktree.\n'), ensaioBranch.stderr);
    const criadaBranch = ork(p.dir, casa, 'thread', 'new', 'ocupada', '--modo', 'auto');
    assert.equal(criadaBranch.status, 1);
    assert.ok(criadaBranch.stderr.includes('a branch ork/ork-ocupada-full já existe, e a chave worktree.por_thread pede a worktree da ' +
      'thread: tire-a ou crie com --sem-worktree'), criadaBranch.stderr);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: ciclo que exige worktree vence a chave e a flag na origem', () => {
  const p = projetoTemporario('p4-cli-ciclo-chave');
  const casa = dirTemporario('p4-cli-ciclo-chave-casa');
  try {
    // Com a chave ligada, o ciclo e quem exige a worktree: nada de sugerir o --sem-worktree que ele recusa.
    const simulada = ork(p.dir, casa, 'thread', 'new', 'novo app', '--modo', 'classic', '--ciclo', 'greenfield', '--dry-run');
    assert.equal(simulada.status, 0, simulada.stderr);
    assert.ok(simulada.stdout.includes('\n  worktree: seria criada pelo ciclo greenfield, que exige worktree isolada\n'), simulada.stdout);
    const criada = ork(p.dir, casa, 'thread', 'new', 'novo app', '--modo', 'classic', '--ciclo', 'greenfield');
    assert.equal(criada.status, 0, criada.stderr);
    assert.doesNotMatch(criada.stdout + criada.stderr, /--sem-worktree/);
    assert.equal(eventoDe(p.dir, 'ork-novoapp', 'worktree_created')?.origem, 'ciclo');
    const pelaFlag = ork(p.dir, casa, 'thread', 'new', 'outro app', '--modo', 'classic', '--ciclo', 'feature-xl-faseada', '--worktree', 'auto');
    assert.equal(pelaFlag.status, 0, pelaFlag.stderr);
    assert.equal(eventoDe(p.dir, 'ork-outroapp', 'worktree_created')?.origem, 'ciclo');

    fs.mkdirSync(path.join(p.dir, '.claude/worktrees/ork-terceiroapp'), { recursive: true });
    const ocupada = ork(p.dir, casa, 'thread', 'new', 'terceiro app', '--modo', 'classic', '--ciclo', 'greenfield', '--dry-run');
    assert.ok(ocupada.stderr.includes(`Aviso: a pasta ${path.join(p.dir, '.claude/worktrees/ork-terceiroapp')} já existe, ` +
      'e a criação de verdade recusaria a worktree da thread: tire a pasta.\n'), ocupada.stderr);
  } finally { p.limpar(); limpar(casa); }
});

test('p4 worktree: thread nova de uma worktree fora da arvore principal deixa a pasta das worktrees fora do git', () => {
  const p = projetoTemporario('p4-cli-fora');
  const casa = dirTemporario('p4-cli-fora-casa');
  const fora = dirTemporario('p4-cli-fora-wt');
  try {
    exec('git', ['add', '--', 'orkastery.yaml'], p.dir);
    assert.ok(exec('git', ['commit', '-q', '-m', 'ork init'], p.dir).ok);
    const manual = path.join(fora, 'manual');
    assert.ok(exec('git', ['worktree', 'add', '-q', '-b', 'manual', manual], p.dir).ok);
    assert.equal(fs.existsSync(path.join(p.dir, '.claude')), false);

    const r = ork(manual, casa, 'thread', 'new', 'de fora', '--modo', 'auto');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`  worktree  ${path.join(p.dir, '.claude/worktrees/ork-defora')}\n`), r.stdout);
    assert.ok(fs.existsSync(path.join(p.dir, '.claude/worktrees/.gitignore')), 'a pasta das worktrees nasce fora do git da arvore principal');
    assert.equal(exec('git', ['status', '--porcelain'], p.dir).stdout.trim(), '');
  } finally { p.limpar(); limpar(casa, fora); }
});
