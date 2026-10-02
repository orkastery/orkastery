/**
 * RM-037 (fatia 4, item 1): o trabalho parado no condutor, com fixtures de ledger.
 *
 * Em 01/10/2026 tres threads terminaram de madrugada com o verify verde e ficaram 15 h sem push e sem
 * PR; de dia, PRs ficaram horas verdes sem merge e um ficou 4h38 com o check vermelho sem fase. Cada
 * caso do pedido tem aqui a fixture que o produz e a contraprova que nao deve produzir nada; os achados
 * da rodada 1 do CHECK (pergunta nativa do Codex, PR parado depois de um despacho, carimbo do radar,
 * pedido vencido que espera, lista cortada, checks repetidos, retrato velho) tambem. Projeto, threads,
 * sessoes, PRs e checks SIMULADOS; o executor do `gh` conta as chamadas e nunca toca a rede.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { PedidoHitl, profundidadeDoModo, validarPedidoHitl } from '../src/hitl-contract';
import { exec } from '../src/util';
import {
  CONTRATO_PRS, entregasDoProjeto, esperaDoCondutor, ExecutorDoGh, gravarRetratoDePrs, LeituraDePrs, LIMIAR_PARADO_NO_CONDUTOR_MIN,
  LIMITE_DE_PRS, lerPrsDaForja, lerRetratoDePrs, nomeDeCheck, PrDaForja, RetratoDePrs,
} from '../src/parado-no-condutor';
import { SessaoNoRadar } from '../src/types';

const AGORA = '2026-10-02T01:21:00.000Z'; // 22:21 de 01/10 em Brasilia
const FIM = '2026-10-01T07:28:00.000Z';   // 04:28: o turno acabou 15 h antes
const SHA_DO_SENSOR = 'a'.repeat(64);
const GITHUB_SIMULADO = 'https://github.com/exemplo/simulado.git';
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
  if (opcoes.produto !== false) commitNaBranch(p, branch, `${t.slug}.txt`);
  if (opcoes.publicar) git(p.dir, 'push', '-q', 'origin', branch);
  return { t, branch, dir: dirThread(p.dir, t.id), head: git(p.dir, 'rev-parse', branch) };
}

function commitNaBranch(p: Projeto, branch: string, arquivo: string): string {
  git(p.dir, 'checkout', '-q', branch);
  fs.writeFileSync(path.join(p.dir, arquivo), `produto SIMULADO ${randomUUID()}\n`);
  git(p.dir, 'add', '--', arquivo);
  git(p.dir, 'commit', '-q', '-m', `produto em ${arquivo}`);
  git(p.dir, 'checkout', '-q', 'main');
  return git(p.dir, 'rev-parse', branch);
}

/** O remoto da fixture e um repositorio local; para a forja, ele passa a apontar para um GitHub SIMULADO (depois dos pushes). */
const forjaSimulada = (p: Projeto) => git(p.dir, 'remote', 'set-url', 'origin', GITHUB_SIMULADO);

/** O despacho do bloco e o fim de turno que o observador grava: Stop e sessao `blocked`, `human.pending`. */
function turnoDoObservador(dir: string, id: string, n: number,
  opcoes: { fim?: string; pausaAoFim?: boolean; despacho?: string; fase?: string; bloco?: string; provou?: boolean } = {}) {
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const despacho = opcoes.despacho ?? '2026-10-01T05:06:17.000Z', despachoEm = depois(despacho, 0.001);
  const fim = opcoes.fim ?? FIM, fase = opcoes.fase ?? 'GOAL';
  registrar(dir, id, 'phase_dispatch', { ts: despacho, fase, slug: `${id}-full`, modo: 'auto',
    bloco: opcoes.bloco ?? 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', pausaAoFim: opcoes.pausaAoFim ?? false, runtime: 'claude-bg', sessionId });
  registrar(dir, id, 'runtime_stop', { ts: depois(fim, -0.2), fase, sessionId, runtime: 'claude-bg', despachoEm,
    fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
  const comum = { ts: fim, fase, sessionId, despachoEm, classificacao: 'gate_blocked', motivo: 'human.pending',
    runtime: 'claude-bg', fonte: 'Stop correlacionado e sessão viva à espera humana (blocked); SIMULADO; o humano decide',
    estadoNativo: 'blocked', statusNativo: 'idle', ok: false, estado: 'bloqueada', stop: { ts: depois(fim, -0.2), sensorEventId: SHA_DO_SENSOR },
    provaOrk: { ok: opcoes.provou ?? true, fonte: 'SIMULADO' }, gate: 'phase.dispatch', origem: 'sessions.watch' };
  registrar(dir, id, 'gate_blocked', comum);
  registrar(dir, id, 'phase_result', comum);
  return { sessionId, despachoEm, stop: depois(fim, -0.2) };
}

const pr = (numero: number, branch: string, head: string, extra: Partial<PrDaForja> = {}): PrDaForja => ({
  numero, branch, head, estado: 'aberto', rascunho: false, url: `https://github.com/exemplo/simulado/pull/${numero}`,
  criadoEm: '2026-10-01T22:00:00.000Z', mescladoEm: null, checks: [], ...extra });

const retratoCom = (prs: PrDaForja[], extra: Partial<RetratoDePrs> = {}): RetratoDePrs =>
  ({ contrato: CONTRATO_PRS, lidoEm: AGORA, repositorio: 'exemplo/simulado', base: 'main', parcial: false, prs, ...extra });

const ler = (retrato: RetratoDePrs) => (): LeituraDePrs => ({ ok: true, retrato });

function contador(leitura: () => LeituraDePrs | null) {
  const c = { chamadas: 0, ler: () => { c.chamadas++; return leitura(); } };
  return c;
}

/** Um pedido de sessao `ork.hitl/v1` valido, do jeito que `abrirPedidoSessao` grava (sem o controle nativo). */
function pedidoDeSessao(thread: string, sessionId: string, criadoEm: string, prazo: string): PedidoHitl {
  const pedido: PedidoHitl = { contrato: 'ork.hitl/v1', id: randomUUID(), thread, fase: 'GOAL', modo: 'auto',
    alvo: { tipo: 'session', sessionId, runtime: 'claude-bg' }, motivo: 'hitl.pergunta', pergunta: 'Pergunta SIMULADA da sessão?',
    opcoes: [{ numero: 1, texto: 'Sim', acao: 'responder' }, { numero: 2, texto: 'Não', acao: 'responder' }],
    recomendacao: 'Responda com o número da opção.', criadoEm, prazo, acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 4096 }, profundidade: profundidadeDoModo('auto') };
  validarPedidoHitl(pedido);
  return pedido;
}

test('caso 1: fase terminada com a branch sem push vira "publicar a branch", sem ler a forja', () => {
  const p = projetoTemporario('fatia4-sem-push', true);
  try {
    const a = threadComProduto(p, 'sem push');
    turnoDoObservador(a.dir, a.t.id, 1);
    const prs = contador(ler(retratoCom([])));
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: prs.ler });
    assert.equal(prs.chamadas, 0, 'sem branch publicada nao ha o que ler na forja');
    assert.equal(r.parados.length, 1);
    const [parado] = r.parados;
    assert.equal(parado.caso, 'sem-push');
    assert.equal(parado.proximoPasso, `publicar a branch ${a.branch} e abrir o PR`);
    assert.equal(parado.desdeEm, depois(FIM, -0.2), 'desde o Stop que encerrou o turno');
    assert.ok(parado.paradoHaMin >= 15 * 60);
    assert.ok(r.doCondutor.gates.has(`${a.t.id}|GOAL`), 'o human.pending do observador sai do dono');
    assert.equal(r.estados.find(e => e.thread === a.t.id)!.resumo, 'branch com commits sem push');
  } finally { p.limpar(); }
});

test('caso 2: branch publicada sem PR vira "abrir o PR"; a forja e lida uma vez so; PR fechado e dito', () => {
  const p = projetoTemporario('fatia4-sem-pr', true);
  try {
    const a = threadComProduto(p, 'publicada sem pr', { publicar: true });
    const b = threadComProduto(p, 'outra publicada', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 2);
    turnoDoObservador(b.dir, b.t.id, 3);
    const prs = contador(ler(retratoCom([pr(9, b.branch, b.head, { estado: 'fechado' })])));
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: prs.ler });
    assert.equal(prs.chamadas, 1, 'uma leitura da forja para todas as threads');
    assert.deepEqual(r.parados.map(x => x.caso), ['sem-pr', 'sem-pr']);
    assert.equal(r.parados.find(x => x.thread === a.t.id)!.proximoPasso, `abrir o PR da branch ${a.branch}`);
    assert.equal(r.parados.find(x => x.thread === b.t.id)!.proximoPasso,
      `abrir de novo o PR da branch ${b.branch} (o PR #9 foi fechado sem merge)`);
    assert.equal(r.estados.find(e => e.thread === a.t.id)!.resumo, 'branch publicada sem PR');
    assert.equal(r.estados.find(e => e.thread === b.t.id)!.resumo, 'branch publicada, PR #9 fechado sem merge');
  } finally { p.limpar(); }
});

