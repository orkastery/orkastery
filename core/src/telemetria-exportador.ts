/** RM-090 F1: leitura incremental, cursor durável e transporte OTLP/HTTP. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { EventoLedger } from './types';
import { ContextoDoMapeamento, ExportLogsServiceRequest, mapearEventoDoLedger,
  montarExportLogsServiceRequest, OtlpLogRecord, entradaGenAi, OtlpKeyValue } from './telemetria';
import { MotivoRetentavelDoPrompt } from './telemetria-prompt';
import { redigirRepresentacoesDeSegredo } from './policies';

export const CONTRATO_CURSOR_TELEMETRIA = 'ork.telemetria-cursor/v1' as const;
export const CONTRATO_REJEICAO_TELEMETRIA = 'ork.telemetria-rejeicao/v1' as const;
export const MAXIMO_DE_REGISTROS = 512;
export const MAXIMO_DE_LEITURA = 4 * 1024 * 1024;
export const MAXIMO_DA_REQUISICAO = 1024 * 1024;
export const MAXIMO_DA_RESPOSTA = 64 * 1024;
export const TIMEOUT_PADRAO_MS = 10_000;
export const VALIDADE_DO_LOCK_MS = 120_000;
export const BACKOFF_INICIAL_MS = 100;

export interface IdentidadeDoLedger { dev: string; ino: string; tamanho: number }

export interface RejeicaoTerminal {
  contrato: typeof CONTRATO_REJEICAO_TELEMETRIA;
  tipo: 'parcial' | 'nao-retentavel' | 'protocolo';
  status: number | null;
  rejectedLogRecords?: string;
  mensagem?: string;
}

export interface CursorTelemetria {
  contrato: typeof CONTRATO_CURSOR_TELEMETRIA;
  ledger: Pick<IdentidadeDoLedger, 'dev' | 'ino'>;
  proximoOffset: number;
  proximaSequencia: number;
  ultimoUidConfirmado: string | null;
  terminal: RejeicaoTerminal | null;
}

export interface DonoDoLock { pid: number; token: string; expiraEm: number }

export interface ArquivosTelemetria {
  identidade(arquivo: string): IdentidadeDoLedger;
  ler(arquivo: string, offset: number, tamanho: number): Buffer;
  lerJson(arquivo: string): unknown | null;
  escreverJsonAtomico(arquivo: string, valor: unknown): void;
  adquirirLock(arquivo: string, dono: DonoDoLock, agoraMs: number): boolean;
  liberarLock(arquivo: string, token: string): void;
}

function fsyncPasta(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function processoVivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Implementação real; testes podem injetar a mesma interface sem rede nem estado global. */
export const arquivosDoNode: ArquivosTelemetria = {
  identidade(arquivo) {
    const st = fs.statSync(arquivo, { bigint: true });
    return { dev: st.dev.toString(), ino: st.ino.toString(), tamanho: Number(st.size) };
  },
  ler(arquivo, offset, tamanho) {
    const fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(tamanho);
      const lidos = fs.readSync(fd, buffer, 0, tamanho, offset);
      return buffer.subarray(0, lidos);
    } finally { fs.closeSync(fd); }
  },
  lerJson(arquivo) {
    try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as unknown; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  },
  escreverJsonAtomico(arquivo, valor) {
    const dir = path.dirname(arquivo);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `.${path.basename(arquivo)}.${process.pid}.${randomUUID()}.tmp`);
    const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(valor, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, arquivo);
    fs.chmodSync(arquivo, 0o600);
    fsyncPasta(dir);
  },
  adquirirLock(arquivo, dono, agoraMs) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
    const tentar = () => {
      try { fs.writeFileSync(arquivo, JSON.stringify(dono) + '\n', { flag: 'wx', mode: 0o600 }); return true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
    };
    if (tentar()) return true;
    let anterior: Partial<DonoDoLock> = {};
    try { anterior = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Partial<DonoDoLock>; } catch { return false; }
    if (typeof anterior.expiraEm !== 'number' || anterior.expiraEm > agoraMs || processoVivo(Number(anterior.pid))) return false;
    try { fs.unlinkSync(arquivo); } catch { return false; }
    return tentar();
  },
  liberarLock(arquivo, token) {
    try {
      const dono = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Partial<DonoDoLock>;
      if (dono.token === token) fs.unlinkSync(arquivo);
    } catch { /* lock removido ou inválido: não apagar outro dono */ }
  },
};

