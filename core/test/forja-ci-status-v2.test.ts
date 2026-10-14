import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ciNaoExigida, consultarCiDoRepositorio, ExecutorCi } from '../src/ci';
import { projetoTemporario } from './apoio';

const SHA = 'a'.repeat(40);
const run = (id: number, conclusion: string, slug = 'github-actions') => ({ id, name: 'ork-verify', status: 'completed', conclusion,
  completed_at: `2026-10-13T10:0${id}:00Z`, html_url: `https://github.com/o/r/runs/${id}`, app: { slug } });
const forja = (runs: unknown[], statuses: unknown[] = []): ExecutorCi => (e) => ({ ok: true, code: 0, stderr: '',
  stdout: (e.caminho ?? '').includes('/statuses') ? JSON.stringify(statuses) : JSON.stringify({ total_count: runs.length, check_runs: runs }) });

test('ork.ci-status/v2: a forja, a fonte e o produtor do check que decidiu', () => {
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', forja([run(1, 'success')]));
  assert.equal(r.schema, 'ork.ci-status/v2');
  assert.deepEqual([r.provider, r.state, r.fonte, r.produtor, r.url], ['github', 'success', 'check-run', 'github-actions', 'https://github.com/o/r/runs/1']);
});

test('sem check decisivo, fonte e produtor nulos', () => {
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', forja([]));
  assert.deepEqual([r.schema, r.state, r.fonte, r.produtor], ['ork.ci-status/v2', 'missing', null, null]);
  const fora = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', forja([run(1, 'success', 'outro-app')]));
  assert.deepEqual([fora.state, fora.fonte, fora.produtor], ['missing', null, null]);
});

test('vários produtores: a fonte e o produtor são os do check que decidiu', () => {
  const st = { id: 9, context: 'ork-verify', state: 'failure', updated_at: '2026-10-13T10:09:00Z', creator: { login: 'deploy-bot' } };
  const r = consultarCiDoRepositorio('o/r', SHA, 'ork-verify', forja([run(1, 'success')], [st]));
  assert.deepEqual([r.state, r.fonte, r.produtor], ['failure', 'commit-status', 'deploy-bot']);
});

test('o detalhe do GitHub não muda: verde e bloqueado pela conclusão', () => {
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', forja([run(1, 'success')])).detail, 'CHECK independente verde no GitHub');
  assert.equal(consultarCiDoRepositorio('o/r', SHA, 'ork-verify', forja([run(1, 'skipped')])).detail, 'check ork-verify: bloqueado (skipped)');
});

test('o gate não exigido sai v2, sem forja resolvida', () => {
  const p = projetoTemporario('ci-v2-desligado', false);
  try {
    const r = ciNaoExigida(p.carregado, SHA);
    assert.deepEqual([r.schema, r.provider, r.state, r.fonte, r.produtor], ['ork.ci-status/v2', null, 'disabled', null, null]);
  } finally { p.limpar(); }
});