test('caso 3: PR verde sem merge vira "mergear o PR"; sem checks e rascunho tambem; checks rodando nao', () => {
  const p = projetoTemporario('fatia4-pr-verde', true);
  try {
    const a = threadComProduto(p, 'pr verde', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 4);
    const checks = [{ nome: 'ork-verify', situacao: 'verde' as const, concluidoEm: '2026-10-01T22:01:39.000Z' },
      { nome: 'documentacao', situacao: 'verde' as const, concluidoEm: '2026-10-01T21:57:36.000Z' }];
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([pr(39, a.branch, a.head, { checks })])) });
    assert.equal(r.parados[0]?.caso, 'pr-verde');
    assert.equal(r.parados[0].proximoPasso, 'mergear o PR #39');
    assert.equal(r.parados[0].desdeEm, '2026-10-01T22:01:39.000Z', 'desde o ultimo check, depois do fim do turno');
    assert.equal(r.parados[0].prLidoEm, AGORA);
    assert.equal(r.estados[0].resumo, 'PR #39 com os checks verdes, esperando o merge');
    const rascunho = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([pr(39, a.branch, a.head, { checks, rascunho: true })])) });
    assert.equal(rascunho.parados[0].proximoPasso, 'tirar o PR #39 do rascunho e mergear');
    assert.equal(rascunho.estados[0].resumo, 'PR #39 em rascunho, com os checks verdes');
    const semChecks = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([pr(39, a.branch, a.head)])) });
    assert.equal(semChecks.parados[0].proximoPasso, 'mergear o PR #39, que não tem checks');
    assert.equal(semChecks.estados[0].resumo, 'PR #39 aberto, sem checks, esperando o merge');
    // Checks ainda rodando: o PR nao esta parado; o fim de turno, sim, e volta como linha (nada some do dono sem voltar).
    const rodando = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([pr(39, a.branch, a.head,
      { checks: [...checks, { nome: 'nucleo', situacao: 'pendente', concluidoEm: null }] })])) });
    assert.equal(rodando.estados[0].resumo, 'PR #39 aberto, checks em andamento');
    assert.equal(rodando.parados[0]?.proximoPasso, 'acompanhar os checks do PR #39, que seguem em andamento');
  } finally { p.limpar(); }
});

test('caso 4: PR vermelho sem fase depois; a correcao rodando tira a parada; a correcao que terminou sem push a devolve', () => {
  const p = projetoTemporario('fatia4-pr-vermelho', true);
  try {
    const a = threadComProduto(p, 'pr vermelho', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 5);
    const vermelho = pr(40, a.branch, a.head, { checks: [{ nome: 'ork-verify', situacao: 'vermelho', concluidoEm: '2026-10-01T22:07:15.000Z' },
      { nome: 'documentacao', situacao: 'verde', concluidoEm: '2026-10-01T22:00:23.000Z' }] });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([vermelho])) });
    assert.equal(r.parados[0].caso, 'pr-vermelho');
    assert.equal(r.parados[0].proximoPasso, 'corrigir o check ork-verify vermelho do PR #40 e despachar a correção');
    assert.equal(r.parados[0].desdeEm, '2026-10-01T22:07:15.000Z');
    assert.equal(r.estados[0].resumo, 'PR #40 aberto com o check ork-verify vermelho');
    // A correcao despachada depois do check e ainda trabalhando: a thread anda.
    const sessao = '00000000-0000-4000-8000-000000000099', correcao = '2026-10-02T02:45:23.000Z';
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: correcao, fase: 'GO', modo: 'auto', pausaAoFim: false, runtime: 'claude-bg', sessionId: sessao });
    const corrigindo = entregasDoProjeto(p.carregado, { quando: '2026-10-02T03:30:00.000Z',
      lerPrs: ler(retratoCom([vermelho], { lidoEm: '2026-10-02T03:30:00.000Z' })) });
    assert.equal(corrigindo.parados.length, 0);
    assert.equal(corrigindo.estados[0].resumo, 'PR #40 aberto com o check ork-verify vermelho', 'o estado continua dito');
    // A correcao terminou sem push novo e o check segue vermelho: volta a ser do condutor, desde o fim dela (B2 do CHECK).
    registrar(a.dir, a.t.id, 'phase_result', { ts: '2026-10-02T02:55:00.000Z', fase: 'GO', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    const terminou = entregasDoProjeto(p.carregado, { quando: '2026-10-02T03:30:00.000Z',
      lerPrs: ler(retratoCom([vermelho], { lidoEm: '2026-10-02T03:30:00.000Z' })) });
    assert.equal(terminou.parados[0]?.caso, 'pr-vermelho');
    assert.equal(terminou.parados[0].desdeEm, '2026-10-02T02:55:00.000Z');
    // O commit da correcao ficou sem push: o passo e publicar no PR que ja existe, nunca abrir outro.
    commitNaBranch(p, a.branch, 'correcao.txt');
    const semPush = entregasDoProjeto(p.carregado, { quando: '2026-10-02T03:30:00.000Z',
      lerPrs: ler(retratoCom([vermelho], { lidoEm: '2026-10-02T03:30:00.000Z' })) });
    assert.equal(semPush.parados[0]?.proximoPasso, `publicar os commits novos da branch ${a.branch} no PR #40`);
  } finally { p.limpar(); }
});

