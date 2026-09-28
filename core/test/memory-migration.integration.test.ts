/** Integra componentes locais em fixture. Nunca abre estado ou banco operacional. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exportarHandoff } from '../src/handoff';
import { inventariarHandoffs, migrarHandoffs } from '../src/memory-migration';
import { DriverEmMemoria } from '../src/orkmind';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

test('integracao isolada: inventario, pacote integral, readback e replay preservam fontes e entries', () => {
  const p = projetoTemporario('migration-integration');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fonte de fixture', modo: 'auto' });
    exportarHandoff(p.carregado, thread.id, { proximaFase: 'GOAL' });
    const driver = new DriverEmMemoria();
    driver.adicionar({ collection: 'decision', content: 'Conteudo anterior preservado na fixture.',
      tags: { project: ['orkastery'] }, priority: 'medium', metadata: { origem: 'fixture' } });
    const anterior = JSON.stringify(driver.tudo());
    p.carregado.manifesto.memory.mode = 'orkmind';
    p.carregado.manifesto.memory.database_url_env = 'FIXTURE_NAO_ABRIR_BANCO';
    const inventario = inventariarHandoffs(p.carregado, [thread.id]);
    assert.equal(inventario.incluidos, 2);
    const bytes = inventario.fontes.map(f => fs.readFileSync(path.join(p.dir, f.arquivo)));
    const first = migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver, inventario });
    const second = migrarHandoffs(p.carregado, { operadora: thread.id, escopo: [thread.id], driver, inventario });
    assert.equal(first.ok, true); assert.equal(second.ok, true);
    assert.equal(first.antes.decision, 1);
    assert.deepEqual(second.antes, first.depois);
    assert.deepEqual(second.depois, first.depois);
    assert.deepEqual(second.resultados.map(r => r.readback), first.resultados.map(r => r.readback));
    assert.ok(second.resultados.every(r => r.gravacao?.duplicada && r.readback?.originalIntegral));
    inventario.fontes.forEach((f, i) => assert.deepEqual(fs.readFileSync(path.join(p.dir, f.arquivo)), bytes[i]));
    assert.equal(JSON.stringify(driver.tudo().filter(e => e.collection === 'decision')), anterior);
  } finally { p.limpar(); }
});
