import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { EventEmitter } from 'node:events';
import { iniciarWatcher } from '../src/session-watcher';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { novaThread, gravarThread, dirThread, lerThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { encerrarController } from '../src/adapters/codex-controller';

const PROMPT = 'FINALIZAR-SIMULADO: fatia governada do teste';

function cenario(nome: string) {
  const p = projetoTemporario(nome);
  const f = controllerSimulado(p.dir);
  const t = novaThread(p.carregado, { nome: 'sensores', modo: 'auto' }).thread;
  t.faseAtual = 'GO'; gravarThread(p.dir, t);
  return { p, f, t, dir: dirThread(p.dir, t.id), eventos: () => lerLedger(dirThread(p.dir, t.id)),
    limpar: () => { f.restaurar(); p.limpar(); } };
}
function encerrar(controlador: string): void {
  const launch = JSON.parse(fs.readFileSync(path.join(controlador, 'launch.json'), 'utf8'));
  try { encerrarController(controlador, launch.vinculo, launch.instancia, 8000); } catch { /* fixture já terminal */ }
}

for (const operacao of ['phase', 'retry']) {
  test(`despacho ${operacao} por controller registra a fonte e inicia o watcher sem logPath nem chamada manual`, () => {
    const c = cenario('sensores-' + operacao);
    try {
      const prompt = path.join(c.dir, 'prompt.md'); fs.writeFileSync(prompt, PROMPT);
      const sha = createHash('sha256').update(PROMPT).digest('hex');
      const r = operacao === 'phase' ? rodarFase(c.p.carregado, c.t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO', prompt: PROMPT })
        : redespachar(c.p.carregado, c.t, 'GO', prompt, sha, { runtime: 'codex', model: 'modelo-SIMULADO' });
      assert.ok(r.sessionId, 'despacho sem sessão');
      const registro = c.eventos().find(e => e.tipo === 'session_sensor_registered')!;
      assert.ok(registro, 'registro de sensor ausente');
      if (operacao === 'phase') assert.equal((r as ReturnType<typeof rodarFase>).controlador, registro.controlador);
      assert.equal(registro.logPath, undefined);
      assert.equal(registro.processoPath, undefined);
      assert.equal(registro.sessionId, r.sessionId);
      assert.ok(String(registro.controlador).startsWith(path.join(c.dir, 'sessoes') + path.sep));
      const arranque = c.eventos().find(e => e.tipo === 'session_watcher_started')!;
      assert.ok(arranque, 'watcher não foi iniciado pelo despacho');
      assert.equal(arranque.sessionId, r.sessionId);
      const ready = JSON.parse(fs.readFileSync(String(arranque.readyPath), 'utf8'));
      assert.deepEqual(ready.identidade, arranque.identidade);
      assert.equal(ready.token, arranque.token);
      assert.equal(ready.despachoEm, arranque.despachoEm);
      assert.equal(ready.sessionId, r.sessionId);
      assert.ok(fs.readdirSync(path.join(c.dir, 'sessoes')).some(n => n.startsWith('watcher-source-')));
      assert.ok(Number.isSafeInteger(arranque.pid) && Number(arranque.pid) > 0);
      // Prova real: nenhum observarSessao manual neste teste; o resultado vem do watcher automático.
      esperarCondicao(() => lerLedger(c.dir).some(e => e.tipo === 'phase_result'), 40000);
      const resultado = c.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(resultado.sessionId, r.sessionId);
      assert.equal(resultado.exitCodeFonte, 'controller.close');
      assert.equal(resultado.exitCode, 0);
      assert.equal(resultado.classificacao, 'fase_concluida');
      // Ledger sem conteúdo sensível: nenhum prompt, pergunta, resposta ou stderr.
      const texto = JSON.stringify(c.eventos());
      assert.equal(texto.includes(PROMPT), false);
      assert.equal(texto.includes('SIMULADA'), false);
      console.log(JSON.stringify({ operacao, watcherPid: arranque.pid, exitCodeFonte: resultado.exitCodeFonte,
        registros: c.eventos().filter(e => e.tipo === 'session_sensor_registered').length }));
      encerrar(String(registro.controlador));
    } finally { c.limpar(); }
  });
}

test('dry-run e despacho sem vínculo não criam sessão, registro nem observador (TF9 antes do spawn)', () => {
  const c = cenario('sensores-dry-run');
  try {
    const r = rodarFase(c.p.carregado, c.t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO', prompt: PROMPT, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(r.sessionId, null);
    assert.equal(lerThread(c.p.dir, c.t.id).sessoes.length, 0);
    assert.equal(c.eventos().some(e => e.tipo === 'session_sensor_registered'), false);
    assert.equal(c.eventos().some(e => e.tipo === 'session_watcher_started'), false);
    // Nenhum diretório de controller criado: o guard vem antes de qualquer spawn.
    assert.equal(fs.existsSync(path.join(c.dir, 'sessoes')) &&
      fs.readdirSync(path.join(c.dir, 'sessoes')).length > 0, false);
    console.log(JSON.stringify({ dryRunSessoes: 0, dryRunRegistros: 0 }));
  } finally { c.limpar(); }
});

test('fonte inválida do bootstrap não inicia observador e preserva a referência para recuperação', () => {
  const p = projetoTemporario('sensores-falha');
  const f = controllerSimulado(p.dir, { cenario: 'runtime-crash' });
  const t = novaThread(p.carregado, { nome: 'falha', modo: 'auto' }).thread; t.faseAtual = 'GO'; gravarThread(p.dir, t);
  try {
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO', prompt: PROMPT });
    assert.equal(r.sessionId, null);
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.ok(r.controlador);
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.some(e => e.tipo === 'session_sensor_registered'), false);
    assert.equal(eventos.some(e => e.tipo === 'session_watcher_started'), false);
    assert.equal(lerThread(p.dir, t.id).sessoes.length, 0);
    // A referência do controller fica no ledger para recuperação exata, sem sessão fabricada.
    assert.equal(eventos.find(e => e.tipo === 'phase_dispatch_failed')?.controlador, r.controlador);
    console.log(JSON.stringify({ bootstrapFalho: 'runtime.unavailable', observadores: 0 }));
  } finally { f.restaurar(); p.limpar(); }
});


test('TC5: fonte corrompida recusa registro e spawn do observador antes de stderr', () => {
  const c = cenario('sensores-invalid-source');
  const sensor = require('../src/adapters/codex-controller-sensor');
  const original = sensor.registrarFonteController;
  const validar = mock.method(sensor, 'registrarFonteController', (dir: string, esperado: unknown) => {
    const file = path.join(dir, 'state.json');
    // O processo do controlador reescreve state.json de forma assincrona. Escrever a corrupcao
    // uma vez so e torcer: se a reescrita cair entre ela e a leitura do validador, a fonte volta
    // a ser valida, o registro acontece e o teste reprova sem defeito nenhum no produto.
    // Corrompe ate a divergencia GRUDAR no readback, e so entao valida.
    esperarCondicao(() => {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.cwd === '/cwd-divergente') return true;
      fs.writeFileSync(file, JSON.stringify({ ...state, cwd: '/cwd-divergente' }), { mode: 0o600 });
      return false;
    });
    return original(dir, esperado);
  });
  try {
    const r = rodarFase(c.p.carregado, c.t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO', prompt: PROMPT });
    assert.ok(r.sessionId);
    assert.equal(c.eventos().some(e => e.tipo === 'session_sensor_registered'), false);
    assert.equal(c.eventos().some(e => e.tipo === 'session_watcher_started'), false);
    assert.equal(fs.existsSync(path.join(c.dir, `watcher-${r.sessionId}.stderr`)), false);
    const erro = c.eventos().find(e => e.tipo === 'session_watcher_error')!;
    assert.equal(erro.sessionId, r.sessionId); assert.ok(erro.despachoEm);
    assert.equal(erro.motivo, 'runtime.unavailable');
    assert.equal(erro.controlador, lerThread(c.p.dir, c.t.id).sessoes.at(-1)!.controlador);
    assert.ok(validar.mock.callCount() > 0);
    encerrar(lerThread(c.p.dir, c.t.id).sessoes.at(-1)!.controlador!);
  } finally { validar.mock.restore(); c.limpar(); }
});

test('TC5: spawn sem PID e erro assincrono nao registram started; recuperacao tem prontidao real', async () => {
  const c = cenario('sensores-no-pid');
  const cp = require('node:child_process');
  const original = cp.spawn;
  let tentativas = 0;
  const interceptar = mock.method(cp, 'spawn', (...args: any[]) => {
    if (Array.isArray(args[1]) && String(args[1][0]).endsWith('session-watcher.js')) {
      tentativas++;
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => {};
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn simulado'), { code: 'ENOENT' })));
      return child;
    }
    return original(...args);
  });
  try {
    const r = rodarFase(c.p.carregado, c.t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO', prompt: PROMPT });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(tentativas, 1); assert.ok(r.sessionId);
    assert.equal(c.eventos().some(e => e.tipo === 'session_watcher_started'), false);
    const erros = c.eventos().filter(e => e.tipo === 'session_watcher_error');
    assert.ok(erros.length > 0);
    assert.ok(erros.every(e => e.sessionId === r.sessionId && e.despachoEm && e.motivo === 'runtime.unavailable'));
    interceptar.mock.restore();
    // Registro historico sem identidade nao satisfaz idempotencia.
    const sessao = lerThread(c.p.dir, c.t.id).sessoes.at(-1)!;
    require('../src/ledger').registrar(c.dir, c.t.id, 'session_watcher_started', {
      sessionId: r.sessionId, despachoEm: sessao.despachadaEm, pid: null });
    const pid = iniciarWatcher(c.p.dir, r.sessionId!);
    assert.ok(pid > 0);
    const count = c.eventos().filter(e => e.tipo === 'session_watcher_started').length;
    assert.equal(iniciarWatcher(c.p.dir, r.sessionId!), pid);
    assert.equal(c.eventos().filter(e => e.tipo === 'session_watcher_started').length, count);
    esperarCondicao(() => c.eventos().some(e => e.tipo === 'phase_result'), 10000);
    assert.equal(c.eventos().filter(e => e.tipo === 'phase_result').length, 1);
    encerrar(lerThread(c.p.dir, c.t.id).sessoes.at(-1)!.controlador!);
  } finally { interceptar.mock.restore(); c.limpar(); }
});
