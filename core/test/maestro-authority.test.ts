import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { approveObjective, createObjective, createReservedObjective, listObjectives, readObjective, reviseObjective, validateObjective } from '../src/objective';
import { dirThread, gravarThread, lerThread, listarIds } from '../src/thread';
import { receiveCreationOperation } from '../src/creation-operation-store';
import { lerLedger, registrar } from '../src/ledger';
import { observarSessao } from '../src/session-watcher';
import { identidadeProcesso } from '../src/adapters/codex-runner';
import { identidadeDoProcesso } from '../src/adapters/codex-controller';
import { SessionReviewBinding, verifySessionReview, parseSessionReviewBinding } from '../src/maestro-authority';

/** Despachos sintéticos; resultado de CHECK pode vir do watcher real sobre stream de fixture. */
function reviewFixture(maxThreads = 3) {
  const p = projetoTemporario('maestro-review-verdict');
  const objective = createObjective(p.carregado, { title: 'Review', request: 'Revisar', doneWhen: ['revisto'],
    executionRuntime: 'codex', validationRuntimes: ['codex'], independence: 'sessions', maxThreads });
  approveObjective(p.dir, objective.id, 'fixture-owner');
  const dispatch = (threadId: string, fase: 'PLAN' | 'GO' | 'CHECK') => {
    const thread = lerThread(p.dir, threadId), sessionId = randomUUID(), slug = `${threadId}-${sessionId}`;
    thread.worktree = p.dir;
    const promptPath = path.join(dirThread(p.dir, threadId), `${sessionId}.md`);
    fs.writeFileSync(promptPath, fase);
    const promptSha256 = createHash('sha256').update(fase).digest('hex');
    thread.sessoes.push({ sessionId, slug, fase, bloco: fase, runtime: 'codex', verificada: true,
      despachadaEm: new Date().toISOString(), promptPath: path.relative(p.dir, promptPath), promptSha256 });
    gravarThread(p.dir, thread);
    registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch', { sessionId, slug, fase, runtime: 'codex', cwd: p.dir, promptSha256 });
    registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch_verified', { sessionId, slug, encontrada: true, fonte: 'fixture-only' });
    return { threadId, sessionId, worktree: p.dir };
  };
  const delivery = objective.threads[maxThreads === 1 ? 0 : 1].id;
  const binding = { conductor: dispatch(objective.threads[0].id, 'PLAN'), executor: dispatch(delivery, 'GO'),
    reviewer: dispatch(delivery, 'CHECK') };
  const session = lerThread(p.dir, delivery).sessoes.find(s => s.sessionId === binding.reviewer.sessionId)!;
  const dir = dirThread(p.dir, delivery);
  const result = { fase: 'CHECK', sessionId: session.sessionId, runtime: 'codex', despachoEm: session.despachadaEm,
    origem: 'sessions.watch', classificacao: 'gate_blocked', motivo: 'claims.failed', ok: false,
    sensorResultId: 'fixture-only', exitCode: 0, signal: null, exitCodeFonte: 'controller.close', fonteVencedora: 'rollout',
    conclusaoNativa: true, conclusaoNativaAusente: null };
  const validate = (verdict: 'approved' | 'rejected', selectors = binding) =>
    validateObjective(p.dir, objective.id, 'codex', verdict, 'fixture-only', selectors);
  const record = (extra: Record<string, unknown> = {}) => registrar(dir, delivery, 'phase_result', { ...result, ...extra });
  const observe = (reason?: string, receiptExtra: Record<string, unknown> = {}) => {
    const log = path.join(dir, 'sessoes', 'fixture.codex.jsonl');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const line = (value: unknown) => JSON.stringify(value) + '\n';
    fs.writeFileSync(log, line({ type: 'thread.started', thread_id: session.sessionId }) +
      line({ type: 'turn.started', turn_id: 'fixture-turn' }) +
      line({ type: 'turn.completed', turn_id: 'fixture-turn', ...(reason ? { reason } : {}) }));
    const processo = { schema: 'ork.codex-process/v1', iniciadoEm: session.despachadaEm,
      supervisor: identidadeProcesso(process.pid), filho: { ...identidadeProcesso(process.pid), inicio: '0' } };
    fs.writeFileSync(log + '.process.json', JSON.stringify(processo));
    fs.writeFileSync(log + '.exit.json', JSON.stringify({ ...processo, terminadoEm: new Date().toISOString(),
      exitCode: 0, signal: null, duracaoMs: 1, erro: null, ...receiptExtra }));
    registrar(dir, delivery, 'session_sensor_registered', { sessionId: session.sessionId, despachoEm: session.despachadaEm,
      logPath: log, processoPath: log + '.process.json', reciboPath: log + '.exit.json' });
    assert.equal(observarSessao(p.carregado, session.sessionId, { rollout: null }).concluido, true);
    return lerLedger(dir).filter(e => e.tipo === 'phase_result').at(-1)!;
  };
  const processos: ReturnType<typeof spawn>[] = [];
  /** Controller governado sintético da sessão CHECK: a fonte passa pela mesma validação do watcher real. */
  const observeController = (reviewer: typeof binding.reviewer, reason: string, nativo?: Record<string, unknown>) => {
    const reviewSession = lerThread(p.dir, delivery).sessoes.find(s => s.sessionId === reviewer.sessionId)!;
    const sessoes = path.join(dir, 'sessoes'), instancia = randomUUID();
    fs.mkdirSync(sessoes, { recursive: true, mode: 0o700 });
    const controlador = path.join(sessoes, `controller-${instancia}`), rollout = path.join(sessoes, `rollout-${instancia}.jsonl`);
    fs.mkdirSync(controlador, { mode: 0o700 });
    const despacho = Date.parse(reviewSession.despachadaEm!), line = (value: unknown) => JSON.stringify(value) + '\n';
    fs.writeFileSync(rollout, line({ type: 'session_meta', payload: { id: reviewSession.sessionId, cwd: p.dir } }) +
      line({ type: 'event_msg', timestamp: new Date(despacho - 500).toISOString(), payload: { type: 'turn.started', turn_id: 'turn-1' } }) +
      line({ type: 'event_msg', timestamp: new Date(despacho - 300).toISOString(), payload: { type: 'turn.completed', turn_id: 'turn-1', reason } }),
    { mode: 0o600 });
    const proprio = (cwd: string) => {
      const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], { cwd, stdio: 'ignore' });
      processos.push(filho);
      return identidadeDoProcesso(filho.pid!);
    };
    const controller = proprio(controlador), runtime = { ...proprio(p.dir), inicio: '0' };
    const vinculo = { thread: delivery, fase: 'CHECK', promptSha256: reviewSession.promptSha256 };
    const write = (name: string, value: unknown) => fs.writeFileSync(path.join(controlador, name), JSON.stringify(value), { mode: 0o600 });
    write('launch.json', { contrato: 'ork.controller-launch/v1', instancia, vinculo, cwd: p.dir, criadoEm: new Date(despacho - 1000).toISOString() });
    write('process-launch.json', { instancia, pid: controller.pid, processoController: controller });
    write('state.json', { instancia, vinculo, cwd: p.dir, sessionId: reviewSession.sessionId, pid: controller.pid,
      processoController: controller, processoRuntime: runtime, rollout, turno: 'turn-1', estado: 'completed',
      ...(nativo ? { terminal: nativo } : {}), processoEncerrado: { em: new Date(despacho).toISOString(), code: 0, signal: null } });
    registrar(dir, delivery, 'session_sensor_registered', { fase: 'CHECK', sessionId: reviewSession.sessionId,
      despachoEm: reviewSession.despachadaEm, controlador, cwd: p.dir });
    assert.equal(observarSessao(p.carregado, reviewSession.sessionId).concluido, true);
    return lerLedger(dir).filter(e => e.tipo === 'phase_result' && e.sessionId === reviewSession.sessionId).at(-1)!;
  };
  const limpar = () => { for (const filho of processos) filho.kill('SIGKILL'); p.limpar(); };
  return { ...p, limpar, objective, binding, dispatch, result, record, validate, observe, observeController };
}
const terminalNativo = (sessionId: string) => ({ metodo: 'turn/completed', threadId: sessionId, turnId: 'turn-1', status: 'completed' });

