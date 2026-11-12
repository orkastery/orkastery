/**
 * RM-090 F1: mapeamento puro do ledger para OTLP/HTTP JSON.
 *
 * O módulo conhece somente uma allowlist. Não serializa o evento cru e recebe UID, pseudônimo,
 * relógio e redator por injeção, para que testes herméticos não dependam de rede, disco ou relógio.
 */
import type { EventoLedger } from './types';
import type { MotivoRetentavelDoPrompt, ResultadoDoPrompt } from './telemetria-prompt';
import { CONTRATO_SDLC_ANALYTICS } from './telemetria-maturidade-registro';

export const NOME_DO_SCOPE_OTLP = 'orkastery.telemetria' as const;
export const VERSAO_SEMCONV_GENAI = '1.37.0' as const;

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } }
  | { bytesValue: string };

export interface OtlpKeyValue { key: string; value: OtlpAnyValue }

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: 9 | 13 | 17;
  severityText: 'INFO' | 'WARN' | 'ERROR';
  body: OtlpAnyValue;
  attributes: OtlpKeyValue[];
  eventName: string;
}

export interface ExportLogsServiceRequest {
  resourceLogs: Array<{
    resource: { attributes: OtlpKeyValue[] };
    scopeLogs: Array<{
      scope: { name: string; version: string; attributes: OtlpKeyValue[] };
      logRecords: OtlpLogRecord[];
    }>;
  }>;
}

export interface ResultadoDaRedacao {
  ok: boolean;
  texto?: string;
  erro?: string;
}

export type RedatorDaTelemetria = (texto: string) => ResultadoDaRedacao;

export interface ContextoDoMapeamento {
  serviceVersion: string;
  instrumentacaoVersion: string;
  pseudonimo: string;
  /** Valor atribuído pela política; nunca é lido do payload do evento. */
  serviceNamespace?: string;
  redigir: RedatorDaTelemetria;
  observadoEmNano: () => bigint;
  prepararPrompt?: (evento: EventoLedger) => ResultadoDoPrompt;
}

export interface MetadadosDoLedger {
  uid?: string;
  sequencia?: number;
}

export interface EventoMapeado {
  registro: OtlpLogRecord | null;
  motivoDaExclusao?: string;
  bloqueioRetentavel?: MotivoRetentavelDoPrompt;
}

const EVENTOS_SEM_LOG = new Set(['heartbeat', 'ledger_corrupted']);
const CAMPOS_LIVRES = ['decisao', 'decidido', 'porque', 'razao', 'alegacao', 'pergunta', 'resposta', 'detalhe',
  'justificativa', 'mensagem', 'errorMessage'] as const;
const EVENTOS_COM_USUARIO = new Set(['autonomous_decision', 'hitl_requested', 'human_gate', 'session_answered']);
const EVENTOS_ANALITICOS = new Set(['verify_run', 'go_fix_opened', 'check_reverify', 'ship_done',
  'thread_created', 'ship_unscanned_authorized', 'autonomous_decision', 'hitl_requested']);
const EVENTOS_CICD = new Set(['verify_run', 'check_reverify']);
const EVENTOS_VCS = new Set(['thread_created', 'commit', 'mcp_git_committed', 'ship_done']);

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function inteiro(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function attrString(chave: string, valor: unknown): OtlpKeyValue | null {
  const v = texto(valor);
  return v === null ? null : { key: chave, value: { stringValue: v } };
}

function attrInt(chave: string, valor: unknown): OtlpKeyValue | null {
  const v = inteiro(valor);
  return v === null ? null : { key: chave, value: { intValue: String(v) } };
}

function attrBool(chave: string, valor: unknown): OtlpKeyValue | null {
  return typeof valor === 'boolean' ? { key: chave, value: { boolValue: valor } } : null;
}

function attrStrings(chave: string, valor: unknown): OtlpKeyValue | null {
  if (!Array.isArray(valor)) return null;
  const values = valor.map((item) => typeof item === 'string' ? item : texto(idObjeto(item)))
    .filter((item): item is string => Boolean(item)).map((item) => ({ stringValue: item }));
  return values.length ? { key: chave, value: { arrayValue: { values } } } : null;
}

function idObjeto(valor: unknown): unknown {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>).id : undefined;
}

function primeiro(evento: EventoLedger, ...campos: string[]): unknown {
  for (const campo of campos) if (evento[campo] !== undefined) return evento[campo];
  return undefined;
}

