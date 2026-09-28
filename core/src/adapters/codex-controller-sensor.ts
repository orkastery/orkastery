/** D1/D2: leitor validado da fonte do controller. Sem RPC, resposta, sinal ou resume. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ErroNativoDoTurno, erroNativoValido, EstadoController, IdentidadeProcesso, VinculoController } from './codex-controller';

export const LIMITE_METADADO_BYTES = 65536;
const MODO_METADADO = 0o600;
const UUID = /^[a-f0-9-]{36}$/;

export interface EsperadoController {
  /** `<dirThread>/sessoes`: único domicílio permitido para a fonte. */
  dirSessoes: string;
  vinculo: VinculoController;
  sessionId: string;
  /** cwd do despacho, o mesmo confirmado por `thread/start` e `thread/read`. */
  cwd: string;
  despachoEm: string;
  agoraMs?: number;
  /** Arquivo privado onde a fonte validada e fixada; releituras reconferem contra ele. */
  fixacao?: string;
  /** uid autenticado esperado; só os testes trocam o padrão para provar a conferência. */
  uid?: number;
}
export interface FonteController {
  contrato: 'ork.controller-launch/v1';
  dir: string; instancia: string; vinculo: VinculoController; cwd: string;
  sessionId: string; rollout: string; rolloutIno: number; rolloutDev: number; criadoEm: string;
  processoController: IdentidadeProcesso | null;
  processoRuntime: IdentidadeProcesso | null;
  uid: number;
}
export interface FechamentoController {
  em: string; exitCode: number | null; signal: string | null;
  duracaoMs: number; fonte: 'controller.close';
}
export interface TerminalNativoController {
  metodo: 'turn/completed'; threadId: string; turnId: string; status: string;
  /** I-33 (D12): erro nativo do turno `failed`, quando o app-server o informou. */
  erro?: ErroNativoDoTurno;
}
export interface SnapshotController {
  fonte: FonteController; estado: string; turno: string | null;
  rollout: string; terminalNativo: TerminalNativoController | null;
  /** Erro e limitacao tipada do proprio estado nativo: qualquer um impede sucesso. */
  erro: string | null;
  limitacao: { motivo: 'runtime.unavailable'; codigo: string; metodo: string } | null;
  /** Espera nativa autenticada e viva: nunca terminal, mesmo além do limite I04. */
  esperaHumana: boolean;
  fechamento: FechamentoController | null;
  exitCode: number | null;
  exitCodeFonte: 'controller.close' | 'unavailable';
  estadoController: 'vivo' | 'ausente' | 'desconhecido';
  estadoRuntime: 'vivo' | 'ausente' | 'desconhecido';
}

const recusar = (motivo: string): never => { throw new Error('runtime.unavailable: ' + motivo); };
const uidAtual = (): number => process.getuid?.() ?? -1;

/** Diretório canônico, ancestrais sem link nem escrita alheia, fonte 0700 do uid autenticado. */
function conferirDiretorioDaFonte(dir: string, dirSessoes: string, uid: number): string {
  const raiz = fs.realpathSync(dirSessoes);
  if (fs.lstatSync(dir).isSymbolicLink()) recusar('fonte de controller acessada por link');
  const real = fs.realpathSync(dir);
  if (real !== dir) recusar('fonte de controller fora do caminho real registrado');
  if (!real.startsWith(raiz + path.sep)) recusar('fonte de controller fora do diretório canônico de sessões');
  for (let atual = real; ; atual = path.dirname(atual)) {
    const st = fs.lstatSync(atual);
    if (!st.isDirectory() || st.isSymbolicLink()) recusar('ancestral da fonte de controller não é diretório próprio');
    if (st.uid !== uid) recusar('ancestral da fonte de controller de outro uid');
    if (atual === real ? (st.mode & 0o077) !== 0 : (st.mode & 0o022) !== 0) recusar('ancestral da fonte de controller com permissão alheia');
    if (atual === raiz) break;
    if (atual === path.dirname(atual)) recusar('ancestral da fonte de controller sem raiz canônica');
  }
  return real;
}

