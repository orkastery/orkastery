/**
 * RM-063 (F7): a batida da conducao (`ork conducao batida`), o passo deterministico que a varredura chama para avancar as
 * threads dentro da autorizacao duravel do dono.
 *
 * Incidente de 12 e 13/10/2026: os PRs #153 e #154 ficaram prontos, com os checks verdes, e esperaram de 5 a 6 horas pelo
 * condutor. Aqui o "GitHub" e um remoto bare, o `gh` e falso (os PRs em memoria; o merge e um merge de verdade num clone,
 * empurrado para o bare, como o GitHub faria), o runtime e o stub do `claude` e a autorizacao e de uma dona simulada.
 */
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { commitar, dirTemporario, projetoTemporario, ProjetoDeTeste, runtimeFalso } from './apoio';
import { despachar as despacharNoLedger, concluirFase } from './noctum-apoio';
import { caminhoDaAutorizacao, CONTRATO_DA_AUTORIZACAO } from '../src/autorizacao-duravel';
import { assuntoDoMerge, avaliarPr, baterConducao, comandoDoMerge, conduzirBatida, OpcoesDaBatida, pendentesDaUltimaBatida, PrAberto,
  ARQUIVO_DA_BATIDA } from '../src/conducao-batida';
import { atualizarBranchDaThread } from '../src/atualizar-branch';
import { baterSentinela } from '../src/conducao-sentinela';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { nomeDaMaquina } from '../src/maquina';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { montarPulse } from '../src/pulse';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { garantirWorktree, branchDaWorktree } from '../src/worktree';
import { exec } from '../src/util';

const codexAnterior = process.env.CODEX_HOME;
before(() => { process.env.CODEX_HOME = dirTemporario('rm063-f7-codex'); });
after(() => { if (codexAnterior === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexAnterior; });

const HORA = 3600_000;
const FORJA = { host: 'github.com', repositorio: 'acme/app' };
const SEM_SESSOES = { fantasmas: () => [], vivas: () => [] };
const CLI = path.resolve(__dirname, '../../dist/index.js');

function autorizar(p: ProjetoDeTeste, pode: string[], campos: Record<string, unknown> = {}): void {
  const arquivo = caminhoDaAutorizacao(p.dir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ contrato: CONTRATO_DA_AUTORIZACAO, maquina: nomeDaMaquina(), projeto: p.carregado.manifesto.project.name,
    por: 'Dona Simulada', concedidaEm: new Date(Date.now() - HORA).toISOString(), ate: new Date(Date.now() + 24 * HORA).toISOString(), pode, ...campos }));
}

interface PrFalso { number: number; title: string; headRefName: string; headRefOid: string; baseRefName: string; isDraft: boolean;
  isCrossRepository: boolean; mergeable: string; mergeStateStatus: string; url: string; aberto: boolean }

