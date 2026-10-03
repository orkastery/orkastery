import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { verificarMcp } from '../src/mcp-verify';
import { adquirir, caminhoFila, caminhoLease, lerLease, liberar } from '../src/leases';
import { adicionarClaim } from '../src/claims';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { adicionarClaimMcp } from '../src/mcp-artifacts';
import { commitar, projetoTemporario } from './apoio';

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
function fixture(nome: string) {
  const p = projetoTemporario('mcp-verify-' + nome);
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true });
  commitar(thread.worktree as string, 'produto.md', 'produto\n', 'produto');
  return { p, thread, wt: thread.worktree as string, lease: 'worktree-write:' + thread.id };
}

test('MCP VERIFY usa sandbox real, registra resultado canônico e libera somente a lease própria', () => {
  const f = fixture('positivo');
  try {
    adicionarClaim(f.p.dir, f.thread.id, { arquivo: 'produto.md', alegacao: 'prova real', verificar: ['test -f produto.md; echo prova-real'] });
    const r = verificarMcp(f.p.dir, f.thread.id);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.executor, 'codex-sandbox');
    assert.equal(r.claims.verificadas, 1); assert.match(r.execucoes[0].resumo, /prova-real/); assert.equal(r.execucoes[0].executado, true);
    assert.equal(lerLease(f.p.dir, f.lease), null);
    const eventos = lerLedger(dirThread(f.p.dir, f.thread.id));
    assert.ok(eventos.some(e => e.tipo === 'verify_run')); assert.equal(eventos.some(e => e.tipo === 'ship_done'), false);
  } finally { f.p.limpar(); }
});

test('MCP VERIFY bloqueia shell da claim escrevendo fora da WT, sem fallback e sem recibo SHIP', () => {
  const f = fixture('sentinela'); const fora = path.join(f.p.dir, 'sentinela'); fs.writeFileSync(fora, 'original');
  try {
    adicionarClaim(f.p.dir, f.thread.id, { arquivo: 'produto.md', alegacao: 'contraprova externa', verificar: [`echo escapou > ${q(fora)}`] });
    const r = verificarMcp(f.p.dir, f.thread.id);
    assert.equal(r.ok, false); assert.notEqual(r.execucoes[0].code, 0); assert.equal(r.execucoes[0].executado, true);
    assert.equal(fs.readFileSync(fora, 'utf8'), 'original'); assert.equal(lerLease(f.p.dir, f.lease), null);
  } finally { f.p.limpar(); }
});

test('MCP VERIFY recusa lease ativa da própria thread sem herdá-la, renová-la ou liberar', () => {
  const f = fixture('ocupada');
  try {
    adquirir(f.p.dir, f.lease, { thread: f.thread.id, motivo: 'outro processo', ttlMs: 60_000 });
    const antes = fs.readFileSync(caminhoLease(f.p.dir, f.lease), 'utf8');
    assert.throws(() => verificarMcp(f.p.dir, f.thread.id), /lease.busy/);
    assert.equal(fs.readFileSync(caminhoLease(f.p.dir, f.lease), 'utf8'), antes);
    assert.equal(lerLedger(dirThread(f.p.dir, f.thread.id)).some(e => e.tipo === 'verify_run'), false);
  } finally { f.p.limpar(); }
});

test('retomarVencido false preserva bytes de lease expirada/corrompida; default legado retoma', () => {
  const f = fixture('stale');
  try {
    adquirir(f.p.dir, f.lease, { thread: 'anterior', motivo: 'stale', ttlMs: -1 });
    const file = caminhoLease(f.p.dir, f.lease);
    for (const bytes of [fs.readFileSync(file, 'utf8'), '{corrompida']) {
      fs.writeFileSync(file, bytes);
      const r = adquirir(f.p.dir, f.lease, { thread: f.thread.id, motivo: 'novo', retomarVencido: false });
      assert.equal(r.ok, false); assert.equal(r.tomadoDeVencido, false); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.throws(() => verificarMcp(f.p.dir, f.thread.id), /lease.busy/);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    }
    const recente = adquirir(f.p.dir, f.lease, { thread: f.thread.id, motivo: 'ainda escrevendo' });
    assert.equal(recente.ok, false, 'RM-036: arquivo recem-criado ainda pode pertencer ao escritor wx');
    const antes = new Date(Date.now() - 6_000);
    fs.utimesSync(file, antes, antes);
    const legado = adquirir(f.p.dir, f.lease, { thread: f.thread.id, motivo: 'legado' });
    assert.equal(legado.ok, true); assert.equal(legado.tomadoDeVencido, true);
    liberar(f.p.dir, f.lease, f.thread.id);
  } finally { f.p.limpar(); }
});

test('MCP VERIFY recusa raiz/ID inválidos, estado symlink e worktree de outra raiz', () => {
  const f = fixture('escopo'); const outro = projetoTemporario('mcp-verify-outro');
  try {
    assert.throws(() => verificarMcp('.', f.thread.id), /invalid/);
    assert.throws(() => verificarMcp(f.p.dir, '../escape'), /invalid/);
    const file = path.join(dirThread(f.p.dir, f.thread.id), 'claims.jsonl');
    fs.writeFileSync(path.join(outro.dir, 'claims'), ''); fs.symlinkSync(path.join(outro.dir, 'claims'), file);
    assert.throws(() => verificarMcp(f.p.dir, f.thread.id), /unsafe/); fs.unlinkSync(file);
    f.thread.worktree = outro.dir; gravarThread(f.p.dir, f.thread);
    assert.throws(() => verificarMcp(f.p.dir, f.thread.id), /worktree/);
    assert.equal(fs.existsSync(caminhoLease(f.p.dir, f.lease)), false);
  } finally { outro.limpar(); f.p.limpar(); }
});


