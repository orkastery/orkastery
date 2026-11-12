/**
 * RM-090 F5: contrato declarativo único das agregações de SDLC Analytics.
 *
 * O motor local e o renderizador do dashboard consomem este registro. Nomes públicos
 * de eventos e atributos vivem somente em CONTRATO_SDLC_ANALYTICS.
 */

export const CONTRATO_SDLC_ANALYTICS = {
  versao: 'ork.sdlc-analytics/v1',
  eventos: {
    deployment: 'orkastery.sdlc.deployment.v1',
    incident: 'orkastery.sdlc.incident.v1',
    resultado: 'orkastery.sdlc.analytics.result.v1',
  },
  atributos: {
    uid: 'log.record.uid',
    userHash: 'user.hash',
    serviceName: 'service.name',
    serviceNamespace: 'service.namespace',
    environment: 'deployment.environment.name',
    deploymentId: 'deployment.id',
    deploymentStatus: 'deployment.status',
    pipelineName: 'cicd.pipeline.name',
    pipelineRunId: 'cicd.pipeline.run.id',
    pipelineResult: 'cicd.pipeline.result',
    pipelineTaskType: 'cicd.pipeline.task.type',
    revision: 'vcs.ref.head.revision',
    threadId: 'orkastery.thread.id',
    incidentId: 'orkastery.incident.id',
    incidentState: 'orkastery.incident.state',
    incidentDeploymentId: 'orkastery.incident.deployment.id',
    incidentRecoveryDeploymentId: 'orkastery.incident.recovery.deployment.id',
  },
  atributosResultado: {
    indicadorId: 'orkastery.sdlc.analytics.indicator.id',
    indicadorVersao: 'orkastery.sdlc.analytics.indicator.version',
    formulaId: 'orkastery.sdlc.analytics.formula.id',
    formulaVersao: 'orkastery.sdlc.analytics.formula.version',
    formulaOperador: 'orkastery.sdlc.analytics.formula.operator',
    serieId: 'orkastery.sdlc.analytics.series.id',
    serieBucket: 'orkastery.sdlc.analytics.series.bucket',
    janelaInicio: 'orkastery.sdlc.analytics.window.start',
    janelaFim: 'orkastery.sdlc.analytics.window.end',
    numerador: 'orkastery.sdlc.analytics.result.numerator',
    denominador: 'orkastery.sdlc.analytics.result.denominator',
    coberturaConfirmados: 'orkastery.sdlc.analytics.result.coverage.confirmed',
    coberturaTotal: 'orkastery.sdlc.analytics.result.coverage.total',
    coberturaRazao: 'orkastery.sdlc.analytics.result.coverage.ratio',
    lacunas: 'orkastery.sdlc.analytics.result.gaps',
  },
  valores: {
    production: 'production',
    succeeded: 'succeeded',
    success: 'success',
    deploy: 'deploy',
    opened: 'opened',
    resolved: 'resolved',
    teamSourceMissing: 'team_source_missing',
    unconfirmed: 'não confirmado',
  },
} as const;

export type TipoDeAgregacao = 'razao' | 'contagem_distinta' | 'distribuicao';

export type AcumuladorDoIndicador = 'merge_receipt' | 'first_truth' | 'check_rework'
  | 'decisions_questions_reversals' | 'policy_exceptions' | 'mode_usage';

export type UnidadeDaExecucao = 'merge' | 'thread' | 'evento';

export type FormulaExecutavel =
  | { operador: 'razao'; acumulador: AcumuladorDoIndicador; positivo: string; negativo: string }
  | { operador: 'contagem_distinta'; acumulador: AcumuladorDoIndicador;
    series: ReadonlyArray<{ id: string; chave: string }> }
  | { operador: 'distribuicao'; acumulador: AcumuladorDoIndicador;
    series: ReadonlyArray<{ id: string; chave: string }> };

export interface DefinicaoDeIndicador {
  id: string;
  versao: 'v1';
  tipo: TipoDeAgregacao;
  populacao: string;
  fontes: readonly string[];
  deduplicacao: readonly string[];
  agrupamentos: readonly ('user.hash' | 'service.namespace' | 'orkastery.thread.id' | 'orkastery.phase.name')[];
  lacunas: readonly string[];
  cobertura: string;
  formula: FormulaExecutavel;
  execucao: {
    predicados: { eventos: readonly string[] };
    populacao: { unidade: UnidadeDaExecucao; chave: string };
    confirmacao: { unidade: UnidadeDaExecucao; chave: string };
    lacunas: readonly string[];
    agrupamentos: DefinicaoDeIndicador['agrupamentos'];
  };
}

type DefinicaoSemExecucao = Omit<DefinicaoDeIndicador, 'execucao'>;

function definirIndicador<T extends DefinicaoSemExecucao>(definicao: T,
  unidade: UnidadeDaExecucao, chave: string): T & Pick<DefinicaoDeIndicador, 'execucao'> {
  return { ...definicao, execucao: {
    predicados: { eventos: definicao.fontes },
    populacao: { unidade, chave },
    confirmacao: { unidade, chave },
    lacunas: definicao.lacunas,
    agrupamentos: definicao.agrupamentos,
  } };
}