function idAninhado(evento: EventoLedger, campo: string, subcampo: string): unknown {
  const v = evento[campo];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[subcampo] : undefined;
}

function nanos(ts: string): string | null {
  const millis = Date.parse(ts);
  return Number.isFinite(millis) ? (BigInt(millis) * 1_000_000n).toString() : null;
}

function severidade(evento: EventoLedger): Pick<OtlpLogRecord, 'severityNumber' | 'severityText'> {
  const estado = [evento.resultado, evento.estado, evento.classificacao, evento.motivo, evento.tipo]
    .map((v) => typeof v === 'string' ? v.toLowerCase() : '').join(' ');
  if (/failed|falhou|erro|error|reprov|recusad/.test(estado)) return { severityNumber: 17, severityText: 'ERROR' };
  if (/blocked|bloquead|warn|partial|pendente/.test(estado)) return { severityNumber: 13, severityText: 'WARN' };
  return { severityNumber: 9, severityText: 'INFO' };
}

function eventName(tipo: string): string {
  return `orkastery.ledger.${tipo.replace(/[^a-z0-9_.-]/gi, '_').toLowerCase()}`;
}

function corpoSeguro(evento: EventoLedger, redigir: RedatorDaTelemetria): ResultadoDaRedacao {
  for (const campo of CAMPOS_LIVRES) {
    const valor = texto(evento[campo]);
    if (valor !== null) return redigir(valor);
  }
  return { ok: true, texto: evento.tipo };
}

function adicionar(lista: OtlpKeyValue[], valor: OtlpKeyValue | null): void {
  if (valor !== null && !lista.some((a) => a.key === valor.key)) lista.push(valor);
}

function attrsVcs(evento: EventoLedger, attrs: OtlpKeyValue[]): void {
  if (!EVENTOS_VCS.has(evento.tipo)) return;
  adicionar(attrs, attrString('vcs.ref.head.revision', primeiro(evento, 'mergeSha', 'sha', 'head', 'commit', 'sourceSha')));
  adicionar(attrs, attrString('vcs.ref.head.name', primeiro(evento, 'branch', 'ref', 'para', 'destinationBranch')));
  if (attrs.some((a) => a.key === 'vcs.ref.head.name')) adicionar(attrs, attrString('vcs.ref.type', 'branch'));
}

function attrsCicd(evento: EventoLedger, attrs: OtlpKeyValue[]): void {
  const fase = texto(evento.fase)?.toUpperCase();
  if (!EVENTOS_CICD.has(evento.tipo) && !(evento.tipo === 'phase_result' && fase === 'CHECK')) return;
  adicionar(attrs, attrString('cicd.pipeline.name', fase === 'CHECK' ? 'orkastery.check' : 'orkastery.verify'));
  adicionar(attrs, attrString('cicd.pipeline.run.id', primeiro(evento, 'roundId', 'rodadaId')));
  adicionar(attrs, attrString('cicd.pipeline.result', primeiro(evento, 'resultado', 'classificacao', 'estado')));
  adicionar(attrs, attrString('orkastery.check.mode', primeiro(evento, 'checkMode', 'modoCheck')));
}

function attrsGenAi(evento: EventoLedger, attrs: OtlpKeyValue[]): void {
  if (evento.tipo !== 'phase_dispatch') return;
  adicionar(attrs, attrString('gen_ai.operation.name', 'invoke_agent'));
  adicionar(attrs, attrString('gen_ai.request.model', evento.model));
  const sessao = primeiro(evento, 'sessionId', 'sessao');
  if (evento.runtime === 'codex') adicionar(attrs, attrString('conversation.id', sessao));
  else if (evento.runtime === 'claude-bg') adicionar(attrs, attrString('session.id', sessao));
}