test('B2 do CHECK: PR verde e o SHIP despachado depois terminou sem merge: volta a ser do condutor', () => {
  const p = projetoTemporario('fatia4-ship-sem-merge', true);
  try {
    const a = threadComProduto(p, 'ship sem merge', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 6);
    const verde = pr(41, a.branch, a.head, { checks: [{ nome: 'ork-verify', situacao: 'verde', concluidoEm: '2026-10-01T22:01:00.000Z' }] });
    turnoDoObservador(a.dir, a.t.id, 7, { despacho: '2026-10-01T22:30:00.000Z', fim: '2026-10-01T22:40:00.000Z', fase: 'SHIP', bloco: 'SHIP' });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([verde])) });
    assert.equal(r.parados[0]?.caso, 'pr-verde');
    assert.equal(r.parados[0].proximoPasso, 'mergear o PR #41');
    assert.equal(r.parados[0].desdeEm, depois('2026-10-01T22:40:00.000Z', -0.2), 'desde o fim do SHIP, nao do check');
    assert.ok(r.doCondutor.gates.has(`${a.t.id}|SHIP`));
  } finally { p.limpar(); }
});

test('fase seguinte: no #Auto depois do bloco; no #Maestro e no #Classic, fase a fase, sem pular a pausa do dono', () => {
  const p = projetoTemporario('fatia4-fase-seguinte', true);
  try {
    const despachar = (id: string, fase: string) => `despachar a fase ${fase} (ork phase run ${id} ${fase} --prompt "<pedido da fase>")`;
    const a = threadComProduto(p, 'bloco curto do auto');
    turnoDoObservador(a.dir, a.t.id, 8, { fase: 'GO', bloco: 'GOAL-PLAN-GO' });
    // N1 do CHECK (rodada 2): no #Maestro o GOAL sai sozinho no bloco GOAL-PLAN; a seguinte e o PLAN, que tem a pausa do dono.
    const { thread: maestro } = novaThread(p.carregado, { nome: 'goal do maestro', modo: 'maestro' });
    turnoDoObservador(dirThread(p.dir, maestro.id), maestro.id, 81, { fase: 'GOAL', bloco: 'GOAL-PLAN' });
    // No #Classic o GO sai no bloco GO-CHECK: com commit, o passo e o CHECK (pausa do dono), nunca publicar antes.
    const { thread: classico } = novaThread(p.carregado, { nome: 'go do classic', modo: 'classic' });
    const branch = `ork/${classico.slug}`;
    git(p.dir, 'branch', branch, 'main');
    commitNaBranch(p, branch, 'classico.txt');
    turnoDoObservador(dirThread(p.dir, classico.id), classico.id, 82, { fase: 'GO', bloco: 'GO-CHECK' });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA });
    const passo = (id: string) => r.parados.find(x => x.thread === id)?.proximoPasso;
    assert.equal(passo(a.t.id), despachar(a.t.id, 'CHECK'));
    assert.equal(passo(maestro.id), despachar(maestro.id, 'PLAN'));
    assert.equal(passo(classico.id), despachar(classico.id, 'CHECK'));
    assert.ok(r.parados.every(x => x.caso === 'fase-seguinte'), JSON.stringify(r.parados.map(x => x.caso)));
  } finally { p.limpar(); }
});

test('N5 do CHECK (rodada 2): depois do veredito do dono na pausa prevista, o passo volta a ser do condutor', () => {
  const p = projetoTemporario('fatia4-pausa-aprovada', true);
  try {
    const a = threadComProduto(p, 'check aprovado');
    const sessionId = '00000000-0000-4000-8000-000000000083';
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: '2026-10-01T05:00:00.000Z', fase: 'CHECK', modo: 'auto', bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER',
      pausaAoFim: true, runtime: 'claude-bg', sessionId });
    registrar(a.dir, a.t.id, 'phase_result', { ts: FIM, fase: 'CHECK', sessionId, classificacao: 'gate_blocked', motivo: 'human.pending',
      estadoNativo: 'done', ok: false, fonte: 'terminal nativo done com Stop correlacionado; SIMULADO; pausa prevista ao fim do bloco' });
    const antes = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(antes.parados.length, 0, 'antes do veredito, a vez e do dono');
    registrar(a.dir, a.t.id, 'human_gate', { ts: '2026-10-01T09:00:00.000Z', fase: 'CHECK', estado: 'aprovado', pedidoId: 'pedido-SIMULADO' });
    const depoisDoVeredito = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(depoisDoVeredito.parados[0]?.caso, 'sem-push');
    assert.equal(depoisDoVeredito.parados[0].desdeEm, '2026-10-01T09:00:00.000Z', 'A2 da rodada 3: o tempo do condutor conta do veredito');
    // Logo depois do veredito, abaixo do limiar, ainda nao e parada.
    assert.equal(entregasDoProjeto(p.carregado, { quando: '2026-10-01T09:10:00.000Z' }).parados.length, 0);
  } finally { p.limpar(); }
});

