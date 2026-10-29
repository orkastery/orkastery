import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chaveDoLocale, comLocale, cobreLocale, msg } from '../src/locale';
import { tabelaDeModos } from '../src/modos';
import { textoDaMigracaoModos } from '../src/modos-migracao';
import { tabelaDeVariantes } from '../src/ciclos';
import { cenario, EN, linhasEmPortugues, ork, PT } from './locale-apoio';
import { CADENCIAS, textoDaCadencia } from '../src/pulse-cadencia';
import { textoDasEstatisticas, LedgerStats } from '../src/ledger-stats';
import { tabelaDaPolitica, textoDaRetomada } from '../src/retry';
import { textoDaLimpeza, textoDoInventario } from '../src/sessoes';
import { textoDoRadar } from '../src/hitl';
import { textoDoGateDeTokens } from '../src/tokens';
import { textoDaRodada, textoDoReverify } from '../src/fix';
import { textoDoHandoff } from '../src/handoff';
import { textoDoRecall } from '../src/recall';
import { tabelaDeLeases } from '../src/leases';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textoDoPlano, textoDoReap } from '../src/board';
import { textoDoMonitor } from '../src/orquestracao';
import { textoDasLicoes } from '../src/licoes';
import { textoDaFabrica, textoDasOutrasMaquinas } from '../src/fabrica-estado';
import { textoDoEstadoDaBatida } from '../src/fabrica-batida';
import { textoDoEval } from '../src/evalrunner';
import { textoDoEstado } from '../src/memoria';
import { textoDoIndice } from '../src/indice-vetorial';
import { textoDaBuscaPorSignificado } from '../src/busca-semantica';
import { textoInstalacaoMcp } from '../src/mcp-install';
import { tabelaDeClasses } from '../src/master';
import { recusaDeConducao, textoDoStatusDaConducao } from '../src/conducao';
import { textoDaBatida } from '../src/conducao-batida';
import { textoDoStatusDaSentinela } from '../src/conducao-sentinela';
import { linhaDaAutorizacao, textoDaAutorizacao } from '../src/autorizacao-duravel';
import { textoDaAtualizacao } from '../src/atualizar-branch';
import { lerPedido, TEXTOS_DO_GRAFO } from '../src/intelligence-graph-cli';
import { textoDaResposta } from '../src/intelligence-graph-query';
import { tabelaDePacks } from '../src/auditoria';
import { tabelaDaDivida } from '../src/divida';
import { textoDaVarredura } from '../src/superficie';

test('F3d: modos, migracao e ciclos preservam pt-BR e têm texto completo em ingles', () => {
  const mudanca = { dryRun: true, backup: null, mudancas: [
    { arquivo: 'orkastery.yaml', campo: 'conduction.default_mode', de: 'look', para: 'classic' },
  ] };
  const pt = comLocale('pt-BR', () => [tabelaDeModos(), textoDaMigracaoModos(mudanca), tabelaDeVariantes()].join('\n'));
  const en = comLocale('en', () => [tabelaDeModos(), textoDaMigracaoModos(mudanca), tabelaDeVariantes()].join('\n'));

  assert.match(pt, /Modos de conducao/);
  assert.match(pt, /Simulacao \(--dry-run\), nada foi gravado/);
  assert.match(pt, /Variantes de ciclo/);
  assert.match(en, /Conduction modes/);
  assert.match(en, /Simulation \(`--dry-run`\): nothing was written/);
  assert.match(en, /Cycle variants/);
  assert.deepEqual(linhasEmPortugues(en, ['orkastery.yaml']), []);
});

