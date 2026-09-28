import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { projetoTemporario } from './apoio';
import { dirThread, novaThread, gravarThread } from '../src/thread';
import { prazoDoPedido } from '../src/hitl-contract';
import { lerLedger, registrar } from '../src/ledger';
import { abrirPedidoGate, contextoHitl, responderGate } from '../src/hitl-gates';
import { hashPedidoLocal } from '../src/hitl-local-atestado';
import { NativeAnswer, nativeMessage, nativeSignature } from '../src/hitl-native';
import { responderSessao, ControleSessao } from '../src/hitl-sessions';
import { PedidoHitl } from '../src/hitl-contract';
import { aprovacaoHumanaProvada } from '../src/gates';
import { validarEvidenciaDoIngresso } from '../src/hitl-ingress-receipt';
import { ambienteDeAssinatura } from '../src/runtime-ambiente';
import { createHash } from 'node:crypto';

for (const answer of ['1', ' 1 ', '\t1\n']) test(`nativo SIMULADO: gate aceita opção ${JSON.stringify(answer)} e preserva recibo verificável`, () => {
  const p = projetoTemporario('native-delivery'), saved = { ...process.env };
  const binding = { host: 'openclaw' as const, installationId: 'fixture-install', connectionId: 'fixture-connection',
    sessionId: 'fixture-human-session', accountId: 'fixture-account', channelId: 'discord', conversationId: '42', personId: '24' };
  const key = 'fixture-native-openclaw-key-'.repeat(3);
  process.env.ORK_HITL_NATIVE_KEY_OPENCLAW = key;
  process.env.ORK_HITL_NATIVE_BINDING_OPENCLAW = JSON.stringify(binding);
  try {
    const t = novaThread(p.carregado, { nome: 'Native', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'SIMULADO' });
    const pedido = abrirPedidoGate(p.dir, t.id), native = { ...binding, messageId: 'msg-1',
      context: contextoHitl(p.dir, t.id), pedidoSha256: hashPedidoLocal(pedido), expiresAt: prazoDoPedido(pedido)! };
    const r: NativeAnswer = { origem: 'native', canal: 'openclaw', conta: binding.accountId,
      native, por: 'native:openclaw:24', mensagem: nativeMessage(native), recebidoEm: new Date().toISOString(), resposta: answer, prova: '' };
    r.prova = nativeSignature(t.id, pedido.id, r, key);
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, { ...r, prova: '0'.repeat(64) }), /untrusted/);
    const wrong = { ...r, native: { ...native, context: '0'.repeat(64) } };
    wrong.prova = nativeSignature(t.id, pedido.id, wrong, key);
    assert.throws(() => responderGate(p.dir, t.id, pedido.id, wrong), /request-mismatch/);
    assert.equal(responderGate(p.dir, t.id, pedido.id, r).estado, 'aprovado');
    assert.equal(responderGate(p.dir, t.id, pedido.id, r).repetida, true);
    const gates = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'human_gate');
    assert.equal(gates.length, 1); assert.equal(gates[0].contratoResposta, 'ork.hitl-native/v1');
    assert.equal(aprovacaoHumanaProvada(p.dir, t.id, gates[0]), true);
    const parent = { ...process.env };
    process.env = ambienteDeAssinatura(parent);
    assert.equal(aprovacaoHumanaProvada(p.dir, t.id, gates[0]), true);
    process.env = parent;
    assert.equal(aprovacaoHumanaProvada(p.dir, t.id, { ...gates[0], conta: 'other' }), false);
    assert.ok(!fs.readFileSync(dirThread(p.dir, t.id) + '/ledger.jsonl', 'utf8').includes(key));
    delete process.env.ORK_HITL_NATIVE_KEY_OPENCLAW;
    assert.equal(aprovacaoHumanaProvada(p.dir, t.id, gates[0]), false);
  } finally { process.env = saved; p.limpar(); }
});


for (const tipo of ['texto', 'opcao'] as const) test(`nativo SIMULADO: ${tipo} conserva intenção e reconcilia sem reenviar`, () => {
  const p = projetoTemporario('native-session'), saved = { ...process.env };
  const binding = { host: 'hermes' as const, installationId: 'fixture', connectionId: 'connection', sessionId: 'human-session',
    accountId: 'account', channelId: 'discord', conversationId: '42', personId: '24' };
  const key = 'fixture-native-hermes-key-'.repeat(3);
  process.env.ORK_HITL_NATIVE_KEY_HERMES = key;
  process.env.ORK_HITL_NATIVE_BINDING_HERMES = JSON.stringify(binding);
  try {
    const t = novaThread(p.carregado, { nome: 'Native session', modo: 'auto' }).thread;
    t.faseAtual = 'GO'; gravarThread(p.dir, t);
    const sid = '00000000-0000-4000-8000-000000000001';
    const sessao = { sessionId: sid, runtime: 'codex', cwd: p.dir, estado: 'blocked', instancia: 'fixture-instance', bloqueio: 'fixture-prompt' };
    const pedido: PedidoHitl = { contrato: 'ork.hitl/v1', id: '00000000-0000-4000-8000-000000000002', thread: t.id,
      fase: 'GO', modo: 'auto', alvo: { tipo: 'session', sessionId: sid, runtime: 'codex' }, motivo: 'hitl.pergunta',
      pergunta: 'Texto?', recomendacao: 'Responda literalmente',
      opcoes: tipo === 'texto' ? [] : [{ numero: 1, texto: 'Confirmar', acao: 'responder' }], criadoEm: new Date().toISOString(),
      prazo: new Date(Date.now() + 60000).toISOString(), acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo, maxCaracteres: 4096 }, profundidade: 'resumo' };
    const contexto = contextoHitl(p.dir, t.id);
    registrar(dirThread(p.dir, t.id), t.id, 'hitl_requested', { pedido, contexto, sessao });
    const native = { ...binding, messageId: 'msg', context: contexto, pedidoSha256: hashPedidoLocal(pedido), expiresAt: prazoDoPedido(pedido)! };
    const r: NativeAnswer = { origem: 'native', canal: 'hermes', conta: binding.accountId, native, por: 'native:hermes:24',
      mensagem: nativeMessage(native), recebidoEm: pedido.criadoEm, resposta: ' 1 ', prova: '' };
    r.prova = nativeSignature(t.id, pedido.id, r, key);
    let sent = 0, confirm = false;
    const ctl: ControleSessao = { consultar: () => ({ ok: true, sessoes: [sessao] }), parar: () => false,
      enviar: e => { sent++; assert.equal(e.resposta, r.resposta); }, confirmar: e => confirm ? { ...e, estado: 'recebida' } : null };
    assert.throws(() => responderSessao(p.dir, t.id, pedido.id, r, ctl), /não reenviar/);
    assert.equal(sent, 1); confirm = true;
    assert.equal(responderSessao(p.dir, t.id, pedido.id, r, ctl).repetida, true);
    assert.equal(sent, 1);
    const events = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'session_answered');
    assert.equal(events.length, 1);
    assert.equal(validarEvidenciaDoIngresso(p.dir, t.id, events[0]), true);
    const file = dirThread(p.dir, t.id) + '/hitl-ingress/' + String(events[0].evidencia).split('/').at(-1);
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(receipt.dados.respostaSha256, createHash('sha256').update(tipo === 'texto' ? ' 1 ' : '1').digest('hex'));
    process.env = ambienteDeAssinatura(process.env);
    assert.equal(validarEvidenciaDoIngresso(p.dir, t.id, events[0]), true);
  } finally { process.env = saved; p.limpar(); }
});
