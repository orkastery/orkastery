/** D6: observador restrito a uma sessão, cursor canônico e resultados idempotentes. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { acharRollout, casaDoCodex } from './adapters/codex';
import { perfilDoRegistro } from './runtime-profiles';
import { EstadoParserCodex, falhaDeContaDoErroCodex, ParserCodex, TerminalCodex, LIMITE_LINHA_CODEX } from './adapters/codex-events';
import { estadoProcesso, gravarAtomico, identidadeProcesso, IdentidadeProcesso, ProcessoCodex, ReciboCodex } from './adapters/codex-runner';
import { dirThread, lerThread } from './thread';
import { resolverSessao, exigirSessaoDespachada, comLockDeSessao } from './session-events';
import { lerLedger, registrar, registrarSeExiste, threadPresente } from './ledger';
import { exigirManifesto, ManifestoCarregado } from './manifest';
import { FonteController, SnapshotController, lerSnapshotController, registrarFonteController } from './adapters/codex-controller-sensor';
import { politicaDoMotivo } from './retry';
import { marcarContaDaFalha } from './ratelimit';
import { SinalDeFalhaDeConta } from './types';
import { ConsultaAgentesNativos } from './adapters/claude-bg';
import { eventosDoIntervalo, garantirFonteClaude, INTERVALO_WATCH_CLAUDE_MS, observarClaudeSobLock, THREAD_REMOVIDA, validarFonteClaude } from './session-watcher-claude';

/** Falhas operacionais e bloqueios sem retry automático não alegam conclusão do produto. */
function bloqueioPreservado(terminal: TerminalCodex): boolean {
  return terminal.classificacao === 'gate_blocked' && terminal.motivo !== null &&
    (politicaDoMotivo(terminal.motivo)?.automatica === false ||
      ['runtime.rate-limited', 'runtime.unavailable', 'runtime.silencio', 'tree.blocked', 'lease.busy'].includes(terminal.motivo) ||
      // I-33 (D12): falha da conta com erro estruturado do runtime tambem nao alega conclusao.
      (!!terminal.falhaDeConta && terminal.motivo === terminal.falhaDeConta.motivo));
}

/**
 * I-33 (D12): falha da CONTA no caminho terminal do turno codex. Duas fontes do proprio runtime,
 * nunca texto do agente: o `task_complete.error` do rollout (valido e com o turno fechado) e o erro
 * nativo do `turn/completed` `failed` gravado pelo controller. O incidente de 18/09 tinha as duas.
 */
function falhaDeContaDoTerminal(terminal: TerminalCodex | undefined, rolloutConfiavel: boolean,
    snapshot: SnapshotController | null, agoraMs: number): { falha: SinalDeFalhaDeConta; fonte: string } | null {
  if (rolloutConfiavel && terminal?.falhaDeConta) return { falha: terminal.falhaDeConta, fonte: `${terminal.fonte}.error` };
  const nativo = snapshot?.terminalNativo;
  if (nativo?.status !== 'failed' || !nativo.erro) return null;
  const falha = falhaDeContaDoErroCodex(nativo.erro, agoraMs);
  return falha ? { falha, fonte: 'controller.turn/completed.error' } : null;
}

/**
 * Portao I04 do transporte do controller. Enumera o que falta para o sucesso ser prova,
 * nunca o contrario: devolve `null` so quando terminal nativo `completed`, estado sem erro
 * nem limitacao, correlacao de thread, cwd e turno e `close` real zero estao todos
 * demonstrados. Prefixo de texto nao e proveniencia: id de origem gerada nao vincula turno.
 */
function semProvaNativa(snapshot: SnapshotController, terminal: TerminalCodex, fonteVencedora: string | undefined,
    fechamento: { exitCode: number | null; signal: string | null; erro: string | null } | null,
    sessionId: string, cwd: string): string | null {
  const nativo = snapshot.terminalNativo;
  if (!nativo) return 'terminal nativo ausente na fonte do controller';
  if (nativo.status !== 'completed') {
    const conhecido = nativo.status === 'failed' || nativo.status === 'interrupted';
    return `terminal nativo com status ${conhecido ? nativo.status : 'desconhecido'}`;
  }
  if (nativo.threadId !== sessionId) return 'terminal nativo de outra thread';
  if (snapshot.erro || snapshot.limitacao) return 'estado do controller com erro ou limitacao tipada';
  if (snapshot.fonte.cwd !== cwd) return 'cwd da fonte divergente do despacho';
  if (snapshot.turno !== nativo.turnId) return 'turno do estado divergente do terminal nativo';
  if (fonteVencedora !== 'rollout') return 'terminal observado fora do rollout fixado';
  if (terminal.turnIdOrigem !== 'explicito') return 'id de turno sem proveniencia explicita e sem vinculacao alternativa provada';
  if (terminal.turnId !== nativo.turnId) return 'turno observado divergente do terminal nativo';
  if (!fechamento || fechamento.exitCode !== 0 || fechamento.signal || fechamento.erro) return 'close real zero do controller ausente';
  return null;
}

export const LIMITE_MORTE_MS = 600000;
export const INTERVALO_WATCH_MS = 1000;
export const MAX_ESPERA_ERRO_WATCH_MS = 30000;
export const MAX_FALHAS_WATCH = 12;
export const BLOCO_WATCH_BYTES = LIMITE_LINHA_CODEX + 65536;
interface FonteCursor {
  file: string; ino: number; tamanho: number; offset: number;
  parser: EstadoParserCodex; terminal: TerminalCodex | null;
  parcial?: boolean;
}
interface Cursor {
  schema: 'ork.session-cursor/v1'; sessionId: string; despachoEm: string;
  crescimentoEm: number; progressoEm?: number; esperaDesde?: number; heartbeatEm: number; fontes: Record<string, FonteCursor>;
}
/** Três variantes exclusivas: log supervisionado (histórica), controller do despacho ou nativa claude-bg (I-34). */
interface RegistroSensor { logPath?: string; processoPath?: string; reciboPath?: string; controlador?: string; cwd?: string;
  nativo?: string; artefato?: { arquivo: string; sha256: string | null } }
function lerJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > 65536) throw new Error('metadado de sensor excessivo');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/**
 * Sob o mutex de recovery: `true` quando o lock ficou livre (dono morto, lock sem dono vencido, ou
 * dono vivo que soltou o lock no meio da leitura) e `false` quando o dono segue vivo.
 */
function lockLiberado(lock: string, owner: string): boolean {
  try {
    const atual = lerJson<{ identidade: IdentidadeProcesso | null }>(owner);
    if (atual ? estadoProcesso(atual.identidade) !== 'ausente' : Date.now() - fs.statSync(lock).mtimeMs < 60000) return false;
    if (atual) fs.unlinkSync(owner);
    fs.rmdirSync(lock);
    return true;
  } catch (e) {
    // O dono vivo pode soltar o lock entre o EEXIST e esta leitura: sumir aqui quer dizer lock livre, não falha.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw e;
  }
}

/** Recovery serializado: quem perde o mutex não remove lock recém-adquirido. */
function comLockWatcher<T>(dir: string, action: () => T): T | null {
  const lock = path.join(dir, 'watch.lock'), recover = path.join(dir, 'recover.lock');
  const dono = { identidade: identidadeProcesso(process.pid), token: randomUUID() };
  const owner = path.join(lock, 'owner.json');
  const criar = () => { fs.mkdirSync(lock); gravarAtomico(owner, dono); };
  try { criar(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    try { fs.mkdirSync(recover); } catch { return null; }
    try {
      if (!lockLiberado(lock, owner)) return null;
      try { criar(); } catch (erro) { if ((erro as NodeJS.ErrnoException).code === 'EEXIST') return null; throw erro; }
    } finally { fs.rmdirSync(recover); }
  }
  try { return action(); }
  finally {
    if (lerJson<{ token: string }>(owner)?.token === dono.token) { fs.unlinkSync(owner); fs.rmdirSync(lock); }
  }
}

/**
 * `agoraMs` só vem quando o relógio é injetado. Sem ele, a referência de "evento do futuro" é o
 * relógio depois da leitura: a linha que o runtime anexou durante a observação não é futura, e
 * descartá-la perdia o terminal do turno.
 */
function lerFonte(file: string, anterior: FonteCursor | undefined, agoraMs: number | undefined, sessionId: string, fixada?: FonteController): {
  cursor: FonteCursor; cresceu: boolean; quando: number; bytes: number; temMais: boolean;
} {
  const fd = fs.openSync(file, fixada
    ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK : 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (fixada) {
      // A validação anterior do sensor não autentica um pathname reaberto depois.
      // Os bytes precisam vir do próprio descritor vinculado à identidade fixada.
      const pai = fs.statSync(path.dirname(file));
      if (file !== fixada.rollout || !stat.isFile() || stat.ino !== fixada.rolloutIno ||
          stat.dev !== fixada.rolloutDev || stat.uid !== fixada.uid || (stat.mode & 0o022) !== 0 ||
          fs.realpathSync(file) !== file || !pai.isDirectory() || pai.uid !== fixada.uid ||
          (pai.mode & 0o022) !== 0) {
        throw new Error('runtime.unavailable: descritor consumidor de rollout divergente da fonte fixada');
      }
    }
    const mesmo = anterior?.file === file && anterior.ino === stat.ino && stat.size >= anterior.offset;
    const parser = new ParserCodex(mesmo ? anterior.parser : undefined);
    // Corrupção já observada continua relevante depois de truncamento/rotação.
    parser.estado.invalido ||= anterior?.parser.invalido ?? false;
    let offset = mesmo ? anterior.offset : 0;
    const buffer = Buffer.alloc(Math.min(BLOCO_WATCH_BYTES, stat.size - offset));
    const n = fs.readSync(fd, buffer, 0, buffer.length, offset);
    const agora = agoraMs ?? Date.now();
    const fim = buffer.subarray(0, n).lastIndexOf(10);
    let terminal = mesmo ? anterior.terminal : null;
    if (fim >= 0) {
      for (const linha of buffer.subarray(0, fim + 1).toString('utf8').split('\n')) {
        let e;
        try { e = JSON.parse(linha); } catch { continue; }
        if ((e?.type === 'thread.started' && e.thread_id !== sessionId) ||
            (e?.type === 'session_meta' && e.payload?.id !== sessionId)) throw new Error('log/rollout pertence a outra sessão');
      }
      for (const t of parser.push(buffer.subarray(0, fim + 1), agora)) terminal = t;
      offset += fim + 1;
    } else if (n >= LIMITE_LINHA_CODEX) {
      // Uma linha sem limite não retém o cursor para sempre nem permite alegar sucesso.
      parser.estado.invalido = true; offset += n;
    }
    if (parser.estado.turnoAberto || (terminal?.numeroTurno ?? 0) < parser.estado.turnos) terminal = null;
    const parcial = n < BLOCO_WATCH_BYTES && stat.size > offset;
    return { cursor: { file, ino: stat.ino, tamanho: stat.size, offset, parser: parser.estado, terminal, parcial },
      cresceu: parser.eventosValidos > 0,
      quando: Math.min(agora, stat.mtimeMs), bytes: n, temMais: stat.size > offset };
  } finally { fs.closeSync(fd); }
}

function conferirRegistro(dir: string, registro: RegistroSensor): void {
  // A variante nativa não declara arquivo: a fonte é o `claude agents` e o cwd do despacho.
  if (registro.nativo !== undefined) {
    if (registro.logPath || registro.processoPath || registro.reciboPath || registro.controlador)
      throw new Error('registro de sensor mistura fonte nativa e arquivo');
    return;
  }
  const esperado = path.join(dir, 'sessoes') + path.sep;
  for (const file of [registro.logPath, registro.processoPath, registro.reciboPath, registro.controlador].filter(Boolean) as string[]) {
    if (!path.resolve(file).startsWith(esperado) ||
        (fs.existsSync(file) && !fs.realpathSync(file).startsWith(esperado))) throw new Error('fonte de sensor fora do diretório canônico de sessões');
  }
  // A variante do controller dispensa logPath; a histórica continua exigindo o log e seus sufixos.
  if (registro.controlador) {
    if (registro.logPath || registro.processoPath || registro.reciboPath) throw new Error('registro de sensor mistura controller e log supervisionado');
    return;
  }
  if (!registro.logPath) throw new Error('registro de sensor sem fonte declarada');
  if ((registro.processoPath && registro.processoPath !== registro.logPath + '.process.json') ||
      (registro.reciboPath && registro.reciboPath !== registro.logPath + '.exit.json')) throw new Error('recibo não corresponde ao log registrado');
}

/**
 * GO-FIX 3 (achado 1): apaga os cursores da pasta de sensores e as pastas que a observação
 * criou, da mais funda para a raiz. Pasta que já sumiu, ou que ganhou entrada alheia, fica
 * com o dono da remoção.
 */
function desfazerNaThreadRemovida(pasta: string, criadas: readonly string[]): void {
  for (const cursor of ['cursor.json', 'cursor-claude.json']) {
    try { fs.rmSync(path.join(pasta, cursor), { force: true }); } catch { /* pasta já removida */ }
  }
  for (const nivel of [...criadas].reverse()) {
    try { fs.rmdirSync(nivel); } catch { /* já removida ou não vazia */ }
  }
}

export interface ResultadoWatcher { sessionId: string; thread: string; concluido: boolean; ocupado?: boolean; bytesLidos: number; classificacao?: string;
  /** I-34: observação claude-bg inconclusiva além do limite; o laço para sem gate. */
  encerrado?: boolean; espera?: string }
interface OpcoesObservacao {
  agoraMs?: number; rollout?: string | null;
  /** Vínculo já resolvido pelo dispatcher, reconferido em cada leitura. */
  threadId?: string;
  /** I-34: consulta nativa injetável em teste, como `rollout` no Codex. */
  consultaClaude?: () => ConsultaAgentesNativos;
}

/** Diagnóstico fechado: mensagens de E/S e JSON podem conter caminhos e segredos. */
function diagnosticoWatcher(e: unknown): { erro: string; transitorio: boolean; categoria: string; code: string | null; construtor: string } {
  const erro = e as NodeJS.ErrnoException;
  const code = ['ENOENT', 'EAGAIN', 'EBUSY', 'EINTR', 'EACCES', 'EPERM', 'EIO', 'ENOSPC', 'SESSION_STATE_SPLIT']
    .includes(erro?.code ?? '') ? erro.code! : null;
  const nome = e instanceof Error ? e.constructor.name : '';
  const construtor = ['Error', 'SyntaxError', 'TypeError', 'RangeError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError']
    .includes(nome) ? nome : 'desconhecido';
  const base = { code, construtor };
  const mensagem = erro?.message ?? '';
  // Só motivos literais do núcleo saem no diagnóstico: nenhum conteúdo de metadado.
  const motivos = ['sessão do controller divergente', 'instância do controller divergente',
    'vínculo thread/fase/prompt do controller divergente', 'cwd do controller divergente',
    'identidade do controller divergente da registrada', 'identidade do runtime divergente da registrada',
    'rollout do controller ausente', 'rollout do controller divergente do registrado',
    'rollout do controller rotacionado sem vínculo provado com a fonte fixada',
    'descritor consumidor de rollout divergente da fonte fixada'];
  const metadado = /^runtime\.unavailable: metadado (state\.json|launch\.json|process-launch\.json) de controller (inválido|ausente)$/.test(mensagem);
  const categoria = metadado || motivos.some(m => mensagem === `runtime.unavailable: ${m}`) ? mensagem
    : mensagem === 'controlador registrado divergente do despacho' ? 'controller.registro-divergente'
    : mensagem === 'despacho do controller sem cwd registrado' ? 'controller.cwd-ausente'
    : mensagem.startsWith('runtime.unavailable:') ? 'runtime.unavailable: motivo não categorizado'
    : code ? `io.${code}` : construtor;
  if (code === 'SESSION_STATE_SPLIT') return { ...base, categoria: 'estado.dividido',
    erro: 'estado canônico temporariamente sem vínculo; auditoria será repetida', transitorio: true };
  if (['ENOENT', 'EAGAIN', 'EBUSY', 'EINTR'].includes(erro?.code ?? ''))
    return { ...base, categoria, erro: `leitura temporariamente indisponível (${erro.code})`, transitorio: true };
  if (e instanceof SyntaxError || /^JSON invalido em /.test(erro?.message ?? '') ||
      metadado)
    return { ...base, categoria: metadado ? categoria : 'json.invalido', erro: 'metadado JSON indisponível ou incompleto', transitorio: true };
  if (/^(ingestão ocupada|creation\.busy:)/.test(erro?.message ?? ''))
    return { ...base, categoria: 'observacao.ocupada', erro: 'observação ocupada; nova tentativa agendada', transitorio: true };
  return { ...base, categoria, erro: 'falha permanente na observação; confira vínculo e fonte do sensor', transitorio: false };
}
const errosRegistrados = new WeakSet<object>();
interface SerieErroWatcher {
  falhasConsecutivas: number;
  etapa: 'inicial' | 'final';
  encerramento?: 'recuperado' | 'tentativas' | 'prazo' | 'permanente';
}
function registrarErroWatcher(raiz: string, threadId: string, sessionId: string, e: unknown, serie?: SerieErroWatcher): boolean {
  if (!serie && e && typeof e === 'object' && errosRegistrados.has(e)) return true;
  const dados = diagnosticoWatcher(e);
  const registrado = registrarSeExiste(dirThread(raiz, threadId), threadId, 'session_watcher_error', {
    sessionId, motivo: 'runtime.unavailable', ...dados, ...serie,
    transitorio: dados.transitorio && (!serie?.encerramento || serie.encerramento === 'recuperado'), origem: 'sessions.watch',
  });
  if (registrado && e && typeof e === 'object') errosRegistrados.add(e);
  return registrado !== null;
}

/** Falhar ao diagnosticar não troca o erro observado nem interrompe o retry transitório. */
function tentarRegistrarErroWatcher(...args: Parameters<typeof registrarErroWatcher>): boolean {
  try { return registrarErroWatcher(...args); } catch { return false; }
}

function observarSemDiagnostico(carregado: ManifestoCarregado, sessionId: string, opcoes: OpcoesObservacao): ResultadoWatcher {
  return observarSessaoResolvida(carregado, sessionId, resolverSessao(carregado.raiz, sessionId, opcoes.threadId), opcoes);
}

export function observarSessao(carregado: ManifestoCarregado, sessionId: string, opcoes: OpcoesObservacao = {}): ResultadoWatcher {
  let threadId = opcoes.threadId;
  try {
    const resolvida = resolverSessao(carregado.raiz, sessionId, threadId);
    // Recusa de entrada sem despacho não é falha de um watcher ancorado.
    threadId = resolvida.sessao.origem !== 'adocao' && resolvida.sessao.despachadaEm
      ? resolvida.thread.id : undefined;
    return observarSessaoResolvida(carregado, sessionId, resolvida, opcoes);
  } catch (e) {
    if (threadId) tentarRegistrarErroWatcher(carregado.raiz, threadId, sessionId, e);
    throw e;
  }
}

function observarSessaoResolvida(carregado: ManifestoCarregado, sessionId: string,
  { thread, sessao: registrada }: ReturnType<typeof resolverSessao>, opcoes: OpcoesObservacao): ResultadoWatcher {
  const sessao = exigirSessaoDespachada(registrada, sessionId);
  if (sessao.runtime !== 'codex' && sessao.runtime !== 'claude-bg') throw new Error('watch requer sessão Codex ou claude-bg registrada');
  const now = opcoes.agoraMs ?? Date.now();
  if (!Number.isFinite(now)) throw new Error('relógio inválido');
  const dir = dirThread(carregado.raiz, thread.id);
  const chave = createHash('sha256').update(sessionId + '|' + sessao.despachadaEm).digest('hex');
  const base: ResultadoWatcher = { sessionId, thread: thread.id, concluido: false, bytesLidos: 0 };
  const pasta = path.join(dir, 'sensores', chave);
  // Processo destacado não recria a thread de um projeto apagado: a pasta de sensores nasce
  // sem `recursive`, só dentro de uma thread presente, e a ausência encerra a observação.
  const removida: ResultadoWatcher = { ...base, encerrado: true, espera: THREAD_REMOVIDA };
  // GO-FIX 3 (achado 1): a thread pode sumir entre a checagem e a criação. O que esta observação
  // criou ou gravou numa thread que sumiu é desfeito, para um `rm -rf` concorrente não esbarrar
  // em `sensores/` recriado nem deixar cursor órfão.
  const criadas: string[] = [];
  const desfazer = (): ResultadoWatcher => { desfazerNaThreadRemovida(pasta, criadas); return removida; };
  try {
    if (!threadPresente(dir)) return removida;
    for (const nivel of [path.dirname(pasta), pasta]) {
      try { fs.mkdirSync(nivel); criadas.push(nivel); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    }
    if (!threadPresente(dir)) return desfazer();
    if (sessao.runtime === 'claude-bg') {
      const r = comLockWatcher(pasta, () => observarClaudeSobLock({ raiz: carregado.raiz,
        thread, sessao, dir, pasta, chave, agoraMs: now, limiteMs: LIMITE_MORTE_MS, consulta: opcoes.consultaClaude, carregado })) ?? { ...base, ocupado: true };
      return threadPresente(dir) ? r : desfazer();
    }
    return comLockWatcher(pasta, () => {
    const eventos = lerLedger(dir), resultadoId = `codex:${chave}`;
    const pronto = eventos.find(e => e.tipo === 'phase_result' && e.sensorResultId === resultadoId);
    if (pronto) return { ...base, concluido: true, classificacao: String(pronto.classificacao) };
    const registro = eventos.filter(e => e.tipo === 'session_sensor_registered' &&
      e.sessionId === sessionId && e.despachoEm === sessao.despachadaEm).at(-1) as (RegistroSensor & object) | undefined;
    if (registro) conferirRegistro(dir, registro);
    // I-33 (D4): o rollout mora no CODEX_HOME do perfil que despachou, nunca no do processo.
    const perfil = perfilDoRegistro(eventos, sessao);
    // Fonte do controller validada ANTES de ler rollout ou escrever cursor.
    let fonteControlador: FonteController | null = null, snapshot: SnapshotController | null = null;
    let cwdDespacho: string | undefined;
    if (registro?.controlador) {
      const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessionId).at(-1);
      if (despacho?.controlador !== undefined && despacho.controlador !== registro.controlador) throw new Error('controlador registrado divergente do despacho');
      const cwd = (despacho?.cwd ?? registro.cwd) as string | undefined;
      if (!cwd) throw new Error('despacho do controller sem cwd registrado');
      cwdDespacho = cwd;
      fonteControlador = registrarFonteController(registro.controlador, {
        dirSessoes: path.join(dir, 'sessoes'), sessionId, cwd, despachoEm: sessao.despachadaEm, agoraMs: now,
        fixacao: path.join(dir, 'sessoes', `watcher-source-${chave}.json`),
        vinculo: { thread: thread.id, fase: sessao.fase, promptSha256: sessao.promptSha256 } });
      // Relógio injetado vale como está; o real é lido pelo sensor depois do state.json.
      snapshot = lerSnapshotController(fonteControlador, opcoes.agoraMs === undefined ? {} : { agoraMs: now });
    }
    const file = path.join(pasta, 'cursor.json');
    const cursor = lerJson<Cursor>(file) ?? { schema: 'ork.session-cursor/v1', sessionId,
      despachoEm: sessao.despachadaEm, crescimentoEm: Date.parse(sessao.despachadaEm), heartbeatEm: 0, fontes: {} };
    if (cursor.schema !== 'ork.session-cursor/v1' || cursor.sessionId !== sessionId || cursor.despachoEm !== sessao.despachadaEm) throw new Error('cursor de outra sessão/despacho');
    // Cursor anterior media bytes, nao progresso: migracao conservadora desde o despacho.
    cursor.progressoEm ??= Date.parse(sessao.despachadaEm);
    // Transporte do controller não admite descoberta nem override de rollout.
    const fontes = { stream: registro?.logPath, rollout: snapshot ? snapshot.rollout
      : opcoes.rollout === undefined ? acharRollout(sessionId, 3, casaDoCodex(perfil)) : opcoes.rollout };
    let bytesLidos = 0, temMais = false, cresceu = false;
    for (const [nome, fonte] of Object.entries(fontes)) {
      if (!fonte || !fs.existsSync(fonte)) continue;
      let leitura;
      try { leitura = lerFonte(fonte, cursor.fontes[nome], opcoes.agoraMs === undefined ? undefined : now, sessionId, nome === 'rollout' ? fonteControlador ?? undefined : undefined); }
      catch (e) {
        if (nome !== 'rollout' || (e as Error).message !== 'log/rollout pertence a outra sessão') throw e;
        delete cursor.fontes[nome];
        if (!eventos.some(e => e.tipo === 'session_watcher_source_rejected' && e.sessionId === sessionId)) {
          registrar(dir, thread.id, 'session_watcher_source_rejected', { sessionId, despachoEm: sessao.despachadaEm,
            fase: sessao.fase, fonte: nome, motivo: 'identidade de sessão divergente' });
        }
        continue;
      }
      cursor.fontes[nome] = leitura.cursor; bytesLidos += leitura.bytes; temMais ||= leitura.temMais;
      if (leitura.cresceu) { cresceu = true; cursor.crescimentoEm = Math.max(cursor.crescimentoEm, leitura.quando);
        cursor.progressoEm = Math.max(cursor.progressoEm, leitura.quando); }
    }
    // Commit MCP é produção do núcleo, mesmo quando app-server não avança o rollout.
    // Só renova inatividade com ambos os processos vivos, dentro deste despacho e
    // sem terminal/erro nativo. Não substitui terminal, close ou prova de conclusão.
    let progressoMcpEventId: unknown;
    if (snapshot?.estadoController === 'vivo' && snapshot.estadoRuntime === 'vivo' &&
        ['working', 'running'].includes(snapshot.estado) && !snapshot.fechamento &&
        !snapshot.terminalNativo && !snapshot.erro && !snapshot.limitacao) {
      for (const e of eventosDoIntervalo(eventos, sessao)) {
        const quando = Date.parse(e.ts);
        if (e.tipo !== 'mcp_git_committed' || e.thread !== thread.id || e.origem !== 'mcp.git' ||
            e.estadoAuditado !== true || typeof e.commit !== 'string' || !/^[a-f0-9]{40}$/.test(e.commit) ||
            (e.sessionId !== undefined && e.sessionId !== sessionId) ||
            quando > now || quando <= cursor.progressoEm) continue;
        cresceu = true;
        cursor.crescimentoEm = Math.max(cursor.crescimentoEm, quando);
        cursor.progressoEm = quando;
        progressoMcpEventId = e.eventId;
      }
    }
    // Erro de metadados posterior não obriga a reler o mesmo backlog no restart.
    gravarAtomico(file, cursor);
    const processo = registro?.processoPath ? lerJson<ProcessoCodex>(registro.processoPath) : null;
    const recibo = registro?.reciboPath ? lerJson<ReciboCodex>(registro.reciboPath) : null;
    if (recibo && (!processo || recibo.schema !== 'ork.codex-process/v1' || recibo.iniciadoEm !== processo.iniciadoEm ||
        JSON.stringify(recibo.filho) !== JSON.stringify(processo.filho) ||
        !Number.isFinite(Date.parse(recibo.terminadoEm)) || Date.parse(recibo.terminadoEm) > now ||
        !Number.isFinite(recibo.duracaoMs) || recibo.duracaoMs < 0 ||
        (recibo.exitCode !== null && (!Number.isInteger(recibo.exitCode) || recibo.exitCode < 0)) ||
        (recibo.signal !== null && typeof recibo.signal !== 'string'))) throw new Error('recibo de processo inválido');
    // Fechamento normalizado: recibo do supervisor OU close real do controller, nunca ambos.
    const fechamento = snapshot?.fechamento
      ? { exitCode: snapshot.fechamento.exitCode, signal: snapshot.fechamento.signal,
          duracaoMs: snapshot.fechamento.duracaoMs, erro: null as string | null, fonte: 'controller.close' }
      : recibo ? { exitCode: recibo.exitCode, signal: recibo.signal, duracaoMs: recibo.duracaoMs,
          erro: recibo.erro, fonte: 'supervisor.close' } : null;
    const supervisionado = !!registro?.processoPath || !!snapshot;
    // Espera nativa autenticada e viva não é silêncio: não conta prazo nem termina o turno.
    const esperaHumana = snapshot?.esperaHumana ?? false;
    const estado = fechamento ? 'ausente' : snapshot ? snapshot.estadoRuntime : estadoProcesso(processo?.filho ?? null);
    const terminais = Object.entries(cursor.fontes).filter(([, f]) => f.terminal)
      .map(([nome, f]) => ({ nome, terminal: f.terminal! }));
    const ordem = { gate_blocked: 0, 'human.pending': 1, fase_concluida: 2 };
    terminais.sort((a, b) => {
      const x = a.terminal, y = b.terminal;
      // Observação de leitura não é timestamp do evento. Contagem só desempata
      // fontes sem timestamps comparáveis; severidade vale no mesmo turno.
      const tempo = x.timestampFonte === 'evento' && y.timestampFonte === 'evento'
        ? Date.parse(y.timestamp) - Date.parse(x.timestamp) : 0;
      return tempo || (y.numeroTurno ?? 0) - (x.numeroTurno ?? 0) ||
        ordem[x.classificacao] - ordem[y.classificacao] || a.nome.localeCompare(b.nome);
    });
    let terminal: TerminalCodex | undefined = terminais[0]?.terminal;
    const fontesAtuais = Object.values(cursor.fontes);
    const aberto = fontesAtuais.some(f => {
      if (!f.parser.turnoAberto) return false;
      if (!terminal) return true;
      if (f.parser.turnoIniciadoEm && terminal.timestampFonte === 'evento') {
        return Date.parse(f.parser.turnoIniciadoEm) > Date.parse(terminal.timestamp);
      }
      // Um terminal confirmado cobre a fonte atrasada ainda aberta no mesmo turno.
      return f.parser.turnos > (terminal.numeroTurno ?? 0);
    });
    const parcial = fontesAtuais.some(f => f.parcial);
    const backlog = fontesAtuais.some(f => f.tamanho > f.offset && !f.parcial);
    // Suspensao medida entre observacoes autenticadas; persiste no cursor para restart.
    if (esperaHumana) cursor.esperaDesde ??= now;
    else if (cursor.esperaDesde !== undefined) {
      cursor.progressoEm += Math.max(0, now - Math.max(cursor.esperaDesde, cursor.progressoEm));
      delete cursor.esperaDesde;
    }
    const estavel = !esperaHumana && now - cursor.progressoEm >= LIMITE_MORTE_MS;
    const semCloseNoLimite = supervisionado && !fechamento && estavel;
    const invalido = fontesAtuais.some(f => f.parser.invalido);
    // Conclusão nativa é medida em todo terminal, independente da política de retry:
    // bloqueio sem retry preserva o motivo, mas não prova que o turno do runtime terminou.
    const provaNativa = snapshot && terminal
      ? semProvaNativa(snapshot, terminal, terminais[0]?.nome, fechamento, sessionId, cwdDespacho as string)
      : 'terminal nativo do controller ausente';
    // Parecer negativo também exige conclusão nativa inteira: texto claims.failed de
    // turno interrompido não pode virar rejeição autenticada de um objetivo.
    const semProva = snapshot && terminal && terminal.classificacao !== 'human.pending' && !bloqueioPreservado(terminal)
      ? provaNativa : null;
    const descorrelacionado = !!semProva;
    const incompleto = semCloseNoLimite && (!!terminal || estado !== 'ausente' || aberto || parcial || invalido) || !backlog && (((parcial || aberto || invalido || descorrelacionado || !terminal) && !!fechamento) ||
      (estavel && (parcial || (aberto && estado === 'ausente') ||
        (supervisionado && estado === 'desconhecido'))));
    const morte = estado === 'ausente' && estavel && !temMais;
    // Fechamento supervisionado precisa existir antes de associar o código de saída ao turno.
    const podeTerminar = !esperaHumana && (incompleto || (!temMais && !aberto &&
      ((terminal && (fechamento || !supervisionado)) || morte)));
    const conta = falhaDeContaDoTerminal(terminal, !invalido && !aberto, snapshot, now);
    gravarAtomico(file, cursor);
    return comLockDeSessao(dir, () => {
      const atuais = lerLedger(dir);
      if (cresceu && cursor.crescimentoEm > cursor.heartbeatEm) {
        const heartbeatId = `${resultadoId}:heartbeat:${cursor.crescimentoEm}`;
        if (!atuais.some(e => e.sensorEventId === heartbeatId)) registrar(dir, thread.id, 'runtime_heartbeat', {
          ts: new Date(cursor.crescimentoEm).toISOString(), fase: sessao.fase, sessionId, despachoEm: sessao.despachadaEm,
          sensorEventId: heartbeatId, fonte: progressoMcpEventId ? 'mcp_git_committed do despacho' : 'progresso reconhecido do stream/rollout',
          ...(progressoMcpEventId ? { mcpEventId: progressoMcpEventId } : {}), bytesLidos,
        });
        cursor.heartbeatEm = cursor.crescimentoEm; gravarAtomico(file, cursor);
      }
      if (!podeTerminar) return { ...base, bytesLidos };
      const semTerminal = !terminal;
      // Fato registrado para a autoridade de revisão: `null` só com terminal nativo correlacionado.
      const conclusaoNativa = incompleto || invalido || aberto || descorrelacionado
        ? provaNativa ?? 'observação incompleta ou inválida' : provaNativa;
      if (incompleto || invalido || aberto || descorrelacionado) terminal = { classificacao: 'gate_blocked', motivo: 'runtime.unavailable',
        timestamp: new Date(now).toISOString(), turnId: null, fonte: semProva ?? 'observação incompleta ou inválida',
        tokens: new ParserCodex().estado.tokens, duracaoMs: null };
      if (!terminal) terminal = { classificacao: 'gate_blocked', motivo: 'runtime.silencio',
        timestamp: new Date(now).toISOString(), turnId: null, fonte: 'processo ausente e arquivos estáveis',
        tokens: new ParserCodex().estado.tokens, duracaoMs: null };
      if (fechamento && (fechamento.exitCode !== 0 || fechamento.signal || fechamento.erro) &&
          terminal.classificacao !== 'human.pending' && !bloqueioPreservado(terminal)) {
        terminal = { ...terminal, classificacao: 'gate_blocked', motivo: 'runtime.unavailable' };
      }
      // I-33 (D12): o turno terminou pela CONTA (cota, credito ou login), dito pelo proprio runtime.
      // E bloqueio, nunca conclusao; a D11c decide no retry se houve producao antes da morte.
      if (conta) terminal = { ...terminal, classificacao: 'gate_blocked', motivo: conta.falha.motivo, falhaDeConta: conta.falha,
        fonte: `${conta.fonte}: ${conta.falha.motivo} (${conta.falha.trecho})` };
      const dados = { fase: sessao.fase, sessionId, despachoEm: sessao.despachadaEm, sensorResultId: resultadoId,
        classificacao: terminal.classificacao, motivo: terminal.motivo, runtime: 'codex', fonte: terminal.fonte,
        fonteVencedora: incompleto || invalido || aberto || descorrelacionado ? null : terminais[0]?.nome ?? null,
        turnId: terminal.turnId, numeroTurno: terminal.numeroTurno ?? null,
        tokens: terminal.tokens, exitCode: fechamento?.exitCode ?? null, exitCodeFonte: fechamento?.fonte ?? 'unavailable',
        signal: fechamento?.signal ?? null, duracaoMs: fechamento?.duracaoMs ?? terminal.duracaoMs,
        duracaoFonte: fechamento?.fonte ?? (terminal.duracaoMs === null ? 'unavailable' : terminal.fonte),
        ok: terminal.classificacao === 'fase_concluida' && fechamento?.exitCode === 0,
        conclusaoNativa: conclusaoNativa === null,
        conclusaoNativaAusente: conclusaoNativa,
        estado: terminal.classificacao === 'fase_concluida' ? 'concluida' : 'bloqueada',
        observadoEm: terminal.timestamp, gate: 'phase.dispatch', origem: 'sessions.watch',
        morteLatenciaMs: morte ? now - cursor.progressoEm! : null, ...(perfil ? { perfil } : {}),
        ...(conta ? { falhaDeConta: { motivo: conta.falha.motivo, resetEm: conta.falha.resetEm, fonte: conta.falha.fonte,
          trecho: conta.falha.trecho } } : {}) };
      const tipo = semTerminal && morte && !incompleto && !conta ? 'sessao_morta' : terminal.classificacao;
      // I-33 (D12): o perfil sai do rodizio na primeira gravacao do resultado, onde a evidencia esta.
      if (conta && perfil && !atuais.some(e => e.tipo === 'phase_result' && e.sensorResultId === resultadoId)) {
        try { marcarContaDaFalha(carregado, perfil, conta.falha, now); }
        catch { /* store ocupado ou invalido: o retry marca de novo pelo gate tipado */ }
      }
      if (!atuais.some(e => e.tipo === tipo && e.sensorResultId === resultadoId)) registrar(dir, thread.id, tipo, dados);
      if (terminal.classificacao !== 'fase_concluida' && tipo !== 'gate_blocked' &&
          !atuais.some(e => e.tipo === 'gate_blocked' && e.sensorResultId === resultadoId)) registrar(dir, thread.id, 'gate_blocked', dados);
      if (!atuais.some(e => e.tipo === 'phase_result' && e.sensorResultId === resultadoId)) registrar(dir, thread.id, 'phase_result', dados);
      return { ...base, bytesLidos, concluido: true, classificacao: terminal.classificacao };
    });
  }) ?? { ...base, ocupado: true }; }
  catch (e) {
    // Thread apagada no meio da observação: encerra sem erro, sem recriar a pasta e sem resíduo.
    if (!threadPresente(dir)) return desfazer();
    throw e;
  }
}

/** Valida a fonte antes de registro, stderr ou spawn; tambem usada na recuperacao. */
export function validarFonteWatcher(raiz: string, sessionId: string, fonte?: RegistroSensor): void {
  const { thread, sessao: registrada } = resolverSessao(raiz, sessionId);
  const sessao = exigirSessaoDespachada(registrada, sessionId);
  const dir = dirThread(raiz, thread.id);
  const eventos = lerLedger(dir);
  const registro = fonte ?? eventos.filter(e => e.tipo === 'session_sensor_registered' &&
    e.sessionId === sessionId && e.despachoEm === sessao.despachadaEm).at(-1) as RegistroSensor | undefined;
  if (!registro) throw new Error('fonte de sensor ausente');
  conferirRegistro(dir, registro);
  // I-33 (D4): perfil invalido ou divergente do despacho reprova antes de observar pela conta errada.
  perfilDoRegistro([...eventos, ...(fonte ? [{ tipo: 'session_sensor_registered', sessionId,
    despachoEm: sessao.despachadaEm, ...fonte }] : [])], sessao);
  if (registro.nativo !== undefined) {
    if (sessao.runtime !== 'claude-bg') throw new Error('fonte nativa claude-agents em sessão de outro runtime');
    validarFonteClaude(eventos, sessionId, registro as Parameters<typeof validarFonteClaude>[2]);
    return;
  }
  if (registro.controlador) {
    const despacho = eventos.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === sessionId).at(-1);
    if (despacho?.controlador !== undefined && despacho.controlador !== registro.controlador)
      throw new Error('controlador registrado divergente do despacho');
    const cwd = (despacho?.cwd ?? registro.cwd) as string | undefined;
    if (!cwd) throw new Error('despacho do controller sem cwd registrado');
    const chave = createHash('sha256').update(sessionId + '|' + sessao.despachadaEm).digest('hex');
    const fixada = registrarFonteController(registro.controlador, { dirSessoes: path.join(dir, 'sessoes'),
      fixacao: path.join(dir, 'sessoes', `watcher-source-${chave}.json`),
      sessionId, cwd, despachoEm: sessao.despachadaEm,
      vinculo: { thread: thread.id, fase: sessao.fase, promptSha256: sessao.promptSha256 } });
    lerSnapshotController(fixada);
  }
}