test('A1 do CHECK (rodada 3): depois do Stop sem atividade, a lista numerada da tela e a mensagem final; sessao retomada volta ao dono', () => {
  const p = projetoTemporario('fatia4-menu-na-tela', true);
  try {
    const a = threadComProduto(p, 'menu na tela');
    const { sessionId } = turnoDoObservador(a.dir, a.t.id, 84);
    const tela = (extra: Partial<SessaoNoRadar>): SessaoNoRadar => ({ id: sessionId.slice(0, 8), sessionId, nome: 'SIMULADA', cwd: '/tmp/simulada',
      kind: 'background', estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: 'hitl.pergunta', jobVivo: true, precisaDeHumano: true,
      detalhe: 'SIMULADO', desdeEm: '2026-10-01T05:06:17.000Z', idadeMin: 1200, pergunta: 'Qual caminho?', alternativas: ['1. A', '2. B'],
      thread: { id: a.t.id, fase: 'GOAL', slug: a.t.slug }, recomendacao: '', comandos: { logs: '', attach: '', parar: '' },
      acimaDoLimite: true, bloqueadaDesdeEm: '2026-10-01T07:30:00.000Z', paradaHaMin: 1100, ...extra });
    for (const sessao of [tela({}), tela({ tipoDeHitl: null, pergunta: '', alternativas: [] }), tela({ tipoDeHitl: 'hitl.desconhecido', pergunta: '', alternativas: [] })]) {
      const r = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [sessao] });
      assert.equal(r.parados[0]?.caso, 'sem-push', JSON.stringify(r.parados));
      assert.ok(r.doCondutor.turnosEncerrados.has(sessionId), 'o pulse tira a sessao do dono mesmo com a lista na tela');
    }
    // O dono respondeu na tela e a sessao voltou a trabalhar: nao ha fim de turno, e a pergunta nova e dele.
    registrar(a.dir, a.t.id, 'runtime_event', { ts: '2026-10-01T08:00:00.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg',
      despachoEm: '2026-10-01T05:06:17.060Z', fonte: 'ork sessions event', sensor: 'heartbeat' });
    const retomada = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [tela({})] });
    assert.equal(retomada.parados.length, 0, JSON.stringify(retomada.parados));
    assert.ok(!retomada.doCondutor.gates.has(`${a.t.id}|GOAL`) && !retomada.doCondutor.turnosEncerrados.has(sessionId));
    // O turno novo acabou num Stop sem atividade depois: volta a ser do condutor, desde esse Stop.
    registrar(a.dir, a.t.id, 'runtime_stop', { ts: '2026-10-01T08:30:00.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg',
      despachoEm: '2026-10-01T05:06:17.060Z', fonte: 'ork sessions event', sensor: 'stop', sensorEventId: 'c'.repeat(64) });
    const deNovo = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(deNovo.parados[0]?.caso, 'sem-push');
    assert.equal(deNovo.parados[0].desdeEm, '2026-10-01T08:30:00.000Z');
  } finally { p.limpar(); }
});

test('merge na base sem ship_done vira "registrar a entrega"; entrega nova depois do ship volta a ser parada', () => {
  const p = projetoTemporario('fatia4-registro', true);
  try {
    const a = threadComProduto(p, 'mesclada sem registro', { publicar: true });
    turnoDoObservador(a.dir, a.t.id, 9);
    git(p.dir, 'merge', '-q', '--no-ff', '-m', `ship(${a.t.id}): entregue SIMULADO`, a.branch);
    git(p.dir, 'push', '-q', 'origin', 'main');
    const sha = git(p.dir, 'rev-parse', 'main').slice(0, 7);
    const r = entregasDoProjeto(p.carregado, { quando: depois(new Date().toISOString(), 60) });
    assert.equal(r.parados[0]?.caso, 'sem-registro');
    assert.equal(r.parados[0].proximoPasso, `registrar a entrega do merge ${sha} (ork ship registrar-pr ${a.t.id})`);
    // Com o ship_done, a entrega esta feita; o fim de turno que sobrou pede o MASTER.
    registrar(a.dir, a.t.id, 'ship_done', { de: a.branch, para: 'main', mergeSha: git(p.dir, 'rev-parse', 'main'), pushVerificado: true });
    const registrada = entregasDoProjeto(p.carregado, { quando: depois(new Date().toISOString(), 60) });
    assert.equal(registrada.parados[0]?.proximoPasso, `fechar o MASTER da thread (ork master ${a.t.id})`);
    // Commit novo na branch depois do ship: entrega nova, sem push.
    commitNaBranch(p, a.branch, 'segunda-entrega.txt');
    const nova = entregasDoProjeto(p.carregado, { quando: depois(new Date().toISOString(), 60) });
    assert.equal(nova.parados[0]?.caso, 'sem-push');
  } finally { p.limpar(); }
});

test('caso 5: sessao blocked sem pergunta de verdade e sem produto vira "ler o fim da sessao"', () => {
  const p = projetoTemporario('fatia4-sessao', true);
  try {
    const a = threadComProduto(p, 'sem produto', { produto: false });
    const { sessionId } = turnoDoObservador(a.dir, a.t.id, 10);
    const r = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(r.parados.length, 1);
    assert.equal(r.parados[0].caso, 'sessao-sem-pergunta');
    assert.equal(r.parados[0].proximoPasso, `ler o fim da sessão ${sessionId.slice(0, 8)} (ork sessions logs ${sessionId.slice(0, 8)}) e seguir a thread`);
    assert.ok(r.doCondutor.sessoes.has(sessionId));
  } finally { p.limpar(); }
});

test('radar: sobras de thread fechada numa linha; sessao Codex, tela nao lida e sem carimbo continuam do dono', () => {
  const p = projetoTemporario('fatia4-sobra', true);
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'fechada', modo: 'auto' });
    const fechada = lerThread(p.dir, t.id); fechada.status = 'fechada'; gravarThread(p.dir, fechada);
    const sessao = (sessionId: string, extra: Partial<SessaoNoRadar> = {}): SessaoNoRadar => ({ id: sessionId.slice(0, 8), sessionId,
      nome: 'SIMULADA', cwd: '/tmp/simulada', kind: 'background', estadoBruto: 'blocked', classe: 'hitl', tipoDeHitl: 'hitl.desconhecido',
      jobVivo: true, precisaDeHumano: true, detalhe: 'SIMULADO', desdeEm: '2026-10-01T03:00:00.000Z', idadeMin: 1300, pergunta: '',
      alternativas: [], thread: { id: t.id, fase: 'CHECK', slug: t.slug }, recomendacao: '', comandos: { logs: '', attach: '', parar: '' },
      acimaDoLimite: true, bloqueadaDesdeEm: '2026-10-01T09:00:00.000Z', paradaHaMin: 980, ...extra });
    const a = '00000000-0000-4000-8000-0000000000a1', b = '00000000-0000-4000-8000-0000000000b2';
    const r = entregasDoProjeto(p.carregado, { quando: AGORA,
      sessoes: [sessao(a), sessao(b, { bloqueadaDesdeEm: '2026-10-01T08:00:00.000Z' })] });
    assert.equal(r.parados.length, 1, 'uma linha por thread');
    assert.equal(r.parados[0].proximoPasso, `encerrar as sessões ${a.slice(0, 8)} e ${b.slice(0, 8)}, que sobraram da thread fechada ` +
      `(ork sessions stop ${a.slice(0, 8)}; ork sessions stop ${b.slice(0, 8)})`);
    assert.equal(r.parados[0].desdeEm, '2026-10-01T08:00:00.000Z', 'desde o carimbo mais velho');
    assert.ok(r.doCondutor.sessoes.has(a) && r.doCondutor.sessoes.has(b));
    // B1 do CHECK: a sessao nativa do Codex em `blocked` e pergunta estruturada; a tela nao lida nao prova nada.
    for (const dono of [sessao(a, { kind: 'codex-controller', tipoDeHitl: null }), sessao(a, { tipoDeHitl: null }),
      sessao(a, { alternativas: ['1. Sim', '2. Nao'], tipoDeHitl: 'hitl.pergunta' }), sessao(a, { pergunta: 'Posso seguir?' }),
      sessao(a, { tipoDeHitl: 'hitl.credencial' }), sessao(a, { bloqueadaDesdeEm: null })]) {
      const x = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [dono] });
      assert.equal(x.doCondutor.sessoes.size, 0, JSON.stringify({ kind: dono.kind, tipo: dono.tipoDeHitl, desde: dono.bloqueadaDesdeEm }));
      assert.equal(x.parados.length, 0);
    }
  } finally { p.limpar(); }
});

