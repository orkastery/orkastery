/** RM-089 F6: recibo gerido, append auditável e projeção protegida no runner da F5. */
import { strict as assert } from 'node:assert';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { executarCiDaBranchComContexto, publicarAvisoDaPolitica } from '../src/ci';
import {
  CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO,
  CONTRATO_CAPACIDADE_RUNNER_EXCECAO,
  CONTRATO_PORTA_NOTIFICACAO_EXCECAO,
  CONTRATO_PROVA_NOTIFICACAO_EXCECAO,
  CONTRATO_RECIBO_NOTIFICACAO_EXCECAO,
  hashDoReciboDeNotificacao,
  registrarNotificacaoAuditavel,
  validarProvaDaExcecaoNoRunner,
  type CapacidadeDaNotificacaoDaExcecao,
  type CapacidadeDoRunnerParaExcecao,
  type PedidoDeNotificacaoDaExcecao,
  type PortaGeridaDaNotificacaoDaExcecao,
  type ProvaProtegidaDaNotificacao,
  type ReciboDeNotificacaoDaExcecao,
} from '../src/excecao-notificacao';
import {
  CONTRATO_AUTORIZACAO_EXCECAO_RECIBO,
  CONTRATO_EXCECAO_RECIBO,
  CONTRATO_POLITICA_EXCECAO_RECIBO,
  hashDaPoliticaDeExcecao,
  type AutorizacaoDaExcecaoDeRecibo,
  type ExcecaoDeRecibo,
  type FonteProtegidaDaExcecao,
  type PoliticaDaExcecaoDeRecibo,
} from '../src/excecao-recibo';
import type { ManifestoCarregado } from '../src/manifest';
import type { Manifesto } from '../src/types';

const NOW = '2026-11-13T03:00:00.000Z';
const ISSUED = '2026-11-13T02:00:00.000Z';
const EXPIRES = '2099-11-13T04:00:00.000Z';
const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const BRANCH = 'ork/ork-rm089f6fixture';
const LEDGER_DIR = path.join(os.tmpdir(), 'ork-rm089-f6-ledger-fixture');

