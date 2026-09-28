/** Testes do bloco B2: variantes de ciclo em `ork thread new --ciclo`. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { aplicarVariante, ORDEM_DAS_VARIANTES, parseVariante, VARIANTES } from '../src/ciclos';
import { lerLedger } from '../src/ledger';
import { MODOS } from '../src/modos';
import { dirThread, novaThread, pausasDaThread } from '../src/thread';
import { exec } from '../src/util';

test('as 5 variantes de ciclo sao parseadas e so elas', () => {
  assert.equal(ORDEM_DAS_VARIANTES.length, 5);
  for (const v of ORDEM_DAS_VARIANTES) assert.equal(parseVariante(v), v);
  assert.equal(parseVariante('GOAL-PLAN'), 'goal-plan');
  assert.equal(parseVariante('inventada'), null);
  assert.equal(parseVariante(undefined), null);
  assert.equal(VARIANTES['merge-branch'].exigeBranch, true);
});

test('ciclo goal-plan combina GOAL e PLAN num bloco so e tira uma pausa', () => {
  const p = projetoTemporario('ciclo-goalplan');

  // #Classic separa GOAL e PLAN em dois blocos, com duas pausas.
  const semVariante = novaThread(p.carregado, { nome: 'Sem Variante', modo: 'classic' }).thread;
  assert.deepEqual(semVariante.blocos.map((b) => b.fases.join('-')), [
    'GOAL',
    'PLAN',
    'GO-CHECK',
    'SHIP-MASTER',
  ]);
  assert.equal(pausasDaThread(semVariante), 3);
  assert.equal(semVariante.slug.endsWith('-goal'), true);

  const { thread } = novaThread(p.carregado, {
    nome: 'Com Variante',
    modo: 'classic',
    variante: 'goal-plan',
  });
  assert.equal(thread.variante, 'goal-plan');
  assert.deepEqual(thread.blocos[0].fases, ['GOAL', 'PLAN']);
  assert.equal(thread.blocos[0].pausa, true);
  assert.equal(thread.blocos[0].pausaSobre, 'premissas');
  assert.equal(thread.blocos[0].slugFases, 'f12');
  assert.deepEqual(thread.blocos.map((b) => b.fases.join('-')), [
    'GOAL-PLAN',
    'GO-CHECK',
    'SHIP-MASTER',
  ]);
  assert.equal(pausasDaThread(thread), 2, 'a fusao economiza exatamente uma pausa');
  assert.equal(thread.slug.endsWith('-f12'), true, 'o slug segue o bloco fundido');
  assert.equal(thread.faseAtual, 'GOAL');
  assert.deepEqual(thread.fases, ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER']);

  const evento = lerLedger(dirThread(p.dir, thread.id))[0];
  assert.equal(evento.variante, 'goal-plan');
  assert.equal(evento.pausas, 2);

  // Em #Ork o GOAL e o PLAN ja moram juntos: a variante e idempotente.
  const idempotente = aplicarVariante(MODOS.ork.blocos, 'goal-plan');
  assert.deepEqual(
    idempotente.map((b) => b.fases.join('-')),
    MODOS.ork.blocos.map((b) => b.fases.join('-'))
  );
  p.limpar();
});

test('ciclo merge-branch parte de uma branch que ja existe, sem criar branch nova', () => {
  const p = projetoTemporario('ciclo-merge');
  exec('git', ['branch', 'feature/carrinho'], p.dir);
  exec('git', ['switch', 'feature/carrinho'], p.dir);
  const commitDaFeature = commitar(p.dir, 'feature.txt', 'feature em andamento\n', 'feature');
  exec('git', ['switch', 'main'], p.dir);

  const { thread } = novaThread(p.carregado, {
    nome: 'Retomada',
    modo: 'classic',
    variante: 'merge-branch',
    branch: 'feature/carrinho',
  });

  assert.equal(thread.variante, 'merge-branch');
  assert.equal(thread.base.branch, 'feature/carrinho', 'a base carimbada e a branch existente');
  assert.equal(thread.base.commit, commitDaFeature);
  assert.ok(thread.worktree, 'merge-branch exige worktree isolada');
  assert.ok(fs.existsSync(path.join(thread.worktree as string, 'feature.txt')));

  const emCheckOut = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], thread.worktree as string);
  assert.equal(emCheckOut.stdout.trim(), 'feature/carrinho');
  const branchNova = exec('git', ['rev-parse', '--verify', `refs/heads/ork/${thread.slug}`], p.dir);
  assert.equal(branchNova.ok, false, 'nenhuma branch nova foi criada');
  p.limpar();
});

test('merge-branch sem --branch, e --branch inexistente, reprovam na criacao', () => {
  const p = projetoTemporario('ciclo-merge-erro');
  assert.throws(
    () => novaThread(p.carregado, { nome: 'Sem Branch', modo: 'classic', variante: 'merge-branch' }),
    /informe --branch/
  );
  assert.throws(
    () =>
      novaThread(p.carregado, {
        nome: 'Branch Fantasma',
        modo: 'classic',
        variante: 'merge-branch',
        branch: 'nao-existe',
      }),
    /nao existe neste repositorio/
  );
  assert.throws(
    () => novaThread(p.carregado, { nome: 'Solta', modo: 'classic', branch: 'main' }),
    /--branch so vale com --ciclo merge-branch/
  );
  p.limpar();
});

test('ciclo gap publica a lacuna: sem GO e sem SHIP no ciclo da thread', () => {
  const p = projetoTemporario('ciclo-gap');
  const { thread } = novaThread(p.carregado, {
    nome: 'Lacuna',
    modo: 'maestro',
    variante: 'gap',
  });
  assert.deepEqual(thread.fases, ['GOAL', 'PLAN', 'CHECK', 'MASTER']);
  assert.deepEqual(thread.blocos.map((b) => b.fases.join('-')), ['GOAL-PLAN', 'CHECK', 'MASTER']);
  assert.equal(thread.fases.includes('GO'), false);
  assert.equal(thread.fases.includes('SHIP'), false);
  p.limpar();
});

test('ciclos greenfield e feature-xl-faseada nascem com worktree isolada', () => {
  const p = projetoTemporario('ciclo-green');
  const green = novaThread(p.carregado, {
    nome: 'Do Zero',
    modo: 'auto',
    variante: 'greenfield',
  }).thread;
  assert.ok(green.worktree, 'greenfield exige worktree isolada');
  assert.equal(green.base.branch, `ork/${green.slug}`);

  const xl = novaThread(p.carregado, {
    nome: 'Feature XL',
    modo: 'classic',
    variante: 'feature-xl-faseada',
    fatias: 4,
  }).thread;
  assert.equal(xl.fatias, 4);
  assert.ok(xl.worktree);

  const padrao = novaThread(p.carregado, {
    nome: 'XL Padrao',
    modo: 'classic',
    variante: 'feature-xl-faseada',
  }).thread;
  assert.equal(padrao.fatias, 3, 'o padrao de fatias e 3');
  p.limpar();
});
