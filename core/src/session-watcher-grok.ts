/**
 * RM-067 (F2 da ork-grokbuild): conclusão de sessões `grok`. O fim vem do que o próprio runtime e o supervisor gravam
 * (D9): o `end` do stream `streaming-json`, no log do supervisor, e o recibo do supervisor (`.exit.json`, com o código e
 * o sinal do `close` real). A pasta da sessão (`<GROK_HOME>/sessions/<grupo>/<id>/updates.jsonl`) é prova de existência
 * e de progresso, só pelo tamanho e pelo mtime: o `ork` nunca lê o conteúdo dela. O texto do agente nunca conclui
 * nada, e o `end_turn` é necessário e nunca suficiente: a fase só conclui com a prova do `ork` (`provaDoOrk`, a mesma do
 * claude-bg). Interrupção e fim por limite do runtime vão ao humano com a retomada (`-r <id>`), porque reexecutar a fase
 * sobre a worktree já alterada é a armadilha que a D13 e a D17 da I-34 evitaram no claude-bg. O lock, a pasta de
 * sensores e o processo destacado continuam no `session-watcher`; este módulo não o importa, para não criar ciclo.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acharSessaoGrok, AMBIENTE_SEM_MCP_DE_OUTROS_CLIENTES, montarComandoDeRetomada } from './adapters/grok';
import { EstadoParserGrok, falhaDoErroGrok, LIMITE_LINHA_GROK, ParserGrok, STOP_CANCELADO, STOP_FIM_NORMAL } from './adapters/grok-events';
import { TokensCodex } from './adapters/codex-events';
import { estadoProcesso, gravarAtomico, ProcessoCodex, ReciboCodex } from './adapters/codex-runner';
import { comLockDeSessao, SessaoDespachada } from './session-events';
import { lerLedger, registrarSeExiste, threadPresente } from './ledger';
import { pausaNaThread } from './thread';
import { EventoLedger, MotivoGate, SinalDeFalhaDeConta, Thread } from './types';
import { ARTEFATO_DA_FASE, estadoDoArtefato, provaDoOrk, ProvaOrk, saidaDoArtefato, THREAD_REMOVIDA } from './session-watcher-claude';
import { citarNoShell } from './doctor-pulse-cron';

/**
 * RM-067 (F4b, GO-FIX A3; F4c, D10): a retomada manual parte do `.grok/config.toml` da worktree como ele está, e a sessão
 * podia escrever nele no perfil `workspace`. Desde a F4c, o servidor do `ork` morre com a sessão, e o token dele só existia
 * no ambiente dela (`bearer_token_env_var`): a retomada manual não alcança o MCP do `ork`, nem o servidor de outra sessão que
 * pegue a mesma porta, que recusa sem o token dela; o `ork retry` sobe outro servidor e reescreve a config antes de redespachar.
 */
export const AVISO_DA_RETOMADA_COM_MCP = 'o servidor MCP do ork terminou com a sessao, e o token dele so existia no ambiente ' +
  'dela, entao a retomada manual roda sem o MCP do ork e parte do .grok/config.toml da worktree como a sessao o deixou: para ' +
  'retomar com o MCP, redespache pelo ork retry, que sobe outro servidor e reescreve a config';

/** D12: no máximo um `runtime_heartbeat` por minuto; o stream do `grok` emite um evento por pedaço de texto. */
export const HEARTBEAT_GROK_MS = 60_000;
export const CONTRATO_CURSOR_GROK = 'ork.session-cursor-grok/v1';
/** Bloco lido por observação: uma linha no limite e folga para as seguintes. */
const BLOCO_GROK_BYTES = LIMITE_LINHA_GROK + 65536;
const LIMITE_METADADO_BYTES = 65536;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** D8: a variante do `session_sensor_registered` do `grok`. */
export interface FonteGrok {
  grok: 'streaming-json';
  /** O log do stream do supervisor (`<thread>/sessoes/<id>.grok.jsonl`) e os recibos com os sufixos dele. */
  logPath: string;
  processoPath: string;
  reciboPath: string;
  /** A worktree do despacho. */
  cwd: string;
  /** A casa do `grok` no despacho: a busca da pasta da sessão olha nela. */
  grokHome: string;
  /** GOAL, PLAN e CHECK: sha do artefato da fase no registro (D12 da I-34). */
  artefato?: { arquivo: string; sha256: string | null };
  /** GO: HEAD da worktree lido antes do despacho; `null` quando o git não respondeu. */
  head?: string | null;
  origem?: string;
}

