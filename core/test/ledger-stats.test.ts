import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { coletarEstatisticas, parsePeriodo, registrarEstimativaPlano } from '../src/ledger-stats';

const hora = (n: number) => `2026-09-10T${String(n).padStart(2, '0')}:00:00.000Z`;

test('ledger stats agrega fatos no intervalo, elimina replay e explicita cobertura e tarifa', () => {
  const p = projetoTemporario('ledger-stats');
  try {
    const t = novaThread(p.carregado, { nome: 'telemetria', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_dispatch', { ts: hora(1), sessionId: 's1', runtime: 'codex', model: 'gpt-6-astra' });
    const resultado = { ts: hora(2), sessionId: 's1', sensorResultId: 'r1', runtime: 'codex', duracaoMs: 7_200_000,
      tokens: { disponivel: true, input: 1000, cachedInput: 200, output: 100, total: 1100 } };
    registrar(dir, t.id, 'phase_result', resultado);
    registrar(dir, t.id, 'phase_result', resultado); // replay do sensor não duplica a métrica
    registrar(dir, t.id, 'phase_result', { ts: hora(3), sessionId: 's2', sensorResultId: 'r2', runtime: 'claude-bg' });
    registrar(dir, t.id, 'ship_done', { ts: hora(4) });
    registrar(dir, t.id, 'gate_blocked', { ts: hora(5), motivo: 'claims.failed' });

    const r = coletarEstatisticas(p.dir, { desde: hora(0), ate: hora(6), thread: t.id });
    assert.equal(r.sessoes.concluidas, 2);
    assert.equal(r.execucao.horas, 2);
    assert.deepEqual(r.tokens, { input: 1000, cachedInput: 200, uncachedInput: 800, output: 100, total: 1100, cobertura: { medidas: 1, semMedida: 1 } });
    assert.equal(r.custoReferencia.valor, 0.0132);
    assert.equal(r.throughput.ships, 1);
    assert.deepEqual(r.riscosPreventivos.porMotivo, { 'claims.failed': 1 });
    assert.equal(r.periodo.intervalo, '[desde,ate)');
  } finally { p.limpar(); }
});

test('espera humana é pareada e recortada; filtro de runtime usa o despacho', () => {
  const p = projetoTemporario('ledger-wait');
  try {
    const t = novaThread(p.carregado, { nome: 'espera', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'gate_blocked', { ts: hora(1), fase: 'GO', pedidoId: 'p1', motivo: 'human.pending' });
    registrar(dir, t.id, 'human_gate', { ts: hora(3), fase: 'GO', pedidoId: 'p1', estado: 'aprovado' });
    registrar(dir, t.id, 'gate_blocked', { ts: hora(4), fase: 'SHIP', pedidoId: 'p2', motivo: 'human.pending' });
    registrar(dir, t.id, 'phase_dispatch', { ts: hora(1), sessionId: 's1', runtime: 'codex' });
    registrar(dir, t.id, 'phase_result', { ts: hora(2), sessionId: 's1', sensorResultId: 'r1', duracaoMs: 1 });
    registrar(dir, t.id, 'phase_dispatch', { ts: hora(1), sessionId: 's2', runtime: 'claude-bg' });
    registrar(dir, t.id, 'phase_result', { ts: hora(2), sessionId: 's2', sensorResultId: 'r2', duracaoMs: 1 });
    const r = coletarEstatisticas(p.dir, { desde: hora(2), ate: hora(5), thread: t.id, runtime: 'codex' });
    assert.equal(r.esperaHumana.milissegundos, 2 * 3_600_000); // p1: 2→3; p2: 4→5
    assert.deepEqual({ fechadas: r.esperaHumana.fechadas, abertas: r.esperaHumana.abertas }, { fechadas: 1, abertas: 1 });
    assert.equal(r.sessoes.concluidas, 1);
  } finally { p.limpar(); }
});

test('estimativa PLAN exige proveniência e CLI entrega JSON real', () => {
  const p = projetoTemporario('ledger-estimate');
  try {
    const t = novaThread(p.carregado, { nome: 'estimativa', modo: 'auto' }).thread;
    assert.throws(() => registrarEstimativaPlano(p.dir, t.id, { semIaHoras: 0, iaSemOrkHoras: 2, por: 'm', metodo: 'tarefas', premissas: 'escopo' }), /hours-positive/);
    registrarEstimativaPlano(p.dir, t.id, { semIaHoras: 40, iaSemOrkHoras: 18, por: 'maestro', metodo: 'tarefas', premissas: 'escopo fechado' });
    assert.equal(lerLedger(dirThread(p.dir, t.id)).at(-1)?.tipo, 'plan_estimate');

    const cli = path.resolve(__dirname, '../../dist/index.js');
    const r = spawnSync(process.execPath, [cli, 'ledger', 'stats', '--desde', '7d', '--thread', t.id, '--json'], { cwd: p.dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).schema, 'ork.ledger-stats/v1');
  } finally { p.limpar(); }
});

test('parsePeriodo aceita duração e recusa período inválido', () => {
  assert.equal(parsePeriodo('24h', Date.UTC(2026, 8, 10)), Date.UTC(2026, 8, 9));
  assert.throws(() => parsePeriodo('semana'));
});
