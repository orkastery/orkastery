import { strict as assert } from 'node:assert';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import {
  CONTRATO_ATESTACAO_POLITICA_EXCECAO,
  dadosAssinadosDaAtestacaoDaPolitica,
  verificarAtestacaoDaPoliticaDeExcecao,
  type CorpoDaAtestacaoDaPoliticaDeExcecao,
  type ReferenciaDaAtestacao,
} from '../src/rede-empresa-atestacao';
import {
  CONTRATO_AUTORIZACAO_EXCECAO_RECIBO,
  CONTRATO_POLITICA_EXCECAO_RECIBO,
  hashDaPoliticaDeExcecao,
  resolverExcecaoDeRecibo,
  type AutorizacaoDaExcecaoDeRecibo,
  type FonteProtegidaDaExcecao,
  type PoliticaDaExcecaoDeRecibo,
  type RegistroProtegidoDaExcecao,
} from '../src/excecao-recibo';
import {
  CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO,
  CONTRATO_PORTA_NOTIFICACAO_EXCECAO,
  CONTRATO_RECIBO_NOTIFICACAO_EXCECAO,
  hashDoReciboDeNotificacao,
  notificarExcecaoDeRecibo,
  type CapacidadeDaNotificacaoDaExcecao,
  type PedidoDeNotificacaoDaExcecao,
  type PortaGeridaDaNotificacaoDaExcecao,
  type ReciboDeNotificacaoDaExcecao,
  type ResultadoDaEntregaDaExcecao,
} from '../src/excecao-notificacao';
import { excecaoDeReciboDoTextoDoManifesto } from '../src/manifest';

const NOW = '2026-11-13T03:00:00.000Z';
const ISSUED = '2026-11-13T02:00:00.000Z';
const EXPIRES = '2026-11-13T04:00:00.000Z';
const REVIEW = '2026-11-14T04:00:00.000Z';
const AUTH_REF = 'auth_0123456789abcdefghijkl';
const HEAD = 'a'.repeat(40);
const TARGET_HEAD = 'b'.repeat(40);

type Fixture = ReturnType<typeof fixture>;

function fixture() {
  const notificationKeys = generateKeyPairSync('ed25519');
  const notificationPublicKey = createPublicKey(notificationKeys.privateKey)
    .export({ format: 'der', type: 'spki' }).toString('base64');
  const policy: PoliticaDaExcecaoDeRecibo = {
    schema: CONTRATO_POLITICA_EXCECAO_RECIBO,
    version: 'policy-2026-11',
    level: 'exigir',
    project: 'orkastery',
    target: 'main',
    recipientRef: 'responsible:release',
    maxValidityMs: 4 * 60 * 60 * 1000,
    notificationPort: { id: 'managed-core', issuerId: 'notifier', timeoutMs: 1000 },
    actors: [
      { principalRef: 'account:builder', actorId: 'actor:builder', authorityId: null, groups: ['group:builders'] },
      { principalRef: 'account:builder-alt', actorId: 'actor:builder', authorityId: null, groups: ['group:builders'] },
      { principalRef: 'service:builder', actorId: 'actor:builder', authorityId: null, groups: ['group:builders'] },
      { principalRef: 'token:builder', actorId: 'actor:builder', authorityId: null, groups: ['group:builders'] },
      { principalRef: 'alias:builder', actorId: 'actor:builder', authorityId: null, groups: ['group:builders'] },
      { principalRef: 'account:approver', actorId: 'actor:approver', authorityId: null, groups: ['group:approvers'] },
    ],
    issuers: [{ id: 'notifier', keyId: 'notifier-key', publicKey: notificationPublicKey }],
  };
  const policySha256 = hashDaPoliticaDeExcecao(policy);
  const authorization: AutorizacaoDaExcecaoDeRecibo = {
    schema: CONTRATO_AUTORIZACAO_EXCECAO_RECIBO,
    authorizationRef: AUTH_REF,
    justification: 'Correção urgente com recibo do check indisponível.',
    scope: ['ci.receipt', 'source-head'],
    waivedReceipt: 'ork.ci-recibo-runner/v1',
    project: 'orkastery',
    source: 'ork/feature',
    target: 'main',
    head: HEAD,
    operation: 'ci.run',
    policyVersion: policy.version,
    policySha256,
    builderPrincipal: 'account:builder',
    authorizerPrincipal: 'account:approver',
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    reviewRef: 'review:incident-42',
    reviewResponsibleRef: 'responsible:release',
    reviewDueAt: REVIEW,
    decision: 'waived',
    reason: 'Continuidade do serviço com revisão posterior obrigatória.',
  };
  const record: RegistroProtegidoDaExcecao = {
    authorization,
    policy,
    policySha256,
    origin: { type: 'protected-target', target: 'main', targetHead: TARGET_HEAD, protected: true },
  };
  const source: FonteProtegidaDaExcecao = { read: (ref) => ref === AUTH_REF ? record : null };
  return { notificationKeys, policy, authorization, record, source };
}

