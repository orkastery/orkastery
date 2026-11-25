/** `ork ship`: a loop category not scanned for the candidate SHA is a `human.pending` gate (spec section 11.2). */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { lerLedger } from '../src/ledger';
import type { ManifestoCarregado } from '../src/manifest';
import { raizDoEstado } from '../src/estado-thread';
import { writeReport } from '../src/security-scan/report';
import type { Category, ScanReport, ToolRun, ToolState } from '../src/security-scan/types';
import { ship, unscannedCategories } from '../src/ship';
import { dirThread, novaThread } from '../src/thread';
import { gravarBaseline } from '../src/verify';
import { exec } from '../src/util';
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

type CenarioDaRodada = 'achado-depois-de-baseline-sem-cobertura' | 'achado-e-cobertura-sem-baseline' |
  'cobertura-depois-de-baseline-verde' | 'cobertura-sem-baseline';

/** O comando grava o relatório durante cada execução, no SHA e no estado reais da fixture. */
function comScanDaRodada(p: ProjetoDeTeste, cenario: CenarioDaRodada): ManifestoCarregado {
  const script = path.join(p.dir, `scan-${cenario}.cjs`);
  const contador = path.join(p.dir, `scan-${cenario}.contador`);
  const report = path.resolve(__dirname, '../src/security-scan/report.js');
  const estado = path.resolve(__dirname, '../src/estado-thread.js');
  fs.writeFileSync(script, `
const fs=require('node:fs'),path=require('node:path');
const [reportModule,estadoModule,raiz,cenario,contador]=process.argv.slice(2);
const {writeReport,exitCodeOf}=require(reportModule),{raizDoEstado}=require(estadoModule);
const rodada=Number(fs.existsSync(contador)?fs.readFileSync(contador,'utf8'):0)+1;
fs.writeFileSync(contador,String(rodada));
const atual=cenario==='achado-e-cobertura-sem-baseline'||cenario==='cobertura-sem-baseline'||rodada>1;
const dotGit=path.resolve('.git');
const gitDir=fs.statSync(dotGit).isDirectory()?dotGit:path.resolve(path.dirname(dotGit),fs.readFileSync(dotGit,'utf8').trim().slice(8));
const commonFile=path.join(gitDir,'commondir');
const commonDir=fs.existsSync(commonFile)?path.resolve(gitDir,fs.readFileSync(commonFile,'utf8').trim()):gitDir;
const headRaw=fs.readFileSync(path.join(gitDir,'HEAD'),'utf8').trim();
const ref=headRaw.startsWith('ref: ')?headRaw.slice(5):null;
const head=ref?fs.readFileSync([path.join(gitDir,ref),path.join(commonDir,ref)].find(fs.existsSync),'utf8').trim():headRaw;
const sev=()=>({critical:0,high:0,medium:0,low:0,info:0});
const tool=(name,category,state)=>({name,category,version:'1',executor:state==='ran'?'docker':null,state,
  ...(state==='ran'?{}:{reason:'docker-missing'}),counts:{new:sev(),existing:sev(),dismissed:sev()}});
const semCobertura=cenario==='achado-depois-de-baseline-sem-cobertura'?!atual:
  cenario==='achado-e-cobertura-sem-baseline'||cenario==='cobertura-sem-baseline'||
    cenario==='cobertura-depois-de-baseline-verde'&&atual;
const achado=atual&&!['cobertura-depois-de-baseline-verde','cobertura-sem-baseline'].includes(cenario);
const tools=[tool('gitleaks','secret','ran'),tool('semgrep','sast',semCobertura?'unavailable':'ran'),
  tool('npm-audit','dependency','ran'),tool('trivy','iac','ran'),tool('zizmor','workflow','ran')];
const findings=achado?[{tool:'gitleaks',rule:'generic-api-key',category:'secret',severity:'critical',file:'entrega.md',line:1,
  message:'achado novo',fingerprint:'f'.repeat(16),status:'new',loop:true}]:[];
const relatorio={schema:'ork.security-scan/v1',base:head,head,generatedAt:new Date().toISOString(),stacks:['js'],tools,excluded:[],findings};
writeReport(raizDoEstado(raiz),relatorio);process.exit(exitCodeOf(relatorio));
`);
  const comando = ['node', JSON.stringify(script), JSON.stringify(report), JSON.stringify(estado), JSON.stringify(p.dir), cenario,
    JSON.stringify(contador)].join(' ');
  const b = p.carregado;
  return { ...b, manifesto: { ...b.manifesto, check: { ...b.manifesto.check, mode: 'classic' },
    verify: { test: 'true', security_scan: comando },
    ci: { ...b.manifesto.ci, required_for_ship: false } } };
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

test('linha A: achado novo depois de baseline sem cobertura vira regressao e a autorizacao nao atravessa', () => {
  const p = projetoTemporario('ss-ship-achado-baseline-vermelha', true);
  try {
    const carregado = comScanDaRodada(p, 'achado-depois-de-baseline-sem-cobertura');
    const { thread } = novaThread(carregado, { nome: 'achado novo', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false, JSON.stringify({ r, eventos: lerLedger(dirThread(p.dir, thread.id)) }, null, 2));
    assert.equal(r.motivo, 'verify.regression');

    const eventos = lerLedger(dirThread(p.dir, thread.id));
    const verify = eventos.filter(e => e.tipo === 'verify_run').at(-1)!;
    assert.equal(verify.veredito, 'reprovado');
    assert.deepEqual(verify.motivos, ['verify.regression']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('linha B: achado novo com cobertura ausente e sem baseline continua verify.failed', () => {
  const p = projetoTemporario('ss-ship-achado-sem-baseline', true);
  try {
    const carregado = comScanDaRodada(p, 'achado-e-cobertura-sem-baseline');
    const { thread } = novaThread(carregado, { nome: 'achado sem baseline', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos, ['verify.failed']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('linha C: baseline verde e cobertura ausente permitem somente a autorizacao nominal', () => {
  const p = projetoTemporario('ss-ship-cobertura-baseline-verde', true);
  try {
    const carregado = comScanDaRodada(p, 'cobertura-depois-de-baseline-verde');
    const { thread } = novaThread(carregado, { nome: 'cobertura ausente', modo: 'auto', criarWorktree: true });
    gravarBaseline(carregado, thread.id);
    const sha = commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, true, r.detalhe);
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos, ['security.scan-unscanned']);
    assert.equal(eventos.find(e => e.tipo === 'gate_blocked' && e.motivo === 'security.scan-unscanned')!.fase,
      thread.faseAtual);
    const autorizado = eventos.find(e => e.tipo === 'ship_unscanned_authorized')!;
    assert.equal(autorizado.por, 'responsavel');
    assert.equal(autorizado.sha, sha);
    assert.deepEqual(autorizado.categorias, ['sast']);
  } finally { p.limpar(); }
});

test('allowUnscanned nao atravessa cobertura ausente acompanhada de outro bloqueio', () => {
  const p = projetoTemporario('ss-ship-cobertura-e-falha', true);
  try {
    const comCobertura = comScanDaRodada(p, 'cobertura-sem-baseline');
    const carregado = { ...comCobertura, manifesto: { ...comCobertura.manifesto,
      verify: { ...comCobertura.manifesto.verify, test: 'false' } } };
    const { thread } = novaThread(carregado, { nome: 'cobertura e falha', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'entrega.md', '# x\n', `feat: ${thread.id}`);
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos,
      ['verify.failed', 'security.scan-unscanned']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
  } finally { p.limpar(); }
});

test('dispensa invalida sem relatorio da rodada permanece verify.failed e nao aceita allowUnscanned', () => {
  const p = projetoTemporario('ss-ship-dispensa-invalida', true);
  try {
    commitar(p.dir, 'orkastery.yaml', fs.readFileSync(path.join(p.dir, 'orkastery.yaml'), 'utf8'), 'chore: manifesto');
    assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
    const cli = path.resolve(__dirname, '../../dist/index.js');
    const b = p.carregado;
    const carregado = { ...b, manifesto: { ...b.manifesto,
      verify: { test: 'true', security_scan: `node ${JSON.stringify(cli)} security-scan` },
      ci: { ...b.manifesto.ci, required_for_ship: false } } };
    const { thread } = novaThread(carregado, { nome: 'dispensa invalida', modo: 'auto', criarWorktree: true });
    fs.mkdirSync(path.join(thread.worktree as string, '.ork-security'));
    commitar(thread.worktree as string, '.ork-security/dismissals.json', '[{"fingerprint":"x"}]\n', 'chore: dispensa invalida');
    const r = ship(carregado, thread.id, { para: 'main', allowUnscanned: 'responsavel' });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'verify.failed');
    const eventos = lerLedger(dirThread(p.dir, thread.id));
    assert.deepEqual(eventos.filter(e => e.tipo === 'verify_run').at(-1)!.motivos, ['verify.failed']);
    assert.equal(eventos.some(e => e.tipo === 'ship_unscanned_authorized'), false);
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
