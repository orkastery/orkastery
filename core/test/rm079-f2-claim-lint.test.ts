import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analisarComando, regraFatalDeClaim } from '../src/claim-lint';
import { adicionarClaim, lerClaims } from '../src/claims';
import { adicionarClaimMcp } from '../src/mcp-artifacts';
import { exigirManifesto } from '../src/manifest';
import { novaThread } from '../src/thread';
import { projetoTemporario } from './apoio';

const regras = (comando: string, base = 'trunk') => analisarComando(comando, base).map((a) => a.regra);

test('RM-079 F2: a ref local configurada casa nos contextos de claim pedidos', () => {
  for (const comando of [
    'node core/dist/index.js privado varrer --base trunk',
    'git diff trunk -- core/src',
    'git log trunk..HEAD --oneline',
    'git merge-base trunk HEAD',
    'git diff "$(git merge-base trunk HEAD)" HEAD',
  ]) assert.ok(regras(comando).includes('ref-local-do-ramo-base'), comando);
  assert.equal(regraFatalDeClaim('ref-local-do-ramo-base'), true);
});

test('RM-079 F2: refs remotas e tokens apenas parecidos nao casam', () => {
  for (const comando of [
    'git diff origin/trunk -- core/src',
    'git diff refs/remotes/origin/trunk -- core/src',
    'grep -q trunk core/src/index.ts',
    'grep -q "git diff trunk" README.md',
    'node --test core/dist-test/test/trunk.ts',
    'node script.js --trunk-only',
  ]) assert.equal(regras(comando).includes('ref-local-do-ramo-base'), false, comando);
});

test('RM-079 F2: CLI e MCP recusam antes de persistir usando o ramo do manifesto', () => {
  const p = projetoTemporario('rm079-f2-lint-base');
  try {
    const manifesto = path.join(p.dir, 'orkastery.yaml');
    fs.writeFileSync(manifesto, fs.readFileSync(manifesto, 'utf8').replace('base_branch: "main"', 'base_branch: "trunk"'));
    const carregado = exigirManifesto(p.dir);
    const { thread } = novaThread(carregado, { nome: 'ref local', modo: 'auto' });
    const entrada = { arquivo: 'README.md', alegacao: 'prova portatil', verificar: ['git diff trunk -- README.md'] };
    for (const adicionar of [
      () => adicionarClaim(p.dir, thread.id, entrada),
      () => adicionarClaimMcp(p.dir, thread.id, entrada),
    ]) assert.throws(adicionar, (e: Error) => e.message.includes('claims.lint.ref-local-do-ramo-base') &&
      e.message.includes('origin/trunk'));
    assert.deepEqual(lerClaims(p.dir, thread.id), []);
  } finally { p.limpar(); }
});
