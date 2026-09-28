import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { novaThread, gravarThread, dirThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { ingerirEvento } from '../src/session-events';

const sid = '11111111-2222-3333-4444-555555555555';
const inicio = '2026-09-01T00:00:00.000Z';
const hora = (seg: number) => new Date(Date.parse(inicio) + seg * 1000).toISOString();
const agora = Date.parse(inicio) + 3600000;

function fixture() {
  const p = projetoTemporario('session-events-notificacao');
  const t = novaThread(p.carregado, { nome: 'notificacao', modo: 'auto' }).thread;
  t.sessoes.push({ slug: t.slug, fase: 'GOAL', bloco: 'GOAL', sessionId: sid, runtime: 'claude-bg',
    despachadaEm: inicio, promptPath: '', promptSha256: '', verificada: true });
  gravarThread(p.dir, t);
  return { ...p, t, eventos: () => lerLedger(dirThread(p.dir, t.id)) };
}
const payload = (seg: number, extra: Record<string, string> = {}) =>
  JSON.stringify({ observedAt: hora(seg), eventId: `evento-${seg}`, ...extra });

test('I-34: notificação grava notificationType sem mudar o tipo do evento', () => {
  const p = fixture();
  try {
    ingerirEvento(p.dir, sid, 'notification', payload(1, { notificationType: 'idle_prompt' }), agora);
    ingerirEvento(p.dir, sid, 'notification', payload(2, { notificationType: 'elicitation_dialog' }), agora);
    ingerirEvento(p.dir, sid, 'notification', payload(3), agora);
    const notas = p.eventos().filter(e => e.sensor === 'notification');
    assert.deepEqual(notas.map(e => e.tipo), ['runtime_event', 'runtime_event', 'runtime_event']);
    assert.deepEqual(notas.map(e => e.notificationType), ['idle_prompt', 'elicitation_dialog', undefined]);
    assert.ok(notas.every(e => e.runtime === 'claude-bg' && e.despachoEm === inicio && e.fase === 'GOAL'));
  } finally { p.limpar(); }
});

test('I-34: permission_prompt continua virando sessao_bloqueada e outros sensores não ganham notificationType', () => {
  const p = fixture();
  try {
    ingerirEvento(p.dir, sid, 'notification', payload(1, { notificationType: 'permission_prompt' }), agora);
    // O payload aceita o campo em qualquer sensor; o ledger só o grava no sensor notification.
    ingerirEvento(p.dir, sid, 'stop', payload(2, { notificationType: 'idle_prompt' }), agora);
    const bloqueio = p.eventos().find(e => e.tipo === 'sessao_bloqueada')!;
    assert.ok(bloqueio, 'bloqueio ausente');
    assert.equal(bloqueio.tipoDeHitl, 'permissao');
    assert.equal(bloqueio.notificationType, 'permission_prompt');
    const stop = p.eventos().find(e => e.tipo === 'runtime_stop')!;
    assert.ok(stop, 'stop ausente');
    assert.equal(stop.notificationType, undefined);
    assert.throws(() => ingerirEvento(p.dir, sid, 'notification', payload(3, { notificationType: 'outro' }), agora),
      /notificationType inválido/);
  } finally { p.limpar(); }
});
