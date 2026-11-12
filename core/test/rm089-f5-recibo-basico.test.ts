/** RM-089 F5: projeção versionada e recibo de saída do runner. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CONTRATO_PROJECAO_REPLAY_CI,
  CONTRATO_RECIBO_RUNNER_CI,
  criarProjecaoReplayCi,
  emitirReciboRunnerCi,
  estadoDoReciboRunnerCi,
  validarProjecaoReplayCi,
} from '../src/ci-recibo-basico';
import type { Claim } from '../src/types';

const HEAD_A = 'a'.repeat(40), HEAD_B = 'b'.repeat(40);

const claim = (id = 'C1'): Claim => ({
  id,
  thread: 'ork-rm089f5recib',
  fase: 'GO',
  arquivo: 'core/src/ci.ts',
  alegacao: 'o runner emite o recibo do HEAD executado',
  negativa: false,
  verificar: ['node --test core/dist-test/test/rm089-f5-recibo-basico.test.js'],
  criadoEm: '2026-11-12T00:00:00.000Z',
  estado: 'pendente',
});

function projecao() {
  return criarProjecaoReplayCi({
    thread: 'ork-rm089f5recib',
    claims: [claim()],
    check: 'agile',
    baseline: { commit: 'c'.repeat(40), comandos: [], check: { modo: 'agile' } },
    commands: [{ name: 'build', command: 'npm --prefix core run build' }],
  });
}

test('a projeção é a entrada versionada e não declara HEAD presente', () => {
  const entrada = projecao();
  assert.equal(entrada.contrato, CONTRATO_PROJECAO_REPLAY_CI);
  assert.equal('head' in entrada, false);
  assert.deepEqual(validarProjecaoReplayCi(entrada), { ok: true, projecao: entrada });

  const adulterada = { ...entrada, commands: [{ name: 'build', command: 'true' }] };
  assert.deepEqual(validarProjecaoReplayCi(adulterada), { ok: false, causa: 'invalida' });
});

test('o runner emite o recibo somente para o HEAD real do checkout', () => {
  const recibo = emitirReciboRunnerCi(projecao(), HEAD_A, { ok: true, motivos: [] });
  assert.equal(recibo.contrato, CONTRATO_RECIBO_RUNNER_CI);
  assert.equal(recibo.head, HEAD_A);
  assert.equal(recibo.resultado.ok, true);
  assert.equal(estadoDoReciboRunnerCi(recibo, HEAD_A), 'presente');
  assert.equal(estadoDoReciboRunnerCi(recibo, HEAD_B), 'sha-divergente');
  assert.equal('assinatura' in recibo, false, 'a F5 apenas reserva o campo no contrato');
});