/** O `gh` falso: os PRs em memoria, os checks obrigatorios de cada um e o merge feito de verdade num clone do bare. */
function ghFalso(p: ProjetoDeTeste) {
  const prs: PrFalso[] = [];
  const checks = new Map<number, { name: string; bucket: string }[] | 'sem'>();
  const chamadas: string[][] = [];
  const executor: ExecutorDoGh = (args) => {
    chamadas.push([...args]);
    const ok = (stdout: string, status = 0) => ({ status, stdout, stderr: '' });
    if (args[0] === 'pr' && args[1] === 'list') return ok(JSON.stringify(prs.filter((x) => x.aberto)));
    if (args[0] === 'pr' && args[1] === 'checks') {
      const c = checks.get(Number(args[2])) ?? [];
      if (c === 'sem') return { status: 1, stdout: '', stderr: "no required checks reported on the 'ork/x' branch" };
      return ok(JSON.stringify(c.map((x) => ({ ...x, state: x.bucket.toUpperCase() }))),
        c.some((x) => x.bucket === 'fail') ? 1 : c.some((x) => x.bucket === 'pending') ? 8 : 0);
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      const pr = prs.find((x) => x.number === Number(args[2]) && x.aberto);
      const sha = args[args.indexOf('--match-head-commit') + 1];
      const assunto = args[args.indexOf('--subject') + 1];
      if (!pr) return { status: 1, stdout: '', stderr: 'pull request not found' };
      const remota = exec('git', ['ls-remote', p.remoto as string, `refs/heads/${pr.headRefName}`]).stdout.split(/\s+/)[0];
      if (sha !== pr.headRefOid || remota !== sha) return { status: 1, stdout: '', stderr: 'Head branch was modified. Review and try the merge again.' };
      const clone = dirTemporario('rm063-f7-gh-merge');
      exec('git', ['clone', '-q', p.remoto as string, clone]);
      for (const [k, v] of [['user.email', 'github@orkastery.local'], ['user.name', 'GitHub Simulado'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], clone);
      const m = exec('git', ['merge', '--no-ff', '-q', '-m', assunto, `origin/${pr.headRefName}`], clone);
      const push = exec('git', ['push', '-q', 'origin', 'main'], clone);
      fs.rmSync(clone, { recursive: true, force: true });
      if (!m.ok || !push.ok) return { status: 1, stdout: '', stderr: 'merge falhou no GitHub simulado' };
      pr.aberto = false;
      return ok(`✓ Merged pull request #${pr.number}`);
    }
    return { status: 1, stdout: '', stderr: `gh falso: ${args.join(' ')} não simulado` };
  };
  return { prs, checks, chamadas, executor,
    abrir(n: number, branch: string, campos: Partial<PrFalso> = {}): PrFalso {
      const head = exec('git', ['ls-remote', p.remoto as string, `refs/heads/${branch}`]).stdout.split(/\s+/)[0];
      const pr: PrFalso = { number: n, title: `ship(t): entrega #${n}`, headRefName: branch, headRefOid: head, baseRefName: 'main', isDraft: false,
        isCrossRepository: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', url: `https://github.com/acme/app/pull/${n}`, aberto: true, ...campos };
      prs.push(pr);
      return pr;
    } };
}

/** O projeto com remoto, a thread #Auto com worktree, produto commitado e a branch publicada. */
function cenario(nome: string, opcoes: { pedido?: string; semProduto?: boolean } = {}) {
  const p = projetoTemporario(nome, true);
  commitar(p.dir, 'CHANGELOG.md', '# Changelog\n\n## Não publicado\n\n### Adicionado\n\n- **antes** (RM-000): x\n', 'docs: changelog');
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto', ...(opcoes.pedido ? { pedido: opcoes.pedido } : {}) });
  assert.equal(garantirWorktree(p.carregado, thread.id).ok, true);
  const t = lerThread(p.dir, thread.id);
  const wt = t.worktree as string, branch = branchDaWorktree(t);
  // Sem produto na branch, a fase seguinte ao GOAL e o PLAN; com produto, o nucleo sabe que o GO ja aconteceu.
  if (!opcoes.semProduto) commitar(wt, 'src/entrega.ts', 'export const entrega = 1;\n', `feat(${thread.id}): entrega`);
  assert.equal(exec('git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], wt).ok, true);
  return { p, thread: thread.id, wt, branch, gh: ghFalso(p) };
}

/** O parecer do CHECK com o veredito PASSOU, gravado agora (depois do ultimo commit de produto do cenario). */
function checkPassou(p: ProjetoDeTeste, thread: string): void {
  const docs = path.join(dirThread(p.dir, thread), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'check.md'), '# CHECK simulado\n\nVeredito: PASSOU\n');
}

const opcoesDe = (gh: ReturnType<typeof ghFalso>, extra: OpcoesDaBatida = {}): OpcoesDaBatida =>
  ({ executorGh: gh.executor, forja: FORJA, ...SEM_SESSOES, despachar: () => ({ ok: false, detalhe: 'sem despacho neste teste', sessionId: null }),
    retomar: () => ({ automatica: false, ok: false, detalhe: 'sem retomada neste teste' }), ...extra });
const merges = (gh: ReturnType<typeof ghFalso>) => gh.chamadas.filter((c) => c[1] === 'merge');

test('F7: o estado do PR decide o merge; so o PR limpo com os checks obrigatorios verdes fica pronto', () => {
  const pr = (campos: Partial<PrAberto> = {}): PrAberto => ({ numero: 7, titulo: 'x', branch: 'ork/x', head: 'a'.repeat(40), base: 'main',
    rascunho: false, mergeable: 'MERGEABLE', estado: 'CLEAN', url: null, ...campos });
  const verdes = [{ nome: 'ork-verify', bucket: 'pass' }, { nome: 'docs', bucket: 'skipping' }];
  assert.deepEqual(avaliarPr(pr(), verdes), { estado: 'pronto' });
  assert.deepEqual(avaliarPr(pr({ estado: 'HAS_HOOKS' }), verdes), { estado: 'pronto' });
  const motivo = (r: ReturnType<typeof avaliarPr>) => ('motivo' in r ? `${r.estado}:${r.motivo}` : r.estado);
  assert.equal(motivo(avaliarPr(pr({ rascunho: true }), verdes)), 'dono:pr-rascunho');
  assert.equal(motivo(avaliarPr(pr({ estado: 'BEHIND' }), verdes)), 'atualizar');
  assert.equal(motivo(avaliarPr(pr({ estado: 'DIRTY', mergeable: 'CONFLICTING' }), verdes)), 'atualizar');
  assert.equal(motivo(avaliarPr(pr(), [...verdes, { nome: 'testes', bucket: 'fail' }])), 'dono:checks-vermelhos');
  assert.equal(motivo(avaliarPr(pr(), [...verdes, { nome: 'testes', bucket: 'cancel' }])), 'dono:checks-vermelhos');
  assert.equal(motivo(avaliarPr(pr({ estado: 'BLOCKED' }), [...verdes, { nome: 'testes', bucket: 'pending' }])), 'espera:checks-pendentes');
  assert.equal(motivo(avaliarPr(pr(), [])), 'dono:sem-checks-obrigatorios');
  assert.equal(motivo(avaliarPr(pr({ estado: 'BLOCKED' }), verdes)), 'dono:pr-bloqueado');
  assert.equal(motivo(avaliarPr(pr({ estado: 'UNSTABLE' }), verdes)), 'dono:pr-instavel');
  assert.equal(motivo(avaliarPr(pr({ estado: 'UNKNOWN' }), verdes)), 'espera:estado-desconhecido');
  assert.equal(assuntoDoMerge('ork-x', { numero: 154, titulo: 'ship(ork-x): RM-063 fatia 2' }), 'ship(ork-x): RM-063 fatia 2 (#154)');
  assert.equal(assuntoDoMerge('ork-x', { numero: 9, titulo: 'RM-063 fatia 3' }), 'ship(ork-x): RM-063 fatia 3 (#9)');
});

test('F7: com a autorizacao, o PR pronto entra pela batida e a entrega e registrada na mesma rodada', () => {
  const { p, thread, branch, gh } = cenario('rm063-f7-merge');
  try {
    autorizar(p, ['merge', 'registrar', 'master']);
    const pr = gh.abrir(153, branch, { title: `ship(${thread}): fatia simulada` });
    gh.checks.set(153, [{ name: 'ork-verify', bucket: 'pass' }, { name: 'nucleo', bucket: 'pass' }]);
    // Sem o CHECK depois do ultimo commit de produto, nada entra na base (GO-FIX, achado 1 da revisao).
    const semCheck = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(semCheck.pendentes.filter((x) => x.acao === 'merge').map((x) => [x.resultado, x.motivo]), [['dono', 'check-pendente']]);
    assert.equal(merges(gh).length, 0);
    checkPassou(p, thread);
    const r = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(r.feitas.map((f) => [f.acao, f.thread, f.pr]), [['merge', thread, 153], ['registrar', thread, null]], JSON.stringify(r, null, 1));
    const chamada = merges(gh)[0];
    assert.deepEqual([chamada[chamada.indexOf('--match-head-commit') + 1], chamada[chamada.indexOf('--subject') + 1], chamada.includes('--merge')],
      [pr.headRefOid, `ship(${thread}): fatia simulada (#153)`, true]);
    const eventos = lerLedger(dirThread(p.dir, thread));
    const feita = eventos.find((e) => e.tipo === TIPOS_DE_EVENTO.acaoDaVarredura && e.acao === 'merge');
    assert.deepEqual([feita?.resultado, (feita?.autorizacao as { por?: string })?.por, feita?.origem], ['feita', 'Dona Simulada', 'conducao.batida']);
    assert.ok(eventos.some((e) => e.tipo === TIPOS_DE_EVENTO.shipConcluido), 'a entrega nao foi registrada');
    assert.ok(!gh.chamadas.some((c) => c.some((a) => /^(release|tag)$/.test(a))), 'tag ou release nunca entram');
  } finally { p.limpar(); }
});

test('F7: check pendente espera a proxima batida, na faixa automatica do pulse; nada e mesclado', () => {
  const { p, thread, branch, gh } = cenario('rm063-f7-pendente');
  try {
    autorizar(p, ['merge', 'registrar']);
    gh.abrir(154, branch, { mergeStateStatus: 'BLOCKED' });
    gh.checks.set(154, [{ name: 'ork-verify', bucket: 'pending' }, { name: 'nucleo', bucket: 'pass' }]);
    const r = baterConducao(p.carregado, opcoesDe(gh));
    assert.equal(r.ocupada, false);
    if (r.ocupada) return;
    assert.deepEqual(r.pendentes.map((x) => [x.acao, x.resultado, x.motivo]), [['merge', 'espera', 'checks-pendentes']]);
    assert.equal(merges(gh).length, 0);
    const pulse = montarPulse(p.carregado, { fontes: () => ({}), consulta: { ok: true, sessoes: [], detalhe: '' } });
    assert.ok(pulse.acoesAutomaticas.some((i) => i.id === `varredura:merge:${thread}`), 'o merge pendente sumiu da fila automatica');
    assert.ok(!pulse.precisaDeHumanoAgora.some((i) => i.id === `varredura:merge:${thread}`), 'check pendente nao e do dono');
    assert.equal(lerLedger(dirThread(p.dir, thread)).filter((e) => e.acao === 'merge').length, 0, 'espera nao vira linha no ledger');
  } finally { p.limpar(); }
});

test('F7: autorizacao vencida, acao fora da lista e trabalho na thread recusam com motivo tipado e viram item do dono', () => {
  const { p, thread, wt, branch, gh } = cenario('rm063-f7-recusas');
  try {
    // O PR esta pronto de verdade (CHECK aprovado): o que fica com o dono e a autorizacao ou o trabalho na thread.
    checkPassou(p, thread);
    gh.abrir(155, branch);
    gh.checks.set(155, [{ name: 'ork-verify', bucket: 'pass' }]);
    const motivoDoMerge = (extra: OpcoesDaBatida = {}) => {
      const r = conduzirBatida(p.carregado, opcoesDe(gh, extra));
      return r.pendentes.filter((x) => x.acao === 'merge').map((x) => `${x.resultado}:${x.motivo}`);
    };
    autorizar(p, ['merge'], { ate: new Date(Date.now() - HORA).toISOString() });
    assert.deepEqual(motivoDoMerge(), ['dono:autorizacao.expirada']);
    autorizar(p, ['registrar', 'master']);
    assert.deepEqual(motivoDoMerge(), ['dono:acao-fora-da-autorizacao']);
    // A fila do dono leva o merge com o comando pronto, enquanto o retrato da ultima batida vale.
    baterConducao(p.carregado, opcoesDe(gh));
    const item = montarPulse(p.carregado, { fontes: () => ({}), consulta: { ok: true, sessoes: [], detalhe: '' } }).precisaDeHumanoAgora
      .find((i) => i.id === `varredura:merge:${thread}`);
    assert.match(String(item?.comandoResposta), /^gh pr merge 155 --repo github\.com\/acme\/app --merge --match-head-commit [0-9a-f]{40} --subject /);
    autorizar(p, ['merge']);
    fs.writeFileSync(path.join(wt, 'src', 'entrega.ts'), 'export const entrega = 2;\n');
    assert.deepEqual(motivoDoMerge(), ['dono:worktree-suja']);
    exec('git', ['checkout', '--', 'src/entrega.ts'], wt);
    commitar(wt, 'src/mais.ts', 'export const mais = 1;\n', 'feat: ainda nao publicado');
    assert.deepEqual(motivoDoMerge(), ['dono:branch-nao-publicada']);
    assert.deepEqual(motivoDoMerge({ vivas: () => [{ sessionId: 'a'.repeat(8) + '-0000-4000-8000-000000000001', cwd: wt }] }), ['dono:sessao-viva']);
    gh.prs[0].isDraft = true;
    assert.deepEqual(motivoDoMerge(), ['dono:pr-rascunho']);
    assert.equal(merges(gh).length, 0, 'nenhuma recusa chamou o merge');
    assert.equal(lerLedger(dirThread(p.dir, thread)).filter((e) => e.acao === 'merge').length, 0,
      'sem autorizacao ou com bloqueio, so o item da fila: nada no ledger');
  } finally { p.limpar(); }
});

test('F7: o PR que ficou para tras com conflito so no CHANGELOG ganha a base; conflito em codigo fica com o dono', () => {
  const { p, thread, wt, branch, gh } = cenario('rm063-f7-atualizar');
  try {
    autorizar(p, ['merge']);
    commitar(wt, 'CHANGELOG.md', '# Changelog\n\n## Não publicado\n\n### Adicionado\n\n- **da thread** (RM-063): y\n- **antes** (RM-000): x\n', 'docs: linha');
    assert.equal(exec('git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], wt).ok, true);
    // A main andou com outra linha no topo do mesmo grupo: o PR fica DIRTY.
    const outro = dirTemporario('rm063-f7-outra-maquina');
    exec('git', ['clone', '-q', p.remoto as string, outro]);
    for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'Outra Maquina'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], outro);
    commitar(outro, 'CHANGELOG.md', '# Changelog\n\n## Não publicado\n\n### Adicionado\n\n- **da outra** (RM-001): z\n- **antes** (RM-000): x\n', 'docs: outra');
    exec('git', ['push', '-q', 'origin', 'main'], outro);
    gh.abrir(158, branch, { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
    gh.checks.set(158, [{ name: 'ork-verify', bucket: 'pass' }]);
    const r = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(r.feitas.map((f) => [f.acao, f.motivo]), [['merge', 'branch-atualizada']], JSON.stringify(r.pendentes));
    const remota = exec('git', ['ls-remote', p.remoto as string, `refs/heads/${branch}`]).stdout.split(/\s+/)[0];
    assert.equal(remota, exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim(), 'a branch atualizada foi empurrada');
    assert.match(fs.readFileSync(path.join(wt, 'CHANGELOG.md'), 'utf8'), /- \*\*da outra\*\* \(RM-001\): z\n- \*\*antes\*\* \(RM-000\): x\n- \*\*da thread\*\*/);
    assert.equal(merges(gh).length, 0, 'o merge do PR espera o CI do novo head');
    // Agora o conflito em codigo.
    commitar(wt, 'src/entrega.ts', 'export const entrega = 10;\n', 'feat: thread');
    exec('git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], wt);
    exec('git', ['pull', '-q', '--no-rebase', 'origin', 'main'], outro);
    commitar(outro, 'src/entrega.ts', 'export const entrega = 20;\n', 'feat: outra');
    exec('git', ['push', '-q', 'origin', 'main'], outro);
    fs.rmSync(outro, { recursive: true, force: true });
    gh.prs[0].headRefOid = exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim();
    const c = conduzirBatida(p.carregado, opcoesDe(gh));
    const pendente = c.pendentes.find((x) => x.acao === 'merge');
    assert.deepEqual([pendente?.resultado, pendente?.motivo, pendente?.comando], ['dono', 'conflito-em-codigo', `ork thread status ${thread}`]);
    assert.match(String(pendente?.detalhe), /src\/entrega\.ts/);
    assert.equal(exec('git', ['status', '--porcelain'], wt).stdout.trim(), '', 'o merge com conflito em codigo foi abortado');
    const tentativa = lerLedger(dirThread(p.dir, thread)).filter((e) => e.acao === 'merge' && e.resultado === 'recusada');
    assert.equal(tentativa.length, 1, 'a tentativa recusada vai ao ledger, uma vez');
  } finally { p.limpar(); }
});

test('F7: despacha a fase seguinte so com o prompt gravado e a autorizacao; com a Sentinela ligada, cede', () => {
  const { p, thread } = cenario('rm063-f7-despachar', { pedido: 'implemente a fatia simulada', semProduto: true });
  const sem = novaThread(p.carregado, { nome: 'sem pedido', modo: 'auto' }).thread;
  try {
    for (const t of [thread, sem.id]) {
      const d = despacharNoLedger(p.dir, t, 'GOAL', t === thread ? 1 : 2, false);
      concluirFase(p.dir, t, 'GOAL', d.sessionId);
    }
    const chamadas: { thread: string; fase: string; prompt: string; correlacao: string }[] = [];
    const despachar: OpcoesDaBatida['despachar'] = (_c, t, fase, prompt, _canal, correlacao) => {
      chamadas.push({ thread: t, fase, prompt, correlacao });
      return { ok: true, detalhe: 'sessão 11111111', sessionId: '11111111-2222-3333-4444-555555555555' };
    };
    autorizar(p, ['registrar']);
    const fora = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { despachar }));
    assert.deepEqual(fora.pendentes.filter((x) => x.acao === 'despachar').map((x) => [x.thread, x.motivo]).sort(),
      [[sem.id, 'sem-prompt-gravado'], [thread, 'acao-fora-da-autorizacao']].sort());
    assert.equal(chamadas.length, 0);
    autorizar(p, ['despachar']);
    // A Sentinela ligada nesta maquina despacha: a batida cede.
    baterSentinela(p.dir, { sessao: 'sessao-do-dono' });
    const cedeu = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { despachar }));
    assert.deepEqual([cedeu.sentinela, chamadas.length], [true, 0]);
    fs.rmSync(path.join(p.dir, '.orkastery', 'conducao'), { recursive: true, force: true });
    const r = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { despachar }));
    assert.deepEqual(chamadas.map((c) => [c.thread, c.fase, c.prompt]), [[thread, 'PLAN', 'implemente a fatia simulada']]);
    assert.match(chamadas[0].correlacao, /^batida:/);
    assert.deepEqual(r.feitas.filter((f) => f.acao === 'despachar').map((f) => [f.thread, f.fase]), [[thread, 'PLAN']]);
    assert.deepEqual(r.pendentes.filter((x) => x.acao === 'despachar').map((x) => [x.thread, x.motivo]), [[sem.id, 'sem-prompt-gravado']]);
  } finally { p.limpar(); }
});

