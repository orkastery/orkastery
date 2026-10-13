import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { estadoDoCheck } from '../src/forja/estado';

const tabela: Array<[Parameters<typeof estadoDoCheck>, ReturnType<typeof estadoDoCheck>]> = [
  [['check-run', 'in_progress', null], 'pendente'],
  [['check-run', 'COMPLETED', 'SUCCESS'], 'verde'],
  [['check-run', 'completed', 'skipped'], 'bloqueado'],
  [['check-run', 'completed', 'neutral'], 'bloqueado'],
  [['check-run', 'completed', 'timed_out'], 'vermelho'],
  [['check-run', 'completed', 'action_required'], 'vermelho'],
  [['commit-status', 'success', null], 'verde'],
  [['commit-status', 'error', null], 'vermelho'],
  [['commit-status', 'pending', null], 'pendente'],
];
for (const [entrada, esperado] of tabela) test(`${entrada.join('/')} → ${esperado}`, () => assert.equal(estadoDoCheck(...entrada), esperado));
