/**
 * Maestro Mode B7: objetivos duráveis acima de uma única thread.
 *
 * I-43 (T11): O COMANDO `ork objective` FOI APOSENTADO. Este módulo continua aqui, e
 * a razão está escrita abaixo porque ela é exatamente o tipo de coisa que, sem estar
 * escrita, vira "sobrou um arquivo morto".
 *
 * O que SAIU, que é o que o GOAL pediu: a superfície de produto. `ork objective` em
 * qualquer subcomando devolve `objective.aposentado` com saída != 0; o ramo de
 * `phase.ts` que consultava o envelope no despacho saiu; e `fx-objective-oscillation`
 * saiu junto com o mecanismo que ele exercitava (D9).
 *
 * O que FICOU, e por quê: este arquivo é carregado por três consumidores que NÃO são
 * o envelope e que esta thread não tem escopo para remover:
 *   - `creation-operation.ts`, o journal durável de criação (portfolio/creation);
 *   - `portfolio-context.ts`, que alimenta `ork portfolio inspect`;
 *   - `maestro-sources.ts`, que lê `objective.json` para o snapshot do Maestro.
 * Arrancar o módulo levaria os três junto, e nenhum deles é uma das cinco remoções.
 * O item está no roadmap com esta medida, em vez de virar uma remoção no escuro.
 *
 * As DUAS VIGAS que o envelope guardava saíram VIVAS, como propriedade de thread
 * comum, e é o que torna a remoção da superfície honesta:
 *   - validação por runtime diferente -> `thread.exigeRuntimeDiferente` (T9);
 *   - `doneWhen` executável -> `thread.doneWhen`, que vira claim do núcleo (T10).
 *
 * Os envelopes já gravados em `.orkastery/objectives/` ficam em disco, intocados: é
 * estado, e estado pertence ao núcleo. Contrato `ork.objective/v1`, um arquivo
 * `objective.json` por diretório, legível por `cat` e `jq`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { dirEstado, ManifestoCarregado } from './manifest';
import { normalizarAssunto } from './slug';
import { caminhoThread, dirThread, lerThread, novaThread } from './thread';
import { registrar } from './ledger';
import { agora, lerJson, tabela } from './util';
import { CreationOrigin, FASES, Fase, Modo } from './types';
import { pararSessao } from './sessoes';
import { assertCycleScope, CycleScope, findEntity } from './portfolio';
import { readCreationOperation, withCreationLock, writeCreationJson } from './creation-operation-store';
import { comLockHitl } from './hitl-gates';
import { SessionReviewBinding, SessionReviewEvidence, verifyCompletedSessionReview, requireSessionReviewRuntime } from './maestro-authority';

export type EstadoObjective = 'awaiting_approval' | 'running' | 'paused' | 'validated' | 'stopped';
export type PapelObjective = 'discovery' | 'delivery' | 'validation';

export interface ObjectiveEnvelope {
  schema: 'ork.objective-envelope/v1';
  version: number;
  request: string;
  outcomes: string[];
  constraints: string[];
  doneWhen: string[];
  maxThreads: number;
  executionRuntime: string;
  validationRuntimes: string[];
  independence?: 'sessions';
  portfolio: null | ({ productId: string } & CycleScope);
  hash: string;
}

export interface Objective {
  /** Fora do envelope imutável; identifica exclusivamente os efeitos da operação. */
  creationOrigin?: CreationOrigin;
  schema: 'ork.objective/v1';
  id: string;
  title: string;
  mode: Modo;
  status: EstadoObjective;
  createdAt: string;
  updatedAt: string;
  envelope: ObjectiveEnvelope;
  envelopeHistory: ObjectiveEnvelope[];
  threads: Array<{ id: string; role: PapelObjective }>;
  approval: null | { by: string; at: string; envelopeHash: string };
  validations: Array<{ runtime: string; verdict: 'approved' | 'rejected'; evidence: string; at: string; identity?: SessionReviewEvidence }>;
  revisions: number;
  pauseReason: string | null;
  stopStack: Array<{ thread: string; session: string; stopped: boolean; detail: string }>;
}

