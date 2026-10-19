import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { ParserCodex } from '../src/adapters/codex-events';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { observarSessao, reconciliarSessaoSemWatcher, validarFonteWatcher, validarRegistroWatcher } from '../src/session-watcher';
import { caminhoDoTrabalho, gravarRespostaFinalDaSessao } from '../src/trabalho-thread';

const SID = '11111111-2222-4333-8444-555555555555';

function sessaoCodex(nome: string) {
  const p = projetoTemporario(nome);
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const despachadaEm = new Date(Date.now() - 1_000).toISOString();
  t.sessoes.push({ sessionId: SID, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex',
    despachadaEm, promptPath: '', promptSha256: 'a'.repeat(64), verificada: true });
  gravarThread(p.dir, t);
  return { ...p, t, despachadaEm, estado: dirThread(p.dir, t.id) };
}

test('RM-064 T9: task_complete preserva a resposta final e o watcher grava somente o recibo no ledger', () => {
  const p = sessaoCodex('rm064-t9-resposta');
  try {
    const rollout = path.join(p.estado, 'rollout-simulado.jsonl');
    fs.writeFileSync(rollout, [
      { type: 'session_meta', payload: { id: SID } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turno-1' } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turno-1', last_agent_message: '# Fecho\n\nTudo pronto.' } },
    ].map((e) => JSON.stringify(e) + '\n').join(''));

    const observado = observarSessao(p.carregado, SID, { rollout });
    assert.equal(observado.concluido, true);
    const resultados = lerLedger(p.estado).filter((e) => e.tipo === 'phase_result');
    assert.equal(resultados.length, 1, 'o replay idempotente produz um phase_result');
    const recibo = resultados[0].respostaFinal as { arquivo: string; sha256: string; bytes: number; truncada: boolean };
    assert.equal(recibo.arquivo, caminhoDoTrabalho(p.t.id) + `resposta-final-${SID}.md`);
    assert.match(recibo.sha256, /^[a-f0-9]{64}$/);
    assert.equal(recibo.truncada, false);
    assert.equal(JSON.stringify(resultados[0]).includes('Tudo pronto'), false, 'texto não entra no ledger');
    const arquivo = path.join(p.estado, 'trabalho', `resposta-final-${SID}.md`);
    assert.equal(fs.readFileSync(arquivo, 'utf8'), '# Fecho\n\nTudo pronto.');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    observarSessao(p.carregado, SID, { rollout });
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});

test('RM-064 T9: registro estrutural antecede rollout pronto e a validação profunda continua fail-closed', () => {
  const p = sessaoCodex('rm064-t9-corrida');
  try {
    const controlador = path.join(p.estado, 'sessoes', 'controller-ainda-subindo');
    fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
    registrar(p.estado, p.t.id, 'phase_dispatch', { fase: 'GO', sessionId: SID, despachoEm: p.despachadaEm,
      controlador, cwd: p.dir });
    const fonte = { controlador, cwd: p.dir };
    assert.doesNotThrow(() => validarRegistroWatcher(p.dir, SID, fonte));
    assert.throws(() => validarFonteWatcher(p.dir, SID, fonte), /runtime\.unavailable/);
    registrar(p.estado, p.t.id, 'session_sensor_registered', { fase: 'GO', sessionId: SID,
      despachoEm: p.despachadaEm, ...fonte });
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'session_sensor_registered').length, 1);
  } finally { p.limpar(); }
});

test('RM-064 T9 segurança: resposta final é limitada, privada e idempotente sem sobrescrita', () => {
  const p = sessaoCodex('rm064-t9-limite');
  try {
    const primeira = gravarRespostaFinalDaSessao(p.dir, p.t.id, SID, 'a'.repeat(300 * 1024));
    assert.equal(primeira.truncada, true);
    assert.equal(primeira.bytes, 256 * 1024);
    assert.deepEqual(gravarRespostaFinalDaSessao(p.dir, p.t.id, SID, 'a'.repeat(300 * 1024)), primeira);
    assert.throws(() => gravarRespostaFinalDaSessao(p.dir, p.t.id, SID, 'outra resposta'), /divergente/);
  } finally { p.limpar(); }
});

test('RM-064 T9 parser: mensagem anterior também acompanha o terminal sem last_agent_message', () => {
  const parser = new ParserCodex();
  const eventos = [
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turno-1' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Parecer final simulado.' } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turno-1' } },
  ].map((e) => JSON.stringify(e) + '\n').join('');
  assert.equal(parser.push(eventos).at(-1)?.respostaFinal, 'Parecer final simulado.');
});