test('F3d: audit localiza packs, divida e superficie sem mudar contratos tecnicos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ork-locale-audit-'));
  try {
    const resultado = { raiz: dir, detalhe: 'one source file scanned', frameworks: [], limitePorRegra: 5,
      achados: [], truncados: [] } as any;
    const pt = comLocale('pt-BR', () => [tabelaDePacks('nascente'), tabelaDaDivida(dir),
      textoDaVarredura({ ...resultado, detalhe: 'um arquivo-fonte varrido' })].join('\n'));
    const en = comLocale('en', () => [tabelaDePacks('nascente'), tabelaDaDivida(dir),
      textoDaVarredura(resultado)].join('\n'));
    assert.match(pt, /ATIVO A PARTIR DE/);
    assert.match(pt, /Board de divida vazio/);
    assert.match(pt, /Nenhum achado de superficie de ataque/);
    assert.match(en, /ACTIVE FROM/);
    assert.match(en, /Empty debt board/);
    assert.match(en, /No attack-surface finding/);
    assert.match(en, /Each finding carries the command/);
    assert.equal(cobreLocale(['audit'], {}), true);
    for (const sub of ['packs', 'run', 'list', 'show', 'prompt', 'ingest', 'verify', 'report', 'divida', 'surface'])
      assert.equal(cobreLocale(['audit', sub], {}), true, sub);
    assert.equal(cobreLocale(['audit', 'surface'], { json: true }), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F3d: ledger stats e estimate têm texto equivalente nas duas línguas', () => {
  const stats = {
    periodo: { desde: '2026-10-20T10:00:00.000Z', ate: '2026-10-20T11:00:00.000Z', intervalo: '[desde,ate)' },
    threads: 1, sessoes: { concluidas: 2, despachadas: 3, retries: 1 }, throughput: { ships: 1 },
    execucao: { horas: 1.25, cobertura: { medidas: 2, semMedida: 1 } },
    tokens: { total: 20, input: 10, cachedInput: 2, output: 10 },
    custoReferencia: { valor: null }, esperaHumana: { milissegundos: 60_000, abertas: 1 },
    hitlDeConducao: { pedidos: 1, paradoMs: 60_000, medianaRespostaMs: 60_000, dentroDaMeta: true,
      abertos: 0, emTexto: { foraDaExcecao: 0 } },
    riscosPreventivos: { total: 1 }, estimativasPlano: { amostras: 1 },
    qualidade: { observacoes: ['1 sessao(oes) sem medicao de tokens'] },
  } as unknown as LedgerStats;
  const pt = comLocale('pt-BR', () => textoDasEstatisticas(stats));
  const en = comLocale('en', () => [textoDasEstatisticas(stats), msg().operacao.ledger.estimativa('ork-x', 4, 2)].join('\n'));
  assert.match(pt, /threads\/sessoes/);
  assert.match(en, /threads\/sessions/);
  assert.match(en, /no coverage/);
  assert.match(en, /PLAN estimate recorded/);
  assert.deepEqual(linhasEmPortugues(en, ['[desde,ate)']), []);
});

test('F3d: pulse cadencia e as recusas de responder seguem o locale', () => {
  const quando = '2026-10-20T12:00:00.000Z';
  const pt = comLocale('pt-BR', () => textoDaCadencia(CADENCIAS['#OrkPulseOn-60m'], quando));
  const en = comLocale('en', () => [textoDaCadencia(CADENCIAS['#OrkPulseOn-60m'], quando),
    msg().operacao.pulseCadencia.umaTag, msg().operacao.pulseCadencia.responderUso].join('\n'));
  assert.match(pt, /de hora em hora/);
  assert.match(en, /hourly/);
  assert.match(en, /provide one tag at a time/);
  assert.match(en, /authenticated ingress envelope/);
  assert.deepEqual(linhasEmPortugues(en), []);
});

test('F3d: portfolio, creation, objective e ci têm molduras bilíngues', () => {
  const pt = comLocale('pt-BR', () => msg().operacao.produto.objective('list'));
  const en = comLocale('en', () => {
    const m = msg().operacao.produto;
    return [m.portfolio.vazio, m.portfolio.naoEncontrada('p1'), m.creation.versao,
      m.objective('list'), m.ci.resultado(true, 'ok'), m.ci.status(false, 'pending')].join('\n');
  });
  assert.match(pt, /saiu do produto/);
  assert.match(en, /Portfolio is empty/);
  assert.match(en, /positive integer/);
  assert.match(en, /left the product/);
  assert.match(en, /CI PASSED/);
  assert.match(en, /CI NOT CLEARED/);
  assert.deepEqual(linhasEmPortugues(en), []);
});

test('F3d: retry complementar cobre policy, parse, fila, retomada e cancelamento', () => {
  const pt = comLocale('pt-BR', () => tabelaDaPolitica());
  const en = comLocale('en', () => [tabelaDaPolitica(), textoDaRetomada([]),
    msg().retry.complementar.semSinal, msg().retry.complementar.cancelado('rl-1')].join('\n'));
  assert.match(pt, /MOTIVO TIPADO/);
  assert.match(en, /TYPED REASON/);
  assert.match(en, /No rate-limit signal/);
  assert.match(en, /No rate-limit queue request/);
  assert.match(en, /Request rl-1 cancelled/);
  assert.deepEqual(linhasEmPortugues(en), []);
});