/**
 * D8: a base do artefato da fase, lida ANTES do despacho, como o HEAD do GO. O despacho do grok espera a pasta da
 * sessão, e a sessão pode gravar o documento antes do registro da fonte: a base lida depois seria o próprio documento.
 * `null` quando a fase não entrega artefato.
 */
export function baseDoArtefato(raiz: string, threadId: string, fase: string): { arquivo: string; sha256: string | null } | null {
  const arquivo = ARTEFATO_DA_FASE[fase];
  return arquivo ? { arquivo, sha256: estadoDoArtefato(raiz, threadId, arquivo).sha256 } : null;
}

/**
 * D8: a fonte do despacho, com a base do artefato e o HEAD do GO lidos antes dele (`noDespacho`); sem a base, ela é
 * lida agora, como no claude-bg.
 */
export function fonteGrokDoDespacho(raiz: string, threadId: string, fase: string, cwd: string,
    sensores: { logPath: string; processoPath: string; reciboPath: string }, grokHome: string,
    noDespacho: { head?: string | null; artefato?: { arquivo: string; sha256: string | null } | null } = {}): FonteGrok {
  if (!path.isAbsolute(cwd)) throw new Error('despacho grok sem cwd absoluto');
  const artefato = noDespacho.artefato !== undefined ? noDespacho.artefato : baseDoArtefato(raiz, threadId, fase);
  return { grok: 'streaming-json', logPath: sensores.logPath, processoPath: sensores.processoPath, reciboPath: sensores.reciboPath,
    cwd, grokHome,
    ...(artefato ? { artefato } : {}),
    ...(fase === 'GO' ? { head: noDespacho.head ?? null } : {}) };
}

/** D8: confere a fonte do `grok` contra o despacho e o diretório de sessões da thread. */
export function validarFonteGrok(eventos: readonly EventoLedger[], sessionId: string, registro: Partial<FonteGrok>, dirDaThread: string): void {
  if (registro.grok !== 'streaming-json' || typeof registro.cwd !== 'string' || !path.isAbsolute(registro.cwd) ||
      typeof registro.grokHome !== 'string' || !path.isAbsolute(registro.grokHome))
    throw new Error('registro de sensor do grok inválido');
  const sessoes = path.join(dirDaThread, 'sessoes');
  if (typeof registro.logPath !== 'string' || registro.logPath !== path.join(sessoes, `${sessionId}.grok.jsonl`) ||
      registro.processoPath !== `${registro.logPath}.process.json` || registro.reciboPath !== `${registro.logPath}.exit.json`)
    throw new Error('fonte de sensor do grok fora do diretório canônico de sessões');
  const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessionId).at(-1);
  if (despacho?.cwd !== undefined && despacho.cwd !== registro.cwd) throw new Error('cwd registrado divergente do despacho');
  if (registro.artefato !== undefined && (!Object.values(ARTEFATO_DA_FASE).includes(registro.artefato.arquivo) ||
      (typeof despacho?.fase === 'string' && ARTEFATO_DA_FASE[despacho.fase] !== registro.artefato.arquivo) ||
      (registro.artefato.sha256 !== null && !SHA256.test(String(registro.artefato.sha256)))))
    throw new Error('base de artefato do registro do grok inválida');
  if (registro.head !== undefined && ((registro.head !== null && !SHA_COMMIT.test(String(registro.head))) ||
      (typeof despacho?.fase === 'string' && despacho.fase !== 'GO')))
    throw new Error('HEAD de despacho do registro do grok inválido');
}

