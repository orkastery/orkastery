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
  LIMITE_DE_PRS, lerPrsDaForja, lerRetratoDePrs, nomeDeCheck, pendenciaDoDono, PrDaForja, RetratoDePrs,
} from '../src/parado-no-condutor';
import { montarPulse } from '../src/pulse';
import { retratoDaMaquina } from '../src/fabrica-estado';
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

/** Uma thread (#Auto, por padrao) com a branch `ork/<slug>` e um commit de produto; publicada quando pedido. */
function threadComProduto(p: Projeto, nome: string, opcoes: { publicar?: boolean; produto?: boolean; modo?: 'auto' | 'fast' } = {}) {
  const { thread: t } = novaThread(p.carregado, { nome, modo: opcoes.modo ?? 'auto' });
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

/**
 * O fim do SHIP como o observador o gravou na ork-rm037noite em 30/09: Stop, terminal `done` e nenhum `ship_done`
 * no intervalo do despacho. Os campos, os textos e os instantes sao os do ledger real; ids, pid e sensor sao
 * SIMULADOS. `fase`, `estadoNativo`, `falta` e `prova` montam as contraprovas nos formatos que o observador grava.
 */
function fimDoObservadorEmDone(dir: string, id: string, n: number,
  opcoes: { fase?: string; estadoNativo?: string; fonte?: string; diagnostico?: string; prova?: Record<string, unknown> | null } = {}) {
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const fase = opcoes.fase ?? 'SHIP', estadoNativo = opcoes.estadoNativo ?? 'done';
  const despachoEm = '2026-09-30T13:22:40.299Z', stop = '2026-09-30T13:54:12.915Z';
  const falta = 'nenhum ship_done registrado no intervalo do despacho';
  registrar(dir, id, 'phase_dispatch', { ts: '2026-09-30T13:22:40.289Z', fase, slug: `${id}-full-2`, modo: 'auto',
    bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER', pausaAoFim: false, runtime: 'claude-bg', sessionId });
  registrar(dir, id, 'runtime_stop', { ts: stop, fase, sessionId, runtime: 'claude-bg', despachoEm, fonte: 'ork sessions event', sensor: 'stop',
    sensorEventId: SHA_DO_SENSOR, recebidoEm: '2026-09-30T13:54:13.243Z' });
  const diagnostico = opcoes.diagnostico ?? `sem prova do ork: ${falta}`;
  const prova = opcoes.prova === undefined ? { ok: false, fonte: falta, motivo: 'human.pending' } : opcoes.prova;
  const comum = { fase, sessionId, despachoEm, sensorResultId: `claude-bg:${'7'.repeat(64)}`, classificacao: 'gate_blocked', motivo: 'human.pending',
    runtime: 'claude-bg', fonte: opcoes.fonte ?? `terminal nativo done com Stop correlacionado; ${diagnostico}`, estadoNativo,
    statusNativo: 'idle', pidNativo: 4242, exitCode: null, exitCodeFonte: 'unavailable', signal: null, duracaoMs: null, duracaoFonte: 'unavailable',
    ok: false, estado: 'bloqueada', stop: { ts: stop, sensorEventId: SHA_DO_SENSOR },
    evidencia: { fonte: 'claude agents --json --all', consultadoEm: '2026-09-30T13:54:14.519Z', registro: { id: sessionId.slice(0, 8), sessionId,
      cwd: '/tmp/simulada', kind: 'background', state: estadoNativo, status: 'idle', pid: 4242 } },
    ...(prova ? { provaOrk: prova } : {}), conclusaoNativa: estadoNativo === 'done', conclusaoNativaAusente: null, diagnostico,
    detalhe: diagnostico, observadoEm: '2026-09-30T13:54:14.519Z', gate: 'phase.dispatch', origem: 'sessions.watch' };
  registrar(dir, id, 'gate_blocked', { ts: '2026-09-30T13:54:14.906Z', ...comum });
  registrar(dir, id, 'phase_result', { ts: '2026-09-30T13:54:14.918Z', ...comum });
  return { sessionId, stop, despachoEm };
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

/** A sessao como o radar a le: `blocked` com a mensagem final na tela (lista numerada, por padrao). */
const sessaoNaTela = (sessionId: string, t: { id: string; slug: string }, extra: Partial<SessaoNoRadar> = {}): SessaoNoRadar => ({
  id: sessionId.slice(0, 8), sessionId, nome: 'SIMULADA', cwd: '/tmp/simulada', kind: 'background', estadoBruto: 'blocked', classe: 'hitl',
  tipoDeHitl: 'hitl.pergunta', jobVivo: true, precisaDeHumano: true, detalhe: 'SIMULADO', desdeEm: '2026-10-01T05:06:17.000Z', idadeMin: 1200,
  pergunta: 'Qual caminho?', alternativas: ['1. A', '2. B'], thread: { id: t.id, fase: 'GOAL', slug: t.slug }, recomendacao: '',
  comandos: { logs: '', attach: '', parar: '' }, acimaDoLimite: true, bloqueadaDesdeEm: '2026-10-01T07:30:00.000Z', paradaHaMin: 1100, ...extra });

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

test('B1 do CHECK (rodada 5): o SHIP em done sem o ship_done, no formato real da ork-rm037noite, sai do dono e traz a linha do PR', () => {
  const p = projetoTemporario('fatia4-ship-done', true);
  try {
    const quando = '2026-09-30T14:40:00.000Z'; // 46 min depois do Stop do SHIP
    const a = threadComProduto(p, 'ship em done', { publicar: true });
    // Contraprovas nos formatos do observador: o SHIP que falhou depois do Stop (`failed`: o humano decide), o SHIP
    // parado de fora (`stopped`), com a mesma prova faltando, e o SHIP em `done` sem a prova do ork registrada (sugestao
    // da rodada 6) seguem do dono. O CHECK em `done` sem o veredito (o da ork-pacotedeexpe em 30/09) era contraprova ate
    // a A3 entrar na fatia 5: no #Auto ele e do condutor, que redespacha o CHECK (rm037-fatia5-check-sem-veredito).
    const b = threadComProduto(p, 'check em done sem veredito', { publicar: true });
    const c = threadComProduto(p, 'ship em failed', { publicar: true });
    const d = threadComProduto(p, 'ship parado de fora', { publicar: true });
    const semProva = threadComProduto(p, 'ship em done sem prova registrada', { publicar: true });
    forjaSimulada(p);
    const { sessionId, stop } = fimDoObservadorEmDone(a.dir, a.t.id, 97);
    const semVeredito = 'docs/check.md gravado sem exatamente um veredito legível';
    fimDoObservadorEmDone(b.dir, b.t.id, 98, { fase: 'CHECK', diagnostico: `sem prova do ork: ${semVeredito}`,
      prova: { ok: false, fonte: semVeredito, motivo: 'human.pending', veredito: null, verify: null } });
    fimDoObservadorEmDone(c.dir, c.t.id, 99, { estadoNativo: 'failed', prova: null,
      fonte: 'terminal nativo failed depois de Stop correlacionado; a sessão falhou depois de encerrar o turno e o humano decide',
      diagnostico: 'a sessão falhou (failed) depois de encerrar o turno; conclusão não provada' });
    fimDoObservadorEmDone(d.dir, d.t.id, 100, { estadoNativo: 'stopped', fonte: 'Stop correlacionado e sessão encerrada externamente (stopped) ' +
      'sem done; sem prova do ork: nenhum ship_done registrado no intervalo do despacho' });
    fimDoObservadorEmDone(semProva.dir, semProva.t.id, 103, { prova: null });
    const ta = lerThread(p.dir, a.t.id), eventos = lerLedger(a.dir);
    assert.equal(pendenciaDoDono(ta, eventos, quando), null, 'o gate do observador no SHIP em done nao e escalacao do dono');
    assert.deepEqual(esperaDoCondutor(ta, eventos, quando), { thread: a.t.id, fase: 'SHIP', sessionId, fimDoTurnoEm: stop,
      tipo: 'espera-do-observador', comProva: false });
    const verde = pr(46, a.branch, a.head, { criadoEm: '2026-09-30T13:40:00.000Z',
      checks: [{ nome: 'ork-verify', situacao: 'verde', concluidoEm: '2026-09-30T13:50:00.000Z' }] });
    const r = entregasDoProjeto(p.carregado, { quando, lerPrs: ler(retratoCom([verde], { lidoEm: quando })) });
    const linha = r.parados.find(x => x.thread === a.t.id);
    assert.equal(linha?.caso, 'pr-verde', JSON.stringify(r.parados));
    assert.equal(linha?.proximoPasso, 'mergear o PR #46');
    assert.equal(linha?.desdeEm, stop, 'desde o fim do SHIP');
    assert.ok(r.doCondutor.gates.has(`${a.t.id}|SHIP`));
    // RM-037 (fatia 5, A3): a thread #Auto do CHECK sem o veredito sai do dono e pede o CHECK de novo.
    assert.equal(pendenciaDoDono(lerThread(p.dir, b.t.id), lerLedger(b.dir), quando), null);
    assert.equal(r.parados.find(x => x.thread === b.t.id)?.caso, 'check-sem-veredito');
    assert.ok(r.doCondutor.gates.has(`${b.t.id}|CHECK`));
    for (const dono of [c, d, semProva]) {
      assert.equal(pendenciaDoDono(lerThread(p.dir, dono.t.id), lerLedger(dono.dir), quando), 'escalação human.pending', dono.t.nome);
      assert.ok(!r.parados.some(x => x.thread === dono.t.id), dono.t.nome);
      assert.ok(![...r.doCondutor.gates].some(g => g.startsWith(`${dono.t.id}|`)), dono.t.nome);
    }
    // O pulse: o SHIP sai de "Esperando voce" com a linha do PR; as contraprovas continuam la.
    const executor: ExecutorDoGh = (args) => ({ status: 0, stderr: '', stdout: JSON.stringify(args.includes('--state=open') ? [{ number: 46,
      state: 'OPEN', headRefName: a.branch, headRefOid: a.head, baseRefName: 'main', isDraft: false, isCrossRepository: false,
      url: 'https://github.com/exemplo/simulado/pull/46', createdAt: '2026-09-30T13:40:00Z', mergedAt: null, statusCheckRollup: [
        { __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-09-30T13:45:00Z',
          completedAt: '2026-09-30T13:50:00Z' }] }] : []) });
    const pulse = montarPulse(p.carregado, { quando, consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' }, executorDoGh: executor });
    assert.ok(!pulse.precisaDeHumanoAgora.some(i => i.thread === a.t.id), JSON.stringify(pulse.precisaDeHumanoAgora.map(i => i.id)));
    assert.equal(pulse.paradoNoCondutor?.find(x => x.thread === a.t.id)?.proximoPasso, 'mergear o PR #46');
    assert.ok(!pulse.precisaDeHumanoAgora.some(i => i.thread === b.t.id), 'A3: o CHECK sem o veredito sai de Esperando voce');
    for (const dono of [c, d, semProva]) assert.ok(pulse.precisaDeHumanoAgora.some(i => i.thread === dono.t.id && i.motivo === 'human.pending'), dono.t.nome);
    // O retrato da maquina, que a rede le como "O que precisa de voce": o SHIP nao espera o dono; as contraprovas, sim.
    const retrato = retratoDaMaquina(p.carregado, { agora: quando, maquina: 'pc-a' });
    assert.equal(retrato.threads.find(t => t.id === a.t.id)?.esperaVoce, false);
    assert.equal(retrato.threads.find(t => t.id === b.t.id)?.esperaVoce, false);
    for (const dono of [c, d, semProva]) assert.equal(retrato.threads.find(t => t.id === dono.t.id)?.esperaVoce, true, dono.t.nome);
  } finally { p.limpar(); }
});

test('aviso da rodada 6 do CHECK: a sessao que voltou a trabalhar depois do resultado, sem Stop novo, fica so com o dono', () => {
  const p = projetoTemporario('fatia4-retomada', true);
  try {
    const quando = '2026-09-30T14:40:00.000Z';
    const emDone = threadComProduto(p, 'ship em done retomado', { publicar: true });
    const emBlocked = threadComProduto(p, 'ship em blocked retomado', { publicar: true });
    forjaSimulada(p);
    const sessoes = [
      { a: emDone, s: fimDoObservadorEmDone(emDone.dir, emDone.t.id, 104), pr: 51 },
      { a: emBlocked, s: turnoDoObservador(emBlocked.dir, emBlocked.t.id, 105, { despacho: '2026-09-30T13:22:40.289Z',
        fim: '2026-09-30T13:54:14.918Z', fase: 'SHIP' }), pr: 52 },
    ];
    const sensor = (x: (typeof sessoes)[number], tipo: string, ts: string, extra: Record<string, unknown>) => registrar(x.a.dir, x.a.t.id, tipo,
      { ts, fase: 'SHIP', sessionId: x.s.sessionId, runtime: 'claude-bg', despachoEm: x.s.despachoEm, fonte: 'ork sessions event', ...extra });
    const checks = [{ nome: 'ork-verify', situacao: 'verde' as const, concluidoEm: '2026-09-30T13:50:00.000Z' }];
    const retrato = retratoCom(sessoes.map(x => pr(x.pr, x.a.branch, x.a.head, { checks })), { lidoEm: quando });
    const executor: ExecutorDoGh = (args) => ({ status: 0, stderr: '', stdout: JSON.stringify(args.includes('--state=open') ? sessoes.map(x => ({
      number: x.pr, state: 'OPEN', headRefName: x.a.branch, headRefOid: x.a.head, baseRefName: 'main', isDraft: false, isCrossRepository: false,
      url: `https://github.com/exemplo/simulado/pull/${x.pr}`, createdAt: '2026-09-30T13:40:00Z', mergedAt: null, statusCheckRollup: [
        { __typename: 'CheckRun', name: 'ork-verify', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-09-30T13:45:00Z',
          completedAt: '2026-09-30T13:50:00Z' }] })) : []) });
    // O dono respondeu na tela e a sessao voltou a trabalhar depois do resultado, sem Stop novo: a pergunta e dele, e a
    // thread nao sai tambem como "parado no condutor" com o PR verde.
    for (const x of sessoes) sensor(x, 'runtime_event', '2026-09-30T14:00:00.000Z', { sensor: 'heartbeat' });
    const r = entregasDoProjeto(p.carregado, { quando, lerPrs: ler(retrato) });
    const pulse = montarPulse(p.carregado, { quando, consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' }, executorDoGh: executor });
    for (const { a } of sessoes) {
      assert.equal(pendenciaDoDono(lerThread(p.dir, a.t.id), lerLedger(a.dir), quando), 'escalação human.pending', a.t.nome);
      assert.ok(!r.parados.some(x => x.thread === a.t.id) && !r.doCondutor.gates.has(`${a.t.id}|SHIP`), JSON.stringify(r.parados));
      assert.ok(pulse.precisaDeHumanoAgora.some(i => i.thread === a.t.id && i.motivo === 'human.pending'), a.t.nome);
      assert.ok(!pulse.paradoNoCondutor?.some(x => x.thread === a.t.id), `${a.t.nome}: numa lista so`);
    }
    // O turno novo acabou num Stop sem atividade depois: volta a ser do condutor, desde esse Stop, e so como linha dele.
    for (const x of sessoes) sensor(x, 'runtime_stop', '2026-09-30T14:05:00.000Z', { sensor: 'stop', sensorEventId: 'e'.repeat(64) });
    const deNovo = entregasDoProjeto(p.carregado, { quando, lerPrs: ler(retrato) });
    const pulseDeNovo = montarPulse(p.carregado, { quando, consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' }, executorDoGh: executor });
    for (const { a, pr: numero } of sessoes) {
      const linha = deNovo.parados.find(x => x.thread === a.t.id);
      assert.deepEqual([linha?.caso, linha?.proximoPasso, linha?.desdeEm], ['pr-verde', `mergear o PR #${numero}`, '2026-09-30T14:05:00.000Z']);
      assert.ok(deNovo.doCondutor.gates.has(`${a.t.id}|SHIP`), a.t.nome);
      assert.ok(!pulseDeNovo.precisaDeHumanoAgora.some(i => i.thread === a.t.id), a.t.nome);
    }
  } finally { p.limpar(); }
});

test('conferencia da rodada 6: o resultado tecnico depois do gate do observador, no mesmo despacho, nao tira o gate do dono', () => {
  const p = projetoTemporario('fatia4-outro-depois', true);
  try {
    const quando = '2026-09-30T14:40:00.000Z';
    const a = threadComProduto(p, 'ship retomado que caiu na cota', { publicar: true });
    forjaSimulada(p);
    const s = fimDoObservadorEmDone(a.dir, a.t.id, 106);
    registrar(a.dir, a.t.id, 'runtime_event', { ts: '2026-09-30T14:00:00.000Z', fase: 'SHIP', sessionId: s.sessionId, runtime: 'claude-bg',
      despachoEm: s.despachoEm, fonte: 'ork sessions event', sensor: 'heartbeat' });
    // A sessao retomada morreu na cota e o observador gravou o resultado tecnico, que tem dono proprio (o formato do CHECK
    // desta thread em 02/10). O fim do turno e `outro`: o gate do observador continua com o dono, sem a linha do condutor.
    const cota = { fase: 'SHIP', sessionId: s.sessionId, despachoEm: s.despachoEm, classificacao: 'gate_blocked', motivo: 'runtime.quota-exhausted',
      runtime: 'claude-bg', fonte: 'processo da sessão morreu sem terminal nativo nem Stop correlacionado (estado blocked); ' +
        'runtime.quota-exhausted na transcricao do perfil: SIMULADO', estadoNativo: 'blocked', ok: false, estado: 'bloqueada', stop: null,
      gate: 'phase.dispatch', origem: 'sessions.watch' };
    registrar(a.dir, a.t.id, 'gate_blocked', { ts: '2026-09-30T14:10:00.000Z', ...cota });
    registrar(a.dir, a.t.id, 'phase_result', { ts: '2026-09-30T14:10:00.010Z', ...cota });
    const checks = [{ nome: 'ork-verify', situacao: 'verde' as const, concluidoEm: '2026-09-30T13:50:00.000Z' }];
    const r = entregasDoProjeto(p.carregado, { quando, lerPrs: ler(retratoCom([pr(55, a.branch, a.head, { checks })], { lidoEm: quando })) });
    assert.equal(pendenciaDoDono(lerThread(p.dir, a.t.id), lerLedger(a.dir), quando), 'escalação human.pending');
    assert.ok(!r.parados.some(x => x.thread === a.t.id) && !r.doCondutor.gates.has(`${a.t.id}|SHIP`), JSON.stringify(r.parados));
  } finally { p.limpar(); }
});

test('A4 do CHECK (rodada 5): fora do #Auto e do #Maestro, publicar a branch e abrir o PR levam a autorizacao de push do dono', () => {
  const p = projetoTemporario('fatia4-autorizacao', true);
  try {
    // #Fast: uma fase so (GO), sem pausa, e o push pede a autorizacao do dono (I-42).
    const semPush = threadComProduto(p, 'fast sem push', { modo: 'fast' });
    const semPr = threadComProduto(p, 'fast sem pr', { modo: 'fast', publicar: true });
    forjaSimulada(p);
    turnoDoObservador(semPush.dir, semPush.t.id, 101, { fase: 'GO', bloco: 'GO' });
    turnoDoObservador(semPr.dir, semPr.t.id, 102, { fase: 'GO', bloco: 'GO' });
    const r = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([])) });
    const passo = (id: string) => r.parados.find(x => x.thread === id)?.proximoPasso;
    assert.equal(passo(semPush.t.id), `publicar a branch ${semPush.branch} e abrir o PR, com a autorização de push do dono (#Fast)`);
    assert.equal(passo(semPr.t.id), `abrir o PR da branch ${semPr.branch}, com a autorização de push do dono (#Fast)`);
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
    // R4-4 do CHECK (rodada 4): a entrega nova mesclada de novo na base; o merge novo ainda nao tem ship_done.
    git(p.dir, 'push', '-q', 'origin', a.branch);
    git(p.dir, 'merge', '-q', '--no-ff', '-m', `ship(${a.t.id}): segunda entrega SIMULADA`, a.branch);
    git(p.dir, 'push', '-q', 'origin', 'main');
    const segundo = git(p.dir, 'rev-parse', 'main').slice(0, 7);
    const remesclada = entregasDoProjeto(p.carregado, { quando: depois(new Date().toISOString(), 60) });
    assert.equal(remesclada.parados[0]?.proximoPasso, `registrar a entrega do merge ${segundo} (ork ship registrar-pr ${a.t.id})`);
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

test('R4-1 do CHECK (rodada 4): o carimbo do radar com lista ou credencial depois do Stop fica com o condutor; o do turno retomado, com o dono', () => {
  const p = projetoTemporario('fatia4-carimbo-lista', true);
  try {
    const a = threadComProduto(p, 'carimbo com lista');
    const { sessionId, despachoEm } = turnoDoObservador(a.dir, a.t.id, 93);
    const radar = (ts: string, tipo: string, extra: Record<string, unknown> = {}) => registrar(a.dir, a.t.id, tipo, { ts, thread: a.t.id,
      sessionId, fase: 'GOAL', fonte: 'ork sessions hitl --registrar', estadoRuntime: 'blocked', ...extra });
    // A lista numerada da mensagem final vira "hitl.pergunta" no carimbo; a palavra "token", "hitl.credencial".
    radar('2026-10-01T07:45:00.000Z', 'sessao_bloqueada', { tipoDeHitl: 'hitl.pergunta', pergunta: 'Próximos passos:' });
    const lista = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [sessaoNaTela(sessionId, a.t)] });
    assert.equal(lista.parados[0]?.caso, 'sem-push', JSON.stringify(lista.parados));
    assert.ok(lista.doCondutor.gates.has(`${a.t.id}|GOAL`) && lista.doCondutor.turnosEncerrados.has(sessionId));
    radar('2026-10-01T08:00:00.000Z', 'sessao_destravada');
    radar('2026-10-01T08:15:00.000Z', 'sessao_bloqueada', { tipoDeHitl: 'hitl.credencial', pergunta: 'Rode de novo com o token SIMULADO' });
    assert.equal(entregasDoProjeto(p.carregado, { quando: AGORA }).parados[0]?.caso, 'sem-push');
    // A sessao retomou (heartbeat depois do Stop) e o radar carimbou um menu no meio do turno novo: a pergunta e do dono.
    radar('2026-10-01T08:30:00.000Z', 'sessao_destravada');
    registrar(a.dir, a.t.id, 'runtime_event', { ts: '2026-10-01T08:31:00.000Z', fase: 'GOAL', sessionId, runtime: 'claude-bg', despachoEm,
      fonte: 'ork sessions event', sensor: 'heartbeat' });
    radar('2026-10-01T08:40:00.000Z', 'sessao_bloqueada', { tipoDeHitl: 'hitl.pergunta', pergunta: 'Qual caminho?' });
    const retomada = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [sessaoNaTela(sessionId, a.t)] });
    assert.deepEqual(retomada.parados, [], JSON.stringify(retomada.parados));
    assert.ok(!retomada.doCondutor.gates.has(`${a.t.id}|GOAL`) && !retomada.doCondutor.sessoes.has(sessionId));
  } finally { p.limpar(); }
});

test('R4-2 do CHECK (rodada 4): a sessao retomada depois da fase concluida nao tem fim de turno ate o Stop novo', () => {
  const p = projetoTemporario('fatia4-concluida-retomada', true);
  try {
    const a = threadComProduto(p, 'concluida e retomada');
    const sessionId = '00000000-0000-4000-8000-000000000094';
    const despacho = '2026-10-01T05:06:17.000Z', despachoEm = depois(despacho, 0.001);
    const sensor = (ts: string, tipo: string, extra: Record<string, unknown>) => registrar(a.dir, a.t.id, tipo, { ts, fase: 'GOAL', sessionId,
      runtime: 'claude-bg', despachoEm, fonte: 'ork sessions event', ...extra });
    registrar(a.dir, a.t.id, 'phase_dispatch', { ts: despacho, fase: 'GOAL', modo: 'auto', bloco: 'GOAL-PLAN-GO-CHECK-SHIP-MASTER',
      pausaAoFim: false, runtime: 'claude-bg', sessionId });
    // O observador conclui a fase depois do Stop, com a prova do ork.
    sensor(depois(FIM, -0.2), 'runtime_stop', { sensor: 'stop', sensorEventId: SHA_DO_SENSOR });
    registrar(a.dir, a.t.id, 'phase_result', { ts: FIM, fase: 'GOAL', sessionId, despachoEm, classificacao: 'fase_concluida', ok: true,
      runtime: 'claude-bg', estadoNativo: 'done', fonte: 'SIMULADO', stop: { ts: depois(FIM, -0.2), sensorEventId: SHA_DO_SENSOR } });
    const antes = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [sessaoNaTela(sessionId, a.t)] });
    assert.equal(antes.parados[0]?.caso, 'sem-push');
    assert.ok(antes.doCondutor.turnosEncerrados.has(sessionId));
    // O dono respondeu na tela e a sessao voltou a trabalhar: o menu novo na tela e dele.
    sensor('2026-10-01T08:00:00.000Z', 'runtime_event', { sensor: 'heartbeat' });
    const retomada = entregasDoProjeto(p.carregado, { quando: AGORA, sessoes: [sessaoNaTela(sessionId, a.t)] });
    assert.deepEqual(retomada.parados, [], JSON.stringify(retomada.parados));
    assert.ok(!retomada.doCondutor.turnosEncerrados.has(sessionId) && !retomada.doCondutor.sessoes.has(sessionId));
    // O turno novo acabou num Stop sem atividade depois: a fase segue concluida, desde esse Stop.
    sensor('2026-10-01T08:30:00.000Z', 'runtime_stop', { sensor: 'stop', sensorEventId: 'd'.repeat(64) });
    const deNovo = entregasDoProjeto(p.carregado, { quando: AGORA });
    assert.equal(deNovo.parados[0]?.caso, 'sem-push');
    assert.equal(deNovo.parados[0].desdeEm, '2026-10-01T08:30:00.000Z');
    assert.ok(deNovo.parados[0].evidencia.includes('fim do turno: concluida'), JSON.stringify(deNovo.parados[0].evidencia));
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
    // Leitura anterior ao fim do turno, com menos de uma hora (A2 da rodada 5: a de 14 h caia antes em "velho"). O turno
    // novo acabou 20 min antes de agora, e o retrato e de 40 min antes: o turno pode ter mudado o PR depois dele.
    turnoDoObservador(a.dir, a.t.id, 28, { despacho: depois(AGORA, -50), fim: depois(AGORA, -20) });
    const antes = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: ler(retratoCom([], { lidoEm: depois(AGORA, -40) })) });
    assert.equal(antes.estados[0].prNaoLido, 'retrato de PRs anterior ao fim do turno');
    assert.equal(antes.estados[0].resumo, 'branch publicada, PR não lido');
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

test('R4-4 do CHECK (rodada 4): a entrega nova depois do ship_done, publicada sem PR, pede "abrir o PR"', () => {
  const p = projetoTemporario('fatia4-segunda-entrega', true);
  try {
    const a = threadComProduto(p, 'segunda entrega', { publicar: true });
    const segunda = commitNaBranch(p, a.branch, 'segunda-entrega.txt');
    git(p.dir, 'push', '-q', 'origin', a.branch);
    forjaSimulada(p);
    turnoDoObservador(a.dir, a.t.id, 95);
    // A primeira entrega (a.head) foi registrada; a ponta e o commit novo, publicado e sem PR.
    registrar(a.dir, a.t.id, 'ship_done', { de: a.branch, para: 'main', shaDe: a.head, mergeSha: 'b'.repeat(40), pushVerificado: true });
    const semPr = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([]) }) });
    assert.equal(semPr.parados[0]?.caso, 'sem-pr', JSON.stringify(semPr.parados));
    assert.equal(semPr.parados[0].proximoPasso, `abrir o PR da branch ${a.branch}`);
    // O ship_done da ponta: a entrega esta feita, nunca "sem PR".
    registrar(a.dir, a.t.id, 'ship_done', { de: a.branch, para: 'main', shaDe: segunda, mergeSha: 'c'.repeat(40), pushVerificado: true });
    const feita = entregasDoProjeto(p.carregado, { quando: AGORA, lerPrs: () => ({ ok: true, retrato: retratoCom([]) }) });
    assert.ok(!feita.parados.some(x => x.caso === 'sem-pr'), JSON.stringify(feita.parados));
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

test('rodada 5 do CHECK: no Codex, a pausa prevista aprovada tambem pede a fase seguinte', () => {
  const p = projetoTemporario('fatia4-codex-pausa', true);
  try {
    // #Maestro: o PLAN rodou no Codex, que grava a fase boa como `fase_concluida` mesmo com pausa ao fim.
    const { thread: m } = novaThread(p.carregado, { nome: 'plan no codex', modo: 'maestro' });
    const dir = dirThread(p.dir, m.id), sessionId = '00000000-0000-4000-8000-000000000096';
    registrar(dir, m.id, 'phase_dispatch', { ts: '2026-10-01T05:00:00.000Z', fase: 'PLAN', modo: 'maestro', bloco: 'GOAL-PLAN', pausaAoFim: true,
      runtime: 'codex', sessionId });
    registrar(dir, m.id, 'phase_result', { ts: '2026-10-01T06:00:00.000Z', fase: 'PLAN', sessionId, classificacao: 'fase_concluida', ok: true,
      runtime: 'codex', fonte: 'SIMULADO', estado: 'concluida', origem: 'sessions.watch' });
    // Antes do veredito, a pausa e do dono: sem linha.
    assert.ok(!entregasDoProjeto(p.carregado, { quando: AGORA }).parados.some(x => x.thread === m.id));
    registrar(dir, m.id, 'human_gate', { ts: '2026-10-01T10:00:00.000Z', fase: 'PLAN', estado: 'aprovado', pedidoId: 'pedido-SIMULADO' });
    const linha = entregasDoProjeto(p.carregado, { quando: AGORA }).parados.find(x => x.thread === m.id);
    assert.equal(linha?.caso, 'fase-seguinte', JSON.stringify(linha));
    assert.equal(linha?.desdeEm, '2026-10-01T10:00:00.000Z');
    assert.equal(linha?.proximoPasso, `despachar a fase GO (ork phase run ${m.id} GO --prompt "<pedido da fase>")`);
  } finally { p.limpar(); }
});

test('o orcamento da leitura da forja cabe na batida: esgotado nas listas e "nao lido"; candidata sem tempo ou com falha, sem conferir', () => {
  const p = projetoTemporario('fatia4-orcamento', true);
  try {
    forjaSimulada(p);
    const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const lento: ExecutorDoGh = (_args, prazo) => { assert.ok(prazo <= 30000); dormir(300); return { status: 0, stdout: '[]', stderr: '' }; };
    const esgotado = lerPrsDaForja(p.carregado, { quando: AGORA, executor: lento, orcamentoMs: 0 });
    assert.equal(esgotado.ok, false);
    assert.match(esgotado.ok ? '' : esgotado.erro, /orçamento de 0 s da leitura esgotado/);
    // 300 ms por chamada num orcamento de 1 s: as duas listas cabem; sem o tempo de uma conferencia inteira, as candidatas
    // ficam sem conferir, e o que foi lido vale.
    const parcial = lerPrsDaForja(p.carregado, { quando: AGORA, executor: lento, orcamentoMs: 1000, candidatas: ['ork/a', 'ork/b', 'ork/c', 'ork/d'] });
    assert.equal(parcial.ok, true, JSON.stringify(parcial));
    assert.deepEqual(parcial.ok ? parcial.retrato.semConferir : null, ['ork/a', 'ork/b', 'ork/c', 'ork/d']);
    // A conferencia que falha deixa so a branch dela sem conferir: as listas e as outras candidatas valem.
    const chamadas: string[][] = [];
    const falhaNaB: ExecutorDoGh = (args) => {
      chamadas.push([...args]);
      if (args.includes('--head=ork/b')) return { status: null, stdout: '', stderr: 'spawnSync gh ETIMEDOUT' };
      return { status: 0, stderr: '', stdout: JSON.stringify(args.includes('--head=ork/a') ? [{ number: 7, state: 'MERGED', headRefName: 'ork/a',
        headRefOid: 'f'.repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: false, mergedAt: '2026-09-20T10:00:00Z' }] : []) };
    };
    const umaFalhou = lerPrsDaForja(p.carregado, { quando: AGORA, executor: falhaNaB, candidatas: ['ork/a', 'ork/b', 'ork/c'] });
    assert.equal(umaFalhou.ok, true, JSON.stringify(umaFalhou));
    assert.deepEqual(umaFalhou.ok ? umaFalhou.retrato.semConferir : null, ['ork/b']);
    assert.deepEqual(umaFalhou.ok ? umaFalhou.retrato.prs.map(x => x.numero) : null, [7]);
    assert.equal(chamadas.length, 5, 'abertos, recentes e as tres candidatas');
  } finally { p.limpar(); }
});