test('F3d: sessions localiza inventario, limpeza e radar sem mudar os dados observados', () => {
  const inventario = {
    escopo: { global: false, usuario: 'builder', historico: true },
    fontes: [{ origem: 'claude-bg', ok: true, ausente: false, detalhe: '' }],
    total: 0, semThread: 0, ambiguas: 0, fantasmas: 0, ok: true, sessoes: [],
  } as any;
  const radar = {
    resumo: { total: 0, precisamDeHumano: 0, hitl: 0, abandonadas: 0, falhas: 0,
      desconhecidas: 0, trabalhando: 0, acimaDoLimite: 0, foraDoOrk: 0 },
    atencaoMin: 15, runtimeConsultado: true, runtimeDetalhe: '', logsLidos: true, sessoes: [],
  } as any;
  const pt = comLocale('pt-BR', () => [textoDoInventario(inventario),
    textoDaLimpeza({ ok: true, dryRun: false, itens: [], falhas: [] }), textoDoRadar(radar)].join('\n'));
  const en = comLocale('en', () => [textoDoInventario(inventario),
    textoDaLimpeza({ ok: true, dryRun: false, itens: [], falhas: [] }), textoDoRadar(radar)].join('\n'));
  assert.match(pt, /Inventário do projeto/);
  assert.match(en, /Project inventory/);
  assert.match(en, /No ghost session/);
  assert.match(en, /Runtime session radar/);
  assert.deepEqual(linhasEmPortugues(en, ['claude-bg']), []);

  for (const sub of ['watch', 'event', 'list', 'limpar-fantasmas', 'hitl', 'request', 'answer',
    'reconcile', 'supersede', 'adopt', 'logs', 'stop', 'attach']) {
    assert.equal(cobreLocale(['sessions', sub], {}), true, chaveDoLocale(['sessions', sub], {}));
  }
});

test('F3d: gate localiza usos, autorizacao e o parecer de tokens', () => {
  const veredito = {
    thread: 'ork-x', medida: { ocupacao: 0.8, fonte: 'informada',
      detalhe: 'ocupacao 80.0% declarada pelo chamador como fonte informada' },
    proximoPasso: 'GO', passoPesado: true, veredito: 'new-session', decididoPor: 'medicao',
    razao: 'ocupacao 80.0% >= rotate_above (70%) e o proximo passo e pesado (GO): mais janela significa mais acuracia.',
    slugSugerido: 'ork-x-go-2', limiares: { rotate_above: 0.7, force_rotate_above: 0.9 },
    decididoEm: '2026-10-20T12:00:00.000Z',
  } as any;
  const pt = comLocale('pt-BR', () => textoDoGateDeTokens(veredito));
  const en = comLocale('en', () => textoDoGateDeTokens(veredito));
  assert.match(pt, /ocupacao       80.0%/);
  assert.match(pt, /VEREDITO: new-session/);
  assert.match(en, /occupancy     80.0%/);
  assert.match(en, /80.0% occupancy declared by the caller/);
  assert.match(en, /VERDICT: new-session/);
  assert.match(en, /next step is heavy/);
  assert.match(en, /Recorded in the ledger as token_gate/);
  assert.deepEqual(linhasEmPortugues(en), []);
  for (const sub of ['context', 'request', 'answer', 'next', 'approve'])
    assert.equal(cobreLocale(['gate', sub], {}), true, sub);
});