test('fatia 3 de 01/10: sem phase_result, o Stop sem atividade depois encerra o turno, mesmo com a conducao da sessao de pe', () => {
  const p = projetoTemporario('fatia4-stop', true);
  try {
    const a = threadComProduto(p, 'so o stop', { publicar: true });
    forjaSimulada(p);
    const sessionId = '00000000-0000-4000-8000-000000000011';
    assert.equal(registrarConducaoDaSessao(p.dir, a.t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 48 * 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: null }), true);
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: '2026-10-01T05:06:12.000Z', fase: 'GOAL', modo: 'auto', pausaAoFim: false,
      runtime: 'claude-bg', sessionId });
    registrar(a.dir, a.t.id, 'runtime_stop', { ts: '2026-10-01T06:52:44.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg',
      despachoEm: '2026-10-01T05:06:12.008Z', fonte: 'ork sessions event', sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
    const verde = pr(39, a.branch, a.head, { checks: [{ nome: 'ork-verify', situacao: 'verde', concluidoEm: '2026-10-01T22:01:39.000Z' }] });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([verde])) });
    assert.equal(r.estados[0].conduzidaAgora, false, 'a sessao que encerrou o turno nao conduz');
    assert.equal(r.parados[0]?.caso, 'pr-verde');
    // Heartbeat da sessao depois do Stop: ela voltou a trabalhar, e conduz.
    registrar(a.dir, a.t.id, 'runtime_event', { ts: '2026-10-01T23:00:00.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg',
      despachoEm: '2026-10-01T05:06:12.008Z', fonte: 'ork sessions event', sensor: 'heartbeat' });
    const voltou = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([verde])) });
    assert.equal(voltou.estados[0].conduzidaAgora, true);
    assert.equal(voltou.parados.length, 0);
  } finally { p.limpar(); }
});

test('contraprovas: limiar, conducao por processo, pausa prevista, pedido aberto ou vencido que espera, prompt do hook', () => {
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
    // Pedido de sessao valido e aberto: do dono.
    const d = threadComProduto(p, 'pergunta aberta');
    const { sessionId: sd } = turnoDoObservador(d.dir, d.t.id, 23);
    registrar(d.dir, d.t.id, 'hitl_requested', { ts: '2026-10-01T07:00:00.000Z', fase: 'GOAL',
      pedido: pedidoDeSessao(d.t.id, sd, '2026-10-01T07:00:00.000Z', '2026-10-03T07:00:00.000Z') });
    // Pedido vencido cuja acao ao expirar e esperar: continua do dono (aviso 5 do CHECK).
    const e = threadComProduto(p, 'pedido vencido');
    const { sessionId: se } = turnoDoObservador(e.dir, e.t.id, 24);
    registrar(e.dir, e.t.id, 'hitl_requested', { ts: '2026-10-01T07:00:00.000Z', fase: 'GOAL',
      pedido: pedidoDeSessao(e.t.id, se, '2026-10-01T07:00:00.000Z', '2026-10-01T08:00:00.000Z') });
    // Prompt de permissao do hook, sem Stop depois: do dono.
    const f = threadComProduto(p, 'prompt do hook');
    const { sessionId: sf } = turnoDoObservador(f.dir, f.t.id, 25);
    registrar(f.dir, f.t.id, 'sessao_bloqueada', { ts: '2026-10-01T07:28:30.000Z', sessionId: sf, fase: 'GOAL', fonte: 'ork sessions event',
      sensor: 'permission_prompt', tipoDeHitl: 'permissao', pergunta: null, estadoRuntime: 'blocked' });

    const r = entregasDoProjeto(p.carregado, { quando: AGORA });
    if (conducao.ok) conducao.liberar();
    assert.deepEqual(r.parados, [], JSON.stringify(r.parados));
    const gates = [...r.doCondutor.gates];
    for (const dono of [c, d, e, f]) assert.ok(!gates.includes(`${dono.t.id}|GOAL`), `${dono.t.id} continua do dono`);
    assert.ok(gates.includes(`${a.t.id}|GOAL`) && gates.includes(`${b.t.id}|GOAL`), 'abaixo do limiar e conduzida ainda nao sao do dono');
    assert.equal(r.estados.find(x => x.thread === b.t.id)!.conduzidaAgora, true);
    assert.equal(esperaDoCondutor(lerThread(p.dir, d.t.id), lerLedger(d.dir), AGORA), null);
  } finally { p.limpar(); }
});

test('aviso 4 do CHECK: o carimbo do proprio radar no fim de turno nao devolve o caso ao dono', () => {
  const p = projetoTemporario('fatia4-carimbo', true);
  try {
    const a = threadComProduto(p, 'carimbada');
    const { sessionId } = turnoDoObservador(a.dir, a.t.id, 26);
    registrar(a.dir, a.t.id, 'sessao_bloqueada', { ts: '2026-10-01T07:45:00.000Z', thread: a.t.id, sessionId, fase: 'GOAL',
      tipoDeHitl: 'hitl.desconhecido', pergunta: '', fonte: 'ork sessions hitl --registrar', estadoRuntime: 'blocked' });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(r.parados[0]?.caso, 'sem-push');
    assert.ok(r.doCondutor.gates.has(`${a.t.id}|GOAL`));
  } finally { p.limpar(); }
});

