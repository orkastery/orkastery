/**
 * RM-058, integração (T1.1 da ork-rm058integra, D3 e D5): a guarda das threads do arco #Noctum nos caminhos de entrega de
 * fora do arco. Os nomes começam por GS. Arcos, itens, pedidos, contas, PRs e provas são SIMULADOS; o remoto é um repositório
 * bare local, e o `gh` é um falso que guarda os PRs na memória.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { commitar, envPtBr, projetoTemporario, ProjetoDeTeste, shaNoRemotoDeTeste } from './apoio';
import { abrirArco, pedidoV2, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { assinadoPara, HORA, MIN } from './noctum-n6-apoio';
import { atualizarBranchDaThread } from '../src/atualizar-branch';
import { prepararBundleCi } from '../src/ci';
import { registrarEntregaExternaPorPr, registrarEntregaPorPr, registrarEntregasPorPr } from '../src/entrega-pr';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { comLocale } from '../src/locale';
import { autorizarPeloIngresso, encerrarArco, lerArco, proporEnvelope, textoDeAutorizacao } from '../src/noctum-arco';
import { passoDoArco, OpcoesDoPasso, ResultadoDoPasso } from '../src/noctum-execucao';
import { guardaDaThread, linhaDoArco, MOTIVO_DA_GUARDA, MOTIVO_DO_ARCO_ILEGIVEL, pedidoDoArco } from '../src/noctum-guarda';
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
