import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { estadoDoCheck } from '../src/forja/estado';

// Os estados de job e de commit status do GitLab (docs.gitlab.com, API de jobs e de commits): o mesmo vocabulario
// nas duas fontes.
const GITLAB: Array<[string, ReturnType<typeof estadoDoCheck>]> = [
  ['success', 'verde'],
  ['failed', 'vermelho'], ['canceled', 'vermelho'], ['canceling', 'vermelho'],
  ['manual', 'bloqueado'], ['skipped', 'bloqueado'],
  ['created', 'pendente'], ['pending', 'pendente'], ['running', 'pendente'], ['waiting_for_resource', 'pendente'],
  ['preparing', 'pendente'], ['scheduled', 'pendente'], ['waiting_for_callback', 'pendente'],
];
for (const fonte of ['pipeline-job', 'commit-status'] as const) {
  for (const [status, esperado] of GITLAB) {
    test(`${fonte}/${status} → ${esperado}`, () => assert.equal(estadoDoCheck(fonte, status, null), esperado));
  }
  test(`${fonte}: estado desconhecido nunca é verde`, () => assert.equal(estadoDoCheck(fonte, 'novo_estado', null), 'pendente'));
}

test('o vocabulário do GitHub não muda: status e check-run', () => {
  assert.equal(estadoDoCheck('commit-status', 'FAILURE', null), 'vermelho');
  assert.equal(estadoDoCheck('commit-status', 'ERROR', null), 'vermelho');
  assert.equal(estadoDoCheck('commit-status', 'EXPECTED', null), 'pendente');
  assert.equal(estadoDoCheck('commit-status', 'SUCCESS', null), 'verde');
  assert.equal(estadoDoCheck('check-run', 'completed', 'cancelled'), 'vermelho');
  assert.equal(estadoDoCheck('check-run', 'completed', 'stale'), 'vermelho');
  assert.equal(estadoDoCheck('check-run', 'completed', 'skipped'), 'bloqueado');
  assert.equal(estadoDoCheck('check-run', 'queued', null), 'pendente');
});

test('os jobs gravados do GitLab 19.4 têm estado conhecido pela regra', () => {
  const dir = join(__dirname, '..', '..', 'test', 'fixtures', 'forja', 'gitlab', '19.4-ci');
  const jobs = (JSON.parse(readFileSync(join(dir, 'pipeline-1-jobs.json'), 'utf8')) as { corpo: Array<{ status: string }> }).corpo;
  assert.ok(Array.isArray(jobs) && jobs.length > 0);
  for (const j of jobs) assert.ok(['verde', 'vermelho'].includes(estadoDoCheck('pipeline-job', j.status, null)), j.status);
});