test('resultado legado (ok sem classificacao) tambem encerra o turno; gate_passed da vivacidade nao aprova a pausa prevista', () => {
  const p = projetoTemporario('fatia4-legado', true);
  try {
    const a = threadComProduto(p, 'legado');
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: '2026-10-01T05:00:00.000Z', fase: 'GO', modo: 'auto', pausaAoFim: false,
      bloco: 'GO-CHECK-SHIP-MASTER', runtime: 'codex', sessionId: '00000000-0000-4000-8000-000000000040' });
    registrar(a.dir, a.t.id, 'phase_result', { ts: FIM, fase: 'GO', sessionId: '00000000-0000-4000-8000-000000000040', ok: true });
    const b = threadComProduto(p, 'pausa com vivacidade');
    turnoDoObservador(b.dir, b.t.id, 41, { pausaAoFim: true });
    registrar(b.dir, b.t.id, 'gate_passed', { ts: '2026-10-01T08:00:00.000Z', fase: 'GOAL', motivo: 'runtime.silencio' });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.deepEqual(r.parados.map(x => [x.thread, x.caso]), [[a.t.id, 'sem-push']]);
    assert.ok(!r.doCondutor.gates.has(`${b.t.id}|GOAL`), 'a pausa prevista so sai com a aprovacao humana');
  } finally { p.limpar(); }
});

test('retrato que nao vale e "PR nao lido", nunca "sem PR": velho, de outra base, anterior ao fim do turno, lista cortada', () => {
  const p = projetoTemporario('fatia4-retrato', true);
  try {
    const a = threadComProduto(p, 'retrato ruim', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 27);
    const casos: [RetratoDePrs, string][] = [
      [retratoCom([], { lidoEm: '2026-10-01T23:00:00.000Z' }), 'retrato de PRs velho'],
      [retratoCom([], { base: 'release' }), 'retrato de PRs de outro repositório ou base'],
      [retratoCom([], { repositorio: 'outro/repositorio' }), 'retrato de PRs de outro repositório ou base'],
      [retratoCom([], { parcial: true }), `lista de PRs abertos cortada nos ${LIMITE_DE_PRS} mais novos`],
      [retratoCom([], { lidoEm: '2026-10-02T02:00:00.000Z' }), 'retrato de PRs com data no futuro'],
    ];
    for (const [retrato, motivo] of casos) {
      const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retrato) });
      assert.equal(r.estados[0].prNaoLido, motivo);
      assert.equal(r.estados[0].resumo, 'branch publicada, PR não lido');
      assert.ok(!r.parados.some(x => x.caso === 'sem-pr'), motivo);
      assert.equal(r.parados[0]?.proximoPasso, `conferir o PR da branch ${a.branch} (PR não lido) e seguir`, 'o fim de turno volta como linha');
    }
    // PR mesclado na ponta, sem o assunto ship(<thread>) e sem ship_done: registrar a entrega a mao (N4 do CHECK, rodada 2).
    const mesclado = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([pr(44, a.branch, a.head,
      { estado: 'mesclado', mescladoEm: '2026-10-01T23:00:00.000Z' })])) });
    assert.equal(mesclado.parados[0]?.caso, 'sem-registro');
    assert.equal(mesclado.parados[0].proximoPasso, `conferir a entrega do PR #44, mesclado sem o assunto ship(${a.t.id}), e registrar o ship_done`);
    // Leitura anterior ao fim do turno: o turno pode ter mudado o PR.
    const antes = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([], { lidoEm: '2026-10-01T07:00:00.000Z' })) });
    assert.match(antes.estados[0].prNaoLido ?? '', /retrato de PRs (velho|anterior ao fim do turno)/);
  } finally { p.limpar(); }
});