/** A fonte do `grok` registrada para este despacho, se houver. Leitura pura do ledger. */
export function fonteRegistradaGrok(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'despachadaEm'>): FonteGrok | undefined {
  const r = eventos.filter(e => e.tipo === 'session_sensor_registered' && e.sessionId === sessao.sessionId &&
    e.despachoEm === sessao.despachadaEm).at(-1);
  return r?.grok === 'streaming-json' ? r as unknown as FonteGrok : undefined;
}

/** D10: o resultado já gravado para este despacho, de qualquer fonte (o observador ou a batida). */
export function resultadoDoDespacho(eventos: readonly EventoLedger[],
    sessao: Pick<SessaoDespachada, 'sessionId' | 'despachadaEm'>): EventoLedger | undefined {
  return eventos.find(e => e.tipo === 'phase_result' && e.sessionId === sessao.sessionId &&
    (e.despachoEm === undefined || e.despachoEm === sessao.despachadaEm));
}

/** O que o recibo do supervisor diz do processo que terminou. */
export interface ReciboGrok { exitCode: number | null; signal: string | null; erro: string | null; duracaoMs: number }

export interface EntradaGrok {
  estado: EstadoParserGrok;
  recibo: ReciboGrok | null;
  /** Vida do filho (`grok`) e do supervisor pela identidade gravada no `.process.json`. */
  filho: 'vivo' | 'ausente' | 'desconhecido';
  supervisor: 'vivo' | 'ausente' | 'desconhecido';
  /** Último progresso (stream ou `updates.jsonl`), em ms. */
  progressoEm: number;
  agoraMs: number;
  /** Prazo de estabilidade para o stream sem `end` com o processo sem prova de vida. */
  limiteMs: number;
  pausaAoFim: boolean;
  /** Prova do lado do `ork`, avaliada só quando o `end_turn` diz que o turno terminou. */
  prova: () => ProvaOrk;
}

export type ClassificacaoGrok =
  | { terminal: false; espera: string }
  | { terminal: true; classificacao: 'fase_concluida' | 'gate_blocked'; motivo: MotivoGate | null; fonte: string;
      conclusaoNativa: boolean; diagnostico: string | null;
      /** Stream sem `end` e processo sem prova de vida além do limite: grava `sessao_morta` antes. */
      morte?: boolean;
      interrupcao?: { codigo: number | null; sinal: string | null; stopReason: string | null };
      /** O resultado leva o comando da retomada (`-r <id>`). */
      retomar?: boolean;
      erroDoRuntime?: string;
      falhaDeConta?: SinalDeFalhaDeConta };
type TerminalGrok = Extract<ClassificacaoGrok, { terminal: true }>;

const RETOMADA = 'o estado da sessão ficou salvo até a última ferramenta concluída e os arquivos alterados ficam como estão: ' +
  'retome a sessão com o comando da retomada ou redespache a fase';

/**
 * D9: a tabela de classificação, pura sobre as entradas. A ordem importa: sem recibo, o processo vivo espera; o recibo
 * de interrupção vem antes do código; a saída 0 só conclui pelo `end`; a outra saída só é tipada pelo `error` do runtime.
 * GO-FIX 1 (A5): com outra saída e sem `error`, o `end` válido vai ao humano, e o `cancelled` vale como interrupção: o
 * turno parou, e o `runtime.unavailable` que a batida reexecuta refaria a fase sobre a worktree já alterada.
 */
