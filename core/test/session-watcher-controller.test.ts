import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { observarSessao } from '../src/session-watcher';
import { executarRetry, planejarRetry } from '../src/retry';
import { spawn, execFileSync } from 'node:child_process';
import { identidadeDoProcesso, lerEstadoController, IdentidadeProcesso } from '../src/adapters/codex-controller';

const BASE = Date.parse('2026-09-01T00:00:00.000Z');
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const INSTANCIA = '11111111-2222-3333-4444-555555555555';
const linha = (e: unknown) => JSON.stringify(e) + '\n';

/** Processo proprio do teste, nascido no cwd que a fonte do controller tera de provar. */
function processoProprio(cwd: string): { identidade: IdentidadeProcesso; encerrar: () => void } {
  const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], { cwd, stdio: 'ignore' });
  if (!filho.pid) throw new Error('fixture sem pid do processo proprio');
  const identidade = identidadeDoProcesso(filho.pid);
  return { identidade, encerrar: () => {
    try { if (JSON.stringify(identidadeDoProcesso(identidade.pid)) !== JSON.stringify(identidade)) return; }
    catch { return; }
    filho.kill('SIGKILL');
  } };
}

/** Controller governado sintético: mesma validação de fonte, estado sob controle do teste. */
function fixtureControlador(estadoExtra: Record<string, unknown>, rollout: string[], opcoes: { vivo?: boolean; registro?: (sessoes: string) => Record<string, unknown> } = {}) {
  const p = projetoTemporario('watcher-controlador');
  const t = novaThread(p.carregado, { nome: 'watch', modo: 'auto' }).thread;
  const despachadaEm = new Date(BASE + 1000).toISOString();
  const promptSha256 = createHash('sha256').update('prompt SIMULADO').digest('hex');
  t.sessoes.push({ sessionId: SID, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex',
    despachadaEm, promptPath: '', promptSha256, verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id), sessoes = path.join(dir, 'sessoes');
  fs.mkdirSync(sessoes, { recursive: true, mode: 0o700 });
  const controlador = path.join(sessoes, 'controller-' + INSTANCIA);
  fs.mkdirSync(controlador, { mode: 0o700 });
  const roll = path.join(sessoes, 'rollout.jsonl');
  // O cwd do despacho so existe aqui: o session_meta do rollout precisa carrega-lo.
  fs.writeFileSync(roll, rollout.join('').split('__CWD__').join(p.dir), { mode: 0o600 });
  fs.utimesSync(roll, (BASE + 1000) / 1000, (BASE + 1000) / 1000);
  // Controller nasce no diretorio de IPC; runtime, no cwd do despacho.
  const proprioControlador = processoProprio(controlador), proprioRuntime = processoProprio(p.dir);
  const vivo = proprioControlador.identidade;
  const runtime = proprioRuntime.identidade;
  const identidade = opcoes.vivo === false ? { ...runtime, inicio: '0' } : runtime;
  const vinculo = { thread: t.id, fase: 'GO', promptSha256 };
  const escrever = (nome: string, valor: unknown) => fs.writeFileSync(path.join(controlador, nome), JSON.stringify(valor), { mode: 0o600 });
  escrever('launch.json', { contrato: 'ork.controller-launch/v1', instancia: INSTANCIA, vinculo, cwd: p.dir,
    criadoEm: new Date(BASE).toISOString() });
  escrever('process-launch.json', { instancia: INSTANCIA, pid: vivo.pid, processoController: vivo });
  escrever('state.json', { instancia: INSTANCIA, vinculo, cwd: p.dir, sessionId: SID, pid: vivo.pid,
    processoController: vivo, processoRuntime: identidade, rollout: roll, turno: 'turn-1', ...estadoExtra });
  registrar(dir, t.id, 'session_sensor_registered', { fase: 'GO', sessionId: SID, despachoEm: despachadaEm,
    controlador, cwd: p.dir, ...opcoes.registro?.(sessoes) });
  return { ...p, t, dirEstado: dir, controlador, escrever, roll,
    run: (ms: number) => observarSessao(p.carregado, SID, { agoraMs: BASE + ms }),
    eventos: () => lerLedger(dir),
    limpar: () => { proprioControlador.encerrar(); proprioRuntime.encerrar(); p.limpar(); } };
}
const rolloutBase = [linha({ type: 'session_meta', payload: { id: SID, cwd: '__CWD__' } }),
  linha({ type: 'event_msg', timestamp: new Date(BASE + 500).toISOString(), payload: { type: 'turn.started', turn_id: 'turn-1' } })];
const rolloutCompleto = [...rolloutBase,
  linha({ type: 'event_msg', timestamp: new Date(BASE + 600).toISOString(), payload: { type: 'item.completed', item: { type: 'agent_message', text: 'Concluido.' } } }),
  linha({ type: 'token_usage_record', payload: { turn_id: 'turn-1', turn_token_usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 4 } } }),
  linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(), payload: { type: 'turn.completed', turn_id: 'turn-1', usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 4 } } })];
