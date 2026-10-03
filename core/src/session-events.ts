/** D3: o runtime observa; identidade e envelope pertencem ao ork. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirThread, lerThread, listarIds } from './thread';
import { auditarEstado } from './estado-thread';
import { lerLedger, registrar } from './ledger';
import { SessaoDaThread, Thread } from './types';

export const LIMITE_EVENTO_BYTES = 16384;
export const TIPOS_SENSOR = ['permission_prompt', 'permission_request', 'notification',
  'stop', 'subagent_stop', 'commit', 'heartbeat', 'resumed'] as const;
export type TipoSensor = typeof TIPOS_SENSOR[number];
export interface PayloadSensor {
  observedAt?: string;
  eventId?: string;
  notificationType?: string;
  commit?: string;
}

/** Sessão com despacho provado: é nesse instante que os sensores se ancoram. */
export type SessaoDespachada = SessaoDaThread & { despachadaEm: string };

/**
 * A adoção governa a identidade de uma sessão que já estava rodando e, por decisão da
 * higiene de runtimes, não inventa data de despacho nem prompt executado. O sensor ancora
 * no instante do despacho o dedupe do evento, o cursor por fonte e a recusa de evento
 * anterior ao início, então a sessão adotada é recusada com correção acionável em vez de
 * receber uma âncora fabricada a partir da adoção.
 */
export function exigirSessaoDespachada(sessao: SessaoDaThread, sessionId: string): SessaoDespachada {
  if (sessao.origem === 'adocao' || typeof sessao.despachadaEm !== 'string') {
    throw new Error(`sessão ${sessionId} foi adotada, não despachada; os sensores exigem o instante do ` +
      'despacho: despache a fase com ork phase run para observá-la');
  }
  return sessao as SessaoDespachada;
}

export function resolverSessao(raiz: string, sessionId: string, threadId?: string): { thread: Thread; sessao: SessaoDaThread } {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sessionId)) throw new Error('sessionId inválido');
  // Um watcher já vinculado não depende da leitura de threads alheias a cada poll.
  // O vínculo explícito continua exigindo uma única sessão e o estado canônico.
  const achadas = (threadId === undefined ? listarIds(raiz) : [threadId]).flatMap(id => {
    const thread = lerThread(raiz, id);
    return thread.sessoes.filter(s => s.sessionId === sessionId).map(sessao => ({ thread, sessao }));
  });
  if (achadas.length !== 1) throw new Error(`sessão ${achadas.length ? 'ambígua' : 'desconhecida'}; confira ork thread status`);
  const achada = achadas[0];
  if (achada.thread.worktree) {
    const estado = auditarEstado(raiz, achada.thread.id, achada.thread.worktree);
    // comEstadoParaGit materializa o estado local durante commit/rebase. Não leia essa
    // cópia: o watcher pode repetir a auditoria, com seu orçamento finito de falhas.
    if (estado.nivel !== 'ok') throw Object.assign(new Error(estado.detalhe), { code: 'SESSION_STATE_SPLIT' });
  }
  return achada;
}

function validarPayload(bruto: string, tipo: TipoSensor, agoraMs: number): PayloadSensor {
  if (Buffer.byteLength(bruto) > LIMITE_EVENTO_BYTES) throw new Error('payload excede 16384 bytes');
  const p: unknown = JSON.parse(bruto.trim() || '{}');
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('payload deve ser objeto JSON');
  const campos = ['observedAt', 'eventId', 'notificationType', 'commit'];
  for (const [k, v] of Object.entries(p)) {
    if (!campos.includes(k) || typeof v !== 'string') throw new Error(`campo de payload inválido: ${k}`);
  }
  const payload = p as PayloadSensor;
  if (payload.observedAt !== undefined && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload.observedAt) ||
      !Number.isFinite(Date.parse(payload.observedAt)) || new Date(payload.observedAt).toISOString() !== payload.observedAt ||
      Date.parse(payload.observedAt) > agoraMs)) throw new Error('observedAt inválido ou futuro');
  if (payload.eventId !== undefined && !/^[a-zA-Z0-9._:-]{1,160}$/.test(payload.eventId)) throw new Error('eventId inválido');
  if (payload.notificationType !== undefined && !['permission_prompt', 'idle_prompt', 'auth_success', 'elicitation_dialog'].includes(payload.notificationType)) {
    throw new Error('notificationType inválido');
  }
  if ((tipo === 'commit' && !payload.commit) || (payload.commit !== undefined &&
      (tipo !== 'commit' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.commit)))) throw new Error('commit exige SHA completo');
  return payload;
}

