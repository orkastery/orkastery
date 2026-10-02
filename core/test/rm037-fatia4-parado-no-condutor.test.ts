/**
 * RM-037 (fatia 4, item 1): o trabalho parado no condutor, com fixtures de ledger.
 *
 * Em 01/10/2026 tres threads terminaram de madrugada com o verify verde e ficaram 15 h sem push e sem
 * PR; de dia, PRs ficaram horas verdes sem merge e um ficou 4h38 com o check vermelho sem fase. Cada
 * caso do pedido tem aqui a fixture que o produz e a contraprova que nao deve produzir nada. Projeto,
 * threads, sessoes, PRs e checks SIMULADOS; o executor do `gh` conta as chamadas e nunca toca a rede.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { exec } from '../src/util';
import {
  CONTRATO_PRS, entregasDoProjeto, esperaDoCondutor, ExecutorDoGh, gravarRetratoDePrs, LeituraDePrs, LIMIAR_PARADO_NO_CONDUTOR_MIN,
  lerPrsDaForja, lerRetratoDePrs, PrDaForja, RetratoDePrs,
} from '../src/parado-no-condutor';
import { lerLedger } from '../src/ledger';
import { SessaoNoRadar } from '../src/types';

const AGORA = '2026-10-02T01:21:00.000Z'; // 22:21 de 01/10 em Brasilia
const FIM = '2026-10-01T07:28:00.000Z';   // 04:28: o turno acabou 15 h antes
const SHA_DO_SENSOR = 'a'.repeat(64);
const git = (dir: string, ...args: string[]) => {
  const r = exec('git', args, dir);
  assert.ok(r.ok, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const depois = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60000).toISOString();

type Projeto = ReturnType<typeof projetoTemporario>;

/** Uma thread #Auto com a branch `ork/<slug>` e um commit de produto; publicada quando pedido. */
function threadComProduto(p: Projeto, nome: string, opcoes: { publicar?: boolean; produto?: boolean } = {}) {
  const { thread: t } = novaThread(p.carregado, { nome, modo: 'auto' });
  const branch = `ork/${t.slug}`;
  git(p.dir, 'branch', branch, 'main');
  if (opcoes.produto !== false) {
    git(p.dir, 'checkout', '-q', branch);
    fs.writeFileSync(path.join(p.dir, `${t.slug}.txt`), 'produto SIMULADO\n');
    git(p.dir, 'add', '--', `${t.slug}.txt`);
    git(p.dir, 'commit', '-q', '-m', `produto de ${t.slug}`);
    git(p.dir, 'checkout', '-q', 'main');
  }
  if (opcoes.publicar) git(p.dir, 'push', '-q', 'origin', branch);
  return { t, branch, dir: dirThread(p.dir, t.id), head: git(p.dir, 'rev-parse', branch) };
}

