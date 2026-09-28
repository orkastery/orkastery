/**
 * Testes de `ork ship`: merge --no-ff, lease `main-tree` serializando as threads e push
 * PROVADO por ls-remote contra um remoto real (repositorio bare temporario).
 *
 * Nenhum teste toca a `main` do Orkastery: cada caso monta o seu proprio repositorio.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim } from '../src/claims';
import { aprovarSimulado, comCredencialSimulada } from './hitl-simulado';
import { lerLedger } from '../src/ledger';
import { adquirir, caminhoLease, LEASE_MAIN_TREE, lerLease } from '../src/leases';
import { arvoreComBranch, autorizacaoDePush, ship } from '../src/ship';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { Modo } from '../src/types';
import { commitar, projetoTemporario, shaDaBranch, shaNoRemotoDeTeste } from './apoio';

/** Cria a thread com worktree isolada e um commit proprio dentro dela. */
function threadComEntrega(
  projeto: ReturnType<typeof projetoTemporario>,
  nome: string,
  modo: Modo
) {
  const { thread } = novaThread(projeto.carregado, { nome, modo, criarWorktree: true });
  const sha = commitar(
    thread.worktree as string,
    'entrega.md',
    `# entrega de ${thread.id}\n`,
    `feat: entrega da thread ${thread.id}`
  );
  return { thread, sha };
}

