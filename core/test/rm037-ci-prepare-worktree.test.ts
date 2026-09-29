/**
 * RM-037 (rm037defeito, defeito 6): `ork ci prepare <thread>` gravava o bundle em `.ork-ci/` da RAIZ do
 * projeto, e o condutor copiava o arquivo para a worktree e desfazia a sujeira na raiz a cada PR. O
 * `git ls-files` do diferimento tambem rodava na raiz e adiava claim de arquivo que so existe na branch.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { prepararBundleCi } from '../src/ci';
import { adicionarClaim } from '../src/claims';
import { lerThread, novaThread } from '../src/thread';
import { garantirWorktree } from '../src/worktree';

test('defeito 6: o bundle nasce na worktree da thread e a claim da branch nao e adiada', () => {
  const p = projetoTemporario('rm037-ci-worktree');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'bundle na worktree', modo: 'auto' });
    garantirWorktree(p.carregado, thread.id);
    const worktree = lerThread(p.dir, thread.id).worktree as string;
    assert.ok(worktree && fs.existsSync(worktree), 'a thread tem worktree');
    // O arquivo so existe na branch da thread: da raiz, o ls-files nao o acha.
    commitar(worktree, 'core/so-na-branch.txt', 'produto da thread\n', 'fatia da thread');
    adicionarClaim(p.dir, thread.id, { arquivo: 'core/so-na-branch.txt', alegacao: 'a fatia existe', verificar: ['test -f core/so-na-branch.txt'] });

    const arquivo = prepararBundleCi(p.carregado, thread.id);
    assert.equal(arquivo, path.join(worktree, '.ork-ci', 'bundle.json'));
    assert.equal(fs.existsSync(path.join(p.dir, '.ork-ci')), false, 'a raiz fica limpa');
    const bundle = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    assert.deepEqual(bundle.claims.map((c: { id: string }) => c.id), ['C1']);
    assert.deepEqual(bundle.deferredClaims, [], 'a claim da branch vai ao runner, nao e adiada');
  } finally { p.limpar(); }
});

test('defeito 6: thread sem worktree continua gravando na raiz', () => {
  const p = projetoTemporario('rm037-ci-sem-worktree');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sem worktree', modo: 'auto' });
    assert.equal(lerThread(p.dir, thread.id).worktree ?? null, null);
    assert.equal(prepararBundleCi(p.carregado, thread.id), path.join(p.dir, '.ork-ci', 'bundle.json'));
  } finally { p.limpar(); }
});