/** O despacho do bloco e o fim de turno que o observador grava: Stop e sessao `blocked`, `human.pending`. */
function turnoDoObservador(dir: string, id: string, n: number, opcoes: { fim?: string; pausaAoFim?: boolean; despacho?: string } = {}) {
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const despacho = opcoes.despacho ?? '2026-10-01T05:06:17.000Z', despachoEm = depois(despacho, 0.001);
  const fim = opcoes.fim ?? FIM;
  registrar(dir, id, 'phase_dispatch', { ts: despacho, fase: 'GOAL', slug: `${id}-full`, modo: 'auto',
    bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', pausaAoFim: opcoes.pausaAoFim ?? false, runtime: 'claude-bg', sessionId });
  registrar(dir, id, 'runtime_stop', { ts: depois(fim, -0.2), fase: 'GOAL', sessionId, runtime: 'claude-bg', despachoEm,
    fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
  const comum = { ts: fim, fase: 'GOAL', sessionId, despachoEm, classificacao: 'gate_blocked', motivo: 'human.pending',
    runtime: 'claude-bg', fonte: 'Stop correlacionado e sessão viva à espera humana (blocked); SIMULADO; o humano decide',
    estadoNativo: 'blocked', statusNativo: 'idle', ok: false, estado: 'bloqueada', stop: { ts: depois(fim, -0.2), sensorEventId: SHA_DO_SENSOR },
    provaOrk: { ok: true, fonte: 'SIMULADO' }, gate: 'phase.dispatch', origem: 'sessions.watch' };
  registrar(dir, id, 'gate_blocked', comum);
  registrar(dir, id, 'phase_result', comum);
  return { sessionId, despachoEm };
}

const pr = (numero: number, branch: string, head: string, extra: Partial<PrDaForja> = {}): PrDaForja => ({
  numero, branch, head, estado: 'aberto', rascunho: false, url: `https://github.com/exemplo/simulado/pull/${numero}`,
  criadoEm: '2026-10-01T22:00:00.000Z', mescladoEm: null, checks: [], ...extra });

const retratoCom = (prs: PrDaForja[], lidoEm = AGORA): RetratoDePrs => ({ contrato: CONTRATO_PRS, lidoEm, repositorio: 'exemplo/simulado', base: 'main', prs });

function contador(leitura: () => LeituraDePrs | null) {
  const c = { chamadas: 0, ler: () => { c.chamadas++; return leitura(); } };
  return c;
}

test('caso 1: fase terminada com a branch sem push vira "publicar a branch", sem ler a forja', () => {
  const p = projetoTemporario('fatia4-sem-push', true);
  try {
    const a = threadComProduto(p, 'sem push');
    turnoDoObservador(a.dir, a.t.id, 1);
    const prs = contador(() => ({ ok: true, retrato: retratoCom([]) }));
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: prs.ler });
    assert.equal(prs.chamadas, 0, 'sem branch publicada nao ha o que ler na forja');
    assert.equal(r.parados.length, 1);
    const [parado] = r.parados;
    assert.equal(parado.caso, 'sem-push');
    assert.equal(parado.thread, a.t.id);
    assert.equal(parado.proximoPasso, `publicar a branch ${a.branch} e abrir o PR`);
    assert.equal(parado.desdeEm, depois(FIM, -0.2), 'desde o Stop que encerrou o turno');
    assert.ok(parado.paradoHaMin >= 15 * 60);
    assert.ok(r.doCondutor.gates.has(`${a.t.id}|GOAL`), 'o human.pending do observador sai do dono');
    const estado = r.estados.find(e => e.thread === a.t.id)!;
    assert.equal(estado.resumo, 'branch com commits sem push');
    assert.equal(estado.publicada, false);
  } finally { p.limpar(); }
});

test('caso 2: branch publicada sem PR vira "abrir o PR"; a forja e lida uma vez so', () => {
  const p = projetoTemporario('fatia4-sem-pr', true);
  try {
    const a = threadComProduto(p, 'publicada sem pr', { publicar: true });
    const b = threadComProduto(p, 'outra publicada', { publicar: true });
    turnoDoObservador(a.dir, a.t.id, 2);
    turnoDoObservador(b.dir, b.t.id, 3);
    const prs = contador(() => ({ ok: true, retrato: retratoCom([]) }));
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: prs.ler });
    assert.equal(prs.chamadas, 1, 'uma leitura da forja para todas as threads');
    assert.deepEqual(r.parados.map(x => x.caso), ['sem-pr', 'sem-pr']);
    assert.equal(r.parados.find(x => x.thread === a.t.id)!.proximoPasso, `abrir o PR da branch ${a.branch}`);
    assert.equal(r.estados.find(e => e.thread === a.t.id)!.resumo, 'branch publicada sem PR');
  } finally { p.limpar(); }
});