test('F7: a retomada so roda com a autorizacao e o plano automatico; sem eles, nao duplica o item de retry do pulse', () => {
  const { p, thread } = cenario('rm063-f7-retomar', { pedido: 'implemente a fatia simulada', semProduto: true });
  try {
    // O despacho da fase falhou antes de abrir sessao: o passo do nucleo e a retomada pelo retry.
    const d = despacharNoLedger(p.dir, thread, 'GOAL', 4, false);
    registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.despachoFalhou, { fase: 'GOAL', motivo: 'runtime.unavailable',
      sessionId: d.sessionId });
    const retomadas: string[] = [];
    const automatica = (ok: boolean) => (_c: unknown, t: string) => { retomadas.push(t); return { automatica: true, ok, detalhe: ok ? 'redespachada' : 'o runtime segue fora' }; };
    autorizar(p, ['registrar']);
    const sem = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { retomar: automatica(true) }));
    assert.deepEqual([retomadas, sem.pendentes.filter((x) => x.thread === thread && x.acao === 'despachar')], [[], []]);
    autorizar(p, ['despachar']);
    const naoAutomatica = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { retomar: () => ({ automatica: false, ok: false, detalhe: 'o plano pede o dono' }) }));
    assert.deepEqual(naoAutomatica.pendentes.filter((x) => x.thread === thread), [], 'o plano do dono ja e item do pulse');
    const feita = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { retomar: automatica(true) }));
    assert.deepEqual([retomadas, feita.feitas.filter((f) => f.thread === thread).map((f) => f.detalhe)], [[thread], ['redespachada']]);
    const falhou = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), { retomar: automatica(false) }));
    assert.deepEqual(falhou.pendentes.filter((x) => x.thread === thread).map((x) => x.motivo), ['retomada-recusada']);
  } finally { p.limpar(); }
});

