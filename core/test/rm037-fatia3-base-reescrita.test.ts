/**
 * RM-037 (fatia 3, defeito 3): `ork worktree sync` rebasava historia que saiu da base reescrita. A D-5
 * (defeitosdeco) cobriu o corte de 27/09, em que a `main` ganhou raiz nova e nao ha ancestral comum. Com
 * ancestral comum (force-push que tirou commits da base), o sync caia no `git rebase <base>` e reaplicava,
 * junto com o commit da thread, o commit que a reescrita tirou. O sinal da reescrita e o ponto de partida
 * da thread fora da base atual: com commit proprio, recusa com o `rebase --onto` exato; sem, recria.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { lerLedger } from '../src/ledger';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { garantirWorktree, sincronizarWorktree } from '../src/worktree';

function git(dir: string, ...args: string[]): string {
  const r = exec('git', args, dir);
  assert.equal(r.ok, true, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A base anda B, X; a thread nasce em X (a base carimbada) e, com `proprio`, ganha o commit T. Depois a
 * `main` e reescrita a partir de B (X sai) com o commit novo Y. B segue ancestral comum dos dois lados.
 */
function cenario(nome: string, proprio: boolean) {
  const p = projetoTemporario(nome);
  commitar(p.dir, 'b.txt', 'ancestral comum\n', 'B, ancestral comum');
  const x = commitar(p.dir, 'x-saiu.txt', 'commit que a reescrita tira da main\n', 'X, sai da main');
  const { thread } = novaThread(p.carregado, { nome: 'base reescrita', modo: 'auto' });
  const wt = garantirWorktree(p.carregado, thread.id);
  assert.equal(lerThread(p.dir, thread.id).base.commit, x, 'a base carimbada e X');
  const t = proprio ? commitar(wt.dir, 'da-thread.txt', 'trabalho da thread\n', 'T, da thread') : x;
  git(p.dir, 'reset', '-q', '--hard', `${x}^`);
  const y = commitar(p.dir, 'y-novo.txt', 'commit novo da main reescrita\n', 'Y, main reescrita');
  assert.equal(exec('git', ['merge-base', t, y], p.dir).ok, true, 'ha ancestral comum: nao e o caso da D-5');
  return { p, thread, wt: wt.dir, x, t, y };
}

test('defeito 3: com commit proprio e ancestral comum, a base reescrita recusa com o rebase --onto exato', () => {
  const { p, thread, wt, x, t, y } = cenario('rm037-f3-reescrita', true);
  try {
    const ensaio = sincronizarWorktree(p.carregado, thread.id, { dryRun: true });
    assert.equal(ensaio.ok, false, 'o ensaio ja diz que o sync real recusaria');
    assert.equal(ensaio.causa, 'base-reescrita');

    const r = sincronizarWorktree(p.carregado, thread.id);
    assert.deepEqual([r.ok, r.rebaseFeito, r.motivo, r.causa], [false, false, 'tree.blocked', 'base-reescrita']);
    assert.match(r.detalhe, new RegExp(`a base main foi reescrita: o ponto de partida ${x.slice(0, 8)} da branch ork/${thread.slug} nao esta mais nela`));
    assert.match(r.detalhe, /reaplicaria 1 commit\(s\) que sairam da base junto com o\(s\) 1 da thread/);
    assert.match(r.detalhe, new RegExp(`git rev-list --count HEAD --not ${x.slice(0, 8)} ${y.slice(0, 8)}`));
    assert.equal(r.correcao, `reaplique so os commits da thread sobre a base nova: git -C ${wt} rebase --onto ${y} ${x}`);
    assert.equal(git(wt, 'rev-parse', 'HEAD'), t, 'a branch nao foi tocada');
    assert.equal(git(wt, 'status', '--porcelain'), '', 'nenhum rebase pela metade');
    const evento = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'worktree_synced').at(-1)!;
    assert.deepEqual([evento.motivo, evento.causa, evento.baseReescrita, evento.pontoDePartida, evento.sairamDaBase, evento.proprios],
      ['tree.blocked', 'base-reescrita', true, x, 1, 1]);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'worktree_synced').length, 1, 'o ensaio nao registra');

    // A correcao dita, rodada, reaplica so o commit da thread: o X que saiu da base nao volta.
    assert.equal(exec('git', ['-C', wt, 'rebase', '--onto', y, x], wt).ok, true);
    assert.deepEqual(git(wt, 'log', '--format=%s', `${y}..HEAD`).split('\n'), ['T, da thread']);
    assert.equal(fs.existsSync(path.join(wt, 'x-saiu.txt')), false);
    assert.equal(sincronizarWorktree(p.carregado, thread.id).jaAtualizada, true, 'depois da correcao o sync ja encontra a base');
  } finally { p.limpar(); }
});

test('defeito 3: sem commit proprio, a base reescrita com ancestral comum recria a branch na base, sem rebase', () => {
  const { p, thread, wt, y } = cenario('rm037-f3-reescrita-sem-proprio', false);
  try {
    const r = sincronizarWorktree(p.carregado, thread.id);
    assert.equal(r.ok, true, r.detalhe);
    assert.deepEqual([r.recriada, r.rebaseFeito, r.shaDepois], [true, false, y]);
    assert.equal(fs.existsSync(path.join(wt, 'x-saiu.txt')), false, 'o X que saiu da base nao ficou na branch');
  } finally { p.limpar(); }
});

test('defeito 3: base que so andou para a frente segue rebasada como antes', () => {
  const p = projetoTemporario('rm037-f3-base-andou');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'base andou', modo: 'auto' });
    const wt = garantirWorktree(p.carregado, thread.id);
    commitar(wt.dir, 'da-thread.txt', 'trabalho da thread\n', 'T, da thread');
    const m = commitar(p.dir, 'base.txt', 'a base andou\n', 'M, base andou');
    const r = sincronizarWorktree(p.carregado, thread.id);
    assert.deepEqual([r.ok, r.rebaseFeito, r.causa], [true, true, undefined]);
    assert.equal(exec('git', ['merge-base', '--is-ancestor', m, 'HEAD'], wt.dir).ok, true);
  } finally { p.limpar(); }
});