test('a resposta do gh e validada: falha, formato, branch estranha, fork, outra base, checks repetidos e nomes de check', () => {
  const p = projetoTemporario('fatia4-forja', true);
  try {
    const a = threadComProduto(p, 'forja', { publicar: true });
    turnoDoObservador(a.dir, a.t.id, 30);
    forjaSimulada(p);
    const chamadas: string[][] = [];
    const falha: ExecutorDoGh = (args) => { chamadas.push([...args]); return { status: 1, stdout: '', stderr: 'HTTP 502: SIMULADO' }; };
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => lerPrsDaForja(p.carregado, { quando: AGORA, executor: falha }) });
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0].slice(0, 5), ['pr', 'list', '--repo=github.com/exemplo/simulado', '--base=main', '--state=open']);
    assert.ok(!r.parados.some(x => x.caso === 'sem-pr'), 'sem leitura nao se afirma "sem PR"');
    assert.match(r.estados[0].prNaoLido ?? '', /gh pr list falhou \(código 1\): HTTP 502: SIMULADO/);
    assert.equal(lerPrsDaForja(p.carregado, { quando: AGORA, executor: () => ({ status: 0, stdout: '{"nao":"lista"}', stderr: '' }) }).ok, false);
    const sem = lerPrsDaForja(p.carregado, { quando: AGORA, executor: () => ({ status: null, stdout: '', stderr: 'spawnSync gh ENOENT' }) });
    assert.equal(sem.ok, false);
    assert.match(sem.ok ? '' : sem.erro, /\(sem código de saída\): spawnSync gh ENOENT/);
    // Nome de check com diretiva, padrao de substituicao, quebra e formatacao invisivel sai limpo.
    const sujo = `MEDIA:/etc/x $& ${String.fromCharCode(0x202e)}vira${String.fromCharCode(0x2028)}linha${String.fromCharCode(0x200b)}`;
    assert.equal(nomeDeCheck(sujo), 'MEDIA /etc/x vira linha');
    const boa: ExecutorDoGh = () => ({ status: 0, stderr: '', stdout: JSON.stringify([
      { number: 40, state: 'OPEN', headRefName: a.branch, headRefOid: a.head, baseRefName: 'main', isDraft: false, isCrossRepository: false,
        url: 'https://github.com/exemplo/simulado/pull/40', createdAt: '2026-10-01T22:00:01Z', mergedAt: null,
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-10-01T22:00:07Z', completedAt: '2026-10-01T22:07:15Z' },
          { __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-10-01T22:20:00Z', completedAt: '2026-10-01T22:27:00Z' },
          { __typename: 'StatusContext', context: 'externo', state: 'SUCCESS', startedAt: '2026-10-01T22:01:00Z' },
          // Mesmo nome, outro workflow: e outro check, e o vermelho dele nao some atras do verde (N1 da seguranca, rodada 2).
          { __typename: 'CheckRun', name: 'build', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-10-01T22:00:00Z', completedAt: '2026-10-01T22:05:00Z' },
          { __typename: 'CheckRun', name: 'build', workflowName: 'Docs', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-10-01T22:01:00Z', completedAt: '2026-10-01T22:02:00Z' },
          // Mesmo workflow e nome, disparado por dois eventos (runs 111 e 222): o vermelho do primeiro fica (rodada 3).
          { __typename: 'CheckRun', name: 'teste', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-10-01T22:03:00Z',
            completedAt: '2026-10-01T22:06:00Z', detailsUrl: 'https://github.com/exemplo/simulado/actions/runs/111/job/1' },
          { __typename: 'CheckRun', name: 'teste', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-10-01T22:03:05Z',
            completedAt: '2026-10-01T22:05:00Z', detailsUrl: 'https://github.com/exemplo/simulado/actions/runs/222/job/2' },
          { __typename: 'CheckRun', name: sujo, status: 'IN_PROGRESS', conclusion: '', completedAt: '0001-01-01T00:00:00Z' }] },
      { number: 41, state: 'OPEN', headRefName: 'outra', headRefOid: 'b'.repeat(40), baseRefName: 'release', isDraft: false, isCrossRepository: false, statusCheckRollup: [] },
      { number: 42, state: 'OPEN', headRefName: 'fork', headRefOid: 'c'.repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: true, statusCheckRollup: [] },
      { number: 43, state: 'MERGED', headRefName: 'fix/issue#12', headRefOid: 'e'.repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: false, statusCheckRollup: null },
      { number: 7, state: 'MERGED', headRefName: 'antiga', headRefOid: 'd'.repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: false,
        mergedAt: '2026-09-30T10:00:00Z', statusCheckRollup: null }]) });
    const ok = lerPrsDaForja(p.carregado, { quando: AGORA, executor: boa });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.deepEqual(ok.retrato.prs.map(x => x.numero), [40, 7], 'outra base, fork e branch fora do formato ficam de fora sem derrubar a leitura');
    assert.equal(ok.retrato.parcial, false);
    assert.deepEqual(ok.retrato.prs[0].checks.map(c => [c.nome, c.situacao, c.concluidoEm]), [
      ['ork-verify', 'verde', '2026-10-01T22:27:00.000Z'], ['externo', 'verde', '2026-10-01T22:01:00.000Z'],
      ['build', 'vermelho', '2026-10-01T22:05:00.000Z'], ['build', 'verde', '2026-10-01T22:02:00.000Z'],
      ['teste', 'vermelho', '2026-10-01T22:06:00.000Z'], ['teste', 'verde', '2026-10-01T22:05:00.000Z'], ['MEDIA /etc/x vira linha', 'pendente', null]],
      'vale a reexecucao mais nova do ork-verify, e o build de cada workflow fica');
    // O retrato vai e volta inteiro; arquivo adulterado nao vale; o nome sujo gravado a mao sai limpo na leitura.
    gravarRetratoDePrs(p.dir, ok.retrato);
    assert.deepEqual(lerRetratoDePrs(p.dir), ok.retrato);
    const arquivo = path.join(p.dir, '.orkastery', 'monitor', 'prs.json');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    const adulterado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    adulterado.prs[0].checks[0].nome = sujo;
    fs.writeFileSync(arquivo, JSON.stringify(adulterado));
    assert.equal(lerRetratoDePrs(p.dir)?.prs[0].checks[0].nome, 'MEDIA /etc/x vira linha');
    fs.writeFileSync(arquivo, JSON.stringify({ ...ok.retrato, contrato: 'outro/v1' }));
    assert.equal(lerRetratoDePrs(p.dir), null);
    // Lista cheia: parcial.
    const cheia: ExecutorDoGh = () => ({ status: 0, stderr: '', stdout: JSON.stringify(Array.from({ length: LIMITE_DE_PRS }, (_, i) =>
      ({ number: i + 100, state: 'MERGED', headRefName: `velha-${i}`, headRefOid: 'f'.repeat(40), baseRefName: 'main', isDraft: false,
        isCrossRepository: false, statusCheckRollup: null }))) });
    const cortada = lerPrsDaForja(p.carregado, { quando: AGORA, executor: cheia });
    assert.equal(cortada.ok && cortada.retrato.parcial, true);
  } finally { p.limpar(); }
});

test('remoto que nao e do github.com nao chama o gh', () => {
  const p = projetoTemporario('fatia4-sem-github', true);
  try {
    let chamadas = 0;
    const executor: ExecutorDoGh = () => { chamadas++; return { status: 0, stdout: '[]', stderr: '' }; };
    assert.equal(lerPrsDaForja(p.carregado, { quando: AGORA, executor }).ok, false);
    git(p.dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/github.com/exemplo/simulado.git');
    assert.equal(lerPrsDaForja(p.carregado, { quando: AGORA, executor }).ok, false, 'o host e ancorado, nao so citado no caminho');
    assert.equal(chamadas, 0);
  } finally { p.limpar(); }
});

test('S1 e S2 do CHECK (rodada 2): o head do PR e a ponta local; o pedido novo do mesmo alvo substitui o vencido', () => {
  const p = projetoTemporario('fatia4-s1-s2', true);
  try {
    // Publicada por outro clone: a ref de rastreio ficou velha, mas o head do PR aberto ja e a ponta local.
    const a = threadComProduto(p, 'publicada de fora', { publicar: true });
    const nova = commitNaBranch(p, a.branch, 'de-outro-clone.txt');
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 85);
    const verde = pr(45, a.branch, nova, { checks: [{ nome: 'ork-verify', situacao: 'verde', concluidoEm: '2026-10-01T22:00:00.000Z' }] });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([verde])) });
    assert.equal(r.parados[0]?.caso, 'pr-verde');
    assert.equal(r.estados[0].publicada, true);
    // P1 venceu esperando; P2, do mesmo alvo, foi respondido: nada fica com o dono.
    const b = threadComProduto(p, 'pedido substituido');
    const { sessionId } = turnoDoObservador(b.dir, b.t.id, 86);
    registrar(b.dir, b.t.id, 'hitl_requested', { ts: '2026-10-01T06:00:00.000Z', fase: 'GOAL',
      pedido: pedidoDeSessao(b.t.id, sessionId, '2026-10-01T06:00:00.000Z', '2026-10-01T06:30:00.000Z') });
    const p2 = pedidoDeSessao(b.t.id, sessionId, '2026-10-01T06:40:00.000Z', '2026-10-01T07:40:00.000Z');
    registrar(b.dir, b.t.id, 'hitl_requested', { ts: '2026-10-01T06:40:00.000Z', fase: 'GOAL', pedido: p2 });
    registrar(b.dir, b.t.id, 'session_answered', { ts: '2026-10-01T06:50:00.000Z', fase: 'GOAL', pedidoId: p2.id });
    assert.notEqual(esperaDoCondutor(lerThread(p.dir, b.t.id), lerLedger(b.dir), AGORA), null);
  } finally { p.limpar(); }
});