test('F7: o despacho pelo nucleo abre a sessao de fundo com o runtime falso, nunca por cron LLM', (t) => {
  const { p, thread } = cenario('rm063-f7-despacho-real', { pedido: 'implemente a fatia simulada', semProduto: true });
  const runtime = runtimeFalso('rm063-f7-despacho-real');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const d = despacharNoLedger(p.dir, thread, 'GOAL', 3, false);
  concluirFase(p.dir, thread, 'GOAL', d.sessionId);
  autorizar(p, ['despachar']);
  const r = conduzirBatida(p.carregado, { executorGh: ghFalso(p).executor, forja: FORJA, ...SEM_SESSOES, canal: 'cli' });
  assert.deepEqual(r.feitas.filter((f) => f.acao === 'despachar').map((f) => [f.thread, f.fase]), [[thread, 'PLAN']], JSON.stringify(r.pendentes));
  assert.deepEqual(runtime.chamadas().length, 1, 'uma sessao de fundo pelo claude --bg do runtime');
  const despacho = lerLedger(dirThread(p.dir, thread)).filter((e) => e.tipo === TIPOS_DE_EVENTO.faseDespachada).at(-1);
  assert.deepEqual([despacho?.fase, despacho?.correlacao, despacho?.canal], ['PLAN', `batida:${nomeDaMaquina()}`, 'cli']);
});

