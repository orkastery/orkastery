import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projetoTemporario } from './apoio';
import { dirThread, novaThread } from '../src/thread';
import { prazoDoPedido } from '../src/hitl-contract';
import { lerLedger, registrar } from '../src/ledger';
import { abrirPedidoGate, assinaturaDaResposta, contextoDoPedidoNativo, responderGate, RespostaHumana } from '../src/hitl-gates';
import { criarIngressoLocal, RespostaElicitation } from '../src/hitl-local';
import { conferirCanalSelecionado } from '../src/hitl-canais';
import { nativeMessage } from '../src/hitl-native';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

for (const transport of ['telegram', 'native'] as const) test(`${transport} autenticado assume após cancelamento MCP, nunca durante conflito ativo`, async () => {
  const p = projetoTemporario('channel-release'), old = { ...process.env };
  const t = novaThread(p.carregado, { nome: 'Troca autenticada', modo: 'classic' }).thread;
  const key = 'fixture-release-only-'.repeat(3);
  const binding = { host: 'hermes' as const, installationId: 'install', connectionId: 'connection',
    sessionId: 'session', accountId: 'account', channelId: 'discord', conversationId: 'chat', personId: '42' };
  Object.assign(process.env, { ORK_HITL_INGRESS_KEY_HERMES: key,
    ORK_HITL_NATIVE_KEY_HERMES: `native-${key}`, ORK_HITL_NATIVE_BINDING_HERMES: JSON.stringify(binding),
    ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' });
  let release!: (r: RespostaElicitation) => void;
  const ingress = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'mcp-fixture' },
    () => new Promise(resolve => { release = resolve; }));
  try {
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id), context = contextoDoPedidoNativo(p.dir, t.id, q.id);
    const native = { ...binding, messageId: 'message', context: context.contexto as string,
      pedidoSha256: context.pedidoSha256, expiresAt: prazoDoPedido(q)! };
    const answer: RespostaHumana = { origem: transport, canal: 'hermes', resposta: '1', prova: '',
      recebidoEm: new Date().toISOString(), por: transport === 'native' ? 'native:hermes:42' : 'telegram:42',
      mensagem: transport === 'native' ? nativeMessage(native) : 'telegram:-7:release',
      ...(transport === 'native' ? { native, conta: binding.accountId } : {}) };
    answer.prova = assinaturaDaResposta(t.id, q.id, answer, transport === 'native' ? `native-${key}` : key);
    const pending = ingress.solicitar(t.id, q.id);
    assert.throws(() => responderGate(p.dir, t.id, q.id, answer), /selection-mismatch/);
    release({ action: 'cancel' }); await pending;
    assert.throws(() => responderGate(p.dir, t.id, q.id, { ...answer, prova: '0'.repeat(64) }));
    const events = lerLedger(dirThread(p.dir, t.id));
    assert.ok(events.some(e => e.tipo === 'hitl_channel_released'));
    assert.ok(!events.some(e => e.tipo === 'human_gate'));
    assert.throws(() => conferirCanalSelecionado(events, q.id, 'codex', 'mcp-local', 'mcp-fixture',
      String(events.find(e => e.tipo === 'hitl_channel_selected')!.requestId)), /selection-mismatch/);
    assert.throws(() => conferirCanalSelecionado([...events, { tipo: 'session_answer_sending',
      thread: t.id, ts: new Date().toISOString(), pedidoId: q.id }], q.id, 'hermes', transport), /selection-mismatch/);
    assert.equal(responderGate(p.dir, t.id, q.id, answer).estado, 'aprovado');
    assert.equal(responderGate(p.dir, t.id, q.id, answer).repetida, true);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 1);
  } finally { ingress.fechar(); process.env = old; p.limpar(); }
});

test('MCP mantém reserva ativa entre conexões e callback encerrado perde a seleção', async () => {
  const p = projetoTemporario('channel-active');
  let answer!: (r: RespostaElicitation) => void;
  const a = criarIngressoLocal(p.dir, { host: 'codex', connectionId: 'first' }, () => new Promise(resolve => { answer = resolve; }));
  const b = criarIngressoLocal(p.dir, { host: 'claude-code', connectionId: 'second' }, async () => ({ action: 'cancel' }));
  try {
    const t = novaThread(p.carregado, { nome: 'Reserva ativa', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id), pending = a.solicitar(t.id, q.id);
    await assert.rejects(b.solicitar(t.id, q.id), /channel.in-use/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'hitl_channel_released').length, 0);
    a.fechar();
    await pending;
    assert.equal((await b.solicitar(t.id, q.id)).estado, 'pendente');
    answer({ action: 'accept', content: { opcao: '1' } });
    await Promise.resolve();
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'human_gate').length, 0);
  } finally { a.fechar(); b.fechar(); p.limpar(); }
});

for (const state of ['abandoned', 'sending', 'unproven'] as const) test(`MCP após crash: ${state}, recovery exige reserva liberada e ausência de envio`, async () => {
  const p = projetoTemporario('channel-crash');
  const ingress = criarIngressoLocal(p.dir, { host: 'claude-code', connectionId: 'replacement' }, async () => ({ action: 'accept', content: { opcao: '1' } }));
  try {
    const t = novaThread(p.carregado, { nome: 'Crash de MCP', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id);
    const child = spawnSync(process.execPath, ['-e', `require(process.argv[1]).criarIngressoLocal(process.argv[2],
      {host:'codex',connectionId:'abandoned'},()=>process.exit(19)).solicitar(process.argv[3],process.argv[4]);`,
      require.resolve('../src/hitl-local'), p.dir, t.id, q.id], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 19, child.stderr);
    const events = lerLedger(dirThread(p.dir, t.id)), selected = events.find(e => e.tipo === 'hitl_channel_selected')!;
    assert.ok(selected); assert.equal(events.some(e => e.tipo === 'hitl_channel_released'), false);
    const reservation = path.join(dirThread(p.dir, t.id), `.hitl-dialogue-${selected.requestId}.lock`), inode = fs.statSync(reservation).ino;
    if (state === 'sending') registrar(dirThread(p.dir, t.id), t.id, 'session_answer_sending', { pedidoId: q.id, envioId: 'uncertain' });
    if (state === 'unproven') fs.writeFileSync(reservation, 'unknown owner');
    if (state === 'abandoned') {
      assert.equal((await ingress.solicitar(t.id, q.id)).estado, 'aprovado');
      const after = lerLedger(dirThread(p.dir, t.id));
      const release = after.find(e => e.tipo === 'hitl_channel_released');
      assert.equal(release?.reason, 'abandoned-dialogue'); assert.equal(release?.evidence, 'kernel-exclusive-lock');
      assert.equal(release?.requestId, selected.requestId);
      assert.equal(after.filter(e => e.tipo === 'human_gate').length, 1);
      assert.throws(() => conferirCanalSelecionado(after, q.id, 'codex', 'mcp-local', 'abandoned', String(selected.requestId)), /selection-mismatch/);
    } else {
      await assert.rejects(ingress.solicitar(t.id, q.id), state === 'sending' ? /delivery-uncertain/ : /recovery-unproven/);
      assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'hitl_channel_released'), false);
      assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'human_gate'), false);
    }
    assert.equal(fs.statSync(reservation).ino, inode);
  } finally { ingress.fechar(); p.limpar(); }
});
