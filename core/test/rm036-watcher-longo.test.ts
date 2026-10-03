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
import { identidadeProcesso } from '../src/adapters/codex-runner';
import { assumirConducao, nomeDaConducao, conducaoDaThread } from '../src/conducao';
import { regravarLease } from '../src/leases';
import { adicionarClaim } from '../src/claims';
import { commitMcp, estadoGitMcp } from '../src/mcp-git';
import { comEstadoParaGit } from '../src/estado-thread';
import { nomeDaMaquina } from '../src/maquina';
import { acompanharSessao, observarSessao, LIMITE_MORTE_MS, MAX_ESPERA_ERRO_WATCH_MS, MAX_FALHAS_WATCH } from '../src/session-watcher';

const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const INSTANCIA = '11111111-2222-3333-4444-555555555555';
const linha = (e: unknown) => JSON.stringify(e) + '\n';

test('RM036: documentação registra a correção e mantém revisão pendente', () => {
  const raiz = path.resolve(__dirname, '../../..');
  const roadmap = fs.readFileSync(path.join(raiz, 'docs/roadmap/RM-036-maestro-multicanal.md'), 'utf8');
  const historico = roadmap.split('\n').find(l => l.startsWith('|') && l.includes('`ork-rm036watcher`'));
  assert.ok(historico?.includes('`rm036-watcher-longo`'));
  const secoes = fs.readFileSync(path.join(raiz, 'CHANGELOG.md'), 'utf8').split(/\n## /).slice(1);
  const secao = secoes.find(s => s.includes('**Watcher e recuperação da condução Codex**'));
  assert.ok(secao, 'correção consta do changelog');
  assert.match(secao, /^Não publicado\n/);
  assert.match(secao, /ausentes por identidade comprovada/);
});

function fixture(teste: TestContext, opcoes: { worktree?: boolean; baseMs?: number } = {}) {
  const baseMs = opcoes.baseMs ?? BASE;
  const p = projetoTemporario('rm036-longo');
  const t = novaThread(p.carregado, { nome: 'watch', modo: 'auto', criarWorktree: opcoes.worktree }).thread;
  const cwd = t.worktree ?? p.dir;
  const despachadaEm = new Date(baseMs + 1000).toISOString();
  const promptSha256 = 'a'.repeat(64);
  t.sessoes.push({ sessionId: SID, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex',
    despachadaEm, promptPath: '', promptSha256, verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id), sessoes = path.join(dir, 'sessoes');
  const controlador = path.join(sessoes, 'controller-' + INSTANCIA);
  fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
  const filhos = [controlador, cwd, cwd].map(cwd => spawn(process.execPath,
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
  fs.writeFileSync(roll, linha({ type: 'session_meta', payload: { id: SID, cwd } }), { mode: 0o600 });
  const vinculo = { thread: t.id, fase: 'GO', promptSha256 };
  const escrever = (nome: string, dado: unknown) => fs.writeFileSync(path.join(controlador, nome), JSON.stringify(dado), { mode: 0o600 });
  const state = { instancia: INSTANCIA, vinculo, cwd, sessionId: SID, pid: controller.pid,
    processoController: controller, processoRuntime: runtime, rollout: roll, turno: 'turn-1', estado: 'working' };
  escrever('launch.json', { contrato: 'ork.controller-launch/v1', instancia: INSTANCIA, vinculo,
    cwd, criadoEm: new Date(baseMs).toISOString() });
  escrever('process-launch.json', { instancia: INSTANCIA, pid: controller.pid, processoController: controller });
  escrever('state.json', state);
  registrar(dir, t.id, 'phase_dispatch', { ts: despachadaEm, sessionId: SID, controlador, cwd, fase: 'GO', promptSha256 });
  registrar(dir, t.id, 'session_sensor_registered', { sessionId: SID, despachoEm: despachadaEm, controlador, cwd });
  const evento = (ms: number, payload: unknown) => {
    fs.appendFileSync(roll, linha({ type: 'event_msg', timestamp: new Date(baseMs + ms).toISOString(), payload }));
    fs.utimesSync(roll, (baseMs + ms) / 1000, (baseMs + ms) / 1000);
  };
  evento(1000, { type: 'task_started', turn_id: 'turn-1' });
  const progresso = (ms: number) => evento(ms, { type: 'agent_message', message: 'Progresso da fixture', turn_id: 'turn-1' });
  const terminar = (ms: number) => {
    evento(ms, { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'Concluído.' });
    escrever('state.json', { ...state, estado: 'completed', terminal: { metodo: 'turn/completed',
      threadId: SID, turnId: 'turn-1', status: 'completed' },
      processoEncerrado: { em: new Date(baseMs + ms).toISOString(), code: 0, signal: null } });
  };
  return { ...p, t, dirEstado: dir, controlador, state, escrever, progresso, terminar, filhos, baseMs, roll,
    eventos: () => lerLedger(dir),
    run: (ms: number) => observarSessao(p.carregado, SID, { agoraMs: baseMs + ms, threadId: t.id }) };
}

for (const transporte of ['recibo-fixture', 'MCP-real'] as const) {
test(`RM036: commit ${transporte} mantém Codex vivo com rollout parado além de 600 s`, async t => {
  const p = fixture(t, { worktree: transporte === 'MCP-real', baseMs: Date.now() - 500000 });
  assert.equal(p.run(2000).concluido, false);
  const antes = fs.readFileSync(p.roll);
  let sha: string;
  if (transporte === 'MCP-real') {
    const arquivo = 'produto-fixture.txt';
    fs.writeFileSync(path.join(p.t.worktree!, arquivo), 'produção da fixture\n');
    adicionarClaim(p.dir, p.t.id, { arquivo, fase: 'GO', alegacao: 'produto da fixture', verificar: ['true'] });
    const head = estadoGitMcp(p.dir, p.t.id).source.head;
    const commit = await commitMcp(p.dir, { threadId: p.t.id, expectedHead: head, paths: [arquivo], mensagem: 'produto da fixture' });
    assert.equal(commit.ok, true, commit.erro ?? '');
    sha = commit.commit!;
  } else {
    sha = 'b'.repeat(40);
    registrar(p.dirEstado, p.t.id, 'mcp_git_committed', { ts: new Date(p.baseMs + 500000).toISOString(),
      commit: sha, paths: ['produto-fixture.txt'], origem: 'mcp.git', estadoAuditado: true });
  }
  const recibo = p.eventos().find(e => e.tipo === 'mcp_git_committed')!;
  assert.equal(recibo.commit, sha);
  assert.equal(recibo.estadoAuditado, true);
  const commitMs = Date.parse(recibo.ts) - p.baseMs;
  assert.ok(commitMs < LIMITE_MORTE_MS);
  assert.equal(p.run(600999).concluido, false);
  assert.equal(p.run(601000).concluido, false, 'regressão aparece somente na fronteira sem progresso do rollout');
  assert.equal(p.run(commitMs + LIMITE_MORTE_MS - 1).concluido, false);
  assert.deepEqual(fs.readFileSync(p.roll), antes, 'MCP não avançou o rollout');
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
  p.terminar(commitMs + LIMITE_MORTE_MS);
  assert.equal(p.run(commitMs + LIMITE_MORTE_MS).concluido, true);
  const resultados = p.eventos().filter(e => e.tipo === 'phase_result');
  assert.equal(resultados.length, 1);
  assert.equal(resultados[0].ok, true);
  assert.equal(resultados[0].conclusaoNativa, true);
});
}

for (const caso of ['expirou', 'sem-auditoria', 'outra-sessao', 'outra-thread', 'outra-origem', 'sha-invalido',
  'futuro', 'antes-do-despacho', 'depois-de-outro-despacho', 'runtime-ausente', 'terminal-nativo'] as const) {
  test(`RM036: commit não oculta silêncio nem lacuna de prova (${caso})`, async t => {
    const p = fixture(t);
    p.run(2000);
    if (caso === 'runtime-ausente') {
      const fim = once(p.filhos[1], 'close'); p.filhos[1].kill(); await fim;
    }
    // Terminal presente vence até um estado mutável que ainda diga working.
    if (caso === 'terminal-nativo') p.escrever('state.json', { ...p.state,
      terminal: { metodo: 'turn/completed', threadId: SID, turnId: 'turn-1', status: 'completed' } });
    if (caso === 'depois-de-outro-despacho') registrar(p.dirEstado, p.t.id, 'phase_dispatch', {
      ts: new Date(BASE + 400000).toISOString(), sessionId: 'outra-sessao' });
    registrar(p.dirEstado, caso === 'outra-thread' ? 'outra-thread' : p.t.id, 'mcp_git_committed', {
      ts: new Date(BASE + (caso === 'futuro' ? 900000 : caso === 'antes-do-despacho' ? 0 : 500000)).toISOString(),
      origem: caso === 'outra-origem' ? 'agente' : 'mcp.git', estadoAuditado: caso !== 'sem-auditoria',
      commit: caso === 'sha-invalido' ? 'invalido' : 'b'.repeat(40),
      ...(caso === 'outra-sessao' ? { sessionId: 'outra-sessao' } : {}) });
    const ms = caso === 'expirou' ? 1100000 : 601000;
    assert.equal(p.run(ms - 1).concluido, false);
    assert.equal(p.run(ms).classificacao, 'gate_blocked');
    assert.equal(p.eventos().find(e => e.tipo === 'phase_result')?.conclusaoNativa, false);
  });
}

test('RM036: materialização real do estado para commit é retry, sem ignorar auditoria', async t => {
  const p = fixture(t, { worktree: true });
  p.run(2000);
  let soltar!: () => void;
  const destravar = new Promise<void>(r => { soltar = r; });
  let laço!: Promise<void>, esperas = 0;
  comEstadoParaGit(p.dir, p.t.id, p.t.worktree!, () => {
    assert.throws(() => p.run(3000), /estado dividido/);
    laço = acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + 3000,
      esperar: async () => { assert.ok(++esperas <= 1); await destravar; } });
  });
  p.terminar(3000); soltar();
  await laço;
  assert.equal(esperas, 1);
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result' && e.ok).length, 1);
  assert.ok(p.eventos().filter(e => e.tipo === 'session_watcher_error').every(e => e.categoria === 'estado.dividido'));
});

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
  const prazo = agora + 10000;
  await acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + agora,
    esperar: async () => { agora += 1000; assert.ok(agora <= prazo, 'watcher deve terminar dentro do prazo da fixture'); p.terminar(agora); } });
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
    assert.equal(erros.length, 2, 'somente primeira falha e resumo final');
    assert.equal(erros[0].falhasConsecutivas, 1);
    assert.equal(erros[1].falhasConsecutivas, 8);
    assert.equal(erros[1].encerramento, 'recuperado');
    assert.ok(erros.every(e => e.sessionId === SID && e.transitorio === true));
    const categoria = { 'json-thread': 'json.invalido', 'json-state': 'runtime.unavailable: metadado state.json de controller inválido',
      ENOENT: 'runtime.unavailable: metadado state.json de controller ausente', lock: 'observacao.ocupada' }[falha];
    assert.ok(erros.every(e => e.categoria === categoria && e.construtor === 'Error'));
    assert.ok(!JSON.stringify(erros).includes('segredo-fixture'));
    assert.ok(!JSON.stringify(erros).includes(p.dir));
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result' && e.ok === true).length, 1);
  });
}