test('F7: ork conducao batida pelo CLI, sem autorizacao: nada sozinho, e o texto diz o que ficou com o dono', () => {
  const p = projetoTemporario('rm063-f7-cli');
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8', ORK_MAQUINA: nomeDaMaquina() };
    for (const k of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'LC_ALL']) delete env[k];
    const json = spawnSync(process.execPath, [CLI, 'conducao', 'batida', '--json'], { cwd: p.dir, encoding: 'utf8', env });
    assert.equal(json.status, 0, json.stderr);
    const r = JSON.parse(json.stdout) as { contrato: string; autorizacao: { valida: boolean; motivo: string }; feitas: unknown[] };
    assert.deepEqual([r.contrato, r.autorizacao.valida, r.autorizacao.motivo, r.feitas.length],
      ['ork.conducao-batida/v1', false, 'autorizacao.ausente', 0]);
    const texto = spawnSync(process.execPath, [CLI, 'conducao', 'batida'], { cwd: p.dir, encoding: 'utf8', env });
    assert.match(texto.stdout, /^Sem autorização durável válida \(autorizacao\.ausente\): nada foi feito sozinho/);
    assert.match(texto.stdout, /Nada voltou a andar nesta batida\./);
    const log = fs.readFileSync(path.join(p.dir, '.orkastery', 'monitor', 'hitl.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log.filter((l) => l.tipo === 'varredura_acoes').length, 2, 'cada rodada vai ao hitl.log');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// GO-FIX da revisao independente da fatia 3.
// ---------------------------------------------------------------------------

/** A main andou no "GitHub" com um arquivo novo (sem conflito com a thread). */
function mainAnda(p: ProjetoDeTeste, arquivo = 'docs/outra.md'): void {
  const outro = dirTemporario('rm063-f7-main-anda');
  exec('git', ['clone', '-q', p.remoto as string, outro]);
  for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'Outra Maquina'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], outro);
  commitar(outro, arquivo, `${arquivo}\n`, `docs: ${arquivo}`);
  exec('git', ['push', '-q', 'origin', 'main'], outro);
  fs.rmSync(outro, { recursive: true, force: true });
}
const remotaDe = (p: ProjetoDeTeste, branch: string) => exec('git', ['ls-remote', p.remoto as string, `refs/heads/${branch}`]).stdout.split(/\s+/)[0];

test('GO-FIX: sem autorizacao, o PR sem CHECK chega ao dono como check-pendente, nunca como pronto', () => {
  const { p, thread, branch, gh } = cenario('rm063-gofix-ordem');
  try {
    gh.abrir(207, branch);
    gh.checks.set(207, [{ name: 'ork-verify', bucket: 'pass' }]);
    const semCheck = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(semCheck.pendentes.filter((x) => x.acao === 'merge').map((x) => x.motivo), ['check-pendente']);
    checkPassou(p, thread);
    const pronto = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(pronto.pendentes.filter((x) => x.acao === 'merge').map((x) => [x.motivo, x.detalhe]), [['autorizacao.ausente', 'o PR #207 está pronto']]);
  } finally { p.limpar(); }
});

test('GO-FIX 1: o PR para tras com trabalho local que ele nao tem nao e atualizado nem empurrado', () => {
  const { p, wt, branch, gh } = cenario('rm063-gofix-wip');
  try {
    autorizar(p, ['merge']);
    gh.abrir(201, branch, { mergeStateStatus: 'BEHIND' });
    gh.checks.set(201, [{ name: 'ork-verify', bucket: 'pass' }]);
    mainAnda(p);
    const antes = remotaDe(p, branch);
    commitar(wt, 'src/wip.ts', 'export const wip = "nao publicado";\n', 'wip: ainda nao publicado');
    const r = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(r.pendentes.filter((x) => x.acao === 'merge').map((x) => [x.resultado, x.motivo]), [['dono', 'branch-nao-publicada']]);
    assert.equal(remotaDe(p, branch), antes, 'o trabalho local nao foi empurrado para o PR');
  } finally { p.limpar(); }
});

test('GO-FIX 1: a branch local atras do PR (Update branch do GitHub) avanca por fast-forward antes do merge da base', () => {
  const { p, wt, branch, gh } = cenario('rm063-gofix-atras');
  try {
    autorizar(p, ['merge']);
    // Outro lugar empurrou um commit no PR: a local fica atras do head dele.
    const outro = dirTemporario('rm063-gofix-outro');
    exec('git', ['clone', '-q', '--branch', branch, p.remoto as string, outro]);
    for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'Outra Maquina'], ['commit.gpgsign', 'false']]) exec('git', ['config', k, v], outro);
    commitar(outro, 'src/do-pr.ts', 'export const doPr = 1;\n', 'feat: commit no PR');
    exec('git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], outro);
    fs.rmSync(outro, { recursive: true, force: true });
    mainAnda(p);
    gh.abrir(202, branch, { mergeStateStatus: 'BEHIND' });
    gh.checks.set(202, [{ name: 'ork-verify', bucket: 'pass' }]);
    const r = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(r.feitas.map((f) => [f.acao, f.motivo]), [['merge', 'branch-atualizada']], JSON.stringify(r.pendentes));
    assert.ok(fs.existsSync(path.join(wt, 'src', 'do-pr.ts')), 'a local avancou ate o head do PR');
    assert.equal(remotaDe(p, branch), exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim());
  } finally { p.limpar(); }
});

