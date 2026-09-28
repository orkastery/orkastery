/** Testes do bloco B2: a worktree como recurso gerenciado (ensure, sync, audit, release). */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { lerLedger } from '../src/ledger';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import {
  auditarWorktree,
  garantirWorktree,
  liberarWorktree,
  registradaNoGit,
  sincronizarWorktree,
} from '../src/worktree';

test('worktree ensure cria a worktree que faltava e e idempotente na segunda vez', () => {
  const p = projetoTemporario('wt-ensure');
  const { thread } = novaThread(p.carregado, { nome: 'Ensure', modo: 'classic' });
  assert.equal(thread.worktree, null);

  const primeira = garantirWorktree(p.carregado, thread.id);
  assert.equal(primeira.ok, true);
  assert.equal(primeira.criada, true);
  assert.equal(primeira.branch, `ork/${thread.slug}`);
  assert.ok(fs.existsSync(primeira.dir), 'a worktree existe no disco');
  assert.ok(registradaNoGit(p.dir, primeira.dir), 'o git conhece a worktree');
  assert.equal(lerThread(p.dir, thread.id).worktree, primeira.dir);

  const segunda = garantirWorktree(p.carregado, thread.id);
  assert.equal(segunda.ok, true);
  assert.equal(segunda.criada, false, 'a segunda chamada nao recria nada');

  const eventos = lerLedger(dirThread(p.dir, thread.id)).filter(
    (e) => e.tipo === 'worktree_ensured'
  );
  assert.equal(eventos.length, 2);
  p.limpar();
});

test('worktree sync rebasa a branch da thread quando a base avancou', () => {
  const p = projetoTemporario('wt-sync');
  const { thread } = novaThread(p.carregado, { nome: 'Sync', modo: 'auto' });
  const wt = garantirWorktree(p.carregado, thread.id);

  // Trabalho da thread na worktree.
  const commitDaThread = commitar(wt.dir, 'thread.txt', 'trabalho da thread\n', 'trabalho');
  // A base andou embaixo da thread, exatamente o caso `base-avancou` do POSTMORTEM.
  const commitDaBase = commitar(p.dir, 'base.txt', 'a base andou\n', 'base avancou');

  const antes = exec('git', ['merge-base', '--is-ancestor', commitDaBase, 'HEAD'], wt.dir);
  assert.equal(antes.ok, false, 'a base ainda NAO estava na branch da thread');

  const ensaio = sincronizarWorktree(p.carregado, thread.id, { dryRun: true });
  assert.equal(ensaio.ok, true);
  assert.equal(ensaio.rebaseFeito, false, 'o ensaio nao rebasa nada');
  assert.ok(ensaio.passos.some((s) => s.startsWith('git rebase ')));

  const r = sincronizarWorktree(p.carregado, thread.id);
  assert.equal(r.ok, true);
  assert.equal(r.rebaseFeito, true);
  assert.equal(r.jaAtualizada, false);
  assert.equal(r.shaBase, commitDaBase);
  assert.equal(r.shaAntes, commitDaThread);
  assert.notEqual(r.shaDepois, r.shaAntes, 'o rebase moveu o HEAD da thread');

  const depois = exec('git', ['merge-base', '--is-ancestor', commitDaBase, 'HEAD'], wt.dir);
  assert.equal(depois.ok, true, 'a base agora e ancestral do HEAD da thread');
  assert.ok(fs.existsSync(path.join(wt.dir, 'base.txt')), 'o arquivo da base veio junto');
  assert.ok(fs.existsSync(path.join(wt.dir, 'thread.txt')), 'o trabalho da thread sobreviveu');

  const denovo = sincronizarWorktree(p.carregado, thread.id);
  assert.equal(denovo.jaAtualizada, true, 'sync com a base ja incorporada nao rebasa de novo');
  assert.equal(denovo.rebaseFeito, false);
  p.limpar();
});

