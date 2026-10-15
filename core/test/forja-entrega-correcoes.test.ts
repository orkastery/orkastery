// core/test/forja-entrega-correcoes.test.ts
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ExecutorGitHub, registrarEntregaExternaPorPr, registrarEntregaPorPr } from '../src/entrega-pr';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { projetoTemporario } from './apoio';

test('fetch que falha é sem-leitura, não "nenhum merge"', () => {
  const p = projetoTemporario('entrega-sem-leitura', false);
  try {
    exec('git', ['remote', 'add', 'origin', '/nao/existe.git'], p.dir);
    const { thread } = novaThread(p.carregado, { nome: 'x', modo: 'auto' });
    const r = registrarEntregaPorPr(p.carregado, thread.id, { publicar: false });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.codigo, 'entrega.sem-leitura');
  } finally { p.limpar(); }
});

test('merge ship(<thread>) de um pai só, com CI exigida, é sem-vínculo e não consulta a CI da base', () => {
  const p = projetoTemporario('entrega-squash', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'squash', modo: 'auto' });
    exec('git', ['commit', '-q', '--allow-empty', '-m', `ship(${thread.id}): squash`], p.dir);
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
    const exigente = { ...p.carregado, manifesto: { ...p.carregado.manifesto, ci: { ...p.carregado.manifesto.ci, required_for_ship: true } } };
    let chamadas = 0;
    const r = registrarEntregaPorPr(exigente, thread.id, { publicar: false,
      executorCi: () => { chamadas++; return { ok: true, code: 0, stderr: '', stdout: '{"check_runs":[]}' }; } });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.codigo, 'entrega.sem-vinculo');
    assert.equal(chamadas, 0);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some((e) => e.tipo === 'ship_done'), false);
  } finally { p.limpar(); }
});

test('merge ship(<thread>) de um pai só, sem CI exigida, registra como antes e não consulta a CI', () => {
  const p = projetoTemporario('entrega-squash-sem-ci', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'squash', modo: 'auto' });
    exec('git', ['commit', '-q', '--allow-empty', '-m', `ship(${thread.id}): squash`], p.dir);
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
    const mergeSha = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
    const semCi = { ...p.carregado, manifesto: { ...p.carregado.manifesto, ci: { ...p.carregado.manifesto.ci, required_for_ship: false } } };
    let chamadas = 0;
    const r = registrarEntregaPorPr(semCi, thread.id, { publicar: false,
      executorCi: () => { chamadas++; return { ok: false, code: 1, stderr: 'nao devia ser chamado', stdout: '' }; } });
    assert.equal(r.acao, 'registrou', r.motivo);
    assert.equal(chamadas, 0);
    assert.equal(r.mergeSha, mergeSha);
    assert.equal(r.headSha, null);
    const feito = lerLedger(dirThread(p.dir, thread.id)).find((e) => e.tipo === 'ship_done') as Record<string, unknown> | undefined;
    assert.ok(feito);
    assert.equal(feito.mergeSha, mergeSha);
    assert.equal(feito.shaDe, null);
    assert.deepEqual((feito.evidencia as { ci: unknown }).ci, { state: 'disabled', context: 'ork-verify', url: null, sha: mergeSha });
  } finally { p.limpar(); }
});

test('PR externo mesclado sem head legível é sem-head, não "não mesclado"', () => {
  const p = projetoTemporario('entrega-sem-head');
  try {
    p.carregado.manifesto.ci.external_repositories = { 'o/r': '' };
    const { thread } = novaThread(p.carregado, { nome: 'externa', modo: 'auto' });
    const gh: ExecutorGitHub = (caminho) => caminho === 'repos/o/r/pulls/6'
      ? { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ merged: true, merge_commit_sha: 'e'.repeat(40), base: { ref: 'main' },
        head: { ref: `ork/${thread.id}` }, title: thread.id }) }
      : { ok: false, code: 1, stdout: '', stderr: 'HTTP 404' };
    const r = registrarEntregaExternaPorPr(p.carregado, thread.id, { repositorio: 'o/r', pr: 6, executorGitHub: gh, publicar: false });
    assert.equal(r.acao, 'recusada');
    assert.equal(r.codigo, 'entrega.sem-head');
  } finally { p.limpar(); }
});