test('R1 do CHECK (rodada 3): antes de dizer "sem PR", a branch candidata e conferida sozinha na forja', () => {
  const p = projetoTemporario('fatia4-candidata', true);
  try {
    const a = threadComProduto(p, 'mesclado velho', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 90);
    const chamadas: string[][] = [];
    // As listas nao trazem o PR (mesclado ha mais de 100 PRs); so a consulta pela branch o acha.
    const executor: ExecutorDoGh = (args) => {
      chamadas.push([...args]);
      const pelaBranch = args.includes(`--head=${a.branch}`);
      return { status: 0, stderr: '', stdout: JSON.stringify(pelaBranch ? [{ number: 12, state: 'MERGED', headRefName: a.branch, headRefOid: a.head,
        baseRefName: 'main', isDraft: false, isCrossRepository: false, mergedAt: '2026-09-20T10:00:00Z' }] : []) };
    };
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: (candidatas) => lerPrsDaForja(p.carregado, { quando: AGORA, executor, candidatas }) });
    assert.equal(chamadas.length, 3, 'abertos, recentes e a branch candidata');
    assert.ok(chamadas[2].includes(`--head=${a.branch}`));
    assert.ok(!chamadas[1].some(x => x.includes('statusCheckRollup')), 'os recentes vem sem o rollup');
    assert.equal(r.parados[0]?.caso, 'sem-registro');
    assert.equal(r.parados[0].proximoPasso, `conferir a entrega do PR #12, mesclado sem o assunto ship(${a.t.id}), e registrar o ship_done`);
    // Acima do teto da batida, a candidata fica sem conferir: "PR nao lido", nunca "sem PR".
    const muitas = Array.from({ length: 11 }, (_, i) => `ork/candidata-${i}`);
    const contadas: string[][] = [];
    const vazio: ExecutorDoGh = (args) => { contadas.push([...args]); return { status: 0, stdout: '[]', stderr: '' }; };
    const lida = lerPrsDaForja(p.carregado, { quando: AGORA, executor: vazio, candidatas: muitas });
    assert.equal(contadas.length, 12);
    assert.deepEqual(lida.ok ? lida.retrato.semConferir : null, ['ork/candidata-10']);
    // Com ship_done no ledger, nunca "sem PR".
    registrar(a.dir, a.t.id, 'ship_done', { de: a.branch, para: 'main', mergeSha: 'a'.repeat(40), pushVerificado: true });
    const entregue = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([]) }) });
    assert.ok(!entregue.parados.some(x => x.caso === 'sem-pr'));
  } finally { p.limpar(); }
});

test('S-b e S-e do CHECK (rodada 3): aberto so nos recentes nao vira "sem checks"; pausa aprovada sem fase depois pede a fase seguinte', () => {
  const p = projetoTemporario('fatia4-sb-se', true);
  try {
    const a = threadComProduto(p, 'aberto so nos recentes', { publicar: true });
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 91);
    const executor: ExecutorDoGh = (args) => ({ status: 0, stderr: '', stdout: JSON.stringify(args.includes('--state=open') ? [] : [{ number: 50,
      state: 'OPEN', headRefName: a.branch, headRefOid: a.head, baseRefName: 'main', isDraft: false, isCrossRepository: false }]) });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: (candidatas) => lerPrsDaForja(p.carregado, { quando: AGORA, executor, candidatas }) });
    assert.equal(r.estados[0].resumo, 'PR #50 aberto, checks em andamento');
    assert.ok(!r.parados.some(x => x.caso === 'pr-verde'));
    // #Maestro: PLAN aprovado pelo dono e o GO nunca despachado.
    const { thread: m } = novaThread(p.carregado, { nome: 'plan aprovado', modo: 'maestro' });
    const dir = dirThread(p.dir, m.id), sessionId = '00000000-0000-4000-8000-000000000092';
    registrar(dir, m.id, 'phase_dispatch', { ts: '2026-10-01T05:00:00.000Z', fase: 'PLAN', modo: 'maestro', bloco: 'GOAL-PLAN', pausaAoFim: true,
      runtime: 'claude-bg', sessionId });
    registrar(dir, m.id, 'phase_result', { ts: '2026-10-01T06:00:00.000Z', fase: 'PLAN', sessionId, classificacao: 'gate_blocked',
      motivo: 'human.pending', estadoNativo: 'done', ok: false, fonte: 'SIMULADO' });
    registrar(dir, m.id, 'human_gate', { ts: '2026-10-01T10:00:00.000Z', fase: 'PLAN', estado: 'aprovado', pedidoId: 'pedido-SIMULADO' });
    const aprovado = entregasDoProjeto(p.carregado, { quando: AGORA });
    const linha = aprovado.parados.find(x => x.thread === m.id);
    assert.equal(linha?.caso, 'fase-seguinte');
    assert.equal(linha?.desdeEm, '2026-10-01T10:00:00.000Z');
    assert.equal(linha?.proximoPasso, `despachar a fase GO (ork phase run ${m.id} GO --prompt "<pedido da fase>")`);
  } finally { p.limpar(); }
});

test('o orcamento da leitura da forja cabe na batida: esgotado nas listas e "nao lido"; nas candidatas, sem conferir', () => {
  const p = projetoTemporario('fatia4-orcamento', true);
  try {
    forjaSimulada(p);
    const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const lento: ExecutorDoGh = (_args, prazo) => { assert.ok(prazo <= 30000); dormir(300); return { status: 0, stdout: '[]', stderr: '' }; };
    const esgotado = lerPrsDaForja(p.carregado, { quando: AGORA, executor: lento, orcamentoMs: 0 });
    assert.equal(esgotado.ok, false);
    assert.match(esgotado.ok ? '' : esgotado.erro, /orçamento de 0 s da leitura esgotado/);
    // 300 ms por chamada num orcamento de 1 s: as duas listas cabem, e as candidatas que nao cabem ficam sem conferir.
    const parcial = lerPrsDaForja(p.carregado, { quando: AGORA, executor: lento, orcamentoMs: 1000, candidatas: ['ork/a', 'ork/b', 'ork/c', 'ork/d'] });
    assert.equal(parcial.ok, true);
    assert.ok(parcial.ok && (parcial.retrato.semConferir ?? []).length >= 1, JSON.stringify(parcial.ok ? parcial.retrato.semConferir : null));
  } finally { p.limpar(); }
});