/** Abre sem seguir link, confere descritor/inode, modo, dono e limite antes de decodificar. */
function lerMetadado(dir: string, nome: string, uid: number, obrigatorio = true): Record<string, any> | null {
  const file = path.join(dir, nome);
  let antes: fs.Stats;
  try { antes = fs.lstatSync(file); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !obrigatorio) return null;
    return recusar(`metadado ${nome} de controller ausente`);
  }
  if (!antes.isFile() || antes.isSymbolicLink()) recusar(`metadado ${nome} de controller não é arquivo regular`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.ino !== antes.ino || st.dev !== antes.dev) recusar(`descritor de ${nome} divergente do inode conferido`);
    if (st.uid !== uid) recusar(`metadado ${nome} de controller de outro uid`);
    if ((st.mode & 0o777) !== MODO_METADADO) recusar(`metadado ${nome} de controller não é privado 0600`);
    if (st.size > LIMITE_METADADO_BYTES) recusar(`metadado ${nome} de controller excessivo`);
    const buffer = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buffer, 0, st.size, 0);
    // Nenhuma mensagem carrega o conteúdo lido, nem o recorte do SyntaxError.
    try { return JSON.parse(buffer.subarray(0, n).toString('utf8')) as Record<string, any>; }
    catch { return recusar(`metadado ${nome} de controller inválido`); }
  } finally { fs.closeSync(fd); }
}

function mesmoVinculo(a: unknown, b: VinculoController): boolean {
  const v = a as VinculoController | undefined;
  return !!v && v.thread === b.thread && v.fase === b.fase && v.promptSha256 === b.promptSha256 &&
    Object.keys(v).length === 3;
}
function mesmaIdentidade(a: IdentidadeProcesso | null, b: IdentidadeProcesso | null): boolean {
  if (!a || !b) return a === undefined || b === undefined ? false : a === b;
  return a.pid === b.pid && a.uid === b.uid && a.inicio === b.inicio && a.bootId === b.bootId &&
    a.executavel === b.executavel && a.cwd === b.cwd;
}
function identidadeValida(p: unknown, uid: number): IdentidadeProcesso | null {
  if (p === undefined || p === null) return null;
  const i = p as IdentidadeProcesso;
  if (!Number.isSafeInteger(i.pid) || i.pid <= 0 || i.uid !== uid || !/^\d+$/.test(String(i.inicio)) ||
      typeof i.bootId !== 'string' || !i.bootId || typeof i.executavel !== 'string' || typeof i.cwd !== 'string') {
    return recusar('identidade de processo do controller inválida');
  }
  return i;
}
/**
 * Identidade viva é reconferida contra o `/proc` real; processo já morto conserva a
 * identidade capturada no spawn e nunca é redescoberto por PID.
 */
