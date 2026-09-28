/** Durable intent journal. No portfolio, thread or runtime effects happen in this store. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { dirEstado } from './manifest';
import { MODOS_LEGADOS } from './modos';

const entityId = z.string().regex(/^(prod|proj|init)-[a-z0-9][a-z0-9-]{2,47}$/);
const version = z.number().int().positive();
const entity = z.object({
  kind: z.enum(['project', 'initiative']), id: entityId,
  parentId: entityId, title: z.string().trim().min(1).max(160),
  description: z.string().max(10000).default(''),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(100),
}).strict();
export const creationRequestSchema = z.object({
  key: z.string().min(8).max(200),
  action: z.enum(['create_entity', 'create_entity_with_ticket', 'open_ticket']),
  entity: entity.optional(), entityId: entityId.optional(),
  expectedParentVersion: version.optional(), expectedEntityVersion: version.optional(),
  request: z.string().trim().min(1).max(10000),
  doneWhen: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
  workspaceIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)).max(30),
  // Leitor: operacao de criacao ja persistida em modo aposentado continua parseando.
  mode: z.enum(MODOS_LEGADOS),
  scope: z.object({ projectId: entityId, delivery: z.enum(['project', 'initiatives']), initiativeIds: z.array(entityId) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const existing = value.action === 'open_ticket';
  if (existing ? (!value.entityId || value.entity || !value.expectedEntityVersion) : (!value.entity || value.entityId || !value.expectedParentVersion)) {
    ctx.addIssue({ code: 'custom', message: 'creation.input: entidade e versões incompatíveis com a ação' });
  }
});
export type CreationRequest = z.infer<typeof creationRequestSchema>;
export const creationStates = ['received', 'entity_persisted', 'ticket_persisted', 'completed', 'recoverable_failure', 'compensating', 'compensation_failed', 'compensated'] as const;
const state = z.enum(creationStates);
const event = z.object({ sequence: version, at: z.string().datetime(), origin: z.literal('ork.creation'), state, reason: z.string().max(200) }).strict();
export const creationOperationSchema = z.object({
  schema: z.literal('ork.creation-operation/v1'), operationId: z.string().regex(/^cop-[a-f0-9]{32}$/),
  version, principal: z.string().min(1).max(200), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  request: creationRequestSchema, state,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  reserved: z.object({ entityId, ticketId: z.string().regex(/^obj-cop-[a-f0-9]{32}$/).nullable(), threadIds: z.array(z.string().regex(/^[a-z0-9]+-[a-z0-9]{1,12}$/)).max(8) }).strict(),
  confirmed: z.object({ entityVersion: version.nullable(), ticket: z.boolean() }).strict(),
  nextAction: z.enum(['resume', 'compensate', 'none', 'manual']),
  error: z.object({ code: z.string().regex(/^creation\.[a-z_]+$/), message: z.string().max(300) }).strict().nullable(),
  receipts: z.array(z.string().max(300)), events: z.array(event).min(1),
}).strict().superRefine((value, ctx) => {
  if (value.events.length !== value.version || value.events.some((e, i) => e.sequence !== i + 1)
    || value.events.at(-1)?.state !== value.state) ctx.addIssue({ code: 'custom', message: 'creation.corrupt: sequência inválida' });
  if (hash(value.request) !== value.requestHash || operationId(value.principal, value.request.key) !== value.operationId) {
    ctx.addIssue({ code: 'custom', message: 'creation.corrupt: identidade ou intenção alterada' });
  }
  if (value.reserved.entityId !== (value.request.entity?.id ?? value.request.entityId)
    || value.reserved.ticketId !== (value.request.action === 'create_entity' ? null : 'obj-' + value.operationId)
    || (value.state === 'completed' && (!value.confirmed.entityVersion || (value.reserved.ticketId && !value.confirmed.ticket)))
    || (['completed', 'compensated'].includes(value.state) && value.nextAction !== 'none')) {
    ctx.addIssue({ code: 'custom', message: 'creation.corrupt: vínculos ou resultado incompatíveis' });
  }
});
export type CreationOperation = z.infer<typeof creationOperationSchema>;
export type CreationState = CreationOperation['state'];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function operationId(principal: string, key: string): string { return 'cop-' + hash([principal, key]).slice(0, 32); }
function directory(root: string): string { return path.join(dirEstado(root), 'creation-operations'); }
function file(root: string, id: string): string {
  if (!/^cop-[a-f0-9]{32}$/.test(id)) throw new Error('creation.id: identidade inválida');
  return path.join(directory(root), id + '.json');
}

function syncDirectory(dir: string): void {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function ensureDirectory(dir: string): void {
  if (fs.existsSync(dir)) return;
  const parent = path.dirname(dir);
  ensureDirectory(parent);
  try { fs.mkdirSync(dir, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  syncDirectory(parent);
}

/** Stable inode and kernel ownership: process death releases the lock without a TTL race. */
export function withCreationLock<T>(root: string, name: string, run: () => T): T {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('creation.lock: nome inválido');
  if (process.platform !== 'linux') throw new Error('runtime.unavailable: journal exige flock Linux');
  const dir = path.join(directory(root), 'locks');
  ensureDirectory(dir);
  const target = path.join(dir, name);
  const fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077) throw new Error('creation.lock: arquivo inseguro');
    const result = spawnSync('/usr/bin/flock', ['--exclusive', '--timeout', '5', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd], timeout: 6000 });
    if (result.error || result.status !== 0) throw new Error('creation.busy: exclusão do kernel indisponível');
    const current = fs.lstatSync(target);
    if (current.ino !== stat.ino || current.dev !== stat.dev || current.isSymbolicLink()) throw new Error('creation.lock: inode alterado');
    return run();
  } finally { fs.closeSync(fd); }
}

