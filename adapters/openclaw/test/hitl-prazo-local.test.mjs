// I-35: a oferta nativa do OpenClaw mostra o prazo no fuso do dono. Núcleo e canal SIMULADOS;
// a mensagem vem das funções reais do núcleo (core/dist) com o dono em America/Sao_Paulo.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { registerHitlIngress } from '../dist/hitl-ingress.js';

const require = createRequire(import.meta.url);
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const PRAZO = '2030-01-01T02:30:00.000Z', AGORA = '2030-01-01T01:30:00.000Z';

function pedido() {
  return { contrato: 'ork.hitl/v1', id: 'pedido-1', thread: 'ork-fixture', fase: 'GOAL', modo: 'ork',
    alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending', pergunta: 'Aprovar fixture SIMULADA?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Esperar', acao: 'esperar' }],
    recomendacao: 'Somente fixture', criadoEm: AGORA, prazo: PRAZO, acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' };
}

async function oferta(mensagem, prazoLocal) {
  const saved = { ...process.env };
  for (const name of Object.keys(process.env)) if (name.startsWith('ORK_HITL_')) delete process.env[name];
  const n = { host: 'openclaw', installationId: 'fixture', connectionId: 'connection', sessionId: 'session',
    accountId: 'account', channelId: 'discord', conversationId: '42', personId: '24' };
  process.env.ORK_HITL_NATIVE_BINDING_OPENCLAW = JSON.stringify(n);
  process.env.ORK_HITL_NATIVE_KEY_OPENCLAW = 'fixture-openclaw-key-'.repeat(3);
  process.env.ORK_HITL_ROOT = '/tmp';
  const view = { pedido: pedido(), contexto: 'a'.repeat(64), pedidoSha256: 'b'.repeat(64), apresentacao: { mensagem }, prazoLocal,
    canais: [{ canal: 'openclaw', transporte: 'native', estado: 'disponivel' }] };
  let handler;
  const stub = mock.method(require('node:child_process'), 'execFile', (_bin, argv, _options, cb) => {
    const stdin = new EventEmitter(); stdin.end = () => {};
    queueMicrotask(() => { assert.deepEqual(argv.slice(0, 2), ['gate', 'context']); cb(null, JSON.stringify(view)); });
    return { stdin };
  });
  syncBuiltinESMExports();
  try {
    registerHitlIngress({ on: (_name, callback) => { handler = callback; } }, 'fixture-cli');
    const event = { content: '/ork offer ork-fixture pedido-1', channel: 'discord', commandAuthorized: true, senderIsOwner: true,
      sessionKey: 'session', accountId: 'account', conversationId: '42', senderId: '24', messageId: 'msg', timestamp: Date.now() };
    const ctx = { channelId: 'discord', sessionKey: 'session', accountId: 'account', conversationId: '42', senderId: '24', messageId: 'msg' };
    const r = await handler(event, ctx);
    assert.equal(r.handled, true);
    return r.reply.text;
  } finally { stub.mock.restore(); syncBuiltinESMExports(); process.env = saved; }
}

test('núcleo atual: a oferta mostra o prazo local uma vez e nenhum ISO', async () => {
  const h = require('../../../core/dist/horario.js'), a = require('../../../core/dist/hitl-presentation.js');
  h.definirFusoDoDono('America/Sao_Paulo');
  try {
    const mensagem = a.apresentarDecisao(pedido(), AGORA).mensagem, prazoLocal = a.prazoLocalDoPedido(pedido(), AGORA);
    assert.equal(prazoLocal, '31/12 23:30 (horário de Brasília)');
    const texto = await oferta(mensagem, prazoLocal);
    assert.ok(texto.includes('• Prazo: 31/12 23:30 (horário de Brasília), em 1h00.'), texto);
    assert.equal(texto.split(prazoLocal).length - 1, 1);
    assert.doesNotMatch(texto, ISO);
    assert.match(texto, /Canal nativo OpenClaw disponível nesta conversa\.$/);
  } finally { h.definirFusoDoDono(undefined); }
});

test('núcleo de outra versão: o campo prazoLocal vai junto da mensagem', async () => {
  const texto = await oferta('Decisão pendente\n• Prazo: 2030-01-01T02:30:00.000Z.', '31/12/2029 23:30 (horário de Brasília)');
  assert.ok(texto.includes('\nPrazo (fuso do dono): 31/12/2029 23:30 (horário de Brasília)\n'), texto);
});
