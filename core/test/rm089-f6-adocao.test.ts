import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adotar, ErroDeAdocao } from '../src/adocao';
import { auditarWorktree, sincronizarWorktree } from '../src/worktree';
import { exec } from '../src/util';
import { listarIds, novaThread } from '../src/thread';
import { projetoComOrigemAdotavel } from './rm089-f6-forja-simulada';

test('adoção preserva história, registra fotografia e retoma a mesma thread', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao');
  try {
    const r = adotar(p.carregado, { ref: p.origem, roadmap: 'RM-089', nome: 'Trabalho externo', modo: 'auto',
      perfilCheck: 'revisor-independente' });
    assert.equal(r.criada, true);
    assert.equal(r.estado, 'preparada');
    assert.equal(r.thread.faseAtual, 'GO');
    assert.equal(r.thread.adocao?.sourceHead, p.sourceHead);
    assert.deepEqual(r.thread.adocao?.oidsExclusivos, p.commitsDaOrigem);
    assert.equal(exec('git', ['rev-parse', 'HEAD'], r.thread.worktree!).stdout.trim(), p.sourceHead);
    for (const oid of p.commitsDaOrigem)
      assert.equal(exec('git', ['merge-base', '--is-ancestor', oid, 'HEAD'], r.thread.worktree!).ok, true);
    const audit = auditarWorktree(p.carregado, r.thread.id);
    assert.equal(audit.ok, true, audit.checks.map((c) => `${c.nome}:${c.detalhe}`).join(' | '));
    const sync = sincronizarWorktree(p.carregado, r.thread.id);
    assert.deepEqual([sync.ok, sync.causa], [false, 'adocao.preservacao']);
    assert.equal(exec('git', ['rev-parse', p.origem], p.dir).stdout.trim(), p.sourceHead);

    const repetida = adotar(p.carregado, { ref: p.origem, roadmap: 'RM-089', nome: 'Outro nome', modo: 'classic',
      perfilCheck: 'outro-revisor' });
    assert.equal(repetida.criada, false);
    assert.equal(repetida.thread.id, r.thread.id);
  } finally { p.limpar(); }
});

test('história separada e referência inválida falham antes de criar estado', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-adocao-negativos');
  try {
    assert.throws(() => adotar(p.carregado, { ref: '../segredo', roadmap: 'RM-089', nome: 'x', modo: 'auto',
      perfilCheck: 'revisor' }), (e: ErroDeAdocao) => e.codigo === 'adocao.ref-invalida');
    exec('git', ['checkout', '--orphan', 'historia-separada'], p.dir);
    exec('git', ['rm', '-rf', '.'], p.dir);
    exec('git', ['commit', '--allow-empty', '-m', 'raiz separada'], p.dir);
    exec('git', ['switch', '-q', 'main'], p.dir);
    assert.throws(() => adotar(p.carregado, { ref: 'historia-separada', roadmap: 'RM-089', nome: 'x', modo: 'auto',
      perfilCheck: 'revisor' }), (e: ErroDeAdocao) => e.codigo === 'adocao.historia-separada');
  } finally { p.limpar(); }
});

test('origem ou base móvel falham antes da thread durável e a reentrada remota preserva o HEAD', () => {
  for (const movida of ['origem', 'base'] as const) {
    const p = projetoComOrigemAdotavel(`rm089-f6-adocao-${movida}-movel`);
    try {
      const antes = listarIds(p.dir);
      assert.throws(() => adotar(p.carregado, { ref: p.origem, roadmap: 'RM-089', nome: 'x', modo: 'auto',
        perfilCheck: 'revisor' }, { coordenar: (criar) => {
          const ref = movida === 'origem' ? `refs/heads/${p.origem}` : 'refs/heads/main';
          const novo = movida === 'origem' ? 'main' : 'main^';
          assert.equal(exec('git', ['update-ref', ref, novo], p.dir).ok, true);
          return { thread: criar('op-movimento-123456'), operationId: 'op-movimento-123456' };
        } }), (e: ErroDeAdocao) => e.codigo === `adocao.${movida}-movel`);
      assert.deepEqual(listarIds(p.dir), antes);
    } finally { p.limpar(); }
  }

  const p = projetoComOrigemAdotavel('rm089-f6-adocao-remota');
  try {
    assert.equal(exec('git', ['remote', 'add', 'upstream', p.dir], p.dir).ok, true);
    assert.equal(exec('git', ['fetch', 'upstream', p.origem], p.dir).ok, true);
    const r = adotar(p.carregado, { ref: p.origem, remoto: 'upstream', roadmap: 'RM-089', nome: 'remota',
      modo: 'auto', perfilCheck: 'revisor' });
    assert.equal(r.thread.adocao?.sourceHead, p.sourceHead);
    assert.equal(r.thread.adocao?.remoto, 'upstream');
  } finally { p.limpar(); }
});

test('thread comum conserva audit e sync usuais', () => {
  const p = projetoComOrigemAdotavel('rm089-f6-thread-comum');
  try {
    const thread = novaThread(p.carregado, { nome: 'comum', modo: 'auto', criarWorktree: true,
      origemDaWorktree: 'flag' }).thread;
    assert.equal(thread.adocao, undefined);
    const audit = auditarWorktree(p.carregado, thread.id);
    assert.equal(audit.checks.some((check) => check.nome === 'historia-adotada'), false);
    assert.equal(audit.checks.some((check) => check.nome === 'base'), true);
    const sync = sincronizarWorktree(p.carregado, thread.id, { dryRun: true });
    assert.notEqual(sync.causa, 'adocao.preservacao');
  } finally { p.limpar(); }
});
