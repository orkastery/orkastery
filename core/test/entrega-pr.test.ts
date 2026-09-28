/**
 * I-57 (RM-008, fatia 2): a entrega feita por PR prova entrega para o MASTER. O "PR" aqui e o
 * que o GitHub faz no merge: um merge --no-ff com o assunto `ship(<thread>): ...`, empurrado para
 * o remoto bare do projeto temporario.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { registrarEntregaPorPr, registrarEntregasPorPr } from '../src/entrega-pr';
import { lerLedger } from '../src/ledger';
import { aceitarPendentesPorOmissao, entregou } from '../src/master';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { commitar, projetoTemporario, ProjetoDeTeste } from './apoio';

/** Uma thread com o trabalho numa branch e o merge `ship(<thread>)` na main; `empurrar` publica. */
function entregaPorPr(p: ProjetoDeTeste, nome: string, empurrar = true): string {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  exec('git', ['checkout', '-q', '-b', `ork/${thread.id}-full`], p.dir);
  commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  const merge = exec('git', ['merge', '--no-ff', '-q', '-m', `ship(${thread.id}): ${nome}`, `ork/${thread.id}-full`], p.dir);
  assert.equal(merge.ok, true, merge.stderr);
  if (empurrar) assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
  return thread.id;
}

test('o merge ship(<thread>) no remoto vira ship_done com a prova, uma vez, e o MASTER fecha por omissao', () => {
  const p = projetoTemporario('entrega-pr', true);
  try {
    const id = entregaPorPr(p, 'fatia');
    assert.equal(entregou(p.dir, id), false, 'antes, o MASTER nao via entrega');
    const r = registrarEntregaPorPr(p.carregado, id);
    assert.equal(r.acao, 'registrou', r.motivo);
    const head = exec('git', ['rev-parse', `ork/${id}-full`], p.dir).stdout.trim();
    assert.equal(r.headSha, head, 'o head do PR e o segundo pai do merge');
    const ship = lerLedger(dirThread(p.dir, id)).filter((e) => e.tipo === 'ship_done');
    assert.equal(ship.length, 1);
    assert.equal(ship[0].mergeSha, r.mergeSha);
    assert.equal(ship[0].pushVerificado, true);
    assert.equal(ship[0].tipoDeAutorizacao, 'pr');
    assert.equal(lerThread(p.dir, id).faseAtual, 'SHIP');
    assert.equal(registrarEntregaPorPr(p.carregado, id).acao, 'ja-registrada', 'idempotente');
    assert.equal(entregou(p.dir, id), true);

    const aceitas = aceitarPendentesPorOmissao(p.dir);
    assert.deepEqual(aceitas.map((a) => a.thread), [id]);
    assert.equal(lerThread(p.dir, id).status, 'fechada', 'fechada pelo MASTER, com o indice no ledger');
  } finally { p.limpar(); }
});

test('merge que nao chegou ao remoto nao e entrega, e thread sem merge fica de fora do lote', () => {
  const p = projetoTemporario('entrega-pr-local', true);
  try {
    const local = entregaPorPr(p, 'so-local', false);
    assert.equal(registrarEntregaPorPr(p.carregado, local).acao, 'sem-merge', 'a base remota nao tem o merge');
    const { thread: sem } = novaThread(p.carregado, { nome: 'sem merge', modo: 'auto' });
    const outra = entregaPorPr(p, 'publicada');
    const lote = registrarEntregasPorPr(p.carregado);
    // O push da segunda levou o merge local da primeira junto: as duas estao no remoto agora.
    assert.deepEqual(lote.map((x) => [x.thread, x.acao]).sort(), [[local, 'registrou'], [outra, 'registrou']].sort());
    assert.equal(lote.some((x) => x.thread === sem.id), false);
  } finally { p.limpar(); }
});

test('com o CI exigido pelo manifesto e sem CI verde no head, a entrega e recusada e nada e gravado', () => {
  const p = projetoTemporario('entrega-pr-ci', true);
  try {
    const id = entregaPorPr(p, 'sem ci');
    const exigente = { ...p.carregado, manifesto: { ...p.carregado.manifesto, ci: { ...p.carregado.manifesto.ci, required_for_ship: true } } };
    const r = registrarEntregaPorPr(exigente, id, { executorCi: () => ({ ok: true, stdout: '{"check_runs":[]}', stderr: '', code: 0 }) });
    assert.equal(r.acao, 'recusada');
    assert.match(r.motivo, /sem CI verde no head do PR/);
    assert.equal(lerLedger(dirThread(p.dir, id)).some((e) => e.tipo === 'ship_done'), false);
  } finally { p.limpar(); }
});
