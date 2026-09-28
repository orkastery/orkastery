import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { controleDoController, encerrarController, identidadeDoProcesso } from '../src/adapters/codex-controller';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import type { EntregaSessao } from '../src/hitl-sessions';

test('SIMULADO: controller captura filho, autentica IPC, correlaciona prompt e confirma somente evento nativo', () => {
  const f = controllerSimulado(); let r: ReturnType<typeof f.dispatch> | undefined;
  try {
    r = f.dispatch(); assert.equal(r.ok, true, r.erro); assert.equal(r.verificada, true);
    const ctl = f.controle(r); esperarCondicao(() => ctl.consultar().sessoes[0]?.estado === 'blocked');
    const s = ctl.consultar().sessoes[0]; const state = f.estado(r);
    assert.ok(state.runtimePid); assert.ok(state.pid); assert.ok(state.runtimeInicio);
    assert.equal(fs.statSync(r.controlador!).mode & 0o777, 0o700);
    assert.throws(() => controleDoController(r!.controlador!, { ...f.vinculo, promptSha256: 'alterado' }, r!.sessionId!, f.dir), /vínculo/);
    const e: EntregaSessao = { contrato: 'ork.session-answer/v1', envioId: randomUUID(), pedidoId: randomUUID(),
      thread: f.vinculo.thread, fase: 'GO', sessao: s, recibo: 'a'.repeat(64), resposta: 'ç $(SIMULADO)' };
    assert.throws(() => ctl.enviar!({ ...e, sessao: { ...s, bloqueio: 'alheio' } }), /prompt/);
    assert.equal(ctl.confirmar!(e), null);
    ctl.enviar!(e); assert.equal(ctl.confirmar!(e)?.envioId, e.envioId);
    const nativo = JSON.parse(fs.readFileSync(path.join(r.controlador!, `native-${e.envioId}.json`), 'utf8'));
    assert.deepEqual(Object.keys(nativo).sort(), ['itemId', 'metodo', 'requestId', 'threadId', 'turnId']);
    for (const file of fs.readdirSync(r.controlador!).filter(n => n.endsWith('.json'))) {
      const content = fs.readFileSync(path.join(r.controlador!, file), 'utf8');
      assert.ok(!content.includes(e.resposta)); assert.ok(!content.includes('CAMPO-FUTURO-SIMULADO'));
    }
    assert.throws(() => ctl.enviar!(e));
    const recebido = fs.readFileSync(path.join(f.runtimeHome, 'recebido.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(recebido.length, 1); assert.equal(recebido[0].id, 0);
    assert.equal(recebido[0].result.answers.marcador.answers[0], e.resposta);
    assert.ok(!fs.readFileSync(path.join(r.controlador!, `receipt-${e.envioId}.json`), 'utf8').includes(e.resposta));
    esperarCondicao(() => ctl.consultar().sessoes[0]?.estado === 'blocked');
    assert.equal(ctl.parar(ctl.consultar().sessoes[0]), true);
    assert.equal(ctl.consultar().sessoes[0].estado, 'stopped');
    assert.equal(ctl.confirmar!(e)?.envioId, e.envioId);
  } finally {
    if (r?.controlador) { const ctl = f.controle(r); const s = ctl.consultar().sessoes[0]; if (s?.estado === 'blocked') ctl.parar(s); }
    f.restaurar(); // estado retido até comprovar terminal; nenhuma remoção de histórico global
  }
});


test('SIMULADO: launcher exec preserva origem e fixa executável após initialize', () => {
  const f = controllerSimulado(undefined, { launcherExec: true });
  let r: ReturnType<typeof f.dispatch> | undefined;
  try {
    r = f.dispatch(); assert.equal(r.ok, true, r.erro);
    const state = f.estado(r);
    assert.ok(state.processoRuntime);
    assert.equal(state.processoRuntime!.executavel, fs.realpathSync(process.execPath));
    assert.deepEqual(state.processoRuntime, identidadeDoProcesso(state.runtimePid!));
    assert.equal(state.runtimeInicio, state.processoRuntime!.inicio);
  } finally {
    if (r?.controlador) { const state = f.estado(r); assert.equal(encerrarController(r.controlador, f.vinculo, state.instancia).ok, true); }
    f.restaurar();
  }
});