test('rejected aceita CHECK negativo do watcher, persiste rejeição e pausa; approved continua recusado', () => {
  const p = reviewFixture();
  try {
    assert.throws(() => p.validate('rejected'), /review-incomplete/);
    const result = p.observeController(p.binding.reviewer, 'claims.failed', terminalNativo(p.binding.reviewer.sessionId));
    assert.equal(result.classificacao, 'gate_blocked');
    assert.equal(result.motivo, 'claims.failed');
    assert.equal(result.ok, false);
    assert.equal(result.conclusaoNativa, true);
    assert.throws(() => p.validate('approved'), /review-incomplete/);
    const rejected = p.validate('rejected');
    assert.equal(rejected.status, 'paused');
    assert.equal(rejected.pauseReason, 'ensemble.rejected');
    assert.equal(rejected.validations.length, 1);
    assert.equal(rejected.validations[0].verdict, 'rejected');
    assert.equal(rejected.validations[0].identity?.reviewResultEvent, result.eventId);
    assert.equal(rejected.validations[0].identity?.executor.sessionId, p.binding.executor.sessionId);
    assert.deepEqual(readObjective(p.dir, p.objective.id), rejected);
  } finally { p.limpar(); }
});

test('rejected não transforma execução incompleta, fonte falsa ou resultado descorrelacionado em revisão negativa', () => {
  const p = reviewFixture();
  try {
    const before = readObjective(p.dir, p.objective.id);
    for (const extra of [
      ...['runtime.unavailable', 'runtime.silencio', 'runtime.rate-limited', 'human.pending', 'lease.busy',
        'artifact.missing', 'policy.violation', 'desconhecido'].map(motivo => ({ motivo })),
      { classificacao: 'human.pending' }, { origem: 'agent' }, { sensorResultId: '' }, { ok: true },
      { exitCode: null }, { exitCode: 1 }, { signal: 'SIGTERM' }, { exitCodeFonte: 'unavailable' },
      { fonteVencedora: null }, { runtime: 'claude-bg' }, { fase: 'GO' }, { despachoEm: '2000-01-01T00:00:00.000Z' },
      { ts: '2000-01-01T00:00:00.000Z' },
      // GO-FIX7: sem conclusão nativa correlacionada do controller não há parecer negativo.
      ...['claims.failed', 'ci.failed'].flatMap(motivo => [{ motivo, conclusaoNativa: false },
        { motivo, conclusaoNativa: undefined }, { motivo, conclusaoNativa: 'true' },
        { motivo, conclusaoNativaAusente: 'terminal nativo com status interrupted' },
        { motivo, exitCodeFonte: 'supervisor.close' }, { motivo, fonteVencedora: 'stream' }]),
    ]) {
      p.record(extra);
      assert.throws(() => p.validate('rejected'), /review-incomplete/, JSON.stringify(extra));
      assert.deepEqual(readObjective(p.dir, p.objective.id), before);
    }
    p.record();
    p.dispatch(p.binding.executor.threadId, 'GO');
    assert.throws(() => p.validate('rejected'), /review-stale/);
    assert.deepEqual(readObjective(p.dir, p.objective.id), before);
  } finally { p.limpar(); }
});