function cursorInicial(id: IdentidadeDoLedger): CursorTelemetria {
  return { contrato: CONTRATO_CURSOR_TELEMETRIA, ledger: { dev: id.dev, ino: id.ino }, proximoOffset: 0,
    proximaSequencia: 1, ultimoUidConfirmado: null, terminal: null };
}

function cursorValido(valor: unknown, id: IdentidadeDoLedger): CursorTelemetria {
  if (valor === null) return cursorInicial(id);
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('telemetria.cursor: formato inválido');
  const c = valor as Partial<CursorTelemetria>;
  if (c.contrato !== CONTRATO_CURSOR_TELEMETRIA || !c.ledger || c.ledger.dev !== id.dev || c.ledger.ino !== id.ino ||
      !Number.isSafeInteger(c.proximoOffset) || (c.proximoOffset as number) < 0 ||
      !Number.isSafeInteger(c.proximaSequencia) || (c.proximaSequencia as number) < 1 ||
      !('terminal' in c)) throw new Error('telemetria.cursor: identidade ou contrato divergente');
  return c as CursorTelemetria;
}

function uidDerivado(thread: string, offset: number, linha: Buffer): string {
  const linhaHash = createHash('sha256').update(linha).digest('hex');
  return createHash('sha256').update(thread).update('\0').update(String(offset)).update('\0').update(linhaHash).digest('hex');
}

export interface BloqueioDoLedger { offset: number; linha: number;
  motivo: 'corrompida' | 'truncada' | 'grande' | MotivoRetentavelDoPrompt }
export interface LoteIncremental {
  registros: OtlpLogRecord[];
  uids: string[];
  fimOffset: number;
  proximaSequencia: number;
  bloqueio: BloqueioDoLedger | null;
  chegouAoFim: boolean;
}

/** Lê somente o sufixo desde o cursor; conteúdo corrompido nunca entra no retorno. */
function atributo(registro: OtlpLogRecord, chave: string): OtlpKeyValue | undefined {
  return registro.attributes.find((item) => item.key === chave);
}

function conteudoDoPrompt(registro: OtlpLogRecord): string | null {
  const entrada = atributo(registro, 'gen_ai.input.messages')?.value;
  if (!entrada || !('arrayValue' in entrada)) return null;
  const mensagem = entrada.arrayValue.values[0];
  if (!mensagem || !('kvlistValue' in mensagem)) return null;
  const partes = mensagem.kvlistValue.values.find((item) => item.key === 'parts')?.value;
  if (!partes || !('arrayValue' in partes)) return null;
  const parte = partes.arrayValue.values[0];
  if (!parte || !('kvlistValue' in parte)) return null;
  const conteudo = parte.kvlistValue.values.find((item) => item.key === 'content')?.value;
  return conteudo && 'stringValue' in conteudo ? conteudo.stringValue : null;
}

function registroComPrefixo(registro: OtlpLogRecord, prefixo: string): OtlpLogRecord {
  const semMetadadosDeCorte = registro.attributes.filter((item) =>
    item.key !== 'gen_ai.input.messages' && item.key !== 'orkastery.prompt.truncated' &&
    item.key !== 'orkastery.prompt.size.exported');
  return { ...registro, attributes: [
    ...semMetadadosDeCorte,
    { key: 'gen_ai.input.messages', value: entradaGenAi(prefixo) },
    { key: 'orkastery.prompt.truncated', value: { boolValue: true } },
    { key: 'orkastery.prompt.size.exported', value: { intValue: String(Buffer.byteLength(prefixo)) } },
  ] };
}

