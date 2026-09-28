import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
for (const [cenario, codigo] of [['multiple', 'question.multiple'], ['nonblocking', 'question.nonblocking'], ['secret', 'question.secret'], ['approval', 'request.unsupported'], ['uncorrelated', 'request.uncorrelated'], ['long-options', 'question.invalid']]) {
  test(`F6 SIMULADO: ${cenario} vira indisponibilidade tipada e interrupção exata, sem aprovação nativa`, () => {
    const f = controllerSimulado(undefined, { cenario });
    try {
      const r = f.dispatch(); assert.equal(r.ok, true, r.erro);
      esperarCondicao(() => !!f.estado(r).terminal);
      const s = f.estado(r); assert.equal(s.estado, 'unavailable'); assert.equal(s.limitacao?.motivo, 'runtime.unavailable');
      assert.equal(s.limitacao?.codigo, codigo); assert.equal(s.bloqueio, undefined); assert.equal(s.perguntaNativa, undefined);
      assert.equal(s.terminal?.status, 'interrupted');
      const pedido = JSON.parse(fs.readFileSync(path.join(f.runtimeHome, 'interrompido.json'), 'utf8'));
      assert.deepEqual(pedido.params, { threadId: r.sessionId, turnId: s.turno });
      assert.equal(fs.existsSync(path.join(f.runtimeHome, 'recebido.jsonl')), false);
      assert.ok(!fs.readFileSync(path.join(r.controlador!, 'state.json'), 'utf8').includes('SEGREDO-NATIVO-SIMULADO'));
      assert.equal(f.controle(r).consultar().sessoes[0].estado, 'unavailable');
      esperarCondicao(() => !fs.existsSync(`/proc/${s.runtimePid}`));
    } finally { f.restaurar(); }
  });
}
