/**
 * RM-063 (fatia 3, achado a): o `ork pulse` e o "O que precisa de voce" tratavam a sessao interativa do Claude Code em
 * estado `busy` (sem thread) como possivel parada: `busy` e `running` ficavam fora do catalogo de estados do radar, e a
 * sessao do bloco em `busy` nao ocupava a vaga nem segurava a pausa prevista. Tudo simulado: projeto temporario, a
 * consulta do runtime injetada ou o stub do `claude`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimeFalso } from './apoio';
import { classificarEstado } from '../src/hitl';
import { lerLedger, registrar } from '../src/ledger';
import { avaliarOcupacao } from '../src/ocupacao';
import { filaDoDono, montarPulse } from '../src/pulse';
import { montarStatusDoRoadmap, textoDoStatusDoRoadmap } from '../src/roadmap-status';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { estadoDeTrabalho } from '../src/types';
import { LeituraDoRuntime } from '../src/vida-da-thread';

const RESPONDEU: LeituraDoRuntime = { responderam: ['claude-bg', 'codex'], falhas: [], sessoes: [] };
const fecho = (texto: string): string[] => {
  const linhas = texto.split('\n');
  const p = linhas.indexOf('O que precisa de você'), s = linhas.indexOf('O que eu faço em seguida');
  return linhas.slice(p + 1, s).filter(Boolean);
};

test('achado a: busy e running sao trabalho no catalogo; estado desconhecido continua avisando', () => {
  for (const estado of ['working', 'busy', 'running']) {
    const r = classificarEstado(estado);
    assert.deepEqual([r.classe, r.precisaDeHumano], ['trabalhando', false], estado);
    assert.equal(estadoDeTrabalho(estado), true, estado);
  }
  assert.equal(estadoDeTrabalho('BUSY '), true, 'o estado cru vem do runtime: caixa e espaco nao mudam o fato');
  for (const estado of ['blocked', 'xyz', '']) assert.equal(classificarEstado(estado).precisaDeHumano, true, estado);
  assert.equal(estadoDeTrabalho('idle'), false);
});

test('achado a: a sessao interativa ocupada, sem thread, nao vira item do dono no pulse', () => {
  const p = projetoTemporario('rm063-f3-busy-pulse');
  try {
    const quando = '2026-10-13T12:00:00.000Z';
    const sessao = (n: number, campos: Record<string, unknown>) => ({ sessionId: `b0b0b0b0-0000-4000-8000-00000000000${n}`,
      id: `b0b0b0b${n}`, kind: 'interactive', cwd: p.dir, pid: process.pid, startedAt: Date.parse('2026-10-13T11:00:00Z'), ...campos });
    // A sessao bloqueada sem thread continua visivel: e o canario fx-hitl-latency (I-01), que le os logs dela.
    const sessoes = [sessao(1, { status: 'busy' }), sessao(2, { state: 'busy' }), sessao(3, { state: 'running' }),
      sessao(4, { state: 'xyz' })];
    const pulse = montarPulse(p.carregado, { fontes: () => ({}), quando, consulta: { ok: true, detalhe: '', sessoes } });
    const doDono = pulse.precisaDeHumanoAgora.map((i) => i.sessionId);
    for (const s of sessoes.slice(0, 3)) assert.ok(!doDono.includes(s.sessionId), `${s.sessionId} ocupada virou item do dono`);
    assert.ok(doDono.includes(sessoes[3].sessionId), 'o estado fora do catalogo deixou de avisar');
  } finally { p.limpar(); }
});

test('achado a: o "O que precisa de você" do roadmap nao lista a sessao interativa ocupada', (t) => {
  const p = projetoTemporario('rm063-f3-busy-status');
  const runtime = runtimeFalso('rm063-f3-busy-status');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  // O stub lista uma sessao sem thread, viva (pid deste processo), em `busy`: a sessao do dono trabalhando agora.
  fs.writeFileSync(path.join(runtime.dir, 'sessao'), 'c0c0c0c0-1111-4222-8333-444444444444');
  fs.writeFileSync(path.join(runtime.dir, 'cwd'), p.dir);
  runtime.estadoDaSessao('busy');
  runtime.statusDaSessao('busy');
  const quando = new Date().toISOString();
  const fila = filaDoDono(p.carregado, { quando });
  assert.equal(fila.lida, true, fila.detalhe ?? '');
  assert.deepEqual(fila.itens.map((i) => i.id), [], 'a sessao ocupada entrou na fila do dono');
  const s = montarStatusDoRoadmap(p.dir, { quando, runtime: () => RESPONDEU, fila: (q) => filaDoDono(p.carregado, { quando: q }) });
  assert.deepEqual(fecho(textoDoStatusDoRoadmap(s)), ['• Nada agora.']);
});

test('achado a: a sessao do bloco em busy ocupa a vaga como a working', () => {
  const p = projetoTemporario('rm063-f3-busy-vaga');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'vaga ocupada', modo: 'auto' });
    const sessionId = 'd0d0d0d0-1111-4222-8333-444444444444';
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_dispatch', { fase: 'GO', sessionId, runtime: 'claude-bg', pausaAoFim: false });
    const t = lerThread(p.dir, thread.id);
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    for (const estado of ['working', 'busy', 'running']) {
      const o = avaliarOcupacao(t, eventos, { agora: new Date().toISOString(), staleMin: 30, estados: new Map([[sessionId, estado]]) });
      assert.deepEqual([o.classe, o.ocupaVaga], ['ativa', true], estado);
    }
  } finally { p.limpar(); }
});