export interface NewObjective {
  title: string;
  request: string;
  outcomes?: string[];
  constraints?: string[];
  doneWhen?: string[];
  maxThreads?: number;
  executionRuntime?: string;
  validationRuntimes?: string[];
  independence?: 'sessions';
  productId?: string;
  projectId?: string;
  delivery?: 'project' | 'initiatives';
  initiativeIds?: string[];
  mode?: Modo;
}

export interface ObjectiveMessage {
  schema: 'ork.objective-message/v1';
  id: string;
  objectiveId: string;
  role: 'human' | 'ork' | 'runtime';
  by: string;
  text: string;
  createdAt: string;
}

const OBJECTIVE_ID = /^obj-[a-z0-9-]{1,48}$/;
const clean = (values: string[] | undefined) => (values ?? []).map((v) => v.trim()).filter(Boolean);

function objectiveDir(root: string): string { return path.join(dirEstado(root), 'objectives'); }
function objectiveFile(root: string, id: string): string {
  if (!OBJECTIVE_ID.test(id)) throw new Error('objective id inválido');
  return path.join(objectiveDir(root), id, 'objective.json');
}
function messagesFile(root: string, id: string): string {
  return path.join(path.dirname(objectiveFile(root, id)), 'messages.jsonl');
}
function digest(value: Omit<ObjectiveEnvelope, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function envelope(input: NewObjective, version = 1, root?: string): ObjectiveEnvelope {
  const maxThreads = input.maxThreads ?? 3;
  if (!Number.isInteger(maxThreads) || maxThreads < 1 || maxThreads > 8) throw new Error('maxThreads deve estar entre 1 e 8');
  const executionRuntime = input.executionRuntime?.trim() || 'claude-bg';
  const validationRuntimes = [...new Set(clean(input.validationRuntimes).length ? clean(input.validationRuntimes) : ['codex', 'claude-bg'])];
  if (input.independence !== undefined && input.independence !== 'sessions') throw Error('maestro.authority.mode');
  if (input.independence === 'sessions') validationRuntimes.forEach(requireSessionReviewRuntime);
  if (!input.independence && validationRuntimes.length < 2) throw new Error('ensemble exige ao menos dois runtimes de validação');
  if (!input.independence && !validationRuntimes.some((runtime) => runtime !== executionRuntime)) throw new Error('CHECK deve incluir runtime diferente do GO');
  const base = {
    schema: 'ork.objective-envelope/v1' as const,
    version,
    request: input.request.trim(),
    outcomes: clean(input.outcomes),
    constraints: clean(input.constraints),
    doneWhen: clean(input.doneWhen),
    maxThreads,
    executionRuntime,
    validationRuntimes,
    ...(input.independence ? { independence: input.independence } : {}),
    portfolio: input.productId && input.projectId
      ? { productId: input.productId, projectId: input.projectId, delivery: input.delivery ?? 'project', initiativeIds: clean(input.initiativeIds) }
      : null,
  };
  if (!base.request) throw new Error('objective exige request');
  if (!base.doneWhen.length) throw new Error('objective exige ao menos um critério de pronto');
  if ((input.productId && !input.projectId) || (!input.productId && input.projectId)) throw new Error('vínculo de portfólio exige productId e projectId');
  if (base.portfolio && root) {
    const scope = assertCycleScope(root, base.portfolio);
    const project = findEntity(root, scope.projectId);
    if (!project || project.kind !== 'project' || project.productId !== base.portfolio.productId) throw new Error('projeto não pertence ao produto informado');
    base.portfolio = { productId: base.portfolio.productId, ...scope };
  }
  return { ...base, hash: digest(base) };
}

function persist(root: string, objective: Objective): Objective {
  objective.updatedAt = agora();
  writeCreationJson(objectiveFile(root, objective.id), objective);
  return objective;
}

export function readObjective(root: string, id: string): Objective {
  const file = objectiveFile(root, id);
  if (!fs.existsSync(file)) throw new Error(`objective ${id} não encontrado`);
  const value = lerJson<Objective>(file);
  const { hash: _hash, ...body } = value.envelope;
  if (value.schema !== 'ork.objective/v1' || digest(body) !== value.envelope.hash) throw new Error('Objective Envelope inválido ou alterado fora do ork');
  return value;
}

export function listObjectives(root: string): Objective[] {
  const dir = objectiveDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => readObjective(root, e.name))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listObjectiveMessages(root: string, id: string): ObjectiveMessage[] {
  readObjective(root, id);
  const file = messagesFile(root, id);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as ObjectiveMessage);
}

