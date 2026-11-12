/** RM-090 F5: projeção determinística do registro executável para targets do Grafana. */
import { CONTRATO_SDLC_ANALYTICS, DefinicaoDeIndicador,
  REGISTRO_DE_INDICADORES_AGENTICOS } from './telemetria-maturidade-registro';

export interface TargetGrafana {
  refId: 'A';
  datasource: { type: 'loki'; uid: '${DS_LOKI}' };
  editorMode: 'code';
  expr: string;
  legendFormat: string;
  queryType: 'range';
}

const LABELS: Record<string, string> = {
  'user.hash': 'user_hash',
  'service.namespace': 'service_namespace',
  'orkastery.thread.id': 'orkastery_thread_id',
  'orkastery.phase.name': 'orkastery_phase_name',
};

function regexDosEventos(fontes: readonly string[]): string {
  return fontes.map((fonte) => `orkastery\\.ledger\\.${fonte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|');
}

/** A projeção consulta somente os fatos brutos emitidos; a fórmula exata continua no motor local. */
export function renderizarTarget(definicao: DefinicaoDeIndicador): TargetGrafana {
  const grupos = definicao.agrupamentos.map((grupo) => LABELS[grupo]);
  const filtros = grupos.filter((grupo) => grupo === 'user_hash' || grupo === 'service_namespace')
    .map((grupo) => ` | ${grupo}=~"\${${grupo}:regex}"`).join('');
  const by = ` by (${['event_name', ...grupos].join(', ')})`;
  const expr = `sum${by} (count_over_time({service_name="orkastery"} | json`
    + ` | event_name=~"${regexDosEventos(definicao.fontes)}"`
    + `${filtros} [$__interval]))`;
  return { refId: 'A', datasource: { type: 'loki', uid: '${DS_LOKI}' }, editorMode: 'code', expr,
    legendFormat: `${definicao.id} · {{event_name}} · {{${grupos.join('}} · {{')}}}`, queryType: 'range' };
}

export function renderizarTargetsAgenticos(): Record<string, TargetGrafana[]> {
  return Object.fromEntries(REGISTRO_DE_INDICADORES_AGENTICOS.map((definicao) =>
    [definicao.id, [renderizarTarget(definicao)]]));
}

export const MEDIDAS_DORA = ['deployment_frequency', 'change_lead_time', 'change_fail_rate',
  'failed_deployment_recovery_time', 'deployment_rework_rate'] as const;

function eventosDaMedida(medida: typeof MEDIDAS_DORA[number]): string[] {
  if (medida === 'deployment_frequency' || medida === 'change_lead_time') {
    return [CONTRATO_SDLC_ANALYTICS.eventos.deployment];
  }
  if (medida === 'failed_deployment_recovery_time') return [CONTRATO_SDLC_ANALYTICS.eventos.incident];
  return [CONTRATO_SDLC_ANALYTICS.eventos.deployment, CONTRATO_SDLC_ANALYTICS.eventos.incident];
}

export function renderizarTargetDora(medida: typeof MEDIDAS_DORA[number]): TargetGrafana {
  const eventos = eventosDaMedida(medida).join('|').replace(/\./g, '\\.');
  return { refId: 'A', datasource: { type: 'loki', uid: '${DS_LOKI}' }, editorMode: 'code',
    expr: `sum by (event_name, service_name, service_namespace) (count_over_time({service_name!=""} | json`
      + ` | event_name=~"${eventos}"`
      + ' | service_namespace=~"${service_namespace:regex}" [$__interval]))',
    legendFormat: `${medida} · {{event_name}} · {{service_name}} · {{service_namespace}}`, queryType: 'range' };
}
