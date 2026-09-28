import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { avaliarOcupacao } from '../src/ocupacao';
import { montarMonitor } from '../src/orquestracao';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { ORDEM_DOS_MODOS } from '../src/modos';
import { projetoTemporario } from './apoio';

test('Auto: phase_wait + handoff é impedimento; retomada não precisa de aprovação humana', () => {
  const p = projetoTemporario('higiene-auto');
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'higiene', modo: 'auto' });
    t.faseAtual = 'GO'; t.status = 'pausada'; gravarThread(p.dir, t);
    const dir = dirThread(p.dir, t.id);
    const avaliar = () => avaliarOcupacao(t, lerLedger(dir), { agora: new Date().toISOString(), estados: null, staleMin: 60 });
    assert.notEqual(avaliar().classe, 'pausa-humana');
    registrar(dir, t.id, 'phase_wait', { fase: 'GO', motivo: 'lease.busy', detalhe: 'fila path:core' });
    registrar(dir, t.id, 'handoff_exported', { fase: 'GO' });
    assert.equal(avaliar().motivo, 'lease.busy');
    const linha = montarMonitor(p.carregado, { semRuntime: true }).linhas.find(l => l.thread === t.id)!;
    assert.equal(linha.precisaDeHumano, false);
    assert.equal(linha.pausas.length, 0);
    assert.ok(linha.impedimentos.some(i => i.motivo === 'lease.busy'));
    registrar(dir, t.id, 'phase_dispatch', { fase: 'GO', sessionId: 'aaaaaaaa' });
    assert.notEqual(avaliar().classe, 'pausa-humana');
    assert.notEqual(avaliar().motivo, 'lease.busy');
    assert.ok(!lerLedger(dir).some(e => e.tipo === 'human_gate'));
  } finally { p.limpar(); }
});

test('fallback durável de status pausada sobrevive ao avanço de fase em modos não Auto', () => {
  const p = projetoTemporario('higiene-pausa-duravel');
  try {
    for (const modo of ORDEM_DOS_MODOS) {
      const t = novaThread(p.carregado, { nome: `duravel${modo}`, modo }).thread;
      t.status = 'pausada'; t.faseAtual = 'GO';
      t.blocos = [{ fases: ['GOAL', 'PLAN'], pausa: modo !== 'auto', pausaSobre: 'veredito', slugFases: 'f12' },
        { fases: ['GO', 'CHECK', 'SHIP', 'MASTER'], pausa: false, pausaSobre: '', slugFases: 'resto' }];
      gravarThread(p.dir, t);
      const oc = avaliarOcupacao(t, [], { agora: t.atualizadaEm, estados: null, staleMin: 60 });
      assert.equal(oc.classe, modo === 'auto' ? 'ociosa' : 'pausa-humana');
      const linha = montarMonitor(p.carregado, { semRuntime: true }).linhas.find(l => l.thread === t.id)!;
      assert.equal(linha.precisaDeHumano, modo !== 'auto');
      assert.equal(linha.pausas.length, modo === 'auto' ? 0 : 1);
    }
  } finally { p.limpar(); }
});

test('Auto conserva escalada explícita e outros modos conservam pausa prevista', () => {
  const p = projetoTemporario('higiene-escalada');
  try {
    for (const modo of ['auto', 'classic'] as const) {
      const { thread: t } = novaThread(p.carregado, { nome: `higiene${modo}`, modo });
      t.status = 'pausada'; gravarThread(p.dir, t);
      const dir = dirThread(p.dir, t.id);
      if (modo === 'auto') registrar(dir, t.id, 'gate_blocked', {
        fase: t.faseAtual, motivo: 'human.pending', gate: 'retry', detalhe: 'limite de tentativas esgotado',
      });
      assert.equal(avaliarOcupacao(t, lerLedger(dir), { agora: new Date().toISOString(), estados: null, staleMin: 60 }).classe, 'pausa-humana');
      const linha = montarMonitor(p.carregado, { semRuntime: true }).linhas.find(l => l.thread === t.id)!;
      assert.equal(linha.precisaDeHumano, true);
      assert.ok(linha.pausas.some(p => p.motivo === 'human.pending'));
    }
  } finally { p.limpar(); }
});
