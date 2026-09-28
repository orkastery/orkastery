import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { observarSessao, BLOCO_WATCH_BYTES } from '../src/session-watcher';
import { identidadeProcesso } from '../src/adapters/codex-runner';
import { acharRollout } from '../src/adapters/codex';
import { executarRetry, planejarRetry } from '../src/retry';
const inicio = Date.parse('2026-09-01T00:00:00.000Z');
const sid = '11111111-2222-3333-4444-555555555555';
const linha = (e: unknown) => JSON.stringify(e) + '\n';
function fixture(pidConhecido = true) {
  const p = projetoTemporario('watcher');
  const t = novaThread(p.carregado, { nome: 'watch', modo: 'auto' }).thread;
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex', despachadaEm: new Date(inicio).toISOString(),
    promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id), log = path.join(dir, 'sessoes', 'fixture.codex.jsonl');
  fs.mkdirSync(path.dirname(log));
  fs.writeFileSync(log, linha({ type: 'thread.started', thread_id: sid }));
  fs.utimesSync(log, inicio / 1000, inicio / 1000);
  const processo = { schema: 'ork.codex-process/v1', iniciadoEm: new Date(inicio).toISOString(),
    supervisor: identidadeProcesso(process.pid), filho: pidConhecido ? { ...identidadeProcesso(process.pid), inicio: '0' } : null };
  fs.writeFileSync(log + '.process.json', JSON.stringify(processo));
  registrar(dir, t.id, 'session_sensor_registered', { sessionId: sid, despachoEm: t.sessoes[0].despachadaEm,
    logPath: log, processoPath: log + '.process.json', reciboPath: log + '.exit.json' });
  const run = (ms: number) => observarSessao(p.carregado, sid, { agoraMs: inicio + ms, rollout: null });
  const receipt = (exitCode = 0) => fs.writeFileSync(log + '.exit.json', JSON.stringify({ ...processo,
    terminadoEm: new Date(inicio + 100).toISOString(), exitCode, signal: null, duracaoMs: 100, erro: null }));
  return { ...p, t, dirEstado: dir, log, run, receipt, eventos: () => lerLedger(dir) };
}

for (const [motivo, acao] of [['cost.violation', 'sem-retry'], ['policy.violation', 'escalar-humano'],
  ['ci.failed', 'escalar-humano']] as const) {
  test(`GO-FIX5: supervisor preserva ${motivo} no exit 1 sem retry automático`, () => {
    const p = fixture();
    try {
      fs.appendFileSync(p.log, linha({ type: 'turn.failed', reason: motivo }));
      p.receipt(1);
      assert.equal(p.run(1000).classificacao, 'gate_blocked');
      const result = p.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(result.motivo, motivo);
      assert.equal(result.exitCode, 1);
      assert.equal(result.exitCodeFonte, 'supervisor.close');
      assert.equal(result.ok, false);
      const retry = executarRetry(p.carregado, p.t.id);
      assert.equal(retry.plano.acao, acao);
      assert.equal(retry.plano.automatica, false);
      assert.equal(retry.executada, false);
      assert.equal(retry.redespacho, null);
      assert.equal(p.eventos().some(e => e.tipo === 'retry_attempt'), false);
    } finally { p.limpar(); }
  });
}

test('GO-FIX4: supervisor preserva rate limit no exit 1 e mantém retry esperar-janela', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.failed', reason: 'runtime.rate-limited' }));
    p.receipt(1);
    assert.equal(p.run(1000).classificacao, 'gate_blocked');
    const result = p.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(result.motivo, 'runtime.rate-limited');
    assert.equal(result.exitCodeFonte, 'supervisor.close');
    assert.equal(result.ok, false);
    assert.equal(planejarRetry(p.carregado, p.t.id).acao, 'esperar-janela');
  } finally { p.limpar(); }
});

