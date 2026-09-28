import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rodarCanarios, rodarEval } from '../src/evalrunner';
import { dirTemporario } from '../src/sandbox';

const catalogo = path.resolve(__dirname, '../../..');
test('filtro ausente, vazio ou misto reprova em vez de emitir verde sem prova', () => {
  for (const canarios of [['fx-inexistente'], [], ['fx-auto-quiet', 'fx-inexistente']]) {
    const r = rodarEval({ catalogo, canarios, soCanarios: true });
    assert.equal(r.ok, false, JSON.stringify(canarios));
    assert.ok(r.falhas.length > 0);
  }
  const valido = rodarCanarios(catalogo, ['fx-blanket-approve', 'fx-auto-quiet', 'fx-omnicanal']);
  assert.equal(valido.resultados.length, 3);
  assert.equal(valido.falhas.length, 0);
  assert.ok(valido.resultados.every(c => c.estado === 'passou' && c.observado.simulado === true));
  // D12: o canario omnicanal prova os quatro canais, nao uma amostra deles.
  const omni = valido.resultados.find(c => c.id === 'fx-omnicanal')!;
  assert.equal(omni.observado.canaisRegistrados, 4);
  assert.equal(omni.observado.aprovados, 4);
  assert.equal(omni.observado.canaisDistinguiveis, 4);
  assert.equal(omni.observado.canalPorInferencia, 0);
  assert.equal(omni.observado.humanosSemIngresso, 0);
});

test('fixture ausente ou com id divergente não executa canário diferente do pedido', () => {
  const dir = dirTemporario('eval-filter');
  try {
    const alvo = path.join(dir, 'eval/fixtures/fx-auto-quiet');
    fs.mkdirSync(alvo, { recursive: true });
    assert.ok(rodarCanarios(dir, ['fx-auto-quiet']).falhas.length > 0);
    fs.writeFileSync(path.join(alvo, 'caso.json'), JSON.stringify({ id: 'fx-blanket-approve', esperado: {} }));
    const r = rodarCanarios(dir, ['fx-auto-quiet']);
    assert.equal(r.resultados.length, 0);
    assert.ok(r.falhas.some(f => f.detalhe.includes('diverge')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