test('caso 3: PR com os checks verdes e sem merge vira "mergear o PR", desde o ultimo check', () => {
  const p = projetoTemporario('fatia4-pr-verde', true);
  try {
    const a = threadComProduto(p, 'pr verde', { publicar: true });
    turnoDoObservador(a.dir, a.t.id, 4);
    const checks = [{ nome: 'ork-verify', situacao: 'verde' as const, concluidoEm: '2026-10-01T22:01:39.000Z' },
      { nome: 'documentacao', situacao: 'verde' as const, concluidoEm: '2026-10-01T21:57:36.000Z' }];
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([pr(39, a.branch, a.head, { checks })]) }) });
    assert.equal(r.parados.length, 1);
    assert.equal(r.parados[0].caso, 'pr-verde');
    assert.equal(r.parados[0].proximoPasso, 'mergear o PR #39');
    assert.equal(r.parados[0].desdeEm, '2026-10-01T22:01:39.000Z');
    assert.equal(r.parados[0].pr, 39);
    assert.equal(r.estados[0].resumo, 'PR #39 com os checks verdes, esperando o merge');
    // Checks ainda rodando: nao e parada, e o estado diz isso.
    const rodando = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([pr(39, a.branch, a.head,
      { checks: [...checks, { nome: 'nucleo', situacao: 'pendente', concluidoEm: null }] })]) }) });
    assert.equal(rodando.parados.length, 0);
    assert.equal(rodando.estados[0].resumo, 'PR #39 aberto, checks em andamento');
  } finally { p.limpar(); }
});

test('caso 4: PR com check vermelho sem fase despachada depois; despacho depois do vermelho tira a parada', () => {
  const p = projetoTemporario('fatia4-pr-vermelho', true);
  try {
    const a = threadComProduto(p, 'pr vermelho', { publicar: true });
    turnoDoObservador(a.dir, a.t.id, 5);
    const vermelho = pr(40, a.branch, a.head, { checks: [{ nome: 'ork-verify', situacao: 'vermelho', concluidoEm: '2026-10-01T22:07:15.000Z' },
      { nome: 'documentacao', situacao: 'verde', concluidoEm: '2026-10-01T22:00:23.000Z' }] });
    const ler = () => ({ ok: true as const, retrato: retratoCom([vermelho]) });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler });
    assert.equal(r.parados[0].caso, 'pr-vermelho');
    assert.equal(r.parados[0].proximoPasso, 'corrigir o check ork-verify vermelho do PR #40 e despachar a correção');
    assert.equal(r.parados[0].desdeEm, '2026-10-01T22:07:15.000Z');
    assert.equal(r.estados[0].resumo, 'PR #40 aberto com o check ork-verify vermelho');
    // A correcao despachada depois do check: a thread anda, e nao e parada.
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: '2026-10-02T02:45:23.000Z', fase: 'GO', modo: 'auto', pausaAoFim: false,
      runtime: 'claude-bg', sessionId: '00000000-0000-4000-8000-000000000099' });
    const corrigindo = entregasDoProjeto(p.carregado, { quando: '2026-10-02T03:30:00.000Z', lerPrs: ler });
    assert.equal(corrigindo.parados.length, 0);
    assert.equal(corrigindo.estados[0].resumo, 'PR #40 aberto com o check ork-verify vermelho', 'o estado continua dito');
  } finally { p.limpar(); }
});

test('caso 5: sessao blocked sem pergunta de verdade e sem produto vira "ler o fim da sessao"', () => {
  const p = projetoTemporario('fatia4-sessao', true);
  try {
    const a = threadComProduto(p, 'sem produto', { produto: false });
    const { sessionId } = turnoDoObservador(a.dir, a.t.id, 6);
    const r = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(r.parados.length, 1);
    assert.equal(r.parados[0].caso, 'sessao-sem-pergunta');
    assert.equal(r.parados[0].proximoPasso, `ler o fim da sessão ${sessionId.slice(0, 8)} (ork sessions logs ${sessionId.slice(0, 8)}) e seguir a thread`);
    assert.ok(r.doCondutor.sessoes.has(sessionId));
  } finally { p.limpar(); }
});