function conferirIdentidadeViva(p: IdentidadeProcesso | null, papel: string): 'vivo' | 'ausente' | 'desconhecido' {
  const estado = estadoDoProcesso(p);
  if (!p || estado !== 'vivo') return estado;
  let executavel: string, cwd: string;
  try { executavel = fs.readlinkSync(`/proc/${p.pid}/exe`); cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`); }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'ausente' : 'desconhecido'; }
  if (executavel !== p.executavel) recusar(`executável real do ${papel} divergente do capturado`);
  if (cwd !== p.cwd) recusar(`cwd real do ${papel} divergente do capturado`);
  return 'vivo';
}
/** PID sozinho não autentica: exige boot, starttime, uid e ausência de zumbi. */
function estadoDoProcesso(p: IdentidadeProcesso | null): 'vivo' | 'ausente' | 'desconhecido' {
  if (!p) return 'desconhecido';
  try {
    const st = fs.readFileSync(`/proc/${p.pid}/stat`, 'utf8');
    const campos = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (boot !== p.bootId || campos[19] !== p.inicio || campos[0] === 'Z') return 'ausente';
    return fs.statSync(`/proc/${p.pid}`).uid === p.uid ? 'vivo' : 'ausente';
  } catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'ausente' : 'desconhecido'; }
}
interface RolloutFixado { file: string; ino: number; dev: number }

/** Cabeçalho do rollout: identidade da sessão e cwd nativo são obrigatórios. */
function conferirSessionMeta(fd: number, tamanho: number, sessionId: string, cwd: string): void {
  const buffer = Buffer.alloc(Math.min(LIMITE_METADADO_BYTES, tamanho));
  const n = fs.readSync(fd, buffer, 0, buffer.length, 0);
  const fim = buffer.subarray(0, n).lastIndexOf(10);
  if (fim < 0) recusar('rollout do controller sem session_meta conferível');
  for (const linha of buffer.subarray(0, fim + 1).toString('utf8').split('\n')) {
    let e: any;
    try { e = JSON.parse(linha); } catch { continue; }
    if (!e || e.type !== 'session_meta') continue;
    if (e.payload?.id !== sessionId) recusar('session_meta do rollout de outra sessão');
    if (e.payload?.cwd !== cwd) recusar('session_meta do rollout com cwd divergente do despacho');
    return;
  }
  recusar('rollout do controller sem session_meta conferível');
}

/**
 * Abre o rollout sem seguir links e reconfere o descritor contra o inode observado.
 * Não há atomicidade contra troca entre lstat e open: a garantia é a reconferência do
 * descritor aberto e do vínculo com a fonte fixada, com recusa quando a prova não se sustenta.
 */
function conferirFonteDeRollout(rollout: unknown, uid: number, sessionId: string, cwd: string,
    fixado?: RolloutFixado): RolloutFixado {
  if (typeof rollout !== 'string' || !rollout || !path.isAbsolute(rollout)) recusar('rollout do controller não confirmado');
  const file = rollout as string;
  if (fixado && file !== fixado.file) recusar('rollout do controller divergente do registrado');
  const antes = fs.lstatSync(file, { throwIfNoEntry: false });
  // Fonte ausente nunca autentica nada: o terminal em cache deixa de valer com ela.
  if (!antes) return recusar('rollout do controller ausente');
  if (!antes.isFile() || antes.isSymbolicLink()) recusar('rollout do controller não é arquivo regular');
  if (fs.realpathSync(file) !== file) recusar('rollout do controller acessado por ancestral link');
  const pai = fs.lstatSync(path.dirname(file));
  if (!pai.isDirectory() || pai.uid !== uid || (pai.mode & 0o022) !== 0) recusar('diretório do rollout do controller com permissão alheia');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.ino !== antes.ino || st.dev !== antes.dev) recusar('descritor de rollout divergente do inode conferido');
    if (st.uid !== uid) recusar('rollout do controller de outro uid');
    if ((st.mode & 0o022) !== 0) recusar('rollout do controller com permissão de escrita alheia');
    // Rotação não é permitida neste transporte: sem regra de vínculo com a fonte anterior, recusa.
    if (fixado && (st.ino !== fixado.ino || st.dev !== fixado.dev)) recusar('rollout do controller rotacionado sem vínculo provado com a fonte fixada');
    conferirSessionMeta(fd, st.size, sessionId, cwd);
    return { file, ino: st.ino, dev: st.dev };
  } finally { fs.closeSync(fd); }
}

/**
 * Fixacao privada da fonte: escrita uma unica vez, antes de qualquer efeito de observacao,
 * e reconferida em cada poll e em cada restart do observador. Sem redescoberta de processo.
 */
export const CONTRATO_FIXACAO = 'ork.controller-source-pin/v1';

function persistirFonte(file: string, fonte: FonteController): void {
  const parcial = `${file}.${process.pid}.parcial`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(parcial, { force: true });
  fs.writeFileSync(parcial, JSON.stringify({ contratoFixacao: CONTRATO_FIXACAO, ...fonte }), { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(parcial, file); } catch (e) { fs.rmSync(parcial, { force: true }); throw e; }
}

/** Devolve a fonte ja fixada, ou `null` quando ainda nao existe fixacao para este despacho. */
function lerFonteFixada(file: string, esperado: EsperadoController, uid: number): FonteController | null {
  const bruto = lerMetadado(path.dirname(file), path.basename(file), uid, false);
  if (!bruto) return null;
  if (bruto.contratoFixacao !== CONTRATO_FIXACAO) recusar('fixacao da fonte de controller com contrato divergente');
  const f = bruto as unknown as FonteController;
  if (f.contrato !== 'ork.controller-launch/v1' || typeof f.dir !== 'string' || typeof f.instancia !== 'string' ||
      typeof f.rollout !== 'string' || !Number.isSafeInteger(f.rolloutIno) || !Number.isSafeInteger(f.rolloutDev) ||
      typeof f.criadoEm !== 'string' || f.uid !== uid) recusar('fixacao da fonte de controller invalida');
  if (!mesmoVinculo(f.vinculo, esperado.vinculo)) recusar('vinculo da fixacao divergente do despacho');
  if (f.sessionId !== esperado.sessionId) recusar('sessao da fixacao divergente do despacho');
  if (f.cwd !== esperado.cwd) recusar('cwd da fixacao divergente do despacho');
  // Identidades vem da fixacao, nunca de nova descoberta por PID.
  const controlador = identidadeValida(f.processoController, uid);
  const runtime = identidadeValida(f.processoRuntime, uid);
  if (!controlador || !runtime) recusar('fixacao da fonte de controller sem identidade capturada');
  return { contrato: 'ork.controller-launch/v1', dir: f.dir, instancia: f.instancia, vinculo: esperado.vinculo,
    cwd: esperado.cwd, sessionId: esperado.sessionId, rollout: f.rollout, rolloutIno: f.rolloutIno,
    rolloutDev: f.rolloutDev, criadoEm: f.criadoEm, processoController: controlador, processoRuntime: runtime, uid };
}

/**
 * Espera humana so suspende o prazo com o tuple nativo completo: thread, turno, `requestId`
 * inclusive o numero `0`, item e hash iguais aos da pergunta projetada.
 */
function esperaAutenticada(estado: EstadoController, fonte: FonteController): boolean {
  if (estado.estado !== 'blocked' || typeof estado.bloqueio !== 'string') return false;
  const pergunta = estado.perguntaNativa as { sha256?: unknown } | undefined;
  if (!pergunta || typeof pergunta.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pergunta.sha256)) return false;
  let tuple: unknown;
  try { tuple = JSON.parse(estado.bloqueio); } catch { return false; }
  if (!Array.isArray(tuple) || tuple.length !== 4) return false;
  const [turno, requestId, item, hash] = tuple as unknown[];
  // `requestId` 0 e um id valido: so a ausencia de numero inteiro recusa a excecao.
  if (typeof turno !== 'string' || !turno || turno !== (estado.turno ?? null)) return false;
  if (!Number.isInteger(requestId as number) || (requestId as number) < 0) return false;
  if (typeof item !== 'string' || !item) return false;
  if (hash !== pergunta.sha256) return false;
  return estado.sessionId === fonte.sessionId;
}

function conferirEstado(bruto: Record<string, any>, esperado: {
  instancia: string; vinculo: VinculoController; cwd: string; sessionId: string;
}): EstadoController {
  const s = bruto as EstadoController;
  if (s.instancia !== esperado.instancia) recusar('instância do controller divergente');
  if (!mesmoVinculo(s.vinculo, esperado.vinculo)) recusar('vínculo thread/fase/prompt do controller divergente');
  if (s.cwd !== esperado.cwd) recusar('cwd do controller divergente');
  if (s.sessionId !== esperado.sessionId) recusar('sessão do controller divergente');
  if (typeof s.estado !== 'string' || !s.estado) recusar('estado do controller ausente');
  return s;
}

/**
 * Registra a fonte de um despacho já concluído, ANTES de qualquer efeito de observação.
 * Fixa identidades e rollout; toda leitura posterior reconfere os mesmos valores.
 */
export function registrarFonteController(dir: string, esperado: EsperadoController): FonteController {
  const uid = esperado.uid ?? uidAtual();
  const agora = esperado.agoraMs ?? Date.now();
  const despachoMs = Date.parse(esperado.despachoEm);
  if (!Number.isFinite(despachoMs)) recusar('despacho sem carimbo de tempo válido');
  const real = conferirDiretorioDaFonte(dir, esperado.dirSessoes, uid);
  // Fonte já fixada: poll e restart reconferem a mesma fixação, sem redescoberta.
  const fixada = esperado.fixacao ? lerFonteFixada(esperado.fixacao, esperado, uid) : null;
  if (fixada) {
    if (fixada.dir !== real) recusar('fonte de controller divergente da fixada');
    return fixada;
  }
  const launch = lerMetadado(real, 'launch.json', uid)!;
  if (launch.contrato !== 'ork.controller-launch/v1') recusar('contrato de launch do controller divergente');
  if (typeof launch.instancia !== 'string' || !UUID.test(launch.instancia)) recusar('instância de launch do controller inválida');
  if (!mesmoVinculo(launch.vinculo, esperado.vinculo)) recusar('vínculo thread/fase/prompt do launch divergente');
  if (launch.cwd !== esperado.cwd) recusar('cwd do launch divergente');
  const criadoMs = Date.parse(String(launch.criadoEm));
  if (!Number.isFinite(criadoMs) || criadoMs > despachoMs || criadoMs > agora) recusar('launch do controller fora da janela do despacho');
  // `process-launch` é obrigatório: sem a identidade capturada no spawn não há o que autenticar.
  const processo = lerMetadado(real, 'process-launch.json', uid)!;
  const estado = conferirEstado(lerMetadado(real, 'state.json', uid)!, {
    instancia: launch.instancia, vinculo: esperado.vinculo, cwd: esperado.cwd, sessionId: esperado.sessionId,
  });
  const processoController = identidadeValida(estado.processoController, uid);
  const processoRuntime = identidadeValida(estado.processoRuntime, uid);
  if (!processoController) recusar('identidade do controller ausente na fonte');
  if (!processoRuntime) recusar('identidade do runtime ausente na fonte');
  if (processo.instancia !== launch.instancia) recusar('instância do process-launch divergente');
  if (!Number.isSafeInteger(processo.pid) || processo.pid <= 0 || processo.pid !== estado.pid) recusar('pid do process-launch divergente do estado');
  const capturado = identidadeValida(processo.processoController, uid);
  if (!capturado) recusar('identidade capturada no spawn ausente no process-launch');
  if (!mesmaIdentidade(capturado, processoController)) recusar('identidade do controller divergente do spawn');
  if (processoController!.pid !== estado.pid) recusar('identidade do controller não corresponde ao pid do estado');
  // O worker nasce no diretório de IPC e o runtime no cwd do despacho: identidade capturada prova os dois.
  if (processoController!.cwd !== real) recusar('cwd do controller divergente do IPC');
  if (processoRuntime!.cwd !== esperado.cwd) recusar('cwd do runtime divergente do despacho');
  conferirIdentidadeViva(processoController, 'controller');
  conferirIdentidadeViva(processoRuntime, 'runtime');
  const rollout = conferirFonteDeRollout(estado.rollout, uid, esperado.sessionId, esperado.cwd);
  const fonte: FonteController = { contrato: 'ork.controller-launch/v1', dir: real, instancia: launch.instancia,
    vinculo: esperado.vinculo, cwd: esperado.cwd, sessionId: esperado.sessionId, rollout: rollout.file,
    rolloutIno: rollout.ino, rolloutDev: rollout.dev, criadoEm: new Date(criadoMs).toISOString(),
    processoController, processoRuntime, uid };
  // Fixação persistida ANTES de devolver a fonte, logo antes de qualquer efeito de observação.
  if (esperado.fixacao) persistirFonte(esperado.fixacao, fonte);
  return fonte;
}

/** Releitura da fonte fixada. Nunca descobre outro processo, nem aceita override de rollout. */
export function lerSnapshotController(fonte: FonteController, opcoes: { agoraMs?: number } = {}): SnapshotController {
  const agora = opcoes.agoraMs ?? Date.now();
  const real = conferirDiretorioDaFonte(fonte.dir, path.dirname(fonte.dir), fonte.uid);
  if (real !== fonte.dir) recusar('fonte de controller mudou de caminho real');
  const estado = conferirEstado(lerMetadado(real, 'state.json', fonte.uid)!, fonte);
  if (!mesmaIdentidade(identidadeValida(estado.processoController, fonte.uid), fonte.processoController)) recusar('identidade do controller divergente da registrada');
  if (!mesmaIdentidade(identidadeValida(estado.processoRuntime, fonte.uid), fonte.processoRuntime)) recusar('identidade do runtime divergente da registrada');
  const rollout = conferirFonteDeRollout(estado.rollout, fonte.uid, fonte.sessionId, fonte.cwd,
    { file: fonte.rollout, ino: fonte.rolloutIno, dev: fonte.rolloutDev });
  if (rollout.file !== fonte.rollout) recusar('rollout do controller divergente do registrado');
  let fechamento: FechamentoController | null = null;
  const close = estado.processoEncerrado;
  if (close !== undefined) {
    const em = Date.parse(String(close.em));
    if (!Number.isFinite(em) || em > agora || em < Date.parse(fonte.criadoEm)) recusar('close do controller fora da janela do despacho');
    if (close.code !== null && (!Number.isInteger(close.code) || close.code < 0)) recusar('code do close do controller inválido');
    if (close.signal !== null && typeof close.signal !== 'string') recusar('signal do close do controller inválido');
    // Única origem de exit: o `close` do ChildProcess dono do stdin, nunca turn/completed.
    fechamento = { em: new Date(em).toISOString(), exitCode: close.code, signal: close.signal,
      duracaoMs: em - Date.parse(fonte.criadoEm), fonte: 'controller.close' };
  }
  let terminalNativo: TerminalNativoController | null = null;
  if (estado.terminal !== undefined) {
    const t = estado.terminal;
    if (t.metodo !== 'turn/completed' || t.threadId !== fonte.sessionId || typeof t.turnId !== 'string' ||
        typeof t.status !== 'string') recusar('terminal nativo do controller divergente');
    if (t.erro !== undefined && !erroNativoValido(t.erro)) recusar('erro nativo do terminal do controller invalido');
    terminalNativo = { metodo: 'turn/completed', threadId: t.threadId, turnId: t.turnId, status: t.status,
      ...(t.erro !== undefined ? { erro: { codigo: t.erro.codigo, mensagem: t.erro.mensagem } } : {}) };
  }
  const estadoController = conferirIdentidadeViva(fonte.processoController, 'controller');
  const estadoRuntime = fechamento ? 'ausente' : conferirIdentidadeViva(fonte.processoRuntime, 'runtime');
  if (estado.erro !== undefined && (typeof estado.erro !== 'string' || !estado.erro)) recusar('erro do controller invalido');
  if (estado.limitacao !== undefined && (typeof estado.limitacao !== 'object' || estado.limitacao === null ||
      estado.limitacao.motivo !== 'runtime.unavailable' || typeof estado.limitacao.codigo !== 'string' ||
      typeof estado.limitacao.metodo !== 'string')) recusar('limitacao do controller invalida');
  return { fonte, estado: estado.estado, turno: estado.turno ?? null, rollout: fonte.rollout, terminalNativo,
    erro: estado.erro ?? null, limitacao: estado.limitacao ?? null,
    esperaHumana: esperaAutenticada(estado, fonte) &&
      !fechamento && estadoRuntime === 'vivo' && estadoController === 'vivo',
    fechamento, exitCode: fechamento ? fechamento.exitCode : null,
    exitCodeFonte: fechamento ? 'controller.close' : 'unavailable', estadoController, estadoRuntime };
}
