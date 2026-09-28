/** Processos desta fixture são próprios e SIMULADOS; não há sinais ou sessões operacionais. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { encerrarController, processoTerminou } from '../src/adapters/codex-controller';
for (const cenario of ['boot-timeout', 'runtime-crash', 'never', 'controller-crash']) {
  test(`F8 SIMULADO: ${cenario} preserva referência e comprova encerramento exato sem sinais`, () => {
    const f = controllerSimulado(undefined, { cenario }); const anterior = process.env.NODE_OPTIONS;
    try {
      if (cenario === 'controller-crash') {
        const hook = path.join(f.dir, 'crash-fixture.cjs');
        // Falha abrupta do worker desta fixture, sem finally; app-server próprio observa EOF.
        // A janela precisa ser MAIOR que o boot para o crash cair DEPOIS do despacho
        // confirmado, que é o cenário. Com 650 ms ela invertia sob a suíte paralela (o
        // boot leva ~0,8 s sozinho e mais que isso com 215 arquivos disputando CPU), e o
        // teste reprovava com "controller sem confirmação do despacho". A asserção é a
        // mesma; o que mudou foi a margem (GO-FIX 1, FX4).
        fs.writeFileSync(hook, `if(process.argv[1]?.endsWith('codex-controller-worker.js')&&!process.argv.includes('--rpc'))setTimeout(()=>process.exit(29),3000);`);
        process.env.NODE_OPTIONS = '--require=' + hook;
      }
      // `never`: o turno TEM de estourar por prazo, mas depois de o despacho ser
      // confirmado. Com 250 ms o prazo vencia durante o boot sob carga e o despacho
      // voltava "processo encerrado"; 3 s mantém o estouro e cabe no esperaMs (FX4).
      const r = f.dispatch({ esperaMs: cenario === 'boot-timeout' ? 300 : 5000, duracaoMaximaMs: cenario === 'never' ? 3000 : 60000 });
      assert.ok(r.controlador); assert.equal(r.ok, !['boot-timeout', 'runtime-crash'].includes(cenario), r.erro);
      const launch = JSON.parse(fs.readFileSync(path.join(r.controlador!, 'launch.json'), 'utf8'));
      assert.deepEqual(launch.vinculo, f.vinculo); assert.ok(launch.instancia);
      // A fixture grava state.json depois de launch.json; com o host sob carga o cenário
      // boot-timeout (espera de 300 ms) chega aqui antes da escrita e lia ENOENT.
      // Esperar o ARQUIVO existir nao basta: o controlador grava state.json em etapas e as
      // assercoes abaixo leem processoController e processoRuntime, que chegam depois. Sob a
      // suite paralela o teste lia um estado ainda pela metade e reprovava sem defeito de
      // produto. Espera-se o ESTADO QUE AS ASSERCOES PRECISAM; esperarCondicao lanca se ele
      // nunca chegar, entao nenhuma afirmacao enfraquece.
      esperarCondicao(() => {
        const f2 = path.join(r.controlador!, 'state.json');
        if (!fs.existsSync(f2)) return false;
        try {
          const s2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
          return !!s2.processoController?.inicio && !!s2.processoRuntime?.inicio;
        } catch { return false; }
      }, 20000);
      const state = f.estado(r); assert.equal(state.instancia, launch.instancia);
      assert.ok(state.processoController?.inicio); assert.ok(state.processoController?.bootId);
      assert.equal(state.processoController?.cwd, r.controlador);
      assert.ok(state.processoRuntime?.inicio); assert.equal(state.processoRuntime?.uid, process.getuid!());
      assert.throws(() => encerrarController(r.controlador!, { ...f.vinculo, thread: 'alheia' }, state.instancia), /divergente/);
      assert.throws(() => encerrarController(r.controlador!, f.vinculo, 'alheia'), /divergente/);
      // As duas esperas agora cobrem janelas de 3 s com folga para o host carregado.
      if (cenario === 'controller-crash') esperarCondicao(() => processoTerminou(state.processoController), 20000);
      if (cenario === 'never') esperarCondicao(() => !!f.estado(r).encerramentoSolicitado, 20000);
      const ended = encerrarController(r.controlador!, f.vinculo, state.instancia);
      assert.equal(ended.ok, true, ended.evidencia);
      assert.equal(processoTerminou(state.processoController), true); assert.equal(processoTerminou(state.processoRuntime), true);
      assert.ok(fs.existsSync(path.join(r.controlador!, 'processes-ended.json')));
      assert.equal(fs.existsSync(path.join(f.runtimeHome, 'recebido.jsonl')), false);
      if (cenario === 'never') { assert.equal(f.estado(r).encerramentoSolicitado, 'turn.timeout'); assert.equal(f.estado(r).terminal?.status, 'interrupted'); }
      if (cenario === 'runtime-crash') assert.equal(f.estado(r).processoEncerrado?.code, 23);
    } finally { if (anterior === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = anterior; f.restaurar(); }
  });
}

import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { novaThread, gravarThread, dirThread, lerThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
for (const operacao of ['phase', 'retry']) {
  test(`F8 SIMULADO: falha no caminho ${operacao} preserva controller no resultado e no ledger para recuperação exata`, () => {
    const p = projetoTemporario('failed-dispatch'); const f = controllerSimulado(p.dir, { cenario: 'runtime-crash' });
    const t = novaThread(p.carregado, { nome: 'falha', modo: 'auto' }).thread; t.faseAtual = 'GO'; gravarThread(p.dir, t);
    try {
      const dir = dirThread(p.dir, t.id), prompt = path.join(dir, 'prompt.md'); fs.writeFileSync(prompt, f.prompt);
      const sha = createHash('sha256').update(f.prompt).digest('hex');
      const r = operacao === 'phase' ? rodarFase(p.carregado, t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO', prompt: f.prompt })
        : redespachar(p.carregado, t, 'GO', prompt, sha, { runtime: 'codex', model: 'modelo-SIMULADO' });
      assert.equal(r.sessionId, null); assert.equal(r.verificada, false); assert.equal(r.motivo, 'runtime.unavailable'); assert.ok(r.controlador);
      const event = lerLedger(dir).find(e => e.tipo === 'phase_dispatch_failed'); assert.equal(event?.controlador, r.controlador);
      assert.equal(lerThread(p.dir, t.id).sessoes.length, 0);
      const launch = JSON.parse(fs.readFileSync(path.join(r.controlador!, 'launch.json'), 'utf8'));
      assert.equal(launch.vinculo.thread, t.id); assert.equal(launch.vinculo.promptSha256, event?.promptSha256);
      assert.equal(encerrarController(r.controlador!, launch.vinculo, launch.instancia).ok, true);
    } finally { f.restaurar(); p.limpar(); }
  });
}

test('F8 SIMULADO: binário ausente preserva launch e confirma worker terminal sem inventar PID de runtime', () => {
  const f = controllerSimulado();
  try {
    fs.renameSync(path.join(f.dir, 'fake-bin', 'codex'), path.join(f.dir, 'fake-bin', 'codex.fixture-disabled'));
    process.env.PATH = path.join(f.dir, 'fake-bin');
    const r = f.dispatch(); assert.equal(r.ok, false); assert.ok(r.controlador);
    esperarCondicao(() => !!f.estado(r).processoEncerrado);
    const s = f.estado(r); assert.equal(s.runtimePid, undefined); assert.equal(s.runtimeNaoIniciado, true);
    const ended = encerrarController(r.controlador!, f.vinculo, s.instancia);
    assert.equal(ended.ok, true, ended.evidencia); assert.equal(processoTerminou(s.processoController), true);
  } finally { f.restaurar(); }
});
