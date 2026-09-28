import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { detectarFasesOrfas } from '../src/liveness';
import { montarPulse } from '../src/pulse';
import { ingerirEvento } from '../src/session-events';
const hora = (min: number) => new Date(Date.UTC(2030, 0, 1, 10, min)).toISOString();

test('heartbeat ingerido recupera episódio correto; silêncio exato continua válido com PID vivo', () => {
  const p = projetoTemporario('sensor-heartbeat');
  try {
    const t = novaThread(p.carregado, { nome: 'heartbeat', modo: 'auto' }).thread;
    const sid = 'sessao-sensor';
    t.sessoes.push({ sessionId: sid, slug: t.slug, fase: 'GO', bloco: 'GO', runtime: 'codex', despachadaEm: hora(0),
      promptPath: '', promptSha256: '', verificada: true }); gravarThread(p.dir, t);
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_dispatch', { ts: hora(0), fase: 'GO', sessionId: sid, runtime: 'codex', pid: process.pid });
    // A escrita automática da I-06 exige allowlist explícita; o sensor da I-04 declara sua própria thread.
    const observar = (min: number) => detectarFasesOrfas(p.carregado, { quando: hora(min), registrar: true,
      escopo: [t.id], fontes: () => ({}), estados: new Map([[sid, 'working']]) });
    assert.equal(observar(9).length, 0); assert.equal(observar(10).length, 1);
    registrar(dir, t.id, 'runtime_heartbeat', { ts: hora(11), fase: 'GO', sessionId: 'outra' });
    assert.equal(observar(11).length, 1);
    ingerirEvento(p.dir, sid, 'heartbeat', '{}', Date.parse(hora(12)));
    assert.equal(observar(12).length, 0);
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'gate_passed' && e.motivo === 'runtime.silencio').length, 1);
    assert.equal(observar(22).length, 1); assert.equal(observar(23).length, 1);
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'gate_blocked' && e.motivo === 'runtime.silencio').length, 2);
  } finally { p.limpar(); }
});

test('resultado de fase anterior e heartbeat atrasado não encerram nem renovam fase ativa', () => {
  const p = projetoTemporario('sensor-fase');
  try {
    const t = novaThread(p.carregado, { nome: 'fase', modo: 'auto' }).thread, dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_dispatch', { ts: hora(0), fase: 'CHECK', sessionId: 'atual', runtime: 'codex' });
    registrar(dir, t.id, 'phase_result', { ts: hora(2), fase: 'GO', sessionId: 'atual', exitCode: 0 });
    registrar(dir, t.id, 'runtime_heartbeat', { ts: hora(9), fase: 'GO', sessionId: 'atual' });
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(10), fontes: () => ({}) }).length, 1);
    registrar(dir, t.id, 'gate_blocked', { ts: hora(11), fase: 'CHECK', sessionId: 'atual', motivo: 'human.pending' });
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(20), fontes: () => ({}) }).length, 0);
  } finally { p.limpar(); }
});

test('pulse continua coleta Codex quando Claude falha e explicita saúde parcial', () => {
  const p = projetoTemporario('sensor-pulse');
  try {
    const escopo: string[] = [];
    for (const runtime of ['codex', 'claude-bg']) {
      const t = novaThread(p.carregado, { nome: runtime, modo: 'auto' }).thread;
      escopo.push(t.id);
      registrar(dirThread(p.dir, t.id), t.id, 'phase_dispatch', { ts: hora(0), fase: 'GO', sessionId: `fixture-${runtime}`, runtime });
    }
    // Ambas as threads entram na allowlist: quem não vira órfã é o despacho Claude, não a falta de escopo.
    const r = montarPulse(p.carregado, { quando: hora(20), registrar: true, escopo,
      consulta: { ok: false, sessoes: [], detalhe: 'Claude indisponível na fixture' } });
    assert.equal(r.runtime.ok, false); assert.match(r.runtime.detalhe, /indisponível/);
    assert.equal(r.resumo.fasesOrfas, 1);
    // A coleta Codex sobrevive, mas a I-06 (D16) recusa retry automatico de silencio sem prova terminal
    // da mesma sessao: o item continua existindo, classificado como pendencia humana, nunca sumido.
    const itens = [...r.acoesAutomaticas, ...r.precisaDeHumanoAgora];
    const codex = itens.find(i => i.sessionId === 'fixture-codex' && i.motivo === 'runtime.silencio');
    assert.ok(codex, 'o silencio do Codex continua sendo coletado mesmo com Claude indisponivel');
    assert.ok(r.precisaDeHumanoAgora.includes(codex!), 'silencio sem prova terminal nao vira acao automatica');
    assert.ok(!r.acoesAutomaticas.includes(codex!));
    assert.ok(!itens.some(i => i.sessionId === 'fixture-claude-bg' && i.motivo === 'runtime.silencio'));
  } finally { p.limpar(); }
});