const terminalNativo = { metodo: 'turn/completed', threadId: SID, turnId: 'turn-1', status: 'completed' };

for (const [motivo, acao] of [['cost.violation', 'sem-retry'], ['policy.violation', 'escalar-humano'],
  ['ci.failed', 'escalar-humano']] as const) {
  test(`GO-FIX5: controller preserva ${motivo} no exit 1 sem retry automático`, () => {
    for (const terminal of [undefined, { ...terminalNativo, status: 'failed' }]) {
      const p = fixtureControlador({ estado: 'failed', terminal, erro: motivo,
        processoEncerrado: { em: new Date(BASE + 1500).toISOString(), code: 1, signal: null } },
      [...rolloutBase, linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(),
        payload: { type: 'turn.failed', turn_id: 'turn-1', reason: motivo } })], { vivo: false });
      try {
        assert.equal(p.run(2000).classificacao, 'gate_blocked');
        const result = p.eventos().find(e => e.tipo === 'phase_result')!;
        assert.equal(result.motivo, motivo);
        assert.equal(result.ok, false);
        assert.equal(result.exitCode, 1);
        assert.equal(result.fonteVencedora, 'rollout');
        const retry = executarRetry(p.carregado, p.t.id);
        assert.equal(retry.plano.acao, acao);
        assert.equal(retry.plano.automatica, false);
        assert.equal(retry.executada, false);
        assert.equal(retry.redespacho, null);
        assert.equal(p.eventos().some(e => e.tipo === 'retry_attempt'), false);
        p.run(3000);
        assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
      } finally { p.limpar(); }
    }
  });
}

test('GO-FIX4: falhas operacionais sobrevivem ao close não zero e rate limit espera a janela', () => {
  for (const motivo of ['runtime.rate-limited', 'runtime.silencio', 'runtime.unavailable', 'tree.blocked', 'lease.busy']) {
    for (const terminal of [undefined, { ...terminalNativo, status: 'failed' }]) {
      const p = fixtureControlador({ estado: 'failed', terminal, erro: motivo,
        processoEncerrado: { em: new Date(BASE + 1500).toISOString(), code: 1, signal: null } },
      [...rolloutBase, linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(),
        payload: { type: 'turn.failed', turn_id: 'turn-1', reason: motivo } })], { vivo: false });
      try {
        assert.equal(p.run(2000).classificacao, 'gate_blocked');
        const result = p.eventos().find(e => e.tipo === 'phase_result')!;
        assert.equal(result.motivo, motivo);
        assert.equal(result.ok, false);
        assert.equal(result.exitCode, 1);
        assert.equal(result.fonteVencedora, 'rollout');
        if (motivo === 'runtime.rate-limited') assert.equal(planejarRetry(p.carregado, p.t.id).acao, 'esperar-janela');
        p.run(3000);
        assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
      } finally { p.limpar(); }
    }
  }
});