export function classificarSessaoGrok(e: EntradaGrok): ClassificacaoGrok {
  const { estado, recibo } = e;
  const bloqueio = (motivo: MotivoGate, fonte: string, extra: Partial<TerminalGrok> = {}): TerminalGrok =>
    ({ terminal: true, classificacao: 'gate_blocked', motivo, fonte, conclusaoNativa: false, diagnostico: fonte, ...extra });
  const interrupcao = (codigo: number | null, sinal: string | null, fonte: string): TerminalGrok =>
    bloqueio('human.pending', fonte, { interrupcao: { codigo, sinal, stopReason: estado.fim?.stopReason ?? null },
      retomar: true, diagnostico: `${fonte}; ${RETOMADA}` });
  const pelaFim = (comRecibo: boolean): TerminalGrok => {
    const fim = estado.fim!;
    if (fim.stopReason === STOP_CANCELADO) return interrupcao(recibo?.exitCode ?? null, recibo?.signal ?? null, 'end com stopReason cancelled');
    if (fim.stopReason !== STOP_FIM_NORMAL) {
      return bloqueio('human.pending', `end com stopReason ${fim.stopReason}`, { retomar: true,
        diagnostico: `o grok encerrou o turno por ${fim.stopReason}, sem o fim normal; ${RETOMADA}` });
    }
    const sinal = comRecibo ? 'end com stopReason end_turn e saida 0 no recibo do supervisor'
      : 'end com stopReason end_turn e processo encerrado sem o recibo do supervisor';
    const prova = e.prova();
    if (!prova.ok) {
      return bloqueio(prova.motivo ?? 'human.pending', `${sinal}; sem prova do ork: ${prova.fonte}`,
        { conclusaoNativa: comRecibo, diagnostico: `sem prova do ork: ${prova.fonte}` });
    }
    if (e.pausaAoFim) {
      return bloqueio('human.pending', `${sinal}; ${prova.fonte}; pausa prevista ao fim do bloco`, { conclusaoNativa: comRecibo, diagnostico: null });
    }
    return { terminal: true, classificacao: 'fase_concluida', motivo: null, fonte: `${sinal}; ${prova.fonte}`,
      conclusaoNativa: comRecibo, diagnostico: null };
  };
  const valido = !estado.invalido && !estado.sessaoDivergente;
  if (!recibo) {
    if (e.filho === 'vivo') return { terminal: false, espera: 'sessão trabalhando' };
    if (e.supervisor === 'vivo') return { terminal: false, espera: 'processo do grok encerrado; aguardando o recibo do supervisor' };
    if (estado.fim && valido && e.filho === 'ausente') return pelaFim(false);
    if (e.agoraMs - e.progressoEm >= e.limiteMs) {
      return bloqueio('runtime.unavailable', estado.fim ? 'end sem recibo do supervisor e processo sem prova de vida além do limite'
        : 'stream sem o evento end, processo sem prova de vida e sem progresso além do limite de estabilidade', { morte: true });
    }
    return { terminal: false, espera: 'processo sem prova de vida e sem recibo; aguardando o limite de estabilidade' };
  }
  if (recibo.erro) return bloqueio('runtime.unavailable', `o supervisor não iniciou o grok (${recibo.erro})`);
  if (recibo.exitCode === 130 || recibo.exitCode === 143 || recibo.signal === 'SIGINT' || recibo.signal === 'SIGTERM') {
    return interrupcao(recibo.exitCode, recibo.signal,
      `processo interrompido (${recibo.signal ?? `saida ${recibo.exitCode}`}) no recibo do supervisor`);
  }
  if (recibo.exitCode === 0) {
    if (estado.sessaoDivergente) return bloqueio('runtime.unavailable', 'saida 0 com o end sem o id da sessão despachada');
    if (estado.invalido) return bloqueio('runtime.unavailable', 'saida 0 com linha inválida no stream');
    if (!estado.fim) return bloqueio('runtime.unavailable', 'saida 0 sem o evento end no stream');
    return pelaFim(true);
  }
  const codigo = recibo.exitCode ?? recibo.signal ?? 'sem codigo';
  if (estado.erro) {
    const conta = falhaDoErroGrok(estado.erro, e.agoraMs);
    return bloqueio(conta?.motivo ?? 'runtime.unavailable', `saida ${codigo} com o objeto error do runtime: ${estado.erro.mensagem}`,
      { erroDoRuntime: estado.erro.mensagem, ...(conta ? { falhaDeConta: conta } : {}) });
  }
  if (estado.fim && valido) {
    if (estado.fim.stopReason === STOP_CANCELADO) {
      return interrupcao(recibo.exitCode, recibo.signal, `end com stopReason cancelled e saida ${codigo}`);
    }
    return bloqueio('human.pending', `saida ${codigo} depois do end com stopReason ${estado.fim.stopReason}, sem o objeto error`,
      { retomar: true, diagnostico: `o grok saiu ${codigo} depois de encerrar o turno (${estado.fim.stopReason}), sem o objeto error: ` +
        `a fase pode ter terminado; ${RETOMADA}` });
  }
  return bloqueio('runtime.unavailable', `saida ${codigo} sem o objeto error no stream`);
}