export function messageObjective(
  root: string,
  id: string,
  input: { role: ObjectiveMessage['role']; by: string; text: string },
): ObjectiveMessage {
  readObjective(root, id);
  const text = input.text.trim(), by = input.by.trim();
  if (!text || text.length > 10_000) throw new Error('mensagem deve ter entre 1 e 10000 caracteres');
  if (!by || by.length > 120) throw new Error('mensagem exige autor válido');
  const createdAt = agora();
  const message: ObjectiveMessage = {
    schema: 'ork.objective-message/v1',
    id: `msg-${createHash('sha256').update(`${id}:${createdAt}:${by}:${text}`).digest('hex').slice(0, 16)}`,
    objectiveId: id, role: input.role, by, text, createdAt,
  };
  fs.appendFileSync(messagesFile(root, id), `${JSON.stringify(message)}\n`, { encoding: 'utf8', mode: 0o600 });
  return message;
}

export function createObjective(loaded: ManifestoCarregado, input: NewObjective): Objective {
  return withCreationLock(loaded.raiz, 'objectives', () => createLegacyObjective(loaded, input));
}

function createLegacyObjective(loaded: ManifestoCarregado, input: NewObjective): Objective {
  const subject = normalizarAssunto(input.title);
  if (!subject) throw new Error('título não produz id válido');
  let id = `obj-${subject}`, suffix = 1;
  while (fs.existsSync(objectiveFile(loaded.raiz, id))) id = `obj-${subject.slice(0, 40)}-${++suffix}`;
  const env = envelope(input, 1, loaded.raiz);
  const roles: PapelObjective[] = ['discovery', 'delivery', 'validation'];
  const threads = Array.from({ length: env.maxThreads }, (_, index) => {
    const role = roles[index] ?? 'delivery';
    const result = novaThread(loaded, { nome: `${input.title} · ${role} ${index + 1}`, modo: input.mode ?? 'maestro', assunto: `${subject.slice(0, 8)}${index + 1}` });
    return { id: result.thread.id, role };
  });
  const now = agora();
  const value: Objective = {
    schema: 'ork.objective/v1', id, title: input.title.trim(), mode: input.mode ?? 'maestro', status: 'awaiting_approval',
    createdAt: now, updatedAt: now, envelope: env, envelopeHistory: [], threads, approval: null,
    validations: [], revisions: 0, pauseReason: 'human.approval.objective-envelope', stopStack: [],
  };
  persist(loaded.raiz, value);
  const dir = path.dirname(objectiveFile(loaded.raiz, id));
  fs.writeFileSync(path.join(dir, 'INTENT.md'), input.request.trim() + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'SPEC.md'), `# ${input.title.trim()}\n\n## Pronto quando\n${env.doneWhen.map((x) => `- ${x}`).join('\n')}\n`, 'utf8');
  messageObjective(loaded.raiz, id, { role: 'human', by: 'maestro', text: input.request });
  return value;
}

