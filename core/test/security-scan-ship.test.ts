/** `ork ship`: a loop category not scanned for the candidate SHA is a `human.pending` gate (spec section 11.2). */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { test } from 'node:test';
import { lerLedger } from '../src/ledger';
import type { ManifestoCarregado } from '../src/manifest';
import { raizDoEstado } from '../src/estado-thread';
import { writeReport } from '../src/security-scan/report';
import type { Category, ScanReport, ToolRun, ToolState } from '../src/security-scan/types';
import { ship, unscannedCategories } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { commitar, projetoTemporario, ProjetoDeTeste, shaDaBranch, shaNoRemotoDeTeste } from './apoio';

/** The declared command is `true`: the ship runs verify first, and only the key matters to the gate. */
function comScan(p: ProjetoDeTeste, opts: { chave?: boolean; exigeCi?: boolean }): ManifestoCarregado {
  const b = p.carregado;
  return { ...b, manifesto: { ...b.manifesto,
    verify: { ...b.manifesto.verify, ...(opts.chave === false ? {} : { security_scan: 'true' }) },
    ci: { ...b.manifesto.ci, required_for_ship: opts.exigeCi === true } } };
}

const counts = (): ToolRun['counts'] => {
  const sev = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  return { new: sev(), existing: sev(), dismissed: sev() };
};
const run = (name: string, category: Category, state: ToolState, reason?: string): ToolRun =>
  ({ name, category, version: '1', executor: state === 'unavailable' ? null : 'docker', state, ...(reason ? { reason } : {}), counts: counts() });

function gravar(p: ProjetoDeTeste, head: string, tools: ToolRun[]): void {
  const report: ScanReport = { schema: 'ork.security-scan/v1', base: head, head, generatedAt: '2026-10-19T00:00:00.000Z',
    stacks: [], tools, excluded: [], findings: [] };
  writeReport(raizDoEstado(p.dir), report);
}

function entrega(p: ProjetoDeTeste) {
  const { thread } = novaThread(p.carregado, { nome: 'scan gate', modo: 'auto', criarWorktree: true });
  const sha = commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
  return { thread, sha };
}

test('sem a chave, o ship segue como hoje', () => {
  const p = projetoTemporario('ss-ship-sem-chave', true);
  try {
    const { thread } = entrega(p);
    const r = ship(comScan(p, { chave: false }), thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
  } finally { p.limpar(); }
});

test('secret unavailable e required_for_ship false: human.pending e nada empurrado', () => {
  const p = projetoTemporario('ss-ship-pendente', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable'), run('semgrep', 'sast', 'ran')]);
    const remotoAntes = shaNoRemotoDeTeste(p.dir, p.remoto as string, 'main');
    const r = ship(comScan(p, {}), thread.id, { para: 'main' });
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'human.pending');
    assert.match(r.detalhe, /secret/);
    assert.match(r.correcao ?? '', /--allow-unscanned/);
    assert.equal(shaNoRemotoDeTeste(p.dir, p.remoto as string, 'main'), remotoAntes);
    assert.equal(shaDaBranch(p.dir, 'main'), remotoAntes);
  } finally { p.limpar(); }
});

test('com a chave, sem relatorio do SHA: human.pending (sem evidencia nao e limpo)', () => {
  const p = projetoTemporario('ss-ship-sem-relatorio', true);
  try {
    const { thread } = entrega(p);
    const r = ship(comScan(p, {}), thread.id, { para: 'main' });
    assert.equal(r.motivo, 'human.pending');
    assert.match(r.detalhe, /secret/);
    assert.match(r.detalhe, /workflow/);
  } finally { p.limpar(); }
});

test('allowUnscanned entrega e grava ship_unscanned_authorized', () => {
  const p = projetoTemporario('ss-ship-autorizado', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable'), run('npm-audit', 'dependency', 'failed')]);
    const r = ship(comScan(p, {}), thread.id, { para: 'main', allowUnscanned: 'paschoal' });
    assert.equal(r.ok, true, r.detalhe);
    const ev = lerLedger(dirThread(p.dir, thread.id)).find(e => e.tipo === 'ship_unscanned_authorized');
    assert.ok(ev, 'evento gravado');
    assert.equal(ev.por, 'paschoal');
    assert.deepEqual(ev.categorias, ['dependency', 'secret']);
    assert.equal(ev.sha, sha);
  } finally { p.limpar(); }
});