test('worktree sync recusa arvore suja com motivo tipado tree.blocked', () => {
  const p = projetoTemporario('wt-sujo');
  const { thread } = novaThread(p.carregado, { nome: 'Sujo', modo: 'auto' });
  const wt = garantirWorktree(p.carregado, thread.id);
  fs.writeFileSync(path.join(wt.dir, 'nao-commitado.txt'), 'trabalho solto\n');

  const r = sincronizarWorktree(p.carregado, thread.id);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'tree.blocked');
  assert.match(r.correcao, /commite ou guarde/);
  p.limpar();
});

test('worktree audit detecta a divergencia da base e volta a passar depois do sync', () => {
  const p = projetoTemporario('wt-audit');
  const { thread } = novaThread(p.carregado, { nome: 'Audit', modo: 'classic' });
  garantirWorktree(p.carregado, thread.id);

  const limpo = auditarWorktree(p.carregado, thread.id);
  assert.equal(limpo.ok, true, 'worktree recem-criada nao diverge');
  assert.equal(limpo.divergencias, 0);
  assert.ok(limpo.checks.some((c) => c.nome === 'artefatos' && c.nivel === 'ok'));

  commitar(p.dir, 'base.txt', 'a base andou\n', 'base avancou');
  const divergente = auditarWorktree(p.carregado, thread.id);
  assert.equal(divergente.ok, false);
  assert.equal(divergente.divergencias, 1);
  const base = divergente.checks.find((c) => c.nome === 'base');
  assert.equal(base?.nivel, 'fail');
  assert.equal(base?.correcao, `ork worktree sync ${thread.id}`);

  sincronizarWorktree(p.carregado, thread.id);
  assert.equal(auditarWorktree(p.carregado, thread.id).ok, true, 'o sync fecha a divergencia');
  p.limpar();
});

test('worktree audit reprova quando o diretorio sumiu por fora do ork', () => {
  const p = projetoTemporario('wt-sumiu');
  const { thread } = novaThread(p.carregado, { nome: 'Sumiu', modo: 'auto' });
  const wt = garantirWorktree(p.carregado, thread.id);
  fs.rmSync(wt.dir, { recursive: true, force: true });

  const r = auditarWorktree(p.carregado, thread.id);
  assert.equal(r.ok, false);
  assert.ok(r.checks.some((c) => c.nome === 'diretorio' && c.nivel === 'fail'));
  p.limpar();
});

test('worktree release remove a worktree, limpa o registro e recusa arvore suja', () => {
  const p = projetoTemporario('wt-release');
  const { thread } = novaThread(p.carregado, { nome: 'Release', modo: 'auto' });
  const wt = garantirWorktree(p.carregado, thread.id);

  fs.writeFileSync(path.join(wt.dir, 'solto.txt'), 'nao commitado\n');
  const recusa = liberarWorktree(p.carregado, thread.id);
  assert.equal(recusa.ok, false);
  assert.equal(recusa.motivo, 'tree.blocked');
  assert.ok(fs.existsSync(wt.dir), 'a worktree continua la depois da recusa');

  const r = liberarWorktree(p.carregado, thread.id, { forcar: true });
  assert.equal(r.ok, true);
  assert.equal(r.removida, true);
  assert.equal(fs.existsSync(wt.dir), false);
  assert.equal(registradaNoGit(p.dir, wt.dir), false, 'sumiu de `git worktree list`');
  assert.equal(lerThread(p.dir, thread.id).worktree, null);

  // A branch sobrevive, e o ensure seguinte a reusa em vez de criar outra.
  const branch = exec('git', ['rev-parse', '--verify', `refs/heads/${r.branch}`], p.dir);
  assert.equal(branch.ok, true);
  const denovo = garantirWorktree(p.carregado, thread.id);
  assert.equal(denovo.criada, true);
  assert.equal(denovo.branch, r.branch);
  p.limpar();
});