for (const falha of ['state-ausente', 'controller-ausente', 'ENOENT', 'prazo'] as const) {
  test(`RM036: falha persistente encerra sem inundar ledger (${falha})`, async t => {
    const p = fixture(t);
    p.run(2000);
    if (falha === 'controller-ausente') fs.rmSync(p.controlador, { recursive: true });
    else fs.unlinkSync(path.join(p.controlador, 'state.json'));
    if (falha === 'ENOENT') {
      t.mock.method(require('../src/session-events'), 'resolverSessao', () => {
        throw Object.assign(new Error('caminho-segredo-fixture'), { code: 'ENOENT' });
      });
    }
    let agora = 3000, esperas = 0;
    await assert.rejects(acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + agora,
      esperar: async ms => {
        assert.ok(++esperas < MAX_FALHAS_WATCH + 2, 'retry persistente tem teto de tentativas');
        agora += falha === 'prazo' ? LIMITE_MORTE_MS : ms;
      } }));
    assert.equal(esperas, falha === 'prazo' ? 1 : MAX_FALHAS_WATCH - 1);
    const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
    assert.equal(erros.length, 2);
    assert.equal(erros[0].etapa, 'inicial');
    assert.equal(erros[0].falhasConsecutivas, 1);
    assert.equal(erros[1].etapa, 'final');
    assert.equal(erros[1].transitorio, false);
    assert.equal(erros[1].encerramento, falha === 'prazo' ? 'prazo' : 'tentativas');
    assert.equal(erros[1].falhasConsecutivas, esperas + 1);
    if (falha === 'ENOENT' || falha === 'controller-ausente') {
      assert.equal(erros[1].code, 'ENOENT'); assert.equal(erros[1].categoria, 'io.ENOENT');
    }
    assert.ok(!JSON.stringify(erros).includes('segredo-fixture'));
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
  });
}

