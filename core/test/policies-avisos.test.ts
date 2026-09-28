/**
 * RM-008 (fatia 3): as licoes do loop de aprendizado que viraram policy executavel.
 *
 * Warn registra e segue; block reprova como as outras policies; sem os fatos da thread (a
 * checagem de ambiente do CLI chama o gate sem thread), nenhuma delas diz nada.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lerLedger } from '../src/ledger';
import { avaliarPolicies, avisos, bloqueantes, linhasDeAviso, policiesDesconhecidas } from '../src/policies';
import { rodarFase } from '../src/phase';
import { ship } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { commitar, projetoTemporario, shaDaBranch } from './apoio';

const AS_QUATRO = { verify_regression: 'warn', verify_failed: 'warn', runtime_unavailable: 'warn', tree_blocked: 'warn' };

test('as licoes executaveis so avaliam com os fatos da thread, e o aviso de baseline sai uma vez', () => {
  const p = projetoTemporario('policies-avisos');
  try {
    const m = p.carregado.manifesto;
    m.policies = { ...m.policies, ...AS_QUATRO };
    assert.deepEqual(policiesDesconhecidas(m), [], 'as quatro sao conhecidas do nucleo');

    // Sem thread, como na checagem de ambiente do CLI: silencio.
    assert.deepEqual(avaliarPolicies(m, { gate: 'phase.dispatch' }), []);

    const comFallback = ['codex:gpt-5.5'];
    const semBaseline = avaliarPolicies(m, { gate: 'phase.dispatch', threadId: 'ork-x', modo: 'auto', bloco: 1,
      blocoComGo: true, temBaseline: false, fallbackDoBloco: comFallback });
    assert.deepEqual(semBaseline.map((v) => [v.policy, v.severidade]), [['verify_regression', 'warn']],
      'verify_failed confere a mesma coisa e nao repete o aviso');
    assert.equal(semBaseline[0].correcao, 'ork verify ork-x --baseline');
    assert.deepEqual(avaliarPolicies(m, { gate: 'phase.dispatch', threadId: 'ork-x', blocoComGo: true, temBaseline: true,
      fallbackDoBloco: comFallback }), [], 'com baseline, silencio');
    assert.deepEqual(avaliarPolicies(m, { gate: 'phase.dispatch', threadId: 'ork-x', blocoComGo: false, temBaseline: false,
      fallbackDoBloco: comFallback }), [], 'bloco sem GO, silencio');

    const semFallback = avaliarPolicies(m, { gate: 'phase.dispatch', threadId: 'ork-x', modo: 'auto', bloco: 1,
      blocoComGo: false, fallbackDoBloco: [] });
    assert.deepEqual(semFallback.map((v) => v.policy), ['runtime_unavailable']);
    assert.equal(semFallback[0].correcao, 'ork setup auto --bloco 1 --fallback <runtime:modelo>');

    const atras = avaliarPolicies(m, { gate: 'ship', de: 'ork/ork-x-full', para: 'main', baseBranch: 'main',
      threadId: 'ork-x', branchAtrasDaBase: true });
    assert.deepEqual(atras.map((v) => v.policy), ['tree_blocked']);
    assert.equal(atras[0].correcao, 'ork worktree sync ork-x');
    assert.deepEqual(avaliarPolicies(m, { gate: 'ship', de: 'ork/ork-x-full', para: 'main', baseBranch: 'main',
      branchAtrasDaBase: false }), []);
    assert.match(linhasDeAviso(atras).join('\n'), /aviso da policy tree_blocked:[\s\S]*correcao: ork worktree sync ork-x/);

    // off cala; block entra nas bloqueantes como qualquer policy.
    m.policies = { ...m.policies, tree_blocked: 'off' };
    assert.deepEqual(avaliarPolicies(m, { gate: 'ship', de: 'a', para: 'main', branchAtrasDaBase: true }), []);
    m.policies = { ...m.policies, tree_blocked: 'block' };
    assert.equal(bloqueantes(avaliarPolicies(m, { gate: 'ship', de: 'a', para: 'main', branchAtrasDaBase: true })).length, 1);
  } finally { p.limpar(); }
});

test('no despacho, o aviso vai ao ledger e o despacho segue; o ensaio nao grava; em block, reprova', () => {
  const p = projetoTemporario('policies-avisos-despacho');
  try {
    p.carregado.manifesto.policies = { ...p.carregado.manifesto.policies, verify_regression: 'warn' };
    const { thread } = novaThread(p.carregado, { nome: 'aviso de baseline', modo: 'auto' });
    const avisosNoLedger = () => lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === 'policy_warn');

    const r = rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'objetivo de teste' });
    assert.notEqual(r.motivo, 'policy.violation', 'warn nunca bloqueia');
    assert.deepEqual(avisos(r.violacoes).map((v) => v.policy), ['verify_regression']);
    const gravados = avisosNoLedger();
    assert.equal(gravados.length, 1);
    assert.equal(gravados[0].policy, 'verify_regression');
    assert.equal(gravados[0].gate, 'phase.dispatch');
    assert.equal(gravados[0].correcao, `ork verify ${thread.id} --baseline`);

    const ensaio = rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'objetivo de teste', dryRun: true });
    assert.deepEqual(avisos(ensaio.violacoes).map((v) => v.policy), ['verify_regression'], 'o ensaio mostra o aviso');
    assert.equal(avisosNoLedger().length, 1, 'e nao grava');

    p.carregado.manifesto.policies = { ...p.carregado.manifesto.policies, verify_regression: 'block' };
    const b = rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'objetivo de teste' });
    assert.equal(b.bloqueado, true);
    assert.equal(b.motivo, 'policy.violation');
  } finally { p.limpar(); }
});

test('no ship, a branch atras da base avisa e entrega; em block, reprova sem tocar a base', () => {
  const p = projetoTemporario('policies-avisos-ship', true);
  try {
    p.carregado.manifesto.policies = { ...p.carregado.manifesto.policies, tree_blocked: 'warn' };
    const { thread } = novaThread(p.carregado, { nome: 'atras da base', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', 'entrega\n', `feat: entrega da thread ${thread.id}`);
    commitar(p.dir, 'base.md', 'a base andou\n', 'feat: a base andou depois da branch da thread');

    const r = ship(p.carregado, thread.id, { para: 'main' });
    assert.equal(r.bloqueado, false, r.detalhe);
    assert.deepEqual(avisos(r.violacoes).map((v) => v.policy), ['tree_blocked']);
    const gravado = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'policy_warn');
    assert.ok(gravado);
    assert.equal(gravado.gate, 'ship');
    assert.equal(gravado.correcao, `ork worktree sync ${thread.id}`);
  } finally { p.limpar(); }

  const q = projetoTemporario('policies-avisos-ship-block', true);
  try {
    q.carregado.manifesto.policies = { ...q.carregado.manifesto.policies, tree_blocked: 'block' };
    const { thread } = novaThread(q.carregado, { nome: 'atras da base', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', 'entrega\n', `feat: entrega da thread ${thread.id}`);
    commitar(q.dir, 'base.md', 'a base andou\n', 'feat: a base andou depois da branch da thread');
    const mainAntes = shaDaBranch(q.dir, 'main');

    const r = ship(q.carregado, thread.id, { para: 'main' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'policy.violation');
    assert.match(r.detalhe, /tree_blocked/);
    assert.equal(shaDaBranch(q.dir, 'main'), mainAntes, 'a base fica como estava');
  } finally { q.limpar(); }
});