test('GO-FIX 2: a thread que espera o dono (pausada) nao tem o PR mesclado nem atualizado', () => {
  const { p, thread, branch, gh } = cenario('rm063-gofix-dono');
  try {
    autorizar(p, ['merge']);
    checkPassou(p, thread);
    gh.abrir(203, branch);
    gh.checks.set(203, [{ name: 'ork-verify', bucket: 'pass' }]);
    const t = lerThread(p.dir, thread);
    gravarThread(p.dir, { ...t, status: 'pausada' });
    const r = conduzirBatida(p.carregado, opcoesDe(gh));
    const pendente = r.pendentes.find((x) => x.acao === 'merge');
    assert.deepEqual([pendente?.motivo, pendente?.detalhe, pendente?.comando], ['pendencia-do-dono', 'thread pausada', `ork thread status ${thread}`]);
    assert.equal(merges(gh).length, 0);
  } finally { p.limpar(); }
});

test('GO-FIX 5: o merge da base que ficou so nesta maquina (sem --enviar, ou push falho) e empurrado na batida seguinte', () => {
  const { p, thread, wt, branch, gh } = cenario('rm063-gofix-push');
  try {
    autorizar(p, ['merge']);
    mainAnda(p);
    const local = atualizarBranchDaThread(p.carregado, thread);
    assert.deepEqual([local.acao, local.acao === 'mesclada' && local.enviada], ['mesclada', false]);
    gh.abrir(204, branch, { mergeStateStatus: 'BEHIND' });
    gh.checks.set(204, [{ name: 'ork-verify', bucket: 'pass' }]);
    const r = conduzirBatida(p.carregado, opcoesDe(gh));
    assert.deepEqual(r.feitas.map((f) => [f.acao, f.motivo]), [['merge', 'branch-atualizada']], JSON.stringify(r.pendentes));
    assert.equal(remotaDe(p, branch), exec('git', ['rev-parse', 'HEAD'], wt).stdout.trim(), 'o merge local chegou ao PR');
  } finally { p.limpar(); }
});