test('RM036: observação bem-sucedida reinicia orçamento e série de erros', async t => {
  const p = fixture(t);
  p.run(2000);
  fs.unlinkSync(path.join(p.controlador, 'state.json'));
  let agora = 3000, esperas = 0;
  await acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + agora,
    esperar: async ms => {
      assert.ok(++esperas <= 2 * MAX_FALHAS_WATCH, 'duas séries precisam recuperar');
      agora += ms;
      if (esperas === MAX_FALHAS_WATCH - 1) {
        agora += LIMITE_MORTE_MS - 1;
        p.progresso(agora); p.escrever('state.json', p.state);
      } else if (esperas === MAX_FALHAS_WATCH) fs.unlinkSync(path.join(p.controlador, 'state.json'));
      else if (esperas === 2 * MAX_FALHAS_WATCH - 1) p.terminar(agora);
    } });
  const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
  assert.deepEqual(erros.map(e => e.falhasConsecutivas), [1, MAX_FALHAS_WATCH - 1, 1, MAX_FALHAS_WATCH - 1]);
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result' && e.ok).length, 1);
});

test('RM036: falha no registro do diagnóstico não derruba retry transitório', async t => {
  const p = fixture(t);
  p.run(2000);
  fs.unlinkSync(path.join(p.controlador, 'state.json'));
  const ledger = require('../src/ledger') as typeof import('../src/ledger');
  const registrarReal = ledger.registrarSeExiste;
  let registros = 0, esperas = 0;
  t.mock.method(ledger, 'registrarSeExiste', (...args: Parameters<typeof registrarReal>) => {
    if (args[2] === 'session_watcher_error' && ++registros === 1) throw new Error('registro indisponível');
    return registrarReal(...args);
  });
  await acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + 3000,
    esperar: async () => { assert.ok(++esperas <= 1, 'retry deve recuperar na próxima observação'); p.terminar(3000); } });
  assert.equal(registros, 2);
  assert.equal(esperas, 1);
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result' && e.ok).length, 1);
  assert.equal(p.eventos().find(e => e.tipo === 'session_watcher_error')?.encerramento, 'recuperado');
});

