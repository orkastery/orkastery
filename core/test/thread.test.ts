/** Testes de criacao de thread, ledger e montagem de prompt de fase (sem despachar nada). */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { lerLedger } from '../src/ledger';
import { hashDoPrompt, montarPrompt, rodarFase, slugDaSessao } from '../src/phase';
import { criarWorktree, dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { receiveCreationOperation } from '../src/creation-operation-store';

function projetoTemporario(nome: string) {
  const bruto = fs.mkdtempSync(path.join(os.tmpdir(), `ork-test-${nome}-`));
  const dir = fs.realpathSync(bruto);
  exec('git', ['init', '-b', 'main'], dir);
  exec('git', ['config', 'user.email', 'teste@orkastery.local'], dir);
  exec('git', ['config', 'user.name', 'Teste Orkastery'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), '# projeto de teste\n');
  exec('git', ['add', '-A'], dir);
  exec('git', ['commit', '-m', 'inicial'], dir);
  init(dir, { nome: 'orkastery', abbrev: 'ork' });
  return { dir, carregado: exigirManifesto(dir) };
}

test('thread reservada é idempotente e rejeita ID fora do journal', () => {
  const { dir, carregado } = projetoTemporario('thread-reserved');
  try {
    const op = receiveCreationOperation(dir, 'fixture', { key: 'thread-reserve-001', action: 'open_ticket', entityId: 'proj-fixture', expectedEntityVersion: 1,
      request: 'Ensaio', doneWhen: ['verde'], workspaceIds: [], mode: 'auto' }, 'ork');
    const options = { nome: 'Reservada', modo: 'auto' as const, reservation: { operationId: op.operationId, principal: op.principal, threadId: op.reserved.threadIds[0] } };
    const first = novaThread(carregado, options);
    assert.equal(first.thread.id, options.reservation.threadId);
    assert.equal(novaThread(carregado, options).gravada, false);
    assert.deepEqual(novaThread(carregado, options).thread, first.thread);
    assert.equal(lerLedger(dirThread(dir, first.thread.id)).length, 1);
    assert.throws(() => novaThread(carregado, { ...options, reservation: { ...options.reservation, threadId: 'ork-foreign' } }), /creation.conflict/);
    assert.throws(() => novaThread(carregado, { ...options, nome: 'Outra' }), /creation.conflict/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('thread new gera slug de 3 partes, carimba a base e abre o ledger', () => {
  const { dir, carregado } = projetoTemporario('thread');
  const { thread } = novaThread(carregado, { nome: 'Core B0', modo: 'auto' });

  assert.equal(thread.id, 'ork-coreb0');
  assert.equal(thread.slug, 'ork-coreb0-full');
  assert.equal(thread.modo, 'auto');
  assert.equal(thread.faseAtual, 'GOAL');
  assert.equal(thread.status, 'aberta');
  assert.equal(thread.base.branch, 'main');
  assert.match(thread.base.commit, /^[0-9a-f]{40}$/);
  assert.ok(fs.existsSync(path.join(dir, '.orkastery/threads/ork-coreb0/thread.json')));

  const eventos = lerLedger(dirThread(dir, thread.id));
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, 'thread_created');
  assert.equal(eventos[0].pausas, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ids colidentes ganham sufixo em vez de sobrescrever a thread anterior', () => {
  const { dir, carregado } = projetoTemporario('colisao');
  const a = novaThread(carregado, { nome: 'checkout', modo: 'classic' }).thread;
  const b = novaThread(carregado, { nome: 'checkout', modo: 'classic' }).thread;
  assert.equal(a.id, 'ork-checkout');
  assert.equal(b.id, 'ork-checkout2');
  assert.notEqual(a.slug, b.slug);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('modo fora de allowed_modes reprova na criacao da thread', () => {
  const { dir, carregado } = projetoTemporario('allowed');
  carregado.manifesto.conduction.allowed_modes = ['classic', 'maestro'];
  assert.throws(
    () => novaThread(carregado, { nome: 'perigoso', modo: 'auto' }),
    /fora de conduction.allowed_modes/
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('o prompt da fase carrega nomenclatura, modo e regra de pausa', () => {
  const { dir, carregado } = projetoTemporario('prompt');
  const { thread } = novaThread(carregado, { nome: 'checkout', modo: 'classic' });

  const promptPlan = montarPrompt(thread, 'PLAN', 'Refatorar o carrinho');
  assert.ok(promptPlan.includes('fase PLAN'));
  assert.ok(promptPlan.includes('#Classic'));
  assert.ok(promptPlan.includes('HA PAUSA humana sobre: plano'));
  assert.ok(promptPlan.includes('GOAL (F1)'));
  assert.ok(promptPlan.includes('MASTER (F6)'));
  assert.ok(promptPlan.includes('Refatorar o carrinho'));
  assert.ok(promptPlan.includes(thread.base.commit));

  // I-43: `#Ork` dava a metade "GO pausa", e nenhum modo VIVO pausa em GO. As duas
  // metades da regra continuam provadas pelo par que `#Classic` oferece: PLAN fecha
  // um bloco que pausa, GO vive dentro de GO-CHECK e nao pausa.
  const promptGo = montarPrompt(thread, 'GO', 'Implementar');
  assert.ok(promptGo.includes('NAO ha pausa humana'));
  assert.notEqual(hashDoPrompt(promptGo), hashDoPrompt(promptPlan));
  assert.match(hashDoPrompt(promptGo), /^[0-9a-f]{64}$/);

  const classica = novaThread(carregado, { nome: 'carrinho', modo: 'classic' }).thread;
  const goSemPausa = montarPrompt(classica, 'GO', 'Implementar');
  assert.ok(goSemPausa.includes('#Classic'));
  assert.ok(goSemPausa.includes('NAO ha pausa humana'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('phase run --dry-run grava o prompt com hash e nao despacha nem toca no ledger', () => {
  const { dir, carregado } = projetoTemporario('dryrun');
  const { thread } = novaThread(carregado, { nome: 'checkout', modo: 'classic' });

  const r = rodarFase(carregado, thread.id, {
    fase: 'GOAL',
    prompt: 'Mapear o objetivo do checkout',
    dryRun: true,
  });

  assert.equal(r.dryRun, true);
  assert.equal(r.sessionId, null);
  assert.equal(r.slug, 'ork-checkout-goal');
  assert.equal(r.pausaAoFim, true);
  assert.ok(fs.existsSync(r.promptPath));
  assert.equal(hashDoPrompt(fs.readFileSync(r.promptPath, 'utf8')), r.promptSha256);
  assert.deepEqual(r.comando.slice(0, 2), ['claude', '--bg']);
  assert.equal(r.comando[3], '--name');
  assert.equal(r.comando[4], 'ork-checkout-goal');
  // Nada alem do thread_created foi para o ledger, e a thread nao registrou sessao.
  assert.deepEqual(lerLedger(dirThread(dir, thread.id)).map((e) => e.tipo), ['thread_created']);
  assert.equal(lerThread(dir, thread.id).sessoes.length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('o slug da sessao segue o bloco do modo e rotaciona quando repete', () => {
  const { dir, carregado } = projetoTemporario('slugsessao');
  const { thread } = novaThread(carregado, { nome: 'checkout', modo: 'classic' });

  assert.equal(slugDaSessao(thread, 'GOAL'), 'ork-checkout-goal');
  assert.equal(slugDaSessao(thread, 'GO'), 'ork-checkout-f34');
  assert.equal(slugDaSessao(thread, 'SHIP'), 'ork-checkout-f56');

  thread.sessoes.push({
    slug: 'ork-checkout-f34',
    fase: 'GO',
    bloco: 'GO-CHECK',
    sessionId: 'abcdef12',
    runtime: 'claude-bg',
    despachadaEm: new Date().toISOString(),
    promptPath: 'x',
    promptSha256: 'y',
    verificada: true,
  });
  assert.equal(slugDaSessao(thread, 'CHECK'), 'ork-checkout-f34-2');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('thread com worktree isolada cria e verifica a worktree no proprio git', () => {
  const { dir, carregado } = projetoTemporario('worktree');
  const { thread } = novaThread(carregado, {
    nome: 'paralelo a',
    modo: 'maestro',
    criarWorktree: true,
  });

  assert.ok(thread.worktree, 'a thread aponta para a worktree criada');
  assert.equal(thread.worktree, path.join(dir, '.claude/worktrees', thread.id));
  assert.ok(fs.existsSync(thread.worktree as string));
  assert.equal(thread.base.branch, `ork/${thread.slug}`);

  // A worktree existe de fato no git, nao so no thread.json.
  const lista = exec('git', ['worktree', 'list', '--porcelain'], dir).stdout;
  assert.ok(lista.includes(`worktree ${thread.worktree}`));

  // Duas threads em paralelo nao colidem: cada uma na sua worktree e no seu branch.
  const b = novaThread(carregado, { nome: 'paralelo b', modo: 'classic', criarWorktree: true }).thread;
  assert.notEqual(b.worktree, thread.worktree);
  assert.notEqual(b.base.branch, thread.base.branch);

  // O ledger registra a criacao com a fonte da verificacao.
  const eventos = lerLedger(dirThread(dir, thread.id));
  const criacao = eventos.find((e) => e.tipo === 'worktree_created');
  assert.ok(criacao);
  assert.equal(criacao.fonte, 'git worktree list --porcelain');

  // Criar de novo no mesmo caminho reprova em vez de sobrescrever.
  assert.throws(() => criarWorktree(carregado, thread.id, thread.slug), /worktree ja existe/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('I-42: thread #Fast nasce so com a GO, um bloco sem pausa e slug terminando em -go', () => {
  const { dir, carregado } = projetoTemporario('thread-fast');
  try {
    const { thread } = novaThread(carregado, { nome: 'typo no readme', modo: 'fast' });
    assert.deepEqual(thread.fases, ['GO']);
    assert.equal(thread.blocos.length, 1);
    assert.equal(thread.blocos[0].pausa, false);
    assert.equal(thread.faseAtual, 'GO');
    assert.match(thread.slug, /-go$/);
    const criada = lerLedger(dirThread(dir, thread.id)).find((e) => e.tipo === 'thread_created');
    assert.equal(criada?.pausas, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('I-42: --ciclo que redesenha blocos e recusado no modo de bloco unico e parcial', () => {
  const { dir, carregado } = projetoTemporario('thread-fast-ciclo');
  try {
    for (const variante of ['gap', 'goal-plan'] as const) {
      assert.throws(
        () => novaThread(carregado, { nome: `fast ${variante}`, modo: 'fast', variante }),
        (e: Error) => e.message.includes(`o ciclo ${variante}`) && e.message.includes('#Fast'),
        `a recusa de ${variante} nomeia a variante e o modo`
      );
    }
    // A variante que nao mexe nos blocos continua valendo no #Fast.
    const greenfield = novaThread(carregado, { nome: 'fast greenfield', modo: 'fast', variante: 'greenfield', criarWorktree: true });
    assert.deepEqual(greenfield.thread.fases, ['GO']);
    // O #Auto tem bloco unico, mas percorre as seis fases: `gap` segue redesenhando.
    const gap = novaThread(carregado, { nome: 'auto gap', modo: 'auto', variante: 'gap' });
    assert.deepEqual(gap.thread.fases, ['GOAL', 'PLAN', 'CHECK', 'MASTER']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