function prepararControllerEncerrado(p: ReturnType<typeof sessaoCodex>, baseMs: number): void {
  const sessoes = path.join(p.estado, 'sessoes');
  const controlador = path.join(sessoes, 'controller-simulado');
  fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
  fs.chmodSync(sessoes, 0o700);
  const uid = process.getuid?.() ?? -1;
  const identidade = (pid: number, cwd: string) => ({ pid, uid, inicio: '1', bootId: 'boot-simulado',
    executavel: process.execPath, cwd });
  const processoController = identidade(2_000_000_001, controlador);
  const processoRuntime = identidade(2_000_000_002, p.dir);
  const instancia = '99999999-8888-4777-8666-555555555555';
  const vinculo = { thread: p.t.id, fase: 'GO', promptSha256: 'a'.repeat(64) };
  const rollout = path.join(sessoes, 'rollout-simulado-controller.jsonl');
  fs.writeFileSync(rollout, [
    { type: 'session_meta', payload: { id: SID, cwd: p.dir } },
    { type: 'event_msg', timestamp: new Date(baseMs + 1_100).toISOString(),
      payload: { type: 'task_started', turn_id: 'turno-1' } },
    { type: 'event_msg', timestamp: new Date(baseMs + 2_000).toISOString(),
      payload: { type: 'task_complete', turn_id: 'turno-1', last_agent_message: 'Resposta recuperada pela batida.' } },
  ].map((e) => JSON.stringify(e) + '\n').join(''), { mode: 0o600 });
  const escrever = (nome: string, valor: unknown) => fs.writeFileSync(path.join(controlador, nome), JSON.stringify(valor), { mode: 0o600 });
  escrever('launch.json', { contrato: 'ork.controller-launch/v1', instancia, vinculo, cwd: p.dir,
    criadoEm: new Date(baseMs).toISOString() });
  escrever('process-launch.json', { instancia, pid: processoController.pid, processoController });
  escrever('state.json', { instancia, vinculo, cwd: p.dir, sessionId: SID, pid: processoController.pid,
    processoController, processoRuntime, rollout, turno: 'turno-1', estado: 'completed',
    terminal: { metodo: 'turn/completed', threadId: SID, turnId: 'turno-1', status: 'completed' },
    processoEncerrado: { em: new Date(baseMs + 2_000).toISOString(), code: 0, signal: null } });
  registrar(p.estado, p.t.id, 'phase_dispatch', { ts: p.despachadaEm, fase: 'GO', sessionId: SID,
    despachoEm: p.despachadaEm, controlador, cwd: p.dir, promptSha256: 'a'.repeat(64) });
}

test('RM-064 T9: batida recompõe sensor ausente, lê task_complete e grava um único resultado', () => {
  const p = sessaoCodex('rm064-t9-reconciliacao');
  try {
    const baseMs = Date.parse(p.despachadaEm) - 1_000;
    prepararControllerEncerrado(p, baseMs);
    const r = reconciliarSessaoSemWatcher(p.carregado, p.t.id, baseMs + 3_000);
    assert.deepEqual([r.estado, r.sessionId], ['concluida', SID]);
    const eventos = lerLedger(p.estado);
    assert.equal(eventos.filter((e) => e.tipo === 'session_sensor_registered').length, 1);
    const resultados = eventos.filter((e) => e.tipo === 'phase_result');
    assert.equal(resultados.length, 1);
    assert.deepEqual([resultados[0].ok, resultados[0].conclusaoNativa], [true, true]);
    assert.equal(fs.readFileSync(path.join(p.estado, 'trabalho', `resposta-final-${SID}.md`), 'utf8'),
      'Resposta recuperada pela batida.');
    assert.equal(reconciliarSessaoSemWatcher(p.carregado, p.t.id, baseMs + 4_000).estado, 'ignorada');
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});

test('RM-064 T9: fonte indisponível por dez minutos vira parada tipada e idempotente', () => {
  const p = sessaoCodex('rm064-t9-parada');
  try {
    const controlador = path.join(p.estado, 'sessoes', 'controller-incompleto');
    fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
    registrar(p.estado, p.t.id, 'phase_dispatch', { ts: p.despachadaEm, fase: 'GO', sessionId: SID,
      despachoEm: p.despachadaEm, controlador, cwd: p.dir, promptSha256: 'a'.repeat(64) });
    const limite = Date.parse(p.despachadaEm) + 600_001;
    const r = reconciliarSessaoSemWatcher(p.carregado, p.t.id, limite);
    assert.equal(r.estado, 'parada');
    const eventos = lerLedger(p.estado);
    const resultado = eventos.find((e) => e.tipo === 'phase_result')!;
    assert.deepEqual([resultado.classificacao, resultado.motivo, resultado.origem, resultado.morteLatenciaMs],
      ['gate_blocked', 'runtime.unavailable', 'conducao.batida', 600_001]);
    assert.equal(eventos.filter((e) => e.tipo === 'gate_blocked').length, 1);
    assert.equal(reconciliarSessaoSemWatcher(p.carregado, p.t.id, limite + 1).estado, 'ignorada');
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});
