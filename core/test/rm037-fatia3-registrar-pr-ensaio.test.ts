/**
 * RM-037 (fatia 3, defeito 6): `ork ship registrar-pr <thread> --dry-run` ignorava o `--dry-run` e gravava o
 * `ship_done` de verdade, com a fase levada a SHIP. O ensaio passa a fazer as mesmas conferencias (merge na
 * ponta remota, CI no head do PR, vinculo do PR externo) e para antes de gravar, nos tres caminhos: a thread,
 * `--repo --pr` e `--todas`. A outra metade do defeito (o `ci prepare` gravando na raiz) nao reproduz na 0.5.0:
 * o teste `rm037-ci-prepare-worktree` cobre desde o #28.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { commitar, projetoTemporario } from './apoio';
import { ExecutorGitHub, registrarEntregaExternaPorPr, registrarEntregasPorPr } from '../src/entrega-pr';
import { lerLedger } from '../src/ledger';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

const ORK = path.resolve(__dirname, '../../dist/index.js');

function git(dir: string, ...args: string[]): string {
  const r = exec('git', args, dir);
  assert.equal(r.ok, true, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Projeto com `origin`, uma thread e o merge `ship(<thread>)` dela ja na `origin/main`, como o GitHub deixa. */
function entregaPorPr(nome: string) {
  const p = projetoTemporario(nome, true);
  const t = novaThread(p.carregado, { nome: 'entrega por pr', modo: 'auto' }).thread;
  git(p.dir, 'checkout', '-q', '-b', `ork/${t.slug}`);
  commitar(p.dir, 'entrega.txt', 'entrega\n', 'entrega da thread');
  git(p.dir, 'checkout', '-q', 'main');
  git(p.dir, 'merge', '-q', '--no-ff', `ork/${t.slug}`, '-m', `ship(${t.id}): entrega por PR`);
  git(p.dir, 'push', '-q', 'origin', 'main');
  return { p, t, dir: dirThread(p.dir, t.id), merge: git(p.dir, 'rev-parse', 'HEAD') };
}

const shipDone = (dir: string) => lerLedger(dir).filter((e) => e.tipo === 'ship_done').length;
const ork = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [ORK, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ORK_FABRICA_PUBLICAR: '0' } });

test('defeito 6: registrar-pr --dry-run diz o que registraria e nao grava ship_done nem muda a fase', () => {
  const { p, t, dir, merge } = entregaPorPr('rm037-f3-ensaio');
  try {
    const faseAntes = lerThread(p.dir, t.id).faseAtual;
    const ensaio = ork(p.dir, 'ship', 'registrar-pr', t.id, '--dry-run');
    assert.equal(ensaio.status, 0, ensaio.stdout + ensaio.stderr);
    assert.match(ensaio.stdout, /^Ensaio \(--dry-run\): nada foi gravado\.$/m);
    assert.match(ensaio.stdout, new RegExp(`${t.id}\\s+registraria\\s+ensaio: registraria ship_done pelo merge ${merge.slice(0, 7)} do PR \\(nada gravado\\)`));
    assert.match(ensaio.stdout, /1 entrega\(s\) seria\(m\) registrada\(s\)\. Para gravar, rode o mesmo comando sem --dry-run\./);
    assert.equal(shipDone(dir), 0, 'o ensaio nao grava ship_done');
    assert.equal(lerThread(p.dir, t.id).faseAtual, faseAntes, 'nem leva a fase a SHIP');

    // Sem --dry-run, o registro de sempre.
    const real = ork(p.dir, 'ship', 'registrar-pr', t.id);
    assert.equal(real.status, 0, real.stdout + real.stderr);
    assert.match(real.stdout, /registrou/);
    assert.equal(shipDone(dir), 1);
    assert.equal(lerThread(p.dir, t.id).faseAtual, 'SHIP');
    // O ensaio depois do registro diz que ja esta registrada, sem gravar outro.
    assert.match(ork(p.dir, 'ship', 'registrar-pr', t.id, '--dry-run').stdout, /ja-registrada/);
    assert.equal(shipDone(dir), 1);
  } finally { p.limpar(); }
});

test('defeito 6: --todas --dry-run ensaia o lote inteiro sem gravar', () => {
  const { p, dir } = entregaPorPr('rm037-f3-ensaio-todas');
  try {
    const r = registrarEntregasPorPr(p.carregado, { dryRun: true });
    assert.deepEqual(r.map((x) => x.acao), ['registraria']);
    assert.equal(shipDone(dir), 0);
  } finally { p.limpar(); }
});

test('defeito 6: --repo --pr --dry-run confere o PR externo pela API e nao grava', () => {
  const p = projetoTemporario('rm037-f3-ensaio-externo');
  try {
    p.carregado.manifesto.ci.external_repositories = { 'orkastery/orkastery.com': '' };
    const t = novaThread(p.carregado, { nome: 'sites', modo: 'auto' }).thread;
    const MERGE = 'e29d05e7a3c3e94129bb7dcc6ca66e292e27466a', HEAD_PR = '14b264e40c04b0bbb1ce36338208197f6ddec6ff', PONTA = 'a'.repeat(40);
    const respostas: Record<string, unknown> = {
      'repos/orkastery/orkastery.com': { default_branch: 'main' },
      'repos/orkastery/orkastery.com/pulls/6': { merged: true, merge_commit_sha: MERGE, title: 'Homes', body: `Thread ${t.id}.`,
        base: { ref: 'main' }, head: { sha: HEAD_PR, ref: 'site/homes' } },
      'repos/orkastery/orkastery.com/branches/main': { commit: { sha: PONTA } },
      [`repos/orkastery/orkastery.com/compare/${MERGE}...${PONTA}`]: { status: 'ahead' },
    };
    const gh: ExecutorGitHub = (caminho) => caminho in respostas
      ? { ok: true, stdout: JSON.stringify(respostas[caminho]), stderr: '', code: 0 } : { ok: false, stdout: '', stderr: 'HTTP 404', code: 1 };
    const r = registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh, publicar: false, dryRun: true });
    assert.equal(r.acao, 'registraria', r.motivo);
    assert.match(r.motivo, /ensaio: registraria ship_done pelo merge e29d05e do PR #6 de orkastery\/orkastery\.com \(nada gravado\)/);
    assert.equal(shipDone(dirThread(p.dir, t.id)), 0);
    // O ensaio recusa o que o registro recusaria: PR que nao cita a thread.
    respostas['repos/orkastery/orkastery.com/pulls/6'] = { ...(respostas['repos/orkastery/orkastery.com/pulls/6'] as object), body: 'outra coisa' };
    assert.equal(registrarEntregaExternaPorPr(p.carregado, t.id, { repositorio: 'orkastery/orkastery.com', pr: 6, executorGitHub: gh, publicar: false, dryRun: true }).acao, 'recusada');
  } finally { p.limpar(); }
});