function fronteirasDePontoDeCodigo(texto: string): number[] {
  const fronteiras = [0];
  for (let i = 0; i < texto.length;) {
    const ponto = texto.codePointAt(i)!;
    i += ponto > 0xffff ? 2 : 1;
    fronteiras.push(i);
  }
  return fronteiras;
}

type SerializadorDoPayload = (payload: ExportLogsServiceRequest) => string;

function ajustarAoLimite(registros: readonly OtlpLogRecord[], registro: OtlpLogRecord,
  contexto: ContextoDoMapeamento, maxBytes: number, serializar: SerializadorDoPayload):
  { registro: OtlpLogRecord | null; bloqueio: MotivoRetentavelDoPrompt | null } {
  const tamanho = (candidato: OtlpLogRecord): number => Buffer.byteLength(serializar(
    montarExportLogsServiceRequest([...registros, candidato], contexto)));
  if (tamanho(registro) <= maxBytes) return { registro, bloqueio: null };
  if (registros.length) {
    const tamanhoIsolado = Buffer.byteLength(serializar(
      montarExportLogsServiceRequest([registro], contexto)));
    if (tamanhoIsolado <= maxBytes) return { registro: null, bloqueio: null };
  }
  const conteudo = conteudoDoPrompt(registro);
  if (conteudo === null) {
    if (registros.length) return { registro: null, bloqueio: null };
    throw new Error('telemetria.lote: registro excede o limite');
  }
  const fronteiras = fronteirasDePontoDeCodigo(conteudo);
  const vazio = registroComPrefixo(registro, '');
  if (tamanho(vazio) > maxBytes) {
    if (registros.length) return { registro: null, bloqueio: null };
    throw new Error('telemetria.lote: registro excede o limite');
  }
  let menor = 0, maior = fronteiras.length - 1, melhor = vazio;
  while (menor <= maior) {
    const meio = Math.floor((menor + maior) / 2);
    const candidato = registroComPrefixo(registro, conteudo.slice(0, fronteiras[meio]));
    if (tamanho(candidato) <= maxBytes) { melhor = candidato; menor = meio + 1; }
    else maior = meio - 1;
  }
  const final = conteudoDoPrompt(melhor) ?? '';
  const posCondicao = redigirRepresentacoesDeSegredo(final);
  if (!posCondicao.ok || posCondicao.total > 0) {
    return { registro: null, bloqueio: 'prompt_redaction_failed' };
  }
  return { registro: melhor, bloqueio: null };
}