test('MCP VERIFY preserva lease substituída por outro dono durante execução', t => {
  const f = fixture('identidade');
  const sandbox = require('../src/verify-sandbox') as typeof import('../src/verify-sandbox');
  const original = sandbox.criarExecutorSandbox;
  let substituta = '';
  t.mock.method(sandbox, 'criarExecutorSandbox', (opcoes: Parameters<typeof original>[0]) => {
    const real = original(opcoes);
    return { ...real, executar: (...args: Parameters<typeof real.executar>) => {
      const r = real.executar(...args);
      const atual = lerLease(f.p.dir, f.lease)!;
      substituta = JSON.stringify({ ...atual, motivo: 'outra operação', thread: 'outra-thread' });
      fs.writeFileSync(caminhoLease(f.p.dir, f.lease), substituta);
      return r;
    }};
  });
  try {
    adicionarClaim(f.p.dir, f.thread.id, { arquivo: 'produto.md', alegacao: 'execução antes de substituição', verificar: ['true'] });
    assert.throws(() => verificarMcp(f.p.dir, f.thread.id), /lease.changed/);
    assert.ok(substituta); assert.equal(fs.readFileSync(caminhoLease(f.p.dir, f.lease), 'utf8'), substituta);
  } finally { f.p.limpar(); }
});

test('prazo total impede comandos restantes: relógio simulado, primeira execução real', t => {
  const f = fixture('prazo');
  const sandbox = require('../src/verify-sandbox') as typeof import('../src/verify-sandbox');
  const original = sandbox.criarExecutorSandbox;
  const inicio = Date.now(); let avancado = 0;
  t.mock.method(Date, 'now', () => inicio + avancado);
  t.mock.method(sandbox, 'criarExecutorSandbox', (opcoes: Parameters<typeof original>[0]) => {
    const real = original(opcoes);
    return { ...real, executar: (...args: Parameters<typeof real.executar>) => {
      const r = real.executar(...args); avancado = 180_000; return r;
    }};
  });
  try {
    adicionarClaim(f.p.dir, f.thread.id, { arquivo: 'produto.md', alegacao: 'limite total', verificar: ['echo primeiro > primeiro', 'echo segundo > segundo'] });
    const r = verificarMcp(f.p.dir, f.thread.id);
    assert.equal(r.ok, false); assert.equal(r.execucoes[0].executado, true); assert.equal(r.execucoes[1].executado, false);
    assert.match(r.execucoes[1].resumo, /prazo total/); assert.equal(fs.existsSync(path.join(f.wt, 'primeiro')), true);
    assert.equal(fs.existsSync(path.join(f.wt, 'segundo')), false); assert.equal(lerLease(f.p.dir, f.lease), null);
  } finally { f.p.limpar(); }
});


test('fila symlink dangling é recusada antes de adquirir ou criar alvo externo', () => {
  const f = fixture('fila-dangling'); const outro = projetoTemporario('fila-externa');
  const fora = path.join(outro.dir, 'nao-existe.json');
  try {
    fs.mkdirSync(path.dirname(caminhoFila(f.p.dir)), { recursive: true });
    fs.symlinkSync(fora, caminhoFila(f.p.dir));
    assert.throws(() => verificarMcp(f.p.dir, f.thread.id), /queue.unsafe/);
    assert.equal(fs.existsSync(fora), false); assert.equal(fs.lstatSync(caminhoFila(f.p.dir)).isSymbolicLink(), true);
    assert.equal(fs.existsSync(caminhoLease(f.p.dir, f.lease)), false);
  } finally { outro.limpar(); f.p.limpar(); }
});

test('lease canônica impede claim_add concorrente e ambas leases próprias são liberadas', t => {
  const f = fixture('claims-concorrentes');
  const sandbox = require('../src/verify-sandbox') as typeof import('../src/verify-sandbox');
  const original = sandbox.criarExecutorSandbox; let tentou = false;
  t.mock.method(sandbox, 'criarExecutorSandbox', (opcoes: Parameters<typeof original>[0]) => {
    tentou = true;
    assert.throws(() => adicionarClaimMcp(f.p.dir, f.thread.id, {
      arquivo: 'produto.md', alegacao: 'não deve entrar durante VERIFY', verificar: ['false'],
    }), /lease.busy/);
    return original(opcoes);
  });
  try {
    adicionarClaim(f.p.dir, f.thread.id, { arquivo: 'produto.md', alegacao: 'claim original', verificar: ['true'] });
    const r = verificarMcp(f.p.dir, f.thread.id); assert.equal(r.ok, true); assert.equal(tentou, true);
    assert.equal(r.claims.total, 1); assert.equal(lerLease(f.p.dir, f.lease), null);
    assert.equal(lerLease(f.p.dir, 'path:.orkastery/threads/' + f.thread.id), null);
  } finally { f.p.limpar(); }
});
