/**
 * RM-037 (fatia 5, A1): o `mergeSha` da branch ja incorporada.
 *
 * Com a branch ja na base, o `ork ship` gravava como `mergeSha` a ponta da base, e nao o merge que a incorporou.
 * Nos ledgers deste projeto, o unico `ship_done` do `ork ship` com `jaIncorporado` (ork-docsusuarios, 27/09/2026)
 * apontava o merge de outra thread, e o leitor do trabalho parado, que compara o `mergeSha` com o do merge
 * `ship(<thread>)`, punha a thread em "falta registrar a entrega". Aqui: o merge de primeiro pai que trouxe a
 * branch vai no `mergeSha` e a ponta vai em `pontaDaBase`; a prova do push e o recibo do Maestro conferem a ponta;
 * e o `ship_done` ja gravado com a ponta cobre o merge que ela contem. Repositorios, threads e PRs SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { registrarEntregaPorPr } from '../src/entrega-pr';
import { lerLedger, registrar } from '../src/ledger';
import { discoverMaestro } from '../src/maestro-discovery';
import { collectMaestroSources } from '../src/maestro-sources';
import { entregasDoProjeto } from '../src/parado-no-condutor';
import { commitQueIncorporou, ship } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { commitar, projetoTemporario, ProjetoDeTeste, shaDaBranch } from './apoio';

const git = (dir: string, ...args: string[]) => {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A thread com worktree e um commit proprio, como o `ork ship` a encontra. */
function threadComEntrega(p: ProjetoDeTeste, nome: string) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true });
  const sha = commitar(thread.worktree as string, `${nome.replace(/\s+/g, '-')}.md`, `# entrega de ${thread.id}\n`, `feat: entrega da thread ${thread.id}`);
  return { thread, sha, branch: git(thread.worktree as string, 'rev-parse', '--abbrev-ref', 'HEAD') };
}

/** O merge `ship(<thread>)` que o GitHub faz no PR, na main do checkout principal. */
function mergeDoPr(p: ProjetoDeTeste, branch: string, thread: string): string {
  git(p.dir, 'merge', '--no-ff', '-q', '-m', `ship(${thread}): merge de ${branch} em main pelo PR`, branch);
  return shaDaBranch(p.dir, 'main');
}

/** Outra thread mescla depois: a base anda alem do merge desta. */
function outraEntrega(p: ProjetoDeTeste, nome: string): string {
  git(p.dir, 'checkout', '-q', '-b', `ork/${nome}`);
  commitar(p.dir, `${nome}.txt`, 'outra entrega SIMULADA\n', `feat: ${nome}`);
  git(p.dir, 'checkout', '-q', 'main');
  git(p.dir, 'merge', '--no-ff', '-q', '-m', `ship(${nome}): merge de ork/${nome} em main pelo PR`, `ork/${nome}`);
  return shaDaBranch(p.dir, 'main');
}

const navioDoMaestro = (p: ProjetoDeTeste, thread: string) =>
  collectMaestroSources(discoverMaestro({ cwd: p.dir })).sections.ship!.items.find((i) => i.id === `ship:${thread}`);

test('A1: com a base andando depois do merge do PR, o ork ship grava o merge que trouxe a branch e a ponta em pontaDaBase', () => {
  const p = projetoTemporario('fatia5-a1-merge', true);
  try {
    const { thread, branch } = threadComEntrega(p, 'entrega incorporada');
    const merge = mergeDoPr(p, branch, thread.id);
    const ponta = outraEntrega(p, 'ork-outra');
    git(p.dir, 'push', '-q', 'origin', 'main');
    assert.equal(commitQueIncorporou(p.dir, shaDaBranch(p.dir, branch), ponta), merge);

    const r = ship(p.carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.deepEqual([r.jaIncorporado, r.mergeSha, r.pontaDaBase, r.shaRemoto, r.pushVerificado], [true, merge, ponta, ponta, true],
      'antes: mergeSha era a ponta, o merge da outra thread');
    const done = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'ship_done')!;
    assert.deepEqual([done.mergeSha, done.pontaDaBase, done.shaRemoto, done.pushVerificado], [merge, ponta, ponta, true]);
    assert.equal(navioDoMaestro(p, thread.id)?.status, 'delivered', 'o recibo do Maestro confere o push contra a ponta');
  } finally { p.limpar(); }
});

