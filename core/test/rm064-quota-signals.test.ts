import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { parseFalhaDeConta } from '../src/adapters/claude-bg';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { ingerirEvento } from '../src/session-events';
import { lerLedger } from '../src/ledger';

const AGORA = Date.parse('2026-10-14T15:00:00.000Z');
const SESSAO = '11111111-2222-3333-4444-555555555555';

test('RM-064 T1: falas de limite e código estruturado viram esgotamento da conta', () => {
  const casos = [
    ["You've hit your weekly limit · resets Oct 18, 10pm (America/Sao_Paulo)", '2026-10-19T01:00:00.000Z'],
    ["You've hit your session limit · resets 6:20pm (America/Sao_Paulo)", '2026-10-14T21:20:00.000Z'],
    ["You've hit your individual spend limit", null],
    ['Seu limite de uso foi atingido', null],
    ['{"error":{"code":"usage_limit_exceeded"}}', null],
  ] as const;
  for (const [fala, resetEm] of casos) {
    const falha = parseFalhaDeConta(fala, AGORA);
    assert.equal(falha?.motivo, 'runtime.quota-exhausted', fala);
    assert.equal(falha?.resetEm, resetEm, fala);
  }
});

test('RM-064 T1: Stop e Notification levam só o sinal tipado ao ledger', () => {
  const p = projetoTemporario('rm064-hook-quota');
  try {
    const t = novaThread(p.carregado, { nome: 'quota-hook', modo: 'auto' }).thread;
    const inicio = '2026-10-14T14:00:00.000Z';
    t.sessoes.push({ slug: t.slug, fase: 'CHECK', bloco: 'full', sessionId: SESSAO, runtime: 'claude-bg',
      despachadaEm: inicio, promptPath: 'prompt.md', promptSha256: 'a'.repeat(64), verificada: true });
    gravarThread(p.dir, t);
    const observado = '2026-10-14T15:01:00.000Z';
    for (const tipo of ['notification', 'stop'] as const) {
      ingerirEvento(p.dir, SESSAO, tipo, JSON.stringify({ observedAt: observado,
        eventId: `quota-${tipo}`, ...(tipo === 'notification' ? { notificationType: 'idle_prompt' } : {}),
        accountFailure: 'runtime.quota-exhausted' }), AGORA + 120_000);
    }
    const eventos = lerLedger(dirThread(p.dir, t.id)).filter((e) => e.motivo === 'runtime.quota-exhausted');
    assert.equal(eventos.length, 2);
    assert.ok(eventos.every((e) => (e.falhaDeConta as { motivo: string }).motivo === 'runtime.quota-exhausted'));
    assert.doesNotMatch(JSON.stringify(eventos), /individual spend|Seu limite|weekly limit/i);
  } finally { p.limpar(); }
});

test('RM-064 T1: hook real reduz as quatro falas a um código e não vaza a mensagem', () => {
  const modulo = path.resolve(__dirname, '../../../adapters/claude-code/hooks/quota-signal.js');
  const accountFailure = (require(modulo) as { accountFailure: (h: Record<string, unknown>) => string | null }).accountFailure;
  for (const message of ["You've hit your weekly limit · resets Oct 18, 10pm (America/Sao_Paulo)",
    "You've hit your session limit · resets 6:20pm (America/Sao_Paulo)", "You've hit your individual spend limit",
    'Seu limite de uso foi atingido']) {
    assert.equal(accountFailure({ message }), 'runtime.quota-exhausted');
  }
  assert.equal(accountFailure({ message: 'permission needed' }), null);
});
