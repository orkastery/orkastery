/**
 * RM-008 (base-avancou): o MASTER sem `--classe` junta `base-avancou` quando a branch trouxe a base.
 *
 * Em 03/10/2026, 29 das 35 entregas trouxeram a `origin/main` para dentro da branch antes do merge
 * (a `ork-rm053network`, 16 vezes), e nenhuma fechou com `base-avancou`: a classe fixa nunca era
 * inferida, e o `ork licoes` nao via a sincronizacao como custo.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { commitar, projetoTemporario } from './apoio';
import { registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { aceitarPorOmissao, lerMasterLog, registrarMaster, sincronizacoesComABase } from '../src/master';
import { dirThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

type Projeto = ReturnType<typeof projetoTemporario>;

function git(p: Projeto, ...args: string[]): string {
  const r = exec('git', args, p.dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Uma branch entregue por merge --no-ff na main; com `sincronizar`, a branch trouxe a main antes. */
function entregaNoGit(p: Projeto, branch: string, sincronizar: boolean): string {
  git(p, 'checkout', '-q', '-b', branch, 'main');
  commitar(p.dir, `${branch}.txt`, 'trabalho\n', `trabalho de ${branch}`);
  git(p, 'checkout', '-q', 'main');
  commitar(p.dir, `base-${branch}.txt`, 'base\n', `a base andou durante ${branch}`);
  if (sincronizar) {
    git(p, 'checkout', '-q', branch);
    git(p, 'merge', '-q', '--no-ff', '--no-edit', 'main');
    git(p, 'checkout', '-q', 'main');
  }
  git(p, 'merge', '-q', '--no-ff', '--no-edit', branch);
  return git(p, 'rev-parse', 'HEAD');
}

function threadEntregue(p: Projeto, nome: string, mergeSha: string, motivos: string[] = []): string {
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const dir = dirThread(p.dir, t.id);
  for (const motivo of motivos) registrar(dir, t.id, TIPOS_DE_EVENTO.gateBloqueado, { motivo, detalhe: 'teste' });
  registrar(dir, t.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: `ork/${nome}`, para: 'main', mergeSha, pushVerificado: true });
  return t.id;
}

test('RM-008 base-avancou: a entrega que trouxe a base fecha com base-avancou no aceite por omissao', () => {
  const p = projetoTemporario('rm008-base-avancou');
  try {
    const comSync = threadEntregue(p, 'comsync', entregaNoGit(p, 'com-sync', true));
    const semSync = threadEntregue(p, 'semsync', entregaNoGit(p, 'sem-sync', false));
    aceitarPorOmissao(p.dir, comSync);
    aceitarPorOmissao(p.dir, semSync);
    assert.deepEqual(lerMasterLog(p.dir, comSync)?.classesDeFalha, ['base-avancou']);
    assert.deepEqual(lerMasterLog(p.dir, semSync)?.classesDeFalha, ['sem-falha']);
  } finally { p.limpar(); }
});

test('RM-008 base-avancou: soma com a classe do gate, cita a sincronizacao no aviso e --classe vence', () => {
  const p = projetoTemporario('rm008-base-avancou-gate');
  try {
    const sha = entregaNoGit(p, 'gate', true);
    const comGate = threadEntregue(p, 'comgate', sha, ['claims.failed']);
    const r = registrarMaster(p.dir, comGate, { score: 4, justificativa: 'teste', por: 'julio' });
    assert.deepEqual(r.masterLog.classesDeFalha, ['base-avancou', 'processo']);
    assert.ok(r.avisos.some((a) => a.includes('base-avancou') && a.includes('1 vez')), r.avisos.join('\n'));

    const informada = threadEntregue(p, 'informada', sha);
    const r2 = registrarMaster(p.dir, informada, { score: 5, justificativa: 'teste', por: 'julio', classes: ['modelo'] });
    assert.deepEqual(r2.masterLog.classesDeFalha, ['modelo']);
  } finally { p.limpar(); }
});

test('RM-008 base-avancou: worktree_synced conta, e sha ausente ou sem segundo pai nao derruba', () => {
  const p = projetoTemporario('rm008-base-avancou-ledger');
  try {
    const t = novaThread(p.carregado, { nome: 'sync', modo: 'auto' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.worktreeSincronizada, {});
    const head = git(p, 'rev-parse', 'HEAD');
    assert.equal(sincronizacoesComABase(p.dir, [], ['f'.repeat(40), head, 'nao-e-sha']), 0);
    const eventos = [{ tipo: TIPOS_DE_EVENTO.worktreeSincronizada }] as unknown as Parameters<typeof sincronizacoesComABase>[1];
    assert.equal(sincronizacoesComABase(p.dir, eventos, []), 1);
  } finally { p.limpar(); }
});