export function lerLoteIncremental(opcoes: { arquivo: string; thread: string; cursor: CursorTelemetria;
  contexto: ContextoDoMapeamento; arquivos?: ArquivosTelemetria; maxRegistros?: number;
  maxBytes?: number; serializarPayload?: SerializadorDoPayload }): LoteIncremental {
  const io = opcoes.arquivos ?? arquivosDoNode;
  const id = io.identidade(opcoes.arquivo);
  if (id.dev !== opcoes.cursor.ledger.dev || id.ino !== opcoes.cursor.ledger.ino) {
    throw new Error('telemetria.cursor: ledger substituído');
  }
  const restante = Math.max(0, id.tamanho - opcoes.cursor.proximoOffset);
  const limite = Math.min(restante, MAXIMO_DE_LEITURA);
  const bytes = limite ? io.ler(opcoes.arquivo, opcoes.cursor.proximoOffset, limite) : Buffer.alloc(0);
  const eof = opcoes.cursor.proximoOffset + bytes.length >= id.tamanho;
  const registros: OtlpLogRecord[] = [], uids: string[] = [];
  let inicio = 0, offset = opcoes.cursor.proximoOffset, sequencia = opcoes.cursor.proximaSequencia;
  let bloqueio: BloqueioDoLedger | null = null;
  const max = opcoes.maxRegistros ?? MAXIMO_DE_REGISTROS;
  const maxBytes = opcoes.maxBytes ?? MAXIMO_DA_REQUISICAO;
  const serializar = opcoes.serializarPayload ?? JSON.stringify;
  while (inicio < bytes.length && registros.length < max) {
    const quebra = bytes.indexOf(0x0a, inicio);
    if (quebra < 0) {
      if (eof) bloqueio = { offset, linha: sequencia, motivo: 'truncada' };
      else if (inicio === 0) bloqueio = { offset, linha: sequencia, motivo: 'grande' };
      break;
    }
    const crua = bytes.subarray(inicio, quebra);
    const linha = crua.length && crua.at(-1) === 0x0d ? crua.subarray(0, -1) : crua;
    const proximoOffset = opcoes.cursor.proximoOffset + quebra + 1;
    inicio = quebra + 1;
    if (!linha.toString('utf8').trim()) { offset = proximoOffset; continue; }
    let evento: EventoLedger;
    try {
      const valor = JSON.parse(linha.toString('utf8')) as unknown;
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('objeto esperado');
      evento = valor as EventoLedger;
      if (typeof evento.ts !== 'string' || typeof evento.tipo !== 'string' || typeof evento.thread !== 'string') throw new Error('campos ausentes');
    } catch {
      bloqueio = { offset, linha: sequencia, motivo: 'corrompida' };
      break;
    }
    const uid = typeof evento.eventId === 'string' && evento.eventId.trim() ? evento.eventId : uidDerivado(opcoes.thread, offset, linha);
    const mapeado = mapearEventoDoLedger(evento, opcoes.contexto, { uid, sequencia });
    if (mapeado.bloqueioRetentavel) {
      bloqueio = { offset, linha: sequencia, motivo: mapeado.bloqueioRetentavel };
      break;
    }
    if (mapeado.registro) {
      const ajustado = ajustarAoLimite(registros, mapeado.registro, opcoes.contexto, maxBytes, serializar);
      if (ajustado.bloqueio) { bloqueio = { offset, linha: sequencia, motivo: ajustado.bloqueio }; break; }
      if (ajustado.registro === null) break;
      registros.push(ajustado.registro);
      uids.push(uid);
    }
    offset = proximoOffset;
    sequencia += 1;
  }
  return { registros, uids, fimOffset: offset, proximaSequencia: sequencia, bloqueio,
    chegouAoFim: offset >= id.tamanho };
}

export interface DestinoOtlp { endpoint: string; headers: Record<string, string>; timeoutMs: number }

