/** CLI real, callback simulada: não é homologação de host instalado. */
import { test, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { abrirPedidoGate } from '../src/hitl-gates';
import { nativeOfferSignature } from '../src/hitl-native-offer';
import { ofertaDoPedido } from '../src/hitl-presentation';
import { main } from '../src/index';

for (const host of ['hermes', 'openclaw'] as const) test(`GO-FIX4: oferta de pedido ${host} exige callback assinada, sem Telegram e sem efeito`, () => {
  const p = projetoTemporario('native-offer'), saved = { ...process.env }, cwd = process.cwd();
  const binding = { host, installationId: 'installation', connectionId: 'connection', sessionId: 'session',
    accountId: 'account', channelId: 'discord', conversationId: 'conversation', personId: 'human' };
  const key = `fixture-${host}-key-`.repeat(4), upper = host.toUpperCase(), other = host === 'hermes' ? 'openclaw' : 'hermes';
  try {
    process.env = { ...saved };
    for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_')) delete process.env[name];
    Object.assign(process.env, { [`ORK_HITL_NATIVE_KEY_${upper}`]: key, [`ORK_HITL_NATIVE_BINDING_${upper}`]: JSON.stringify(binding) });
    const t = novaThread(p.carregado, { nome: 'Oferta real', modo: 'classic' }).thread, dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id), before = lerLedger(dir);
    process.chdir(p.dir);
    const offer = { native: { ...binding, messageId: 'message' }, recebidoEm: new Date().toISOString(), prova: '' };
    offer.prova = nativeOfferSignature(t.id, q.id, offer, key);
    const cli = (value?: unknown) => {
      const fs = require('node:fs'), read = fs.readSync, bytes = Buffer.from(JSON.stringify(value ?? null));
      let offset = 0, output = '';
      const input = mock.method(fs, 'readSync', (fd: number, buffer: Buffer, start: number, length: number, position: number | null) => {
        if (fd !== 0) return read(fd, buffer, start, length, position);
        const count = Math.min(length, bytes.length - offset);
        bytes.copy(buffer, start, offset, offset + count); offset += count; return count;
      });
      const stdout = mock.method(console, 'log', (text: string) => { output = text; });
      try {
        assert.equal(main(['gate', 'context', t.id, q.id, ...(value === undefined ? [] : ['--native-offer-stdin'])]), 0);
        return JSON.parse(output);
      } finally { input.mock.restore(); stdout.mock.restore(); }
    };
    const status = (value: unknown) => cli(value).canais.find((c: any) => c.canal === host && c.transporte === 'native');
    const view = cli(offer);
    assert.equal(view.pedido.id, q.id); assert.match(view.apresentacao.mensagem, /Pergunta:/);
    assert.equal(status(offer).estado, 'disponivel');
    assert.ok(view.canais.filter((c: any) => c.transporte === 'telegram').every((c: any) => c.estado === 'indisponivel'));
    assert.equal(view.canais.find((c: any) => c.canal === other && c.transporte === 'native').estado, 'indisponivel');
    assert.ok(!cli().canais.some((c: any) => c.transporte === 'native' && c.estado === 'disponivel'));
    for (const value of [true, { callbackProved: true }, { ...offer, prova: '0'.repeat(64) },
      { ...offer, native: { ...offer.native, sessionId: 'other' } },
      { ...offer, prova: nativeOfferSignature(t.id, 'other-pedido', offer, key) }]) assert.equal(status(value).estado, 'indisponivel');
    const expired = { ...offer, recebidoEm: new Date(Date.now() - 61000).toISOString() };
    expired.prova = nativeOfferSignature(t.id, q.id, expired, key);
    assert.equal(status(expired).estado, 'indisponivel');
    process.env[`ORK_HITL_NATIVE_KEY_${other.toUpperCase()}`] = key;
    assert.equal(status(offer).estado, 'indisponivel');
    delete process.env[`ORK_HITL_NATIVE_KEY_${other.toUpperCase()}`];
    delete process.env[`ORK_HITL_NATIVE_BINDING_${upper}`];
    assert.equal(status(offer).estado, 'indisponivel');
    assert.deepEqual(lerLedger(dir), before);
  } finally { process.chdir(cwd); process.env = saved; p.limpar(); }
});