test('ship faz merge --no-ff, empurra e PROVA o push com ls-remote', () => {
  const projeto = projetoTemporario('ship-ok', true);
  const { thread, sha } = threadComEntrega(projeto, 'entrega alfa', 'auto');
  const mainAntes = shaDaBranch(projeto.dir, 'main');

  const r = ship(projeto.carregado, thread.id, { para: 'main' });

  assert.equal(r.bloqueado, false, r.detalhe);
  assert.equal(r.ok, true);
  // A #TAG do modo #Auto e a autorizacao previa, registrada no ledger.
  assert.equal(r.autorizacao.tipo, 'modo');
  assert.match(r.autorizacao.por, /#Auto/);

  // O merge aconteceu e e mesmo um merge commit (--no-ff), com 2 pais.
  const mainDepois = shaDaBranch(projeto.dir, 'main');
  assert.notEqual(mainDepois, mainAntes);
  assert.equal(r.mergeSha, mainDepois);
  const pais = exec('git', ['rev-list', '--parents', '-n', '1', mainDepois], projeto.dir)
    .stdout.trim()
    .split(/\s+/);
  assert.equal(pais.length, 3, 'merge --no-ff produz commit com dois pais');
  assert.ok(pais.includes(mainAntes));
  assert.ok(pais.includes(sha));

  // A prova do push: o sha que o REMOTO devolve e o mesmo do destino local.
  assert.equal(r.pushVerificado, true);
  assert.equal(r.shaRemoto, mainDepois);
  assert.equal(shaNoRemotoDeTeste(projeto.dir, projeto.remoto as string, 'main'), mainDepois);
  assert.ok(r.passos.some((p) => p.startsWith('git ls-remote')));

  // Ledger: ship_done com os dois shas e a fonte da prova.
  const eventos = lerLedger(dirThread(projeto.dir, thread.id));
  const done = eventos.find((e) => e.tipo === 'ship_done');
  assert.ok(done, 'evento ship_done gravado');
  assert.equal(done.mergeSha, mainDepois);
  assert.equal(done.shaRemoto, mainDepois);
  assert.equal(done.pushVerificado, true);
  assert.equal(done.fonteDaProva, 'git ls-remote origin refs/heads/main');
  assert.match(String(done.autorizadoPor), /#Auto/);

  // O lease foi liberado ao fim, e a thread registrou que o segurou.
  assert.equal(lerLease(projeto.dir, LEASE_MAIN_TREE), null);
  assert.equal(fs.existsSync(caminhoLease(projeto.dir, LEASE_MAIN_TREE)), false);
  const atualizada = lerThread(projeto.dir, thread.id);
  assert.equal(atualizada.faseAtual, 'SHIP');
  assert.equal(atualizada.leases.length, 1);
  assert.equal(atualizada.leases[0].nome, LEASE_MAIN_TREE);

  projeto.limpar();
});

test('o lease main-tree serializa: a segunda thread e bloqueada e nada e mergeado', () => {
  const projeto = projetoTemporario('ship-lease', true);
  const a = threadComEntrega(projeto, 'thread a', 'auto');
  const b = threadComEntrega(projeto, 'thread b', 'auto');
  const mainAntes = shaDaBranch(projeto.dir, 'main');

  // A thread A esta com o lease (equivale a um ship em curso).
  const tomado = adquirir(projeto.dir, LEASE_MAIN_TREE, {
    thread: a.thread.id,
    motivo: 'ship de ork/... para main',
  });
  assert.equal(tomado.ok, true);

  const r = ship(projeto.carregado, b.thread.id, { para: 'main' });
  assert.equal(r.bloqueado, true);
  assert.equal(r.motivo, 'lease.busy');
  assert.match(r.detalhe, new RegExp(a.thread.id));
  assert.equal(r.mergeSha, null);
  assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes, 'nada foi mergeado na base');

  const eventos = lerLedger(dirThread(projeto.dir, b.thread.id));
  const bloqueio = eventos.find((e) => e.tipo === 'ship_blocked');
  assert.ok(bloqueio);
  assert.equal(bloqueio.motivo, 'lease.busy');
  // O lease continua com a thread A: a reprovacao nao rouba o lease dos outros.
  assert.equal(lerLease(projeto.dir, LEASE_MAIN_TREE)?.thread, a.thread.id);

  // Liberado o lease, a mesma thread B passa: a serializacao e fila, nao veto.
  const passou = ship(projeto.carregado, b.thread.id, { para: 'main' });
  assert.equal(passou.bloqueado, true, 'ainda bloqueado enquanto o lease existir');
  assert.equal(passou.motivo, 'lease.busy');
  fs.rmSync(caminhoLease(projeto.dir, LEASE_MAIN_TREE));
  const agora = ship(projeto.carregado, b.thread.id, { para: 'main' });
  assert.equal(agora.ok, true, agora.detalhe);
  assert.equal(agora.pushVerificado, true);

  projeto.limpar();
});

test('a autorizacao de push segue o modo: #Classic sem antecipada pausa, com antecipada entrega, #Auto segue', () => {
  const projeto = projetoTemporario('ship-autorizacao', true);

  // `#Classic` esta fora de MODOS_QUE_AUTORIZAM_PUSH: sem autorizacao ANTECIPADA
  // registrada no ledger, o push para e espera o humano.
  const d = threadComEntrega(projeto, 'padrao', 'classic');
  const mainAntes = shaDaBranch(projeto.dir, 'main');
  const bloqueado = ship(projeto.carregado, d.thread.id, { para: 'main' });
  assert.equal(bloqueado.bloqueado, true);
  assert.equal(bloqueado.motivo, 'human.pending');
  assert.equal(bloqueado.autorizacao.tipo, 'pendente');
  assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes);

  // O humano autoriza na linha de comando e a entrega acontece.
  const liberado = ship(projeto.carregado, d.thread.id, { para: 'main', autorizarPush: 'julio' });
  assert.equal(liberado.ok, true, liberado.detalhe);
  assert.equal(liberado.autorizacao.tipo, 'humano-no-cli');
  assert.equal(liberado.autorizacao.por, 'julio');
  const gateLiberado = lerLedger(dirThread(projeto.dir, d.thread.id)).find(
    (e) => e.tipo === 'gate_passed'
  );
  assert.ok(gateLiberado);
  assert.equal(gateLiberado.autorizadoPor, 'julio');

  // #Classic: a autorizacao antecipada de push fica no ledger e vale no SHIP.
  const o = threadComEntrega(projeto, 'classic antecipado', 'classic');
  const semAprovacao = autorizacaoDePush(projeto.dir, lerThread(projeto.dir, o.thread.id), {
    para: 'main',
  });
  assert.equal(semAprovacao.autorizado, false);
  aprovarSimulado(projeto.dir, o.thread.id, 'CHECK');
  // FX2: o SHIP reconfere o MAC do ingresso; sem a credencial no ambiente a aprovacao
  // registrada nao autoriza, e e isso que separa recibo de linha escrita no ledger.
  const semCredencial = autorizacaoDePush(projeto.dir, lerThread(projeto.dir, o.thread.id), { para: 'main' });
  assert.equal(semCredencial.autorizado, false);
  const comAprovacao = comCredencialSimulada(() => ship(projeto.carregado, o.thread.id, { para: 'main' }));
  assert.equal(comAprovacao.ok, true, comAprovacao.detalhe);
  assert.equal(comAprovacao.autorizacao.tipo, 'humano-antecipado');
  assert.equal(comAprovacao.autorizacao.por, 'telegram:42');
  assert.equal(comAprovacao.pushVerificado, true);
  assert.equal(comAprovacao.shaRemoto, shaNoRemotoDeTeste(projeto.dir, projeto.remoto as string, 'main'));

  projeto.limpar();
});