export const REGISTRO_DE_INDICADORES_AGENTICOS = [
  definirIndicador({
    id: 'agent.merge_receipt_coverage', versao: 'v1', tipo: 'razao',
    populacao: 'ship_done único por merge na janela',
    fontes: ['ship_done', 'verify_run'], deduplicacao: ['eventId', 'mergeSha'],
    agrupamentos: ['user.hash', 'service.namespace'],
    lacunas: ['event_id_ausente', 'politica_historica_ausente', 'recibo_ausente', 'head_ausente',
      'merge_ausente', 'push_nao_provado'],
    cobertura: 'merges confirmados / merges na população',
    formula: { operador: 'razao', acumulador: 'merge_receipt', positivo: 'positivos', negativo: 'negativos' },
  }, 'merge', 'mergeSha'),
  definirIndicador({
    id: 'agent.first_truth_sustained', versao: 'v1', tipo: 'razao',
    populacao: 'threads únicas com ship_done na janela',
    fontes: ['verify_run', 'go_fix_opened', 'check_reverify', 'ship_done'],
    deduplicacao: ['eventId', 'orkastery.thread.id'], agrupamentos: ['user.hash', 'service.namespace'],
    lacunas: ['event_id_ausente', 'sequencia_incompleta', 'primeira_rodada_ausente', 'recibo_final_ausente'],
    cobertura: 'threads confirmadas / threads entregues',
    formula: { operador: 'razao', acumulador: 'first_truth', positivo: 'positivos', negativo: 'negativos' },
  }, 'thread', 'orkastery.thread.id'),
  definirIndicador({
    id: 'agent.check_rework', versao: 'v1', tipo: 'contagem_distinta',
    populacao: 'threads com CHECK terminal ou GO-FIX na janela',
    fontes: ['go_fix_opened', 'check_reverify'], deduplicacao: ['eventId', 'achado.id', 'thread+rodada'],
    agrupamentos: ['user.hash', 'service.namespace', 'orkastery.thread.id'],
    lacunas: ['event_id_ausente', 'achado_estruturado_ausente', 'rodada_ausente'],
    cobertura: 'threads com vínculo estruturado / população',
    formula: { operador: 'contagem_distinta', acumulador: 'check_rework', series: [
      { id: 'achados', chave: 'achados' }, { id: 'rodadas', chave: 'rodadas' },
    ] },
  }, 'thread', 'orkastery.thread.id'),
  definirIndicador({
    id: 'agent.decisions_questions_reversals', versao: 'v1', tipo: 'contagem_distinta',
    populacao: 'eventos únicos de decisão ou pergunta na janela',
    fontes: ['autonomous_decision', 'hitl_requested'], deduplicacao: ['eventId', 'decisionId', 'requestId'],
    agrupamentos: ['user.hash', 'service.namespace', 'orkastery.thread.id', 'orkastery.phase.name'],
    lacunas: ['event_id_ausente', 'id_ausente', 'rastro_ausente', 'alvo_tipado_ausente'],
    cobertura: 'eventos com ID, alvo e rastro / população',
    formula: { operador: 'contagem_distinta', acumulador: 'decisions_questions_reversals', series: [
      { id: 'decisoes', chave: 'decisoes' }, { id: 'perguntas', chave: 'perguntas' },
      { id: 'reversoes', chave: 'reversoes' },
    ] },
  }, 'evento', 'eventId'),
  definirIndicador({
    id: 'agent.policy_exceptions', versao: 'v1', tipo: 'contagem_distinta',
    populacao: 'exceções ou dispensas autorizadas na janela',
    fontes: ['ship_unscanned_authorized'], deduplicacao: ['eventId'],
    agrupamentos: ['user.hash', 'service.namespace', 'orkastery.thread.id'],
    lacunas: ['event_id_ausente', 'autorizador_ausente', 'categorias_ausentes', 'sha_ausente'],
    cobertura: 'exceções reconhecidas / população conhecida',
    formula: { operador: 'contagem_distinta', acumulador: 'policy_exceptions',
      series: [{ id: 'excecoes', chave: 'excecoes' }] },
  }, 'evento', 'eventId'),
  definirIndicador({
    id: 'agent.mode_usage', versao: 'v1', tipo: 'distribuicao',
    populacao: 'thread_created e ship_done na janela', fontes: ['thread_created', 'ship_done'],
    deduplicacao: ['eventId', 'orkastery.thread.id'], agrupamentos: ['service.namespace'],
    lacunas: ['event_id_ausente', 'modo_ausente', 'modo_invalido', 'thread_ausente'],
    cobertura: 'eventos com modo válido e vínculo / população de cada distribuição',
    formula: { operador: 'distribuicao', acumulador: 'mode_usage', series: [
      { id: 'threads_criadas', chave: 'threads_criadas' }, { id: 'merges', chave: 'merges' },
    ] },
  }, 'evento', 'eventId'),
] as const satisfies readonly DefinicaoDeIndicador[];

export function definicaoDoIndicador(id: string): DefinicaoDeIndicador | undefined {
  return REGISTRO_DE_INDICADORES_AGENTICOS.find((item) => item.id === id);
}