for (const host of ['hermes', 'openclaw'] as const) test(`GO-FIX7: oferta ${host} consulta reserva atual e não anuncia canal que o ingresso recusaria`, () => {
  const p = projetoTemporario('native-offer-reserva'), saved = { ...process.env }, cwd = process.cwd();
  const binding = { host, installationId: 'installation', connectionId: 'connection', sessionId: 'session',
    accountId: 'account', channelId: 'discord', conversationId: 'conversation', personId: 'human' };
  const key = `fixture-${host}-key-`.repeat(4), upper = host.toUpperCase();
  try {
    process.env = { ...saved };
    for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_')) delete process.env[name];
    Object.assign(process.env, { [`ORK_HITL_NATIVE_KEY_${upper}`]: key, [`ORK_HITL_NATIVE_BINDING_${upper}`]: JSON.stringify(binding) });
    const t = novaThread(p.carregado, { nome: 'Oferta reservada', modo: 'classic' }).thread, dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id);
    process.chdir(p.dir);
    const native = () => {
      const offer = { native: { ...binding, messageId: 'message' }, recebidoEm: new Date().toISOString(), prova: '' };
      offer.prova = nativeOfferSignature(t.id, q.id, offer, key);
      const fs = require('node:fs'), read = fs.readSync, bytes = Buffer.from(JSON.stringify(offer));
      let offset = 0, output = '';
      const input = mock.method(fs, 'readSync', (fd: number, buffer: Buffer, start: number, length: number, position: number | null) => {
        if (fd !== 0) return read(fd, buffer, start, length, position);
        const count = Math.min(length, bytes.length - offset);
        bytes.copy(buffer, start, offset, offset + count); offset += count; return count;
      });
      const stdout = mock.method(console, 'log', (text: string) => { output = text; });
      const before = lerLedger(dir);
      try { assert.equal(main(['gate', 'context', t.id, q.id, '--native-offer-stdin']), 0); }
      finally { input.mock.restore(); stdout.mock.restore(); }
      // Consulta de oferta é leitura: não seleciona, não libera e não grava nada.
      assert.deepEqual(lerLedger(dir), before);
      const canais = JSON.parse(output).canais;
      assert.ok(!canais.some((c: any) => c.canal !== host && c.transporte === 'native' && c.estado === 'disponivel'));
      return canais.find((c: any) => c.canal === host && c.transporte === 'native');
    };
    assert.deepEqual(native(), { canal: host, transporte: 'native', estado: 'disponivel', motivo: '' });
    const requestId = randomUUID();
    registrar(dir, t.id, 'hitl_channel_selected', { pedidoId: q.id, canal: 'claude-code', transporte: 'mcp-local',
      connectionId: 'mcp-connection', requestId, reserva: 'ork.hitl-dialogue/v1' });
    assert.deepEqual(native(), { canal: host, transporte: 'native', estado: 'indisponivel', motivo: 'hitl.channel.in-use' });
    // Release devolve o pedido ao ingresso native; seleção de outro pedido não reserva este.
    registrar(dir, t.id, 'hitl_channel_released', { pedidoId: q.id, requestId, reason: 'dialogue-ended-without-effect' });
    registrar(dir, t.id, 'hitl_channel_selected', { pedidoId: 'outro-pedido', canal: 'codex', transporte: 'mcp-local',
      connectionId: 'mcp-connection', requestId: randomUUID(), reserva: 'ork.hitl-dialogue/v1' });
    assert.deepEqual(native(), { canal: host, transporte: 'native', estado: 'disponivel', motivo: '' });
    registrar(dir, t.id, 'session_answer_sending', { pedidoId: q.id, mensagem: 'native:envio' });
    assert.deepEqual(native(), { canal: host, transporte: 'native', estado: 'indisponivel', motivo: 'hitl.channel.delivery-uncertain' });
    registrar(dir, t.id, 'human_gate', { pedidoId: q.id, estado: 'aprovado' });
    assert.deepEqual(native(), { canal: host, transporte: 'native', estado: 'indisponivel', motivo: 'hitl.channel.answered' });
    // Sem prova de callback o motivo continua o da capacidade, nunca a reserva.
    delete process.env[`ORK_HITL_NATIVE_BINDING_${upper}`];
    assert.deepEqual(native(), { canal: host, transporte: 'native', estado: 'indisponivel', motivo: 'hitl.native.capability-unavailable' });
  } finally { process.chdir(cwd); process.env = saved; p.limpar(); }
});

test('GO-FIX7: ofertaDoPedido sem ledger do pedido não anuncia native disponível', () => {
  const p = projetoTemporario('native-offer-sem-ledger'), outro = projetoTemporario('native-offer-outra-raiz'), saved = { ...process.env };
  const binding = { host: 'hermes' as const, installationId: 'installation', connectionId: 'connection', sessionId: 'session',
    accountId: 'account', channelId: 'discord', conversationId: 'conversation', personId: 'human' };
  const key = 'fixture-hermes-key-'.repeat(4);
  try {
    process.env = { ...saved };
    for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_')) delete process.env[name];
    Object.assign(process.env, { ORK_HITL_NATIVE_KEY_HERMES: key, ORK_HITL_NATIVE_BINDING_HERMES: JSON.stringify(binding) });
    const t = novaThread(p.carregado, { nome: 'Oferta sem ledger', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id);
    const callback = { native: { ...binding, messageId: 'message' }, recebidoEm: new Date().toISOString(), prova: '' };
    callback.prova = nativeOfferSignature(t.id, q.id, callback, key);
    const hermes = (raiz: string) => ofertaDoPedido(q, [], { callback, raiz }).find(c => c.canal === 'hermes' && c.transporte === 'native');
    const unverified = { canal: 'hermes', transporte: 'native', estado: 'indisponivel', motivo: 'hitl.channel.unverified' };
    assert.equal(hermes(p.dir)?.estado, 'disponivel');
    // Raiz sem o pedido não prova ausência de reserva.
    assert.deepEqual(hermes(outro.dir), unverified);
    const file = path.join(dirThread(p.dir, t.id), 'ledger.jsonl'), guardado = file + '.fixture';
    fs.renameSync(file, guardado); fs.mkdirSync(file);
    try { assert.deepEqual(hermes(p.dir), unverified); }
    finally { fs.rmdirSync(file); fs.renameSync(guardado, file); }
    assert.equal(hermes(p.dir)?.estado, 'disponivel');
  } finally { process.env = saved; p.limpar(); outro.limpar(); }
});
