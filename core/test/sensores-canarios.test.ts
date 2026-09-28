import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { rodarCanarios } from '../src/evalrunner';

test('canário integrado confronta medições reais de subprocessos com a fixture T8', () => {
  const r = rodarCanarios(path.resolve(__dirname, '../../..'), ['fx-sensores-runtime']);
  assert.deepEqual(r.falhas, []); assert.equal(r.resultados.length, 1);
  const o = r.resultados[0].observado;
  assert.equal(typeof o.hookLatenciaMs, 'number'); assert.equal(typeof o.carimboLatenciaMs, 'number');
  assert.ok(Number(o.carimboLatenciaMs) >= 0);
  console.log(JSON.stringify(o));
});
