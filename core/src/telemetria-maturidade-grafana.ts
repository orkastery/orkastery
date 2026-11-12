/** RM-090 F5: projeção determinística do registro executável para targets do Grafana. */
import { CONTRATO_SDLC_ANALYTICS, DefinicaoDeIndicador,
  REGISTRO_DE_INDICADORES_AGENTICOS } from './telemetria-maturidade-registro';

export interface TargetGrafana {
  refId: string;
  datasource: { type: 'loki'; uid: '${DS_LOKI}' };
  editorMode: 'code';
  expr: string;
  legendFormat: string;
  queryType: 'range';
}

const A = CONTRATO_SDLC_ANALYTICS.atributosResultado;

function label(atributo: string): string { return atributo.replaceAll('.', '_'); }

const CAMPOS_DO_RESULTADO = [
  ['A', 'numerador', A.numerador],
  ['B', 'denominador', A.denominador],
  ['C', 'cobertura_confirmados', A.coberturaConfirmados],
  ['D', 'cobertura_total', A.coberturaTotal],
  ['E', 'lacunas', A.lacunas],
] as const;

/** Soma somente campos do resultado calculado; a consulta não reimplementa a fórmula. */
export function renderizarTarget(definicao: DefinicaoDeIndicador, refId = 'A',
  nome = 'numerador', atributo: string = A.numerador): TargetGrafana {
  const eventName = CONTRATO_SDLC_ANALYTICS.propostas.eventoResultado.recomendado.replaceAll('.', '\\.');
  const indicador = label(A.indicadorId), serie = label(A.serieId), bucket = label(A.serieBucket);
  const grupos = ['user_hash', 'service_namespace', indicador, serie, bucket];
  const expr = `sum by (${grupos.join(', ')}) (sum_over_time({service_name="orkastery"} | json`
    + ` | event_name="${eventName}" | ${indicador}="${definicao.id}"`
    + ' | user_hash=~"${user_hash:regex}" | service_namespace=~"${service_namespace:regex}"'
    + ` | unwrap ${label(atributo)} [$__interval]))`;
  return { refId, datasource: { type: 'loki', uid: '${DS_LOKI}' }, editorMode: 'code', expr,
    legendFormat: `${definicao.id} · ${nome} · {{user_hash}} · {{service_namespace}} · {{${serie}}} · {{${bucket}}}`,
    queryType: 'range' };
}

export function renderizarTargetsAgenticos(): Record<string, TargetGrafana[]> {
  return Object.fromEntries(REGISTRO_DE_INDICADORES_AGENTICOS.map((definicao) =>
    [definicao.id, CAMPOS_DO_RESULTADO.map(([refId, nome, atributo]) =>
      renderizarTarget(definicao, refId, nome, atributo))]));
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