test('GO-FIX 6: o comando do merge dado ao dono nunca executa o titulo do PR', () => {
  const pr: PrAberto = { numero: 9, titulo: 'fatia $(id) `whoami` "x"', branch: 'ork/x', head: 'b'.repeat(40), base: 'main', rascunho: false,
    mergeable: 'MERGEABLE', estado: 'CLEAN', url: null };
  const cmd = comandoDoMerge(FORJA, 'ork-x', pr);
  assert.match(cmd, /--subject 'ship\(ork-x\): fatia \$\(id\) `whoami` "x" \(#9\)'$/);
  const eco = spawnSync('sh', ['-c', `printf '%s' ${cmd.slice(cmd.indexOf('--subject ') + 10)}`], { encoding: 'utf8' });
  assert.equal(eco.stdout, 'ship(ork-x): fatia $(id) `whoami` "x" (#9)', 'o shell recebe o titulo como texto');
});

test('GO-FIX 8 e 9: a falha passageira do gh nao apaga o merge pendente, e a espera de mais de 2 h vira item do dono', () => {
  const { p, thread, branch, gh } = cenario('rm063-gofix-espera');
  try {
    autorizar(p, ['merge']);
    gh.abrir(205, branch, { mergeStateStatus: 'BLOCKED' });
    gh.checks.set(205, [{ name: 'ork-verify', bucket: 'pending' }]);
    const primeira = baterConducao(p.carregado, opcoesDe(gh));
    const desde = primeira.ocupada ? null : primeira.pendentes.find((x) => x.acao === 'merge')?.desdeEm;
    assert.ok(desde);
    const quebrado: ExecutorDoGh = (args) => args[1] === 'list' ? { status: 1, stdout: '', stderr: 'gh: connection reset' } : gh.executor(args, 1000);
    const segunda = baterConducao(p.carregado, opcoesDe(gh, { executorGh: quebrado }));
    assert.deepEqual(segunda.ocupada ? null : segunda.pendentes.filter((x) => x.acao === 'merge').map((x) => [x.thread, x.desdeEm]), [[thread, desde]]);
    // A espera envelhece: com o desde de 3 h atras, o pulse a leva ao dono.
    const arquivo = path.join(p.dir, '.orkastery', 'monitor', ARQUIVO_DA_BATIDA);
    const retrato = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    retrato.pendentes = retrato.pendentes.map((x: { desdeEm: string }) => ({ ...x, desdeEm: new Date(Date.now() - 3 * HORA).toISOString() }));
    fs.writeFileSync(arquivo, JSON.stringify(retrato));
    const pendentes = pendentesDaUltimaBatida(p.dir, new Date().toISOString());
    assert.deepEqual(pendentes.map((x) => [x.acao, x.motivoDoBloqueio]), [['merge', 'espera-longa']]);
    const item = montarPulse(p.carregado, { fontes: () => ({}), consulta: { ok: true, sessoes: [], detalhe: '' } }).precisaDeHumanoAgora
      .find((i) => i.id === `varredura:merge:${thread}`);
    assert.match(String(item?.pergunta), /a batida espera há mais de 2 h/);
  } finally { p.limpar(); }
});