test('F3d: fix, handoff e recall localizam a moldura e preservam payloads', () => {
  const rodada = { thread: 'ork-x', rodada: 0, veredito: 'PASSOU', correcoes: [], temTipoB: false,
    spec: '', motivos: [], abertaEm: '2026-10-20T12:00:00.000Z' } as any;
  const reverify = { thread: 'ork-x', rodada: 1, cobertura: 'completa', vereditos: [], verify: null,
    veredito: 'PASSOU', rodadas: 1, limite: 3, escalado: false, motivos: [], razao: 'dado preservado' } as any;
  const handoff = { thread: 'ork-x', memory: 'files', de: { slug: 'x-go', fase: 'GO' },
    para: { slug: 'x-check', fase: 'CHECK' }, inline: [], pointers: [], summaries: [] } as any;
  const recall = { thread: 'ork-x', momento: 'CHECK', regime: 'files', regimeDoHandoff: 'files',
    resolvidos: [], adiados: [], falhas: [] } as any;
  const pt = comLocale('pt-BR', () => [textoDaRodada(rodada), textoDoReverify(reverify),
    textoDoHandoff(handoff, 'handoff.json'), textoDoRecall(recall)].join('\n'));
  const en = comLocale('en', () => [textoDaRodada(rodada), textoDoReverify(reverify),
    textoDoHandoff(handoff, 'handoff.json'), textoDoRecall(recall)].join('\n'));
  assert.match(pt, /CHECK PASSOU/);
  assert.match(en, /CHECK PASSED/);
  assert.match(en, /CHECK-REVERIFY for thread/);
  assert.match(en, /Handoff exported from thread/);
  assert.match(en, /CRITICAL \(0 item/);
  assert.match(en, /Recall for thread/);
  assert.match(en, /RESOLVED \(0/);
  assert.deepEqual(linhasEmPortugues(en, ['dado preservado']), []);
  for (const [command, sub] of [['fix', 'open'], ['fix', 'list'], ['fix', 'reverify'],
    ['handoff', 'export'], ['handoff', 'recall']] as const)
    assert.equal(cobreLocale([command, sub], {}), true, `${command} ${sub}`);
  assert.equal(cobreLocale(['recall'], {}), true);
});

test('F3d: lease localiza a listagem vazia e todas as rotas públicas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ork-f3d-lease-'));
  try {
    const pt = comLocale('pt-BR', () => tabelaDeLeases(dir));
    const en = comLocale('en', () => tabelaDeLeases(dir));
    assert.match(pt, /^Leases do projeto/);
    assert.match(pt, /Nenhum lease tomado/);
    assert.match(en, /^Project leases/);
    assert.match(en, /No lease held/);
    assert.match(en, /Resume queue: empty/);
    assert.match(en, /Merge queue .*: empty/);
    assert.deepEqual(linhasEmPortugues(en), []);
    for (const sub of ['list', 'acquire', 'take', 'release'])
      assert.equal(cobreLocale(['lease', sub], {}), true, sub);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F3d: board localiza o plano, reap e rotas sem alterar o plano', () => {
  const plano = { decididoEm: '2026-10-20T12:00:00.000Z', maxParalelas: 2, emAndamento: 0,
    vagas: [], filaDeMerge: [], filaDeRegiao: [] } as any;
  const pt = comLocale('pt-BR', () => [textoDoPlano(plano), textoDoReap([])].join('\n'));
  const en = comLocale('en', () => [textoDoPlano(plano), textoDoReap([])].join('\n'));
  assert.match(pt, /Escalonador por maquina/);
  assert.match(en, /Per-machine scheduler/);
  assert.match(en, /parallelism limit: 2/);
  assert.match(en, /Merge queue .*the only merge gate/);
  assert.match(en, /No slot to return/);
  assert.deepEqual(linhasEmPortugues(en), []);
  for (const sub of ['list', 'plan', 'plano', 'reap'])
    assert.equal(cobreLocale(['board', sub], {}), true, sub);
});

test('F3d: orquestracao e monitor localizam a visao vazia nas duas linguas', () => {
  const monitor = { projeto: 'demo', consultadoEm: '2026-10-20T12:00:00.000Z', atencaoMin: 30,
    runtimeConsultado: true, runtimeDetalhe: '', perfis: ['default'], linhas: [],
    resumo: { threads: 0, aguardandoHumano: 0, comImpedimento: 0, emAndamento: 0,
      podemAvancar: 0, fechadas: 0, acimaDoLimite: 0 } } as any;
  const pt = comLocale('pt-BR', () => textoDoMonitor(monitor));
  const en = comLocale('en', () => textoDoMonitor(monitor));
  assert.match(pt, /^Monitor de orquestracao/);
  assert.match(en, /^Orchestration monitor/);
  assert.match(en, /waiting for a human: 0/);
  assert.match(en, /No stopped thread/);
  assert.deepEqual(linhasEmPortugues(en), []);
  assert.equal(cobreLocale(['orquestracao', 'status'], {}), true);
  assert.equal(cobreLocale(['orquestracao', 'wat'], {}), true);
  assert.equal(cobreLocale(['monitor'], {}), true);
});