test('RM036: erro permanente registra diagnóstico sanitizado antes de sair, sem resultado', async t => {
  const p = fixture(t);
  p.run(2000);
  p.escrever('state.json', { ...p.state, sessionId: 'outra-sessao-segredo-fixture' });
  await assert.rejects(acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + 700000,
    esperar: async () => assert.fail('erro de identidade não pode repetir') }), /sessão do controller divergente/);
  const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
  assert.equal(erros.length, 1);
  assert.equal(erros[0].transitorio, false);
  assert.equal(erros[0].categoria, 'runtime.unavailable: sessão do controller divergente');
  assert.equal(erros[0].etapa, 'final');
  assert.equal(erros[0].encerramento, 'permanente');
  assert.equal(erros[0].falhasConsecutivas, 1);
  assert.equal(erros[0].code, null);
  assert.equal(erros[0].construtor, 'Error');
  assert.ok(!JSON.stringify(erros).includes('segredo-fixture'));
  assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
});

test('RM036: estado dividido persistente esgota retry sem ler a cópia local', async t => {
  const p = fixture(t, { worktree: true });
  p.run(2000);
  const local = path.join(p.t.worktree!, '.orkastery', 'threads', p.t.id);
  fs.unlinkSync(local); fs.mkdirSync(local);
  try {
    let esperas = 0;
    await assert.rejects(acompanharSessao(p.carregado, SID, { threadId: p.t.id, agora: () => BASE + 3000,
      esperar: async () => { assert.ok(++esperas < MAX_FALHAS_WATCH + 1); } }), /estado dividido/);
    assert.equal(esperas, MAX_FALHAS_WATCH - 1);
    const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
    assert.equal(erros.length, 2);
    assert.equal(erros[1].categoria, 'estado.dividido');
    assert.equal(erros[1].code, 'SESSION_STATE_SPLIT');
    assert.equal(erros[1].transitorio, false);
    assert.ok(!JSON.stringify(erros).includes(p.dir));
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length, 0);
  } finally { fs.rmdirSync(local); fs.symlinkSync(p.dirEstado, local, 'dir'); }
});