export function iniciarWatcher(raiz: string, sessionId: string): number {
  const { thread, sessao: registrada } = resolverSessao(raiz, sessionId);
  const sessao = exigirSessaoDespachada(registrada, sessionId);
  const dir = dirThread(raiz, thread.id);
  // I-34: sessão claude-bg despachada antes do registro nativo ganha a fonte derivada do despacho.
  if (sessao.runtime === 'claude-bg') garantirFonteClaude(raiz, thread, sessao);
  validarFonteWatcher(raiz, sessionId);
  const anterior = lerLedger(dir).filter(e => e.tipo === 'session_watcher_started' &&
    e.sessionId === sessionId && e.despachoEm === sessao.despachadaEm).at(-1);
  const identidadeAnterior = anterior?.identidade as IdentidadeProcesso | undefined;
  if (identidadeAnterior && anterior?.pid === identidadeAnterior.pid && estadoProcesso(identidadeAnterior) === 'vivo')
    return identidadeAnterior.pid;
  const token = randomUUID();
  const readyPath = path.join(dir, `watcher-${sessionId}-${token}.ready.json`);
  const ackPath = readyPath + '.ack';
  const err = fs.openSync(path.join(dir, `watcher-${sessionId}.stderr`), 'a', 0o600);
  let child;
  try { child = spawn(process.execPath, [__filename, '--run', raiz, sessionId, readyPath, token, thread.id], {
    cwd: raiz, detached: true, stdio: ['ignore', 'ignore', err],
  }); } finally { fs.closeSync(err); }
  let erroRegistrado = false;
  const falha = () => {
    if (erroRegistrado) return;
    erroRegistrado = true;
    registrar(dir, thread.id, 'session_watcher_error', { sessionId, despachoEm: sessao.despachadaEm,
      fase: sessao.fase, motivo: 'runtime.unavailable', erro: 'falha ao confirmar prontidao do watcher',
      origem: 'sessions.watch' });
  };
  child.on('error', falha);
  child.unref();
  const identidade = child.pid ? identidadeProcesso(child.pid) : null;
  try {
    if (!identidade) throw new Error('watcher sem identidade de processo');
    const deadline = Date.now() + 5000;
    const pausa = new Int32Array(new SharedArrayBuffer(4));
    while (Date.now() < deadline) {
      const ready = lerJson<{ token: string; sessionId: string; despachoEm: string; identidade: IdentidadeProcesso }>(readyPath);
      if (ready && ready.token === token && ready.sessionId === sessionId && ready.despachoEm === sessao.despachadaEm &&
          JSON.stringify(ready.identidade) === JSON.stringify(identidade) && estadoProcesso(identidade) === 'vivo') {
        registrar(dir, thread.id, 'session_watcher_started', { fase: sessao.fase, sessionId,
          despachoEm: sessao.despachadaEm, pid: identidade.pid, identidade, readyPath, token });
        gravarAtomico(ackPath, { token });
        return identidade.pid;
      }
      if (estadoProcesso(identidade) === 'ausente') break;
      Atomics.wait(pausa, 0, 0, 10);
    }
    throw new Error('watcher sem prontidao confirmada');
  } catch (e) {
    falha();
    // Encerrar apenas o filho cuja identidade continua sendo a capturada no spawn.
    if (identidade && estadoProcesso(identidade) === 'vivo') child.kill('SIGTERM');
    throw e;
  }
}
async function acompanhar(): Promise<void> {
  const carregado = exigirManifesto(process.argv[3]), sessionId = process.argv[4];
  const threadId = process.argv[7] ?? resolverSessao(carregado.raiz, sessionId).thread.id;
  try {
    const readyPath = process.argv[5], token = process.argv[6];
    if (readyPath && token) {
      validarFonteWatcher(carregado.raiz, sessionId);
      const sessao = exigirSessaoDespachada(resolverSessao(carregado.raiz, sessionId, threadId).sessao, sessionId);
      const identidade = identidadeProcesso(process.pid);
      if (!identidade) throw new Error('watcher sem identidade propria');
      gravarAtomico(readyPath, { token, sessionId, despachoEm: sessao.despachadaEm, identidade });
      const deadline = Date.now() + 5000;
      while (lerJson<{ token: string }>(readyPath + '.ack')?.token !== token) {
        if (Date.now() >= deadline) throw new Error('watcher sem confirmacao do pai');
        await new Promise(r => setTimeout(r, 10));
      }
    }
    await acompanharSessao(carregado, sessionId, { threadId });
  } catch (e) {
    tentarRegistrarErroWatcher(carregado.raiz, threadId, sessionId, e);
    throw e;
  }
}