test('caso 5 no radar: sessao blocked sem menu de thread fechada e sobra, com "encerrar a sessao"', () => {
  const p = projetoTemporario('fatia4-sobra', true);
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'fechada', modo: 'auto' });
    const fechada = lerThread(p.dir, t.id); fechada.status = 'fechada'; gravarThread(p.dir, fechada);
    const sessionId = '00000000-0000-4000-8000-000000000077';
    const radar = (alternativas: string[]): SessaoNoRadar => ({ id: sessionId.slice(0, 8), sessionId, nome: 'SIMULADA', cwd: '/tmp/simulada',
      kind: 'background', estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: alternativas.length ? 'hitl.pergunta' : 'hitl.desconhecido',
      jobVivo: true, precisaDeHumano: true, detalhe: 'SIMULADO', desdeEm: '2026-10-01T03:00:00.000Z', idadeMin: 1300, pergunta: '',
      alternativas, thread: { id: t.id, fase: 'CHECK', slug: t.slug }, recomendacao: '', comandos: { logs: '', attach: '', parar: '' },
      acimaDoLimite: true, bloqueadaDesdeEm: '2026-10-01T09:00:00.000Z', paradaHaMin: 980 });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [radar([])] });
    assert.equal(r.parados.length, 1);
    assert.equal(r.parados[0].proximoPasso, `encerrar a sessão ${sessionId.slice(0, 8)}, que sobrou da thread fechada (ork sessions stop ${sessionId.slice(0, 8)})`);
    assert.equal(r.parados[0].desdeEm, '2026-10-01T09:00:00.000Z');
    assert.ok(r.doCondutor.sessoes.has(sessionId));
    // Com menu na tela, a pergunta e de verdade: continua do dono.
    const comMenu = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [radar(['1. Sim', '2. Nao'])] });
    assert.equal(comMenu.parados.length, 0);
    assert.equal(comMenu.doCondutor.sessoes.size, 0);
  } finally { p.limpar(); }
});

test('fatia 3 de 01/10: sem phase_result, o Stop sem atividade depois encerra o turno, mesmo com a conducao da sessao de pe', () => {
  const p = projetoTemporario('fatia4-stop', true);
  try {
    const a = threadComProduto(p, 'so o stop', { publicar: true });
    const sessionId = '00000000-0000-4000-8000-000000000010';
    assert.equal(registrarConducaoDaSessao(p.dir, a.t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 48 * 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: null }), true);
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: '2026-10-01T05:06:12.000Z', fase: 'GOAL', modo: 'auto', pausaAoFim: false,
      runtime: 'claude-bg', sessionId });
    registrar(a.dir, a.t.id, 'runtime_stop', { ts: '2026-10-01T06:52:44.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg',
      despachoEm: '2026-10-01T05:06:12.008Z', fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
    const verde = pr(39, a.branch, a.head, { checks: [{ nome: 'ork-verify', situacao: 'verde', concluidoEm: '2026-10-01T22:01:39.000Z' }] });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([verde]) }) });
    assert.equal(r.estados[0].conduzidaAgora, false, 'a sessao que encerrou o turno nao conduz');
    assert.equal(r.parados[0]?.caso, 'pr-verde');
    // Heartbeat da sessao depois do Stop: ela voltou a trabalhar, e conduz.
    registrar(a.dir, a.t.id, 'runtime_event', { ts: '2026-10-01T23:00:00.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg',
      despachoEm: '2026-10-01T05:06:12.008Z', fonte: 'ork sessions event', sensor: 'heartbeat' });
    const voltou = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([verde]) }) });
    assert.equal(voltou.estados[0].conduzidaAgora, true);
    assert.equal(voltou.parados.length, 0);
  } finally { p.limpar(); }
});