function withRecord(base: Fixture, policy: PoliticaDaExcecaoDeRecibo,
  authorization: AutorizacaoDaExcecaoDeRecibo = base.authorization,
  origin: RegistroProtegidoDaExcecao['origin'] = base.record.origin): FonteProtegidaDaExcecao {
  const policySha256 = hashDaPoliticaDeExcecao(policy);
  const auth = { ...authorization, policyVersion: policy.version, policySha256 };
  return { read: () => ({ authorization: auth, policy, policySha256, origin }) };
}

function resolved(f: Fixture) {
  const result = resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, f.source, NOW);
  assert.equal(result.ok, true);
  return result;
}

function capability(f: Fixture): CapacidadeDaNotificacaoDaExcecao {
  return { schema: CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO, portId: f.policy.notificationPort.id,
    policySha256: hashDaPoliticaDeExcecao(f.policy), operation: 'notify-receipt-exception', expiresAt: EXPIRES, verified: true };
}

function receipt(request: PedidoDeNotificacaoDaExcecao, f: Fixture, options: {
  result?: ResultadoDaEntregaDaExcecao; patch?: Record<string, unknown>; forge?: boolean;
} = {}): ReciboDeNotificacaoDaExcecao {
  const result = options.result ?? 'delivered';
  const base = {
    schema: CONTRATO_RECIBO_NOTIFICACAO_EXCECAO,
    receiptId: 'receipt-1',
    requestId: request.requestId,
    requestHash: request.requestHash,
    idempotencyKey: request.idempotencyKey,
    issuer: { id: 'notifier', keyId: 'notifier-key' },
    authorizationRef: request.authorizationRef,
    policyVersion: request.policyVersion,
    policySha256: request.policySha256,
    project: request.project,
    source: request.source,
    target: request.target,
    head: request.head,
    operation: request.operation,
    recipientRef: request.recipientRef,
    requestedAt: request.requestedAt,
    attemptedAt: NOW,
    issuedAt: NOW,
    deliveredAt: result === 'delivered' ? NOW : null,
    result,
    providerProofRef: 'provider:message-1',
    providerProofHash: 'c'.repeat(64),
    ...options.patch,
  } as Omit<ReciboDeNotificacaoDaExcecao, 'receiptHash' | 'signature'>;
  const receiptHash = hashDoReciboDeNotificacao(base);
  const signature = sign(null, Buffer.from(options.forge ? 'forged' : receiptHash, 'utf8'),
    f.notificationKeys.privateKey).toString('base64');
  return { ...base, receiptHash, signature };
}

function port(f: Fixture, factory: (request: PedidoDeNotificacaoDaExcecao) => unknown): PortaGeridaDaNotificacaoDaExcecao {
  return { schema: CONTRATO_PORTA_NOTIFICACAO_EXCECAO, id: f.policy.notificationPort.id,
    issuerId: f.policy.notificationPort.issuerId, independent: true, send: factory };
}