/** Mesmo laço do processo destacado, com relógio e espera injetáveis para regressões. */
export async function acompanharSessao(carregado: ManifestoCarregado, sessionId: string, opcoes: {
  threadId: string; agora?: () => number; esperar?: (ms: number) => Promise<void>;
}): Promise<void> {
  const dir = dirThread(carregado.raiz, opcoes.threadId);
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const agora = opcoes.agora ?? Date.now;
  let falhas = 0, ultimaObservacao = agora(), ultimoErro: unknown;
  for (;;) {
    // Projeto ou thread apagados encerram o laço em silêncio: nada a observar nem a recriar.
    if (!threadPresente(dir)) return;
    let atual: ReturnType<typeof lerThread> | undefined;
    try {
      atual = lerThread(carregado.raiz, opcoes.threadId);
      if (atual.status !== 'aberta' || atual.sessoes.at(-1)?.sessionId !== sessionId) return;
      // O laço agrega sua série de erros; a API de observação avulsa diagnostica separadamente.
      const r = observarSemDiagnostico(carregado, sessionId, { threadId: opcoes.threadId, agoraMs: opcoes.agora?.() });
      if (r.ocupado) throw new Error('ingestão ocupada; tente novamente');
      if (!r.ocupado) {
        if (falhas) tentarRegistrarErroWatcher(carregado.raiz, opcoes.threadId, sessionId, ultimoErro,
          { falhasConsecutivas: falhas, etapa: 'final', encerramento: 'recuperado' });
        falhas = 0;
        ultimaObservacao = agora();
      }
      if (r.concluido || r.encerrado) return;
    } catch (e) {
      if (!threadPresente(dir)) return;
      falhas++;
      ultimoErro = e;
      const encerramento = !diagnosticoWatcher(e).transitorio ? 'permanente'
        : agora() - ultimaObservacao >= LIMITE_MORTE_MS ? 'prazo'
        : falhas >= MAX_FALHAS_WATCH ? 'tentativas' : undefined;
      if (falhas === 1 || encerramento) tentarRegistrarErroWatcher(carregado.raiz, opcoes.threadId, sessionId, e,
        { falhasConsecutivas: falhas, etapa: encerramento ? 'final' : 'inicial', ...(encerramento ? { encerramento } : {}) });
      if (encerramento) throw e;
    }
    await esperar(falhas ? Math.min(MAX_ESPERA_ERRO_WATCH_MS, INTERVALO_WATCH_MS * 2 ** Math.min(falhas - 1, 5))
      : atual?.sessoes.at(-1)?.runtime === 'claude-bg' ? INTERVALO_WATCH_CLAUDE_MS : INTERVALO_WATCH_MS);
  }
}
if (require.main === module && process.argv[2] === '--run') acompanhar().catch(e => {
  // O dispatcher fornece o vínculo antes do spawn: até falha ao carregar o manifesto
  // precisa de diagnóstico. Sem ledger acessível, o stderr não promete um recibo inexistente.
  let registroIndisponivel = !process.argv[7];
  if (process.argv[7]) {
    try { registroIndisponivel = !registrarErroWatcher(process.argv[3], process.argv[7], process.argv[4], e); }
    catch { registroIndisponivel = true; }
  }
  process.stderr.write(registroIndisponivel
    ? 'ork watcher: observação interrompida; não foi possível registrar session_watcher_error.\n'
    : 'ork watcher: observação interrompida; confira session_watcher_error e estado canônico.\n');
  process.exitCode = 1;
});
