import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { adicionarClaim } from '../src/claims';
import { dirThread, novaThread } from '../src/thread';
import { consultarVerifyMcp, executarVerifyMcpWorker, iniciarVerifyMcp } from '../src/mcp-verify-async';
import { textoDoVerify, verificar } from '../src/verify';
import { commitar, projetoTemporario } from './apoio';

function inicio(pid = process.pid): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch { return null; }
}

const fakeVivo = {
  lancar: () => ({ pid: process.pid, inicio: inicio() }),
  processoVivo: () => true,
};

function fixture(nome: string, comando = 'true') {
  const p = projetoTemporario('mcp-verify-async-' + nome);
  const thread = novaThread(p.carregado, { nome, modo: 'auto', criarWorktree: true }).thread;
  commitar(thread.worktree!, 'produto.md', 'produto\n', 'produto');
  adicionarClaim(p.dir, thread.id, { arquivo: 'produto.md', alegacao: 'fixture verificável', verificar: [comando] });
  return { p, thread };
}

async function esperar<T>(ler: () => T, pronto: (v: T) => boolean, prazoMs = 20_000): Promise<T> {
  const ate = Date.now() + prazoMs;
  for (;;) {
    const v = ler();
    if (pronto(v)) return v;
    if (Date.now() >= ate) throw Error('prazo da fixture assíncrona');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('rodada é iniciada e consultada imediatamente por UUID', () => {
  const f = fixture('inicio');
  try {
    const iniciada = iniciarVerifyMcp(f.p.dir, f.thread.id, { host: 'codex', despacho: null }, fakeVivo);
    assert.match(iniciada.rodadaId, /^[a-f0-9-]{36}$/);
    assert.equal(iniciada.estado, 'na-fila');
    const consultada = consultarVerifyMcp(f.p.dir, f.thread.id, iniciada.rodadaId, fakeVivo);
    assert.deepEqual([consultada.rodadaId, consultada.estado, consultada.veredito], [iniciada.rodadaId, 'na-fila', undefined]);
  } finally { f.p.limpar(); }
});

test('fila pesada ocupada aparece como na-fila e libera a mesma rodada para concluir', async () => {
  const f = fixture('fila');
  const pronto = path.join(os.tmpdir(), `ork-fila-${process.pid}-${Date.now()}`);
  let holder: ChildProcess | null = null;
  try {
    const modulo = path.resolve(__dirname, '../src/fila-pesada.js');
    const script = `const fs=require('node:fs');const f=require(${JSON.stringify(modulo)});` +
      `f.comRecursoPesado(${JSON.stringify(f.p.dir)},{artefato:${JSON.stringify(f.p.dir)},operacao:'fixture',thread:'ork-outra',slots:1,esperarMs:0},()=>{fs.writeFileSync(${JSON.stringify(pronto)},'ok');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,15000)});`;
    holder = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
    await esperar(() => fs.existsSync(pronto), Boolean, 10_000);
    const rodada = iniciarVerifyMcp(f.p.dir, f.thread.id, { host: 'codex', despacho: null });
    const naFila = await esperar(() => consultarVerifyMcp(f.p.dir, f.thread.id, rodada.rodadaId),
      (s) => s.estado === 'na-fila' && s.lane === 'fila-pesada' && (s.ocupantes?.length ?? 0) > 0);
    assert.equal(naFila.ocupantes?.[0]?.thread, 'ork-outra');
    holder.kill('SIGTERM');
    const terminal = await esperar(() => consultarVerifyMcp(f.p.dir, f.thread.id, rodada.rodadaId),
      (s) => s.estado === 'concluido' || s.estado === 'falhou');
    assert.equal(terminal.estado, 'concluido', JSON.stringify(terminal.falha));
  } finally {
    holder?.kill('SIGKILL'); fs.rmSync(pronto, { force: true }); f.p.limpar();
  }
});

test('pedido repetido enquanto a rodada vive devolve o mesmo id e não relança', () => {
  const f = fixture('repetida'); let lancamentos = 0;
  const dep = { ...fakeVivo, lancar: () => { lancamentos++; return { pid: process.pid, inicio: inicio() }; } };
  try {
    const primeira = iniciarVerifyMcp(f.p.dir, f.thread.id, { host: 'codex', despacho: null }, dep);
    const segunda = iniciarVerifyMcp(f.p.dir, f.thread.id, { host: 'codex', despacho: null }, dep);
    assert.equal(segunda.rodadaId, primeira.rodadaId);
    assert.equal(segunda.reutilizada, true);
    assert.equal(lancamentos, 1);
  } finally { f.p.limpar(); }
});

test('worker morto no meio vira falha tipada e nunca verde', async () => {
  const f = fixture('morta', `node -e "setTimeout(()=>{},3000)"`);
  try {
    const rodada = iniciarVerifyMcp(f.p.dir, f.thread.id, { host: 'codex', despacho: null });
    await esperar(() => consultarVerifyMcp(f.p.dir, f.thread.id, rodada.rodadaId), (s) => s.estado === 'rodando');
    const estado = JSON.parse(fs.readFileSync(path.join(dirThread(f.p.dir, f.thread.id), 'verify-mcp', `${rodada.rodadaId}.json`), 'utf8'));
    process.kill(estado.processo.pid, 'SIGKILL');
    const morto = await esperar(() => consultarVerifyMcp(f.p.dir, f.thread.id, rodada.rodadaId), (s) => s.estado === 'falhou');
    assert.equal(morto.falha?.motivo, 'verify.processo-morto');
    assert.notEqual(morto.veredito?.ok, true);
  } finally { f.p.limpar(); }
});

test('veredito assíncrono coincide com o verify canônico para o mesmo HEAD', () => {
  const f = fixture('paridade');
  try {
    const rodada = iniciarVerifyMcp(f.p.dir, f.thread.id, { host: 'codex', despacho: null }, fakeVivo);
    const async = executarVerifyMcpWorker(f.p.dir, f.thread.id, rodada.rodadaId);
    assert.equal(async.estado, 'concluido', JSON.stringify(async.falha));
    const direto = verificar(f.p.carregado, f.thread.id, { conducao: { canal: 'cli' } });
    assert.deepEqual({ ok: async.veredito?.ok, commit: async.veredito?.commit, motivos: async.veredito?.motivos,
      check: async.veredito?.check }, { ok: direto.ok, commit: direto.commit, motivos: direto.motivos, check: direto.check });
    assert.equal(async.veredito?.texto, textoDoVerify(async.veredito!.resultado));
    assert.deepEqual(async.veredito?.resultado.comandos.map((c) => [c.nome, c.ok]), direto.comandos.map((c) => [c.nome, c.ok]));
  } finally { f.p.limpar(); }
});
