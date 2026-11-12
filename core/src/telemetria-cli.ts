/** RM-090 F1: comandos manuais de adesão, inspeção e envio da telemetria. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { lerListaLocal, redigirDadoPrivado } from './dado-privado';
import { raizDoEstado } from './estado-thread';
import { msg } from './locale';
import { caminhoLedger } from './ledger';
import { redigirSegredos } from './policies';
import { ativacaoTelemetria, gravarAtivacaoTelemetria, ResolucaoTelemetria } from './telemetria-config';
import { exportarLedger, resolverDestinoOtlp, ResultadoDaExportacao, sanitizarEndpoint } from './telemetria-exportador';
import { ContextoDoMapeamento } from './telemetria';
import { prepararPrompt } from './telemetria-prompt';
import { dirThread, listarIds } from './thread';
import { VERSAO_DO_ORK } from './versao';
import { comandoMaturidade } from './telemetria-maturidade-cli';

export const CONTRATO_CLI_TELEMETRIA = 'ork.telemetria-cli/v1' as const;
export type SubcomandoTelemetria = 'status' | 'ligar' | 'desligar' | 'enviar' | 'maturidade';

export interface FonteDaTelemetria {
  thread: string;
  ledger: string;
  cursor: string;
  lock: string;
}

export interface EstadoDaFonte {
  thread: string;
  pendingBytes: number;
  lastConfirmedUid: string | null;
  terminal: boolean;
}

export interface DependenciasTelemetriaCli {
  resolverAtivacao(env: NodeJS.ProcessEnv): ResolucaoTelemetria;
  gravarAtivacao(enabled: boolean, env: NodeJS.ProcessEnv): unknown;
  fontes(raiz: string): FonteDaTelemetria[];
  estado(fonte: FonteDaTelemetria): EstadoDaFonte;
  exportar: typeof exportarLedger;
  contexto(raiz: string, pseudonimo: string, env: NodeJS.ProcessEnv): ContextoDoMapeamento;
  destino(env: NodeJS.ProcessEnv): string | null;
}

function fontesPadrao(raiz: string): FonteDaTelemetria[] {
  const base = path.join(raizDoEstado(raiz), '.orkastery', 'private', 'telemetria');
  return listarIds(raiz).map((thread) => ({
    thread,
    ledger: caminhoLedger(dirThread(raiz, thread)),
    cursor: path.join(base, `${thread}.cursor.json`),
    lock: path.join(base, `${thread}.lock`),
  })).filter((fonte) => fs.existsSync(fonte.ledger));
}

function estadoPadrao(fonte: FonteDaTelemetria): EstadoDaFonte {
  const tamanho = fs.statSync(fonte.ledger).size;
  let offset = 0, lastConfirmedUid: string | null = null, terminal = false;
  try {
    const cursor = JSON.parse(fs.readFileSync(fonte.cursor, 'utf8')) as Record<string, unknown>;
    if (Number.isSafeInteger(cursor.proximoOffset) && Number(cursor.proximoOffset) >= 0) offset = Number(cursor.proximoOffset);
    if (typeof cursor.ultimoUidConfirmado === 'string') lastConfirmedUid = cursor.ultimoUidConfirmado;
    terminal = cursor.terminal !== null && cursor.terminal !== undefined;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('telemetria.status: cursor inválido');
  }
  return { thread: fonte.thread, pendingBytes: Math.max(0, tamanho - offset), lastConfirmedUid, terminal };
}

export function contextoPadrao(raiz: string, pseudonimo: string, env: NodeJS.ProcessEnv): ContextoDoMapeamento {
  const estado = raizDoEstado(raiz), lista = lerListaLocal(estado, raiz, env);
  return {
    serviceVersion: VERSAO_DO_ORK,
    instrumentacaoVersion: VERSAO_DO_ORK,
    pseudonimo,
    ...(typeof env.OTEL_SERVICE_NAMESPACE === 'string' && env.OTEL_SERVICE_NAMESPACE.trim()
      ? { serviceNamespace: env.OTEL_SERVICE_NAMESPACE.trim() } : {}),
    redigir(entrada) {
      const semSegredo = redigirSegredos(entrada);
      const privado = redigirDadoPrivado(semSegredo.texto, lista);
      return privado.ok ? { ok: true, texto: privado.texto } : { ok: false, erro: privado.erro };
    },
    // Carimbo de máquina exigido pelo protocolo; não é horário apresentado à pessoa.
    observadoEmNano: () => BigInt(Date.now()) * 1_000_000n,
    prepararPrompt(evento) {
      return prepararPrompt({ raizProjeto: raiz, raizPrompts: path.join(dirThread(raiz, evento.thread), 'prompts'),
        promptPath: evento.promptPath, promptSha256: evento.promptSha256,
        redigirPrivado(entrada) {
          const resultado = redigirDadoPrivado(entrada, lista);
          return resultado.ok ? { ok: true, texto: resultado.texto } : { ok: false, erro: resultado.erro };
        } });
    },
  };
}

const DEPENDENCIAS_PADRAO: DependenciasTelemetriaCli = {
  resolverAtivacao: ativacaoTelemetria,
  gravarAtivacao: gravarAtivacaoTelemetria,
  fontes: fontesPadrao,
  estado: estadoPadrao,
  exportar: exportarLedger,
  contexto: contextoPadrao,
  destino(env) {
    try { return sanitizarEndpoint(resolverDestinoOtlp(env).endpoint); }
    catch { return null; }
  },
};

export interface EntradaTelemetriaCli {
  raiz: string;
  subcomando?: string;
  json?: boolean;
  dryRun?: boolean;
  offset?: number;
  desde?: string;
  ate?: string;
  env?: NodeJS.ProcessEnv;
  escrever?: (texto: string) => void;
  dependencias?: Partial<DependenciasTelemetriaCli>;
}

export interface ResultadoTelemetriaCli {
  codigo: number;
  resposta: Record<string, unknown>;
}

function imprimir(resposta: Record<string, unknown>, entrada: EntradaTelemetriaCli,
  linhas: readonly string[]): void {
  const escrever = entrada.escrever ?? ((texto: string) => console.log(texto));
  if (entrada.json) escrever(JSON.stringify(resposta, null, 2));
  else for (const linha of linhas) escrever(linha);
}

function habilitada(ativacao: ResolucaoTelemetria): boolean {
  return ativacao.ligada && typeof ativacao.pseudonimo === 'string' && ativacao.pseudonimo.length > 0;
}

export async function comandoTelemetria(entrada: EntradaTelemetriaCli): Promise<ResultadoTelemetriaCli> {
  const sub = entrada.subcomando as SubcomandoTelemetria | undefined;
  if (!sub || !['status', 'ligar', 'desligar', 'enviar', 'maturidade'].includes(sub) ||
      (entrada.dryRun === true && sub !== 'enviar') ||
      (entrada.offset !== undefined && (sub !== 'enviar' || entrada.dryRun !== true ||
        !Number.isSafeInteger(entrada.offset) || entrada.offset < 0))) throw new Error(msg().telemetria.uso);
  if (sub === 'maturidade') return comandoMaturidade({ raiz: entrada.raiz, desde: entrada.desde,
    ate: entrada.ate, json: entrada.json, escrever: entrada.escrever });
  const env = entrada.env ?? process.env;
  const d = { ...DEPENDENCIAS_PADRAO, ...entrada.dependencias } as DependenciasTelemetriaCli;

  if (sub === 'ligar' || sub === 'desligar') {
    const enabled = sub === 'ligar';
    d.gravarAtivacao(enabled, env);
    const resposta = { schema: CONTRATO_CLI_TELEMETRIA, command: sub, enabled, source: 'builder' };
    imprimir(resposta, entrada, [msg().telemetria.alterada(enabled)]);
    return { codigo: 0, resposta };
  }

  const ativacao = d.resolverAtivacao(env);
  if (!habilitada(ativacao)) {
    const resposta = { schema: CONTRATO_CLI_TELEMETRIA, command: sub, enabled: false,
      source: ativacao.origem, reason: ativacao.motivo, destination: null, threads: [] };
    imprimir(resposta, entrada, sub === 'status'
      ? [msg().telemetria.status(false, ativacao.origem, ativacao.motivo)]
      : [msg().telemetria.envioDesligado]);
    return { codigo: 0, resposta };
  }

  const fontes = d.fontes(entrada.raiz);
  if (sub === 'status') {
    const threads = fontes.map(d.estado);
    const destination = d.destino(env);
    const resposta = { schema: CONTRATO_CLI_TELEMETRIA, command: sub, enabled: true,
      source: ativacao.origem, reason: ativacao.motivo, destination, threads };
    imprimir(resposta, entrada, [msg().telemetria.status(true, ativacao.origem, ativacao.motivo),
      msg().telemetria.destino(destination),
      msg().telemetria.pendencias(threads.filter((t) => t.pendingBytes > 0).length,
        threads.reduce((total, t) => total + t.pendingBytes, 0))]);
    return { codigo: 0, resposta };
  }

  const contexto = d.contexto(entrada.raiz, ativacao.pseudonimo!, env);
  const resultados: Array<{ thread: string; result: ResultadoDaExportacao }> = [];
  for (const fonte of fontes) {
    const result = await d.exportar({ arquivoLedger: fonte.ledger, arquivoCursor: fonte.cursor,
      arquivoLock: fonte.lock, thread: fonte.thread, contexto, env, dryRun: entrada.dryRun === true,
      ...(entrada.offset !== undefined ? { dryRunOffset: entrada.offset } : {}) });
    resultados.push({ thread: fonte.thread, result });
  }
  const serializados = resultados.map(({ thread, result }) => ({ thread, state: result.estado,
    records: result.registros, ...(result.bloqueio ? { block: result.bloqueio } : {}),
    ...(result.rejeicao ? { rejection: result.rejeicao } : {}),
    ...(entrada.dryRun === true ? { payload: result.payload } : {}) }));
  const resposta = { schema: CONTRATO_CLI_TELEMETRIA, command: sub, enabled: true,
    source: ativacao.origem, dryRun: entrada.dryRun === true, results: serializados };
  const linhas = resultados.flatMap(({ thread, result }) => [msg().telemetria.resultado(thread, result.estado, result.registros),
    ...(result.bloqueio ? [msg().telemetria.bloqueio(thread, result.bloqueio.motivo)] : []),
    ...(entrada.dryRun === true && result.payload
      ? [msg().telemetria.payload(thread), JSON.stringify(result.payload, null, 2)] : [])]);
  imprimir(resposta, entrada, linhas);
  const verdes = new Set(['vazio', 'dry-run', 'enviado']);
  return { codigo: resultados.every(({ result }) => verdes.has(result.estado)) ? 0 : 1, resposta };
}