function timeout(env: NodeJS.ProcessEnv): number {
  for (const chave of ['OTEL_EXPORTER_OTLP_LOGS_TIMEOUT', 'OTEL_EXPORTER_OTLP_TIMEOUT']) {
    const n = Number((env[chave] ?? '').trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return TIMEOUT_PADRAO_MS;
}

export function analisarHeadersOtlp(valor: string): Record<string, string> {
  const saida: Record<string, string> = {};
  if (!valor.trim()) return saida;
  for (const parte of valor.split(',')) {
    const i = parte.indexOf('=');
    if (i <= 0) throw new Error('telemetria.headers: formato inválido');
    let chave: string, conteudo: string;
    try { chave = decodeURIComponent(parte.slice(0, i).trim()); conteudo = decodeURIComponent(parte.slice(i + 1).trim()); }
    catch { throw new Error('telemetria.headers: formato inválido'); }
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(chave) || /[\r\n]/.test(conteudo)) {
      throw new Error('telemetria.headers: formato inválido');
    }
    saida[chave] = conteudo;
  }
  return saida;
}

export function resolverDestinoOtlp(env: NodeJS.ProcessEnv = process.env): DestinoOtlp {
  const especifico = (env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? '').trim();
  const geral = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  if (!especifico && !geral) throw new Error('telemetria.endpoint: destino ausente');
  let url: URL;
  try {
    if (especifico) url = new URL(especifico);
    else {
      const base = new URL(geral);
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      url = new URL('v1/logs', base);
    }
  } catch { throw new Error('telemetria.endpoint: destino inválido'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('telemetria.endpoint: protocolo inválido');
  const bruto = (env.OTEL_EXPORTER_OTLP_LOGS_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS ?? '');
  return { endpoint: url.toString(), headers: analisarHeadersOtlp(bruto), timeoutMs: timeout(env) };
}

export function sanitizarEndpoint(endpoint: string): string {
  try { const u = new URL(endpoint); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.toString(); }
  catch { return '[destino inválido]'; }
}

export interface PedidoTransporte {
  endpoint: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}
export interface RespostaTransporte { status: number; body: string; headers?: Record<string, string> }
export type TransporteOtlp = (pedido: PedidoTransporte) => Promise<RespostaTransporte>;

async function lerCorpoLimitado(resposta: Response): Promise<string> {
  if (!resposta.body) return '';
  const leitor = resposta.body.getReader(), partes: Buffer[] = [];
  let total = 0;
  try {
    while (total <= MAXIMO_DA_RESPOSTA) {
      const { done, value } = await leitor.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const bytes = Buffer.from(value), restante = MAXIMO_DA_RESPOSTA + 1 - total;
      const parte = bytes.subarray(0, Math.min(bytes.length, restante));
      partes.push(parte);
      total += parte.length;
      if (bytes.length > parte.length || total > MAXIMO_DA_RESPOSTA) {
        await leitor.cancel().catch(() => undefined);
        break;
      }
    }
  } finally { leitor.releaseLock(); }
  return Buffer.concat(partes, total).toString('utf8');
}

export const transporteHttp: TransporteOtlp = async (pedido) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), pedido.timeoutMs);
  try {
    const headersDoPedido = Object.fromEntries(Object.entries(pedido.headers)
      .filter(([chave]) => chave.toLowerCase() !== 'content-type'));
    headersDoPedido['content-type'] = 'application/json';
    const resposta = await fetch(pedido.endpoint, { method: 'POST', body: pedido.body, signal: controller.signal,
      headers: headersDoPedido });
    const body = await lerCorpoLimitado(resposta);
    const headersDaResposta: Record<string, string> = {};
    resposta.headers.forEach((v, k) => { headersDaResposta[k.toLowerCase()] = v; });
    return { status: resposta.status, body, headers: headersDaResposta };
  } finally { clearTimeout(timer); }
};

function retryAfterMs(resposta: RespostaTransporte, agoraMs: number): number | null {
  const valor = resposta.headers?.['retry-after'];
  if (!valor) return null;
  const segundos = Number(valor);
  const espera = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(valor) - agoraMs;
  return Number.isFinite(espera) && espera >= 0 ? Math.floor(espera) : null;
}

function backoffMs(tentativa: number, aleatorio: () => number): number {
  const amostra = Math.min(1, Math.max(0, aleatorio()));
  return Math.floor(BACKOFF_INICIAL_MS * (2 ** tentativa) * (0.5 + amostra));
}

function int64Decimal(valor: unknown): string | null {
  if (typeof valor !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/.test(valor)) return null;
  try {
    const numero = BigInt(valor);
    return numero >= -(2n ** 63n) && numero <= (2n ** 63n) - 1n ? valor : null;
  } catch { return null; }
}

