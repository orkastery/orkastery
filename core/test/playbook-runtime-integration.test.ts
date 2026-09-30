import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { gravarThread, novaThread } from '../src/thread';
import { rodarFase } from '../src/phase';
import { encerrarController, lerEstadoController } from '../src/adapters/codex-controller';

for (const fase of ['GO', 'CHECK'] as const) {
  test(`phase.run ${fase} seleciona capacidade nativa Codex pelo contrato da fase`, () => {
    const p = projetoTemporario(`i09-phase-${fase.toLowerCase()}`);
    const f = controllerSimulado(p.dir);
    let controlador: string | undefined;
    try {
      // RM-037 (defeito 2): o review nativo vale para o bloco que termina no CHECK (GO-CHECK do #Classic);
      // no #Auto o bloco segue para o SHIP e o CHECK abre turno comum (rm037-modo-do-bloco).
      const t = novaThread(p.carregado, { nome: `i09 ${fase}`, modo: fase === 'CHECK' ? 'classic' : 'auto' }).thread;
      if (fase === 'CHECK') {
        // Reproduz a identidade real de uma thread com worktree: base.branch e
        // a branch fonte, enquanto o manifesto conserva a base de integração.
        t.base.branch = 'ork/fonte-da-thread';
        gravarThread(p.dir, t);
      }
      const r = rodarFase(p.carregado, t.id, { fase, prompt: 'pedido SIMULADO', runtime: 'codex', model: 'modelo-SIMULADO' });
      assert.equal(r.sessionId !== null, true, r.erro);
      controlador = r.controlador;
      const chamadas = fs.readFileSync(path.join(f.runtimeHome, 'params.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      const final = chamadas.at(-1);
      if (fase === 'GO') {
        assert.equal(final.method, 'turn/start');
        assert.equal(final.params.outputSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
        assert.equal(final.params.outputSchema.additionalProperties, false);
      } else {
        assert.equal(final.method, 'review/start');
        assert.deepEqual(final.params.target, {
          type: 'baseBranch',
          branch: p.carregado.manifesto.worktree.base_branch,
        });
      }
    } finally {
      if (controlador) {
        esperarCondicao(() => lerEstadoController(controlador!).estado === 'blocked');
        const estado = lerEstadoController(controlador);
        assert.equal(encerrarController(controlador, estado.vinculo, estado.instancia).ok, true);
      }
      f.restaurar(); p.limpar();
    }
  });
}