test('policy push_direto_na_base reprova entregar a base nela mesma', () => {
  const projeto = projetoTemporario('ship-policy', true);
  const { thread } = threadComEntrega(projeto, 'policy', 'auto');
  const mainAntes = shaDaBranch(projeto.dir, 'main');

  const r = ship(projeto.carregado, thread.id, { para: 'main', de: 'main' });
  assert.equal(r.bloqueado, true);
  assert.equal(r.motivo, 'policy.violation');
  assert.match(r.detalhe, /push_direto_na_base/);
  assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes);

  // O gate tipado foi ao ledger com o motivo e a correcao.
  const bloqueio = lerLedger(dirThread(projeto.dir, thread.id)).find((e) => e.tipo === 'gate_blocked');
  assert.ok(bloqueio);
  assert.equal(bloqueio.motivo, 'policy.violation');
  assert.equal(bloqueio.gate, 'ship');
  assert.equal(bloqueio.reprovaEmTodoModo, true);

  projeto.limpar();
});

test('claim reprovada barra o ship antes de tocar na base', () => {
  const projeto = projetoTemporario('ship-claim', true);
  const { thread } = threadComEntrega(projeto, 'claim falsa', 'auto');
  const mainAntes = shaDaBranch(projeto.dir, 'main');

  adicionarClaim(projeto.dir, thread.id, {
    arquivo: 'entrega.md',
    alegacao: 'a entrega esta completa',
    verificar: ['false'],
  });

  const r = ship(projeto.carregado, thread.id, { para: 'main' });
  assert.equal(r.bloqueado, true);
  assert.equal(r.motivo, 'claims.failed');
  assert.equal(r.verificacao?.ok, false);
  assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes, 'a base nao foi tocada');
  // A verificacao roda ANTES do lease: nada ficou preso.
  assert.equal(lerLease(projeto.dir, LEASE_MAIN_TREE), null);

  projeto.limpar();
});

test('ship --dry-run mostra os passos, nao mergeia e nao toma o lease', () => {
  const projeto = projetoTemporario('ship-dry', true);
  const { thread } = threadComEntrega(projeto, 'ensaio', 'auto');
  const mainAntes = shaDaBranch(projeto.dir, 'main');

  const r = ship(projeto.carregado, thread.id, { para: 'main', dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.ok, true);
  assert.equal(r.mergeSha, null);
  assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes);
  assert.equal(lerLease(projeto.dir, LEASE_MAIN_TREE), null);
  assert.ok(r.passos.some((p) => p.includes('git merge --no-ff')));
  assert.ok(r.passos.some((p) => p.includes('git ls-remote')));
  // Mesmo em ensaio, a verificacao roda de verdade: o ensaio nao afrouxa a verdade.
  assert.equal(r.verificacao?.ok, true);

  projeto.limpar();
});

test('sem remoto configurado o ship mergeia e declara que nao ha push a provar', () => {
  const projeto = projetoTemporario('ship-sem-remoto', false);
  const { thread } = threadComEntrega(projeto, 'sem remoto', 'auto');

  const r = ship(projeto.carregado, thread.id, { para: 'main' });
  assert.equal(r.ok, true, r.detalhe);
  assert.equal(r.pushVerificado, false);
  assert.equal(r.shaRemoto, null);
  assert.match(r.detalhe, /remoto "origin" nao configurado/);
  assert.equal(shaDaBranch(projeto.dir, 'main'), r.mergeSha);

  projeto.limpar();
});

test('a arvore de merge nao troca a branch da raiz quando o destino esta em outra branch', () => {
  const projeto = projetoTemporario('ship-arvore', true);
  // Cria a branch de destino `entrega` e volta a raiz para outra branch.
  exec('git', ['branch', 'entrega', 'main'], projeto.dir);
  exec('git', ['checkout', '-q', '-b', 'trabalho'], projeto.dir);
  const { thread } = threadComEntrega(projeto, 'arvore', 'auto');

  const r = ship(projeto.carregado, thread.id, { para: 'entrega' });
  assert.equal(r.ok, true, r.detalhe);
  assert.equal(shaDaBranch(projeto.dir, 'entrega'), r.mergeSha);
  // A raiz continua na branch em que o builder estava.
  assert.equal(
    exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], projeto.dir).stdout.trim(),
    'trabalho'
  );
  // A worktree temporaria do merge foi descartada.
  const temporarias = exec('git', ['worktree', 'list', '--porcelain'], projeto.dir).stdout;
  assert.equal(temporarias.includes(path.join('.orkastery', 'tmp')), false);

  projeto.limpar();
});