test('fronteira 599999/600000 ms, restart de sessão morta e ausência de PID não inventam morte', () => {
  const p = fixture(), q = fixture(false);
  try {
    assert.equal(p.run(599999).concluido, false);
    const morto = p.run(600000); assert.equal(morto.concluido, true);
    assert.equal(p.eventos().filter(e => e.tipo === 'sessao_morta').length, 1);
    assert.equal(p.eventos().find(e => e.tipo === 'sessao_morta')?.morteLatenciaMs, 600000);
    assert.equal(p.run(700000).concluido, true);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
    assert.equal(q.run(900000).classificacao, 'gate_blocked');
    assert.equal(q.eventos().find(e => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable');
    assert.equal(q.eventos().filter(e => e.tipo === 'sessao_morta').length, 0);
    console.log(JSON.stringify({ deathLatencyMs: 600000, duplicateResults: 0 }));
  } finally { p.limpar(); q.limpar(); }
});

test('término é associado ao recibo real e pergunta permanece gate humano mesmo com exit 0', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'item.completed', item: { type: 'agent_message', text: 'Você confirma a opção?' } }) +
      linha({ type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 4 } }));
    assert.equal(p.run(1000).concluido, false);
    p.receipt(); assert.equal(p.run(1001).classificacao, 'human.pending');
    const r = p.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(r.exitCode, 0); assert.equal(r.ok, false); assert.equal(r.motivo, 'human.pending');
    assert.equal(r.duracaoMs, 100); assert.equal((r.tokens as { input: number }).input, 20);
    assert.equal(p.eventos().filter(e => e.tipo === 'human.pending').length, 1);
    assert.equal(p.eventos().filter(e => e.tipo === 'human_gate' || e.tipo === 'gate_passed').length, 0);
    const n = p.eventos().length; p.run(2000); assert.equal(p.eventos().length, n);
  } finally { p.limpar(); }
});

