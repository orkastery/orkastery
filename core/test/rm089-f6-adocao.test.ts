import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adotar, ErroDeAdocao } from '../src/adocao';
import { auditarWorktree, sincronizarWorktree } from '../src/worktree';
import { exec } from '../src/util';
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