test('contraprovas: limiar, conducao por processo, pausa prevista, pergunta aberta, prompt pendente e entrega na base', () => {
  const p = projetoTemporario('fatia4-contraprovas', true);
  try {
    // Abaixo do limiar: o condutor pode estar agindo.
    const a = threadComProduto(p, 'recente');
    turnoDoObservador(a.dir, a.t.id, 20, { fim: depois(AGORA, -(LIMIAR_PARADO_NO_CONDUTOR_MIN - 1)) });
    // Conduzida agora por um processo vivo (o `ork verify` do condutor).
    const b = threadComProduto(p, 'conduzida');
    turnoDoObservador(b.dir, b.t.id, 21);
    const conducao = tomarConducao(p.dir, b.t.id, { canal: 'cli', operacao: 'verify', prazoMs: 60_000 });
    assert.equal(conducao.ok, true);
    // Pausa prevista do modo ao fim do bloco: o veredito e do dono.
    const c = threadComProduto(p, 'pausa prevista');
    turnoDoObservador(c.dir, c.t.id, 22, { pausaAoFim: true });
    // Pergunta estruturada aberta: do dono.
    const d = threadComProduto(p, 'pergunta aberta');
    turnoDoObservador(d.dir, d.t.id, 23);
    registrar(d.dir, d.t.id, 'hitl_requested', { ts: '2026-10-01T07:00:00.000Z', pedido: { contrato: 'ork.hitl/v2', classe: 'pergunta',
      id: 'pedido-SIMULADO', thread: d.t.id, fase: 'GOAL', criadoEm: '2026-10-01T07:00:00.000Z', prazo: '2026-10-09T07:00:00.000Z',
      aoExpirar: 'continuar-esperando', alvo: { tipo: 'session', sessionId: 'x' } } });
    // Prompt de permissao pendente: do dono.
    const e = threadComProduto(p, 'prompt pendente');
    const { sessionId } = turnoDoObservador(e.dir, e.t.id, 24);
    registrar(e.dir, e.t.id, 'sessao_bloqueada', { ts: '2026-10-01T07:28:30.000Z', sessionId, fase: 'GOAL' });
    // Entregue na base pelo merge ship(<thread>): nada a fazer pelo condutor.
    const f = threadComProduto(p, 'entregue', { publicar: true });
    turnoDoObservador(f.dir, f.t.id, 25);
    git(p.dir, 'merge', '-q', '--no-ff', '-m', `ship(${f.t.id}): entregue SIMULADO`, f.branch);
    git(p.dir, 'push', '-q', 'origin', 'main');

    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([]) }) });
    if (conducao.ok) conducao.liberar();
    assert.deepEqual(r.parados, [], JSON.stringify(r.parados));
    const doCondutor = [...r.doCondutor.gates];
    for (const dono of [c, d, e]) assert.ok(!doCondutor.includes(`${dono.t.id}|GOAL`), `${dono.t.id} continua do dono`);
    assert.ok(doCondutor.includes(`${a.t.id}|GOAL`) && doCondutor.includes(`${b.t.id}|GOAL`), 'abaixo do limiar e conduzida ainda nao sao do dono');
    assert.equal(r.estados.find(x => x.thread === b.t.id)!.conduzidaAgora, true);
    assert.equal(r.estados.find(x => x.thread === f.t.id)!.resumo, null, 'entregue nao tem estado de entrega pendente');
    assert.equal(esperaDoCondutor(lerThread(p.dir, d.t.id), lerLedger(d.dir), AGORA), null);
  } finally { p.limpar(); }
});

