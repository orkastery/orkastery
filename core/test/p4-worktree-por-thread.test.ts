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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { init } from '../src/init';
import { lerLedger } from '../src/ledger';
import { exigirManifesto } from '../src/manifest';
import {
  avisoDaWorktree, avisoDeChaveSemCommit, avisoDeThreadSemWorktree, dirThread, linhaDaWorktree, listarIds, novaThread, pedidoDeWorktree,
} from '../src/thread';
import { COMMIT_DESCONHECIDO, exec } from '../src/util';
import { ajustarManifesto, dirTemporario, projetoTemporario, shaDaBranch } from './apoio';

const LINHA_DA_CHAVE = '  worktree: criada pela chave worktree.por_thread do orkastery.yaml; para criar sem ela, use --sem-worktree';

function eventoDe(raiz: string, id: string, tipo: string): Record<string, unknown> | undefined {
  return lerLedger(dirThread(raiz, id)).find((e) => e.tipo === tipo) as Record<string, unknown> | undefined;
}

function branchExiste(raiz: string, branch: string): boolean {
  return exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`], raiz).ok;
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

    // A flag explicita segue com o erro do git de antes, sem gravar nada.
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
    const outraBranch = avisoDeThreadSemWorktree({ ...thread, base: { ...thread.base, branch: 'tarefa' } }, m);
    assert.equal(outraBranch, `Aviso: thread ${thread.id} sem worktree (--sem-worktree): ela trabalha na raiz do projeto, na branch tarefa, ` +
      `e o ork ship entrega essa branch como estiver, com o que mais entrar nela. ${correcao}`);

    assert.equal(avisoDaWorktree('sem-worktree', { thread, gravada: true, worktreePor: null }, m), barra);
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