/** File sync before rename, directory sync after rename. Readers see one complete revision. */
export function writeCreationJson(target: string, value: unknown): void {
  const dir = path.dirname(target);
  ensureDirectory(dir);
  const tmp = path.join(dir, '.' + path.basename(target) + '.' + randomUUID() + '.tmp');
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmp, target);
    syncDirectory(dir);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

export function readCreationOperation(root: string, id: string, principal: string): CreationOperation {
  const value = creationOperationSchema.parse(JSON.parse(fs.readFileSync(file(root, id), 'utf8')));
  if (value.principal !== principal) throw new Error('creation.unavailable: operação indisponível');
  return value;
}
export function listCreationOperations(root: string, principal: string): CreationOperation[] {
  if (!fs.existsSync(directory(root))) return [];
  return fs.readdirSync(directory(root)).filter((name) => /^cop-[a-f0-9]{32}\.json$/.test(name))
    .map((name) => creationOperationSchema.parse(JSON.parse(fs.readFileSync(path.join(directory(root), name), 'utf8'))))
    .filter((op) => op.principal === principal).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.operationId.localeCompare(b.operationId));
}
/** Caller supplies the authenticated principal out of band; a payload cannot choose it. */
export function receiveCreationOperation(root: string, principal: string, raw: unknown, abbrev: string): CreationOperation {
  z.string().min(1).max(200).parse(principal);
  if (!/^[a-z][a-z0-9]{0,11}$/.test(abbrev)) throw new Error('creation.input: abbrev inválido');
  const request = creationRequestSchema.parse(raw);
  const id = operationId(principal, request.key);
  return withCreationLock(root, id, () => {
    if (fs.existsSync(file(root, id))) {
      const prior = readCreationOperation(root, id, principal);
      if (prior.requestHash !== hash(request)) throw new Error('creation.conflict: chave reutilizada com outra intenção');
      return prior;
    }
    const now = new Date().toISOString();
    const ticket = request.action !== 'create_entity';
    const value: CreationOperation = {
      schema: 'ork.creation-operation/v1', operationId: id, version: 1, principal, requestHash: hash(request), request,
      state: 'received', createdAt: now, updatedAt: now,
      reserved: { entityId: request.entity?.id ?? request.entityId!, ticketId: ticket ? 'obj-' + id : null,
        threadIds: ticket ? [1, 2, 3].map((n) => `${abbrev}-c${id.slice(4, 14)}${n}`) : [] },
      confirmed: { entityVersion: null, ticket: false }, nextAction: 'resume', error: null, receipts: [],
      events: [{ sequence: 1, at: now, origin: 'ork.creation', state: 'received', reason: 'intent.persisted' }],
    };
    writeCreationJson(file(root, id), creationOperationSchema.parse(value));
    return readCreationOperation(root, id, principal);
  });
}

const transitions: Record<CreationState, CreationState[]> = {
  received: ['entity_persisted', 'recoverable_failure', 'compensating'],
  entity_persisted: ['ticket_persisted', 'completed', 'recoverable_failure', 'compensating'],
  ticket_persisted: ['completed', 'recoverable_failure', 'compensating'],
  completed: ['compensating'], recoverable_failure: ['entity_persisted', 'ticket_persisted', 'completed', 'recoverable_failure', 'compensating'],
  compensating: ['compensated', 'compensation_failed'], compensation_failed: ['compensating'], compensated: [],
};
export function advanceCreationOperation(root: string, id: string, principal: string, expectedVersion: number,
  change: Pick<CreationOperation, 'state' | 'confirmed' | 'nextAction' | 'error' | 'receipts'>, reason: string): CreationOperation {
  return withCreationLock(root, id, () => {
    const prior = readCreationOperation(root, id, principal);
    if (prior.version !== expectedVersion) throw new Error('creation.conflict: revisão alterada');
    if (!transitions[prior.state].includes(change.state)) throw new Error('creation.transition: transição inválida');
    const now = new Date().toISOString();
    const value = creationOperationSchema.parse({ ...prior, ...change, version: prior.version + 1, updatedAt: now,
      events: [...prior.events, { sequence: prior.version + 1, at: now, origin: 'ork.creation', state: change.state, reason }] });
    writeCreationJson(file(root, id), value);
    return readCreationOperation(root, id, principal);
  });
}