test('falha da forja e "PR nao lido", nunca "sem PR"; a resposta do gh e validada', () => {
  const p = projetoTemporario('fatia4-forja', true);
  try {
    const a = threadComProduto(p, 'forja', { publicar: true });
    turnoDoObservador(a.dir, a.t.id, 30);
    // O remoto da fixture e um repositorio local; para a forja, ele passa a apontar para um GitHub SIMULADO.
    git(p.dir, 'remote', 'set-url', 'origin', 'https://github.com/exemplo/simulado.git');
    const chamadas: string[][] = [];
    const falha: ExecutorDoGh = (args) => { chamadas.push([...args]); return { status: 1, stdout: '', stderr: 'HTTP 502: SIMULADO' }; };
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => lerPrsDaForja(p.carregado, { quando: AGORA, executor: falha }) });
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0].slice(0, 4), ['pr', 'list', '--repo', 'exemplo/simulado']);
    assert.equal(r.parados.length, 0, 'sem leitura nao se afirma "sem PR"');
    assert.match(r.estados[0].prNaoLido ?? '', /gh pr list falhou \(1\): HTTP 502: SIMULADO/);
    assert.equal(r.estados[0].resumo, 'branch publicada, PR não lido');
    // Resposta fora do formato tambem e "nao lido".
    const torta: ExecutorDoGh = () => ({ status: 0, stdout: '{"nao":"lista"}', stderr: '' });
    const lida = lerPrsDaForja(p.carregado, { quando: AGORA, executor: torta });
    assert.equal(lida.ok, false);
    // Resposta boa: PR aberto com CheckRun e StatusContext, PR de outra base e de fork ficam de fora.
    const boa: ExecutorDoGh = () => ({ status: 0, stderr: '', stdout: JSON.stringify([
      { number: 40, state: 'OPEN', headRefName: a.branch, headRefOid: a.head, baseRefName: 'main', isDraft: false, isCrossRepository: false,
        url: 'https://github.com/exemplo/simulado/pull/40', createdAt: '2026-10-01T22:00:01Z', mergedAt: null,
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-10-01T22:00:07Z', completedAt: '2026-10-01T22:07:15Z' },
          { __typename: 'StatusContext', context: 'externo', state: 'SUCCESS', startedAt: '2026-10-01T22:01:00Z' },
          { __typename: 'CheckRun', name: 'nucleo', status: 'IN_PROGRESS', conclusion: '', completedAt: '0001-01-01T00:00:00Z' }] },
      { number: 41, state: 'OPEN', headRefName: 'outra', headRefOid: 'b'.repeat(40), baseRefName: 'release', isDraft: false, isCrossRepository: false, statusCheckRollup: [] },
      { number: 42, state: 'OPEN', headRefName: 'fork', headRefOid: 'c'.repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: true, statusCheckRollup: [] },
      { number: 7, state: 'MERGED', headRefName: 'antiga', headRefOid: 'd'.repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: false,
        mergedAt: '2026-09-30T10:00:00Z', statusCheckRollup: null }]) });
    const ok = lerPrsDaForja(p.carregado, { quando: AGORA, executor: boa });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.deepEqual(ok.retrato.prs.map(x => x.numero), [40, 7]);
    assert.deepEqual(ok.retrato.prs[0].checks.map(c => [c.nome, c.situacao, c.concluidoEm]), [
      ['ork-verify', 'vermelho', '2026-10-01T22:07:15.000Z'], ['externo', 'verde', '2026-10-01T22:01:00.000Z'], ['nucleo', 'pendente', null]]);
    // O retrato vai e volta inteiro; arquivo adulterado nao vale.
    gravarRetratoDePrs(p.dir, ok.retrato);
    assert.deepEqual(lerRetratoDePrs(p.dir), ok.retrato);
    const arquivo = path.join(p.dir, '.orkastery', 'monitor', 'prs.json');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    fs.writeFileSync(arquivo, JSON.stringify({ ...ok.retrato, contrato: 'outro/v1' }));
    assert.equal(lerRetratoDePrs(p.dir), null);
  } finally { p.limpar(); }
});

test('remoto que nao e GitHub nao chama o gh', () => {
  const p = projetoTemporario('fatia4-sem-github', true);
  try {
    let chamadas = 0;
    const r = lerPrsDaForja(p.carregado, { quando: AGORA, executor: () => { chamadas++; return { status: 0, stdout: '[]', stderr: '' }; } });
    assert.equal(r.ok, false);
    assert.equal(chamadas, 0);
  } finally { p.limpar(); }
});
