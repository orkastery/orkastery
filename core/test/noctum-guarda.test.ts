/**
 * RM-058, integração (T1.1 e T1.2 da ork-rm058integra, D3, D4 e D5): a guarda das threads do arco #Noctum nos caminhos de
 * entrega e de condução de fora do arco. Os nomes começam por GS (a guarda) e GT (a retenção depois do arco). Arcos, itens,
 * pedidos, contas, PRs, sessões e provas são SIMULADOS; o remoto é um repositório bare local, e o `gh` é um falso que guarda
 * os PRs na memória.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, envPtBr, projetoTemporario, ProjetoDeTeste, shaNoRemotoDeTeste } from './apoio';
import { abrirArco, autorizarPedido, passar, pedidoV2, prepararIngressoSimulado, revogarArco, threadDoTrabalho, TrabalhoSimulado } from './noctum-apoio';
import { pedidoV3 } from './noctum-maquinas-apoio';
import { assinadoPara, HORA, MIN } from './noctum-n6-apoio';
import { atualizarBranchDaThread } from '../src/atualizar-branch';
import { caminhoDaAutorizacao, CONTRATO_DA_AUTORIZACAO } from '../src/autorizacao-duravel';
import { BatidaDaConducao, baterConducao, conduzirBatida, lerRetratoDaBatida, OpcoesDaBatida, pendentesDaUltimaBatida } from '../src/conducao-batida';
import { passosDoCondutor, statusDaSentinela, textoDoStatusDaSentinela } from '../src/conducao-sentinela';
import { maquinaOciosa } from '../src/maquina-ociosa';
import { nomeDaMaquina } from '../src/maquina';
import { fatosDaFila, montarFila } from '../src/noctum-fila';
import { CONTRATO_RESERVA } from '../src/roadmap-reservas';
import { acoesPendentes, agirNaVarredura } from '../src/varredura-acoes';
import { prepararBundleCi } from '../src/ci';
import { registrarEntregaExternaPorPr, registrarEntregaPorPr, registrarEntregasPorPr } from '../src/entrega-pr';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { comLocale } from '../src/locale';
import { autorizarPeloIngresso, concluirDespacho, encerrarArco, lerArco, proporEnvelope, reservarDespacho, textoDeAutorizacao } from '../src/noctum-arco';
import { passoDoArco, OpcoesDoPasso, ResultadoDoPasso } from '../src/noctum-execucao';
import { arcoDoPasso, guardaDaThread, lerArcosDaRaiz, linhaDoArco, MOTIVO_DA_GUARDA, MOTIVO_DA_REDE_ILEGIVEL,
  MOTIVO_DO_ARCO_ILEGIVEL, pedidoDoArco } from '../src/noctum-guarda';
import { CONTRATO_REDE_DO_ARCO, RedeDoArco } from '../src/noctum-rede';
import { identidadeDaMaquina } from '../src/noctum-transporte';
import { ExecutorDoGh } from '../src/parado-no-condutor';
import { ResultadoRun } from '../src/phase';
import { ship } from '../src/ship';
import { publicarEntrega } from '../src/ship-publicar';
import { raizDoEstado } from '../src/estado-thread';
import { dirThread, lerThread, listarIds, novaThread } from '../src/thread';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';

prepararIngressoSimulado();

const CLI = path.resolve(__dirname, '../../dist/index.js');
const FORJA = { host: 'github.com', repositorio: 'exemplo/produto' };

/** O trabalho do envelope que é a thread que já existe. */
const daThread = (id: string, thread: string, item = 'RM-901', prioridade = 1): TrabalhoSimulado =>
  ({ id, item, prioridade, dependeDe: [], thread });

/** Arco v3 encerrado localmente, sem tocar o ramo de coordenação nos casos da guarda. */
function arcoV3Encerrado(p: ProjetoDeTeste, arco: string, thread: string): void {
  const trabalho = { ...daThread('w1', thread), maquina: 'maquina-a' };
  autorizarPedido(p.dir, arco, pedidoV3(arco, { trabalhos: [trabalho], maquinas: [identidadeDaMaquina(p.dir, 'maquina-a')],
    contas: [{ conta: 'perfil-a', sessoes: 1 }], global: [{ conta: 'perfil-a', sessoes: 1 }] }));
  encerrarArco(p.dir, arco, { motivo: 'hora', detalhe: 'fim local SIMULADO' });
}

/** Projeção simulada usada para provar só a política da guarda, sem transporte Git. */
function redeDaGuarda(arco: string, estado: RedeDoArco['trabalhos'][number]['estado'], lacuna: RedeDoArco['lacuna'] = null): RedeDoArco {
  return { contrato: CONTRATO_REDE_DO_ARCO, arco, multimaquina: true, maquina: 'maquina-a', envelopeSha256: 'a'.repeat(64),
    lidaEm: new Date().toISOString(), autoridade: null, revogada: null, maquinas: [],
    trabalhos: [{ id: 'w1', estado, maquina: 'maquina-b', ordem: null, maquinaPresa: 'maquina-a', entrega: null }],
    consumo: { arco: 0, porConta: {}, porRuntime: {} }, obrigacoes: { ordens: [], vagas: [], vezes: [] }, lacuna };
}

const eventos = (p: ProjetoDeTeste, id: string) => lerLedger(dirThread(p.dir, id)).length;

/** Uma thread #Auto pronta para publicar: o produto na branch, o verify verde nele, o bundle commitado e o CHECK com PASSOU. */
function threadPronta(p: ProjetoDeTeste, nome: string): { id: string; branch: string } {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch, 'main'], p.dir);
  const produto = commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.verificacao, { commit: produto, veredito: 'verdade sustentada', motivos: [] });
  const bundle = prepararBundleCi(p.carregado, thread.id);
  exec('git', ['add', '--', path.relative(p.dir, bundle)], p.dir);
  exec('git', ['commit', '-q', '-m', `ci(${thread.id}): bundle`], p.dir);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  const check = path.join(dirThread(p.dir, thread.id), 'docs', 'check.md');
  fs.mkdirSync(path.dirname(check), { recursive: true });
  fs.writeFileSync(check, '# CHECK\n\nVeredito: PASSOU\n');
  const depois = new Date(Date.now() + 5000);
  fs.utimesSync(check, depois, depois);
  return { id: thread.id, branch };
}

