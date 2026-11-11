/** RM-090 F3: configuração OTEL efêmera, restrita a um despacho nativo. */
import type { ResolucaoTelemetria } from './telemetria-config';
import type { DestinoOtlp } from './telemetria-exportador';

export interface ContextoTelemetriaRuntime {
  thread: string;
  fase: string;
  dispatchId: string;
  pseudonimo: string;
}

export interface TelemetriaClaudeDoDespacho {
  runtime: 'claude-bg';
  settingsEnv: Record<string, string>;
}

export interface TelemetriaCodexDoDespacho {
  runtime: 'codex';
  argumentos: string[];
  ambiente: Record<string, string>;
}

export type TelemetriaDoDespacho = TelemetriaClaudeDoDespacho | TelemetriaCodexDoDespacho;

function endpointSeguro(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

function atributosDoRecurso(contexto: ContextoTelemetriaRuntime): string {
  return Object.entries({
    'orkastery.thread.id': contexto.thread,
    'orkastery.phase.name': contexto.fase,
    'orkastery.dispatch.id': contexto.dispatchId,
    'user.hash': contexto.pseudonimo,
  }).map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`).join(',');
}

function ambienteDosHeaders(headers: Readonly<Record<string, string>>): {
  ambiente: Record<string, string>;
  referencias: Record<string, string>;
} {
  const ambiente: Record<string, string> = {}, referencias: Record<string, string> = {};
  Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)).forEach(([chave, valor], indice) => {
    const nome = `ORK_TELEMETRIA_OTLP_HEADER_${indice}`;
    ambiente[nome] = valor;
    referencias[chave] = `\${${nome}}`;
  });
  return { ambiente, referencias };
}

function tabelaToml(valor: Readonly<Record<string, string>>): string {
  return `{ ${Object.entries(valor).map(([chave, conteudo]) =>
    `${JSON.stringify(chave)} = ${JSON.stringify(conteudo)}`).join(', ')} }`;
}

/**
 * Preparação pura: ausência/desligamento/configuração insegura não decora o despacho.
 * Valores de cabeçalho nunca entram nos argumentos do Codex.
 */
export function prepararTelemetriaDoRuntime(runtime: string, contexto: Omit<ContextoTelemetriaRuntime, 'pseudonimo'>,
  ativacao: ResolucaoTelemetria, destino: DestinoOtlp | null): TelemetriaDoDespacho | undefined {
  if (!ativacao.ligada || !ativacao.pseudonimo || !destino || !['claude-bg', 'codex'].includes(runtime)) return undefined;
  const endpoint = endpointSeguro(destino.endpoint);
  if (!endpoint) return undefined;
  const completo: ContextoTelemetriaRuntime = { ...contexto, pseudonimo: ativacao.pseudonimo };
  if (runtime === 'claude-bg') {
    const headers = Object.entries(destino.headers).sort(([a], [b]) => a.localeCompare(b))
      .map(([chave, valor]) => `${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`).join(',');
    return { runtime, settingsEnv: {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_TRACES_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: endpoint,
      ...(headers ? { OTEL_EXPORTER_OTLP_LOGS_HEADERS: headers } : {}),
      OTEL_RESOURCE_ATTRIBUTES: atributosDoRecurso(completo),
      OTEL_LOG_USER_PROMPTS: '0',
      OTEL_LOG_ASSISTANT_RESPONSES: '0',
      OTEL_LOG_TOOL_DETAILS: '0',
      OTEL_LOG_TOOL_CONTENT: '0',
    } };
  }
  const headers = ambienteDosHeaders(destino.headers);
  const exporter = `{ "otlp-http" = { endpoint = ${JSON.stringify(endpoint)}, protocol = "binary", headers = ${tabelaToml(headers.referencias)} } }`;
  return { runtime: 'codex', ambiente: headers.ambiente, argumentos: [
    '-c', `otel.exporter=${exporter}`,
    '-c', 'otel.log_user_prompt=false',
    '-c', 'otel.log_agent_responses=false',
    '-c', 'otel.log_guardian_assessments=false',
    '-c', 'otel.tool_result.max_bytes=0',
    '-c', 'otel.metrics_exporter="none"',
    '-c', 'otel.trace_exporter="none"',
  ] };
}
