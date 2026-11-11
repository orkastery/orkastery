import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { ErroDeReconciliacao, executarReservaCoordenada, executarSagaDaThread, lerOperacaoDaRedeEmpresa,
  reconciliarOperacaoDaRedeEmpresa, type PortaColetivaDaSaga, type PortaLocalDaSaga } from '../src/rede-empresa-operacao';

const cobertura = { nivel: 'exigir' as const, estado: 'conferida' as const, permite: true,
  codigo: 'rede-empresa.cobertura-ok' as const, reciboVersao: 'v2', auditavel: true };

function portas(eventos: string[], falha?: string) {
  let local = 'local-1', coletiva = 'coletiva-1';
  const c: PortaColetivaDaSaga = {
    reservar: () => { eventos.push('coletiva'); if (falha === 'coletiva') throw new Error(falha); return { fingerprint: coletiva, valor: { cobertura } }; },
    soltar: (f) => { eventos.push(`solta-coletiva:${f}`); return falha !== 'compensa-coletiva' && f === coletiva; },
  };
  const l: PortaLocalDaSaga<string> = {
    reservar: () => { eventos.push('local'); if (falha === 'local') throw new Error(falha); return { fingerprint: local, valor: 'reserva-local' }; },
    vincular: (thread, esperado) => { eventos.push(`vinculo:${thread}:${esperado}`); if (falha === 'vinculo') throw new Error(falha);
      local = 'local-2'; return { fingerprint: local, valor: 'reserva-vinculada' }; },
    soltar: (f) => { eventos.push(`solta-local:${f}`); return falha !== 'compensa-local' && f === local; },
  };
  return { coletiva: c, local: l };
}

const base = (raiz: string, p: ReturnType<typeof portas>) => ({ raiz, projectKey: 'github:github.com/time/projeto',
  itemId: 'RM-089', operationId: 'op-1234567890abcdef', ...p });

test('saga executa coletivo, local, thread e vínculo nesta ordem', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'rm089-saga-ok-')), eventos: string[] = [];
  try {
    const r = executarSagaDaThread({ ...base(raiz, portas(eventos)), criarThread: () => {
      eventos.push('thread'); return { threadId: 'ork-t1', valor: 'thread' }; } });
    assert.deepEqual(eventos, ['coletiva', 'local', 'thread', 'vinculo:ork-t1:local-1']);
    assert.deepEqual([r.thread, r.local, r.cobertura.permite], ['thread', 'reserva-vinculada', true]);
    assert.equal(lerOperacaoDaRedeEmpresa(raiz, r.operationId).estado, 'concluida');
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('falhas antes e depois de cada efeito compensam na ordem local e coletiva', () => {
  for (const falha of ['coletiva', 'local', 'thread'] as const) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `rm089-saga-${falha}-`)), eventos: string[] = [];
    try {
      assert.throws(() => executarSagaDaThread({ ...base(raiz, portas(eventos, falha)), criarThread: () => {
        eventos.push('thread'); if (falha === 'thread') throw new Error(falha); return { threadId: 'ork-t1', valor: 'thread' }; } }),
      new RegExp(falha));
      if (falha === 'local') assert.deepEqual(eventos, ['coletiva', 'local', 'solta-coletiva:coletiva-1']);
      if (falha === 'thread') assert.deepEqual(eventos, ['coletiva', 'local', 'thread', 'solta-local:local-1', 'solta-coletiva:coletiva-1']);
    } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
  }
});

test('falha no vínculo deixa reconciliação pendente e reparo repetido é idempotente', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'rm089-saga-vinculo-')), eventos: string[] = [];
  try {
    let erro: ErroDeReconciliacao | null = null;
    try { executarSagaDaThread({ ...base(raiz, portas(eventos, 'vinculo')),
      criarThread: () => ({ threadId: 'ork-t1', valor: 'thread' }) }); } catch (e) { erro = e as ErroDeReconciliacao; }
    assert.ok(erro instanceof ErroDeReconciliacao);
    assert.match(erro.message, /ork roadmap reconciliar RM-089 --operacao op-1234567890abcdef/);
    const reparo = portas([], undefined);
    const a = reconciliarOperacaoDaRedeEmpresa(raiz, erro.operacao.operationId, reparo);
    const b = reconciliarOperacaoDaRedeEmpresa(raiz, erro.operacao.operationId, reparo);
    assert.deepEqual([a.estado, b.estado], ['compensada', 'compensada']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('compensação nunca remove renovação posterior e mantém a pendência', () => {
  for (const falha of ['compensa-local', 'compensa-coletiva'] as const) {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), `rm089-saga-${falha}-`)), eventos: string[] = [];
    try {
      let erro: ErroDeReconciliacao | null = null;
      try { executarSagaDaThread({ ...base(raiz, portas(eventos, falha)), criarThread: () => { throw new Error('thread'); } }); }
      catch (e) { erro = e as ErroDeReconciliacao; }
      assert.ok(erro instanceof ErroDeReconciliacao);
      assert.equal(erro.operacao.estado, 'reconciliacao-pendente');
      assert.equal(falha === 'compensa-local' ? erro.operacao.localFingerprint : erro.operacao.coletivaFingerprint,
        falha === 'compensa-local' ? 'local-1' : 'coletiva-1');
    } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
  }
});

test('reserva sem thread ainda compensa o coletivo quando a RM-047 recusa', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'rm089-reserva-')), eventos: string[] = [];
  try {
    const p = portas(eventos, 'local');
    assert.throws(() => executarReservaCoordenada(base(raiz, p)), /local/);
    assert.deepEqual(eventos, ['coletiva', 'local', 'solta-coletiva:coletiva-1']);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