test('required_for_ship true: sem gate (o scan esta no bundle do CI)', () => {
  const p = projetoTemporario('ss-ship-ci-exigido', true);
  try {
    const { sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable')]);
    assert.deepEqual(unscannedCategories(comScan(p, { exigeCi: true }), sha), []);
  } finally { p.limpar(); }
});

test('unscannedCategories: ordenado, so laco, so unavailable ou failed', () => {
  const p = projetoTemporario('ss-ship-categorias');
  try {
    const sha = 'c'.repeat(40);
    gravar(p, sha, [run('trivy-vuln', 'dependency', 'unavailable'), run('gitleaks', 'secret', 'ran'), run('trivy-license', 'license', 'unavailable'),
      run('zizmor', 'workflow', 'failed'), run('actionlint', 'workflow', 'unavailable')]);
    assert.deepEqual(unscannedCategories(comScan(p, {}), sha), ['dependency', 'workflow']);
    assert.deepEqual(unscannedCategories(comScan(p, { chave: false }), sha), []);
  } finally { p.limpar(); }
});

test('unscannedCategories: unsupported-ci e no-requirements-file (com outra ferramenta da categoria) nao pedem autorizacao', () => {
  const p = projetoTemporario('ss-ship-nada-a-varrer');
  try {
    const sha = 'd'.repeat(40);
    gravar(p, sha, [run('gitleaks', 'secret', 'ran'), run('actionlint', 'workflow', 'unavailable', 'unsupported-ci'),
      run('pip-audit', 'dependency', 'unavailable', 'no-requirements-file'), run('trivy-vuln', 'dependency', 'ran')]);
    assert.deepEqual(unscannedCategories(comScan(p, {}), sha), []);
    const sozinho = 'e'.repeat(40);
    gravar(p, sozinho, [run('gitleaks', 'secret', 'ran'), run('pip-audit', 'dependency', 'unavailable', 'no-requirements-file')]);
    assert.deepEqual(unscannedCategories(comScan(p, {}), sozinho), ['dependency']);
  } finally { p.limpar(); }
});

test('ship com unsupported-ci no relatorio entrega sem pedir --allow-unscanned', () => {
  const p = projetoTemporario('ss-ship-gitlab-ci', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'ran'), run('semgrep', 'sast', 'ran'), run('trivy-vuln', 'dependency', 'ran'),
      run('trivy-config', 'iac', 'ran'), run('actionlint', 'workflow', 'unavailable', 'unsupported-ci')]);
    const r = ship(comScan(p, {}), thread.id, { para: 'main' });
    assert.equal(r.ok, true, r.detalhe);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('ship --dry-run --allow-unscanned nao grava ship_unscanned_authorized e diz o que autorizaria', () => {
  const p = projetoTemporario('ss-ship-ensaio', true);
  try {
    const { thread, sha } = entrega(p);
    gravar(p, sha, [run('gitleaks', 'secret', 'unavailable')]);
    const r = ship(comScan(p, {}), thread.id, { para: 'main', allowUnscanned: 'paschoal', dryRun: true });
    assert.equal(r.bloqueado, false, r.detalhe);
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_unscanned_authorized'), false);
    assert.ok(r.passos.some(x => /paschoal/.test(x) && /secret/.test(x)), r.passos.join(' | '));
  } finally { p.limpar(); }
});

test('CLI: --allow-unscanned sem valor sai 2 e nao entrega', () => {
  const p = projetoTemporario('ss-ship-flag-vazia', true);
  try {
    const { thread } = entrega(p);
    const cli = path.resolve(__dirname, '../../dist/index.js');
    for (const argv of [['--allow-unscanned'], ['--allow-unscanned', '--dry-run'], ['--allow-unscanned=']]) {
      const r = spawnSync(process.execPath, [cli, 'ship', thread.id, '--para', 'main', ...argv],
        { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, LANG: 'C.UTF-8' } });
      assert.equal(r.status, 2, `${argv.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /--allow-unscanned/);
    }
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some(e => e.tipo === 'ship_done' || e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});