function parcial(body: string, redigir: ContextoDoMapeamento['redigir']): RejeicaoTerminal | null {
  if (!body.trim()) return null;
  if (Buffer.byteLength(body) > MAXIMO_DA_RESPOSTA) return { contrato: CONTRATO_REJEICAO_TELEMETRIA,
    tipo: 'protocolo', status: 200, mensagem: 'resposta excedeu o limite' };
  let valor: unknown;
  try { valor = JSON.parse(body); } catch { return { contrato: CONTRATO_REJEICAO_TELEMETRIA,
    tipo: 'protocolo', status: 200, mensagem: 'resposta OTLP inválida' }; }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) || !('partialSuccess' in valor)) return null;
  const p = (valor as { partialSuccess?: unknown }).partialSuccess;
  const objeto = p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : {};
  let rejeitados: string | undefined;
  if ('rejectedLogRecords' in objeto) {
    const valido = int64Decimal(objeto.rejectedLogRecords);
    if (valido === null) return { contrato: CONTRATO_REJEICAO_TELEMETRIA,
      tipo: 'protocolo', status: 200, mensagem: 'resposta OTLP inválida' };
    rejeitados = valido;
  }
  let mensagem: string | undefined;
  if (typeof objeto.errorMessage === 'string' && objeto.errorMessage.trim()) {
    const segura = redigir(objeto.errorMessage);
    mensagem = segura.ok && segura.texto ? segura.texto.slice(0, 512) : 'mensagem recusada pela privacidade';
  }
  return { contrato: CONTRATO_REJEICAO_TELEMETRIA, tipo: 'parcial', status: 200,
    ...(rejeitados ? { rejectedLogRecords: rejeitados } : {}), ...(mensagem ? { mensagem } : {}) };
}

const RETENTAVEIS = new Set([429, 502, 503, 504]);

export type EstadoDaExportacao = 'vazio' | 'dry-run' | 'enviado' | 'pendente' | 'rejeitado' | 'bloqueado' | 'ocupado';
export interface ResultadoDaExportacao {
  estado: EstadoDaExportacao;
  registros: number;
  uids: string[];
  payload?: ExportLogsServiceRequest;
  bloqueio?: BloqueioDoLedger;
  rejeicao?: RejeicaoTerminal;
}