function attrsAnaliticos(evento: EventoLedger, attrs: OtlpKeyValue[]): void {
  if (!EVENTOS_ANALITICOS.has(evento.tipo)) return;
  const recibo = evento.recibo && typeof evento.recibo === 'object' && !Array.isArray(evento.recibo)
    ? evento.recibo as Record<string, unknown> : {};
  const evidencia = evento.evidencia && typeof evento.evidencia === 'object' && !Array.isArray(evento.evidencia)
    ? evento.evidencia as Record<string, unknown> : {};
  const parecer = evento.parecer && typeof evento.parecer === 'object' && !Array.isArray(evento.parecer)
    ? evento.parecer as Record<string, unknown> : {};
  adicionar(attrs, attrString('orkastery.receipt.contract', recibo.contrato ?? recibo.schema));
  adicionar(attrs, attrString('orkastery.receipt.verdict', primeiro(evento, 'veredito', 'resultado') ?? recibo.veredito));
  adicionar(attrs, attrBool('orkastery.receipt.partial', evento.parcial ?? recibo.parcial));
  adicionar(attrs, attrString('orkastery.receipt.head', primeiro(evento, 'head', 'sha') ?? recibo.head ?? recibo.commit));
  adicionar(attrs, attrString('orkastery.receipt.policy.version',
    primeiro(evento, 'receiptPolicyVersion', 'politicaReciboVersao')));
  adicionar(attrs, attrBool('orkastery.push.verified', evento.pushVerificado ?? evidencia.pushVerificado));
  adicionar(attrs, attrString('orkastery.go_fix.round', primeiro(evento, 'rodada', 'roundId', 'rodadaId')));
  adicionar(attrs, attrStrings('orkastery.finding.id', evento.achadoIds ?? parecer.achados));
  adicionar(attrs, attrString('orkastery.decision.reverts', evento.reverte));
  adicionar(attrs, attrString('orkastery.policy.name', primeiro(evento, 'politica', 'policy')));
  adicionar(attrs, attrString('orkastery.policy.reason', primeiro(evento, 'motivo', 'reason')));
  adicionar(attrs, attrString('orkastery.policy.writer', primeiro(evento, 'writer', 'escritor')));
}

export function entradaGenAi(textoDoPrompt: string): OtlpAnyValue {
  return { arrayValue: { values: [{ kvlistValue: { values: [
    { key: 'role', value: { stringValue: 'user' } },
    { key: 'parts', value: { arrayValue: { values: [{ kvlistValue: { values: [
      { key: 'type', value: { stringValue: 'text' } },
      { key: 'content', value: { stringValue: textoDoPrompt } },
    ] } }] } } },
  ] } }] } };
}

