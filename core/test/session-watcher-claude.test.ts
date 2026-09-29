import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commitar, projetoTemporario, runtimeFalso } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { ingerirEvento } from '../src/session-events';
import { observarSessao, LIMITE_MORTE_MS } from '../src/session-watcher';
import { fonteClaudeDoDespacho, INTERVALO_WATCH_CLAUDE_MS } from '../src/session-watcher-claude';
import { RegistroAgenteClaude, ConsultaAgentesNativos } from '../src/adapters/claude-bg';
import { Fase, Modo } from '../src/types';

const sid = '11111111-2222-3333-4444-555555555555';
const inicio = Date.parse('2026-09-01T00:00:00.000Z');
const hora = (seg: number) => new Date(inicio + seg * 1000).toISOString();
const depois = inicio + 24 * 3600000;
const cli = path.resolve(__dirname, '../../dist/index.js');

function fixture(opcoes: { modo?: Modo; fase?: Fase; registrar?: boolean; worktree?: boolean } = {}) {
  const p = projetoTemporario('watcher-claude');
  const t = novaThread(p.carregado, { nome: 'claude-bg', modo: opcoes.modo ?? 'auto', criarWorktree: opcoes.worktree }).thread;
  const fase = opcoes.fase ?? 'GOAL';
  const cwd = t.worktree ?? p.dir;
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase, bloco: fase, runtime: 'claude-bg', despachadaEm: hora(0),
    promptPath: '', promptSha256: '', verificada: true });
  t.faseAtual = fase;
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase, sessionId: sid, runtime: 'claude-bg', cwd });
  if (opcoes.registrar !== false) registrar(dir, t.id, 'session_sensor_registered', { fase, sessionId: sid, despachoEm: hora(0),
    ...fonteClaudeDoDespacho(p.dir, t.id, fase, cwd) });
  const nativa = (registros: Partial<RegistroAgenteClaude>[] | null) => (): ConsultaAgentesNativos => registros === null
    ? { ok: false, registros: [], detalhe: 'falha simulada', consultadoEm: hora(1) }
    : { ok: true, registros: registros.map(r => ({ sessionId: sid, cwd, ...r })), detalhe: '', consultadoEm: hora(1) };
  const observar = (seg: number, registros: Partial<RegistroAgenteClaude>[] | null) =>
    observarSessao(p.carregado, sid, { agoraMs: inicio + seg * 1000, consultaClaude: nativa(registros) });
  const evento = (tipo: string, seg: number, extra: Record<string, string> = {}) =>
    ingerirEvento(p.dir, sid, tipo, JSON.stringify({ observedAt: hora(seg), eventId: `${tipo}-${seg}`, ...extra }), depois);
  const eventos = () => lerLedger(dir);
  const resultados = () => eventos().filter(e => e.tipo === 'phase_result');
  /** D12: a prova do lado do `ork` para GOAL, PLAN e CHECK é o artefato da fase gravado depois do despacho. */
  const gravarArtefato = (arquivo = 'goal.md', conteudo = '# objetivo\n') => {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true }); fs.writeFileSync(path.join(dir, 'docs', arquivo), conteudo);
  };
  return { ...p, t, cwd, estado: dir, observar, evento, eventos, resultados, gravarArtefato };
}
const pidMorto = () => spawnSync('true').pid!;

test('I-34: done com Stop correlacionado conclui uma vez, com evidência nativa e sem código de saída inventado', () => {
  const p = fixture();
  try {
    p.gravarArtefato();
    p.evento('heartbeat', 10); p.evento('stop', 20);
    const r = p.observar(30, [{ state: 'done', status: 'idle', pid: process.pid, name: 'x'.repeat(500), id: '11111111', kind: 'background' }]);
    assert.equal(r.concluido, true); assert.equal(r.classificacao, 'fase_concluida');
    const [pr] = p.resultados();
    assert.equal(pr.runtime, 'claude-bg'); assert.equal(pr.classificacao, 'fase_concluida'); assert.equal(pr.estado, 'concluida');
    assert.equal(pr.ok, true); assert.equal(pr.sessionId, sid); assert.equal(pr.fase, 'GOAL'); assert.equal(pr.despachoEm, hora(0));
    assert.equal(pr.estadoNativo, 'done'); assert.equal(pr.statusNativo, 'idle'); assert.equal(pr.pidNativo, process.pid);
    assert.equal(pr.exitCode, null); assert.equal(pr.exitCodeFonte, 'unavailable'); assert.equal(pr.conclusaoNativa, true);
    assert.equal(pr.origem, 'sessions.watch'); assert.match(String(pr.sensorResultId), /^claude-bg:[a-f0-9]{64}$/);
    const evidencia = pr.evidencia as { fonte: string; registro: { name?: string; nameSha256: string; sessionId: string } };
    assert.equal(evidencia.fonte, 'claude agents --json --all');
    assert.equal(evidencia.registro.sessionId, sid); assert.equal(evidencia.registro.name, undefined);
    assert.match(evidencia.registro.nameSha256, /^[a-f0-9]{64}$/, 'o nome vira hash: sem --name ele carrega o prompt');
    assert.equal(JSON.stringify(p.eventos()).includes('x'.repeat(50)), false);
    assert.equal((pr.stop as { ts: string }).ts, hora(20));
    assert.equal(p.eventos().filter(e => e.tipo === 'fase_concluida').length, 1);
    assert.equal(p.observar(40, [{ state: 'done' }]).concluido, true);
    assert.equal(p.resultados().length, 1);
  } finally { p.limpar(); }
});

