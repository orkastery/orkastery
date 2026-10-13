import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adaptadorDaForja, exigirCapacidade } from '../src/forja/registro';

test('o GitHub tem a capacidade de checks; o GitLab ainda não, e diz isso tipado', () => {
  assert.equal(typeof exigirCapacidade(adaptadorDaForja('github'), 'checksNoCommit'), 'function');
  assert.throws(() => exigirCapacidade(adaptadorDaForja('gitlab'), 'checksNoCommit'), /^Error: forja\.sem-capacidade: gitlab/);
});

test('checksNoCommit do GitHub devolve a forma neutra do check-run', () => {
  const ci = exigirCapacidade(adaptadorDaForja('github'), 'checksNoCommit');
  const r = ci({ repository: 'o/r', sha: 'a'.repeat(40), context: 'ork-verify', executor: (e) => ({ ok: true, code: 0, stderr: '',
    stdout: e.caminho?.includes('/statuses') ? '[]' : JSON.stringify({ check_runs: [{ id: 7, name: 'ork-verify', status: 'completed', conclusion: 'success',
      html_url: 'https://x/1', completed_at: '2026-10-13T10:00:00Z', app: { slug: 'github-actions' } }] }) }) });
  assert.deepEqual(r, { ok: true, valor: [{ nome: 'ork-verify', fonte: 'check-run', produtor: 'github-actions', status: 'completed',
    conclusao: 'success', url: 'https://x/1', concluidoEm: '2026-10-13T10:00:00Z', ordem: 7 }] });
});