for (const categoria of ['controller.registro-divergente', 'controller.cwd-ausente', 'SyntaxError', 'motivo-desconhecido'] as const) {
  test(`RM036: diagnóstico saneado de ${categoria}`, async t => {
    const p = fixture(t);
    p.run(2000);
    // Metadados são lidos em cada poll, não apenas no ramo estavel de 600 s.
    if (categoria === 'controller.registro-divergente') registrar(p.dirEstado, p.t.id, 'phase_dispatch', {
      sessionId: SID, controlador: p.controlador + '-divergente', cwd: p.dir });
    else if (categoria === 'controller.cwd-ausente') {
      registrar(p.dirEstado, p.t.id, 'phase_dispatch', { sessionId: SID, controlador: p.controlador });
      registrar(p.dirEstado, p.t.id, 'session_sensor_registered', { sessionId: SID,
        despachoEm: p.t.sessoes[0].despachadaEm, controlador: p.controlador });
    } else {
      t.mock.method(require('../src/session-events'), 'resolverSessao', () => {
        if (categoria === 'SyntaxError') throw new SyntaxError('segredo-fixture');
        class ErroSegredoFixture extends Error {}
        throw Object.assign(new ErroSegredoFixture('runtime.unavailable: segredo-fixture'), { code: 'SEGREDO_FIXTURE' });
      });
    }
    assert.throws(() => p.run(3000));
    const e = p.eventos().find(e => e.tipo === 'session_watcher_error')!;
    assert.equal(e.categoria, categoria === 'SyntaxError' ? 'json.invalido'
      : categoria === 'motivo-desconhecido' ? 'runtime.unavailable: motivo não categorizado' : categoria);
    assert.equal(e.construtor, categoria === 'SyntaxError' ? 'SyntaxError' : categoria === 'motivo-desconhecido' ? 'desconhecido' : 'Error');
    assert.equal(e.code, null);
    assert.ok(!JSON.stringify(e).includes('segredo-fixture'));
    assert.ok(!JSON.stringify(e).includes(p.dir));
  });
}