/** O `gh` falso: lista os PRs da branch e abre o PR na ponta que o remoto tem. */
function ghFalso(p: ProjetoDeTeste) {
  const prs: Array<{ number: number; head: string; oid: string }> = [];
  const executor: ExecutorDoGh = (args) => {
    const opcao = (nome: string) => args.find(a => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
    if (args[0] === 'pr' && args[1] === 'list') {
      const head = opcao('head');
      return { status: 0, stderr: '', stdout: JSON.stringify(prs.filter(x => !head || x.head === head).map(x => ({ number: x.number, state: 'OPEN',
        headRefName: x.head, headRefOid: x.oid, baseRefName: 'main', isDraft: false, isCrossRepository: false,
        url: `https://github.com/exemplo/produto/pull/${x.number}`, createdAt: '2026-10-19T10:00:00Z', mergedAt: null, mergeable: 'MERGEABLE',
        statusCheckRollup: [] }))) };
    }
    if (args[0] === 'pr' && args[1] === 'create') {
      const head = opcao('head') ?? '';
      const numero = 200 + prs.length + 1;
      prs.push({ number: numero, head, oid: shaNoRemotoDeTeste(p.dir, 'origin', head) });
      return { status: 0, stdout: `https://github.com/exemplo/produto/pull/${numero}\n`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `gh falso: ${args.join(' ')}` };
  };
  return { prs, executor };
}

/** A thread com o trabalho numa branch e o merge `ship(<thread>)` na main do remoto, como o merge do PR deixa. */
function mescladaNoRemoto(p: ProjetoDeTeste, nome: string): string {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  exec('git', ['checkout', '-q', '-b', `ork/${thread.id}-full`], p.dir);
  commitar(p.dir, `${nome}.txt`, 'feito\n', `feat(${thread.id}): ${nome}`);
  exec('git', ['checkout', '-q', 'main'], p.dir);
  assert.equal(exec('git', ['merge', '--no-ff', '-q', '-m', `ship(${thread.id}): ${nome}`, `ork/${thread.id}-full`], p.dir).ok, true);
  assert.equal(exec('git', ['push', '-q', 'origin', 'main'], p.dir).ok, true);
  return thread.id;
}

/** O despacho da fase que o `phase run` deixa no ledger, com a correlação dada. */
function despachoNoLedger(p: ProjetoDeTeste, id: string, correlacao: string | null): void {
  registrar(dirThread(p.dir, id), id, TIPOS_DE_EVENTO.faseDespachada, { fase: 'GO', sessionId: `s-${id}`, runtime: 'claude-bg',
    pausaAoFim: false, ...(correlacao ? { correlacao } : {}) });
}

test('GS1: ork ship e o ship() do ork_ship recusam a thread do arco vigente com o motivo, antes do git e sem ledger', () => {
  const p = projetoTemporario('gs1', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'do arco', modo: 'auto' });
    const { thread: fora } = novaThread(p.carregado, { nome: 'de fora', modo: 'auto' });
    abrirArco(p.dir, 'arco-gs1', { trabalhos: [daThread('w1', thread.id)] });
    const antes = eventos(p, thread.id);
    // O mesmo ship() que o worker do ork_ship chama (mcp-ship.ts): a recusa vem antes da reversão, do merge e do push.
    const r = ship(p.carregado, thread.id, { para: 'main' });
    assert.equal(r.ok, false);
    assert.equal(r.bloqueado, true);
    assert.equal(r.motivo, 'policy.violation');
    assert.equal(r.codigo, MOTIVO_DA_GUARDA);
    assert.match(r.detalhe, /^noctum\.guarda\.thread-do-arco: a thread .* é trabalho do arco arco-gs1 \(vigente, pela lista do envelope\)/);
    assert.match(r.correcao, /passo da entrega do arco arco-gs1/);
    assert.deepEqual(r.passos, [], 'nenhum comando do git rodou');
    assert.equal(r.verificacao, null);
    assert.equal(eventos(p, thread.id), antes, 'a recusa não vai ao ledger da thread');
    // O comando real, com a impressão do motivo e a saída 1.
    const env = envPtBr();
    delete env.ORK_PROJETO;
    delete env.ORK_PROJETO_EXPLICITO;
    const cli = spawnSync(process.execPath, [CLI, 'ship', thread.id, '--para', 'main'], { cwd: p.dir, env, encoding: 'utf8' });
    assert.equal(cli.status, 1, cli.stderr);
    assert.match(cli.stdout, /noctum\.guarda\.thread-do-arco: a thread .* é trabalho do arco arco-gs1/);
    assert.equal(eventos(p, thread.id), antes);
    // O catálogo do ship tem a recusa nas duas línguas, com o motivo tipado igual.
    assert.match(comLocale('en', () => guardaDaThread(p.dir, thread.id)?.detalhe ?? ''),
      /^noctum\.guarda\.thread-do-arco: thread .* is work of arc arco-gs1 \(in force, by the envelope list\)$/);
    assert.match(comLocale('en', () => guardaDaThread(p.dir, thread.id)?.correcao ?? ''), /delivered by the delivery step of arc arco-gs1/);
    // A thread de fora do arco passa da guarda e segue o caminho de sempre.
    const deFora = ship(p.carregado, fora.id, { para: 'main', dryRun: true });
    assert.notEqual(deFora.codigo, MOTIVO_DA_GUARDA);
    assert.equal(guardaDaThread(p.dir, fora.id), null);
  } finally { p.limpar(); }
});

test('GS2: o publicarEntrega sem doArco recusa a thread do arco, e com o arco certo passa, no ensaio e no efeito', () => {
  const p = projetoTemporario('gs2', true);
  try {
    const e = threadPronta(p, 'gs2');
    abrirArco(p.dir, 'arco-gs2', { trabalhos: [daThread('w1', e.id)] });
    const gh = ghFalso(p);
    const comum = { forja: FORJA, executorGh: gh.executor };
    const antes = eventos(p, e.id);
    const ensaio = publicarEntrega(p.carregado, e.id, { ...comum, dryRun: true });
    assert.equal(ensaio.acao, 'recusada');
    assert.equal(ensaio.motivo, 'policy.violation');
    assert.equal(ensaio.codigo, MOTIVO_DA_GUARDA);
    assert.deepEqual(ensaio.passos, []);
    // Outro arco não publica a thread deste.
    assert.equal(publicarEntrega(p.carregado, e.id, { ...comum, dryRun: true, doArco: 'outro-arco' }).codigo, MOTIVO_DA_GUARDA);
    const doArco = publicarEntrega(p.carregado, e.id, { ...comum, dryRun: true, doArco: 'arco-gs2' });
    assert.equal(doArco.acao, 'publicaria', doArco.detalhe);
    assert.equal(doArco.codigo, undefined);
    // O efeito: sem o arco, nada sai e nada vai ao ledger; com ele, o push provado e o PR.
    const semArco = publicarEntrega(p.carregado, e.id, comum);
    assert.equal(semArco.codigo, MOTIVO_DA_GUARDA);
    assert.equal(shaNoRemotoDeTeste(p.dir, 'origin', e.branch), '', 'nenhum push');
    assert.equal(gh.prs.length, 0);
    assert.equal(eventos(p, e.id), antes);
    const publicou = publicarEntrega(p.carregado, e.id, { ...comum, doArco: 'arco-gs2' });
    assert.equal(publicou.acao, 'publicou', publicou.detalhe);
    assert.equal(publicou.pushVerificado, true);
    assert.equal(gh.prs.length, 1);
  } finally { p.limpar(); }
});

test('GS3: o registrar-pr recusa a thread do arco, o externo também, e o --todas a pula com o motivo enquanto as outras seguem', () => {
  const p = projetoTemporario('gs3', true);
  try {
    const doArco = mescladaNoRemoto(p, 'do-arco');
    const deFora = mescladaNoRemoto(p, 'de-fora');
    abrirArco(p.dir, 'arco-gs3', { trabalhos: [daThread('w1', doArco)] });
    const antes = eventos(p, doArco);
    const r = registrarEntregaPorPr(p.carregado, doArco);
    assert.equal(r.acao, 'recusada');
    assert.equal(r.codigo, MOTIVO_DA_GUARDA);
    assert.match(r.motivo, /noctum\.guarda\.thread-do-arco: .*arco-gs3.*; a entrega desta thread é do passo da entrega do arco arco-gs3/);
    p.carregado.manifesto.ci.external_repositories = { 'exemplo/externo': '' };
    const externo = registrarEntregaExternaPorPr(p.carregado, doArco, { repositorio: 'exemplo/externo', pr: 7,
      executorGitHub: () => { throw new Error('a forja não é consultada para a thread do arco'); } });
    assert.equal(externo.acao, 'recusada');
    assert.equal(externo.codigo, MOTIVO_DA_GUARDA);
    const lote = registrarEntregasPorPr(p.carregado);
    const porThread = new Map(lote.map(x => [x.thread, x]));
    assert.equal(porThread.get(doArco)?.acao, 'pulada');
    assert.equal(porThread.get(doArco)?.codigo, MOTIVO_DA_GUARDA);
    assert.equal(porThread.get(deFora)?.acao, 'registrou', porThread.get(deFora)?.motivo);
    assert.equal(eventos(p, doArco), antes, 'nenhum ship_done da thread do arco por fora');
    assert.equal(lerLedger(dirThread(p.dir, deFora)).filter(e => e.tipo === 'ship_done').length, 1);
  } finally { p.limpar(); }
});

test('GS4: o ork conducao atualizar recusa a thread do arco antes de tocar na worktree', () => {
  const p = projetoTemporario('gs4', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'do arco', modo: 'auto' });
    const { thread: fora } = novaThread(p.carregado, { nome: 'de fora', modo: 'auto' });
    abrirArco(p.dir, 'arco-gs4', { trabalhos: [daThread('w1', thread.id)] });
    const r = atualizarBranchDaThread(p.carregado, thread.id);
    assert.equal(r.acao, 'recusada');
    assert.ok(r.acao === 'recusada' && r.motivo === MOTIVO_DA_GUARDA, JSON.stringify(r));
    assert.ok(r.acao === 'recusada' && /arco-gs4/.test(r.detalhe));
    // A de fora segue como antes: sem worktree nesta máquina, a recusa de sempre.
    const deFora = atualizarBranchDaThread(p.carregado, fora.id);
    assert.ok(deFora.acao === 'recusada' && deFora.motivo === 'worktree-ausente', JSON.stringify(deFora));
  } finally { p.limpar(); }
});