test('F3d: licoes injetadas no ciclo seguem a lingua sem traduzir evidencia', () => {
  const resumo = { threads: 3,
    motivos: [{ nome: 'claims.failed', threads: ['a', 'b'], dica: 'dado preservado' }],
    classes: [{ nome: 'processo', threads: ['c'], dica: null }],
    recentes: [{ thread: 'ork-x', score: 3, justificativa: 'justificativa preservada' }] } as any;
  const pt = comLocale('pt-BR', () => textoDasLicoes(resumo));
  const en = comLocale('en', () => textoDasLicoes(resumo));
  assert.match(pt, /^Das 3 threads/);
  assert.match(en, /^From the 3 threads/);
  assert.match(en, /the claims\.failed block occurred/);
  assert.match(en, /the processo failure class/);
  assert.match(en, /closed with 3\/5/);
  assert.match(en, /dado preservado/);
  assert.equal(cobreLocale(['licoes'], {}), true);
});

test('F3d: demo oferece a mesma narrativa nas duas linguas', () => {
  const pt = comLocale('pt-BR', () => msg().operacao.restante.demo);
  const en = comLocale('en', () => msg().operacao.restante.demo);
  assert.match(pt.titulo, /afirmacao do agente/);
  assert.match(pt.vereditoAntes(false, 'claims.failed'), /REPROVADO/);
  assert.match(en.titulo, /agent's claim/);
  assert.match(en.passo2, /does not accept self-reporting/);
  assert.match(en.vereditoDepois(true, ''), /CLAIM SUPPORTED/);
  assert.match(en.proximo, /In your project/);
  assert.equal(cobreLocale(['demo'], {}), true);
});

test('F3d: fabrica e batida localizam os estados de leitura sem mudar contratos', () => {
  const painel = { maquinas: [], atualizado: false, ponta: null } as any;
  const batida = { maquina: 'box', projeto: 'demo', leitura: { ok: true }, instalada: false,
    intervaloMin: null, gerenciada: null, manuais: [], ultimaRodada: null, autorizacao: null } as any;
  const pt = comLocale('pt-BR', () => [textoDaFabrica(painel, 'box'),
    textoDasOutrasMaquinas(painel, 'box'), textoDoEstadoDaBatida(batida)].join('\n'));
  const en = comLocale('en', () => [textoDaFabrica(painel, 'box'),
    textoDasOutrasMaquinas(painel, 'box'), textoDoEstadoDaBatida(batida)].join('\n'));
  assert.match(pt, /Nenhuma maquina publicou/);
  assert.match(en, /No machine has published/);
  assert.match(en, /Other machines/);
  assert.match(en, /Factory heartbeat/);
  assert.match(en, /installed: no/);
  assert.deepEqual(linhasEmPortugues(en, ['ork/fabrica-estado']), []);
  for (const sub of ['list', 'publicar', 'entrar', 'sair', 'batida'])
    assert.equal(cobreLocale(['fabrica', sub], {}), true, sub);
  assert.equal(cobreLocale(['fabrica', 'outro'], {}), true);
});

test('F3d: eval localiza o parecer e mantem codigos de falha', () => {
  const resultado = { catalogo: '/tmp/catalog', skills: [], canarios: [], totalDeCasos: 0,
    totalDeAssercoes: 0, metadeComportamental: 'unavailable', ok: false,
    falhas: [{ codigo: 'fixture-invalida', detalhe: 'dado preservado' }] } as any;
  const pt = comLocale('pt-BR', () => textoDoEval(resultado));
  const en = comLocale('en', () => textoDoEval(resultado));
  assert.match(pt, /^ork eval, catalogo em/);
  assert.match(en, /^ork eval, catalog at/);
  assert.match(en, /Failures/);
  assert.match(en, /\[fixture-invalida\]/);
  assert.match(en, /behavioral half/);
  assert.match(en, /VERDICT: red/);
  assert.equal(cobreLocale(['eval'], {}), true);
});

test('F3d: memory localiza estado, indice e busca mantendo dados e codigos', () => {
  const estado = { pedido: 'files', efetivo: 'files', motivo: 'dsn.env-ausente', detalhe: 'dado preservado',
    correcao: 'comando preservado', variavel: '', dsnPresente: false, cli: 'orkmind', tenant: 'demo' } as any;
  const indice = { alvo: 'primario', modelo: null, dim: null, arquivo: null, dryRun: true, universo: 0,
    porColecao: {}, foraDaBusca: null, latenciaUniversoMs: null, coerentes: 0, embedados: 0, reescritos: 0,
    removidos: 0, recusados: 0, foraDoLimite: 0, truncados: 0, tokensEstimados: 0,
    custoEstimadoUsd: null, chamadasAoProvider: 0, motivo: null, detalhe: '' } as any;
  const busca = { texto: 'x', modo: 'hibrido', origem: 'nenhum', modeloUsado: null, deterministico: false,
    motivo: null, detalhe: '', resultados: [], listas: { vetor: [], fts: [] }, ftsForaDoUniverso: 0,
    coberturaDoIndice: null } as any;
  const pt = comLocale('pt-BR', () => [textoDoEstado(estado), textoDoIndice(indice),
    textoDaBuscaPorSignificado(busca)].join('\n'));
  const en = comLocale('en', () => [textoDoEstado(estado), textoDoIndice(indice),
    textoDaBuscaPorSignificado(busca)].join('\n'));
  assert.match(pt, /^Regime de memoria/);
  assert.match(en, /^Project memory regime/);
  assert.match(en, /Vector index/);
  assert.match(en, /Search by meaning/);
  assert.match(en, /dsn\.env-ausente/);
  assert.match(en, /dado preservado/);
  for (const sub of ['status', 'inventory', 'migrate', 'sync', 'search', 'index'])
    assert.equal(cobreLocale(['memory', sub], {}), true, sub);
  assert.equal(cobreLocale(['memory', 'outro'], {}), true);
});

test('F3d: instalacao do MCP localiza a orientacao sem alterar caminho ou estado', () => {
  const resultado = { arquivo: '/tmp/projeto/.mcp.json', estado: 'novo', dryRun: true,
    ativacao: 'pendente-no-cliente' } as const;
  const pt = comLocale('pt-BR', () => textoInstalacaoMcp(resultado));
  const en = comLocale('en', () => textoInstalacaoMcp(resultado));
  assert.match(pt, /^Simulacao: nenhuma escrita\./);
  assert.match(en, /^Simulation: no writes\./);
  assert.match(en, /complete the native consent/);
  assert.match(en, /\/tmp\/projeto\/\.mcp\.json \(novo\)/);
  assert.deepEqual(linhasEmPortugues(en, ['/tmp/projeto/.mcp.json', 'novo']), []);
  assert.equal(cobreLocale(['mcp', 'install'], {}), true);
  assert.equal(cobreLocale(['mcp', 'serve'], {}), true);
  assert.equal(cobreLocale(['privado'], {}), false);
});

test('F3d: MASTER complementar localiza classes, score e a recusa da fila aposentada', () => {
  const pt = comLocale('pt-BR', () => tabelaDeClasses());
  const en = comLocale('en', () => [tabelaDeClasses(), msg().master.complementar.usoScore,
    msg().master.complementar.justificativa('ork-x'), msg().master.complementar.batchAposentado].join('\n'));
  assert.match(pt, /^Classes de falha do POSTMORTEM/);
  assert.match(en, /^POSTMORTEM failure classes/);
  assert.match(en, /the goal or plan was wrong/);
  assert.match(en, /Score REJECTED for thread ork-x/);
  assert.match(en, /score ratification queue was retired/);
  assert.deepEqual(linhasEmPortugues(en), []);
  assert.equal(cobreLocale(['master', 'classes'], {}), true);
  assert.equal(cobreLocale(['master', 'batch'], {}), true);
  assert.equal(cobreLocale(['master', 'ork-x'], { score: '4' }), true);
  assert.equal(cobreLocale(['master', 'audit'], {}), true);
  assert.equal(cobreLocale(['privado'], {}), false);
});

test('F3d: todas as rotas de conducao ativam o catálogo bilíngue', () => {
  const pt = comLocale('pt-BR', () => msg().conducao.cli.assumida(true, 'detalhe preservado'));
  const en = comLocale('en', () => [msg().conducao.cli.assumida(true, 'detail preserved'),
    msg().conducao.status.livre('ork-x'), msg().conducao.sentinela.nenhuma,
    msg().conducao.autorizacao.semEfeito, msg().conducao.batida.nada].join('\n'));
  assert.match(pt, /^Conducao assumida\./);
  assert.match(en, /^Conduction taken over\./);
  assert.match(en, /nobody is conducting/);
  assert.match(en, /no open thread/);
  assert.match(en, /Nothing advanced again/);
  assert.deepEqual(linhasEmPortugues(en), []);
  for (const sub of ['status', 'assumir', 'atualizar', 'autorizar', 'autorizacao', 'batida', 'sentinela'])
    assert.equal(cobreLocale(['conducao', sub], {}), true, sub);
  assert.equal(cobreLocale(['conducao', 'outro'], {}), true);
});

test('F3d: os resumos e a recusa de conducao saem completos nas duas linguas', () => {
  const atual = { thread: 'ork-x', canal: 'cli', sessao: null, fase: 'GO',
    desde: '2026-10-20T12:00:00.000Z', promptSha256: 'a'.repeat(64), operacao: 'phase.run',
    dono: { tipo: 'reserva', por: 'builder', maquina: 'box' }, expiraEm: '2026-10-20T13:00:00.000Z',
    identidade: 'id' } as any;
  const autorizacao = { valida: false, arquivo: '/tmp/autorizacao.json',
    motivo: 'autorizacao.ausente', detalhe: 'dado preservado' } as any;
  const gerar = () => [textoDoStatusDaConducao('ork-x', null),
    recusaDeConducao('ork-x', atual, { canal: 'cli', operacao: 'phase.run', fase: 'GO' } as any,
      { agora: '2026-10-20T12:30:00.000Z' }).texto,
    textoDaBatida({ ocupada: true, detalhe: 'dado preservado' } as any),
    textoDoStatusDaSentinela({ maquina: 'box', presenca: null, threads: [] } as any),
    textoDaAutorizacao(autorizacao), linhaDaAutorizacao(autorizacao),
    textoDaAtualizacao({ contrato: 'ork.branch-atualizada/v1', thread: 'ork-x', branch: 'ork/x',
      base: 'main', acao: 'ja-atualizada', sha: 'a'.repeat(40), enviada: false } as any)].join('\n');
  const pt = comLocale('pt-BR', gerar);
  const en = comLocale('en', gerar);
  assert.match(pt, /ninguem conduz agora/);
  assert.match(en, /nobody is conducting/);
  assert.match(en, /Request not executed/);
  assert.match(en, /What you can do/);
  assert.match(en, /Another conduction heartbeat/);
  assert.match(en, /No valid durable authorization/);
  assert.match(en, /already contains main/);
  assert.deepEqual(linhasEmPortugues(en, ['dado preservado', 'Não publicado',
    '--ate <date> --pode merge,registrar,master,despachar [--por <your name>]']), []);
});

test('F3d (GO-FIX 2): esperar a vez e frase natural em ingles, logo acima do comando que ela descreve', () => {
  // CHECK da F3d, achado 4: a explicacao tinha o verbo sem sujeito; o pt-BR fica como era, byte a byte.
  assert.equal(msg('en').conducao.recusa.esperar, 'Wait your turn: the command below repeats this request and '
    + 'proceeds on its own once the current conduction ends (waiting up to 30 min).');
  assert.equal(msg('pt-BR').conducao.recusa.esperar,
    'Esperar a vez: repete este pedido e segue sozinho quando a conducao atual terminar (ate 30 min).');
  const texto = (locale: 'pt-BR' | 'en') => comLocale(locale, () => recusaDeConducao('ork-x', null,
    { canal: 'cli', operacao: 'phase.run', fase: 'GO' } as any).texto);
  assert.match(texto('en'), /\n {2}1\. Wait your turn: the command below repeats this request [^\n]+\n {5}ork phase run ork-x GO /);
  assert.match(texto('pt-BR'), /\n {2}1\. Esperar a vez: repete este pedido [^\n]+\n {5}ork phase run ork-x GO /);
});

test('F3d: grafo localiza uso e resposta humana sem alterar o contrato JSON', () => {
  const resposta = { consulta: { tipo: 'vizinhos', alvo: 'src/a.ts', profundidade: 1, sentido: 'ambos',
      tipos: ['contains'], limite: 10 },
    indice: { repository_id: 'demo', revision: 'a'.repeat(40), chave: 'b'.repeat(32),
      snapshot_id: 'snap-1', arvore: 'limpa', extratores: [] },
    alvo: { rotulo: 'src/a.ts' }, arestas: [], total_arestas: 0, total_nos: 1,
    fontes: [], truncado: false, parcial: 'dado pt-BR do JSON' } as any;
  // GO-FIX 1: a familia do grafo nao importa o catalogo (fronteira do KG3); quem chama passa a redacao do locale.
  const erro = (locale: 'pt-BR' | 'en') => {
    try { lerPedido([], msg(locale).grafo); return ''; } catch (e) { return (e as Error).message; }
  };
  const pt = textoDaResposta(resposta, msg('pt-BR').grafo.consulta);
  const en = textoDaResposta(resposta, msg('en').grafo.consulta);
  assert.match(erro('pt-BR'), /^grafo\.uso: falta o subcomando/);
  assert.match(erro('en'), /^grafo\.uso: missing subcommand/);
  assert.match(pt, /^grafo de demo na revisao/);
  assert.match(en, /^graph for demo at revision/);
  assert.match(en, /0 edge\(s\), 0 node\(s\)/);
  assert.match(en, /partial: only edges proven/);
  assert.doesNotMatch(en, /dado pt-BR do JSON/);
  // Sem a redacao, a familia fala o pt-BR dela, o mesmo do catalogo, qualquer que seja o locale ativo.
  assert.equal(comLocale('en', () => textoDaResposta(resposta)), pt);
  assert.equal(cobreLocale(['grafo', 'status'], {}), true);
  assert.equal(cobreLocale(['grafo', 'status'], { json: true }), false);
});

/** GO-FIX 1: as folhas de duas redacoes lado a lado; cada funcao e chamada com argumentos que ligam e desligam os ramos. */
function mesmaRedacao(familia: unknown, catalogo: unknown, onde: string): void {
  if (typeof familia === 'function') {
    assert.equal(typeof catalogo, 'function', onde);
    const chamadas = onde.endsWith('.indexar.extracao.lista')
      ? [[['a1', 'a2', 'a3', 'a4', 'a5', 'a6']], [[]]]
      : [['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], ['', '', '', '', '', '']];
    for (const args of chamadas) {
      assert.equal((catalogo as (...x: unknown[]) => string)(...args), (familia as (...x: unknown[]) => string)(...args), onde);
    }
  } else if (familia !== null && typeof familia === 'object') {
    assert.deepEqual(Object.keys(catalogo as object), Object.keys(familia), onde);
    for (const [k, v] of Object.entries(familia)) mesmaRedacao(v, (catalogo as Record<string, unknown>)[k], `${onde}.${k}`);
  } else {
    assert.equal(catalogo, familia, onde);
  }
}

test('F3d (GO-FIX 1): o pt-BR do catalogo do grafo e o da familia, que nao importa o catalogo', () => {
  mesmaRedacao(TEXTOS_DO_GRAFO, msg('pt-BR').grafo, 'grafo');
  // O campo do `grafo indexar` ocupa 13 colunas antes do valor, como na base.
  assert.equal(msg('pt-BR').grafo.indexar.campo('revisao', 'x'), '  revisao      x');
  assert.equal(msg('pt-BR').grafo.indexar.campo('conferencia', 'x'), '  conferencia  x');
});

test('F3d (GO-FIX 1): ork grafo recusa o uso no locale do comando, pela redacao que a borda passa', () => {
  const c = cenario('grafo-uso');
  try {
    const en = ork(c, EN, false, 'grafo'), pt = ork(c, PT, false, 'grafo');
    assert.notEqual(en.status, 0);
    assert.match(en.stderr, /^error: grafo\.uso: missing subcommand\nusage: ork grafo indexar /);
    assert.match(pt.stderr, /^erro: grafo\.uso: falta o subcomando\nuso: ork grafo indexar /);
    // Com --json, o erro de uso sai como objeto, igual nas duas linguas.
    const json = ork(c, EN, false, 'grafo', '--json');
    assert.equal(json.stdout, ork(c, PT, false, 'grafo', '--json').stdout);
    assert.match(json.stdout, /"detalhe": "subcomando desconhecido: --json/);
  } finally { c.limpar(); }
});