export async function exportarLedger(opcoes: {
  arquivoLedger: string; arquivoCursor: string; arquivoLock: string; thread: string;
  contexto: ContextoDoMapeamento; env?: NodeJS.ProcessEnv; arquivos?: ArquivosTelemetria;
  transporte?: TransporteOtlp; dryRun?: boolean; agoraMs?: () => number; dormir?: (ms: number) => Promise<void>;
  dryRunOffset?: number; aleatorio?: () => number; depoisDoEnvio?: () => void;
  serializarPayload?: SerializadorDoPayload;
}): Promise<ResultadoDaExportacao> {
  const io = opcoes.arquivos ?? arquivosDoNode, agoraMs = opcoes.agoraMs ?? Date.now;
  const preparar = (cursorInformado?: CursorTelemetria) => {
    const id = io.identidade(opcoes.arquivoLedger);
    const cursor = cursorInformado ?? cursorValido(io.lerJson(opcoes.arquivoCursor), id);
    const lote = lerLoteIncremental({ arquivo: opcoes.arquivoLedger, thread: opcoes.thread, cursor,
      contexto: opcoes.contexto, arquivos: io, serializarPayload: opcoes.serializarPayload });
    const payload = montarExportLogsServiceRequest(lote.registros, opcoes.contexto);
    return { cursor, lote, payload };
  };
  if (opcoes.dryRunOffset !== undefined && !opcoes.dryRun) {
    throw new Error('telemetria.dry-run: offset exige --dry-run');
  }
  if (opcoes.dryRun) {
    const id = io.identidade(opcoes.arquivoLedger), offset = opcoes.dryRunOffset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > id.tamanho) {
      throw new Error('telemetria.dry-run: offset inválido');
    }
    let posicao = 0, sequencia = 1, ultimoByte: number | undefined;
    while (posicao < offset) {
      const trecho = io.ler(opcoes.arquivoLedger, posicao, Math.min(MAXIMO_DE_LEITURA, offset - posicao));
      if (!trecho.length) throw new Error('telemetria.dry-run: offset inválido');
      for (const byte of trecho) if (byte === 0x0a) sequencia += 1;
      posicao += trecho.length;
      ultimoByte = trecho.at(-1);
    }
    if (offset > 0 && ultimoByte !== 0x0a) throw new Error('telemetria.dry-run: offset não inicia uma linha');
    const { lote, payload } = preparar({ ...cursorInicial(id), proximoOffset: offset, proximaSequencia: sequencia });
    return { estado: 'dry-run', registros: lote.registros.length, uids: lote.uids, payload,
      ...(lote.bloqueio ? { bloqueio: lote.bloqueio } : {}) };
  }
  const token = randomUUID(), dono = { pid: process.pid, token, expiraEm: agoraMs() + VALIDADE_DO_LOCK_MS };
  if (!io.adquirirLock(opcoes.arquivoLock, dono, agoraMs())) return { estado: 'ocupado', registros: 0, uids: [] };
  try {
    const { cursor, lote, payload } = preparar();
    if (cursor.terminal) return { estado: 'rejeitado', registros: 0, uids: [], rejeicao: cursor.terminal };
    if (!lote.registros.length) {
      if (lote.fimOffset !== cursor.proximoOffset) io.escreverJsonAtomico(opcoes.arquivoCursor, { ...cursor,
        proximoOffset: lote.fimOffset, proximaSequencia: lote.proximaSequencia });
      return { estado: lote.bloqueio ? 'bloqueado' : 'vazio', registros: 0, uids: [],
        ...(lote.bloqueio ? { bloqueio: lote.bloqueio } : {}) };
    }
    const destino = resolverDestinoOtlp(opcoes.env ?? process.env);
    const body = (opcoes.serializarPayload ?? JSON.stringify)(payload);
    if (Buffer.byteLength(body) > MAXIMO_DA_REQUISICAO) throw new Error('telemetria.lote: requisição excede o limite');
    const transporte = opcoes.transporte ?? transporteHttp, dormir = opcoes.dormir ?? ((ms) => new Promise(r => setTimeout(r, ms)));
    const aleatorio = opcoes.aleatorio ?? Math.random, limite = agoraMs() + destino.timeoutMs;
    let resposta: RespostaTransporte | null = null, falhaDeConexao = false;
    for (let tentativa = 0; tentativa < 2; tentativa += 1) {
      const restante = Math.floor(limite - agoraMs());
      if (restante <= 0) { falhaDeConexao = true; resposta = null; break; }
      falhaDeConexao = false;
      try { resposta = await transporte({ ...destino, timeoutMs: restante, body }); }
      catch { falhaDeConexao = true; resposta = null; }
      const retentar = falhaDeConexao || (resposta !== null && RETENTAVEIS.has(resposta.status));
      if (!retentar || tentativa === 1) break;
      const porHeader = resposta ? retryAfterMs(resposta, agoraMs()) : null;
      const espera = porHeader ?? backoffMs(tentativa, aleatorio);
      const restanteAposTentativa = Math.floor(limite - agoraMs());
      if (espera >= restanteAposTentativa) break;
      if (espera > 0) await dormir(espera);
    }
    if (falhaDeConexao || resposta === null || RETENTAVEIS.has(resposta.status)) {
      return { estado: 'pendente', registros: lote.registros.length, uids: lote.uids };
    }
    let rejeicao: RejeicaoTerminal | null = null;
    if (resposta.status === 200) rejeicao = parcial(resposta.body, opcoes.contexto.redigir);
    else rejeicao = { contrato: CONTRATO_REJEICAO_TELEMETRIA, tipo: 'nao-retentavel', status: resposta.status };
    if (rejeicao) {
      io.escreverJsonAtomico(opcoes.arquivoCursor, { ...cursor, terminal: rejeicao });
      return { estado: 'rejeitado', registros: lote.registros.length, uids: lote.uids, rejeicao };
    }
    opcoes.depoisDoEnvio?.();
    io.escreverJsonAtomico(opcoes.arquivoCursor, { ...cursor, proximoOffset: lote.fimOffset,
      proximaSequencia: lote.proximaSequencia, ultimoUidConfirmado: lote.uids.at(-1) ?? cursor.ultimoUidConfirmado });
    return { estado: lote.bloqueio ? 'bloqueado' : 'enviado', registros: lote.registros.length, uids: lote.uids,
      ...(lote.bloqueio ? { bloqueio: lote.bloqueio } : {}) };
  } finally { io.liberarLock(opcoes.arquivoLock, token); }
}
