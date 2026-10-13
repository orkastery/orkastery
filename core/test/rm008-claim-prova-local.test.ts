/**
 * RM-008 (B8): a licao `claims.failed` ("rode o comando da claim antes de registra-la") vira a policy
 * opt-in `claim_sem_prova_local`. Sem ela, o `ork claims add` nao roda nada. Declarada em `warn`, o
 * registro roda o comando uma vez no prazo do verify: o que reprova ou estoura grava `policy_warn` e a
 * claim entra do mesmo jeito. Nada para.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { adicionarClaim, lerClaims } from '../src/claims';
import { lerLedger } from '../src/ledger';
import { NOME_MANIFESTO } from '../src/manifest';
import { avaliarPolicies, policiesDesconhecidas, policyDeProvaLocal } from '../src/policies';
import { dirThread, novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

function declarar(dir: string, policy: string | null, timeoutMs?: number): void {
  const arquivo = path.join(dir, NOME_MANIFESTO);
  let yaml = fs.readFileSync(arquivo, 'utf8');
  if (policy) {
    assert.match(yaml, /^policies:\n/m, 'o manifesto do init tem o bloco policies');
    yaml = yaml.replace(/^policies:\n/m, `policies:\n  ${policy}\n`);
  }
  if (timeoutMs !== undefined) {
    assert.match(yaml, /^verify:\n/m, 'o manifesto do init tem o bloco verify');
    yaml = yaml.replace(/^verify:\n/m, `verify:\n  timeout_ms: ${timeoutMs}\n`);
  }
  fs.writeFileSync(arquivo, yaml);
}

function avisosDoLedger(dir: string, thread: string) {
  return lerLedger(dirThread(dir, thread)).filter((e) => e.tipo === 'policy_warn');
}

test('RM-008 B8: sem a policy, claims add nao roda o comando da claim', () => {
  const p = projetoTemporario('rm008-b8-sem-policy');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sem policy', modo: 'auto' });
    const marca = path.join(p.dir, 'rodou');
    const c = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'o comando nao roda no registro',
      verificar: [`touch ${marca} && false`] });
    assert.equal(fs.existsSync(marca), false, 'nenhum comando rodou');
    assert.equal(c.avisosDePolicy, undefined);
    assert.deepEqual(avisosDoLedger(p.dir, thread.id), []);
  } finally { p.limpar(); }
});

test('RM-008 B8: com warn, comando que falha grava policy_warn e a claim entra', () => {
  const p = projetoTemporario('rm008-b8-falha');
  try {
    declarar(p.dir, 'claim_sem_prova_local: warn');
    const { thread } = novaThread(p.carregado, { nome: 'falha', modo: 'auto' });
    const c = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'o README diz ola',
      verificar: ['grep -q ola README.md'] });
    assert.deepEqual(c.avisosDePolicy?.map((v) => [v.policy, v.severidade, v.motivo]),
      [['claim_sem_prova_local', 'warn', 'claims.failed']]);
    assert.match(c.avisosDePolicy![0].correcao, new RegExp(`ork claims verificar ${thread.id} C1`));
    assert.deepEqual(lerClaims(p.dir, thread.id).map((x) => [x.id, x.estado]), [['C1', 'pendente']], 'a claim entrou');
    const avisos = avisosDoLedger(p.dir, thread.id);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].gate, 'claims.add');
    assert.equal(avisos[0].claim, 'C1');
    assert.equal(avisos[0].policy, 'claim_sem_prova_local');
    assert.equal(avisos[0].motivo, 'claims.failed');
  } finally { p.limpar(); }
});

test('RM-008 B8: com warn, comando que passa no diretorio da thread nao avisa', () => {
  const p = projetoTemporario('rm008-b8-passa');
  try {
    declarar(p.dir, 'claim_sem_prova_local: warn');
    const { thread } = novaThread(p.carregado, { nome: 'passa', modo: 'auto' });
    const c = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'o README existe',
      verificar: ['grep -q "projeto de teste" README.md'] });
    assert.equal(c.avisosDePolicy, undefined);
    assert.deepEqual(avisosDoLedger(p.dir, thread.id), []);
  } finally { p.limpar(); }
});

test('RM-008 B8: comando que estoura o prazo do verify vira aviso verify.timeout, sem travar o add', () => {
  const p = projetoTemporario('rm008-b8-prazo');
  try {
    declarar(p.dir, 'claim_sem_prova_local: warn', 1000);
    const { thread } = novaThread(p.carregado, { nome: 'prazo', modo: 'auto' });
    const inicio = Date.now();
    const c = adicionarClaim(p.dir, thread.id, { arquivo: 'README.md', alegacao: 'demora demais',
      verificar: ['sleep 30'] });
    assert.ok(Date.now() - inicio < 20_000, `o add voltou no prazo (${Date.now() - inicio} ms)`);
    assert.deepEqual(c.avisosDePolicy?.map((v) => v.motivo), ['verify.timeout']);
    assert.match(c.avisosDePolicy![0].detalhe, /estourou o prazo do verify \(1 s\)/);
    assert.equal(lerClaims(p.dir, thread.id).length, 1, 'a claim entrou');
    assert.equal(avisosDoLedger(p.dir, thread.id)[0].motivo, 'verify.timeout');
  } finally { p.limpar(); }
});

test('RM-008 B8: claims_failed e alias, block avisa como warn, off cala e a policy e conhecida', () => {
  const p = projetoTemporario('rm008-b8-alias');
  try {
    const m = p.carregado.manifesto;
    const falha = { claim: 'C1', comando: 'false', code: 1, estourou: false, prazoMs: 1000 };
    m.policies = { ...m.policies, claim_sem_prova_local: 'warn', claims_failed: 'block' };
    assert.deepEqual(policiesDesconhecidas(m), []);
    assert.equal(policyDeProvaLocal(m), 'claim_sem_prova_local');
    const v = avaliarPolicies(m, { gate: 'claims.add', threadId: 'ork-x', provaLocalReprovada: falha });
    assert.deepEqual(v.map((x) => [x.policy, x.severidade]), [['claim_sem_prova_local', 'warn']], 'um aviso so');
    m.policies = { ...m.policies, claim_sem_prova_local: 'off', claims_failed: 'block' };
    assert.equal(policyDeProvaLocal(m), 'claims_failed');
    assert.deepEqual(avaliarPolicies(m, { gate: 'claims.add', threadId: 'ork-x', provaLocalReprovada: falha })
      .map((x) => [x.policy, x.severidade]), [['claims_failed', 'warn']], 'block nunca para o registro');
    m.policies = { ...m.policies, claims_failed: 'off' };
    assert.equal(policyDeProvaLocal(m), null);
    assert.deepEqual(avaliarPolicies(m, { gate: 'claims.add', threadId: 'ork-x', provaLocalReprovada: falha }), []);
    // Em outro gate, a policy nao avalia.
    m.policies = { ...m.policies, claim_sem_prova_local: 'warn' };
    assert.deepEqual(avaliarPolicies(m, { gate: 'ship', threadId: 'ork-x', provaLocalReprovada: falha }), []);
  } finally { p.limpar(); }
});

test('RM-008 B8: o manifesto deste repositorio nao declara a policy (a decisao e do dono)', () => {
  const yaml = fs.readFileSync(path.join(__dirname, '..', '..', '..', NOME_MANIFESTO), 'utf8');
  assert.doesNotMatch(yaml, /^\s+(claim_sem_prova_local|claims_failed):/m);
});
