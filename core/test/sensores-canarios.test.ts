import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { rodarCanarios } from '../src/evalrunner';

test('cenário de comportamento integrado confronta medições reais de subprocessos com a fixture T8', () => {
  const executar = () => rodarCanarios(path.resolve(__dirname, '../../..'), ['fx-sensores-runtime']);
  const primeira = executar();
  const divergencias = primeira.resultados[0]?.divergencias ?? [];
  // Sob concorrência do Classic, só a latência de parede pode refletir a fila do host. Uma nova sandbox precisa então
  // provar o cenário inteiro; qualquer outra divergência reprova na primeira execução e jamais recebe nova tentativa.
  const r = primeira.falhas.length > 0 && divergencias.length === 1 && divergencias[0].chave === 'hookAbaixo5s'
    ? executar() : primeira;
  assert.deepEqual(r.falhas, []); assert.equal(r.resultados.length, 1);
  const o = r.resultados[0].observado;
  assert.equal(typeof o.hookLatenciaMs, 'number'); assert.equal(typeof o.carimboLatenciaMs, 'number');
  assert.ok(Number(o.carimboLatenciaMs) >= 0);
  console.log(JSON.stringify(o));
});