test('I32: parecer negativo exige conclusão nativa do controller, sem aceitar turno incompleto', () => {
  const negativeRollout = [...rolloutBase, linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(),
    payload: { type: 'turn.completed', turn_id: 'turn-1', reason: 'claims.failed' } })];
  for (const terminal of [terminalNativo, undefined, { ...terminalNativo, status: 'failed' },
    { ...terminalNativo, status: 'interrupted' }, { ...terminalNativo, turnId: 'outro-turno' }]) {
    const p = fixtureControlador({ estado: 'completed', terminal,
      processoEncerrado: { em: new Date(BASE + 1500).toISOString(), code: 0, signal: null } }, negativeRollout, { vivo: false });
    try {
      assert.equal(p.run(2000).classificacao, 'gate_blocked');
      const result = p.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(result.ok, false);
      assert.equal(result.motivo, terminal === terminalNativo ? 'claims.failed' : 'runtime.unavailable');
      assert.equal(result.fonteVencedora, terminal === terminalNativo ? 'rollout' : null);
    } finally { p.limpar(); }
  }
});

test('GO-FIX7: conclusão nativa é medida em bloqueio sem retry, independente da política que preserva o motivo', () => {
  for (const motivo of ['ci.failed', 'cost.violation', 'policy.violation', 'claims.failed']) {
    const semRetry = motivo !== 'claims.failed';
    for (const [terminal, code] of [[terminalNativo, 0], [undefined, 0], [{ ...terminalNativo, status: 'failed' }, 0],
      [{ ...terminalNativo, status: 'interrupted' }, 0], [{ ...terminalNativo, turnId: 'outro-turno' }, 0],
      [terminalNativo, 1]] as const) {
      const rollout = [...rolloutBase, linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(),
        payload: { type: 'turn.completed', turn_id: 'turn-1', reason: motivo } })];
      const p = fixtureControlador({ estado: 'completed', terminal,
        processoEncerrado: { em: new Date(BASE + 1500).toISOString(), code, signal: null } }, rollout, { vivo: false });
      const caso = JSON.stringify({ motivo, terminal: terminal ?? null, code });
      try {
        assert.equal(p.run(2000).classificacao, 'gate_blocked', caso);
        const result = p.eventos().find(e => e.tipo === 'phase_result')!;
        const correlacionado = terminal === terminalNativo && code === 0;
        assert.equal(result.motivo, semRetry || correlacionado ? motivo : 'runtime.unavailable', caso);
        assert.equal(result.conclusaoNativa, correlacionado, caso);
        if (correlacionado) assert.equal(result.conclusaoNativaAusente, null, caso);
        else assert.match(String(result.conclusaoNativaAusente), /terminal nativo|close real zero/, caso);
      } finally { p.limpar(); }
    }
  }
});

test('worker real sobre app-server falso dá close observado e um único phase_result após replay e concorrência', () => {
  const p = projetoTemporario('watcher-controller-real');
  const t = novaThread(p.carregado, { nome: 'watch', modo: 'auto' }).thread;
  const dir = dirThread(p.dir, t.id);
  const sim = controllerSimulado();
  try {
    const prompt = 'FINALIZAR-SIMULADO agora';
    const vinculo = { thread: t.id, fase: 'GO', promptSha256: createHash('sha256').update(prompt).digest('hex') };
    const r = sim.dispatch({ prompt, vinculo, cwd: p.dir, logDir: path.join(dir, 'sessoes') });
    assert.equal(r.ok, true, r.erro);
    const despachadaEm = new Date().toISOString();
    t.sessoes.push({ sessionId: r.sessionId!, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex',
      despachadaEm, promptPath: '', promptSha256: vinculo.promptSha256, verificada: true });
    gravarThread(p.dir, t);
    registrar(dir, t.id, 'session_sensor_registered', { fase: 'GO', sessionId: r.sessionId!,
      despachoEm: despachadaEm, controlador: r.controlador!, cwd: p.dir });
    esperarCondicao(() => !!lerEstadoController(r.controlador!).processoEncerrado, 20000);
    // Concorrência e replay: várias observações, nenhuma duplicação de resultado.
    const resultados = [0, 1, 2, 3].map(() => observarSessao(p.carregado, r.sessionId!));
    const eventos = lerLedger(dir);
    const resultado = eventos.find(e => e.tipo === 'phase_result')!;
    assert.equal(eventos.filter(e => e.tipo === 'phase_result').length, 1);
    assert.equal(resultados.some(x => x.concluido), true);
    assert.equal(resultado.classificacao, 'fase_concluida');
    assert.equal(resultado.exitCode, 0);
    assert.equal(resultado.exitCodeFonte, 'controller.close');
    assert.equal(resultado.duracaoFonte, 'controller.close');
    assert.equal(resultado.ok, true);
    assert.equal((resultado.tokens as any).disponivel, true);
    assert.equal(resultado.fonteVencedora, 'rollout');
    // Observar não responde nem retoma: nada foi enviado ao transporte nativo.
    assert.equal(fs.existsSync(path.join(sim.runtimeHome, 'recebido.jsonl')), false);
    console.log(JSON.stringify({ phaseResults: 1, exitCodeFonte: resultado.exitCodeFonte,
      bytesLidos: resultados.map(x => x.bytesLidos) }));
  } finally { sim.restaurar(); p.limpar(); fs.rmSync(sim.dir, { recursive: true, force: true }); }
});

