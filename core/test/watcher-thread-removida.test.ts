/**
 * GO-FIX 2, achado 1 do CHECK 2764ac5f: o watcher destacado de cada despacho claude-bg
 * escrevia na pasta da thread enquanto o teste apagava o projeto (ENOTEMPTY) e recriava a
 * pasta depois da limpeza (`cursor-claude.json` órfão em /tmp). Produto: o watcher não
 * recria thread apagada e encerra sozinho. Testes: `limpar()` encerra os watchers antes.
 * GO-FIX 3 (CHECK dd50cc0c): o que a observação criou numa thread que sumiu é desfeito, e o
 * teste do watcher vivo simula o sumiço por rename atômico em vez de `rmSync` concorrente.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimeFalso } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { novaThread, gravarThread, dirThread, lerThread } from '../src/thread';
import { caminhoLedger, lerLedger, registrar, registrarSeExiste, threadPresente } from '../src/ledger';
import { exigirSessaoDespachada, ingerirEvento } from '../src/session-events';
import { observarSessao } from '../src/session-watcher';
import { fonteClaudeDoDespacho, garantirFonteClaude, THREAD_REMOVIDA } from '../src/session-watcher-claude';
import { rodarFase } from '../src/phase';
import { estadoProcesso, IdentidadeProcesso } from '../src/adapters/codex-runner';
import { ConsultaAgentesNativos } from '../src/adapters/claude-bg';

const sid = '11111111-2222-3333-4444-555555555555';
const inicio = Date.parse('2026-09-01T00:00:00.000Z');
const hora = (seg: number) => new Date(inicio + seg * 1000).toISOString();

function fixture(registrarFonte = true) {
  const p = projetoTemporario('watcher-removida');
  const t = novaThread(p.carregado, { nome: 'removida', modo: 'auto' }).thread;
  t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'claude-bg', despachadaEm: hora(0),
    promptPath: '', promptSha256: '', verificada: true });
  t.faseAtual = 'GO';
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: sid, runtime: 'claude-bg', cwd: p.dir });
  if (registrarFonte) registrar(dir, t.id, 'session_sensor_registered', { fase: 'GO', sessionId: sid, despachoEm: hora(0),
    ...fonteClaudeDoDespacho(p.dir, t.id, 'GO', p.dir) });
  return { ...p, t, estado: dir };
}

test('GO-FIX 2 (achado 1): projeto apagado durante a observação não renasce e o observador encerra sem erro', () => {
  for (const comStop of [false, true]) {
    const p = fixture();
    try {
      // Com Stop o caminho passa pelo lock de sessão; sem Stop, pela gravação do cursor.
      if (comStop) ingerirEvento(p.dir, sid, 'stop', JSON.stringify({ observedAt: hora(20), eventId: 'stop-20' }), inicio + 86400000);
      const consulta = (): ConsultaAgentesNativos => {
        fs.rmSync(p.dir, { recursive: true, force: true });
        return { ok: true, detalhe: '', consultadoEm: hora(30), registros: [{ sessionId: sid, cwd: p.dir, state: 'done' }] };
      };
      const r = observarSessao(p.carregado, sid, { agoraMs: inicio + 30000, consultaClaude: consulta });
      assert.deepEqual([r.concluido, r.encerrado, r.espera], [false, true, THREAD_REMOVIDA], `comStop=${comStop}`);
      assert.equal(fs.existsSync(p.dir), false, `a pasta do projeto não pode renascer (comStop=${comStop})`);
    } finally { p.limpar(); }
  }
});

test('GO-FIX 2 (achado 1): ledger apagado não ganha registro retroativo; ledger presente continua recebendo eventos', () => {
  const p = fixture(false);
  try {
    const t = lerThread(p.dir, p.t.id), sessao = exigirSessaoDespachada(t.sessoes[0], sid);
    fs.renameSync(caminhoLedger(p.estado), caminhoLedger(p.estado) + '.fora');
    assert.equal(threadPresente(p.estado), false);
    assert.throws(() => garantirFonteClaude(p.dir, t, sessao), new RegExp(THREAD_REMOVIDA));
    assert.equal(registrarSeExiste(p.estado, t.id, 'session_watcher_error', {}), null);
    assert.equal(fs.existsSync(caminhoLedger(p.estado)), false, 'o watcher não cria ledger');
    // Positivo: com o ledger de volta, o registro retroativo é gravado uma vez.
    fs.renameSync(caminhoLedger(p.estado) + '.fora', caminhoLedger(p.estado));
    assert.equal(threadPresente(p.estado), true);
    assert.equal(garantirFonteClaude(p.dir, t, sessao).nativo, 'claude-agents');
    assert.equal(lerLedger(p.estado).filter(e => e.tipo === 'session_sensor_registered').length, 1);
    assert.equal(registrarSeExiste(p.estado, t.id, 'teste_presente', { x: 1 })?.tipo, 'teste_presente');
    // Sem thread.json a thread não está presente, mesmo com o ledger no lugar.
    fs.rmSync(path.join(p.estado, 'thread.json'));
    assert.equal(registrarSeExiste(p.estado, t.id, 'teste_ausente', {}), null);
    assert.equal(lerLedger(p.estado).some(e => e.tipo === 'teste_ausente'), false);
  } finally { p.limpar(); }
});

function despacharComWatcher(nome: string) {
  const runtime = runtimeFalso(nome);
  const p = projetoTemporario(nome);
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const r = rodarFase(p.carregado, t.id, { fase: 'GO', runtime: 'claude-bg', prompt: 'fixture SIMULADA do watcher' });
  assert.ok(r.sessionId, r.erro);
  const arranque = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'session_watcher_started');
  assert.ok(arranque, 'o despacho não iniciou o watcher');
  const identidade = arranque.identidade as IdentidadeProcesso;
  assert.equal(estadoProcesso(identidade), 'vivo');
  return { runtime, p, identidade };
}

test('GO-FIX 3 (achado 1): watcher destacado vivo encerra sozinho quando o projeto some, sem recriar a pasta', () => {
  const { runtime, p, identidade } = despacharComWatcher('watcher-orfao');
  const lapide = p.dir + '.lapide';
  try {
    // Sumiço atômico com o watcher vivo. Um `rmSync` aqui disputaria entradas com o watcher e
    // mediria a corrida da remoção recursiva (CHECK dd50cc0c), não o produto.
    fs.renameSync(p.dir, lapide);
    esperarCondicao(() => estadoProcesso(identidade) !== 'vivo', 20000);
    const pausa = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(pausa, 0, 0, 1500);
    assert.equal(fs.existsSync(p.dir), false, 'o watcher recriou a pasta do projeto apagado');
  } finally {
    runtime.restaurar();
    // A lápide só é apagada depois de o watcher sair (ou do prazo acima vencer).
    fs.rmSync(lapide, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    p.limpar();
  }
});

test('GO-FIX 3 (achado 1): thread apagada durante a observação não fica com sensores nem cursor; thread presente mantém o cursor', () => {
  // Negativo: a consulta nativa simula um `rm -rf` que já apagou thread.json e ledger mas ainda
  // não chegou ao rmdir da pasta da thread. Sem desfazer, sensores/<chave>/cursor-claude.json
  // seguraria esse rmdir (ENOTEMPTY).
  const p = fixture();
  try {
    const consulta = (): ConsultaAgentesNativos => {
      fs.rmSync(path.join(p.estado, 'thread.json')); fs.rmSync(caminhoLedger(p.estado));
      return { ok: true, detalhe: '', consultadoEm: hora(30), registros: [{ sessionId: sid, cwd: p.dir, state: 'working', pid: process.pid }] };
    };
    const r = observarSessao(p.carregado, sid, { agoraMs: inicio + 30000, consultaClaude: consulta });
    assert.deepEqual([r.concluido, r.encerrado, r.espera], [false, true, THREAD_REMOVIDA]);
    assert.equal(fs.existsSync(path.join(p.estado, 'sensores')), false, 'sensores/ recriado ficou na thread apagada');
    assert.equal(fs.readdirSync(p.estado).some(n => n.includes('lock')), false, 'lock deixado na thread apagada');
  } finally { p.limpar(); }
  // Positivo: com a thread presente, a mesma observação mantém a pasta e o cursor.
  const q = fixture();
  try {
    const consulta = (): ConsultaAgentesNativos =>
      ({ ok: true, detalhe: '', consultadoEm: hora(30), registros: [{ sessionId: sid, cwd: q.dir, state: 'working', pid: process.pid }] });
    const r = observarSessao(q.carregado, sid, { agoraMs: inicio + 30000, consultaClaude: consulta });
    assert.deepEqual([r.concluido, r.encerrado ?? false], [false, false]);
    const sensores = path.join(q.estado, 'sensores');
    const [chave] = fs.readdirSync(sensores);
    assert.ok(fs.existsSync(path.join(sensores, chave, 'cursor-claude.json')), 'cursor ausente com a thread presente');
  } finally { q.limpar(); }
});

test('GO-FIX 2 (achado 1): limpar() encerra o watcher pela identidade antes de apagar o projeto', () => {
  const { runtime, p, identidade } = despacharComWatcher('watcher-limpar');
  try {
    p.limpar();
    assert.notEqual(estadoProcesso(identidade), 'vivo', 'limpar() devolveu com o watcher vivo');
    assert.equal(fs.existsSync(p.dir), false);
  } finally { runtime.restaurar(); p.limpar(); }
});