/** Ticket determinístico fica localizável antes de qualquer thread; nunca despacha runtime. */
export function createReservedObjective(loaded: ManifestoCarregado, input: NewObjective,
  reservation: { operationId: string; principal: string }): Objective {
  return withCreationLock(loaded.raiz, 'objectives', () => {
    const op = readCreationOperation(loaded.raiz, reservation.operationId, reservation.principal);
    const id = op.reserved.ticketId;
    if (!id || ['compensating', 'compensated', 'compensation_failed'].includes(op.state)
      || input.request.trim() !== op.request.request || input.mode !== op.request.mode
      || JSON.stringify(clean(input.doneWhen)) !== JSON.stringify(op.request.doneWhen)) {
      throw new Error('creation.conflict: ticket incompatível com intenção reservada');
    }
    const env = envelope(input, 1, loaded.raiz);
    if (env.maxThreads !== op.reserved.threadIds.length) throw new Error('creation.conflict: quantidade de threads não reservada');
    const origin: CreationOrigin = { operationId: op.operationId, ticketId: id, requestHash: op.requestHash };
    const roles: PapelObjective[] = ['discovery', 'delivery', 'validation'];
    const threads = op.reserved.threadIds.map((threadId, index) => ({ id: threadId, role: roles[index] ?? 'delivery' as PapelObjective }));
    let value: Objective;
    if (fs.existsSync(objectiveFile(loaded.raiz, id))) {
      value = readObjective(loaded.raiz, id);
      if (value.creationOrigin?.operationId !== origin.operationId || value.creationOrigin?.requestHash !== origin.requestHash
        || value.creationOrigin?.ticketId !== id || value.envelope.hash !== env.hash
        || value.title !== input.title.trim() || value.mode !== input.mode || JSON.stringify(value.threads) !== JSON.stringify(threads)) {
        throw new Error('creation.conflict: ticket reservado pertence a outra intenção ou foi revisado');
      }
      if (value.status !== 'awaiting_approval' || value.approval) throw new Error('creation.started: ticket já saiu da criação');
    } else {
      const now = agora();
      value = { schema: 'ork.objective/v1', id, title: input.title.trim(), mode: input.mode!, status: 'awaiting_approval',
        createdAt: now, updatedAt: now, envelope: env, envelopeHistory: [], threads, approval: null,
        validations: [], revisions: 0, pauseReason: 'human.approval.objective-envelope', stopStack: [], creationOrigin: origin };
      persist(loaded.raiz, value);
    }
    for (const link of threads) {
      if (fs.existsSync(caminhoThread(loaded.raiz, link.id))) {
        const thread = lerThread(loaded.raiz, link.id);
        if (thread.sessoes.length || thread.decisoes.length || thread.faseAtual !== thread.fases[0] || thread.status !== 'aberta') {
          throw new Error('creation.started: thread já iniciou execução');
        }
      }
    }
    for (const [index, link] of threads.entries()) {
      novaThread(loaded, { nome: `${value.title} · ${link.role} ${index + 1}`, modo: value.mode,
        reservation: { ...reservation, threadId: link.id } });
    }
    const dir = path.dirname(objectiveFile(loaded.raiz, id));
    if (!fs.existsSync(path.join(dir, 'INTENT.md'))) fs.writeFileSync(path.join(dir, 'INTENT.md'), input.request.trim() + '\n', { flag: 'wx', mode: 0o600 });
    if (!fs.existsSync(path.join(dir, 'SPEC.md'))) fs.writeFileSync(path.join(dir, 'SPEC.md'), `# ${value.title}\n\n## Pronto quando\n${env.doneWhen.map((x) => `- ${x}`).join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    if (!listObjectiveMessages(loaded.raiz, id).some((message) => message.role === 'ork' && message.by === 'ork.creation')) {
      messageObjective(loaded.raiz, id, { role: 'ork', by: 'ork.creation', text: input.request });
    }
    // A confirmação depende de leituras dos efeitos, não da passagem pelo loop.
    for (const link of threads) {
      const thread = lerThread(loaded.raiz, link.id);
      if (thread.creationOrigin?.operationId !== op.operationId || thread.creationOrigin?.requestHash !== op.requestHash) {
        throw new Error('creation.conflict: confirmação da thread falhou');
      }
    }
    return readObjective(loaded.raiz, id);
  });
}

export function approveObjective(root: string, id: string, by: string): Objective {
  return withCreationLock(root, 'objectives', () => approveObjectiveLocked(root, id, by));
}
function approveObjectiveLocked(root: string, id: string, by: string): Objective {
  const value = readObjective(root, id);
  if (!by.trim()) throw new Error('aprovação exige --por');
  if (value.status !== 'awaiting_approval') throw new Error(`objective não aguarda aprovação: ${value.status}`);
  value.approval = { by: by.trim(), at: agora(), envelopeHash: value.envelope.hash };
  if (value.envelope.independence === 'sessions') for (const thread of value.threads) {
    registrar(dirThread(root, thread.id), thread.id, 'objective_envelope_approved', {
      objectiveId: id, envelopeHash: value.envelope.hash, version: value.envelope.version,
      approvedAt: value.approval.at, by: value.approval.by,
    });
  }
  value.status = 'running'; value.pauseReason = null;
  return persist(root, value);
}

export function reviseObjective(root: string, id: string, request: string, doneWhen?: string[]): Objective {
  return withCreationLock(root, 'objectives', () => reviseObjectiveLocked(root, id, request, doneWhen));
}
function reviseObjectiveLocked(root: string, id: string, request: string, doneWhen?: string[]): Objective {
  const value = readObjective(root, id);
  if (!request.trim()) throw new Error('revisão exige request');
  value.envelopeHistory.push(value.envelope);
  value.revisions += 1;
  value.envelope = envelope({
    title: value.title, request, mode: value.mode, outcomes: value.envelope.outcomes, constraints: value.envelope.constraints,
    doneWhen: clean(doneWhen).length ? doneWhen : value.envelope.doneWhen, maxThreads: value.envelope.maxThreads,
    executionRuntime: value.envelope.executionRuntime, validationRuntimes: value.envelope.validationRuntimes,
    independence: value.envelope.independence,
    productId: value.envelope.portfolio?.productId, projectId: value.envelope.portfolio?.projectId,
    delivery: value.envelope.portfolio?.delivery, initiativeIds: value.envelope.portfolio?.initiativeIds,
  }, value.envelope.version + 1, root);
  value.approval = null; value.validations = [];
  value.status = value.revisions >= 3 ? 'paused' : 'awaiting_approval';
  value.pauseReason = value.revisions >= 3 ? 'objective.oscillation' : 'human.approval.objective-envelope';
  return persist(root, value);
}

export function validateObjective(root: string, id: string, runtime: string, verdict: 'approved' | 'rejected', evidence: string, binding?: SessionReviewBinding): Objective {
  return withCreationLock(root, 'objectives', () => validateObjectiveLocked(root, id, runtime, verdict, evidence, binding));
}
function validateObjectiveLocked(root: string, id: string, runtime: string, verdict: 'approved' | 'rejected', evidence: string, binding?: SessionReviewBinding): Objective {
  const value = readObjective(root, id);
  if (!['running', 'validated'].includes(value.status)) throw new Error(`objective não está em validação: ${value.status}`);
  if (!value.envelope.validationRuntimes.includes(runtime)) throw new Error('runtime fora do ensemble fixado no envelope');
  if (!evidence.trim()) throw new Error('validação exige evidência');
  let identity: SessionReviewEvidence | undefined;
  if (value.envelope.independence === 'sessions') {
    if (!binding) throw Error('maestro.authority.unproven');
    if (!value.approval || value.approval.envelopeHash !== value.envelope.hash) throw Error('maestro.authority.envelope-stale');
    const currentEnvelope = { objectiveId: id, hash: value.envelope.hash, version: value.envelope.version, approvedAt: value.approval.at };
    const proved = verifyCompletedSessionReview(root, binding, currentEnvelope, verdict);
    // No envelope de uma thread, discovery também hospeda GO/CHECK. Os papéis de
    // autoridade continuam separados pelas três sessões provadas, sem migrar o envelope.
    const singleThread = value.envelope.maxThreads === 1 && value.threads.length === 1;
    if (proved.runtime !== runtime || !value.threads.some(t => t.id === proved.executor.threadId && (t.role === 'delivery' || singleThread)) ||
        !value.threads.some(t => t.id === proved.conductor.threadId)) throw Error('maestro.authority.scope');
    identity = proved;
    // Um voto de outro runtime também precisa continuar vinculado à execução
    // e ao envelope atuais antes de compor o ensemble.
    value.validations = value.validations.filter(v => {
      const previous = v.identity;
      if (!previous || JSON.stringify(previous.envelope) !== JSON.stringify(currentEnvelope)) return false;
      try {
        verifyCompletedSessionReview(root, { conductor: previous.conductor, executor: previous.executor,
          reviewer: previous.reviewer }, currentEnvelope, v.verdict);
        return true;
      } catch { return false; }
    });
  }
  value.validations = value.validations.filter((item) => item.runtime !== runtime);
  value.validations.push({ runtime, verdict, evidence: evidence.trim(), at: agora(), ...(identity ? { identity } : {}) });
  const complete = value.envelope.validationRuntimes.every((expected) => value.validations.some((item) => item.runtime === expected && item.verdict === 'approved'));
  value.status = complete ? 'validated' : verdict === 'rejected' ? 'paused' : 'running';
  value.pauseReason = verdict === 'rejected' ? 'ensemble.rejected' : null;
  return persist(root, value);
}

export type StopSession = (session: string) => { codigo: number; texto: string };
export function stopObjective(root: string, id: string, stop: StopSession = pararSessao): Objective {
  return withCreationLock(root, 'objectives', () => stopObjectiveLocked(root, id, stop));
}
function stopObjectiveLocked(root: string, id: string, stop: StopSession): Objective {
  const value = readObjective(root, id);
  if (value.status === 'stopped') return value;
  value.stopStack = [];
  for (const link of value.threads) {
    const thread = lerThread(root, link.id);
    for (const session of thread.sessoes) {
      const result = stop(session.sessionId);
      value.stopStack.push({ thread: link.id, session: session.sessionId, stopped: result.codigo === 0, detail: result.texto });
    }
  }
  value.status = 'stopped'; value.pauseReason = 'stop.requested';
  return persist(root, value);
}

/** Compensação não para runtimes: só cancela o ticket desta intenção antes da execução. */
export function compensateReservedObjective(root: string, operationId: string, principal: string): Objective | null {
  return withCreationLock(root, 'objectives', () => {
    const op = readCreationOperation(root, operationId, principal);
    const id = op.reserved.ticketId;
    if (!id || !fs.existsSync(objectiveFile(root, id))) return null;
    const value = readObjective(root, id);
    if (value.creationOrigin?.operationId !== operationId || value.creationOrigin?.requestHash !== op.requestHash
      || value.creationOrigin?.ticketId !== id || JSON.stringify(value.threads.map((t) => t.id)) !== JSON.stringify(op.reserved.threadIds)) {
      throw new Error('creation.conflict: ticket não pertence à operação');
    }
    if (value.status === 'stopped' && value.pauseReason === 'creation.compensated') return value;
    if (value.approval || value.status !== 'awaiting_approval' || value.revisions || value.validations.length) {
      throw new Error('creation.started: ticket aprovado ou alterado; ação operacional necessária');
    }
    const ids = value.threads.map((t) => t.id).filter((threadId) => fs.existsSync(caminhoThread(root, threadId))).sort();
    const lock = (index: number): Objective => index < ids.length ? comLockHitl(root, ids[index], () => lock(index + 1)) : cancel();
    const cancel = (): Objective => {
      for (const threadId of ids) {
        const thread = lerThread(root, threadId);
        if (thread.creationOrigin?.operationId !== operationId || thread.creationOrigin?.requestHash !== op.requestHash
          || thread.sessoes.length || thread.decisoes.length || thread.faseAtual !== thread.fases[0] || thread.status !== 'aberta') {
          throw new Error('creation.started: thread alheia, alterada ou despachada');
        }
      }
      value.status = 'stopped'; value.pauseReason = 'creation.compensated';
      persist(root, value);
      return readObjective(root, id);
    };
    return lock(0);
  });
}

export function objectivePhases(root: string, value: Objective): Array<{ phase: Fase; state: 'waiting' | 'active' | 'done' }> {
  const threads = value.threads.map((item) => lerThread(root, item.id));
  return FASES.map((phase, index) => {
    if (value.status === 'awaiting_approval' || value.status === 'paused') return { phase, state: 'waiting' };
    const positions = threads.map((thread) => thread.status === 'fechada' ? FASES.length : FASES.indexOf(thread.faseAtual));
    return { phase, state: positions.every((position) => position > index) ? 'done' : positions.some((position) => position === index) ? 'active' : 'waiting' };
  });
}

export function objectiveText(root: string, value: Objective): string {
  const rows = value.threads.map((item) => { const thread = lerThread(root, item.id); return [item.role, item.id, thread.faseAtual, thread.status]; });
  return [`Objective ${value.id}: ${value.title}`, `Estado: ${value.status}; envelope ${value.envelope.hash.slice(0, 12)}; pausa: ${value.pauseReason ?? 'nenhuma'}`,
    `Execução: ${value.envelope.executionRuntime}; ensemble: ${value.envelope.validationRuntimes.join(', ')}`, tabela(['PAPEL', 'THREAD', 'FASE', 'ESTADO'], rows)].join('\n');
}