test('espera requestUserInput autenticada e viva não termina, inclusive além de 600000 ms', () => {
  const p = fixtureControlador({ estado: 'blocked', bloqueio: JSON.stringify(['turn-1', 0, 'item-0', 'a'.repeat(64)]),
    perguntaNativa: { sha256: 'a'.repeat(64) } }, rolloutBase);
  try {
    assert.equal(p.run(2000).concluido, false);
    assert.equal(p.run(700000).concluido, false);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
    assert.equal(p.eventos().filter(e => e.tipo === 'sessao_morta').length, 0);
    console.log(JSON.stringify({ esperaHumanaMs: 700000, resultados: 0 }));
  } finally { p.limpar(); }
});

test('completed sem close conserva null e não termina; exit 23 nunca passa', () => {
  const semClose = fixtureControlador({ estado: 'completed', terminal: terminalNativo }, rolloutCompleto);
  try {
    assert.equal(semClose.run(2000).concluido, false);
    assert.equal(semClose.eventos().filter(e => e.tipo === 'phase_result').length, 0);
  } finally { semClose.limpar(); }
  const naoZero = fixtureControlador({ estado: 'completed', terminal: terminalNativo,
    processoEncerrado: { em: new Date(BASE + 800).toISOString(), code: 23, signal: null } }, rolloutCompleto, { vivo: false });
  try {
    assert.equal(naoZero.run(2000).classificacao, 'gate_blocked');
    const r = naoZero.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(r.exitCode, 23);
    assert.equal(r.exitCodeFonte, 'controller.close');
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'runtime.unavailable');
    console.log(JSON.stringify({ semClose: null, exit23: r.classificacao }));
  } finally { naoZero.limpar(); }
});

test('crash com EOF parcial e turno divergente ficam tipados, sem afirmar conclusão', () => {
  const parcial = fixtureControlador({ estado: 'unavailable',
    processoEncerrado: { em: new Date(BASE + 800).toISOString(), code: 23, signal: null } },
    [...rolloutBase, '{"type":"event_msg","payload":{"type":"turn.compl'], { vivo: false });
  try {
    assert.equal(parcial.run(2000).classificacao, 'gate_blocked');
    const r = parcial.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.fonteVencedora, null);
    assert.equal(r.exitCode, 23);
  } finally { parcial.limpar(); }
  const outroTurno = fixtureControlador({ estado: 'completed',
    terminal: { ...terminalNativo, turnId: 'turn-9' },
    processoEncerrado: { em: new Date(BASE + 800).toISOString(), code: 0, signal: null } }, rolloutCompleto, { vivo: false });
  try {
    assert.equal(outroTurno.run(2000).classificacao, 'gate_blocked');
    const r = outroTurno.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.ok, false);
    console.log(JSON.stringify({ eofParcial: 'runtime.unavailable', turnoDivergente: 'runtime.unavailable' }));
  } finally { outroTurno.limpar(); }
  // Id de origem gerada nao vincula turno: sem prova alternativa, sucesso recusado.
  const semIdProprio = fixtureControlador({ estado: 'completed', terminal: terminalNativo,
    processoEncerrado: { em: new Date(BASE + 800).toISOString(), code: 0, signal: null } },
    [linha({ type: 'session_meta', payload: { id: SID, cwd: '__CWD__' } }),
     linha({ type: 'event_msg', timestamp: new Date(BASE + 500).toISOString(), payload: { type: 'task_started' } }),
     linha({ type: 'event_msg', timestamp: new Date(BASE + 600).toISOString(), payload: { type: 'item.completed', item: { type: 'agent_message', text: 'Concluido.' } } }),
     linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(), payload: { type: 'task_complete', usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 4 } } })],
    { vivo: false });
  try {
    assert.equal(semIdProprio.run(2000).classificacao, 'gate_blocked');
    const r = semIdProprio.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.match(String(r.fonte), /proveniencia explicita/);
    assert.equal(r.exitCodeFonte, 'controller.close');
    console.log(JSON.stringify({ turnoSintetizado: r.classificacao, motivoTipado: r.fonte }));
  } finally { semIdProprio.limpar(); }
});