test('objeto canônico usa somente autorização opaca, policy protegida e identidades redigidas', () => {
  const f = fixture(), result = resolved(f);
  if (!result.ok) return;
  assert.equal(result.exception.notification.state, 'pending');
  assert.equal(result.exception.policyOrigin.type, 'protected-target');
  assert.match(result.exception.builder.principalHash, /^[a-f0-9]{64}$/);
  assert.notEqual(result.exception.builder.identityHash, result.exception.authorizer.identityHash);
  const serialized = JSON.stringify(result.exception);
  for (const secret of ['account:builder', 'account:approver', 'actor:builder', 'actor:approver']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('payload do builder não escolhe principal, ator, serviço, token, alias, grupos, policy ou destinatário', () => {
  const f = fixture();
  for (const injected of [
    { actorId: 'actor:approver' }, { principal: 'account:approver' }, { service: 'service:builder' },
    { token: 'token:builder' }, { alias: 'alias:builder' }, { groups: ['group:approvers'] },
    { policy: f.policy }, { recipientRef: 'attacker' },
  ]) {
    const r = resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF, ...injected }, f.source, NOW);
    assert.deepEqual(r, { ok: false, code: 'ci.excecao.input-invalido' });
  }
});

test('conta alternativa, serviço, token e alias do builder não viram autorizador independente', () => {
  const f = fixture();
  for (const authorizerPrincipal of ['account:builder-alt', 'service:builder', 'token:builder', 'alias:builder']) {
    const source = withRecord(f, f.policy, { ...f.authorization, authorizerPrincipal });
    assert.deepEqual(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, source, NOW),
      { ok: false, code: 'ci.excecao.autoautorizacao' });
  }
  const overlap: PoliticaDaExcecaoDeRecibo = { ...f.policy, actors: f.policy.actors.map((a) =>
    a.principalRef === 'account:approver' ? { ...a, groups: ['group:approvers', 'group:builders'] } : a) };
  assert.deepEqual(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, withRecord(f, overlap), NOW),
    { ok: false, code: 'ci.excecao.grupo-sobreposto' });
});

test('origem, hash, versão, campo, prazo e revisão ausentes ou divergentes falham fechado', () => {
  const f = fixture();
  const builderPolicy = { ...f.policy, recipientRef: 'attacker' };
  const hashDivergent: FonteProtegidaDaExcecao = { read: () => ({ ...f.record, policy: builderPolicy }) };
  assert.equal(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, hashDivergent, NOW).ok, false);
  const unprotected = { type: 'protected-target', target: 'main', targetHead: TARGET_HEAD, protected: false } as never;
  assert.deepEqual(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF },
    withRecord(f, f.policy, f.authorization, unprotected), NOW), { ok: false, code: 'ci.excecao.origem-nao-comprovada' });
  const expired = withRecord(f, f.policy, { ...f.authorization, expiresAt: '2026-11-13T02:30:00.000Z' });
  assert.equal(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, expired, NOW).ok, false);
  const overflow = withRecord(f, f.policy, { ...f.authorization, expiresAt: '2026-11-14T03:00:00.000Z' });
  assert.deepEqual(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, overflow, NOW),
    { ok: false, code: 'ci.excecao.prazo-excedido' });
  const missing = { ...f.authorization } as Record<string, unknown>; delete missing.reviewRef;
  const source: FonteProtegidaDaExcecao = { read: () => ({ ...f.record, authorization: missing as never }) };
  assert.deepEqual(resolverExcecaoDeRecibo({ threadId: 'ork-fixture', authorizationRef: AUTH_REF }, source, NOW),
    { ok: false, code: 'ci.excecao.autorizacao-invalida' });
});

test('manifesto da target expõe a policy separada do manifesto alterável pelo builder', () => {
  const yaml = (recipient: string) => `project:\n  name: fixture\n  abbrev: fix\n  stage: nascente\nci:\n  excecao_recibo:\n    schema: ${CONTRATO_POLITICA_EXCECAO_RECIBO}\n    recipientRef: ${recipient}\n`;
  assert.equal(excecaoDeReciboDoTextoDoManifesto(yaml('responsible:release'))?.recipientRef, 'responsible:release');
  assert.equal(excecaoDeReciboDoTextoDoManifesto(yaml('attacker'))?.recipientRef, 'attacker');
  const trusted = excecaoDeReciboDoTextoDoManifesto(yaml('responsible:release'));
  assert.notEqual(trusted?.recipientRef, excecaoDeReciboDoTextoDoManifesto(yaml('attacker'))?.recipientRef);
});

