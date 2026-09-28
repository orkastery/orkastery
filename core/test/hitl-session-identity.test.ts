/** Runtime e identidades SIMULADOS. Nenhuma sessão operacional é sinalizada. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { superarSessao, ControleSessao, IdentidadeSessao } from '../src/hitl-sessions';

const sessionId = '00000000-0000-0000-0000-000000000001';
function fixture(runtime = 'claude-bg') {
  const p = projetoTemporario('hitl-identity');
  const t = novaThread(p.carregado, { nome: 'simulada', modo: 'auto' }).thread;
  t.sessoes.push({ sessionId, runtime, fase: 'GO', slug: t.slug, bloco: 'GO', promptPath: 'simulado.md', promptSha256: '0'.repeat(64), verificada: true, despachadaEm: new Date().toISOString() });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { sessionId, runtime, fase: 'GO' });
  registrar(dir, t.id, 'phase_dispatch', { sessionId: 'posterior-simulada', runtime, fase: 'GO' });
  registrar(dir, t.id, 'phase_dispatch_verified', { sessionId: 'posterior-simulada', encontrada: true });
  return { p, t, dir };
}

test('superação confirma mesma instância bloqueada e consulta depois; repetição não para novamente', () => {
  const { p, t, dir } = fixture();
  let estado: IdentidadeSessao | undefined = { sessionId, runtime: 'claude-bg', cwd: p.dir, estado: 'blocked', instancia: 'instancia-1' };
  let stops = 0;
  const ctl: ControleSessao = { consultar: () => ({ ok: true, sessoes: estado ? [estado] : [] }), parar: () => { stops++; estado = undefined; return true; } };
  try {
    assert.equal(superarSessao(p.dir, t.id, sessionId, 'GO', 'claude-bg', ctl).repetida, false);
    assert.equal(superarSessao(p.dir, t.id, sessionId, 'GO', 'claude-bg', ctl).repetida, true);
    assert.equal(stops, 1);
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'session_superseded').length, 1);
  } finally { p.limpar(); }
});

test('identidade alheia, working, cwd divergente, consulta falha e instância trocada preservam sessão', () => {
  const { p, t, dir } = fixture();
  try {
    const base = { sessionId, runtime: 'claude-bg', cwd: p.dir, estado: 'blocked', instancia: 'instancia-1' };
    for (const change of [{ sessionId: 'outra' }, { estado: 'working' }, { cwd: '/outra' }, { runtime: 'codex' }]) {
      const ctl = { consultar: () => ({ ok: true, sessoes: [{ ...base, ...change }] }), parar: () => { throw Error('não deve parar'); } };
      assert.throws(() => superarSessao(p.dir, t.id, sessionId, 'GO', 'claude-bg', ctl));
    }
    let n = 0;
    assert.throws(() => superarSessao(p.dir, t.id, sessionId, 'GO', 'claude-bg', {
      consultar: () => ({ ok: true, sessoes: [{ ...base, instancia: String(n++) }] }), parar: () => { throw Error('não deve parar'); },
    }), /mudou/);
    assert.throws(() => superarSessao(p.dir, t.id, sessionId, 'GO', 'claude-bg', { consultar: () => ({ ok: false, sessoes: [] }), parar: () => true }), /consulta falhou/);
    assert.throws(() => superarSessao(p.dir, t.id, sessionId, 'GO', 'claude-bg', { consultar: () => ({ ok: true, sessoes: [base] }), parar: () => true }), /posterior/);
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'session_superseded').length, 0);
  } finally { p.limpar(); }
});

test('Codex sem identidade de controller nativa é indisponível; nunca tenta adapter Claude ou PID inferido', () => {
  const { p, t } = fixture('codex');
  try { assert.throws(() => superarSessao(p.dir, t.id, sessionId, 'GO', 'codex'), /runtime.unavailable.*controller/); }
  finally { p.limpar(); }
});