/** Converte um evento sem nunca copiar o objeto de origem. */
export function mapearEventoDoLedger(evento: EventoLedger, contexto: ContextoDoMapeamento,
  meta: MetadadosDoLedger = {}): EventoMapeado {
  if (EVENTOS_SEM_LOG.has(evento.tipo) || (evento.tipo === 'runtime_event' && evento.event === 'heartbeat')) {
    return { registro: null, motivoDaExclusao: 'evento interno' };
  }
  const uid = texto(evento.eventId) ?? texto(meta.uid);
  if (uid === null) return { registro: null, motivoDaExclusao: 'uid ausente' };
  const timeUnixNano = nanos(evento.ts);
  if (timeUnixNano === null) return { registro: null, motivoDaExclusao: 'horário inválido' };
  let prompt: ResultadoDoPrompt | null = null;
  if (evento.tipo === 'phase_prompt_recorded' && contexto.prepararPrompt) {
    try { prompt = contexto.prepararPrompt(evento); }
    catch { prompt = { estado: 'bloqueio', motivo: 'prompt_io_transient' }; }
    if (prompt.estado === 'bloqueio') {
      return { registro: null, motivoDaExclusao: prompt.motivo, bloqueioRetentavel: prompt.motivo };
    }
  }
  const corpo = corpoSeguro(evento, contexto.redigir);
  if (!corpo.ok || typeof corpo.texto !== 'string') {
    throw new Error('telemetria.privacidade: campo livre recusado pelo redator');
  }

  const attrs: OtlpKeyValue[] = [];
  adicionar(attrs, attrString('log.record.uid', uid));
  if (EVENTOS_COM_USUARIO.has(evento.tipo) || EVENTOS_ANALITICOS.has(evento.tipo) || evento.tipo === 'phase_dispatch') {
    adicionar(attrs, attrString('user.hash', contexto.pseudonimo));
  }
  attrsVcs(evento, attrs);
  attrsCicd(evento, attrs);
  attrsGenAi(evento, attrs);
  attrsAnaliticos(evento, attrs);
  if (!texto(contexto.serviceNamespace)) {
    adicionar(attrs, attrString(CONTRATO_SDLC_ANALYTICS.atributos.teamSourceState,
      CONTRATO_SDLC_ANALYTICS.valores.teamSourceMissing));
  }
  if (evento.tipo !== 'phase_dispatch') adicionar(attrs, attrString('session.id', primeiro(evento, 'sessionId', 'sessao')));
  if (severidade(evento).severityNumber === 17) {
    const causa = texto(primeiro(evento, 'motivo', 'errorType', 'classificacao'));
    if (causa) {
      const redigida = contexto.redigir(causa);
      if (!redigida.ok || !redigida.texto) throw new Error('telemetria.privacidade: tipo de erro recusado');
      adicionar(attrs, attrString('error.type', redigida.texto));
    }
  }
  adicionar(attrs, attrString('orkastery.thread.id', evento.thread));
  adicionar(attrs, attrString('orkastery.phase.name', evento.fase));
  adicionar(attrs, attrString('orkastery.dispatch.id', primeiro(evento, 'dispatchId', 'despachoId') ?? idAninhado(evento, 'identidade', 'dispatchId')));
  adicionar(attrs, attrString('orkastery.mode', evento.modo));
  adicionar(attrs, attrString('orkastery.decision.id', primeiro(evento, 'decisionId', 'decisaoId') ?? idAninhado(evento, 'pedido', 'id')));
  adicionar(attrs, attrString('orkastery.claim.id', primeiro(evento, 'claimId', 'claim')));
  adicionar(attrs, attrInt('orkastery.ledger.sequence', meta.sequencia ?? evento.sequence));
  adicionar(attrs, attrString('orkastery.receipt.id', primeiro(evento, 'receiptId', 'reciboId', 'pedidoId')));
  adicionar(attrs, attrString('orkastery.runtime.name', evento.runtime));
  if (evento.tipo === 'phase_prompt_recorded') {
    adicionar(attrs, attrString('gen_ai.operation.name', 'invoke_agent'));
    adicionar(attrs, attrString('gen_ai.request.model', evento.model));
    if (prompt?.estado === 'conteudo') {
      adicionar(attrs, { key: 'gen_ai.input.messages', value: entradaGenAi(prompt.texto) });
      adicionar(attrs, attrString('orkastery.prompt.redaction.policy.version', prompt.versaoDaRemocao));
      adicionar(attrs, attrInt('orkastery.prompt.size.original', prompt.tamanhoOriginal));
      adicionar(attrs, attrInt('orkastery.prompt.size.exported', prompt.tamanhoExportado));
    } else if (prompt?.estado === 'lacuna') {
      adicionar(attrs, attrString('orkastery.prompt.content.state', 'gap'));
      adicionar(attrs, attrString('orkastery.prompt.gap.reason', prompt.motivo));
    } else {
      adicionar(attrs, attrInt('orkastery.prompt.size', primeiro(evento, 'promptBytes', 'tamanhoBytes')));
    }
  }
  const nivel = severidade(evento);
  return { registro: { timeUnixNano, observedTimeUnixNano: contexto.observadoEmNano().toString(), ...nivel,
    body: { stringValue: corpo.texto }, attributes: attrs,
    eventName: evento.tipo === 'phase_prompt_recorded' && prompt
      ? 'gen_ai.client.inference.operation.details' : eventName(evento.tipo) } };
}

export function montarExportLogsServiceRequest(registros: readonly OtlpLogRecord[],
  contexto: Pick<ContextoDoMapeamento, 'serviceVersion' | 'instrumentacaoVersion'>): ExportLogsServiceRequest {
  const atributosDoRecurso: OtlpKeyValue[] = [
    { key: 'service.name', value: { stringValue: 'orkastery' } },
    { key: 'service.version', value: { stringValue: contexto.serviceVersion } },
  ];
  if ('serviceNamespace' in contexto && texto((contexto as Pick<ContextoDoMapeamento, 'serviceNamespace'>).serviceNamespace)) {
    atributosDoRecurso.push({ key: CONTRATO_SDLC_ANALYTICS.atributos.serviceNamespace,
      value: { stringValue: (contexto as Pick<ContextoDoMapeamento, 'serviceNamespace'>).serviceNamespace! } });
  }
  return { resourceLogs: [{ resource: { attributes: atributosDoRecurso }, scopeLogs: [{
    scope: { name: NOME_DO_SCOPE_OTLP, version: contexto.instrumentacaoVersion,
    attributes: [] },
  logRecords: [...registros] }] }] };
}