interface CursorGrok {
  schema: typeof CONTRATO_CURSOR_GROK; sessionId: string; despachoEm: string;
  ino: number | null; offset: number; parser: EstadoParserGrok;
  progressoEm: number; heartbeatEm: number; updatesBytes: number | null;
}

function lerJson<T>(arquivo: string): T | null {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > LIMITE_METADADO_BYTES) throw new Error('metadado de sensor excessivo');
    const bytes = Buffer.alloc(st.size);
    fs.readSync(fd, bytes, 0, st.size, 0);
    return JSON.parse(bytes.toString('utf8')) as T;
  } finally { fs.closeSync(fd); }
}

/**
 * O recibo do supervisor só vale inteiro e do mesmo processo do `.process.json`, como no codex. GO-FIX 1: o código
 * negativo só vale com o erro de spawn, que o Node entrega como o errno negativo no `close` (`-2` com `ENOENT`).
 */
function conferirRecibo(recibo: ReciboCodex, processo: ProcessoCodex | null, agoraMs: number): void {
  const erroDeSpawn = typeof recibo.erro === 'string' && recibo.erro !== '';
  if (!processo || recibo.schema !== 'ork.codex-process/v1' || recibo.iniciadoEm !== processo.iniciadoEm ||
      JSON.stringify(recibo.filho) !== JSON.stringify(processo.filho) || !Number.isFinite(Date.parse(recibo.terminadoEm)) ||
      Date.parse(recibo.terminadoEm) > agoraMs || !Number.isFinite(recibo.duracaoMs) || recibo.duracaoMs < 0 ||
      (recibo.exitCode !== null && (!Number.isInteger(recibo.exitCode) || (recibo.exitCode < 0 && !erroDeSpawn))) ||
      (recibo.signal !== null && typeof recibo.signal !== 'string') ||
      (recibo.erro !== null && typeof recibo.erro !== 'string')) throw new Error('recibo de processo inválido');
}

/**
 * Lê do log do stream o que cresceu desde o cursor, só linhas inteiras. O supervisor abre o log com `O_EXCL` e ele só
 * cresce: trocado ou encurtado é corrupção, e o stream fica inválido.
 */
function lerStream(arquivo: string, cursor: CursorGrok, sessionId: string):
    { bytes: number; eventos: number; backlog: boolean; parcial: boolean; mtimeMs: number | null } {
  let fd: number;
  try { fd = fs.openSync(arquivo, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, eventos: 0, backlog: false, parcial: false, mtimeMs: null };
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('runtime.unavailable: stream do grok não é arquivo comum');
    if ((cursor.ino !== null && cursor.ino !== st.ino) || st.size < cursor.offset) {
      cursor.parser = { ...cursor.parser, invalido: true };
      cursor.ino = st.ino; cursor.offset = st.size;
      return { bytes: 0, eventos: 0, backlog: false, parcial: false, mtimeMs: st.mtimeMs };
    }
    cursor.ino = st.ino;
    const n = Math.min(BLOCO_GROK_BYTES, st.size - cursor.offset);
    const buf = Buffer.alloc(n);
    const lidos = fs.readSync(fd, buf, 0, n, cursor.offset);
    const parser = new ParserGrok(sessionId, cursor.parser);
    const fim = buf.subarray(0, lidos).lastIndexOf(10);
    if (fim >= 0) { parser.push(buf.subarray(0, fim + 1)); cursor.offset += fim + 1; }
    else if (lidos >= LIMITE_LINHA_GROK) { parser.estado.invalido = true; cursor.offset += lidos; }
    cursor.parser = parser.estado;
    const resta = st.size > cursor.offset;
    return { bytes: lidos, eventos: parser.eventosValidos, backlog: resta && lidos === BLOCO_GROK_BYTES,
      parcial: resta && lidos < BLOCO_GROK_BYTES, mtimeMs: st.mtimeMs };
  } finally { fs.closeSync(fd); }
}