test('GS5: a thread de arco revogado, encerrado ou expirado e a de fora seguem como antes nos caminhos manuais', () => {
  const p = projetoTemporario('gs5', true);
  try {
    const ids = ['revogado', 'encerrado', 'expirado'].map(n => novaThread(p.carregado, { nome: n, modo: 'auto' }).thread.id);
    abrirArco(p.dir, 'arco-gs5r', { trabalhos: [daThread('w1', ids[0])] });
    abrirArco(p.dir, 'arco-gs5e', { trabalhos: [daThread('w1', ids[1])] });
    abrirArco(p.dir, 'arco-gs5x', { trabalhos: [daThread('w1', ids[2])] });
    for (const id of ids) assert.equal(guardaDaThread(p.dir, id)?.motivo, MOTIVO_DA_GUARDA, 'enquanto vigente, guarda');
    revogarArco(p.dir, 'arco-gs5r');
    encerrarArco(p.dir, 'arco-gs5e', { motivo: 'custo', detalhe: 'teto SIMULADO' });
    const depoisDaJanela = new Date(Date.now() + 8 * HORA).toISOString();
    assert.equal(lerArco(p.dir, 'arco-gs5x', depoisDaJanela)?.situacao, 'expirado');
    assert.equal(guardaDaThread(p.dir, ids[0]), null, 'revogado não guarda');
    assert.equal(guardaDaThread(p.dir, ids[1]), null, 'encerrado não guarda');
    assert.equal(guardaDaThread(p.dir, ids[2], depoisDaJanela), null, 'expirado não guarda');
    // Os caminhos manuais seguem: o registrar-pr diz que não há merge, e a atualização, que não há worktree.
    assert.equal(registrarEntregaPorPr(p.carregado, ids[0]).acao, 'sem-merge');
    const a = atualizarBranchDaThread(p.carregado, ids[1]);
    assert.ok(a.acao === 'recusada' && a.motivo === 'worktree-ausente', JSON.stringify(a));
    assert.notEqual(ship(p.carregado, ids[0], { para: 'main', dryRun: true }).codigo, MOTIVO_DA_GUARDA);
  } finally { p.limpar(); }
});

test('GS6: a proposta no prazo guarda a thread da lista, e a vencida, nunca autorizada, não guarda', () => {
  const p = projetoTemporario('gs6');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'proposta', modo: 'auto' });
    const agora = new Date().toISOString();
    proporEnvelope(p.dir, pedidoV2('arco-gs6', { trabalhos: [daThread('w1', thread.id)] }), agora);
    const g = guardaDaThread(p.dir, thread.id, agora);
    assert.equal(g?.motivo, MOTIVO_DA_GUARDA);
    assert.equal(g?.situacao, 'proposto');
    assert.equal(g?.origem, 'proposta');
    // O prazo da proposta é de 60 min: depois dele, o arco fica `proposto` para sempre, e não guarda nada.
    const vencida = new Date(Date.parse(agora) + 61 * MIN).toISOString();
    assert.equal(lerArco(p.dir, 'arco-gs6', vencida)?.situacao, 'proposto');
    assert.equal(lerArco(p.dir, 'arco-gs6', vencida)?.propostaPendente, null);
    assert.equal(guardaDaThread(p.dir, thread.id, vencida), null);
  } finally { p.limpar(); }
});

test('GS7: a thread que o arco abriu por pedido é guardada, também quando só o log de despachos a liga ao arco', () => {
  const p = projetoTemporario('gs7');
  try {
    const pedido = 'Fatia SIMULADA que o arco abre por pedido.';
    const pedidoNovo = 'Outra fatia SIMULADA, da emenda.';
    abrirArco(p.dir, 'arco-gs7', { trabalhos: [{ id: 'w1', item: 'RM-907', prioridade: 1, dependeDe: [], pedido }] });
    const r = despacharPeloPasso(p, 'arco-gs7', opcoesDoPasso(['RM-907']));
    assert.equal(r.acao, 'despachou', JSON.stringify(r));
    const aberta = listarIds(p.dir).map(id => lerThread(p.dir, id)).find(t => t.roadmap === 'RM-907')!;
    const g = guardaDaThread(p.dir, aberta.id);
    assert.equal(g?.motivo, MOTIVO_DA_GUARDA);
    assert.equal(g?.origem, 'envelope', 'o item e o sha256 do pedido casam com o trabalho');
    // A emenda autorizada tira o trabalho da lista: o log de despachos ainda liga a thread ao arco.
    const emenda = pedidoV2('arco-gs7', { trabalhos: [{ id: 'w2', item: 'RM-908', prioridade: 1, dependeDe: [], pedido: pedidoNovo }] });
    emenda.janela = { ...lerArco(p.dir, 'arco-gs7')!.conteudo!.janela };
    autorizarEmenda(p, 'arco-gs7', emenda);
    const depois = guardaDaThread(p.dir, aberta.id);
    assert.equal(depois?.motivo, MOTIVO_DA_GUARDA);
    assert.equal(depois?.origem, 'despacho');
  } finally { p.limpar(); }
});

test('GS8: o arco que não se lê recusa só a thread cujo último despacho tem a correlação dele', () => {
  const p = projetoTemporario('gs8');
  try {
    const { thread: correlacionada } = novaThread(p.carregado, { nome: 'correlacionada', modo: 'auto' });
    const { thread: outra } = novaThread(p.carregado, { nome: 'outra', modo: 'auto' });
    abrirArco(p.dir, 'arco-gs8', { trabalhos: [daThread('w1', correlacionada.id), daThread('w2', outra.id, 'RM-902', 2)] });
    despachoNoLedger(p, correlacionada.id, 'noctum:arco-gs8');
    despachoNoLedger(p, outra.id, null);
    // Uma linha com MAC que não confere: o log do arco reprova toda leitura.
    const log = path.join(raizDoEstado(p.dir), '.orkastery', 'noctum', 'arcos', 'arco-gs8', 'arco.jsonl');
    fs.appendFileSync(log, `${JSON.stringify({ dados: { seq: 99 }, mac: '0'.repeat(64) })}\n`);
    assert.throws(() => lerArco(p.dir, 'arco-gs8'));
    const g = guardaDaThread(p.dir, correlacionada.id);
    assert.equal(g?.motivo, MOTIVO_DO_ARCO_ILEGIVEL);
    assert.equal(g?.situacao, null);
    assert.match(g?.detalhe ?? '', /^noctum\.guarda\.arco-ilegivel: o último despacho da thread .* foi do arco arco-gs8/);
    assert.equal(ship(p.carregado, correlacionada.id, { para: 'main' }).codigo, MOTIVO_DO_ARCO_ILEGIVEL);
    assert.equal(guardaDaThread(p.dir, outra.id), null, 'a outra segue: o último despacho dela não é do arco');
  } finally { p.limpar(); }
});

test('GS9: a linha do arco chega ao pedido do despacho, com o texto fixo e igual em duas chamadas', () => {
  assert.equal(linhaDoArco('arco-gs9'), 'Esta thread é trabalho do arco `arco-gs9` do #Noctum: o SHIP e o MASTER dela são do arco; ' +
    'não faça push, não abra PR e não mescle.');
  const pedido = 'Fatia SIMULADA do GS9.';
  const prompts: string[] = [];
  for (const nome of ['gs9a', 'gs9b']) {
    const p = projetoTemporario(nome);
    try {
      abrirArco(p.dir, 'arco-gs9', { trabalhos: [{ id: 'w1', item: 'RM-909', prioridade: 1, dependeDe: [], pedido }] });
      const r = despacharPeloPasso(p, 'arco-gs9', opcoesDoPasso(['RM-909'], prompts));
      assert.equal(r.acao, 'despachou', JSON.stringify(r));
    } finally { p.limpar(); }
  }
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], pedidoDoArco(pedido, 'arco-gs9'));
  assert.ok(prompts[0].endsWith(`\n\n${linhaDoArco('arco-gs9')}`));
  assert.equal(prompts[1], prompts[0], 'o mesmo arco e o mesmo pedido dão o mesmo prompt');
});

