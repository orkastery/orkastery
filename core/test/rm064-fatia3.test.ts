import { strict as assert } from 'node:assert';
import { mock, test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { controllerSimulado, esperarCondicao } from './controller-simulado';
import { encerrarController } from '../src/adapters/codex-controller';
import { rodarFase } from '../src/phase';
import { ParserCodex } from '../src/adapters/codex-events';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { observarSessao, prepararFonteWatcher, reconciliarSessaoSemWatcher, validarFonteWatcher,
  validarRegistroWatcher } from '../src/session-watcher';
import { conduzirBatida } from '../src/conducao-batida';
import { caminhoDoTrabalho, gravarRespostaFinalDaSessao } from '../src/trabalho-thread';
import { configuracaoServidorMcp, instalarMcp, politicasFilhoCodex, TOOLS_FILHO_CODEX } from '../src/mcp-install';
import { adicionarPerfil, desativarPerfil, lerPerfis, perfilDeDespacho, perfisDisponiveis, politicaDeRotacao,
  proximoPerfilDisponivel, proximoPerfilPorCarga } from '../src/runtime-profiles';
import { proximoAlvo, redespachar } from '../src/retry';
import { planoDoDegrau } from '../src/runtime-escada';
import { editarBloco } from '../src/setup';
import { instalarAdaptador } from '../src/hosts';
import { PedidoDeDespacho, RUNTIMES } from '../src/runtimes';

const SID = '11111111-2222-4333-8444-555555555555';

function sessaoCodex(nome: string, idadeMs = 1_000) {
  const p = projetoTemporario(nome);
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const despachadaEm = new Date(Date.now() - idadeMs).toISOString();
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

test('RM-064 T9: a partida do despacho tolera só a fonte ainda não pronta e recusa vínculo divergente', () => {
  const p = sessaoCodex('rm064-t9-partida');
  try {
    const sessoes = path.join(p.estado, 'sessoes');
    const controlador = path.join(sessoes, 'controller-ainda-subindo');
    const outro = path.join(sessoes, 'controller-de-outro-despacho');
    [controlador, outro].forEach((d) => fs.mkdirSync(d, { recursive: true, mode: 0o700 }));
    registrar(p.estado, p.t.id, 'phase_dispatch', { fase: 'GO', sessionId: SID, despachoEm: p.despachadaEm,
      controlador, cwd: p.dir });
    // Na sequência do incidente, o controller ainda não publicou o rollout quando o despacho registra a fonte.
    assert.doesNotThrow(() => prepararFonteWatcher(p.dir, SID, { controlador, cwd: p.dir }));
    assert.throws(() => prepararFonteWatcher(p.dir, SID, { controlador: outro, cwd: p.dir }),
      /controlador registrado divergente do despacho/);
  } finally { p.limpar(); }
});

test('RM-064 T9: despacho com rollout ainda sem session_meta registra a fonte e inicia o watcher', () => {
  const p = projetoTemporario('rm064-t9-despacho');
  const f = controllerSimulado(p.dir);
  const t = novaThread(p.carregado, { nome: 'despacho', modo: 'auto' }).thread;
  t.faseAtual = 'GO'; gravarThread(p.dir, t);
  const estado = dirThread(p.dir, t.id);
  // Reproduz a corrida do incidente: na primeira validação profunda o controller ainda não publicou o session_meta.
  const sensor = require('../src/adapters/codex-controller-sensor');
  const original = sensor.registrarFonteController;
  let primeira = true;
  const corrida = mock.method(sensor, 'registrarFonteController', (dir: string, esperado: unknown) => {
    if (primeira) { primeira = false; throw new Error('runtime.unavailable: rollout do controller sem session_meta conferível'); }
    return original(dir, esperado);
  });
  let controlador: string | undefined;
  try {
    const r = rodarFase(p.carregado, t.id, { fase: 'GO', runtime: 'codex', model: 'modelo-SIMULADO',
      prompt: 'FINALIZAR-SIMULADO: corrida da prontidão' });
    assert.ok(r.sessionId, 'despacho sem sessão');
    controlador = r.controlador ?? undefined;
    assert.equal(primeira, false, 'a corrida simulada não foi exercitada');
    const eventos = lerLedger(estado);
    assert.equal(eventos.some((e) => e.tipo === 'session_watcher_error' && e.origem === 'phase.dispatch'), false);
    assert.ok(eventos.some((e) => e.tipo === 'session_sensor_registered' && e.sessionId === r.sessionId));
    assert.ok(eventos.some((e) => e.tipo === 'session_watcher_started' && e.sessionId === r.sessionId));
    esperarCondicao(() => lerLedger(estado).some((e) => e.tipo === 'phase_result' && e.sessionId === r.sessionId), 40000);
  } finally {
    corrida.mock.restore();
    if (controlador) {
      const launch = JSON.parse(fs.readFileSync(path.join(controlador, 'launch.json'), 'utf8'));
      try { encerrarController(controlador, launch.vinculo, launch.instancia, 8000); } catch { /* fixture já terminal */ }
    }
    f.restaurar(); p.limpar();
  }
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

test('RM-064 T9: a própria batida reconcilia a sessão sem watcher antes de seguir', () => {
  const p = sessaoCodex('rm064-t9-batida');
  try {
    const baseMs = Date.parse(p.despachadaEm) - 1_000;
    prepararControllerEncerrado(p, baseMs);
    conduzirBatida(p.carregado, { buscar: false, forja: null, fantasmas: () => [], vivas: () => [],
      quando: new Date(baseMs + 3_000).toISOString(),
      despachar: () => ({ ok: false, detalhe: 'sem despacho neste teste', sessionId: null }),
      retomar: () => ({ automatica: false, ok: false, detalhe: 'sem retomada neste teste' }) });
    const resultados = lerLedger(p.estado).filter((e) => e.tipo === 'phase_result');
    assert.equal(resultados.length, 1, 'a batida registra o fim nativo que o watcher ausente perderia');
    assert.deepEqual([resultados[0].sessionId, resultados[0].conclusaoNativa], [SID, true]);
  } finally { p.limpar(); }
});

test('RM-064 T9: fonte indisponível por dez minutos vira parada tipada e idempotente', () => {
  const p = sessaoCodex('rm064-t9-parada');
  try {
    const controlador = path.join(p.estado, 'sessoes', 'controller-incompleto');
    fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
    registrar(p.estado, p.t.id, 'phase_dispatch', { ts: p.despachadaEm, fase: 'GO', sessionId: SID,
      despachoEm: p.despachadaEm, controlador, cwd: p.dir, promptSha256: 'a'.repeat(64) });
    const primeiroErro = Date.now();
    registrar(p.estado, p.t.id, 'session_watcher_error', { ts: new Date(primeiroErro).toISOString(), fase: 'GO',
      sessionId: SID, despachoEm: p.despachadaEm, motivo: 'runtime.unavailable', origem: 'sessions.watch' });
    // Na fronteira da série atual a sessão só é acompanhada: o despacho antigo não antecipa a parada.
    const antes = reconciliarSessaoSemWatcher(p.carregado, p.t.id, primeiroErro + 599_999);
    assert.equal(antes.estado, 'acompanhada');
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result').length, 0);
    const r = reconciliarSessaoSemWatcher(p.carregado, p.t.id, primeiroErro + 600_001);
    assert.equal(r.estado, 'parada');
    const eventos = lerLedger(p.estado);
    const resultado = eventos.find((e) => e.tipo === 'phase_result')!;
    assert.deepEqual([resultado.classificacao, resultado.motivo, resultado.origem],
      ['gate_blocked', 'runtime.unavailable', 'conducao.batida']);
    assert.ok(Number(resultado.morteLatenciaMs) >= 600_000);
    assert.equal(eventos.filter((e) => e.tipo === 'gate_blocked').length, 1);
    assert.equal(reconciliarSessaoSemWatcher(p.carregado, p.t.id, primeiroErro + 600_002).estado, 'ignorada');
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result').length, 1);
  } finally { p.limpar(); }
});

test('RM-064 T9: falha transitória conta da observação boa e a leitura seguinte ainda encontra o fim', () => {
  const p = sessaoCodex('rm064-t9-observacao-boa', 30 * 60 * 1_000);
  try {
    const agora = Date.now();
    prepararControllerEncerrado(p, Date.parse(p.despachadaEm) - 1_000);
    const controlador = path.join(p.estado, 'sessoes', 'controller-simulado');
    const fonte = { controlador, cwd: p.dir };
    validarRegistroWatcher(p.dir, SID, fonte);
    registrar(p.estado, p.t.id, 'session_sensor_registered', { fase: 'GO', sessionId: SID,
      despachoEm: p.despachadaEm, ...fonte });
    // Uma série antiga, já superada pela observação boa, não pode antecipar a parada.
    registrar(p.estado, p.t.id, 'session_watcher_error', { ts: new Date(agora - 20 * 60 * 1_000).toISOString(), fase: 'GO',
      sessionId: SID, despachoEm: p.despachadaEm, motivo: 'runtime.unavailable', transitorio: true, origem: 'sessions.watch' });
    registrar(p.estado, p.t.id, 'session_watcher_observed', { ts: new Date(agora - 1_000).toISOString(), fase: 'GO',
      sessionId: SID, despachoEm: p.despachadaEm, origem: 'conducao.batida' });
    const estado = path.join(controlador, 'state.json');
    const valido = fs.readFileSync(estado);
    fs.writeFileSync(estado, '{');
    const falha = reconciliarSessaoSemWatcher(p.carregado, p.t.id, agora);
    assert.equal(falha.estado, 'acompanhada', 'uma leitura passageira não encerra a sessão observada há pouco');
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result').length, 0);
    fs.writeFileSync(estado, valido);
    assert.equal(reconciliarSessaoSemWatcher(p.carregado, p.t.id, agora + 1_000).estado, 'concluida');
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'phase_result' && e.ok).length, 1);
    // A própria batida registra a leitura boa; é ela que fecha a série de erros da reconciliação.
    assert.equal(lerLedger(p.estado).filter((e) => e.tipo === 'session_watcher_observed' && e.sessionId === SID &&
      e.origem === 'conducao.batida' && e.ts === new Date(agora + 1_000).toISOString()).length, 1);
  } finally { p.limpar(); }
});

test('RM-064 T9: vínculo permanente divergente vira diagnóstico e parada tipada', () => {
  const p = sessaoCodex('rm064-t9-vinculo-divergente', 30 * 60 * 1_000);
  try {
    // A recomposição não pode aceitar um controller que o despacho registrou fora da pasta canônica de sessões.
    registrar(p.estado, p.t.id, 'phase_dispatch', { ts: p.despachadaEm, fase: 'GO', sessionId: SID,
      despachoEm: p.despachadaEm, controlador: p.dir, cwd: p.dir, promptSha256: 'a'.repeat(64) });
    const primeira = reconciliarSessaoSemWatcher(p.carregado, p.t.id, Date.now());
    assert.equal(primeira.estado, 'acompanhada');
    const diagnosticos = lerLedger(p.estado).filter(e => e.tipo === 'session_watcher_error' && e.sessionId === SID);
    assert.equal(diagnosticos.length, 1, 'falha permanente de recomposição precisa ficar no ledger');
    assert.equal(diagnosticos[0].transitorio, false);
    const r = reconciliarSessaoSemWatcher(p.carregado, p.t.id, Date.parse(diagnosticos[0].ts) + 600_001);
    assert.equal(r.estado, 'parada');
    const resultado = lerLedger(p.estado).find(e => e.tipo === 'phase_result')!;
    assert.deepEqual([resultado.motivo, resultado.origem, resultado.conclusaoNativa],
      ['runtime.unavailable', 'conducao.batida', false]);
  } finally { p.limpar(); }
});

test('RM-064 T8: sessão worktree recebe somente as mutações MCP exatas, sem ampliar o sandbox', () => {
  const cfg = configuracaoServidorMcp('/projeto-simulado', 'codex', 'ork-fixture', 'github-ssh', 'worktree',
    '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(cfg.args.slice(cfg.args.indexOf('--child-permissions')), ['--child-permissions', 'worktree',
    '--thread', 'ork-fixture', '--dispatch', '11111111-2222-4333-8444-555555555555']);
  assert.equal(cfg.args.some((a) => /writable|sandbox|danger/i.test(a)), false);
  const politicas = politicasFilhoCodex({});
  assert.deepEqual(Object.keys(politicas.tools).sort(), [...TOOLS_FILHO_CODEX].sort());
  assert.ok(TOOLS_FILHO_CODEX.includes('ork_request_conduction'));
  assert.deepEqual(Object.values(politicas.tools).map((v) => (v as { approval_mode: string }).approval_mode),
    Array(TOOLS_FILHO_CODEX.length).fill('approve'));
});

test('RM-064 T8: retry pela escada leva o contexto MCP worktree ao Codex', () => {
  const p = projetoTemporario('rm064-t8-retry-codex');
  let f: ReturnType<typeof controllerSimulado> | undefined;
  let controlador: string | undefined;
  let restaurarAdaptador: (() => void) | undefined;
  try {
    const t = novaThread(p.carregado, { nome: 'retry codex', modo: 'auto', criarWorktree: true }).thread;
    t.faseAtual = 'GO'; gravarThread(p.dir, t);
    f = controllerSimulado(t.worktree!, { cenario: 'contexto-ok' });
    instalarAdaptador('codex', { projeto: p.dir });
    instalarMcp({ projeto: p.dir, host: 'codex', permissoesFilho: 'worktree' });
    const adaptador = mock.method(RUNTIMES.codex, 'despachar', (pedido: PedidoDeDespacho) => f!.dispatch({
      contextoRuntime: pedido.contextoRuntime, vinculo: pedido.vinculo, prompt: pedido.prompt,
      model: pedido.model, effort: pedido.effort, sandbox: pedido.sandbox,
    }));
    restaurarAdaptador = () => adaptador.mock.restore();
    const texto = 'retry com contexto MCP SIMULADO';
    const prompt = path.join(dirThread(p.dir, t.id), 'prompts', 'retry.md');
    fs.mkdirSync(path.dirname(prompt), { recursive: true }); fs.writeFileSync(prompt, texto);
    const r = redespachar(p.carregado, lerThread(p.dir, t.id), 'GO', prompt,
      createHash('sha256').update(texto).digest('hex'), { runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.ok, true, r.detalhe); assert.ok(r.controlador); controlador = r.controlador;
    const chamadas = fs.readFileSync(path.join(f.runtimeHome, 'params.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x));
    const inicio = chamadas.find(x => x.method === 'thread/start')?.params;
    const turno = chamadas.find(x => x.method === 'turn/start')?.params;
    assert.ok(inicio?.config?.mcp_servers?.orkastery, 'retry Codex sem servidor MCP da thread');
    const servidor = inicio.config.mcp_servers.orkastery as { args: string[]; tools: Record<string, { approval_mode: string }> };
    assert.deepEqual(servidor.args.slice(servidor.args.indexOf('--child-permissions'), servidor.args.indexOf('--dispatch')),
      ['--child-permissions', 'worktree', '--thread', t.id]);
    assert.match(servidor.args[servidor.args.indexOf('--dispatch') + 1], /^[a-f0-9-]{36}$/);
    assert.deepEqual(Object.keys(servidor.tools).sort(), [...TOOLS_FILHO_CODEX].sort());
    assert.deepEqual(Object.values(servidor.tools).map(v => v.approval_mode), Array(TOOLS_FILHO_CODEX.length).fill('approve'));
    assert.deepEqual(turno.sandboxPolicy.writableRoots, [t.worktree]);
  } finally {
    if (controlador) {
      const launch = JSON.parse(fs.readFileSync(path.join(controlador, 'launch.json'), 'utf8'));
      try { encerrarController(controlador, launch.vinculo, launch.instancia, 8000); } catch { /* fixture já terminal */ }
    }
    restaurarAdaptador?.(); f?.restaurar(); p.limpar();
  }
});

test('RM-064 T10: perfil desativado não entra na escada, retry, carga nem fallback implícito', () => {
  const p = sessaoCodex('rm064-t10-perfis');
  try {
    instalarAdaptador('codex', { projeto: p.dir });
    instalarAdaptador('claude-code', { projeto: p.dir });
    const dirs = ['claude-ativo', 'claude-fora', 'codex-fora'].map((n) => path.join(p.dir, n));
    dirs.forEach((d) => fs.mkdirSync(d));
    adicionarPerfil(p.dir, { id: 'claude-ativo', runtime: 'claude-bg', dir: dirs[0] });
    adicionarPerfil(p.dir, { id: 'claude-fora', runtime: 'claude-bg', dir: dirs[1] });
    adicionarPerfil(p.dir, { id: 'codex-fora', runtime: 'codex', dir: dirs[2] });
    desativarPerfil(p.dir, 'claude-fora');
    desativarPerfil(p.dir, 'codex-fora');
    const store = lerPerfis(p.dir);
    const politica = politicaDeRotacao(p.carregado.manifesto);
    assert.deepEqual(perfisDisponiveis(store, 'claude-bg').map((x) => x.id), ['claude-ativo']);
    assert.equal(proximoPerfilDisponivel(store, 'claude-bg', politica)?.id, 'claude-ativo');
    assert.equal(proximoPerfilPorCarga(store, 'claude-bg', politica, new Map([['claude-fora', 0], ['claude-ativo', 9]]))?.id,
      'claude-ativo');
    const atual = perfilDeDespacho(store.perfis.find((x) => x.id === 'claude-ativo')!);
    const fallback = [{ runtime: 'codex', model: 'gpt' }];
    assert.equal(proximoAlvo(p.dir, { runtime: 'claude-bg', perfil: atual }, fallback,
      { perfis: [], runtimesImplicitos: [] }, politica), null,
    'perfil configurado e desativado bloqueia o ambiente implícito, sem virar destino');
    const edicao = editarBloco(p.dir, 'auto', 1, { fallback: ['codex:gpt'] });
    assert.equal(edicao.ok, true, JSON.stringify(edicao));
    const despacho = { promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), runtime: 'claude-bg', perfil: atual,
      model: 'sonnet', effort: 'high' };
    assert.deepEqual(planoDoDegrau(p.carregado, p.t, 'GO', 2, despacho, []), { pulo: 'fallback-sem-destino' });
    assert.deepEqual(planoDoDegrau(p.carregado, p.t, 'GO', 3, despacho, []), { pulo: 'sem-outro-perfil' });
  } finally { p.limpar(); }
});