test('autoridade organizacional exige autoria, hash e assinatura Ed25519 independentes', () => {
  const f = fixture(), keys = generateKeyPairSync('ed25519');
  const publicKey = createPublicKey(keys.privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const unsigned: Omit<CorpoDaAtestacaoDaPoliticaDeExcecao, 'signature'> = {
    contrato: CONTRATO_ATESTACAO_POLITICA_EXCECAO,
    authorizationRef: AUTH_REF,
    project: 'orkastery', target: 'main', targetHead: TARGET_HEAD,
    policyVersion: f.policy.version, policySha256: hashDaPoliticaDeExcecao(f.policy),
    authorityId: 'authority:release', authorityAccountId: 42, keyId: 'authority-key',
    issuedAt: ISSUED, expiresAt: EXPIRES, nonce: 'nonce-0123456789abcdef',
  };
  const body = { ...unsigned, signature: sign(null, Buffer.from(JSON.stringify(dadosAssinadosDaAtestacaoDaPolitica(unsigned))),
    keys.privateKey).toString('base64') };
  const text = JSON.stringify(body), ref: ReferenciaDaAtestacao = { forja: 'github', id: 7,
    endpoint: 'repos/org/repo/issues/comments/7', sha256: createHash('sha256').update(text).digest('hex') };
  const artifact = { id: 7, authorId: 42, body: text, createdAt: ISSUED, updatedAt: ISSUED };
  const expected = { authorizationRef: AUTH_REF, project: 'orkastery', target: 'main', targetHead: TARGET_HEAD,
    policyVersion: f.policy.version, policySha256: hashDaPoliticaDeExcecao(f.policy), authorityId: 'authority:release',
    authorityAccountId: 42, keyId: 'authority-key', publicKey, agora: NOW, timeoutMs: 1000 };
  assert.equal(verificarAtestacaoDaPoliticaDeExcecao({ ler: () => artifact }, ref, expected), true);
  assert.equal(verificarAtestacaoDaPoliticaDeExcecao({ ler: () => ({ ...artifact, authorId: 43 }) }, ref, expected), false);
  assert.equal(verificarAtestacaoDaPoliticaDeExcecao({ ler: () => ({ ...artifact, body: text.replace('main', 'other') }) }, ref, expected), false);
});

test('porta gerida entrega recibo assinado sem metadados do ledger e conclui a notificação', () => {
  const f = fixture(), r = resolved(f);
  if (!r.ok) return;
  const result = notificarExcecaoDeRecibo(r.exception, r.policy, 'ork-fixture',
    port(f, (request) => receipt(request, f)), capability(f), NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.exception.notification.state, 'delivered');
  assert.equal('ledgerEventId' in result.receipt, false);
  assert.equal('recordedAt' in result.receipt, false);
  assert.equal(result.receipt.requestHash, result.request.requestHash);
});

test('porta, capacidade, emissor, destinatário, assinatura e replay não comprovados falham fechado', () => {
  const f = fixture(), r = resolved(f);
  if (!r.ok) return;
  assert.equal(notificarExcecaoDeRecibo(r.exception, r.policy, 'ork-fixture', null, capability(f), NOW).ok, false);
  assert.deepEqual(notificarExcecaoDeRecibo(r.exception, r.policy, 'ork-fixture', port(f, (q) => receipt(q, f)), null, NOW),
    { ok: false, code: 'ci.excecao.capacidade-ausente', request:
      notificarExcecaoDeRecibo(r.exception, r.policy, 'ork-fixture', null, null, NOW).request });
  const cases: Array<[string, (q: PedidoDeNotificacaoDaExcecao) => unknown, string]> = [
    ['destinatário', (q) => receipt(q, f, { patch: { recipientRef: 'attacker' } }), 'ci.excecao.recibo-destinatario-divergente'],
    ['replay', (q) => receipt(q, f, { patch: { requestHash: 'd'.repeat(64) } }), 'ci.excecao.recibo-replay'],
    ['assinatura', (q) => receipt(q, f, { forge: true }), 'ci.excecao.recibo-assinatura-invalida'],
    ['ambíguo', (q) => receipt(q, f, { result: 'ambiguous' }), 'ci.excecao.notificacao-ambigua'],
    ['timeout', (q) => receipt(q, f, { result: 'timeout' }), 'ci.excecao.notificacao-timeout'],
    ['campo ledger', (q) => ({ ...receipt(q, f), ledgerEventId: 'forged' }), 'ci.excecao.recibo-invalido'],
  ];
  for (const [name, factory, code] of cases) {
    const result = notificarExcecaoDeRecibo(r.exception, r.policy, 'ork-fixture', port(f, factory), capability(f), NOW);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.code, code, name);
  }
});
