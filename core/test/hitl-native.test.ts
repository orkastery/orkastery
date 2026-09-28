import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { NativeAnswer, NativeBinding, authenticateNative, nativeSignature, nativeMessage } from '../src/hitl-native';
import { ofertaNativa } from '../src/hitl-canais';

test('ingresso nativo SIMULADO vincula identidade, pedido e conteúdo; não aceita texto/modelo', () => {
  const binding: NativeBinding = { host: 'hermes', installationId: 'fixture-install', connectionId: 'fixture-connection',
    sessionId: 'fixture-session', accountId: 'fixture-account', channelId: 'discord', conversationId: '42', personId: '24' };
  const env = { ORK_HITL_NATIVE_KEY_HERMES: 'fixture-only-'.repeat(4), ORK_HITL_NATIVE_BINDING_HERMES: JSON.stringify(binding) };
  const native = { ...binding, messageId: 'message', context: 'a'.repeat(64), pedidoSha256: 'b'.repeat(64), expiresAt: '2030-01-01T00:01:00.000Z' };
  const answer: NativeAnswer = { origem: 'native', canal: 'hermes', conta: binding.accountId, native,
    por: 'native:hermes:24', mensagem: nativeMessage(native), recebidoEm: '2030-01-01T00:00:00.000Z', resposta: '1', prova: '' };
  answer.prova = nativeSignature('ork-fixture', 'pedido', answer, env.ORK_HITL_NATIVE_KEY_HERMES);
  authenticateNative('ork-fixture', 'pedido', answer, answer.recebidoEm, env);
  for (const key of Object.keys(binding)) assert.throws(() => authenticateNative('ork-fixture', 'pedido',
    { ...answer, native: { ...native, [key]: 'other' } }, answer.recebidoEm, env));
  assert.throws(() => authenticateNative('ork-other', 'pedido', answer, answer.recebidoEm, env));
  assert.throws(() => authenticateNative('ork-fixture', 'other', answer, answer.recebidoEm, env));
  assert.throws(() => authenticateNative('ork-fixture', 'pedido', { ...answer, resposta: '2' }, answer.recebidoEm, env));
  assert.throws(() => authenticateNative('ork-fixture', 'pedido', answer, '2030-01-01T00:02:00.000Z', env));
  assert.equal(ofertaNativa('hermes', false, env).estado, 'indisponivel');
  assert.equal(ofertaNativa('hermes', true, {}).estado, 'indisponivel');
  assert.equal(ofertaNativa('hermes', true, env).estado, 'disponivel');
});
