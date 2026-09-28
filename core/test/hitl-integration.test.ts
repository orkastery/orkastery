/** Host/identidade SIMULADOS: subprocesso CLI real e ledger em sandbox. Sem Telegram. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { rodarCanarios } from '../src/evalrunner';

test('resposta local SIMULADA atravessa stdin/CLI/autenticação até human_gate em <60s', () => {
  const r = rodarCanarios(path.resolve(__dirname, '../../..'), ['fx-hitl-latency']);
  assert.equal(r.resultados.length, 1);
  assert.deepEqual(r.falhas, []);
  const c = r.resultados[0];
  assert.equal(c.estado, 'passou', c.motivo);
  assert.equal(c.observado.simulado, true);
  assert.ok(Number(c.observado.latenciaRespostaMs) > 0 && Number(c.observado.latenciaRespostaMs) < 60000);
  for (const k of ['respostaRecebida', 'idempotente', 'adulteradaRecusada', 'conteudoAusente']) assert.equal(c.observado[k], true, k);
});
