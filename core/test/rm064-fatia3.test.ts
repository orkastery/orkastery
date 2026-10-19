import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { ParserCodex } from '../src/adapters/codex-events';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { observarSessao, validarFonteWatcher, validarRegistroWatcher } from '../src/session-watcher';
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