/** Mesmo lock do carimbo HITL: pulse e hook não criam dois episódios concorrentes. */
export function comLockDeSessao<T>(dir: string, executar: () => T): T {
  const lock = path.join(dir, 'ledger.jsonl.hitl-lock');
  const dono = path.join(lock, 'pid');
  try { fs.mkdirSync(lock); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const pid = fs.existsSync(dono) ? Number(fs.readFileSync(dono, 'utf8')) : null;
    if (pid !== null) {
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('lock de sessão inválido');
      try { process.kill(pid, 0); throw new Error('ingestão ocupada; tente novamente'); }
      catch (erro) { if ((erro as NodeJS.ErrnoException).code !== 'ESRCH') throw erro; }
    } else if (Date.now() - fs.statSync(lock).mtimeMs < 60000) throw new Error('ingestão ocupada; tente novamente');
    fs.rmSync(dono, { force: true });
    fs.rmdirSync(lock);
    fs.mkdirSync(lock);
  }
  fs.writeFileSync(dono, String(process.pid), { flag: 'wx', mode: 0o600 });
  try { return executar(); }
  finally {
    if (fs.readFileSync(dono, 'utf8') === String(process.pid)) {
      fs.unlinkSync(dono);
      fs.rmdirSync(lock);
    }
  }
}

export function ingerirEvento(raiz: string, sessionId: string, tipoBruto: string, bruto = '{}', agoraMs = Date.now()): {
  gravado: boolean; thread: string; tipo: string; observedAt: string;
} {
  if (!(TIPOS_SENSOR as readonly string[]).includes(tipoBruto)) throw new Error(`tipo inválido; use ${TIPOS_SENSOR.join(', ')}`);
  const tipo = tipoBruto as TipoSensor;
  const payload = validarPayload(bruto, tipo, agoraMs);
  const { thread, sessao: registrada } = resolverSessao(raiz, sessionId);
  const sessao = exigirSessaoDespachada(registrada, sessionId);
  const observedAt = payload.observedAt ?? new Date(agoraMs).toISOString();
  if (Date.parse(observedAt) < Date.parse(sessao.despachadaEm)) throw new Error('evento anterior ao despacho');
  const dir = dirThread(raiz, thread.id);
  const bloqueio = tipo === 'permission_prompt' || tipo === 'permission_request' ||
    (tipo === 'notification' && payload.notificationType === 'permission_prompt');
  const retomada = tipo === 'resumed' || tipo === 'heartbeat' || tipo === 'commit';
  const eventoTipo = bloqueio ? 'sessao_bloqueada' : tipo === 'stop' ? 'runtime_stop' :
    tipo === 'subagent_stop' ? 'runtime_subagent_stop' : tipo === 'commit' ? 'commit' : 'runtime_event';
  const identidade = payload.eventId ?? payload.commit ?? { ...payload, observedAt };
  const eventId = createHash('sha256').update(JSON.stringify([sessionId, sessao.despachadaEm, tipo, identidade])).digest('hex');
  return comLockDeSessao(dir, () => {
    const eventos = lerLedger(dir);
    if (eventos.some(e => e.sensorEventId === eventId)) return { gravado: false, thread: thread.id, tipo: eventoTipo, observedAt };
    const ultimo = eventos.filter(e => e.sessionId === sessionId &&
      ['sessao_bloqueada', 'sessao_destravada'].includes(e.tipo)).at(-1);
    if (bloqueio && (ultimo?.tipo === 'sessao_bloqueada' || (ultimo && Date.parse(ultimo.ts) >= Date.parse(observedAt)))) {
      return { gravado: false, thread: thread.id, tipo: eventoTipo, observedAt: ultimo.ts };
    }
    const dados = { ts: observedAt, fase: sessao.fase, sessionId, runtime: sessao.runtime,
      despachoEm: sessao.despachadaEm, fonte: 'ork sessions event', sensor: tipo, sensorEventId: eventId,
      recebidoEm: new Date(agoraMs).toISOString(), ...(payload.commit ? { commit: payload.commit } : {}),
      // I-34: a notificação de ociosidade depois do Stop não é atividade; sem o tipo gravado,
      // o observador claude-bg não teria como distingui-la e trataria o Stop como superado.
      ...(tipo === 'notification' && payload.notificationType ? { notificationType: payload.notificationType } : {}),
      ...(bloqueio ? { tipoDeHitl: 'permissao', pergunta: null, estadoRuntime: 'blocked' } : {}) };
    if (retomada && ultimo?.tipo === 'sessao_bloqueada' && Date.parse(observedAt) > Date.parse(ultimo.ts)) {
      registrar(dir, thread.id, 'sessao_destravada', { ...dados, sensorEventId: eventId + ':resume' });
    }
    registrar(dir, thread.id, eventoTipo, dados);
    return { gravado: true, thread: thread.id, tipo: eventoTipo, observedAt };
  });
}

/** Leitura limitada antes do JSON.parse, inclusive quando stdin é pipe. */
export function lerPayloadSensor(fd = 0): string {
  const buffer = Buffer.alloc(LIMITE_EVENTO_BYTES + 1);
  let total = 0;
  while (total <= LIMITE_EVENTO_BYTES) {
    const n = fs.readSync(fd, buffer, total, buffer.length - total, null);
    if (!n) return buffer.subarray(0, total).toString('utf8');
    total += n;
    if (total > LIMITE_EVENTO_BYTES) throw new Error('payload excede 16384 bytes');
  }
  throw new Error('payload excede 16384 bytes');
}
