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
});