test('I-34: uma fonte só não basta; done sem Stop espera e encerra inconclusivo no limite, sem gate; Stop com working espera', () => {
  const p = fixture();
  try {
    assert.equal(p.observar(30, [{ state: 'done' }]).concluido, false);
    assert.equal(p.observar(30 + LIMITE_MORTE_MS / 1000 - 1, [{ state: 'done' }]).concluido, false);
    assert.equal(p.resultados().length, 0);
    const q = fixture();
    try {
      q.evento('stop', 20);
      assert.equal(q.observar(30, [{ state: 'working', status: 'busy', pid: process.pid }]).concluido, false);
      assert.equal(q.observar(3600, [{ state: 'working', status: 'busy', pid: process.pid }]).concluido, false);
      assert.equal(q.resultados().length, 0);
    } finally { q.limpar(); }
    const s = fixture();
    try {
      assert.equal(s.observar(30, [{ state: 'done' }]).concluido, false);
      // GO-FIX 1: runtime.unavailable reexecutaria o mesmo prompt sobre uma fase que pode ter terminado.
      const r = s.observar(30 + LIMITE_MORTE_MS / 1000, [{ state: 'done' }]);
      assert.deepEqual([r.concluido, r.encerrado], [false, true]);
      assert.equal(s.resultados().length, 0);
      assert.equal(s.eventos().some(e => e.tipo === 'gate_blocked'), false);
      const diagnostico = s.eventos().filter(e => e.tipo === 'session_watcher_error');
      assert.equal(diagnostico.length, 1);
      assert.match(String(diagnostico[0].erro), /sem Stop correlacionado além do limite de estabilidade; conclusão não inferida/);
      s.observar(40 + LIMITE_MORTE_MS / 1000, [{ state: 'done' }]);
      assert.equal(s.eventos().filter(e => e.tipo === 'session_watcher_error').length, 1, 'diagnóstico idempotente');
    } finally { s.limpar(); }
  } finally { p.limpar(); }
});

test('I-34: blocked sem Stop não conclui; Stop resolve bloqueio anterior; bloqueio depois do Stop impede a conclusão', () => {
  // RM-037 (defeitosdeco D-1): este caso tinha Stop em 20 s e esperava `blocked` vivo sem resultado
  // para sempre, que é o defeito da f15c7158. Sem Stop, `blocked` continua sem concluir; com Stop,
  // os testes D-1 abaixo cobrem a pausa humana.
  const p = fixture();
  try {
    assert.equal(p.observar(30, [{ state: 'blocked', pid: process.pid }]).concluido, false);
    assert.equal(p.observar(3600, [{ state: 'blocked', pid: process.pid }]).concluido, false);
    assert.equal(p.resultados().length, 0);
  } finally { p.limpar(); }
  const q = fixture();
  try {
    // Permissão respondida (aprovada ou negada) e turno encerrado: o Stop resolve o bloqueio.
    q.gravarArtefato(); q.evento('permission_request', 10); q.evento('stop', 20);
    assert.equal(q.eventos().some(e => e.tipo === 'sessao_bloqueada'), true);
    assert.equal(q.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida');
  } finally { q.limpar(); }
  const b = fixture();
  try {
    b.evento('stop', 20); b.evento('permission_request', 25);
    assert.equal(b.observar(30, [{ state: 'done' }]).concluido, false);
    const r = b.observar(30 + LIMITE_MORTE_MS / 1000, [{ state: 'done' }]);
    assert.deepEqual([r.concluido, r.encerrado], [false, true]);
    assert.equal(b.resultados().length, 0);
  } finally { b.limpar(); }
});

test('I-34: processo morto sem terminal nativo exige duas observações; failed e stopped sem Stop bloqueiam na hora', () => {
  for (const registro of [{ state: 'working' }, { state: 'working', pid: pidMorto() }, { state: 'blocked', pid: pidMorto() }]) {
    const p = fixture();
    try {
      assert.equal(p.observar(30, [registro]).concluido, false);
      assert.equal(p.observar(30 + INTERVALO_WATCH_CLAUDE_MS / 1000 - 1, [registro]).concluido, false);
      const r = p.observar(30 + INTERVALO_WATCH_CLAUDE_MS / 1000, [registro]);
      assert.equal(r.classificacao, 'gate_blocked', JSON.stringify(registro));
      assert.equal(p.resultados()[0].motivo, 'runtime.unavailable');
      assert.match(String(p.resultados()[0].fonte), /morreu sem terminal nativo/);
    } finally { p.limpar(); }
  }
  const vivo = fixture();
  try {
    vivo.observar(30, [{ state: 'working' }]);
    // Prova de vida entre as observações zera a contagem de morte.
    vivo.observar(33, [{ state: 'working', pid: process.pid }]);
    assert.equal(vivo.observar(40, [{ state: 'working' }]).concluido, false);
  } finally { vivo.limpar(); }
  // D17: sem Stop correlacionado; com ele, ver o teste GO-FIX 3 (D17).
  for (const [state, texto] of [['failed', /failed sem Stop correlacionado/], ['stopped', /stopped\) sem terminal done nem Stop/]] as const) {
    const p = fixture();
    try {
      p.gravarArtefato();
      assert.equal(p.observar(30, [{ state }]).classificacao, 'gate_blocked');
      assert.equal(p.resultados()[0].motivo, 'runtime.unavailable');
      assert.match(String(p.resultados()[0].fonte), texto);
      assert.equal(p.eventos().some(e => e.tipo === 'fase_concluida'), false);
    } finally { p.limpar(); }
  }
});

test('I-34: ausência vira runtime.unavailable no limite; estado desconhecido e falha da consulta encerram sem gate', () => {
  const p = fixture();
  try {
    assert.equal(p.observar(30, []).concluido, false);
    assert.equal(p.observar(30 + LIMITE_MORTE_MS / 1000, []).classificacao, 'gate_blocked');
    assert.match(String(p.resultados()[0].fonte), /ausente do claude agents/);
  } finally { p.limpar(); }
  const q = fixture();
  try {
    q.evento('stop', 20);
    assert.equal(q.observar(30, [{ state: 'completed' }]).concluido, false);
    const fim = q.observar(30 + LIMITE_MORTE_MS / 1000, [{ state: 'completed' }]);
    assert.deepEqual([fim.concluido, fim.encerrado], [false, true]);
    assert.equal(q.resultados().length, 0);
    assert.match(String(q.eventos().find(e => e.tipo === 'session_watcher_error')!.erro), /desconhecido \(completed\)/);
    // Sinônimo de trabalho não é estado desconhecido.
    const s = fixture();
    try {
      for (const seg of [30, 30 + LIMITE_MORTE_MS / 1000]) assert.equal(s.observar(seg, [{ state: 'running', pid: process.pid }]).encerrado, undefined);
      assert.equal(s.eventos().some(e => e.tipo === 'session_watcher_error' || e.tipo === 'phase_result'), false);
    } finally { s.limpar(); }
  } finally { q.limpar(); }
  const r = fixture();
  try {
    r.evento('stop', 20);
    for (const seg of [30, 300]) assert.equal(r.observar(seg, null).encerrado, undefined);
    const falha = r.observar(30 + LIMITE_MORTE_MS / 1000, null);
    assert.deepEqual([falha.concluido, falha.encerrado], [false, true]);
    assert.match(String(r.eventos().find(e => e.tipo === 'session_watcher_error')!.erro), /consulta nativa indisponível/);
    // Registro de outro cwd com o mesmo UUID não é a sessão do despacho.
    assert.equal(r.observar(90000, [{ state: 'done', cwd: '/outro' }]).concluido, false);
    assert.equal(r.resultados().length, 0);
  } finally { r.limpar(); }
});