// ---------------------------------------------------------------------------
// T1.2: os caminhos automáticos (a batida, a varredura, a Sentinela e a máquina ociosa) e a retenção depois do arco.
// ---------------------------------------------------------------------------

/** A autorização durável SIMULADA desta máquina, com as ações dadas. */
function autorizar(p: ProjetoDeTeste, pode: string[]): void {
  const arquivo = caminhoDaAutorizacao(p.dir);
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ contrato: CONTRATO_DA_AUTORIZACAO, maquina: nomeDaMaquina(), projeto: p.carregado.manifesto.project.name,
    por: 'Dona Simulada', concedidaEm: new Date(Date.now() - HORA).toISOString(), ate: new Date(Date.now() + 24 * HORA).toISOString(), pode }));
}

let sessoesDoTeste = 0;
const novaSessao = () => `00000000-0000-4000-8000-${String(910000 + ++sessoesDoTeste).padStart(12, '0')}`;

/** O despacho da fase como o `phase run` o deixa no ledger, com a correlação dada (`null`: de fora do arco) e o instante. */
function despachoDaFase(p: ProjetoDeTeste, thread: string, fase: string, correlacao: string | null, ts?: string): string {
  const sessionId = novaSessao();
  registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.faseDespachada, { fase, sessionId, runtime: 'claude-bg', pausaAoFim: false,
    ...(correlacao ? { correlacao } : {}), ...(ts ? { ts } : {}) });
  return sessionId;
}

/** A fase despachada e concluída pela sessão: o passo do núcleo é a fase seguinte. */
function faseConcluida(p: ProjetoDeTeste, thread: string, fase: string, correlacao: string | null): void {
  const sessionId = despachoDaFase(p, thread, fase, correlacao);
  registrar(dirThread(p.dir, thread), thread, 'phase_result', { fase, sessionId, classificacao: 'fase_concluida', ok: true });
}

/** O despacho que falhou antes de abrir sessão: o passo do núcleo é a retomada pelo retry. */
function despachoFalho(p: ProjetoDeTeste, thread: string, correlacao: string | null): void {
  const sessionId = despachoDaFase(p, thread, 'GOAL', correlacao);
  registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.despachoFalhou, { fase: 'GOAL', motivo: 'runtime.unavailable', sessionId });
}

/** A batida com o despacho e a retomada simulados, sem forja e sem sessões; `chamadas` guarda a thread e o que saiu. */
function opcoesDaBatida(chamadas: string[], extra: OpcoesDaBatida = {}): OpcoesDaBatida {
  return { buscar: false, forja: null, fantasmas: () => [], vivas: () => [],
    despachar: (_k, t, fase) => { chamadas.push(`${t}:${fase}`); return { ok: true, detalhe: 'sessão SIMULADA', sessionId: novaSessao() }; },
    retomar: (_k, t) => { chamadas.push(`${t}:retomar`); return { automatica: true, ok: true, detalhe: 'retomada SIMULADA' }; }, ...extra };
}

const comPedido = (p: ProjetoDeTeste, nome: string, roadmap?: string) =>
  novaThread(p.carregado, { nome, modo: 'auto', pedido: `Pedido SIMULADO de ${nome}.`, ...(roadmap ? { roadmap } : {}) }).thread.id;

test('GS10: a batida pula a thread do arco vigente no despachar e no retomar, com o motivo no retrato, sem ledger e fora do pulse', () => {
  const p = projetoTemporario('gs10');
  try {
    const doArco = comPedido(p, 'gs10 do arco'), retomada = comPedido(p, 'gs10 retomada'), deFora = comPedido(p, 'gs10 de fora');
    faseConcluida(p, doArco, 'GOAL', 'noctum:arco-gs10');
    despachoFalho(p, retomada, 'noctum:arco-gs10');
    faseConcluida(p, deFora, 'GOAL', null);
    abrirArco(p.dir, 'arco-gs10', { trabalhos: [daThread('w1', doArco), daThread('w2', retomada, 'RM-902', 2)] });
    autorizar(p, ['despachar']);
    const antes = [eventos(p, doArco), eventos(p, retomada)];
    const chamadas: string[] = [];
    const r = baterConducao(p.carregado, opcoesDaBatida(chamadas));
    assert.equal(r.ocupada, false);
    assert.deepEqual(chamadas, [`${deFora}:PLAN`], 'só a thread de fora do arco sai');
    const pulos = (r as BatidaDaConducao).pendentes.filter(x => x.thread !== deFora);
    assert.deepEqual(pulos.map(x => [x.thread, x.acao, x.resultado, x.motivo]).sort(),
      [[doArco, 'despachar', 'espera', MOTIVO_DA_GUARDA], [retomada, 'despachar', 'espera', MOTIVO_DA_GUARDA]].sort());
    assert.ok(pulos.every(x => /arco-gs10 \(vigente, pela lista do envelope\)/.test(x.detalhe)), JSON.stringify(pulos));
    assert.deepEqual([eventos(p, doArco), eventos(p, retomada)], antes, 'o pulo não vai ao ledger da thread');
    assert.equal(lerRetratoDaBatida(p.dir)?.pendentes.filter(x => x.motivo === MOTIVO_DA_GUARDA).length, 2, 'o pulo fica no retrato');
    assert.deepEqual(pendentesDaUltimaBatida(p.dir, new Date().toISOString()).filter(x => x.thread !== deFora), [],
      'nem vai à fila do dono no pulse: o relatório do arco diz dele');
  } finally { p.limpar(); }
});

