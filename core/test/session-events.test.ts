import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { ingerirEvento, LIMITE_EVENTO_BYTES } from '../src/session-events';
import { observarSessao } from '../src/session-watcher';

const sid = '11111111-2222-3333-4444-555555555555';
const inicio = '2026-09-01T00:00:00.000Z';
const hora = (seg: number) => new Date(Date.parse(inicio) + seg * 1000).toISOString();
const cli = path.resolve(__dirname, '../../dist/index.js');
function fixture() {
  const p = projetoTemporario('session-events');
  const t = novaThread(p.carregado, { nome: 'sensor', modo: 'auto' }).thread;
  t.sessoes.push({ slug: t.slug, fase: 'GO', bloco: 'GO', sessionId: sid, runtime: 'claude-bg',
    despachadaEm: inicio, promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  return { ...p, t, estado: dir, eventos: () => lerLedger(dir) };
}

test('CLI real carimba episódio original, replay não renova espera e retomada permite outro bloqueio', () => {
  const p = fixture();
  try {
    const run = (tipo: string, seg: number) => spawnSync(process.execPath,
      [cli, 'sessions', 'event', '--tipo', tipo, '--sessao', sid],
      { cwd: p.dir, input: JSON.stringify({ observedAt: hora(seg) }), encoding: 'utf8' });
    for (const [tipo, seg] of [['permission_request', 1], ['permission_prompt', 2],
      ['heartbeat', 3], ['permission_request', 1], ['permission_prompt', 4]] as const) {
      const r = run(tipo, seg); assert.equal(r.status, 0, r.stderr);
    }
    const bloqueios = p.eventos().filter(e => e.tipo === 'sessao_bloqueada');
    assert.deepEqual(bloqueios.map(e => e.ts), [hora(1), hora(4)]);
    assert.equal(p.eventos().filter(e => e.tipo === 'sessao_destravada').length, 1);
    assert.ok(bloqueios.every(e => e.thread === p.t.id && e.fase === 'GO' && e.sessionId === sid));
    assert.equal(p.eventos().filter(e => ['human_gate', 'gate_passed', 'phase_result'].includes(e.tipo)).length, 0);
  } finally { p.limpar(); }
});

test('payload inválido, identidade desconhecida/ambígua e envelope forjado falham sem modificar ledger', () => {
  const p = fixture();
  try {
    const original = fs.readFileSync(path.join(p.estado, 'ledger.jsonl'));
    const falhas = [
      () => ingerirEvento(p.dir, '../escape', 'stop'),
      () => ingerirEvento(p.dir, 'desconhecida', 'stop'),
      () => ingerirEvento(p.dir, sid, 'human_gate'),
      ...['{', '[]', 'null', JSON.stringify({ observedAt: '2026-09-01T00:00:02.000Z' }),
        JSON.stringify({ observedAt: '2026-02-30T00:00:00.000Z' }),
        JSON.stringify({ observedAt: hora(-1) }),
        ...['ts', 'thread', 'tipo', 'fase', 'sessionId', 'comando', '__proto__'].map(k => JSON.stringify({ [k]: '$(touch invadido)' })),
        ' '.repeat(LIMITE_EVENTO_BYTES + 1)].map(bruto =>
        () => ingerirEvento(p.dir, sid, 'stop', bruto, Date.parse(hora(1)))),
    ];
    for (const falha of falhas) { assert.throws(falha); assert.deepEqual(fs.readFileSync(path.join(p.estado, 'ledger.jsonl')), original); }
    const outra = novaThread(p.carregado, { nome: 'outra', modo: 'auto' }).thread;
    outra.sessoes = [...p.t.sessoes]; gravarThread(p.dir, outra);
    assert.throws(() => ingerirEvento(p.dir, sid, 'stop'), /ambígua/);
    assert.deepEqual(fs.readFileSync(path.join(p.estado, 'ledger.jsonl')), original);
    assert.equal(fs.existsSync(path.join(p.dir, 'invadido')), false);
  } finally { p.limpar(); }
});

test('stop do pai e subagente são observações distintas; heartbeats repetidos progridem', () => {
  const p = fixture();
  try {
    for (const [tipo, seg] of [['stop', 1], ['subagent_stop', 2], ['heartbeat', 3], ['heartbeat', 4]] as const) {
      ingerirEvento(p.dir, sid, tipo, '{}', Date.parse(hora(seg)));
    }
    assert.deepEqual(p.eventos().slice(-4).map(e => e.tipo), ['runtime_stop', 'runtime_subagent_stop', 'runtime_event', 'runtime_event']);
    assert.equal(p.eventos().at(-1)?.ts, hora(4));
    const payload = JSON.stringify({ eventId: 'tool-123', observedAt: hora(5) });
    assert.equal(ingerirEvento(p.dir, sid, 'heartbeat', payload).gravado, true);
    assert.equal(ingerirEvento(p.dir, sid, 'heartbeat', payload).gravado, false);
    assert.equal(ingerirEvento(p.dir, sid, 'heartbeat', JSON.stringify({ eventId: 'tool-123', observedAt: hora(6) })).gravado, false);
  } finally { p.limpar(); }
});

test('CLI recusa stdin excessivo e não grava conteúdo recebido', () => {
  const p = fixture();
  try {
    const antes = p.eventos().length;
    const r = spawnSync(process.execPath, [cli, 'sessions', 'event', '--tipo', 'notification', '--sessao', sid],
      { cwd: p.dir, input: 'x'.repeat(100000), encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /excede/); assert.equal(p.eventos().length, antes);
    assert.throws(() => ingerirEvento(p.dir, sid, 'commit'), /SHA/);
    ingerirEvento(p.dir, sid, 'commit', JSON.stringify({ commit: 'a'.repeat(40), observedAt: hora(2) }));
    assert.equal(p.eventos().at(-1)?.commit, 'a'.repeat(40));
  } finally { p.limpar(); }
});

test('sessão adotada não tem despacho: sensor e watcher recusam sem inventar âncora', () => {
  const p = projetoTemporario('session-events-adocao');
  try {
    const adotado = '99999999-8888-7777-6666-555555555555';
    const t = novaThread(p.carregado, { nome: 'adotada', modo: 'auto' }).thread;
    t.sessoes.push({ slug: t.slug, fase: 'GO', bloco: 'ad-hoc', sessionId: adotado, runtime: 'codex',
      origem: 'adocao', adotadaEm: inicio, cwdOrigem: p.dir, verificada: true });
    gravarThread(p.dir, t);
    const eventos = () => lerLedger(dirThread(p.dir, t.id));
    const antes = eventos().length;
    assert.throws(() => ingerirEvento(p.dir, adotado, 'heartbeat', '{}', Date.parse(hora(1))),
      /adotada, não despachada/);
    assert.throws(() => observarSessao(p.carregado, adotado, { rollout: null }), /adotada, não despachada/);
    assert.throws(() => observarSessao(p.carregado, adotado, { rollout: null, threadId: t.id }), /adotada, não despachada/);
    const r = spawnSync(process.execPath, [cli, 'sessions', 'event', '--tipo', 'heartbeat', '--sessao', adotado],
      { cwd: p.dir, input: '{}', encoding: 'utf8', timeout: 5000 });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /ork phase run/);
    assert.equal(eventos().length, antes);
    assert.equal(fs.existsSync(path.join(dirThread(p.dir, t.id), 'sensores')), false);
  } finally { p.limpar(); }
});

const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Mutante que esta cobertura mata: `iniciarWatcher` sem a guarda saía 0 para sessão adotada,
 * devolvia `{"pid":N}`, abria `watcher-<id>.stderr` e criava um filho que morria sem gravar
 * nenhum `session_watcher_error`. O caminho público padrão (sem `--once`) é o testado aqui.
 */
test('watch assíncrono de sessão adotada recusa antes de abrir log ou criar filho', () => {
  const p = projetoTemporario('session-watch-adocao');
  try {
    const adotado = '77777777-6666-5555-4444-333333333333';
    const t = novaThread(p.carregado, { nome: 'adotada-watch', modo: 'auto' }).thread;
    t.sessoes.push({ slug: t.slug, fase: 'GO', bloco: 'ad-hoc', sessionId: adotado, runtime: 'codex',
      origem: 'adocao', adotadaEm: inicio, cwdOrigem: p.dir, verificada: true });
    gravarThread(p.dir, t);
    const dir = dirThread(p.dir, t.id);
    const threadAntes = fs.readFileSync(path.join(dir, 'thread.json'), 'utf8');
    const ledgerAntes = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8');

    const r = spawnSync(process.execPath, [cli, 'sessions', 'watch', '--thread', t.id, '--sessao', adotado],
      { cwd: p.dir, encoding: 'utf8', timeout: 10000 });
    assert.notEqual(r.status, 0, `watch assíncrono aceitou sessão adotada: ${r.stdout}`);
    assert.match(r.stderr, /adotada, não despachada/);
    assert.match(r.stderr, /ork phase run/);
    assert.doesNotMatch(r.stdout, /pid/);

    assert.equal(fs.existsSync(path.join(dir, `watcher-${adotado}.stderr`)), false);
    assert.equal(fs.existsSync(path.join(dir, 'sensores')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8'), ledgerAntes);
    assert.equal(fs.readFileSync(path.join(dir, 'thread.json'), 'utf8'), threadAntes);
    assert.equal(lerLedger(dir).some(e => e.sessionId === adotado), false);
    assert.equal(JSON.parse(threadAntes).sessoes.at(-1).despachadaEm, undefined);

    const umaVez = spawnSync(process.execPath,
      [cli, 'sessions', 'watch', '--thread', t.id, '--sessao', adotado, '--once'],
      { cwd: p.dir, encoding: 'utf8', timeout: 10000 });
    assert.notEqual(umaVez.status, 0, umaVez.stdout);
    assert.match(umaVez.stderr, /ork phase run/);
  } finally { p.limpar(); }
});

test('watch assíncrono de sessão despachada segue abrindo log e filho', async () => {
  const p = projetoTemporario('session-watch-despachada');
  let pid: number | null = null;
  try {
    const despachado = '66666666-5555-4444-3333-222222222222';
    const t = novaThread(p.carregado, { nome: 'despachada-watch', modo: 'auto' }).thread;
    t.sessoes.push({ slug: t.slug, fase: 'GO', bloco: 'GO', sessionId: despachado, runtime: 'codex',
      despachadaEm: inicio, promptPath: '', promptSha256: '', verificada: true });
    // Thread fechada: o filho encerra na primeira volta, sem procurar rollout fora da fixture.
    t.status = 'fechada';
    gravarThread(p.dir, t);
    // TC5: despacho valido tambem fornece uma fonte valida antes do arranque.
    const dir = dirThread(p.dir, t.id);
    const logPath = path.join(dir, 'sessoes', 'fixture.codex.jsonl');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify({ type: 'thread.started', thread_id: despachado }) + '\n');
    registrar(dir, t.id, 'session_sensor_registered', { sessionId: despachado, despachoEm: inicio, logPath });
    const r = spawnSync(process.execPath, [cli, 'sessions', 'watch', '--thread', t.id, '--sessao', despachado],
      { cwd: p.dir, encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    pid = JSON.parse(r.stdout).pid;
    assert.equal(Number.isInteger(pid), true);
    assert.equal(fs.existsSync(path.join(dirThread(p.dir, t.id), `watcher-${despachado}.stderr`)), true);
    for (let i = 0; i < 60 && vivo(pid as number); i++) await espera(100);
    assert.equal(vivo(pid as number), false);
  } finally {
    if (pid !== null && vivo(pid)) { try { process.kill(pid, 'SIGTERM'); } catch { /* já saiu */ } }
    p.limpar();
  }
});