test('I-34: pausa prevista vira human.pending e PLAN sem artefato novo vira artifact.missing', () => {
  const p = fixture({ modo: 'classic' });
  try {
    p.gravarArtefato(); p.evento('stop', 20);
    assert.equal(p.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    const [pr] = p.resultados();
    assert.equal(pr.motivo, 'human.pending'); assert.equal(pr.conclusaoNativa, true); assert.equal(pr.estado, 'bloqueada');
    assert.match(String(pr.fonte), /docs\/goal\.md gravado no intervalo do despacho; pausa prevista ao fim do bloco/);
    assert.equal(p.eventos().filter(e => e.tipo === 'gate_blocked' && e.motivo === 'human.pending').length, 1);
  } finally { p.limpar(); }
  const plano = fixture({ fase: 'PLAN' });
  try {
    const registro = plano.eventos().find(e => e.tipo === 'session_sensor_registered')!;
    assert.deepEqual(registro.artefato, { arquivo: 'docs/plan.md', sha256: null });
    plano.evento('stop', 20);
    assert.equal(plano.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    const [pr] = plano.resultados();
    assert.equal(pr.motivo, 'artifact.missing');
    assert.deepEqual(pr.artefato, { arquivo: 'docs/plan.md', sha256Base: null, sha256Atual: null });
  } finally { plano.limpar(); }
  const feito = fixture({ fase: 'PLAN' });
  try {
    const docs = path.join(feito.estado, 'docs'); fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'plan.md'), '# plano\n');
    feito.evento('stop', 20);
    assert.equal(feito.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida');
    assert.match(String((feito.resultados()[0].artefato as { sha256Atual: string }).sha256Atual), /^[a-f0-9]{64}$/);
  } finally { feito.limpar(); }
});

test('I-34: ociosidade e fim de subagente depois do Stop não o superam; notificação sem tipo e heartbeat superam', () => {
  const p = fixture();
  try {
    // Sequência real da sessão b8fa6f86 (i32 MASTER): Stop, SubagentStop 2 s depois, ociosidade 60 s depois.
    p.gravarArtefato();
    p.evento('stop', 20); p.evento('subagent_stop', 22); p.evento('notification', 80, { notificationType: 'idle_prompt' });
    assert.equal(p.observar(90, [{ state: 'done' }]).classificacao, 'fase_concluida');
  } finally { p.limpar(); }
  const casos: [string, Record<string, string>][] = [['notification', {}], ['notification', { notificationType: 'elicitation_dialog' }], ['heartbeat', {}]];
  for (const [tipo, extra] of casos) {
    const q = fixture();
    try {
      q.evento('stop', 20); q.evento(tipo, 80, extra);
      assert.equal(q.observar(90, [{ state: 'done' }]).concluido, false, `${tipo} ${JSON.stringify(extra)}`);
    } finally { q.limpar(); }
  }
});

test('I-34: sessão sem registro ganha fonte retroativa do despacho; runtime desconhecido continua recusado', () => {
  const p = fixture({ registrar: false });
  try {
    p.gravarArtefato(); p.evento('stop', 20);
    assert.equal(p.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida');
    const registros = p.eventos().filter(e => e.tipo === 'session_sensor_registered');
    assert.equal(registros.length, 1);
    assert.equal(registros[0].nativo, 'claude-agents'); assert.equal(registros[0].cwd, p.dir);
    assert.equal(registros[0].origem, 'sessions.watch'); assert.equal(registros[0].artefato, undefined);
  } finally { p.limpar(); }
  const q = fixture();
  try {
    q.t.sessoes[0].runtime = 'outro'; gravarThread(q.dir, q.t);
    assert.throws(() => q.observar(30, [{ state: 'done' }]), /watch requer sessão Codex ou claude-bg/);
  } finally { q.limpar(); }
});

test('I-34: CLI real `sessions watch --once` aceita claude-bg com a consulta nativa do claude falso', () => {
  const p = fixture();
  const rt = runtimeFalso('watch-claude');
  try {
    fs.writeFileSync(path.join(rt.dir, 'sessao'), sid); fs.writeFileSync(path.join(rt.dir, 'cwd'), p.dir);
    rt.estadoDaSessao('working'); rt.pidDaSessao(process.pid); rt.statusDaSessao('busy'); p.gravarArtefato();
    const run = () => spawnSync(process.execPath, [cli, 'sessions', 'watch', '--thread', p.t.id, '--once'],
      { cwd: p.dir, encoding: 'utf8', env: process.env });
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).concluido, false);
    ingerirEvento(p.dir, sid, 'stop', JSON.stringify({ observedAt: new Date().toISOString(), eventId: 'stop-cli' }));
    rt.estadoDaSessao('done'); rt.statusDaSessao('idle');
    r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([JSON.parse(r.stdout).concluido, JSON.parse(r.stdout).classificacao], [true, 'fase_concluida']);
    const [pr] = p.resultados();
    assert.equal((pr.evidencia as { registro: { pid: number; status: string } }).registro.pid, process.pid);
    assert.equal(p.eventos().some(e => e.tipo === 'session_watcher_error'), false);
  } finally { rt.restaurar(); p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 1 (achados da revisão independente do CHECK).
// ---------------------------------------------------------------------------
import { mock } from 'node:test';
import * as util from '../src/util';
import { consultarAgentesNativos } from '../src/adapters/claude-bg';

test('GO-FIX 1: atividade ingerida durante a consulta nativa adia a conclusão (Stop reconferido sob lock)', () => {
  const p = fixture();
  try {
    p.evento('stop', 20);
    const r = observarSessao(p.carregado, sid, { agoraMs: inicio + 30000, consultaClaude: () => {
      p.evento('heartbeat', 25);
      return { ok: true, detalhe: '', consultadoEm: hora(30), registros: [{ sessionId: sid, cwd: p.dir, state: 'done' }] };
    } });
    assert.equal(r.concluido, false);
    assert.equal(p.resultados().length, 0);
    assert.equal(p.observar(40, [{ state: 'done' }]).concluido, false, 'o heartbeat depois do Stop o superou');
  } finally { p.limpar(); }
});

test('GO-FIX 1: plano vazio, diretório ou link simbólico não é saída de PLAN e não derruba o observador', () => {
  for (const preparo of ['vazio', 'diretorio', 'link'] as const) {
    const p = fixture({ fase: 'PLAN' });
    try {
      const docs = path.join(p.estado, 'docs'), plano = path.join(docs, 'plan.md');
      fs.mkdirSync(docs, { recursive: true });
      if (preparo === 'vazio') fs.writeFileSync(plano, '');
      if (preparo === 'diretorio') fs.mkdirSync(plano);
      if (preparo === 'link') { fs.writeFileSync(path.join(docs, 'alvo.md'), '# fora\n'); fs.symlinkSync(path.join(docs, 'alvo.md'), plano); }
      p.evento('stop', 20);
      assert.equal(p.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked', preparo);
      assert.equal(p.resultados()[0].motivo, 'artifact.missing', preparo);
      assert.equal(p.eventos().some(e => e.tipo === 'session_watcher_error'), false, preparo);
    } finally { p.limpar(); }
  }
});

test('GO-FIX 1: registro de outro projeto fora do formato não invalida a consulta; sessionId repetido invalida', () => {
  const alvo = { sessionId: sid, cwd: '/tmp/alvo', state: 'done', pid: 42 };
  let saida: unknown[] = [];
  const stub = mock.method(util, 'exec', () => ({ ok: true, code: 0, stderr: '', stdout: JSON.stringify(saida) }));
  try {
    saida = [alvo, { sessionId: 'nao-e-uuid', cwd: '/x' }, { cwd: '/y' }, null,
      { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', cwd: '/z', pid: null, name: null, state: 7, startedAt: 'ontem' }];
    const r = consultarAgentesNativos(inicio);
    assert.equal(r.ok, true);
    assert.deepEqual(r.registros.map(s => s.sessionId), [sid, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']);
    assert.deepEqual(r.registros[1], { sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', cwd: '/z', id: undefined, name: undefined,
      kind: undefined, state: undefined, status: undefined, pid: undefined, startedAt: undefined });
    assert.match(r.detalhe, /3 registro\(s\) sem identidade descartado/);
    saida = [alvo, { ...alvo, cwd: '/outro' }];
    assert.equal(consultarAgentesNativos(inicio).ok, false);
    saida = { nao: 'lista' } as unknown as unknown[];
    assert.equal(consultarAgentesNativos(inicio).ok, false);
  } finally { stub.mock.restore(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 2 (D12, achado 3 do CHECK 2764ac5f): `done` nativo é condição necessária, nunca
// suficiente. A fase só conclui com prova gravada pelo próprio `ork` no intervalo do despacho.
// ---------------------------------------------------------------------------
import { eventosDoIntervalo, vereditoDoParecer } from '../src/session-watcher-claude';
import { exec } from '../src/util';

test('GO-FIX 2 (D12): done com Stop sem o artefato da fase vira human.pending com diagnóstico; com o artefato conclui', () => {
  const p = fixture();
  try {
    p.evento('stop', 20);
    assert.equal(p.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    const [pr] = p.resultados();
    assert.equal(pr.motivo, 'human.pending'); assert.equal(pr.conclusaoNativa, true); assert.equal(pr.ok, false);
    assert.match(String(pr.fonte), /sem prova do ork: docs\/goal\.md não foi gravado no intervalo do despacho/);
    assert.equal((pr.provaOrk as { ok: boolean }).ok, false);
    assert.equal(p.eventos().some(e => e.tipo === 'fase_concluida'), false);
  } finally { p.limpar(); }
  // Artefato anterior ao despacho, sem mudança depois dele, não é saída desta fase.
  const antigo = fixture({ registrar: false });
  try {
    antigo.gravarArtefato('goal.md', '# objetivo antigo\n');
    registrar(antigo.estado, antigo.t.id, 'session_sensor_registered', { fase: 'GOAL', sessionId: sid, despachoEm: hora(0),
      ...fonteClaudeDoDespacho(antigo.dir, antigo.t.id, 'GOAL', antigo.cwd) });
    antigo.evento('stop', 20);
    assert.equal(antigo.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.equal(antigo.resultados()[0].motivo, 'human.pending');
  } finally { antigo.limpar(); }
  const feito = fixture();
  try {
    feito.gravarArtefato(); feito.evento('stop', 20);
    assert.equal(feito.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida');
    const [pr] = feito.resultados();
    assert.match(String(pr.fonte), /docs\/goal\.md gravado no intervalo do despacho/);
    assert.deepEqual(pr.artefato, { arquivo: 'docs/goal.md', sha256Base: null,
      sha256Atual: (pr.artefato as { sha256Atual: string }).sha256Atual });
    assert.equal((pr.provaOrk as { ok: boolean }).ok, true);
  } finally { feito.limpar(); }
});

test('GO-FIX 2 (D12): CHECK exige parecer com exatamente um veredito legível e guarda o verify do intervalo', () => {
  for (const [conteudo, esperado] of [['# parecer sem conclusão\n', null],
      ['## Veredito: PASSOU\n\nVeredito: BLOQUEADO\n', null]] as const) {
    const p = fixture({ fase: 'CHECK' });
    try {
      p.gravarArtefato('check.md', conteudo); p.evento('stop', 20);
      assert.equal(p.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked', conteudo);
      const [pr] = p.resultados();
      assert.equal(pr.motivo, 'human.pending');
      assert.match(String(pr.fonte), /sem exatamente um veredito legível/);
      assert.equal((pr.provaOrk as { veredito: string | null }).veredito, esperado);
    } finally { p.limpar(); }
  }
  const p = fixture({ fase: 'CHECK' });
  try {
    const registro = p.eventos().find(e => e.tipo === 'session_sensor_registered')!;
    assert.deepEqual(registro.artefato, { arquivo: 'docs/check.md', sha256: null });
    registrar(p.estado, p.t.id, 'verify_run', { commit: 'a'.repeat(40), cwd: p.cwd, claims: [] });
    p.gravarArtefato('check.md', '# CHECK\n\n## Veredito: PRECISA DE MUDANÇA\n'); p.evento('stop', 20);
    assert.equal(p.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida');
    const prova = p.resultados()[0].provaOrk as { veredito: string; verify: { commit: string } };
    assert.equal(prova.veredito, 'PRECISA DE MUDANCA'); assert.equal(prova.verify.commit, 'a'.repeat(40));
  } finally { p.limpar(); }
});

test('GO-FIX 3 (D16): GO conclui só com commit conferido no git da worktree depois do despacho e worktree limpa', () => {
  const semCommit = fixture({ fase: 'GO', worktree: true });
  try {
    assert.equal(semCommit.eventos().find(e => e.tipo === 'session_sensor_registered')!.artefato, undefined);
    semCommit.evento('stop', 20);
    assert.equal(semCommit.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.match(String(semCommit.resultados()[0].fonte), /nenhum commit registrado pelo núcleo/);
    assert.equal(semCommit.resultados()[0].motivo, 'human.pending');
  } finally { semCommit.limpar(); }
  // Commit depois do próximo despacho da thread está fora do intervalo desta sessão.
  const fora = fixture({ fase: 'GO', worktree: true });
  try {
    registrar(fora.estado, fora.t.id, 'phase_dispatch', { fase: 'CHECK', sessionId: 'outra-sessao', runtime: 'claude-bg', cwd: fora.cwd });
    registrar(fora.estado, fora.t.id, 'mcp_git_committed', { commit: commitar(fora.cwd, 'go.txt', 'x\n', 'depois do próximo despacho'),
      paths: ['go.txt'], origem: 'mcp.git' });
    fora.evento('stop', 20);
    assert.equal(fora.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.match(String(fora.resultados()[0].fonte), /nenhum commit registrado/);
  } finally { fora.limpar(); }
  // Negativos do CHECK dd50cc0c: o HEAD anterior ao despacho e um SHA inexistente, declarados pelo
  // mesmo sensor que o hook usa, não concluem; nem um commit real que não está no HEAD atual.
  for (const caso of ['head-do-despacho', 'inexistente', 'fora-do-head'] as const) {
    const f = fixture({ fase: 'GO', worktree: true });
    try {
      const head = exec('git', ['rev-parse', 'HEAD'], f.cwd).stdout.trim();
      assert.equal(f.eventos().find(e => e.tipo === 'session_sensor_registered')!.head, head, 'HEAD do despacho gravado na fonte');
      let sha = caso === 'inexistente' ? 'd'.repeat(40) : head;
      if (caso === 'fora-do-head') {
        exec('git', ['switch', '-q', '-c', 'lado'], f.cwd);
        sha = commitar(f.cwd, 'lado.txt', 'fora do HEAD\n', 'commit em outro ramo');
        exec('git', ['switch', '-q', '-'], f.cwd);
      }
      f.evento('commit', 15, { commit: sha }); f.evento('stop', 20);
      assert.equal(f.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked', caso);
      const [pr] = f.resultados();
      assert.equal(pr.motivo, 'human.pending', caso);
      assert.match(String(pr.fonte), /nenhum commit conferido no git da worktree/, caso);
      assert.deepEqual((pr.provaOrk as { recusados: string[] }).recusados, [sha], caso);
      assert.equal(f.eventos().some(e => e.tipo === 'fase_concluida'), false, caso);
    } finally { f.limpar(); }
  }
  // O sensor `commit` só vale com o sessionId do despacho, mesmo com um commit real.
  const outra = fixture({ fase: 'GO', worktree: true });
  try {
    const sha = commitar(outra.cwd, 'go.txt', 'entrega\n', 'commit de outra sessão');
    registrar(outra.estado, outra.t.id, 'commit', { ts: hora(15), fase: 'GO', sessionId: 'outra-sessao', commit: sha });
    outra.evento('stop', 20);
    assert.equal(outra.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.match(String(outra.resultados()[0].fonte), /nenhum commit registrado pelo núcleo/);
  } finally { outra.limpar(); }
  // Fonte retroativa, sem HEAD de despacho conhecido: não há prova.
  const retro = fixture({ fase: 'GO', worktree: true, registrar: false });
  try {
    retro.evento('commit', 15, { commit: commitar(retro.cwd, 'go.txt', 'entrega\n', 'commit do GO') }); retro.evento('stop', 20);
    assert.equal(retro.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.match(String(retro.resultados()[0].fonte), /HEAD da worktree no despacho não registrado/);
  } finally { retro.limpar(); }
  const suja = fixture({ fase: 'GO', worktree: true });
  try {
    registrar(suja.estado, suja.t.id, 'mcp_git_committed', { commit: commitar(suja.cwd, 'go.txt', 'entrega\n', 'commit do GO'),
      paths: ['go.txt'], origem: 'mcp.git' });
    fs.writeFileSync(path.join(suja.cwd, 'pendente.txt'), 'sem commit\n');
    suja.evento('stop', 20);
    assert.equal(suja.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.match(String(suja.resultados()[0].fonte), /worktree com alterações não commitadas/);
    assert.equal((suja.resultados()[0].provaOrk as { worktreeLimpa: boolean }).worktreeLimpa, false);
  } finally { suja.limpar(); }
  // Positivos: commit real criado depois do despacho, pelo sensor da sessão ou pelo commit do núcleo.
  for (const via of ['commit', 'mcp_git_committed'] as const) {
    const limpa = fixture({ fase: 'GO', worktree: true });
    try {
      const sha = commitar(limpa.cwd, 'go.txt', 'entrega do GO\n', 'commit do GO depois do despacho');
      if (via === 'commit') limpa.evento('commit', 15, { commit: sha });
      else registrar(limpa.estado, limpa.t.id, 'mcp_git_committed', { commit: sha, paths: ['go.txt'], origem: 'mcp.git' });
      limpa.evento('stop', 20);
      assert.equal(limpa.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida', via);
      const prova = limpa.resultados()[0].provaOrk as { commits: string[]; recusados: string[]; worktreeLimpa: boolean };
      assert.deepEqual(prova.commits, [sha], via); assert.deepEqual(prova.recusados, [], via); assert.equal(prova.worktreeLimpa, true, via);
      assert.match(String(limpa.resultados()[0].fonte), /conferido\(s\) no git da worktree depois do HEAD do despacho/, via);
    } finally { limpa.limpar(); }
  }
});

test('GO-FIX 3 (D16, nota P3): artefato gravado depois do próximo despacho da thread não é saída da sessão anterior', () => {
  const pausa = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const seguinte = (f: ReturnType<typeof fixture>) => registrar(f.estado, f.t.id, 'phase_dispatch',
    { fase: 'GOAL', sessionId: 'sessao-seguinte', runtime: 'claude-bg', cwd: f.cwd });
  const depois = fixture();
  try {
    depois.evento('stop', 20); seguinte(depois); pausa(20); depois.gravarArtefato();
    assert.equal(depois.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked');
    assert.match(String(depois.resultados()[0].fonte), /docs\/goal.md não foi gravado no intervalo do despacho/);
    assert.equal(depois.resultados()[0].motivo, 'human.pending');
  } finally { depois.limpar(); }
  // Positivo: gravado antes do próximo despacho, continua sendo saída desta sessão.
  const antes = fixture();
  try {
    antes.gravarArtefato(); pausa(20); seguinte(antes); antes.evento('stop', 20);
    assert.equal(antes.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida');
  } finally { antes.limpar(); }
});

test('GO-FIX 2 (D12): MASTER exige score_proposto e SHIP exige ship_done no intervalo do despacho', () => {
  for (const [fase, tipo] of [['MASTER', 'score_proposto'], ['SHIP', 'ship_done']] as const) {
    const sem = fixture({ fase });
    try {
      sem.evento('stop', 20);
      assert.equal(sem.observar(30, [{ state: 'done' }]).classificacao, 'gate_blocked', fase);
      assert.match(String(sem.resultados()[0].fonte), new RegExp(`nenhum ${tipo} registrado`));
    } finally { sem.limpar(); }
    const com = fixture({ fase });
    try {
      registrar(com.estado, com.t.id, tipo, { fase });
      com.evento('stop', 20);
      assert.equal(com.observar(30, [{ state: 'done' }]).classificacao, 'fase_concluida', fase);
      assert.equal((com.resultados()[0].provaOrk as { evento: { tipo: string } }).evento.tipo, tipo);
    } finally { com.limpar(); }
  }
});

test('GO-FIX 2 (D12): veredito legível e intervalo do despacho', () => {
  assert.equal(vereditoDoParecer('## Veredito: PRECISA DE MUDANÇA\n'), 'PRECISA DE MUDANCA');
  assert.equal(vereditoDoParecer('**Veredito:** PASSOU\nVeredito: passou\n'), 'PASSOU');
  assert.equal(vereditoDoParecer('Veredito: BLOQUEADO\n'), 'BLOQUEADO');
  for (const texto of ['Veredito: PASSOUX\n', 'o veredito foi PASSOU\n', 'Veredito: PASSOU\nVeredito: BLOQUEADO\n', ''])
    assert.equal(vereditoDoParecer(texto), null, texto);
  const e = (tipo: string, seg: number, sessionId = sid) => ({ ts: hora(seg), thread: 't', tipo, sessionId });
  const sessao = { sessionId: sid, despachadaEm: hora(10) };
  const eventos = [e('commit', 5), e('phase_dispatch', 9), e('commit', 12), e('phase_dispatch', 30, 'outra'), e('commit', 40)];
  assert.deepEqual(eventosDoIntervalo(eventos, sessao).map(x => x.ts), [hora(12)]);
});

// ---------------------------------------------------------------------------
// GO-FIX 2 (D13, achado 2 do CHECK 2764ac5f): turno encerrado pelo Stop com processo morto não
// vira runtime.unavailable (retry automático `reexecutar`); vale a prova do lado do `ork`.
// ---------------------------------------------------------------------------

test('GO-FIX 2 (D13): Stop correlacionado com working ou blocked sem processo escala ao humano sem prova e conclui com prova', () => {
  for (const state of ['working', 'blocked']) {
    // Reprodução do achado: Stop em 20 s, processo vivo em 30 s, sem pid em 3600 s e 3606 s.
    const sem = fixture();
    try {
      sem.evento('stop', 20);
      assert.equal(sem.observar(30, [{ state, pid: process.pid }]).concluido, false);
      assert.equal(sem.observar(3600, [{ state }]).concluido, false, 'a primeira leitura sem processo só espera');
      assert.equal(sem.observar(3606, [{ state }]).classificacao, 'gate_blocked', state);
      const [pr] = sem.resultados();
      assert.equal(pr.motivo, 'human.pending', state); assert.notEqual(pr.motivo, 'runtime.unavailable');
      assert.match(String(pr.fonte), /Stop correlacionado e processo encerrado sem done .*sem prova do ork/);
      assert.equal(pr.conclusaoNativa, false);
      assert.equal(sem.eventos().some(e => e.motivo === 'runtime.unavailable'), false);
    } finally { sem.limpar(); }
    const com = fixture();
    try {
      com.gravarArtefato(); com.evento('stop', 20);
      com.observar(3600, [{ state }]);
      assert.equal(com.observar(3606, [{ state }]).classificacao, 'fase_concluida', state);
      const [pr] = com.resultados();
      assert.equal(pr.conclusaoNativa, false, 'sem done não há conclusão nativa');
      assert.match(String(pr.conclusaoNativaAusente), /processo encerrado sem done/);
    } finally { com.limpar(); }
  }
  const plano = fixture({ fase: 'PLAN' });
  try {
    plano.evento('stop', 20);
    plano.observar(3600, [{ state: 'blocked' }]);
    assert.equal(plano.observar(3606, [{ state: 'blocked' }]).classificacao, 'gate_blocked');
    assert.equal(plano.resultados()[0].motivo, 'artifact.missing');
  } finally { plano.limpar(); }
});

test('GO-FIX 2 (D13): sem Stop correlacionado o processo morto continua runtime.unavailable; atividade na consulta adia', () => {
  const p = fixture();
  try {
    p.observar(3600, [{ state: 'working' }]);
    assert.equal(p.observar(3606, [{ state: 'working' }]).classificacao, 'gate_blocked');
    assert.equal(p.resultados()[0].motivo, 'runtime.unavailable');
    assert.match(String(p.resultados()[0].fonte), /nem Stop correlacionado/);
  } finally { p.limpar(); }
  const q = fixture();
  try {
    q.gravarArtefato(); q.evento('stop', 20);
    q.observar(3600, [{ state: 'working' }]);
    // Heartbeat ingerido durante a segunda consulta supera o Stop: a decisão é reconferida sob o lock.
    const r = observarSessao(q.carregado, sid, { agoraMs: inicio + 3606000, consultaClaude: () => {
      q.evento('heartbeat', 25);
      return { ok: true, detalhe: '', consultadoEm: hora(3606), registros: [{ sessionId: sid, cwd: q.cwd, state: 'working' }] };
    } });
    assert.equal(r.concluido, false);
    assert.equal(q.resultados().length, 0);
  } finally { q.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX 3 (D17, achado 9 do CHECK dd50cc0c): depois de um Stop correlacionado, `stopped` segue a
// regra da prova e `failed` escala ao humano; nenhum dos dois vira reexecução automática.
// ---------------------------------------------------------------------------
import { politicaDoMotivo } from '../src/retry';

test('GO-FIX 3 (D17): stopped depois de Stop correlacionado segue a prova; failed depois do Stop escala ao humano', () => {
  // Reprodução do achado: Stop em 20 s, blocked com processo vivo em 30 s, stopped em 40 s.
  const sem = fixture();
  try {
    sem.evento('stop', 20);
    assert.equal(sem.observar(30, [{ state: 'blocked', pid: process.pid }]).concluido, false);
    assert.equal(sem.observar(40, [{ state: 'stopped' }]).classificacao, 'gate_blocked');
    const [pr] = sem.resultados();
    assert.equal(pr.motivo, 'human.pending');
    assert.match(String(pr.fonte), /Stop correlacionado e sessão encerrada externamente \(stopped\) sem done; sem prova do ork/);
    assert.equal(pr.conclusaoNativa, false);
    assert.deepEqual([politicaDoMotivo('human.pending')?.acao, politicaDoMotivo('human.pending')?.automatica], ['escalar-humano', false]);
    assert.equal(sem.eventos().some(e => e.motivo === 'runtime.unavailable'), false, 'stopped depois do Stop não reexecuta');
  } finally { sem.limpar(); }
  const com = fixture();
  try {
    com.gravarArtefato(); com.evento('stop', 20);
    assert.equal(com.observar(40, [{ state: 'stopped' }]).classificacao, 'fase_concluida');
    assert.equal(com.resultados()[0].conclusaoNativa, false, 'sem done não há conclusão nativa');
  } finally { com.limpar(); }
  const plano = fixture({ fase: 'PLAN' });
  try {
    plano.evento('stop', 20);
    assert.equal(plano.observar(40, [{ state: 'stopped' }]).classificacao, 'gate_blocked');
    assert.equal(plano.resultados()[0].motivo, 'artifact.missing');
  } finally { plano.limpar(); }
  // failed depois do Stop: nem conclusão (mesmo com a prova) nem reexecução automática.
  for (const comProva of [false, true]) {
    const f = fixture();
    try {
      if (comProva) f.gravarArtefato();
      f.evento('stop', 20);
      assert.equal(f.observar(40, [{ state: 'failed' }]).classificacao, 'gate_blocked', `comProva=${comProva}`);
      const [pr] = f.resultados();
      assert.equal(pr.motivo, 'human.pending', `comProva=${comProva}`);
      assert.match(String(pr.fonte), /failed depois de Stop correlacionado; a sessão falhou depois de encerrar o turno e o humano decide/);
      assert.equal(f.eventos().some(e => e.tipo === 'fase_concluida' || e.motivo === 'runtime.unavailable'), false, `comProva=${comProva}`);
    } finally { f.limpar(); }
  }
  // Atividade depois do Stop o supera: sem Stop correlacionado, stopped e failed voltam a runtime.unavailable.
  for (const state of ['stopped', 'failed']) {
    const f = fixture();
    try {
      f.evento('stop', 20); f.evento('heartbeat', 25);
      assert.equal(f.observar(40, [{ state }]).classificacao, 'gate_blocked', state);
      assert.equal(f.resultados()[0].motivo, 'runtime.unavailable', state);
    } finally { f.limpar(); }
  }
});

// ---------------------------------------------------------------------------
// GO-FIX 2 (D15, achado 5 do CHECK 2764ac5f): texto nativo entra normalizado e com teto.
// ---------------------------------------------------------------------------
import { normalizarNativo } from '../src/session-watcher-claude';

test('GO-FIX 2 (D15, achado 5): estado, status e erro nativos entram normalizados e dentro do teto de 4096 bytes', () => {
  const controle = [7, 0, 27, 127].map(c => String.fromCharCode(c)).join('');
  const enorme = (base: string) => base + controle + 'x'.repeat(100000);
  const semControle = (v: unknown) => !/\p{Cc}/u.test(String(v));
  const p = fixture();
  try {
    const registro = { state: enorme('desconhecido'), status: enorme('st'), id: enorme('id'), kind: enorme('k') };
    p.observar(30, [registro]);
    assert.equal(p.observar(30 + LIMITE_MORTE_MS / 1000, [registro]).encerrado, true);
    const d = p.eventos().find(e => e.tipo === 'session_watcher_error')!;
    const registroEvidencia = (d.evidencia as { registro: Record<string, unknown> }).registro;
    assert.ok(String(d.estadoNativo).length <= 64 && semControle(d.estadoNativo));
    assert.ok(String(d.erro).length <= 512 && semControle(d.erro));
    assert.match(String(d.erro), /estado nativo desconhecido \(desconhecidox+/);
    for (const campo of ['state', 'status', 'id', 'kind'])
      assert.ok(String(registroEvidencia[campo]).length <= 64 && semControle(registroEvidencia[campo]), campo);
    assert.ok(Buffer.byteLength(JSON.stringify({ estadoNativo: d.estadoNativo, erro: d.erro, evidencia: d.evidencia })) <= 4096);
  } finally { p.limpar(); }
  const q = fixture();
  try {
    q.observar(30, [{ state: 'failed', status: enorme('busy'), id: enorme('id'), kind: enorme('k') }]);
    const [pr] = q.resultados();
    assert.equal(pr.estadoNativo, 'failed');
    assert.ok(String(pr.statusNativo).length <= 64 && semControle(pr.statusNativo));
    assert.ok(Buffer.byteLength(JSON.stringify({ estadoNativo: pr.estadoNativo, statusNativo: pr.statusNativo,
      evidencia: pr.evidencia })) <= 4096);
  } finally { q.limpar(); }
  // Positivo: valor comum passa intacto; tipo inesperado e vazio viram null; par substituto inteiro.
  assert.equal(normalizarNativo('done'), 'done');
  assert.equal(normalizarNativo('bl' + controle + 'ocked'), 'blocked');
  assert.equal(normalizarNativo(7), null); assert.equal(normalizarNativo(controle), null);
  assert.equal(normalizarNativo('a'.repeat(63) + '😀'), 'a'.repeat(63) + '😀');
  assert.equal(normalizarNativo('a'.repeat(100)), 'a'.repeat(64));
});

// ---------------------------------------------------------------------------
// RM-037 (defeitosdeco D-1): a sessão claude-bg que encerra o turno (Stop correlacionado) e fica
// em `blocked` com o processo vivo nunca concluía a fase, e a pausa humana não abria. Evidência: PLAN
// da ork-i36buscasema, sessão f15c7158, Stop às 22:05 e `phase_result` só às 22:46, com o processo
// morto. Com Stop correlacionado, a segunda leitura abre a pausa humana pelo motivo da prova.
// ---------------------------------------------------------------------------

test('defeitosdeco D-1: blocked vivo depois do Stop, com a prova do ork, abre human.pending na segunda leitura', () => {
  const p = fixture();
  try {
    // A sequência medida na f15c7158: Stop, SubagentStop e a notificação de ociosidade, nada depois.
    p.gravarArtefato(); p.evento('heartbeat', 10); p.evento('stop', 20); p.evento('subagent_stop', 23);
    p.evento('notification', 80, { notificationType: 'idle_prompt' });
    const registro = [{ state: 'blocked', status: 'idle', pid: process.pid }];
    const primeira = p.observar(90, registro);
    assert.equal(primeira.concluido, false, 'a primeira leitura só marca o instante');
    assert.match(String(primeira.espera), /aguardando a segunda observação/);
    const r = p.observar(90 + INTERVALO_WATCH_CLAUDE_MS / 1000, registro);
    assert.deepEqual([r.concluido, r.classificacao], [true, 'gate_blocked']);
    const [pr] = p.resultados();
    assert.equal(pr.motivo, 'human.pending');
    assert.equal(pr.estadoNativo, 'blocked'); assert.equal(pr.pidNativo, process.pid);
    assert.match(String(pr.fonte), /Stop correlacionado e sessão viva à espera humana \(blocked\); docs\/goal\.md gravado/);
    assert.match(String(pr.diagnostico), /o humano decide/);
    assert.equal((pr.provaOrk as { ok: boolean }).ok, true);
    assert.equal(pr.conclusaoNativa, false, 'blocked não é conclusão nativa');
    // A pausa humana abre: o gate tipado que o `ork gate request` exige está no ledger.
    const gates = p.eventos().filter(e => e.tipo === 'gate_blocked');
    assert.deepEqual(gates.map(e => e.motivo), ['human.pending']);
    assert.equal(p.eventos().some(e => e.tipo === 'fase_concluida'), false, 'blocked nunca conclui direto');
    assert.equal(p.observar(3600, registro).concluido, true, 'idempotente');
    assert.equal(p.resultados().length, 1);
  } finally { p.limpar(); }
});

test('defeitosdeco D-1: sem a prova, blocked depois do Stop segue o motivo da prova (artifact.missing no PLAN)', () => {
  const plano = fixture({ fase: 'PLAN' });
  try {
    plano.evento('stop', 20);
    plano.observar(30, [{ state: 'blocked', status: 'idle', pid: process.pid }]);
    assert.equal(plano.observar(36, [{ state: 'blocked', status: 'idle', pid: process.pid }]).classificacao, 'gate_blocked');
    const [pr] = plano.resultados();
    assert.equal(pr.motivo, 'artifact.missing');
    assert.match(String(pr.fonte), /à espera humana \(blocked\); sem prova do ork: docs\/plan\.md não foi gravado/);
  } finally { plano.limpar(); }
  const goal = fixture();
  try {
    goal.evento('stop', 20);
    goal.observar(30, [{ state: 'blocked', pid: process.pid }]);
    assert.equal(goal.observar(36, [{ state: 'blocked', pid: process.pid }]).classificacao, 'gate_blocked');
    assert.equal(goal.resultados()[0].motivo, 'human.pending');
    assert.equal(goal.eventos().some(e => e.motivo === 'runtime.unavailable'), false, 'nunca reexecuta a fase');
  } finally { goal.limpar(); }
});

test('defeitosdeco D-1: blocked continua esperando sem Stop, com bloqueio pendente, com status ocupado ou antes do intervalo', () => {
  const casos: { nome: string; preparar: (f: ReturnType<typeof fixture>) => void; registro: Partial<RegistroAgenteClaude> }[] = [
    { nome: 'sem Stop', preparar: f => { f.evento('heartbeat', 20); }, registro: { state: 'blocked', status: 'idle', pid: process.pid } },
    { nome: 'permissão pedida depois do Stop', preparar: f => { f.evento('stop', 20); f.evento('permission_request', 25); },
      registro: { state: 'blocked', status: 'idle', pid: process.pid } },
    { nome: 'status busy', preparar: f => { f.evento('stop', 20); }, registro: { state: 'blocked', status: 'busy', pid: process.pid } },
  ];
  for (const caso of casos) {
    const f = fixture();
    try {
      f.gravarArtefato(); caso.preparar(f);
      assert.equal(f.observar(30, [caso.registro]).concluido, false, caso.nome);
      assert.equal(f.observar(3600, [caso.registro]).concluido, false, caso.nome);
      assert.equal(f.resultados().length, 0, caso.nome);
    } finally { f.limpar(); }
  }
  const cedo = fixture();
  try {
    cedo.gravarArtefato(); cedo.evento('stop', 20);
    cedo.observar(30, [{ state: 'blocked', pid: process.pid }]);
    assert.equal(cedo.observar(30 + INTERVALO_WATCH_CLAUDE_MS / 1000 - 1, [{ state: 'blocked', pid: process.pid }]).concluido, false,
      'antes de um intervalo do observador a leitura ainda é a primeira');
    // Outro estado no meio zera a contagem: working depois do blocked não herda o instante.
    cedo.observar(40, [{ state: 'working', pid: process.pid }]);
    assert.equal(cedo.observar(41, [{ state: 'blocked', pid: process.pid }]).concluido, false);
    assert.equal(cedo.observar(41 + INTERVALO_WATCH_CLAUDE_MS / 1000, [{ state: 'blocked', pid: process.pid }]).classificacao, 'gate_blocked');
  } finally { cedo.limpar(); }
});