test('destino em check-out em outra arvore: o merge acontece la, e nao falha', () => {
  // Reproduz o caso real do orquestrador: o `ork` roda de dentro de uma worktree e a
  // branch de destino esta em check-out no repositorio principal. O `git worktree add`
  // recusa duplicar a branch, entao o merge tem que acontecer na arvore que a tem.
  const projeto = projetoTemporario('ship-arvore-irma', true);
  const irma = path.join(projeto.dir, '.claude', 'worktrees', 'principal');
  exec('git', ['branch', 'entrega', 'main'], projeto.dir);
  exec('git', ['worktree', 'add', irma, 'entrega'], projeto.dir);
  const { thread, sha } = threadComEntrega(projeto, 'irma', 'auto');

  assert.equal(arvoreComBranch(projeto.dir, 'entrega'), irma);
  assert.equal(arvoreComBranch(projeto.dir, 'branch-que-nao-existe'), null);

  const r = ship(projeto.carregado, thread.id, { para: 'entrega' });
  assert.equal(r.ok, true, r.detalhe);
  assert.equal(r.pushVerificado, true);

  // O merge foi feito NA arvore que tem a branch, e ela ficou no commit de merge.
  assert.equal(exec('git', ['rev-parse', 'HEAD'], irma).stdout.trim(), r.mergeSha);
  assert.equal(shaDaBranch(projeto.dir, 'entrega'), r.mergeSha);
  assert.ok(fs.existsSync(path.join(irma, 'entrega.md')), 'a arvore recebeu o conteudo do merge');
  assert.ok(exec('git', ['merge-base', '--is-ancestor', sha, r.mergeSha as string], irma).ok);

  // Arvore de destino suja reprova antes de mergear, com mensagem acionavel.
  const b = threadComEntrega(projeto, 'irma dois', 'auto');
  fs.appendFileSync(path.join(irma, 'entrega.md'), 'alteracao nao commitada\n');
  const sujo = ship(projeto.carregado, b.thread.id, { para: 'entrega' });
  assert.equal(sujo.bloqueado, true);
  assert.equal(sujo.motivo, 'tree.blocked');
  assert.match(sujo.detalhe, /esta em check-out em .* com alteracoes nao commitadas/);
  // O lease foi devolvido mesmo com a reprovacao no meio do caminho.
  assert.equal(lerLease(projeto.dir, LEASE_MAIN_TREE), null);

  projeto.limpar();
});

test('o #Fast nao autoriza push: sem autorizacao fica pendente, com --autorizar-push e humano-no-cli', () => {
  // I-42 (DD4, T6): o #Fast esta fora de MODOS_QUE_AUTORIZAM_PUSH. A prova e pelo
  // comportamento de `autorizacaoDePush` e do `ship`, nao pela constante privada.
  const projeto = projetoTemporario('ship-fast', true);
  try {
    const f = threadComEntrega(projeto, 'ajuste rapido', 'fast');
    assert.deepEqual(f.thread.fases, ['GO']);
    const mainAntes = shaDaBranch(projeto.dir, 'main');
    const pendente = autorizacaoDePush(projeto.dir, lerThread(projeto.dir, f.thread.id), { para: 'main' });
    assert.equal(pendente.autorizado, false);
    assert.equal(pendente.tipo, 'pendente');
    const bloqueado = ship(projeto.carregado, f.thread.id, { para: 'main' });
    assert.equal(bloqueado.motivo, 'human.pending');
    assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes);

    const liberado = ship(projeto.carregado, f.thread.id, { para: 'main', autorizarPush: 'julio' });
    assert.equal(liberado.ok, true, liberado.detalhe);
    assert.equal(liberado.autorizacao.tipo, 'humano-no-cli');
    assert.equal(liberado.pushVerificado, true);
    // O ciclo do #Fast nao tem SHIP: a fase atual continua dentro dele.
    assert.equal(lerThread(projeto.dir, f.thread.id).faseAtual, 'GO');
  } finally {
    projeto.limpar();
  }
});

test('o #Fast nao entrega contrato publico; o mesmo diff numa thread #Auto entrega', () => {
  // I-42 (D7): a fronteira vale na entrega, onde aparece o commit feito por git direto.
  const projeto = projetoTemporario('ship-fast-contrato', true);
  try {
    const { thread: fast } = novaThread(projeto.carregado, { nome: 'mexe no tipo', modo: 'fast', criarWorktree: true });
    commitar(fast.worktree as string, 'core/src/types.ts', 'export type X = 1;\n', 'mexe no contrato');
    const mainAntes = shaDaBranch(projeto.dir, 'main');
    const barrado = ship(projeto.carregado, fast.id, { para: 'main', autorizarPush: 'julio' });
    assert.equal(barrado.bloqueado, true);
    assert.equal(barrado.motivo, 'policy.violation');
    assert.match(barrado.detalhe, /core\/src\/types\.ts/);
    assert.match(barrado.correcao, /#Classic, #Maestro ou #Auto/);
    assert.equal(shaDaBranch(projeto.dir, 'main'), mainAntes);

    const { thread: auto } = novaThread(projeto.carregado, { nome: 'mexe no tipo com plano', modo: 'auto', criarWorktree: true });
    commitar(auto.worktree as string, 'core/src/types.ts', 'export type X = 2;\n', 'mexe no contrato com plano');
    const entregue = ship(projeto.carregado, auto.id, { para: 'main' });
    assert.equal(entregue.ok, true, entregue.detalhe);
  } finally {
    projeto.limpar();
  }
});
