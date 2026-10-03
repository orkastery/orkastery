import { strict as assert } from 'node:assert';
import { test, TestContext } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { projetoTemporario } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { identidadeDoProcesso } from '../src/adapters/codex-controller';
import { acompanharSessao, observarSessao, LIMITE_MORTE_MS, MAX_ESPERA_ERRO_WATCH_MS } from '../src/session-watcher';

const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const INSTANCIA = '11111111-2222-3333-4444-555555555555';
const linha = (e: unknown) => JSON.stringify(e) + '\n';

function fixture(teste: TestContext) {
  const p = projetoTemporario('rm036-longo');
  const t = novaThread(p.carregado, { nome: 'watch', modo: 'auto' }).thread;
  const despachadaEm = new Date(BASE + 1000).toISOString();
  const promptSha256 = 'a'.repeat(64);
  t.sessoes.push({ sessionId: SID, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex',
    despachadaEm, promptPath: '', promptSha256, verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id), sessoes = path.join(dir, 'sessoes');
  const controlador = path.join(sessoes, 'controller-' + INSTANCIA);
  fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
  const filhos = [controlador, p.dir].map(cwd => spawn(process.execPath,
    ['-e', 'setInterval(() => {}, 3600000)'], { cwd, stdio: 'ignore' }));
  teste.after(async () => {
    await Promise.all(filhos.map(async filho => {
      if (filho.exitCode !== null || filho.signalCode !== null) return;
      const fim = once(filho, 'close'); filho.kill(); await fim;
    }));
    p.limpar();
  });
  const [controller, runtime] = filhos.map(f => identidadeDoProcesso(f.pid!));
  const roll = path.join(sessoes, 'rollout.jsonl');
  fs.writeFileSync(roll, linha({ type: 'session_meta', payload: { id: SID, cwd: p.dir } }), { mode: 0o600 });
  const vinculo = { thread: t.id, fase: 'GO', promptSha256 };
  const escrever = (nome: string, dado: unknown) => fs.writeFileSync(path.join(controlador, nome), JSON.stringify(dado), { mode: 0o600 });
  const state = { instancia: INSTANCIA, vinculo, cwd: p.dir, sessionId: SID, pid: controller.pid,
    processoController: controller, processoRuntime: runtime, rollout: roll, turno: 'turn-1', estado: 'working' };
  escrever('launch.json', { contrato: 'ork.controller-launch/v1', instancia: INSTANCIA, vinculo,
    cwd: p.dir, criadoEm: new Date(BASE).toISOString() });
  escrever('process-launch.json', { instancia: INSTANCIA, pid: controller.pid, processoController: controller });
  escrever('state.json', state);
  registrar(dir, t.id, 'phase_dispatch', { sessionId: SID, controlador, cwd: p.dir, fase: 'GO', promptSha256 });
  registrar(dir, t.id, 'session_sensor_registered', { sessionId: SID, despachoEm: despachadaEm, controlador, cwd: p.dir });
  const evento = (ms: number, payload: unknown) => {
    fs.appendFileSync(roll, linha({ type: 'event_msg', timestamp: new Date(BASE + ms).toISOString(), payload }));
    fs.utimesSync(roll, (BASE + ms) / 1000, (BASE + ms) / 1000);
  };
  evento(1000, { type: 'task_started', turn_id: 'turn-1' });
  const progresso = (ms: number) => evento(ms, { type: 'agent_message', message: 'Progresso da fixture', turn_id: 'turn-1' });
  const terminar = (ms: number) => {
    evento(ms, { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'Concluído.' });
    escrever('state.json', { ...state, estado: 'completed', terminal: { metodo: 'turn/completed',
      threadId: SID, turnId: 'turn-1', status: 'completed' },
      processoEncerrado: { em: new Date(BASE + ms).toISOString(), code: 0, signal: null } });
  };
  return { ...p, t, dirEstado: dir, controlador, state, escrever, progresso, terminar,
    eventos: () => lerLedger(dir),
    run: (ms: number) => observarSessao(p.carregado, SID, { agoraMs: BASE + ms, threadId: t.id }) };
}

test('RM036: Codex vivo progride além de dez minutos e só conclui no terminal nativo', async t => {
  const p = fixture(t);
  assert.equal(p.run(2000).concluido, false);
  p.progresso(LIMITE_MORTE_MS + 2000);
  // Reproduz o erro anterior ao catch: a resolução global lia JSON de outra thread em escrita.
  const alheia = novaThread(p.carregado, { nome: 'alheia', modo: 'auto' }).thread;
  fs.writeFileSync(path.join(dirThread(p.dir, alheia.id), 'thread.json'), '{"segredo-fixture":');
  assert.equal(p.run(LIMITE_MORTE_MS + 2000).concluido, false);
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
  let agora = LIMITE_MORTE_MS + 3000;
  await acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + agora,
    esperar: async () => { agora += 1000; p.terminar(agora); } });
  assert.equal(p.run(agora + 1).concluido, true);
  const resultados = p.eventos().filter(e => e.tipo === 'phase_result');
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].conclusaoNativa, true);
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[0].exitCodeFonte, 'controller.close');
});

for (const falha of ['json-thread', 'json-state', 'ENOENT', 'lock'] as const) {
  test(`RM036: laço registra e repete ${falha} com espera limitada até terminal`, async t => {
    const p = fixture(t);
    p.run(2000); p.progresso(601000);
    const threadFile = path.join(p.dirEstado, 'thread.json');
    const backup = fs.readFileSync(threadFile);
    const lock = path.join(p.dirEstado, 'ledger.jsonl.hitl-lock');
    if (falha === 'json-thread') fs.writeFileSync(threadFile, '{"segredo-fixture":');
    if (falha === 'json-state') fs.writeFileSync(path.join(p.controlador, 'state.json'), '{"segredo-fixture":');
    if (falha === 'ENOENT') fs.renameSync(path.join(p.controlador, 'state.json'), path.join(p.controlador, 'state.backup'));
    if (falha === 'lock') { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); }
    const esperas: number[] = [];
    let agora = 602000;
    await acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + agora,
      esperar: async ms => {
        esperas.push(ms); agora += ms;
        assert.ok(esperas.length <= 9, 'loop precisa recuperar');
        if (esperas.length < 8) return;
        fs.writeFileSync(threadFile, backup);
        if (falha === 'lock') fs.rmSync(lock, { recursive: true });
        p.terminar(agora);
      } });
    assert.equal(esperas.length, 8);
    assert.ok(esperas.every(ms => ms > 0 && ms <= MAX_ESPERA_ERRO_WATCH_MS));
    const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
    assert.equal(erros.length, 8);
    assert.ok(erros.every(e => e.sessionId === SID && e.transitorio === true));
    assert.ok(!JSON.stringify(erros).includes('segredo-fixture'));
    assert.ok(!JSON.stringify(erros).includes(p.dir));
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result' && e.ok === true).length, 1);
  });
}

test('RM036: erro permanente registra diagnóstico sanitizado antes de sair, sem resultado', async t => {
  const p = fixture(t);
  p.run(2000);
  p.escrever('state.json', { ...p.state, sessionId: 'outra-sessao-segredo-fixture' });
  await assert.rejects(acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + 700000,
    esperar: async () => assert.fail('erro de identidade não pode repetir') }), /sessão do controller divergente/);
  const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
  assert.equal(erros.length, 1);
  assert.equal(erros[0].transitorio, false);
  assert.ok(!JSON.stringify(erros).includes('segredo-fixture'));
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
});