test('A1 no fast-forward: a base avancou ate a branch, e o mergeSha e a propria branch', () => {
  const p = projetoTemporario('fatia5-a1-ff', true);
  try {
    const { thread, sha, branch } = threadComEntrega(p, 'entrega por fast-forward');
    git(p.dir, 'merge', '--ff-only', '-q', branch);
    const ponta = commitar(p.dir, 'depois.txt', 'commit depois do fast-forward\n', 'docs: commit SIMULADO depois do fast-forward');
    git(p.dir, 'push', '-q', 'origin', 'main');
    const r = ship(p.carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.deepEqual([r.jaIncorporado, r.mergeSha, r.pontaDaBase, r.pushVerificado], [true, sha, ponta, true]);
  } finally { p.limpar(); }
});

test('A1 no recibo: o registrar-pr grava a ponta, e o Maestro aceita o recibo com a base andando depois do merge', () => {
  const p = projetoTemporario('fatia5-a1-registrar', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'entrega por PR', modo: 'auto' });
    git(p.dir, 'checkout', '-q', '-b', `ork/${thread.id}-full`);
    commitar(p.dir, 'pr.txt', 'feito\n', `feat(${thread.id}): entrega por PR`);
    git(p.dir, 'checkout', '-q', 'main');
    const merge = mergeDoPr(p, `ork/${thread.id}-full`, thread.id);
    const ponta = outraEntrega(p, 'ork-depois');
    git(p.dir, 'push', '-q', 'origin', 'main');
    const r = registrarEntregaPorPr(p.carregado, thread.id);
    assert.equal(r.acao, 'registrou', r.motivo);
    const done = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'ship_done')!;
    assert.deepEqual([done.mergeSha, done.pontaDaBase, done.shaRemoto], [merge, ponta, ponta]);
    assert.equal(navioDoMaestro(p, thread.id)?.status, 'delivered', 'antes: shaRemoto diferente do mergeSha era recibo invalido');

    // O legado sem o campo vale pela regra de antes; o recibo que contradiz a propria ponta continua invalido.
    const legado = novaThread(p.carregado, { nome: 'recibo legado', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, legado.id), legado.id, 'ship_done', { pushVerificado: true, mergeSha: merge, shaRemoto: merge,
      fonteDaProva: 'git ls-remote origin refs/heads/main' });
    assert.equal(navioDoMaestro(p, legado.id)?.status, 'delivered');
    const adulterado = novaThread(p.carregado, { nome: 'recibo adulterado', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, adulterado.id), adulterado.id, 'ship_done', { pushVerificado: true, mergeSha: merge, pontaDaBase: ponta,
      shaRemoto: merge, fonteDaProva: 'git ls-remote origin refs/heads/main' });
    const fontes = collectMaestroSources(discoverMaestro({ cwd: p.dir })).sections.ship!;
    assert.ok(fontes.gaps.includes(`ship.invalid:${adulterado.id}`), JSON.stringify(fontes.gaps));
  } finally { p.limpar(); }
});

test('A1 no leitor: o ship_done ja gravado com a ponta da base cobre o merge ship(<thread>); o merge sem registro continua saindo', () => {
  const p = projetoTemporario('fatia5-a1-leitor', true);
  try {
    // Uma thread por caso, cada uma com a branch e o merge ship(<thread>) do PR na main.
    const caso = (nome: string) => {
      const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
      git(p.dir, 'checkout', '-q', '-b', `ork/${thread.id}-full`);
      commitar(p.dir, `${thread.id}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
      git(p.dir, 'checkout', '-q', 'main');
      return { id: thread.id, head: shaDaBranch(p.dir, `ork/${thread.id}-full`), merge: mergeDoPr(p, `ork/${thread.id}-full`, thread.id) };
    };
    const legado = caso('ship legado com a ponta');
    const semRegistro = caso('merge sem registro');
    const antiga = caso('entrega nova depois do registro');
    // O registro da entrega anterior da terceira thread, e depois uma entrega nova dela, ainda sem registro.
    registrar(dirThread(p.dir, antiga.id), antiga.id, 'ship_done', { shaDe: antiga.head, mergeSha: antiga.merge, jaIncorporado: true });
    git(p.dir, 'checkout', '-q', `ork/${antiga.id}-full`);
    commitar(p.dir, `${antiga.id}-2.txt`, 'mais\n', `feat(${antiga.id}): segunda entrega`);
    git(p.dir, 'checkout', '-q', 'main');
    const novaDaAntiga = mergeDoPr(p, `ork/${antiga.id}-full`, antiga.id);
    const ponta = outraEntrega(p, 'ork-terceira');
    git(p.dir, 'push', '-q', 'origin', 'main');
    // O ship_done como o ork ship gravava antes desta fatia: o mergeSha e a ponta da base, alem do merge da thread.
    registrar(dirThread(p.dir, legado.id), legado.id, 'ship_done', { shaDe: legado.head, mergeSha: ponta, jaIncorporado: true,
      shaRemoto: ponta, pushVerificado: true });

    const quando = new Date(Date.now() + 45 * 60000).toISOString();
    const r = entregasDoProjeto(p.carregado, { quando });
    const linha = (id: string) => r.parados.find((x) => x.thread === id);
    assert.equal(linha(legado.id), undefined, `antes: ${JSON.stringify(linha(legado.id))}`);
    assert.equal(r.estados.find((e) => e.thread === legado.id)?.resumo ?? null, null);
    assert.equal(linha(semRegistro.id)?.caso, 'sem-registro');
    assert.equal(linha(semRegistro.id)?.proximoPasso, `registrar a entrega do merge ${semRegistro.merge.slice(0, 7)} (ork ship registrar-pr ${semRegistro.id})`);
    assert.equal(linha(antiga.id)?.caso, 'sem-registro', 'o registro da entrega anterior nao cobre o merge novo');
    assert.ok(linha(antiga.id)?.proximoPasso.includes(novaDaAntiga.slice(0, 7)));
  } finally { p.limpar(); }
});