test('silêncio de 600000 ms não é reiniciado por poll nem por restart do observador', () => {
  const p = fixtureControlador({ estado: 'working' }, rolloutBase, { vivo: false });
  try {
    for (const ms of [2000, 100000, 300000, 599999]) assert.equal(p.run(ms).concluido, false, String(ms));
    const fim = p.run(601000);
    assert.equal(fim.concluido, true);
    const r = p.eventos().find(e => e.tipo === 'phase_result')!;
    assert.equal(r.classificacao, 'gate_blocked');
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.exitCode, null);
    assert.equal(r.exitCodeFonte, 'unavailable');
    assert.equal(p.run(900000).concluido, true);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
    console.log(JSON.stringify({ fronteiraMs: 600000, resultados: 1, exitCodeFonte: r.exitCodeFonte }));
  } finally { p.limpar(); }
});

test('fonte divergente do vínculo não fornece resultado e fica tipada no ledger', () => {
  const p = fixtureControlador({ estado: 'working' }, rolloutBase, { registro: () => ({ cwd: '/outro' }) });
  try {
    assert.throws(() => p.run(2000), /cwd do launch divergente/);
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
    const erro = p.eventos().find(e => e.tipo === 'session_watcher_error')!;
    assert.equal(erro.motivo, 'runtime.unavailable');
  } finally { p.limpar(); }
  const mistura = fixtureControlador({ estado: 'working' }, rolloutBase, { registro: sessoes => ({ logPath: path.join(sessoes, 'fixture.codex.jsonl') }) });
  try {
    assert.throws(() => mistura.run(2000), /mistura controller e log supervisionado/);
    assert.equal(mistura.eventos().filter(e => e.tipo === 'phase_result').length, 0);
    console.log(JSON.stringify({ fonteDivergente: 0, misturaDeVariantes: 0 }));
  } finally { mistura.limpar(); }
});

const rolloutComTurno = (id: string) => [linha({ type: 'session_meta', payload: { id: SID, cwd: '__CWD__' } }),
  linha({ type: 'event_msg', timestamp: new Date(BASE + 500).toISOString(), payload: { type: 'turn.started', turn_id: id } }),
  linha({ type: 'event_msg', timestamp: new Date(BASE + 600).toISOString(), payload: { type: 'item.completed', item: { type: 'agent_message', text: 'Concluido.' } } }),
  linha({ type: 'token_usage_record', payload: { turn_id: id, turn_token_usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 4 } } }),
  linha({ type: 'event_msg', timestamp: new Date(BASE + 700).toISOString(), payload: { type: 'turn.completed', turn_id: id, usage: { input_tokens: 20, cached_input_tokens: 10, output_tokens: 4 } } })];
const close0 = { processoEncerrado: { em: new Date(BASE + 800).toISOString(), code: 0, signal: null } };

