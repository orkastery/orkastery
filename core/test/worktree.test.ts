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

// ---------------------------------------------------------------------------
// RM-037 (defeitosdeco D-5): o corte de 27/09 reescreveu a `main` com raiz nova. Numa branch sem
// commit proprio, o sync faria `git rebase` de historias sem relacao e reaplicaria a historia antiga
// inteira sobre a base nova, exatamente o que a trava pre-push barra.
// ---------------------------------------------------------------------------

/** Reescreve a `main` do projeto de teste com uma raiz nova, como o corte fez. Devolve o SHA novo. */
function reescreverBase(raiz: string): string {
  const git = (...args: string[]) => { const r = exec('git', args, raiz); assert.equal(r.ok, true, r.stderr); return r.stdout.trim(); };
  git('checkout', '-q', '--orphan', 'base-nova');
  fs.writeFileSync(path.join(raiz, 'raiz-nova.txt'), 'historia nova depois do corte\n');
  git('add', '--', 'raiz-nova.txt');
  git('commit', '-q', '-m', 'raiz nova depois do corte');
  git('branch', '-M', 'base-nova', 'main');
  return git('rev-parse', 'HEAD');
}
const raizes = (dir: string) => exec('git', ['rev-list', '--max-parents=0', 'HEAD'], dir).stdout.trim().split('\n').filter(Boolean);

test('defeitosdeco D-5: branch sem commit proprio sobre base reescrita e recriada na base, sem rebase', () => {
  const p = projetoTemporario('wt-base-reescrita');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'Sem commit proprio', modo: 'auto' });
    const wt = garantirWorktree(p.carregado, thread.id);
    const antes = exec('git', ['rev-parse', 'HEAD'], wt.dir).stdout.trim();
    const raizAntiga = raizes(wt.dir);
    const nova = reescreverBase(p.dir);
    assert.equal(exec('git', ['merge-base', 'HEAD', nova], wt.dir).code, 1, 'as historias nao tem ancestral comum');

    const ensaio = sincronizarWorktree(p.carregado, thread.id, { dryRun: true });
    assert.equal(ensaio.ok, true);
    assert.ok(ensaio.passos.includes(`git reset --keep ${nova}`), ensaio.passos.join(' | '));
    assert.equal(ensaio.passos.some(s => s.startsWith('git rebase ')), false, 'o ensaio nao planeja rebase');
    assert.equal(exec('git', ['rev-parse', 'HEAD'], wt.dir).stdout.trim(), antes, 'o ensaio nao mexe na branch');

    const r = sincronizarWorktree(p.carregado, thread.id);
    assert.equal(r.ok, true, r.detalhe);
    assert.deepEqual([r.recriada, r.rebaseFeito, r.shaAntes, r.shaDepois], [true, false, antes, nova]);
    assert.match(r.detalhe, /branch sem commit proprio recriada a partir da base main atual/);
    assert.deepEqual(raizes(wt.dir), [nova], 'a branch tem so a raiz nova');
    assert.equal(raizes(wt.dir).some(x => raizAntiga.includes(x)), false, 'nada da historia antiga veio junto');
    const evento = lerLedger(dirThread(p.dir, thread.id)).filter(e => e.tipo === 'worktree_synced').at(-1)!;
    assert.deepEqual([evento.recriada, evento.shaAntes, evento.shaDepois, evento.semAncestral], [true, antes, nova, true]);
    assert.equal(sincronizarWorktree(p.carregado, thread.id).jaAtualizada, true, 'o proximo sync ja encontra a base');
  } finally { p.limpar(); }
});

test('defeitosdeco D-5: branch com commit proprio sobre base reescrita fica como esta e recebe o rebase --onto exato', () => {
  const p = projetoTemporario('wt-base-reescrita-propria');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'Com commit proprio', modo: 'auto' });
    const wt = garantirWorktree(p.carregado, thread.id);
    const inicio = lerThread(p.dir, thread.id).base.commit;
    const proprio = commitar(wt.dir, 'da-thread.txt', 'trabalho da thread\n', 'trabalho da thread');
    const nova = reescreverBase(p.dir);

    const r = sincronizarWorktree(p.carregado, thread.id);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'tree.blocked');
    assert.match(r.detalhe, /foi reescrita e nao tem historia em comum com a branch .* que tem 1 commit\(s\) proprio\(s\)/);
    assert.equal(r.correcao, `reaplique so os commits da thread sobre a base nova: git -C ${wt.dir} rebase --onto ${nova} ${inicio}`);
    assert.equal(exec('git', ['rev-parse', 'HEAD'], wt.dir).stdout.trim(), proprio, 'a branch nao foi tocada');
    assert.equal(exec('git', ['status', '--porcelain'], wt.dir).stdout.trim(), '', 'nenhum rebase pela metade');
    // A correcao dita, rodada, reaplica so o commit da thread sobre a raiz nova.
    assert.equal(exec('git', ['-C', wt.dir, 'rebase', '--onto', nova, inicio], wt.dir).ok, true);
    assert.deepEqual(raizes(wt.dir), [nova]);
    assert.equal(exec('git', ['rev-list', '--count', `${nova}..HEAD`], wt.dir).stdout.trim(), '1');
  } finally { p.limpar(); }
});