function fixture() {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = createPublicKey(keys.privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const policy: PoliticaDaExcecaoDeRecibo = {
    schema: CONTRATO_POLITICA_EXCECAO_RECIBO,
    version: 'policy-current',
    level: 'exigir',
    project: 'fixture',
    target: 'main',
    recipientRef: 'responsible:release',
    maxValidityMs: null,
    notificationPort: { id: 'managed-core', issuerId: 'notifier', timeoutMs: 1000 },
    actors: [
      { principalRef: 'account:builder', actorId: 'actor:builder', authorityId: null, groups: ['group:builder'] },
      { principalRef: 'account:approver', actorId: 'actor:approver', authorityId: null, groups: ['group:approver'] },
    ],
    issuers: [{ id: 'notifier', keyId: 'notifier-key', publicKey }],
  };
  const policySha256 = hashDaPoliticaDeExcecao(policy);
  const exception: ExcecaoDeRecibo = {
    schema: CONTRATO_EXCECAO_RECIBO,
    exceptionId: 'exception-fixture',
    authorizationRef: 'auth_0123456789abcdefghijkl',
    justification: 'Recibo indisponível com autorização protegida.',
    scope: ['ci.receipt', 'source-head'],
    waivedReceipt: 'ork.ci-recibo-runner/v1',
    project: 'fixture', source: BRANCH, target: 'main', head: HEAD, operation: 'ci.run',
    policyVersion: policy.version, policySha256,
    policyOrigin: { type: 'protected-target', referenceHash: '1'.repeat(64) },
    builder: { principalHash: '2'.repeat(64), identityHash: '3'.repeat(64), groupsHash: '4'.repeat(64) },
    authorizer: { principalHash: '5'.repeat(64), identityHash: '6'.repeat(64), groupsHash: '7'.repeat(64) },
    responsibleRef: policy.recipientRef,
    issuedAt: ISSUED, expiresAt: EXPIRES,
    review: { reference: 'review:fixture', responsibleRef: policy.recipientRef,
      dueAt: '2099-11-14T04:00:00.000Z' },
    decision: 'waived', reason: 'Continuidade auditada.',
    notification: { state: 'pending', receiptId: null, receiptHash: null },
  };
  const authorization: AutorizacaoDaExcecaoDeRecibo = {
    schema: CONTRATO_AUTORIZACAO_EXCECAO_RECIBO,
    authorizationRef: exception.authorizationRef, justification: exception.justification,
    scope: [...exception.scope], waivedReceipt: exception.waivedReceipt,
    project: exception.project, source: exception.source, target: exception.target, head: exception.head,
    operation: exception.operation, policyVersion: policy.version, policySha256,
    builderPrincipal: 'account:builder', authorizerPrincipal: 'account:approver',
    issuedAt: ISSUED, expiresAt: EXPIRES, reviewRef: exception.review.reference,
    reviewResponsibleRef: exception.review.responsibleRef, reviewDueAt: exception.review.dueAt,
    decision: 'waived', reason: exception.reason,
  };
  const source: FonteProtegidaDaExcecao = { read: (ref) => ref === authorization.authorizationRef ? {
    authorization, policy, policySha256,
    origin: { type: 'protected-target', target: 'main', targetHead: OTHER_HEAD, protected: true },
  } : null };
  return { keys, policy, exception, source };
}

function notificationCapability(f: ReturnType<typeof fixture>): CapacidadeDaNotificacaoDaExcecao {
  return { schema: CONTRATO_CAPACIDADE_NOTIFICACAO_EXCECAO, portId: f.policy.notificationPort.id,
    policySha256: hashDaPoliticaDeExcecao(f.policy), operation: 'notify-receipt-exception',
    expiresAt: EXPIRES, verified: true };
}

function receipt(request: PedidoDeNotificacaoDaExcecao, f: ReturnType<typeof fixture>): ReciboDeNotificacaoDaExcecao {
  const base: Omit<ReciboDeNotificacaoDaExcecao, 'receiptHash' | 'signature'> = {
    schema: CONTRATO_RECIBO_NOTIFICACAO_EXCECAO,
    receiptId: 'receipt-fixture', requestId: request.requestId, requestHash: request.requestHash,
    idempotencyKey: request.idempotencyKey, issuer: { id: 'notifier', keyId: 'notifier-key' },
    authorizationRef: request.authorizationRef, policyVersion: request.policyVersion,
    policySha256: request.policySha256, project: request.project, source: request.source,
    target: request.target, head: request.head, operation: request.operation, recipientRef: request.recipientRef,
    requestedAt: request.requestedAt, attemptedAt: NOW, issuedAt: NOW, deliveredAt: NOW, result: 'delivered',
    providerProofRef: 'provider:message-fixture', providerProofHash: '8'.repeat(64),
  };
  const receiptHash = hashDoReciboDeNotificacao(base);
  return { ...base, receiptHash,
    signature: sign(null, Buffer.from(receiptHash, 'utf8'), f.keys.privateKey).toString('base64') };
}

function port(f: ReturnType<typeof fixture>, calls: string[]): PortaGeridaDaNotificacaoDaExcecao {
  return { schema: CONTRATO_PORTA_NOTIFICACAO_EXCECAO, id: f.policy.notificationPort.id,
    issuerId: f.policy.notificationPort.issuerId, independent: true,
    send: (request) => { calls.push('request-receipt'); return receipt(request, f); } };
}

function recorded() {
  const f = fixture(), calls: string[] = [];
  const result = registrarNotificacaoAuditavel(f.exception, f.policy, 'ork-rm089f6fixture', LEDGER_DIR,
    port(f, calls), notificationCapability(f), { agora: NOW, registro: {
      uuid: () => 'event-fixture', agora: () => NOW,
      append: (_arquivo, event) => { calls.push('append'); assert.equal(event.ledgerEventId, 'event-fixture'); },
    } });
  assert.equal(result.ok, true);
  calls.push('exposure');
  return { f, calls, result };
}

function proofOf(r: ReturnType<typeof recorded>['result'], policy: PoliticaDaExcecaoDeRecibo): ProvaProtegidaDaNotificacao {
  return { schema: CONTRATO_PROVA_NOTIFICACAO_EXCECAO, policy,
    request: r.request, receipt: r.receipt, event: r.event };
}

function runnerCapability(proof: ProvaProtegidaDaNotificacao): CapacidadeDoRunnerParaExcecao {
  return { schema: CONTRATO_CAPACIDADE_RUNNER_EXCECAO, capabilityId: 'runner-capability-fixture',
    policySha256: proof.request.policySha256, ledgerEventId: proof.event.ledgerEventId,
    recordedAt: proof.event.recordedAt, receiptHash: proof.receipt.receiptHash,
    project: proof.request.project, source: proof.request.source,
    target: proof.request.target, head: proof.request.head, operation: proof.request.operation,
    expiresAt: EXPIRES, verified: true };
}

test('ordem obrigatória só expõe o par depois do append durável', () => {
  const r = recorded();
  assert.deepEqual(r.calls, ['request-receipt', 'append', 'exposure']);
  assert.equal(r.result.event.ledgerEventId, 'event-fixture');
  assert.equal(r.result.event.recordedAt, NOW);
  assert.equal(r.result.event.receiptHash, r.result.receipt.receiptHash);
  assert.equal('ledgerEventId' in r.result.receipt, false);
  assert.equal('recordedAt' in r.result.receipt, false);
});

test('falha de append não expõe o par e retry pré-append reutiliza o mesmo recibo', () => {
  const f = fixture(), calls: string[] = [], managedPort = port(f, calls);
  assert.throws(() => registrarNotificacaoAuditavel(f.exception, f.policy, 'ork-rm089f6fixture', LEDGER_DIR,
    managedPort, notificationCapability(f), { agora: NOW, registro: { uuid: () => 'event-first', agora: () => NOW,
      append: () => { throw new Error('append-failed'); } } }), /append-failed/);
  const retried = registrarNotificacaoAuditavel(f.exception, f.policy, 'ork-rm089f6fixture', LEDGER_DIR,
    managedPort, notificationCapability(f), { agora: NOW, registro: { uuid: () => 'event-retry', agora: () => NOW,
      append: () => undefined } });
  assert.equal(retried.ok, true);
  assert.equal(calls.length, 2);
  if (retried.ok) assert.equal(retried.receipt.receiptHash, receipt(retried.request, f).receiptHash);
});

test('retry pós-append lê o par validado sem reenviar nem criar evento', () => {
  const first = recorded(), calls: string[] = [];
  const again = registrarNotificacaoAuditavel(first.f.exception, first.f.policy, 'ork-rm089f6fixture', LEDGER_DIR,
    port(first.f, calls), notificationCapability(first.f), { agora: NOW,
      lerExistente: () => ({ receipt: first.result.receipt, event: first.result.event }),
      registro: { append: () => { throw new Error('não anexa'); } } });
  assert.equal(again.ok, true);
  assert.deepEqual(calls, []);
  if (again.ok) assert.equal(again.event.ledgerEventId, first.result.event.ledgerEventId);
});

test('API padrão retoma do ledger real sem leitor injetado, reenvio ou segundo evento', () => {
  const f = fixture(), calls: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-f6-retry-ledger-'));
  try {
    const first = registrarNotificacaoAuditavel(f.exception, f.policy, 'ork-rm089f6fixture', dir,
      port(f, calls), notificationCapability(f), { agora: NOW });
    assert.equal(first.ok, true);
    const second = registrarNotificacaoAuditavel(f.exception, f.policy, 'ork-rm089f6fixture', dir,
      port(f, calls), notificationCapability(f), { agora: NOW });
    assert.equal(second.ok, true);
    assert.deepEqual(calls, ['request-receipt']);
    if (first.ok && second.ok) assert.equal(second.event.ledgerEventId, first.event.ledgerEventId);
    assert.equal(fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('par recusa recibo sem evento, troca de id/horário, hash errado e chave divergente', () => {
  const r = recorded();
  const proof = proofOf(r.result, r.f.policy), capability = runnerCapability(proof);
  const expected = { project: 'fixture', source: BRANCH, target: 'main', head: HEAD, operation: 'ci.run' };
  assert.equal(validarProvaDaExcecaoNoRunner(proof, capability, expected, NOW).ok, true);
  const events: unknown[] = [null,
    { ...proof.event, ledgerEventId: 'event-swapped' },
    { ...proof.event, recordedAt: '2026-11-13T03:01:00.000Z' },
    { ...proof.event, receiptHash: '9'.repeat(64) },
  ];
  for (const event of events) {
    assert.deepEqual(validarProvaDaExcecaoNoRunner({ ...proof, event }, capability, expected, NOW),
      { ok: false, code: 'ci.excecao.prova-invalida' });
  }
  const divergentPolicy = { ...r.f.policy, issuers: [{ ...r.f.policy.issuers[0], keyId: 'other-key' }] };
  assert.equal(validarProvaDaExcecaoNoRunner({ ...proof, policy: divergentPolicy }, capability, expected, NOW).ok, false);
});

function carregado(raiz: string): ManifestoCarregado {
  return { raiz, caminho: path.join(raiz, 'orkastery.yaml'), legado: false, bytes: 0, erros: [], avisos: [], manifesto: {
    project: { name: 'fixture', abbrev: 'fix', stage: 'nascente' },
    worktree: { base_branch: 'main', dir: '.worktrees', por_thread: true },
    verify: { timeout_ms: 1000, timeout_ms_por_comando: {} },
    ci: { required_for_ship: false, context: 'ork-verify', external_repositories: {}, politica_recibo: 'exigir' },
  } as unknown as Manifesto };
}

function ciFixture(extra: Record<string, unknown> = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-f6-ci-'));
  fs.mkdirSync(path.join(raiz, '.ork-ci'));
  fs.writeFileSync(path.join(raiz, '.ork-ci/ork-rm089f6fixture.json'), JSON.stringify({
    schema: 'ork.ci-bundle/v1', thread: 'ork-rm089f6fixture', branch: BRANCH, base: 'main',
    claims: [], commands: [], ...extra,
  }));
  return { raiz, close: () => fs.rmSync(raiz, { recursive: true, force: true }) };
}

test('F5 aceita só a prova protegida do HEAD exato e projeta JSON e relatório', () => {
  const r = recorded();
  const proof = proofOf(r.result, r.f.policy), capability = runnerCapability(proof), f = ciFixture();
  try {
    const output = executarCiDaBranchComContexto(carregado(f.raiz), BRANCH, {
      destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD, receitaConfiavel: null,
      excecao: { prova: proof, capacidade: capability },
    }) as { ok: boolean; exception?: { ledgerEventId: string }; policy: { exception?: string } };
    assert.equal(output.ok, true);
    assert.equal(output.policy.exception, 'applied');
    assert.equal(output.exception?.ledgerEventId, proof.event.ledgerEventId);
    const lines: string[] = [];
    publicarAvisoDaPolitica(output, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'org/repo' }, (line) => lines.push(line));
    assert.ok(lines.some((line) => line.startsWith('::notice') && line.includes(proof.event.ledgerEventId)));
  } finally { f.close(); }
});

test('operação pública resolve, notifica, anexa e entrega a exceção protegida ao runner', () => {
  const managed = fixture(), calls: string[] = [], f = ciFixture();
  const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-rm089-f6-public-flow-'));
  try {
    const output = executarCiDaBranchComContexto(carregado(f.raiz), BRANCH, {
      destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD, receitaConfiavel: null,
      excecaoGerida: {
        threadId: 'ork-rm089f6fixture', authorizationRef: managed.exception.authorizationRef,
        fonte: managed.source, porta: port(managed, calls), capacidadeNotificacao: notificationCapability(managed),
        dirThread: ledger,
        capacidadeRunner: (proof: ProvaProtegidaDaNotificacao) => runnerCapability(proof),
      },
    } as Parameters<typeof executarCiDaBranchComContexto>[2]) as {
      ok: boolean; exception?: { ledgerEventId: string }; policy: { exception?: string };
    };
    assert.equal(output.ok, true);
    assert.equal(output.policy.exception, 'applied');
    assert.match(output.exception?.ledgerEventId ?? '', /^[A-Za-z0-9-]+$/);
    assert.deepEqual(calls, ['request-receipt']);
    assert.equal(fs.readFileSync(path.join(ledger, 'ledger.jsonl'), 'utf8').trim().split('\n').length, 1);
  } finally { fs.rmSync(ledger, { recursive: true, force: true }); f.close(); }
});

test('runner sem capacidade, outro HEAD e projeções divergentes falham fechado', () => {
  const r = recorded();
  const proof = proofOf(r.result, r.f.policy), capability = runnerCapability(proof), f = ciFixture();
  try {
    const run = (head: string, prova: ProvaProtegidaDaNotificacao, cap: unknown) =>
      executarCiDaBranchComContexto(carregado(f.raiz), BRANCH, { destino: 'main', pullRequest: true,
        preflightEmpresa: null, head, receitaConfiavel: null, excecao: { prova, capacidade: cap } }) as
        { ok: boolean; error: { code: string } };
    assert.equal(run(HEAD, proof, null).error.code, 'ci.excecao.runner-capacidade-ausente');
    assert.equal(run(OTHER_HEAD, proof, capability).ok, false);
    assert.equal(run(HEAD, { ...proof, request: { ...proof.request, target: 'other' } }, capability).ok, false);
    assert.equal(run(HEAD, proof, { ...capability, policySha256: '9'.repeat(64) }).ok, false);
  } finally { f.close(); }
});

test('prova controlada pelo builder no bundle é recusada sem chegar ao runner', () => {
  const f = ciFixture({ exception: { forged: true } });
  try {
    const output = executarCiDaBranchComContexto(carregado(f.raiz), BRANCH,
      { destino: 'main', pullRequest: true, preflightEmpresa: null, head: HEAD, receitaConfiavel: null }) as
      { ok: boolean; error: { code: string } };
    assert.equal(output.ok, false);
    assert.equal(output.error.code, 'ci.recibo.invalido');
  } finally { f.close(); }
});