test('sucesso do controller exige terminal nativo completed, correlação provada e close zero', () => {
  const p = fixtureControlador({ estado: 'completed', terminal: terminalNativo, ...close0 }, rolloutCompleto, { vivo: false });
  try {
    // Replay e concorrência sobre o mesmo despacho: exatamente um phase_result.
    const resultados = [0, 1, 2].map(() => p.run(2000));
    assert.equal(resultados.every(x => x.concluido), true);
    const eventos = p.eventos().filter(e => e.tipo === 'phase_result');
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].classificacao, 'fase_concluida');
    assert.equal(eventos[0].ok, true);
    assert.equal(eventos[0].exitCode, 0);
    assert.equal(eventos[0].exitCodeFonte, 'controller.close');
    assert.equal(eventos[0].fonteVencedora, 'rollout');
    assert.equal(eventos[0].turnId, 'turn-1');
    console.log(JSON.stringify({ sucessoNativo: eventos[0].classificacao, phaseResults: eventos.length }));
  } finally { p.limpar(); }
});

test('cada lacuna da prova nativa vira indisponibilidade tipada, nunca fase_concluida', () => {
  const casos: [string, Record<string, unknown>, string[], RegExp][] = [
    ['failed com close zero', { estado: 'completed', terminal: { ...terminalNativo, status: 'failed' }, ...close0 },
      rolloutCompleto, /status failed/],
    ['interrupted com close zero', { estado: 'completed', terminal: { ...terminalNativo, status: 'interrupted' }, ...close0 },
      rolloutCompleto, /status interrupted/],
    ['status desconhecido', { estado: 'completed', terminal: { ...terminalNativo, status: 'quase-pronto' }, ...close0 },
      rolloutCompleto, /status desconhecido/],
    ['terminal nativo ausente', { estado: 'completed', ...close0 }, rolloutCompleto, /terminal nativo ausente/],
    ['turno do estado divergente', { estado: 'completed', turno: 'turn-9', terminal: terminalNativo, ...close0 },
      rolloutCompleto, /turno do estado divergente/],
    ['estado com erro', { estado: 'completed', terminal: terminalNativo, erro: 'falha de transporte', ...close0 },
      rolloutCompleto, /erro ou limitacao tipada/],
    ['estado com limitação', { estado: 'completed', terminal: terminalNativo,
      limitacao: { motivo: 'runtime.unavailable', codigo: 'quota', metodo: 'turn/create' }, ...close0 },
      rolloutCompleto, /erro ou limitacao tipada/],
    ['id explícito stream-999 contra turn-1', { estado: 'completed', terminal: terminalNativo, ...close0 },
      rolloutComTurno('stream-999'), /turno observado divergente/],
  ];
  for (const [nome, estado, rollout, motivo] of casos) {
    const p = fixtureControlador(estado, rollout, { vivo: false });
    try {
      assert.equal(p.run(2000).classificacao, 'gate_blocked', nome);
      const r = p.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(r.classificacao, 'gate_blocked', nome);
      assert.equal(r.ok, false, nome);
      assert.equal(r.motivo, 'runtime.unavailable', nome);
      assert.match(String(r.fonte), motivo, nome);
      assert.equal(r.fonteVencedora, null, nome);
      assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1, nome);
    } finally { p.limpar(); }
  }
  console.log(JSON.stringify({ lacunasRecusadas: casos.length }));
});


test('TC4: controller vivo ou morto sem close expira, inclusive com terminal completed', () => {
  for (const vivo of [true, false]) {
    const p = fixtureControlador({ estado: 'completed', terminal: terminalNativo }, rolloutCompleto, { vivo });
    try {
      assert.equal(p.run(2000).concluido, false);
      assert.equal(p.run(600999).concluido, false);
      assert.equal(p.run(601000).classificacao, 'gate_blocked');
      const r = p.eventos().find(e => e.tipo === 'phase_result')!;
      assert.equal(r.motivo, 'runtime.unavailable');
      assert.equal(r.exitCode, null); assert.equal(r.ok, false);
      assert.equal(r.fonteVencedora, null);
      assert.equal(p.run(701000).concluido, true);
      assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 1);
    } finally { p.limpar(); }
  }
});