test('rejected recusa parecer negativo quando o supervisor observa erro de transporte', () => {
  const p = reviewFixture();
  try {
    const result = p.observe('claims.failed', { erro: 'fixture: transporte interrompido' });
    assert.equal(result.motivo, 'runtime.unavailable');
    assert.throws(() => p.validate('rejected'), /review-incomplete/);
    const value = readObjective(p.dir, p.objective.id);
    assert.equal(value.status, 'running');
    assert.deepEqual(value.validations, []);
  } finally { p.limpar(); }
});

test('GO-FIX7: ci.failed e bloqueio sem retry só viram parecer negativo com conclusão nativa correlacionada', () => {
  const p = reviewFixture();
  try {
    const before = readObjective(p.dir, p.objective.id);
    const review = () => p.dispatch(p.binding.executor.threadId, 'CHECK');
    const validate = (reviewer: typeof p.binding.reviewer) => p.validate('rejected', { ...p.binding, reviewer });
    // Supervisor não tem terminal nativo independente do texto do turno.
    const supervised = p.observe('ci.failed');
    assert.equal(supervised.motivo, 'ci.failed');
    assert.equal(supervised.conclusaoNativa, false);
    assert.throws(() => p.validate('rejected'), /review-incomplete/);
    for (const [motivo, nativo] of [['ci.failed', undefined], ['ci.failed', 'failed'], ['ci.failed', 'interrupted'],
      ['ci.failed', 'outro-turno'], ['claims.failed', 'interrupted']] as const) {
      const reviewer = review();
      const base = terminalNativo(reviewer.sessionId);
      const terminal = nativo === undefined ? undefined : nativo === 'outro-turno' ? { ...base, turnId: 'turn-9' } : { ...base, status: nativo };
      const result = p.observeController(reviewer, motivo, terminal);
      // A política sem retry preserva ci.failed no resultado, mas não prova fase concluída.
      assert.equal(result.motivo, motivo === 'ci.failed' ? 'ci.failed' : 'runtime.unavailable', `${motivo}:${nativo}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.exitCodeFonte, 'controller.close');
      assert.equal(result.conclusaoNativa, false, `${motivo}:${nativo}`);
      assert.equal(typeof result.conclusaoNativaAusente, 'string');
      assert.throws(() => validate(reviewer), /review-incomplete/, `${motivo}:${nativo}`);
      assert.deepEqual(readObjective(p.dir, p.objective.id), before);
    }
    const reviewer = review();
    const result = p.observeController(reviewer, 'ci.failed', terminalNativo(reviewer.sessionId));
    assert.equal(result.motivo, 'ci.failed');
    assert.equal(result.fonteVencedora, 'rollout');
    assert.equal(result.conclusaoNativa, true);
    assert.equal(result.conclusaoNativaAusente, null);
    const rejected = validate(reviewer);
    assert.equal(rejected.status, 'paused');
    assert.equal(rejected.validations[0].identity?.reviewResultEvent, result.eventId);
  } finally { p.limpar(); }
});

test('maxThreads=1 permite papéis em três sessões independentes na thread única, sem alterar envelope', () => {
  for (const verdict of ['approved', 'rejected'] as const) {
    const p = reviewFixture(1);
    try {
      const envelope = JSON.stringify(p.objective.envelope);
      assert.equal(p.objective.threads.length, 1);
      assert.equal(p.objective.threads[0].role, 'discovery');
      assert.throws(() => p.validate(verdict), /review-incomplete/);
      const result = verdict === 'rejected'
        ? p.observeController(p.binding.reviewer, 'claims.failed', terminalNativo(p.binding.reviewer.sessionId))
        : p.observe();
      assert.throws(() => p.validate(verdict, { ...p.binding, reviewer: p.binding.executor }), /self-review/);
      assert.throws(() => p.validate(verdict, { ...p.binding, conductor: p.binding.reviewer }), /self-review/);
      assert.throws(() => p.validate(verdict, { ...p.binding, reviewer: { ...p.binding.reviewer, sessionId: randomUUID() } }), /unproven/);
      const value = p.validate(verdict);
      assert.equal(value.status, verdict === 'approved' ? 'validated' : 'paused');
      assert.equal(value.validations[0].identity?.reviewResultEvent, result.eventId);
      assert.equal(new Set(Object.values(p.binding).map(s => s.sessionId)).size, 3);
      assert.equal(new Set(Object.values(p.binding).map(s => s.threadId)).size, 1);
      assert.equal(JSON.stringify(readObjective(p.dir, p.objective.id).envelope), envelope);
      assert.deepEqual(listarIds(p.dir), [p.objective.threads[0].id]);
    } finally { p.limpar(); }
  }
});

test('maxThreads maior que 1 conserva a exigência de delivery para execução e revisão', () => {
  const p = reviewFixture();
  try {
    const discovery = p.objective.threads[0].id;
    const binding = { conductor: p.binding.conductor, executor: p.dispatch(discovery, 'GO'), reviewer: p.dispatch(discovery, 'CHECK') };
    const session = lerThread(p.dir, discovery).sessoes.find(s => s.sessionId === binding.reviewer.sessionId)!;
    registrar(dirThread(p.dir, discovery), discovery, 'phase_result', { ...p.result, sessionId: session.sessionId,
      despachoEm: session.despachadaEm, classificacao: 'fase_concluida', ok: true });
    assert.throws(() => p.validate('approved', binding), /authority.scope/);
    assert.equal(readObjective(p.dir, p.objective.id).status, 'running');
  } finally { p.limpar(); }
});

test('sessions recusa runtime sem recibo de conclusão antes de criar objetivo ou threads', () => {
  const p = projetoTemporario('maestro-unsupported-review');
  try {
    const input = { title: 'Sem recibo', request: 'Revisar', doneWhen: ['revisto'], mode: 'auto' as const,
      executionRuntime: 'claude-bg', independence: 'sessions' as const };
    for (const validationRuntimes of [undefined, ['claude-bg'], ['codex', 'claude-bg'], ['outro']]) {
      assert.throws(() => createObjective(p.carregado, { ...input, validationRuntimes }), /maestro.authority.runtime-unsupported/);
      assert.deepEqual(listObjectives(p.dir), []);
      assert.deepEqual(listarIds(p.dir), []);
    }
    const op = receiveCreationOperation(p.dir, 'fixture', { key: 'unsupported-review-001', action: 'create_entity_with_ticket',
      entity: { kind: 'project', id: 'proj-fixture', parentId: 'prod-fixture', title: input.title, acceptanceCriteria: [] },
      expectedParentVersion: 1, request: input.request, doneWhen: input.doneWhen, workspaceIds: [], mode: input.mode }, 'ork');
    assert.throws(() => createReservedObjective(p.carregado, input, { operationId: op.operationId, principal: op.principal }),
      /maestro.authority.runtime-unsupported/);
    assert.deepEqual(listObjectives(p.dir), []);
    assert.deepEqual(listarIds(p.dir), []);
    // Execução Claude continua permitida quando o revisor fornece recibo suportado.
    const supported = createObjective(p.carregado, { ...input, validationRuntimes: ['codex'] });
    assert.equal(supported.envelope.executionRuntime, 'claude-bg');
    assert.deepEqual(supported.envelope.validationRuntimes, ['codex']);
  } finally { p.limpar(); }
});

test('mesmo harness exige três sessões provadas e preserva envelope; seletores não são prova', () => {
  const p = projetoTemporario('maestro-authority');
  try {
    const objective = createObjective(p.carregado, { title: 'Isolamento', request: 'Revisar', doneWhen: ['revisto'],
      executionRuntime: 'codex', validationRuntimes: ['codex'], independence: 'sessions' });
    const dispatch = (threadId: string, fase: 'PLAN' | 'GO' | 'CHECK') => {
      const thread = lerThread(p.dir, threadId), sessionId = randomUUID(), slug = `${threadId}-${fase}`;
      thread.worktree = p.dir;
      const promptPath = path.join(dirThread(p.dir, threadId), `${sessionId}.md`);
      fs.writeFileSync(promptPath, fase);
      const promptSha256 = createHash('sha256').update(fase).digest('hex');
      thread.sessoes.push({ sessionId, slug, fase, bloco: fase, runtime: 'codex', verificada: true,
        despachadaEm: new Date().toISOString(), promptPath: path.relative(p.dir, promptPath), promptSha256 });
      gravarThread(p.dir, thread);
      registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch', { sessionId, slug, fase, runtime: 'codex', cwd: p.dir, promptSha256 });
      registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch_verified', { sessionId, slug, encontrada: true, fonte: 'fixture-only' });
      return { threadId, sessionId, worktree: p.dir };
    };
    approveObjective(p.dir, objective.id, 'fixture-owner');
    const binding: SessionReviewBinding = { conductor: dispatch(objective.threads[0].id, 'PLAN'),
      executor: dispatch(objective.threads[1].id, 'GO'), reviewer: dispatch(objective.threads[1].id, 'CHECK') };
    assert.throws(() => validateObjective(p.dir, objective.id, 'codex', 'approved', 'fixture'), /unproven/);
    assert.throws(() => verifySessionReview(p.dir, { ...binding, reviewer: binding.executor }), /self-review/);
    assert.throws(() => verifySessionReview(p.dir, { ...binding, reviewer: { ...binding.reviewer, sessionId: randomUUID() } }), /unproven/);
    assert.throws(() => verifySessionReview(p.dir, { ...binding, reviewer: { ...binding.reviewer, threadId: binding.conductor.threadId } }), /unproven/);
    assert.throws(() => verifySessionReview(p.dir, { ...binding, reviewer: { ...binding.reviewer, worktree: '/tmp' } }), /scope/);
    assert.throws(() => validateObjective(p.dir, objective.id, 'codex', 'approved', 'fixture', binding), /review-incomplete/);
    const reviewSession = lerThread(p.dir, binding.reviewer.threadId).sessoes.find(s => s.sessionId === binding.reviewer.sessionId)!;
    const result = { fase: 'CHECK', sessionId: reviewSession.sessionId, runtime: reviewSession.runtime,
      despachoEm: reviewSession.despachadaEm, origem: 'sessions.watch', classificacao: 'fase_concluida', ok: true, sensorResultId: 'fixture-only' };
    registrar(dirThread(p.dir, binding.reviewer.threadId), binding.reviewer.threadId, 'phase_result', { ...result, origem: 'agent' });
    assert.throws(() => validateObjective(p.dir, objective.id, 'codex', 'approved', 'fixture', binding), /review-incomplete/);
    const completed = registrar(dirThread(p.dir, binding.reviewer.threadId), binding.reviewer.threadId, 'phase_result', result);
    // I-43 (T11): `ork objective` saiu, e o que este teste prova NAO era o parse de
    // flag: e a autoridade de review de sessao, que continua inteira na API interna.
    const validated = validateObjective(p.dir, objective.id, 'codex', 'approved', 'fixture',
      parseSessionReviewBinding(JSON.parse(JSON.stringify(binding))));
    assert.equal(validated.status, 'validated');
    assert.equal(validated.envelope.hash, objective.envelope.hash);
    const identidade = validated.validations[0]?.identity;
    assert.equal(identidade?.dispatchEvents.length, 6);
    assert.equal(identidade?.reviewResultEvent, completed.eventId);
    assert.equal(identidade?.envelope?.hash, objective.envelope.hash);
    assert.equal(identidade?.envelope?.version, 1);
    assert.equal(readObjective(p.dir, objective.id).envelope.hash, objective.envelope.hash);
    const reviewer = lerThread(p.dir, binding.reviewer.threadId);
    reviewer.sessoes.find(s => s.sessionId === binding.reviewer.sessionId)!.promptSha256 = '0'.repeat(64);
    gravarThread(p.dir, reviewer);
    assert.throws(() => verifySessionReview(p.dir, binding), /unproven/);
  } finally { p.limpar(); }
});

test('opt-in de independência preserva padrão legado; campos extras, opções inválidas e IDs inventados não dão autoridade', () => {
  const p = projetoTemporario('maestro-session-cli');
  try {
    // I-43 (T11): `ork objective` saiu do CLI. A autoridade que este teste guarda
    // (opt-in explicito, dois runtimes, recusa de modo inventado, binding que nao
    // escapa do escopo) e do nucleo e continua inteira; o que se perdeu foi so a
    // conferencia de que o CLI repassava as flags, e esse CLI nao existe mais.
    const value = createObjective(p.carregado, { title: 'CLI', request: 'Revisar', doneWhen: ['Prova'],
      executionRuntime: 'codex', validationRuntimes: ['codex'], independence: 'sessions' });
    assert.equal(value.envelope.independence, 'sessions');
    assert.deepEqual(value.envelope.validationRuntimes, ['codex']);
    assert.throws(() => createObjective(p.carregado, { title: 'Sem modo', request: 'Revisar', doneWhen: ['Prova'],
      executionRuntime: 'codex', validationRuntimes: ['codex'] }), /dois runtimes|runtime diferente/);
    assert.throws(() => createObjective(p.carregado, { title: 'Inválido', request: 'Revisar', doneWhen: ['Prova'],
      independence: 'unsafe' as 'sessions' }), /authority.mode/);
    const r = { threadId: value.threads[0].id, sessionId: 'fixture', worktree: p.dir };
    const binding = { conductor: r, executor: { ...r, sessionId: 'other' }, reviewer: { ...r, sessionId: 'third' } };
    for (const bad of [{ ...binding, approved: true }, { ...binding, reviewer: { ...r, root: '/tmp' } },
      { ...binding, reviewer: { ...r, threadId: '../escape' } }]) assert.throws(() => parseSessionReviewBinding(bad), /authority.binding/);
    assert.throws(() => verifySessionReview(p.dir, binding), /authority.(scope|unproven)/);
  } finally { p.limpar(); }
});

test('envelope legado continua legível byte a byte e não recebe independência inferida', () => {
  const p = projetoTemporario('maestro-legacy');
  try {
    const old = createObjective(p.carregado, { title: 'Legado', request: 'Ler', doneWhen: ['preservado'] });
    const raw = JSON.stringify(old.envelope);
    assert.equal(JSON.stringify(readObjective(p.dir, old.id).envelope), raw);
    assert.equal(old.envelope.independence, undefined);
  } finally { p.limpar(); }
});

test('review vincula último GO e envelope aprovado: rejeita CHECK antigo e reaproveitamento após revisão', t => {
  const p = projetoTemporario('maestro-review-fresh');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const objective = createObjective(p.carregado, { title: 'Versão atual', request: 'Revisar', doneWhen: ['revisto'],
      executionRuntime: 'codex', validationRuntimes: ['codex'], independence: 'sessions' });
    approveObjective(p.dir, objective.id, 'fixture-owner');
    const dispatch = (threadId: string, fase: 'PLAN' | 'GO' | 'CHECK') => {
      t.mock.timers.tick(10);
      const thread = lerThread(p.dir, threadId), sessionId = randomUUID(), slug = `${threadId}-${sessionId}`;
      thread.worktree = p.dir;
      const promptPath = path.join(dirThread(p.dir, threadId), `${sessionId}.md`);
      fs.writeFileSync(promptPath, fase);
      const promptSha256 = createHash('sha256').update(fase).digest('hex'), despachadaEm = new Date().toISOString();
      thread.sessoes.push({ sessionId, slug, fase, bloco: fase, runtime: 'codex', verificada: true,
        despachadaEm, promptPath: path.relative(p.dir, promptPath), promptSha256 });
      gravarThread(p.dir, thread);
      registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch', { sessionId, slug, fase, runtime: 'codex', cwd: p.dir, promptSha256 });
      registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch_verified', { sessionId, slug, encontrada: true, fonte: 'fixture-only' });
      if (fase === 'CHECK') registrar(dirThread(p.dir, threadId), threadId, 'phase_result', { sessionId, fase,
        runtime: 'codex', despachoEm: despachadaEm, origem: 'sessions.watch', classificacao: 'fase_concluida',
        ok: true, sensorResultId: `fixture-${sessionId}` });
      return { threadId, sessionId, worktree: p.dir };
    };
    const conductor = dispatch(objective.threads[0].id, 'PLAN'), delivery = objective.threads[1].id;
    const oldCheck = dispatch(delivery, 'CHECK'), executor = dispatch(delivery, 'GO');
    const validate = (binding: SessionReviewBinding) => validateObjective(p.dir, objective.id, 'codex', 'approved', 'fixture', binding);
    assert.throws(() => validate({ conductor, executor, reviewer: oldCheck }), /review-stale/);
    const binding = { conductor, executor, reviewer: dispatch(delivery, 'CHECK') };
    assert.equal(validate(binding).status, 'validated');
    const nextExecutor = dispatch(delivery, 'GO');
    assert.throws(() => validate(binding), /review-stale/);
    assert.throws(() => validate({ ...binding, executor: nextExecutor }), /review-stale/);
    const current = { conductor, executor: nextExecutor, reviewer: dispatch(delivery, 'CHECK') };
    assert.equal(validate(current).status, 'validated');
    // Revisão/aprovação no MESMO milissegundo do CHECK: a ordem do ledger,
    // além do relógio, impede reaproveitar prova da versão anterior.
    const revised = reviseObjective(p.dir, objective.id, 'Requisito revisado');
    approveObjective(p.dir, objective.id, 'fixture-owner');
    assert.throws(() => validate(current), /envelope-stale/);
    assert.throws(() => validate({ ...current, reviewer: dispatch(delivery, 'CHECK') }), /envelope-stale/);
    const newExecution = dispatch(delivery, 'GO'), newReview = dispatch(delivery, 'CHECK');
    const accepted = validate({ conductor, executor: newExecution, reviewer: newReview });
    assert.equal(accepted.status, 'validated');
    assert.equal(accepted.validations.length, 1);
    assert.equal(accepted.validations[0].identity?.envelope?.hash, revised.envelope.hash);
    assert.equal(accepted.validations[0].identity?.envelope?.version, 2);
    assert.equal(accepted.validations[0].identity?.executor.sessionId, newExecution.sessionId);
    assert.ok(accepted.validations[0].identity?.executionEvent);
    assert.ok(accepted.validations[0].identity?.envelopeApprovalEvent);
  } finally { t.mock.timers.reset(); p.limpar(); }
});

test('GO-FIX 2 (D12): CHECK claude-bg concluído com parecer e verify do HEAD não conta como revisão concluída', () => {
  const p = reviewFixture();
  try {
    const delivery = p.binding.reviewer.threadId, dir = dirThread(p.dir, delivery);
    const thread = lerThread(p.dir, delivery);
    const sessao = thread.sessoes.find(s => s.sessionId === p.binding.reviewer.sessionId)!;
    sessao.runtime = 'claude-bg'; gravarThread(p.dir, thread);
    registrar(dir, delivery, 'phase_dispatch', { sessionId: sessao.sessionId, slug: sessao.slug, fase: 'CHECK', runtime: 'claude-bg',
      cwd: p.dir, promptSha256: sessao.promptSha256 });
    registrar(dir, delivery, 'phase_result', { fase: 'CHECK', sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm,
      runtime: 'claude-bg', origem: 'sessions.watch', classificacao: 'fase_concluida', ok: true, motivo: null,
      sensorResultId: 'claude-bg:' + 'd'.repeat(64), conclusaoNativa: true, conclusaoNativaAusente: null,
      provaOrk: { ok: true, fonte: 'docs/check.md gravado com veredito PASSOU', veredito: 'PASSOU',
        verify: { eventId: 'fixture-only', commit: 'a'.repeat(40), ts: new Date().toISOString() } } });
    // Sem recibo autenticado de conclusão CHECK, a prova do ork não transforma claude-bg em revisor.
    assert.throws(() => p.validate('approved'), /maestro.authority.runtime-unsupported/);
    assert.equal(readObjective(p.dir, p.objective.id).status, 'running');
  } finally { p.limpar(); }
});