test('cursor incremental retoma linhas parciais, limita leitura e não emite heartbeat artificial', () => {
  const p = fixture();
  try {
    p.run(10); const antes = p.eventos().length; p.run(11); assert.equal(p.eventos().length, antes);
    fs.appendFileSync(p.log, linha({ type: 'unknown' }).repeat(100000));
    const r = p.run(20); assert.ok(r.bytesLidos <= BLOCO_WATCH_BYTES);
    for (let i = 0; i < 4; i++) p.run(21 + i);
    fs.appendFileSync(p.log, '{"type":"turn.completed"'); p.run(30);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
    fs.appendFileSync(p.log, '}\n'); p.receipt();
    assert.equal(p.run(1000).concluido, true);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});

test('lock recupera identidade morta e duas instâncias concorrentes persistem um único resultado', async () => {
  const p = fixture();
  try {
    p.run(10);
    const sensor = path.join(p.dirEstado, 'sensores', fs.readdirSync(path.join(p.dirEstado, 'sensores'))[0]);
    fs.mkdirSync(path.join(sensor, 'watch.lock'));
    fs.writeFileSync(path.join(sensor, 'watch.lock/owner.json'), JSON.stringify({ identidade: { ...identidadeProcesso(process.pid), inicio: '0' }, token: 'morto' }));
    assert.equal(p.run(20).ocupado, undefined);
    fs.appendFileSync(p.log, linha({ type: 'turn.completed' })); p.receipt();
    const script = `const {exigirManifesto}=require(${JSON.stringify(require.resolve('../src/manifest'))});require(${JSON.stringify(require.resolve('../src/session-watcher'))}).observarSessao(exigirManifesto(${JSON.stringify(p.dir)}),${JSON.stringify(sid)},{rollout:null});`;
    await Promise.all([1, 2].map(() => new Promise<void>((resolve, reject) => {
      const c = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = ''; c.stderr!.on('data', b => { stderr += b; });
      c.on('error', reject); c.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr}`)));
    })));
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
    // Após rotação/replay, o resultado do despacho continua único.
    fs.renameSync(p.log, p.log + '.old'); fs.writeFileSync(p.log, linha({ type: 'turn.completed' }));
    p.run(2000); assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});

test('dono que solta o lock no meio do recovery não derruba o outro observador: ele assume e grava um único resultado', () => {
  const p = fixture();
  try {
    p.run(10);
    fs.appendFileSync(p.log, linha({ type: 'turn.completed' })); p.receipt();
    const sensor = path.join(p.dirEstado, 'sensores', fs.readdirSync(path.join(p.dirEstado, 'sensores'))[0]);
    const lock = path.join(sensor, 'watch.lock');
    // Dono vivo com o lock recém-criado, ainda sem owner.json: o segundo observador cai no recovery.
    fs.mkdirSync(lock);
    // A corrida do CI, sem depender de tempo: o dono solta o lock entre o EEXIST e a leitura da idade dele.
    const fsReal = require('node:fs'), statReal = fsReal.statSync;
    const stat = mock.method(fsReal, 'statSync', (alvo: fs.PathLike, ...resto: unknown[]) => {
      if (String(alvo) === lock && fsReal.existsSync(lock)) fsReal.rmdirSync(lock);
      return statReal(alvo, ...resto);
    });
    try { assert.equal(p.run(1000).ocupado, undefined); } finally { stat.mock.restore(); }
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
    assert.equal(fs.existsSync(lock), false, 'o lock assumido é devolvido ao fim');
  } finally { p.limpar(); }
});

test('recibo incompatível e fonte fora do estado canônico são recusados', () => {
  const p = fixture();
  try {
    p.receipt(); const receipt = JSON.parse(fs.readFileSync(p.log + '.exit.json', 'utf8'));
    receipt.iniciadoEm = 'invalido'; fs.writeFileSync(p.log + '.exit.json', JSON.stringify(receipt));
    assert.throws(() => p.run(1000), /recibo/);
    registrar(p.dirEstado, p.t.id, 'session_sensor_registered', { sessionId: sid, despachoEm: new Date(inicio).toISOString(), logPath: '/tmp/fora' });
    assert.throws(() => p.run(1000), /fora/);
  } finally { p.limpar(); }
});

test('log registrado com identidade diferente não produz resultado de outra sessão', () => {
  const p = fixture();
  try {
    fs.writeFileSync(p.log, linha({ type: 'thread.started', thread_id: 'outra' }) + linha({ type: 'turn.completed' }));
    p.receipt(); assert.throws(() => p.run(1000), /outra sessão/);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
  } finally { p.limpar(); }
});

test('A1: resíduo menor que um bloco contém o último turno e deve ser consumido', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.started' }) + linha({ type: 'turn.completed' }) +
      linha({ type: 'unknown' }).repeat(Math.ceil(BLOCO_WATCH_BYTES / 19)) +
      linha({ type: 'turn.started' }) + linha({ type: 'turn.completed', last_agent_message: 'Você confirma?' }));
    p.receipt(); assert.equal(p.run(1000).concluido, false);
    assert.equal(p.run(1001).classificacao, 'human.pending');
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});

test('A2: turno aberto posterior não herda terminal antigo, inclusive sem supervisor', () => {
  const p = fixture();
  try {
    registrar(p.dirEstado, p.t.id, 'session_sensor_registered', { sessionId: sid,
      despachoEm: new Date(inicio).toISOString(), logPath: p.log });
    fs.appendFileSync(p.log, linha({ type: 'turn.started' }) + linha({ type: 'turn.completed' }) + linha({ type: 'turn.started' }));
    assert.equal(p.run(1000).concluido, false);
    fs.appendFileSync(p.log, linha({ type: 'turn.completed', last_agent_message: 'Você confirma?' }));
    assert.equal(p.run(1001).classificacao, 'human.pending');
  } finally { p.limpar(); }
});

test('A3: EOF parcial com recibo bloqueia e sem recibo tem prazo de dez minutos', () => {
  for (const comRecibo of [true, false]) {
    const p = fixture();
    try {
      fs.appendFileSync(p.log, linha({ type: 'turn.completed' }) + '{"type":"turn.started"');
      fs.utimesSync(p.log, inicio / 1000, inicio / 1000);
      if (comRecibo) p.receipt();
      else assert.equal(p.run(599999).concluido, false);
      assert.equal(p.run(comRecibo ? 1000 : 600000).classificacao, 'gate_blocked');
      assert.equal(p.eventos().find(e => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable');
    } finally { p.limpar(); }
  }
});

test('A4: rotação/truncamento preserva invalidação e observa crescimento', () => {
  for (const rotacao of [true, false]) {
    const p = fixture();
    try {
      fs.appendFileSync(p.log, '{invalido\n' + linha({ type: 'unknown' }).repeat(50)); p.run(1000);
      if (rotacao) fs.renameSync(p.log, p.log + '.old');
      fs.writeFileSync(p.log, linha({ type: 'turn.completed' }));
      fs.utimesSync(p.log, (inicio + 2000) / 1000, (inicio + 2000) / 1000); p.receipt();
      assert.equal(p.run(2000).classificacao, 'gate_blocked');
      assert.equal(p.eventos().filter(e => e.tipo === 'runtime_heartbeat').at(-1)?.ts, new Date(inicio + 2000).toISOString());
    } finally { p.limpar(); }
  }
});

test('A5: turno novo vence falha antiga da outra fonte sem misturar usage', () => {
  const p = fixture();
  try {
    const rollout = path.join(p.dir, 'rollout.jsonl');
    const old = linha({ timestamp: new Date(inicio + 100).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'a' } }) +
      linha({ timestamp: new Date(inicio + 110).toISOString(), type: 'event_msg', payload: { type: 'task_failed', turn_id: 'a', usage: { input_tokens: 77, output_tokens: 8 } } });
    fs.writeFileSync(rollout, old);
    fs.appendFileSync(p.log, linha({ type: 'turn.started' }) + linha({ type: 'turn.failed' }) +
      linha({ type: 'turn.started' }) + linha({ type: 'turn.completed' }));
    p.receipt();
    assert.equal(observarSessao(p.carregado, sid, { agoraMs: inicio + 1000, rollout }).classificacao, 'fase_concluida');
    const result = p.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal((result.tokens as { disponivel: boolean }).disponivel, false);
    assert.equal(result.fonteVencedora, 'stream');
  } finally { p.limpar(); }
});

test('A6: erro de recibo deixa diagnóstico persistido e pode retomar após correção', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.completed' })); p.receipt();
    fs.writeFileSync(p.log + '.exit.json', '{');
    assert.throws(() => p.run(1000));
    assert.equal(p.eventos().filter(e => e.tipo === 'session_watcher_error').length, 1);
    p.receipt(); assert.equal(p.run(1001).concluido, true);
  } finally { p.limpar(); }
});

test('A8: filho nulo sem recibo termina indisponível sem afirmar morte', () => {
  const p = fixture(false);
  try {
    assert.equal(p.run(599999).concluido, false);
    assert.equal(p.run(600000).classificacao, 'gate_blocked');
    assert.equal(p.eventos().find(e => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable');
    assert.equal(p.eventos().filter(e => e.tipo === 'sessao_morta').length, 0);
  } finally { p.limpar(); }
});

test('A6: descoberta exige sufixo exato e rollout alheio é descartado sem matar stream', () => {
  const p = fixture(), anterior = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = path.join(p.dir, 'codex');
    const dir = path.join(process.env.CODEX_HOME, 'sessions/2026/09/01'); fs.mkdirSync(dir, { recursive: true });
    const errado = path.join(dir, `rollout-ts-${sid}-outra.jsonl`);
    fs.writeFileSync(errado, linha({ type: 'session_meta', payload: { id: 'outra' } }) + linha({ type: 'turn.failed' }));
    assert.equal(acharRollout(sid), null);
    const certo = path.join(dir, `rollout-ts-${sid}.jsonl`); fs.writeFileSync(certo, '');
    assert.equal(acharRollout(sid), certo);
    fs.appendFileSync(p.log, linha({ type: 'turn.completed' })); p.receipt();
    assert.equal(observarSessao(p.carregado, sid, { agoraMs: inicio + 1000, rollout: errado }).classificacao, 'fase_concluida');
    assert.equal(p.eventos().filter(e => e.tipo === 'session_watcher_source_rejected').length, 1);
  } finally { if (anterior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = anterior; p.limpar(); }
});

test('A5: timestamp de evento vence contagem local de turnos e ordem de leitura', () => {
  for (const streamNovo of [true, false]) {
    const p = fixture();
    try {
      const velho = linha({ type: 'turn.started', turn_id: 'a' }) + linha({ type: 'turn.started', turn_id: 'b' }) +
        linha({ timestamp: new Date(inicio + 100).toISOString(), type: 'turn.failed', turn_id: 'b' });
      const novo = linha({ type: 'turn.started', turn_id: 'c' }) + linha({ timestamp: new Date(inicio + 200).toISOString(),
        type: 'turn.completed', turn_id: 'c', usage: { input_tokens: 9, output_tokens: 2 } });
      const rollout = path.join(p.dir, 'rollout.jsonl');
      fs.appendFileSync(p.log, streamNovo ? novo : velho); fs.writeFileSync(rollout, streamNovo ? velho : novo);
      // Uma primeira leitura sem recibo não determina a ordem temporal.
      observarSessao(p.carregado, sid, { agoraMs: inicio + 500, rollout }); p.receipt();
      assert.equal(observarSessao(p.carregado, sid, { agoraMs: inicio + 1000, rollout }).classificacao, 'fase_concluida');
      const result = p.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(result.turnId, 'c'); assert.equal(result.observadoEm, new Date(inicio + 200).toISOString());
      assert.equal((result.tokens as { input: number }).input, 9);
    } finally { p.limpar(); }
  }
});

test('A2/A8: processo ausente com turno aberto e sem recibo expira como indisponível', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.started' })); fs.utimesSync(p.log, inicio / 1000, inicio / 1000);
    assert.equal(p.run(599999).concluido, false);
    assert.equal(p.run(600000).classificacao, 'gate_blocked');
    assert.equal(p.eventos().find(e => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable');
  } finally { p.limpar(); }
});

test('A5-B2: rollout atrasado no mesmo turno não invalida terminal confirmado pelo stream', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.started' }) + linha({ type: 'turn.completed' }));
    const rollout = path.join(p.dir, 'rollout.jsonl');
    fs.writeFileSync(rollout, linha({ type: 'event_msg', payload: { type: 'task_started', turn_id: 'a' } }));
    p.receipt();
    assert.equal(observarSessao(p.carregado, sid, { agoraMs: inicio + 1000, rollout }).classificacao, 'fase_concluida');
  } finally { p.limpar(); }
});

test('A5-B2: início com timestamp posterior impede terminal de outra fonte apesar da contagem menor', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.started' }) + linha({ type: 'turn.started' }) +
      linha({ timestamp: new Date(inicio + 100).toISOString(), type: 'turn.completed' }));
    const rollout = path.join(p.dir, 'rollout.jsonl');
    fs.writeFileSync(rollout, linha({ timestamp: new Date(inicio + 200).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: 'novo' } }));
    p.receipt();
    assert.equal(observarSessao(p.carregado, sid, { agoraMs: inicio + 1000, rollout }).classificacao, 'gate_blocked');
  } finally { p.limpar(); }
});


test('TC4: restart em outro processo preserva prazo e ruido nao gera heartbeat', () => {
  const p = fixture();
  try {
    fs.appendFileSync(p.log, linha({ type: 'turn.started' }));
    fs.utimesSync(p.log, (inicio + 1000) / 1000, (inicio + 1000) / 1000);
    assert.equal(p.run(2000).concluido, false);
    fs.appendFileSync(p.log, linha({ type: 'unknown' }).repeat(20));
    fs.utimesSync(p.log, (inicio + 600999) / 1000, (inicio + 600999) / 1000);
    const script = `const {exigirManifesto}=require(${JSON.stringify(require.resolve('../src/manifest'))});
      const r=require(${JSON.stringify(require.resolve('../src/session-watcher'))}).observarSessao(
        exigirManifesto(${JSON.stringify(p.dir)}),${JSON.stringify(sid)}, {rollout:null,agoraMs:${inicio + 600999}});
      require('node:assert/strict').equal(r.concluido,false);`;
    execFileSync(process.execPath, ['-e', script]);
    assert.equal(p.run(601000).classificacao, 'gate_blocked');
    assert.equal(p.eventos().find(e => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable');
    assert.equal(p.eventos().filter(e => e.tipo === 'runtime_heartbeat').length, 1);
  } finally { p.limpar(); }
});