test('TC4: ruido nao renova prazo persistido entre polls do controller vivo', () => {
  const p = fixtureControlador({ estado: 'running' }, rolloutBase);
  try {
    assert.equal(p.run(2000).concluido, false);
    for (const ms of [200000, 400000, 600999]) {
      fs.appendFileSync(p.roll, linha({ type: 'desconhecido', timestamp: new Date(BASE + ms).toISOString() }));
      fs.utimesSync(p.roll, (BASE + ms) / 1000, (BASE + ms) / 1000);
      assert.equal(p.run(ms).concluido, false);
    }
    assert.equal(p.run(601000).classificacao, 'gate_blocked');
    assert.equal(p.eventos().find(e => e.tipo === 'phase_result')?.motivo, 'runtime.unavailable');
    assert.equal(p.eventos().filter(e => e.tipo === 'runtime_heartbeat').length, 1);
  } finally { p.limpar(); }
});

test('TC4: progresso reconhecido persiste e HITL suspende apenas enquanto autenticado', () => {
  const p = fixtureControlador({ estado: 'running' }, rolloutBase);
  try {
    p.run(2000);
    fs.appendFileSync(p.roll, linha({ type: 'event_msg', timestamp: new Date(BASE + 100000).toISOString(),
      payload: { type: 'agent_message', message: 'Trabalhando', turn_id: 'turn-1' } }));
    fs.utimesSync(p.roll, (BASE + 100000) / 1000, (BASE + 100000) / 1000);
    p.run(100000);
    const statePath = path.join(p.controlador, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    p.escrever('state.json', { ...state, estado: 'blocked',
      bloqueio: JSON.stringify(['turn-1', 0, 'item-0', 'a'.repeat(64)]), perguntaNativa: { sha256: 'a'.repeat(64) } });
    assert.equal(p.run(200000).concluido, false);
    assert.equal(p.run(900000).concluido, false);
    p.escrever('state.json', state);
    assert.equal(p.run(1000000).concluido, false);
    assert.equal(p.run(1499999).concluido, false);
    assert.equal(p.run(1500000).classificacao, 'gate_blocked');
  } finally { p.limpar(); }
});


for (const troca of ['inode', 'symlink', 'fifo', 'append'] as const) {
  test(`CK11: abertura consumidora confere descritor após snapshot (${troca})`, () => {
    const f = fixtureControlador({ estado: 'completed', terminal: terminalNativo,
      processoEncerrado: { em: new Date(BASE + 1500).toISOString(), code: 0, signal: null } }, rolloutBase);
    const nativoFs: typeof fs = require('node:fs');
    const abrir = nativoFs.openSync;
    let aberturas = 0, injetado = false;
    const inoOriginal = fs.statSync(f.roll).ino;
    try {
      nativoFs.openSync = ((file: fs.PathLike, flags: string | number, mode?: fs.Mode) => {
        // Duas aberturas do sensor já validaram a fonte; a terceira é o consumidor.
        if (file === f.roll && ++aberturas === 3) {
          injetado = true;
          const substituto = f.roll + '.substituto';
          if (troca === 'append') {
            fs.appendFileSync(f.roll, rolloutCompleto.slice(rolloutBase.length).join(''));
          } else {
            fs.writeFileSync(substituto, rolloutCompleto.join('').split('__CWD__').join(f.dir), { mode: 0o600 });
            fs.renameSync(f.roll, f.roll + '.original');
            if (troca === 'inode') fs.renameSync(substituto, f.roll);
            else if (troca === 'symlink') fs.symlinkSync(substituto, f.roll);
            else execFileSync('mkfifo', ['-m', '600', f.roll]);
          }
        }
        return abrir(file, flags, mode);
      }) as typeof fs.openSync;
      if (troca === 'append') {
        assert.equal(f.run(2000).classificacao, 'fase_concluida');
        assert.equal(fs.statSync(f.roll).ino, inoOriginal);
        assert.equal(f.eventos().filter(e => e.tipo === 'phase_result' && e.ok === true).length, 1);
      } else {
        assert.throws(() => f.run(2000), /runtime.unavailable|ELOOP/);
        assert.equal(f.eventos().filter(e => e.tipo === 'phase_result').length, 0);
      }
      assert.equal(injetado, true, 'a troca deve ocorrer depois do sensor e antes da leitura consumidora');
    } finally { nativoFs.openSync = abrir; f.limpar(); }
  });
}