test('RM036: processo destacado registra falha anterior à leitura do manifesto', async t => {
  const p = fixture(t);
  fs.writeFileSync(path.join(p.dir, 'orkastery.yaml'), 'manifesto inválido da fixture');
  const stderrFile = path.join(p.dir, 'watcher.stderr'), fd = fs.openSync(stderrFile, 'w');
  let filho;
  try {
    filho = spawn(process.execPath, [path.resolve(__dirname, '../src/session-watcher.js'), '--run', p.dir,
      SID, path.join(p.dirEstado, 'ready.json'), 'token-fixture', p.t.id], { stdio: ['ignore', 'ignore', fd] });
  } finally { fs.closeSync(fd); }
  const [codigo] = await once(filho, 'close');
  assert.equal(codigo, 1);
  assert.match(fs.readFileSync(stderrFile, 'utf8'), /confira session_watcher_error/);
  const erros = p.eventos().filter(e => e.tipo === 'session_watcher_error');
  assert.equal(erros.length, 1);
  assert.equal(erros[0].sessionId, SID);
  assert.equal(erros[0].transitorio, false);
  assert.ok(!JSON.stringify(erros).includes(p.dir));
});

for (const caso of ['mortos', 'runtime-vivo', 'pid-runtime-reciclado', 'watcher-vivo', 'watcher-anterior-vivo',
  'controlador-ocioso', 'sem-identidade', 'despacho-antigo', 'terminal-concorrente',
  'terminal-apos-processos', 'sem-fixacao', 'fixacao-divergente', 'outra-maquina'] as const) {
  test(`RM036: handoff local com prova de identidade (${caso})`, async t => {
    const p = fixture(t);
    p.run(2000); // Fixa a fonte autenticada como no despacho real.
    const watcher = { ...identidadeProcesso(p.filhos[2].pid!)!, ...(caso === 'watcher-vivo' ? {} : { inicio: '0' }) };
    if (caso === 'watcher-anterior-vivo') registrar(p.dirEstado, p.t.id, 'session_watcher_started', {
      sessionId: SID, despachoEm: p.t.sessoes[0].despachadaEm, pid: p.filhos[2].pid, identidade: identidadeProcesso(p.filhos[2].pid!) });
    registrar(p.dirEstado, p.t.id, 'session_watcher_started', { sessionId: SID,
      despachoEm: caso === 'despacho-antigo' ? new Date(BASE).toISOString() : p.t.sessoes[0].despachadaEm,
      pid: watcher.pid, ...(caso === 'sem-identidade' ? {} : { identidade: watcher }) });
    const pin = path.join(p.dirEstado, 'sessoes', fs.readdirSync(path.join(p.dirEstado, 'sessoes'))
      .find(n => n.startsWith('watcher-source-'))!);
    if (caso === 'sem-fixacao') fs.unlinkSync(pin);
    if (caso === 'fixacao-divergente') {
      const fonte = JSON.parse(fs.readFileSync(pin, 'utf8'));
      fs.writeFileSync(pin, JSON.stringify({ ...fonte, sessionId: 'outra-sessao' }));
    }
    if (caso === 'pid-runtime-reciclado') {
      const fonte = JSON.parse(fs.readFileSync(pin, 'utf8'));
      // O PID existe, mas agora pertence a outro processo (inicio distinto da captura).
      fs.writeFileSync(pin, JSON.stringify({ ...fonte, processoRuntime: { ...fonte.processoRuntime, inicio: '0' } }));
    } else if (caso !== 'runtime-vivo') {
      const fechado = once(p.filhos[1], 'close'); p.filhos[1].kill(); await fechado;
    }
    if (caso !== 'controlador-ocioso') {
      const fechado = once(p.filhos[0], 'close'); p.filhos[0].kill(); await fechado;
      // O fallback não depende da releitura do IPC que já pode ter sido removido.
      fs.unlinkSync(path.join(p.controlador, 'state.json'));
    }
    regravarLease(p.dir, { nome: nomeDaConducao(p.t.id), thread: p.t.id, motivo: 'sessão da fixture', pid: process.pid,
      adquiridoEm: new Date(BASE + 1000).toISOString(), expiraEm: new Date(Date.now() + 3600000).toISOString(),
      conducao: { contrato: 'ork.conducao/v1', canal: 'codex', correlacao: null, operacao: 'phase.run', fase: 'GO',
        promptSha256: p.state.vinculo.promptSha256, identidade: INSTANCIA,
        dono: { tipo: 'sessao', sessionId: SID, runtime: 'codex', perfil: null,
          maquina: caso === 'outra-maquina' ? 'maquina-da-fixture-remota' : nomeDaMaquina() } } });
    let consultas = 0;
    if (caso === 'terminal-concorrente') {
      const ledger = require('../src/ledger') as typeof import('../src/ledger');
      const ler = ledger.lerLedger;
      let leituras = 0;
      t.mock.method(ledger, 'lerLedger', (dir: string) => {
        if (dir === p.dirEstado && ++leituras === 2) registrar(dir, p.t.id, 'phase_result', { sessionId: SID });
        return ler(dir);
      });
    }
    if (caso === 'terminal-apos-processos') {
      const processos = require('../src/adapters/codex-runner') as typeof import('../src/adapters/codex-runner');
      const consultar = processos.estadoProcesso;
      let gravado = false;
      t.mock.method(processos, 'estadoProcesso', (...args: Parameters<typeof consultar>) => {
        const estado = consultar(...args);
        if (!gravado && args[0]?.pid === p.state.processoRuntime.pid && estado === 'ausente') {
          gravado = true;
          registrar(p.dirEstado, p.t.id, 'phase_result', { sessionId: SID });
        }
        return estado;
      });
    }
    const terminalConcorrente = caso === 'terminal-concorrente' || caso === 'terminal-apos-processos';
    const recupera = caso === 'mortos' || caso === 'pid-runtime-reciclado';
    const resultado = assumirConducao(p.dir, p.t.id, { por: 'operador-fixture', motivo: 'recuperar sessão', canal: 'cli',
      consultarSessao: () => { assert.fail('não consultar runtime antes da prova local'); },
      controle: () => ({ consultar: () => {
        consultas++; assert.equal(recupera, false, 'morte provada dispensa runtime');
        return { ok: true, sessoes: [{ sessionId: SID, estado: 'idle' }] };
      }, parar: () => false }) });
    const mortes = p.eventos().filter(e => e.tipo === 'sessao_morta');
    if (recupera) {
      assert.equal(resultado.ok, true, resultado.detalhe);
      assert.equal(consultas, 0);
      assert.equal(mortes.length, 1);
      const prova = mortes[0].prova as { watchers: { identidade: { inicio: string } }[];
        controlador: { inicio: string }; runtime: { inicio: string }; estadoControlador: string; estadoRuntime: string };
      assert.equal(prova.watchers[0].identidade.inicio, '0', 'PID reciclado não torna vivo o watcher anterior');
      assert.equal(prova.controlador.inicio, p.state.processoController.inicio);
      assert.equal(prova.estadoControlador, 'ausente');
      assert.equal(prova.estadoRuntime, 'ausente');
      assert.equal(prova.runtime.inicio, caso === 'pid-runtime-reciclado' ? '0' : p.state.processoRuntime.inicio);
      assert.equal(conducaoDaThread(p.dir, p.t.id)?.dono.tipo, 'reserva');
      assert.equal(p.eventos().filter(e => e.tipo === 'conducao_assumida').length, 1);
    } else {
      assert.equal(resultado.ok, false);
      assert.equal(consultas, 1);
      assert.match(resultado.detalhe, /não confirmou|nao confirmou/);
      assert.equal(mortes.length, 0);
      if (!terminalConcorrente) assert.equal(conducaoDaThread(p.dir, p.t.id)?.dono.tipo, 'sessao');
    }
    assert.equal(p.eventos().filter(e => e.tipo === 'phase_result').length,
      terminalConcorrente ? 1 : 0, 'recuperar não conclui fase');
  });
}