test('GO-FIX 10: o gh pr merge que responde sem a prova na base vai ao ledger como tentativa', () => {
  const { p, thread, branch, gh } = cenario('rm063-gofix-fila');
  try {
    autorizar(p, ['merge']);
    checkPassou(p, thread);
    gh.abrir(206, branch);
    gh.checks.set(206, [{ name: 'ork-verify', bucket: 'pass' }]);
    // A fila de merge do GitHub: o merge responde 0 e so entra depois.
    const enfileirado: ExecutorDoGh = (args, prazo) => args[1] === 'merge' ? { status: 0, stdout: 'enfileirado', stderr: '' } : gh.executor(args, prazo);
    const r = conduzirBatida(p.carregado, opcoesDe(gh, { executorGh: enfileirado }));
    assert.deepEqual(r.pendentes.filter((x) => x.acao === 'merge').map((x) => [x.resultado, x.motivo]), [['espera', 'merge-sem-prova']]);
    const tentativa = lerLedger(dirThread(p.dir, thread)).filter((e) => e.acao === 'merge');
    assert.deepEqual(tentativa.map((e) => [e.resultado, e.motivo]), [['recusada', 'merge-sem-prova']]);
  } finally { p.limpar(); }
});

test('RM-064 T5: com a Sentinela ligada, a batida retoma so a thread parada por cota e cede o despacho comum', () => {
  const { p, thread } = cenario('rm064-t5-batida-cota', { pedido: 'implemente a fatia simulada', semProduto: true });
  const comum = novaThread(p.carregado, { nome: 'fase comum', modo: 'auto', pedido: 'implemente outra fatia' }).thread;
  try {
    // A thread da cota: a sessao caiu por runtime.quota-exhausted depois do despacho; o passo do nucleo e a retomada.
    const d = despacharNoLedger(p.dir, thread, 'GOAL', 4, false);
    registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.despachoFalhou, { fase: 'GOAL', motivo: 'runtime.quota-exhausted',
      sessionId: d.sessionId });
    // A outra thread concluiu o GOAL: o passo comum e despachar o PLAN.
    const o = despacharNoLedger(p.dir, comum.id, 'GOAL', 5, false);
    concluirFase(p.dir, comum.id, 'GOAL', o.sessionId);
    const retomadas: string[] = [];
    const despachos: string[] = [];
    const extra: OpcoesDaBatida = {
      retomar: (_c, t) => { retomadas.push(t); return { automatica: true, ok: true, detalhe: 'retomada noutra conta' }; },
      despachar: (_c, t, fase) => {
        despachos.push(`${t}:${fase}`);
        return { ok: true, detalhe: 'sessão 11111111', sessionId: '11111111-2222-3333-4444-555555555555' };
      },
    };
    autorizar(p, ['despachar']);
    baterSentinela(p.dir, { sessao: 'sessao-do-dono' });
    const comSentinela = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), extra));
    assert.equal(comSentinela.sentinela, true);
    assert.deepEqual([retomadas, despachos], [[thread], []], 'a batida fica so com a retomada por cota');
    assert.deepEqual(comSentinela.feitas.filter((f) => f.thread === thread).map((f) => f.detalhe), ['retomada noutra conta']);
    // Sem a Sentinela, a batida conduz os dois passos.
    fs.rmSync(path.join(p.dir, '.orkastery', 'conducao'), { recursive: true, force: true });
    const semSentinela = conduzirBatida(p.carregado, opcoesDe(ghFalso(p), extra));
    assert.equal(semSentinela.sentinela, false);
    assert.deepEqual([retomadas, despachos], [[thread, thread], [`${comum.id}:PLAN`]]);
  } finally { p.limpar(); }
});