const tokensIndisponiveis = (): TokensCodex => ({ disponivel: false, input: null, cachedInput: null, output: null,
  total: null, unidade: 'tokens', escopo: 'sessao', fonte: 'unavailable' });

export interface ContextoObservacaoGrok {
  raiz: string; thread: Thread; sessao: SessaoDespachada; dir: string; pasta: string; chave: string;
  agoraMs: number; limiteMs: number;
  /** Sem relógio injetado, o "futuro" do recibo é medido depois da leitura, como no codex. */
  relogioReal: boolean;
}
export interface ResultadoObservacaoGrok {
  sessionId: string; thread: string; concluido: boolean; bytesLidos: number; classificacao?: string; espera?: string;
}

/** Corpo da observação do `grok`, chamado pelo `session-watcher` já dentro do lock do watcher. */
export function observarGrokSobLock(ctx: ContextoObservacaoGrok): ResultadoObservacaoGrok {
  const { raiz, thread, sessao, dir, agoraMs } = ctx;
  const base: ResultadoObservacaoGrok = { sessionId: sessao.sessionId, thread: thread.id, concluido: false, bytesLidos: 0 };
  const resultadoId = `grok:${ctx.chave}`;
  const gravar = (tipo: string, dados: Record<string, unknown>) => {
    if (!registrarSeExiste(dir, thread.id, tipo, dados)) throw new Error(THREAD_REMOVIDA);
  };
  const eventos = lerLedger(dir);
  const pronto = resultadoDoDespacho(eventos, sessao);
  if (pronto) return { ...base, concluido: true, classificacao: String(pronto.classificacao) };
  const fonte = fonteRegistradaGrok(eventos, sessao);
  if (!fonte) throw new Error('fonte de sensor do grok ausente');
  validarFonteGrok(eventos, sessao.sessionId, fonte, dir);
  const arquivoCursor = path.join(ctx.pasta, 'cursor-grok.json');
  const lido = lerJson<CursorGrok>(arquivoCursor);
  if (lido && (lido.schema !== CONTRATO_CURSOR_GROK || lido.sessionId !== sessao.sessionId || lido.despachoEm !== sessao.despachadaEm))
    throw new Error('cursor de outra sessão/despacho');
  const cursor: CursorGrok = lido ?? { schema: CONTRATO_CURSOR_GROK, sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm,
    ino: null, offset: 0, parser: new ParserGrok(sessao.sessionId).estado, progressoEm: Date.parse(sessao.despachadaEm),
    heartbeatEm: 0, updatesBytes: null };
  // A ordem das leituras é a do supervisor ao contrário: ele grava o recibo depois do `close` do filho e só então sai.
  // GO-FIX 2 (N1): a vida antes do recibo; o supervisor visto ausente já deixou no disco o recibo que gravaria.
  // GO-FIX 1 (A2): o recibo antes do stream; com o recibo no disco, o stream lido em seguida está inteiro.
  const processo = lerJson<ProcessoCodex>(fonte.processoPath);
  const vida = { filho: estadoProcesso(processo?.filho ?? null), supervisor: estadoProcesso(processo?.supervisor ?? null) };
  const recibo = lerJson<ReciboCodex>(fonte.reciboPath);
  if (recibo) conferirRecibo(recibo, processo, ctx.relogioReal ? Date.now() : agoraMs);
  const leitura = lerStream(fonte.logPath, cursor, sessao.sessionId);
  let progrediu = false;
  if (leitura.eventos > 0 && leitura.mtimeMs !== null) {
    progrediu = true; cursor.progressoEm = Math.max(cursor.progressoEm, Math.min(agoraMs, leitura.mtimeMs));
  }
  // O processo terminou e a última linha não terminou: ela nunca vai se completar.
  if (recibo && leitura.parcial) cursor.parser = { ...cursor.parser, invalido: true };
  // A pasta da sessão é do runtime: só o tamanho do `updates.jsonl` conta como progresso, nunca o conteúdo.
  const emDisco = acharSessaoGrok(sessao.sessionId, fonte.grokHome);
  if (emDisco && (cursor.updatesBytes === null || emDisco.tamanho > cursor.updatesBytes)) {
    progrediu = true; cursor.progressoEm = Math.max(cursor.progressoEm, Math.min(agoraMs, emDisco.mtimeMs));
  }
  if (emDisco) cursor.updatesBytes = emDisco.tamanho;
  let prova: ProvaOrk | undefined;
  const c: ClassificacaoGrok = leitura.backlog ? { terminal: false, espera: 'stream com bytes ainda não lidos' }
    : classificarSessaoGrok({ estado: cursor.parser,
      recibo: recibo ? { exitCode: recibo.exitCode, signal: recibo.signal, erro: recibo.erro, duracaoMs: recibo.duracaoMs } : null,
      filho: recibo ? 'ausente' : vida.filho,
      supervisor: recibo ? 'ausente' : vida.supervisor,
      progressoEm: cursor.progressoEm, agoraMs, limiteMs: ctx.limiteMs, pausaAoFim: pausaNaThread(thread, sessao.fase),
      prova: () => prova ??= provaDoOrk(raiz, thread.id, sessao, eventos, fonte) });
  gravarAtomico(arquivoCursor, cursor);
  if (!threadPresente(dir)) { fs.rmSync(arquivoCursor, { force: true }); throw new Error(THREAD_REMOVIDA); }
  return comLockDeSessao(dir, () => {
    const atuais = lerLedger(dir);
    if (progrediu && (cursor.heartbeatEm === 0 || cursor.progressoEm - cursor.heartbeatEm >= HEARTBEAT_GROK_MS)) {
      const heartbeatId = `${resultadoId}:heartbeat:${cursor.progressoEm}`;
      if (!atuais.some(e => e.sensorEventId === heartbeatId)) gravar('runtime_heartbeat', {
        ts: new Date(cursor.progressoEm).toISOString(), fase: sessao.fase, sessionId: sessao.sessionId,
        despachoEm: sessao.despachadaEm, sensorEventId: heartbeatId, runtime: 'grok',
        fonte: 'progresso do stream ou do updates.jsonl do grok', bytesLidos: leitura.bytes });
      cursor.heartbeatEm = cursor.progressoEm;
      gravarAtomico(arquivoCursor, cursor);
    }
    if (!c.terminal) return { ...base, bytesLidos: leitura.bytes, espera: c.espera };
    const ja = resultadoDoDespacho(atuais, sessao);
    if (ja) return { ...base, bytesLidos: leitura.bytes, concluido: true, classificacao: String(ja.classificacao) };
    // RM-067 (F4b, G8 e D6): com o MCP, a sessão grava commit, artefato e verify pelo núcleo até o fim, e o ledger da prova
    // foi lido antes do recibo. A prova é refeita sobre o ledger relido sob o lock; se mudou, a decisão fica para a próxima
    // volta, como a do Stop no claude-bg. Converge: a prova só muda com evento novo do intervalo. GO-FIX A1: a prova inteira
    // (o `verify` do CHECK, os commits do GO, o evento do SHIP e do MASTER), não só o texto, porque o `phase_result` a grava.
    if (prova !== undefined && JSON.stringify(provaDoOrk(raiz, thread.id, sessao, atuais, fonte)) !== JSON.stringify(prova))
      return { ...base, bytesLidos: leitura.bytes, espera: 'evento do núcleo gravado durante a observação; reavaliar na próxima volta' };
    const despacho = atuais.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessao.sessionId).at(-1);
    const comando = Array.isArray(despacho?.comando) && despacho.comando.every(a => typeof a === 'string') ? despacho.comando as string[] : [];
    const retomada = c.retomar ? montarComandoDeRetomada(comando, sessao.sessionId) : null;
    const artefato = saidaDoArtefato(raiz, thread.id, sessao, fonte, eventos);
    const fim = cursor.parser.fim;
    // GO-FIX 1 (S4): o comando da retomada vai pronto para colar, com aspas no argumento que precisa delas. RM-067 (F4b, D5):
    // com as variáveis do filho na frente, para a sessão retomada também não carregar o MCP de outros clientes. GO-FIX A3: com
    // o MCP do ork, a retomada parte da config que a sessão podia escrever, e o detalhe diz isso.
    const ambiente = Object.entries(AMBIENTE_SEM_MCP_DE_OUTROS_CLIENTES).map(([nome, valor]) => `${nome}=${valor}`);
    // GO-FIX N4: o aviso vem antes do comando, que pode levar uma dezena de regras e as telas cortam o detalhe no fim.
    const comMcp = retomada?.some((a) => a.startsWith('MCPTool(orkastery__')) ? `; ${AVISO_DA_RETOMADA_COM_MCP}` : '';
    const detalhe = c.diagnostico === null ? null
      : retomada ? `${c.diagnostico}${comMcp}; retomada: ${[...ambiente, ...retomada.map(citarNoShell)].join(' ')}` : c.diagnostico;
    const dados = { fase: sessao.fase, sessionId: sessao.sessionId, despachoEm: sessao.despachadaEm, sensorResultId: resultadoId,
      classificacao: c.classificacao, motivo: c.motivo, runtime: 'grok', fonte: c.fonte,
      stopReason: fim?.stopReason ?? null, numTurnos: fim?.numTurnos ?? null, tokens: fim?.tokens ?? tokensIndisponiveis(),
      custoUsd: fim?.custoUsd ?? null,
      exitCode: recibo?.exitCode ?? null, exitCodeFonte: recibo ? 'supervisor.close' : 'unavailable', signal: recibo?.signal ?? null,
      duracaoMs: recibo?.duracaoMs ?? null, duracaoFonte: recibo ? 'supervisor.close' : 'unavailable',
      ok: c.classificacao === 'fase_concluida' && recibo?.exitCode === 0,
      estado: c.classificacao === 'fase_concluida' ? 'concluida' : 'bloqueada',
      conclusaoNativa: c.conclusaoNativa, conclusaoNativaAusente: c.conclusaoNativa ? null : c.fonte,
      ...(artefato ? { artefato: { arquivo: artefato.arquivo, sha256Base: artefato.sha256Base, sha256Atual: artefato.sha256 } } : {}),
      ...(prova ? { provaOrk: prova } : {}),
      ...(c.interrupcao ? { interrupcao: c.interrupcao } : {}),
      ...(c.retomar ? { retomada: retomada ? { sessionId: sessao.sessionId, comando: retomada } : null } : {}),
      ...(c.erroDoRuntime ? { erroDoRuntime: c.erroDoRuntime } : {}),
      ...(c.falhaDeConta ? { falhaDeConta: { motivo: c.falhaDeConta.motivo, resetEm: c.falhaDeConta.resetEm,
        fonte: c.falhaDeConta.fonte, trecho: c.falhaDeConta.trecho } } : {}),
      // D18 da I-34: o diagnóstico vai ao pedido HITL e, como `detalhe` do `gate_blocked`, ao monitor e ao pulse.
      diagnostico: c.diagnostico, ...(detalhe ? { detalhe } : {}),
      observadoEm: new Date(agoraMs).toISOString(), gate: 'phase.dispatch', origem: 'sessions.watch',
      morteLatenciaMs: c.morte ? agoraMs - cursor.progressoEm : null };
    // GO-FIX 1 (S1): cada evento do fim uma vez por despacho, como nos outros observadores; o processo que morre entre as
    // gravações não repete o `gate_blocked` na volta seguinte.
    const gravarUmaVez = (tipo: string) => {
      if (!atuais.some(e => e.tipo === tipo && e.sensorResultId === resultadoId)) gravar(tipo, dados);
    };
    if (c.morte) gravarUmaVez('sessao_morta');
    gravarUmaVez(c.classificacao);
    gravar('phase_result', dados);
    return { ...base, bytesLidos: leitura.bytes, concluido: true, classificacao: c.classificacao };
  });
}