test('GS11: a batida não lê checks, não mescla nem atualiza o PR da thread do arco, e diz o pulo no retrato; o PR de fora segue', () => {
  const p = projetoTemporario('gs11', true);
  try {
    const doArco = novaThread(p.carregado, { nome: 'gs11 pr do arco', modo: 'auto' }).thread;
    const deFora = novaThread(p.carregado, { nome: 'gs11 pr de fora', modo: 'auto' }).thread;
    abrirArco(p.dir, 'arco-gs11', { trabalhos: [daThread('w1', doArco.id)] });
    autorizar(p, ['merge']);
    const prs = [doArco, deFora].map((t, i) => ({ number: 300 + i, title: `ship(${t.id}): SIMULADO`, headRefName: branchDaWorktree(t),
      headRefOid: String(i + 1).repeat(40), baseRefName: 'main', isDraft: false, isCrossRepository: false, mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN', url: `https://github.com/exemplo/produto/pull/${300 + i}` }));
    const chamadas: string[][] = [];
    const executorGh: ExecutorDoGh = (args) => {
      chamadas.push([...args]);
      if (args[0] === 'pr' && args[1] === 'list') return { status: 0, stdout: JSON.stringify(prs), stderr: '' };
      if (args[0] === 'pr' && args[1] === 'checks') return { status: 0, stdout: '[]', stderr: '' };
      return { status: 1, stdout: '', stderr: `gh falso: ${args.join(' ')}` };
    };
    const r = conduzirBatida(p.carregado, { buscar: false, forja: FORJA, executorGh, fantasmas: () => [], vivas: () => [] });
    const pulo = r.pendentes.find(x => x.thread === doArco.id);
    assert.deepEqual([pulo?.acao, pulo?.resultado, pulo?.motivo, pulo?.pr], ['merge', 'espera', MOTIVO_DA_GUARDA, 300]);
    assert.deepEqual(chamadas.filter(c => c[1] !== 'list' && c[2] === '300'), [], 'nem checks nem merge do PR do arco');
    assert.ok(chamadas.some(c => c[1] === 'checks' && c[2] === '301'), 'o PR de fora segue o caminho de sempre');
    assert.equal(r.pendentes.find(x => x.thread === deFora.id)?.motivo, 'sem-checks-obrigatorios');
  } finally { p.limpar(); }
});

test('GS12: a varredura não registra, não fecha pelo MASTER nem solta a sessão da thread do arco; o pulo fica no retrato e fora do pulse', () => {
  const p = projetoTemporario('gs12', true);
  try {
    const registrarDoArco = mescladaNoRemoto(p, 'gs12-registrar');
    const masterDoArco = novaThread(p.carregado, { nome: 'gs12 master', modo: 'auto' }).thread.id;
    const deFora = mescladaNoRemoto(p, 'gs12-fora');
    const fantasma = despachoDaFase(p, masterDoArco, 'GO', 'noctum:arco-gs12');
    registrar(dirThread(p.dir, masterDoArco), masterDoArco, TIPOS_DE_EVENTO.shipConcluido, { origem: 'pr', pr: 7, simulado: true });
    abrirArco(p.dir, 'arco-gs12', { trabalhos: [daThread('w1', registrarDoArco), daThread('w2', masterDoArco, 'RM-902', 2)] });
    autorizar(p, ['limpar', 'registrar', 'master']);
    const depois = new Date(Date.now() + 40 * MIN).toISOString();
    const sessoes = { fantasmas: () => [{ sessionId: fantasma, perfil: null, thread: masterDoArco, fase: 'GO', acao: 'solto' as const }],
      vivas: () => [] };
    exec('git', ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main'], p.dir);
    const doArco = (l: ReturnType<typeof acoesPendentes>) => l.filter(a => a.thread === registrarDoArco || a.thread === masterDoArco)
      .map(a => [a.acao, a.thread, a.motivoDoBloqueio]).sort();
    assert.deepEqual(doArco(acoesPendentes(p.carregado, { ...sessoes, quando: depois, comArco: true })),
      [['limpar', masterDoArco, 'thread-do-arco'], ['master', masterDoArco, 'thread-do-arco'], ['registrar', registrarDoArco, 'thread-do-arco']].sort());
    assert.deepEqual(doArco(acoesPendentes(p.carregado, { ...sessoes, quando: depois })), [], 'o pulse não leva a ação da thread do arco ao dono');
    const r = baterConducao(p.carregado, { ...opcoesDaBatida([]), ...sessoes, quando: depois });
    assert.equal(r.ocupada, false);
    const b = r as BatidaDaConducao;
    assert.deepEqual(b.feitas.map(f => [f.acao, f.thread]), [['registrar', deFora]], 'a de fora segue');
    assert.deepEqual(b.pendentes.filter(x => x.thread !== deFora).map(x => [x.acao, x.resultado, x.motivo]).sort(),
      [['limpar', 'espera', MOTIVO_DA_GUARDA], ['master', 'espera', MOTIVO_DA_GUARDA], ['registrar', 'espera', MOTIVO_DA_GUARDA]].sort());
    assert.equal(lerLedger(dirThread(p.dir, registrarDoArco)).some(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido), false);
    assert.equal(lerThread(p.dir, masterDoArco).status, 'aberta', 'nenhum MASTER por fora');
    assert.equal(lerLedger(dirThread(p.dir, masterDoArco)).some(e => e.tipo === 'sessao_morta'), false, 'nenhuma sessão solta por fora');
  } finally { p.limpar(); }
});

test('GS13: o status da Sentinela dá nada com o motivo à thread do arco, e o passo do núcleo, que a fila do arco lê, segue na fase seguinte', () => {
  const p = projetoTemporario('gs13');
  try {
    const doArco = comPedido(p, 'gs13 do arco', 'RM-913');
    faseConcluida(p, doArco, 'GOAL', 'noctum:arco-gs13');
    abrirArco(p.dir, 'arco-gs13', { trabalhos: [daThread('w1', doArco, 'RM-913')] });
    const passo = passosDoCondutor(p.carregado).find(x => x.thread === doArco)!;
    assert.deepEqual([passo.acao, passo.fase, passo.arco?.efeito, passo.arco?.arco], ['despachar', 'PLAN', 'guarda', 'arco-gs13']);
    const status = statusDaSentinela(p.carregado);
    const naSentinela = status.threads.find(x => x.thread === doArco)!;
    assert.deepEqual([naSentinela.acao, naSentinela.fase], ['nada', null]);
    assert.match(naSentinela.porque, /^noctum\.guarda\.thread-do-arco: a thread .* é trabalho do arco arco-gs13/);
    assert.ok(textoDoStatusDaSentinela(status).split('\n').some(l => l.includes(doArco) && /\bnada\b/.test(l) && l.includes(MOTIVO_DA_GUARDA)));
    const fila = montarFila(fatosDaFila(p.carregado, 'arco-gs13', { maquina: 'maquina-simulada',
      lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-913', maquina: 'maquina-simulada', thread: null }] }) }));
    assert.deepEqual([fila.trabalhos[0].thread, fila.trabalhos[0].fase], [doArco, 'PLAN'], 'a fila do arco vê a fase seguinte da própria thread');
    assert.deepEqual(fila.candidatos.map(c => c.id), ['w1']);
  } finally { p.limpar(); }
});

test('GS14: a máquina ociosa não sugere a thread do arco nem o item que o arco ainda vai abrir; o de fora segue sugerido', () => {
  const p = projetoTemporario('gs14');
  try {
    const doArco = comPedido(p, 'gs14 do arco', 'RM-941');
    const deFora = comPedido(p, 'gs14 de fora', 'RM-943');
    abrirArco(p.dir, 'arco-gs14', { trabalhos: [daThread('w1', doArco, 'RM-941'),
      { id: 'w2', item: 'RM-942', prioridade: 2, dependeDe: [], pedido: 'Fatia SIMULADA que o arco abre.' }] });
    const reserva = (item: string, i: number) => ({ contrato: CONTRATO_RESERVA, item, por: 'Dona Simulada', maquina: 'maquina-gs14', thread: null,
      nota: null, desdeEm: new Date(Date.now() - (3 - i) * HORA).toISOString(), atualizadaEm: new Date().toISOString() });
    const r = maquinaOciosa(p.carregado, { maquina: 'maquina-gs14', reservas: () => ['RM-941', 'RM-942', 'RM-943'].map(reserva),
      ocupadas: () => 0, passos: () => [] });
    assert.deepEqual(r?.sugeridas.map(s => [s.item, s.thread]), [['RM-943', deFora]]);
    assert.equal(r?.reservados, 1);
  } finally { p.limpar(); }
});

test('GT1: fechado o arco por custo, a batida não despacha nem retoma a thread que ele despachou por último, e a Sentinela diz nada', () => {
  const p = projetoTemporario('gt1');
  try {
    const parada = comPedido(p, 'gt1 parada'), retomada = comPedido(p, 'gt1 retomada');
    abrirArco(p.dir, 'arco-gt1', { trabalhos: [daThread('w1', parada), daThread('w2', retomada, 'RM-902', 2)] });
    faseConcluida(p, parada, 'GOAL', 'noctum:arco-gt1');
    despachoFalho(p, retomada, 'noctum:arco-gt1');
    encerrarArco(p.dir, 'arco-gt1', { motivo: 'custo', detalhe: 'teto SIMULADO alcançado' });
    autorizar(p, ['despachar']);
    const chamadas: string[] = [];
    const r = conduzirBatida(p.carregado, opcoesDaBatida(chamadas));
    assert.deepEqual(chamadas, [], 'nada sai fora do orçamento do arco');
    assert.deepEqual(r.pendentes.map(x => [x.thread, x.resultado, x.motivo]).sort(),
      [[parada, 'espera', MOTIVO_DA_GUARDA], [retomada, 'espera', MOTIVO_DA_GUARDA]].sort());
    assert.ok(r.pendentes.every(x => /o arco arco-gt1 \(encerrado\) despachou a thread .* por último/.test(x.detalhe)), JSON.stringify(r.pendentes));
    const naSentinela = statusDaSentinela(p.carregado).threads.find(x => x.thread === parada)!;
    assert.deepEqual([naSentinela.acao, naSentinela.arco?.efeito], ['nada', 'retencao']);
    assert.equal(guardaDaThread(p.dir, parada), null, 'nos caminhos manuais, o arco terminal não guarda');
  } finally { p.limpar(); }
});

test('GT2: depois de um despacho fora do arco, a retenção acaba, e a batida volta a despachar a thread', () => {
  const p = projetoTemporario('gt2');
  try {
    const t = comPedido(p, 'gt2 thread');
    abrirArco(p.dir, 'arco-gt2', { trabalhos: [daThread('w1', t)] });
    faseConcluida(p, t, 'GOAL', 'noctum:arco-gt2');
    revogarArco(p.dir, 'arco-gt2');
    autorizar(p, ['despachar']);
    const chamadas: string[] = [];
    conduzirBatida(p.carregado, opcoesDaBatida(chamadas));
    assert.deepEqual(chamadas, [], 'retida pelo arco revogado');
    // O dono despacha o PLAN por fora do arco, e a sessão o conclui: o último despacho não é mais do arco.
    passar(5);
    faseConcluida(p, t, 'PLAN', null);
    const r = conduzirBatida(p.carregado, opcoesDaBatida(chamadas));
    assert.deepEqual(chamadas, [`${t}:GO`]);
    assert.deepEqual(r.pendentes.filter(x => x.motivo === MOTIVO_DA_GUARDA), []);
  } finally { p.limpar(); }
});

test('GT3: com o arco terminal, a varredura registra a entrega e fecha pelo MASTER a thread que ele despachou por último', () => {
  const p = projetoTemporario('gt3', true);
  try {
    const t = mescladaNoRemoto(p, 'gt3');
    // O GO que o arco despachou antes do PR (a varredura não registra por cima de trabalho novo depois dele).
    despachoDaFase(p, t, 'GO', 'noctum:arco-gt3', new Date(Date.now() - HORA).toISOString());
    abrirArco(p.dir, 'arco-gt3', { trabalhos: [daThread('w1', t)] });
    revogarArco(p.dir, 'arco-gt3');
    assert.equal(arcoDoPasso(p.dir, lerArcosDaRaiz(p.dir), t, lerLedger(dirThread(p.dir, t)))?.efeito, 'retencao');
    autorizar(p, ['registrar', 'master']);
    const r1 = agirNaVarredura(p.carregado, { fantasmas: () => [], vivas: () => [] });
    assert.deepEqual(r1.feitas.map(f => [f.acao, f.thread, f.resultado]), [['registrar', t, 'feita']]);
    const depois = new Date(Date.now() + 31 * MIN).toISOString();
    const r2 = agirNaVarredura(p.carregado, { fantasmas: () => [], vivas: () => [], quando: depois, buscar: false });
    assert.deepEqual(r2.feitas.map(f => [f.acao, f.thread, f.resultado]), [['master', t, 'feita']]);
    assert.equal(lerThread(p.dir, t).status, 'fechada');
  } finally { p.limpar(); }
});

test('GT4: o arco novo que lista a thread a guarda enquanto vale e, terminal, acaba a retenção do arco antigo', () => {
  const p = projetoTemporario('gt4');
  try {
    const t = comPedido(p, 'gt4 thread');
    abrirArco(p.dir, 'arco-gt4a', { trabalhos: [daThread('w1', t)] });
    faseConcluida(p, t, 'GOAL', 'noctum:arco-gt4a');
    encerrarArco(p.dir, 'arco-gt4a', { motivo: 'hora', detalhe: 'janela SIMULADA terminou' });
    const doPasso = () => arcoDoPasso(p.dir, lerArcosDaRaiz(p.dir), t, lerLedger(dirThread(p.dir, t)));
    assert.deepEqual([doPasso()?.arco, doPasso()?.efeito], ['arco-gt4a', 'retencao']);
    passar(5);
    abrirArco(p.dir, 'arco-gt4b', { trabalhos: [daThread('w1', t)] });
    assert.deepEqual([doPasso()?.arco, doPasso()?.efeito], ['arco-gt4b', 'guarda'], 'o arco novo vigente guarda');
    revogarArco(p.dir, 'arco-gt4b');
    assert.equal(doPasso(), null, 'o arco novo, autorizado depois, acabou a retenção do antigo');
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// O apoio do passo do arco (o da N2), com o despacho simulado.
// ---------------------------------------------------------------------------

let sessoes = 0;
function opcoesDoPasso(itens: string[], prompts: string[] = []): OpcoesDoPasso {
  assert.ok(kernelDisponivel(), 'o passo do arco exige /usr/bin/flock');
  return {
    maquina: 'maquina-simulada',
    lerReservas: () => ({ leitura: 'copia-local', reservas: itens.map(item => ({ item, maquina: 'maquina-simulada', thread: null })) }),
    consultarSessoes: () => ({ sessoes: [], fontes: [{ origem: 'claude agents --json (conta do processo)', ok: true, detalhe: '' }],
      contas: [{ runtime: 'claude-bg' as const, perfil: null }] }),
    perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }],
    abrirThread: (carregado, o) => novaThread(carregado, { ...o, criarWorktree: false }).thread,
    // A baseline do despacho, SIMULADA: só o evento que o núcleo grava, sem rodar a suíte.
    gravarBaseline: (carregado, threadId) => {
      registrar(dirThread(carregado.raiz, threadId), threadId, TIPOS_DE_EVENTO.baselineGravada, { commit: 'SIMULADO', comandos: [] });
    },
    despachar: (carregado, threadId, o) => {
      sessoes += 1;
      prompts.push(o.prompt);
      registrar(dirThread(carregado.raiz, threadId), threadId, TIPOS_DE_EVENTO.faseDespachada, { fase: o.fase,
        sessionId: `00000000-0000-4000-8000-${String(sessoes).padStart(12, '0')}`, runtime: 'claude-bg', pausaAoFim: false,
        correlacao: o.correlacao });
      return { sessionId: `00000000-0000-4000-8000-${String(sessoes).padStart(12, '0')}`, verificada: true, bloqueado: false,
        motivo: null } as unknown as ResultadoRun;
    },
  };
}

/** O passo do arco até o despacho: com a baseline do bloco com GO, o primeiro passo a grava e o seguinte despacha. */
function despacharPeloPasso(p: ProjetoDeTeste, arco: string, opcoes: OpcoesDoPasso): ResultadoDoPasso {
  let r = passoDoArco(p.carregado, arco, opcoes);
  for (let i = 0; i < 2 && r.acao === 'aguardar' && r.motivo === 'baseline-gravada'; i++) r = passoDoArco(p.carregado, arco, opcoes);
  return r;
}

/** A emenda do envelope, proposta e autorizada pelo ingresso assinado, como a do dono. */
function autorizarEmenda(p: ProjetoDeTeste, arco: string, pedido: Record<string, unknown>): void {
  const agora = new Date().toISOString();
  const { envelopeSha256 } = proporEnvelope(p.dir, pedido, agora);
  autorizarPeloIngresso(p.dir, arco, envelopeSha256, assinadoPara(arco, textoDeAutorizacao(envelopeSha256), agora), agora);
}

test('GS15: no arco revogado, a sessão que ele despachou e que ainda conduz a thread não entrega; acabada a sessão, a thread se entrega à mão', () => {
  const p = projetoTemporario('gs15', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'sessao em voo', modo: 'auto' });
    const sha = abrirArco(p.dir, 'arco-gs15', { trabalhos: [daThread('w1', thread.id)] });
    const r = reservarDespacho(p.dir, { arco: 'arco-gs15', envelopeSha256: sha, trabalho: 'w1', thread: thread.id, fase: 'CHECK', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    const sessao = '00000000-0000-4000-8000-000000001515';
    concluirDespacho(p.dir, 'arco-gs15', r.seq, { thread: thread.id, sessionId: sessao, idempotente: false });
    revogarArco(p.dir, 'arco-gs15');
    const g = guardaDaThread(p.dir, thread.id);
    assert.deepEqual([g?.motivo, g?.situacao], [MOTIVO_DA_GUARDA, 'revogado']);
    assert.match(g!.texto, /a sessão 00000000-0000-4000-8000-000000001515 que ele despachou ainda conduz a thread/);
    assert.equal(ship(p.carregado, thread.id, { para: 'main', dryRun: true }).codigo, MOTIVO_DA_GUARDA, 'o ship da sessão do arco revogado recusa');
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'CHECK', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    assert.equal(guardaDaThread(p.dir, thread.id), null, 'acabada a sessão, a thread se entrega à mão');
    assert.notEqual(ship(p.carregado, thread.id, { para: 'main', dryRun: true }).codigo, MOTIVO_DA_GUARDA);
  } finally { p.limpar(); }
});

test('GT5: o arco que não se lê não tem relatório: as ações das threads dele ficam no pulse, bloqueadas, com o texto da guarda', () => {
  const p = projetoTemporario('gt5', true);
  try {
    const parada = comPedido(p, 'gt5 parada');
    const masterDoArco = novaThread(p.carregado, { nome: 'gt5 master', modo: 'auto' }).thread.id;
    abrirArco(p.dir, 'arco-gt5', { trabalhos: [daThread('w1', parada), daThread('w2', masterDoArco, 'RM-902', 2)] });
    faseConcluida(p, parada, 'GOAL', 'noctum:arco-gt5');
    despachoDaFase(p, masterDoArco, 'GO', 'noctum:arco-gt5');
    registrar(dirThread(p.dir, masterDoArco), masterDoArco, TIPOS_DE_EVENTO.shipConcluido, { origem: 'pr', pr: 7, simulado: true });
    // Uma linha com MAC que não confere: o log do arco reprova toda leitura.
    const log = path.join(raizDoEstado(p.dir), '.orkastery', 'noctum', 'arcos', 'arco-gt5', 'arco.jsonl');
    fs.appendFileSync(log, `${JSON.stringify({ dados: { seq: 99 }, mac: '0'.repeat(64) })}\n`);
    autorizar(p, ['despachar', 'master']);
    const chamadas: string[] = [];
    const r = baterConducao(p.carregado, opcoesDaBatida(chamadas));
    assert.equal(r.ocupada, false);
    assert.deepEqual(chamadas, [], 'nada sai pela thread do arco que não se lê');
    const daBatida = pendentesDaUltimaBatida(p.dir, new Date().toISOString()).filter(a => a.thread === parada);
    assert.deepEqual(daBatida.map(a => [a.acao, a.motivoDoBloqueio]), [['despachar', 'thread-do-arco']]);
    assert.match(daBatida[0].bloqueio ?? '', /^noctum\.guarda\.arco-ilegivel: o último despacho da thread .* foi do arco arco-gt5/);
    const depois = new Date(Date.now() + 40 * MIN).toISOString();
    const doPulse = acoesPendentes(p.carregado, { fantasmas: () => [], vivas: () => [], quando: depois }).filter(a => a.thread === masterDoArco);
    assert.deepEqual(doPulse.map(a => [a.acao, a.motivoDoBloqueio]), [['master', 'thread-do-arco']]);
    assert.match(doPulse[0].bloqueio ?? '', /^noctum\.guarda\.arco-ilegivel: /);
  } finally { p.limpar(); }
});

test('GS16: no arco revogado, a sessão aberta cuja reserva ficou pendente (o condutor morreu antes de concluir) também não entrega', () => {
  const p = projetoTemporario('gs16', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'reserva pendente', modo: 'auto' });
    const sha = abrirArco(p.dir, 'arco-gs16', { trabalhos: [daThread('w1', thread.id)] });
    reservarDespacho(p.dir, { arco: 'arco-gs16', envelopeSha256: sha, trabalho: 'w1', thread: thread.id, fase: 'CHECK', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    // O runtime abriu a sessão com a correlação do arco, e o condutor morreu antes de concluir a reserva.
    passar(5);
    const sessao = despachoDaFase(p, thread.id, 'CHECK', 'noctum:arco-gs16');
    revogarArco(p.dir, 'arco-gs16');
    const g = guardaDaThread(p.dir, thread.id);
    assert.deepEqual([g?.motivo, g?.situacao], [MOTIVO_DA_GUARDA, 'revogado']);
    assert.match(g!.texto, new RegExp(`a sessão ${sessao} que ele despachou ainda conduz a thread`));
    assert.equal(ship(p.carregado, thread.id, { para: 'main', dryRun: true }).codigo, MOTIVO_DA_GUARDA, 'o ship da sessão da reserva pendente recusa');
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'CHECK', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    assert.equal(guardaDaThread(p.dir, thread.id), null, 'acabada a sessão, a thread se entrega à mão');
  } finally { p.limpar(); }
});

test('GT6: depois de 2 h, o pulo do arco que não se lê segue no pulse com o texto da guarda, e não vira espera longa', () => {
  const p = projetoTemporario('gt6');
  try {
    const parada = comPedido(p, 'gt6 parada');
    abrirArco(p.dir, 'arco-gt6', { trabalhos: [daThread('w1', parada)] });
    // O GOAL acabou há 3 h: o despacho do GO espera desde então.
    const ha3h = new Date(Date.now() - 3 * HORA).toISOString();
    const sessionId = despachoDaFase(p, parada, 'GOAL', 'noctum:arco-gt6', ha3h);
    registrar(dirThread(p.dir, parada), parada, 'phase_result', { fase: 'GOAL', sessionId, classificacao: 'fase_concluida', ok: true, ts: ha3h });
    const log = path.join(raizDoEstado(p.dir), '.orkastery', 'noctum', 'arcos', 'arco-gt6', 'arco.jsonl');
    fs.appendFileSync(log, `${JSON.stringify({ dados: { seq: 99 }, mac: '0'.repeat(64) })}\n`);
    autorizar(p, ['despachar']);
    const chamadas: string[] = [];
    assert.equal(baterConducao(p.carregado, opcoesDaBatida(chamadas)).ocupada, false);
    assert.deepEqual(chamadas, []);
    const item = lerRetratoDaBatida(p.dir)!.pendentes.find(i => i.thread === parada);
    assert.equal(item?.desdeEm, ha3h, 'o despacho espera desde o fim do GOAL, há 3 h');
    const daBatida = pendentesDaUltimaBatida(p.dir, new Date().toISOString()).filter(a => a.thread === parada);
    assert.deepEqual(daBatida.map(a => [a.acao, a.motivoDoBloqueio]), [['despachar', 'thread-do-arco']]);
    assert.match(daBatida[0].bloqueio ?? '', /^noctum\.guarda\.arco-ilegivel: /);
  } finally { p.limpar(); }
});

test('GS17: a guarda não fecha ciclo de import com o ship: carregado o ship antes, o ship publicar tem os modos que publicam', () => {
  // B1 do CHECK 3: a guarda importava o fechamento, e o ciclo ship -> guarda -> fechamento -> master -> ship deixava a
  // constante do ship publicar sem valor no processo do ork, onde o ship carrega primeiro.
  const src = path.resolve(__dirname, '../src');
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(src, 'ship.js'))});` +
    `const p = require(${JSON.stringify(path.join(src, 'ship-publicar.js'))});` +
    'process.stdout.write(JSON.stringify(p.MODOS_QUE_PUBLICAM ?? null));'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['maestro', 'auto']);
});

test('GS18: no arco revogado, a reserva pendente sem o id da sessão segura a thread com o texto da reserva, e devolvida, a solta', () => {
  const p = projetoTemporario('gs18', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'reserva sem id', modo: 'auto' });
    const sha = abrirArco(p.dir, 'arco-gs18', { trabalhos: [daThread('w1', thread.id)] });
    const r = reservarDespacho(p.dir, { arco: 'arco-gs18', envelopeSha256: sha, trabalho: 'w1', thread: thread.id, fase: 'CHECK', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    // O runtime pode ter aberto a sessão sem dizer o id: não há sessão a parar, e quem resolve é o vigia.
    revogarArco(p.dir, 'arco-gs18');
    const g = guardaDaThread(p.dir, thread.id);
    assert.deepEqual([g?.motivo, g?.situacao], [MOTIVO_DA_GUARDA, 'revogado']);
    assert.match(g!.detalhe, new RegExp(`a reserva ${r.seq} que ele fez para a thread ${thread.id} pode ter aberto uma sessão sem id`));
    assert.match(g!.correcao, /^espere o vigia reconciliar a reserva/);
    concluirDespacho(p.dir, 'arco-gs18', r.seq, { motivo: 'noctum.reconciliacao.sem-sessao' });
    assert.equal(guardaDaThread(p.dir, thread.id), null, 'devolvida a reserva, a thread se entrega à mão');
  } finally { p.limpar(); }
});

test('GS19: o arco agendado (autorizado, antes do início da janela) guarda a thread da lista, no ork ship e na guarda', () => {
  // CHECK 4: a guarda do agendado não tinha caso; tirá-la de guardaOsCaminhosManuais passava em todos os GS.
  const p = projetoTemporario('gs19', true);
  try {
    const { thread } = novaThread(p.carregado, { nome: 'agendada', modo: 'auto' });
    abrirArco(p.dir, 'arco-gs19', { trabalhos: [daThread('w1', thread.id)], deslocamentoH: 2 });
    assert.equal(lerArco(p.dir, 'arco-gs19')?.situacao, 'agendado');
    const g = guardaDaThread(p.dir, thread.id);
    assert.deepEqual([g?.motivo, g?.situacao, g?.origem], [MOTIVO_DA_GUARDA, 'agendado', 'envelope']);
    const antes = eventos(p, thread.id);
    const r = ship(p.carregado, thread.id, { para: 'main' });
    assert.deepEqual([r.ok, r.codigo], [false, MOTIVO_DA_GUARDA]);
    assert.match(r.detalhe, /é trabalho do arco arco-gs19 \(agendado, pela lista do envelope\)/);
    assert.equal(eventos(p, thread.id), antes, 'a recusa não vai ao ledger da thread');
  } finally { p.limpar(); }
});

test('GS20: no arco revogado, a reserva pendente do trabalho de pedido, feita antes de a thread existir, segura a thread que o arco abriu', () => {
  // M1 do CHECK 4: tirar da guarda a reserva pendente ainda sem thread gravada passava em todos os GS.
  const p = projetoTemporario('gs20', true);
  try {
    const pedido = 'Fatia SIMULADA que o arco abre por pedido.';
    const sha = abrirArco(p.dir, 'arco-gs20', { trabalhos: [{ id: 'w1', item: 'RM-920', prioridade: 1, dependeDe: [], pedido }] });
    const r = reservarDespacho(p.dir, { arco: 'arco-gs20', envelopeSha256: sha, trabalho: 'w1', thread: null, fase: 'GOAL', runtime: 'claude-bg',
      conta: 'perfil-a', revisao: false });
    // O condutor abriu a thread do pedido e o runtime abriu a sessão; o condutor morreu antes de concluir a reserva.
    passar(5);
    const aberta = threadDoTrabalho(p.carregado, 'pedido do arco', 'RM-920', pedido);
    const sessao = despachoDaFase(p, aberta.id, 'GOAL', 'noctum:arco-gs20');
    revogarArco(p.dir, 'arco-gs20');
    const reserva = lerArco(p.dir, 'arco-gs20')!.despachos.find(d => d.seq === r.seq)!;
    assert.deepEqual([reserva.desfecho, reserva.thread ?? null], ['pendente', null], 'a reserva segue pendente e sem a thread gravada');
    const g = guardaDaThread(p.dir, aberta.id);
    assert.deepEqual([g?.motivo, g?.situacao], [MOTIVO_DA_GUARDA, 'revogado']);
    assert.match(g!.texto, new RegExp(`a sessão ${sessao} que ele despachou ainda conduz a thread`));
    assert.equal(ship(p.carregado, aberta.id, { para: 'main', dryRun: true }).codigo, MOTIVO_DA_GUARDA, 'o ship da sessão da reserva pendente recusa');
    registrar(dirThread(p.dir, aberta.id), aberta.id, 'phase_result', { fase: 'GOAL', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    assert.equal(guardaDaThread(p.dir, aberta.id), null, 'acabada a sessão, a thread se entrega à mão');
  } finally { p.limpar(); }
});

test('GR1: a thread do trabalho vivo na outra máquina segue recusada depois do encerramento local', () => {
  const p = projetoTemporario('gr1');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'trabalho vivo na rede', modo: 'auto' });
    arcoV3Encerrado(p, 'arco-gr1', thread.id);
    const arcos = lerArcosDaRaiz(p.dir);
    let leituras = 0;
    const lerRede = () => { leituras += 1; return redeDaGuarda('arco-gr1', 'em-execucao'); };
    const primeira = guardaDaThread(p.dir, thread.id, arcos.quando, { arcos, lerRede });
    const segunda = guardaDaThread(p.dir, thread.id, arcos.quando, { arcos, lerRede });
    assert.deepEqual([primeira?.motivo, primeira?.situacao, primeira?.origem], [MOTIVO_DA_GUARDA, 'encerrado', 'rede']);
    assert.match(primeira!.detalhe, /trabalho w1 .* ainda em-execucao na rede/);
    assert.equal(segunda?.motivo, MOTIVO_DA_GUARDA);
    assert.equal(leituras, 1, 'a consulta compartilhada lê a rede do arco uma vez');
  } finally { p.limpar(); }
});

test('GR2: o trabalho terminal na rede libera os caminhos manuais', () => {
  const p = projetoTemporario('gr2');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'trabalho entregue na rede', modo: 'auto' });
    arcoV3Encerrado(p, 'arco-gr2', thread.id);
    assert.equal(guardaDaThread(p.dir, thread.id, undefined, { lerRede: () => redeDaGuarda('arco-gr2', 'entregue') }), null);
  } finally { p.limpar(); }
});

test('GR3: a rede sem leitura recusa só a thread com vínculo no arco v3 encerrado', () => {
  const p = projetoTemporario('gr3');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'rede ilegível', modo: 'auto' });
    const { thread: fora } = novaThread(p.carregado, { nome: 'fora do arco', modo: 'auto' });
    arcoV3Encerrado(p, 'arco-gr3', thread.id);
    const lacuna = { motivo: 'noctum.coordenacao.sem-remoto' as const, detalhe: 'remoto SIMULADO ausente' };
    const g = guardaDaThread(p.dir, thread.id, undefined, { lerRede: () => redeDaGuarda('arco-gr3', 'livre', lacuna) });
    assert.deepEqual([g?.motivo, g?.origem], [MOTIVO_DA_REDE_ILEGIVEL, 'rede']);
    assert.match(g!.detalhe, /^noctum\.guarda\.rede-ilegivel:/);
    assert.equal(guardaDaThread(p.dir, fora.id, undefined, { lerRede: () => { throw new Error('não deveria ler'); } }), null);
    assert.match(comLocale('en', () => guardaDaThread(p.dir, thread.id, undefined,
      { lerRede: () => redeDaGuarda('arco-gr3', 'livre', lacuna) })!.detalhe), /^noctum\.guarda\.rede-ilegivel:/);
  } finally { p.limpar(); }
});

test('GR4: a thread sem vínculo v3 não lê a rede', () => {
  const p = projetoTemporario('gr4');
  try {
    const { thread: doArco } = novaThread(p.carregado, { nome: 'vinculada', modo: 'auto' });
    const { thread: fora } = novaThread(p.carregado, { nome: 'sem vínculo', modo: 'auto' });
    arcoV3Encerrado(p, 'arco-gr4', doArco.id);
    let leituras = 0;
    assert.equal(guardaDaThread(p.dir, fora.id, undefined, { lerRede: () => { leituras += 1; return redeDaGuarda('arco-gr4', 'livre'); } }), null);
    assert.equal(leituras, 0);
  } finally { p.limpar(); }
});

test('GR5: o arco v2 encerrado segue liberando a thread sem ler rede', () => {
  const p = projetoTemporario('gr5');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'v2 encerrado', modo: 'auto' });
    abrirArco(p.dir, 'arco-gr5', { trabalhos: [daThread('w1', thread.id)] });
    encerrarArco(p.dir, 'arco-gr5', { motivo: 'hora', detalhe: 'fim SIMULADO' });
    let leituras = 0;
    assert.equal(guardaDaThread(p.dir, thread.id, undefined, { lerRede: () => { leituras += 1; return redeDaGuarda('arco-gr5', 'livre'); } }), null);
    assert.equal(leituras, 0);
  } finally { p.limpar(); }
});
