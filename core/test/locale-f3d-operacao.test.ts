import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chaveDoLocale, comLocale, cobreLocale, msg } from '../src/locale';
import { tabelaDeModos } from '../src/modos';
import { textoDaMigracaoModos } from '../src/modos-migracao';
import { tabelaDeVariantes } from '../src/ciclos';
import { linhasEmPortugues } from './locale-apoio';
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
});
