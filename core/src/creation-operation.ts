/** Coordenador de efeitos duráveis. Identidade e concessão vêm do chamador autenticado. */
import { ManifestoCarregado } from './manifest';
import { CreationOperation, CreationRequest, advanceCreationOperation, creationRequestSchema, readCreationOperation, receiveCreationOperation, withCreationLock } from './creation-operation-store';
import { CycleScope, PortfolioEntity, assertCycleScope, createOperationEntity, findEntity } from './portfolio';
import { compensateReservedObjective, createReservedObjective, readObjective } from './objective';
import { lerThread } from './thread';
import { parseModo } from './modos';

export interface CreationActor {
  principal: string;
  /** Reconsulta permissões e workspaces; deve lançar se a concessão foi revogada. */
  authorize: (request: CreationRequest, action: 'create' | 'resume' | 'compensate') => void;
}

function authorize(loaded: ManifestoCarregado, actor: CreationActor, request: CreationRequest, action: 'create' | 'resume' | 'compensate'): void {
  actor.authorize(request, action);
  if (!(loaded.manifesto.conduction.allowed_modes as readonly string[]).includes(request.mode)) throw new Error('creation.mode: modo não autorizado pelo manifesto');
}
function entityConfirmed(root: string, op: CreationOperation): PortfolioEntity {
  const entity = findEntity(root, op.reserved.entityId);
  if (!entity) throw new Error('creation.conflict: entidade indisponível');
  const expected = op.request.action === 'open_ticket' ? op.request.expectedEntityVersion : 1;
  if (entity.version !== expected || (op.request.action !== 'open_ticket' && entity.creationOperationId !== op.operationId)) {
    throw new Error('creation.conflict: entidade alterada ou pertencente a outra operação');
  }
  return entity;
}
function scopeFor(root: string, op: CreationOperation, entity: PortfolioEntity): { productId: string } & CycleScope {
  if (entity.kind === 'product') throw new Error('creation.scope: ticket exige projeto ou iniciativa');
  const projectId = entity.kind === 'project' ? entity.id : entity.projectId;
  const scope = op.request.scope ?? { projectId, delivery: entity.kind === 'project' ? 'project' : 'initiatives', initiativeIds: entity.kind === 'initiative' ? [entity.id] : [] };
  if (scope.projectId !== projectId || (entity.kind === 'initiative' && (scope.delivery !== 'initiatives' || !scope.initiativeIds.includes(entity.id)))) {
    throw new Error('creation.scope: escopo não contém a entidade alvo');
  }
  const validated = assertCycleScope(root, scope);
  const project = findEntity(root, projectId);
  if (!project || project.kind !== 'project') throw new Error('creation.scope: projeto indisponível');
  if (op.request.workspaceIds.some((id) => !project.workspaceIds.includes(id))) throw new Error('creation.scope: workspace fora do projeto');
  return { productId: project.productId, ...validated };
}
function confirmTicket(root: string, op: CreationOperation): string {
  const ticket = readObjective(root, op.reserved.ticketId!);
  if (ticket.creationOrigin?.operationId !== op.operationId || ticket.creationOrigin?.requestHash !== op.requestHash
    || ticket.creationOrigin?.ticketId !== ticket.id || ticket.envelope.request !== op.request.request
    || JSON.stringify(ticket.threads.map((t) => t.id)) !== JSON.stringify(op.reserved.threadIds)) throw new Error('creation.conflict: ticket sem origem confirmada');
  for (const id of op.reserved.threadIds) {
    const thread = lerThread(root, id);
    if (thread.creationOrigin?.operationId !== op.operationId || thread.creationOrigin?.requestHash !== op.requestHash) throw new Error('creation.conflict: thread sem origem confirmada');
  }
  return `objective:${ticket.id}:envelope:${ticket.envelope.hash}`;
}
function fail(root: string, op: CreationOperation, error: unknown, compensation = false): CreationOperation {
  const detail = error instanceof Error ? error.message : '';
  const known = detail.match(/^creation\.(conflict|scope|mode|started|unavailable|busy):/)?.[1];
  const code = `creation.${known ?? 'effect_failed'}`;
  return advanceCreationOperation(root, op.operationId, op.principal, op.version, {
    state: compensation ? 'compensation_failed' : 'recoverable_failure', confirmed: op.confirmed,
    nextAction: known === 'started' ? 'manual' : compensation ? 'compensate' : 'resume',
    error: { code, message: known === 'started' ? 'Execução ou alteração detectada; use a condução operacional.' : 'A operação foi preservada. Revalide permissões, versões e escopo antes de retomar.' }, receipts: op.receipts,
  }, code);
}

export function startCreation(loaded: ManifestoCarregado, actor: CreationActor, raw: unknown): CreationOperation {
  const request = creationRequestSchema.parse(raw);
  authorize(loaded, actor, request, 'create');
  const op = receiveCreationOperation(loaded.raiz, actor.principal, request, loaded.manifesto.project.abbrev);
  // Repetição de uma intenção que já avançou devolve o journal; recuperação é explícita.
  return op.version > 1 ? op : resumeCreation(loaded, actor, op.operationId, op.version);
}

export function resumeCreation(loaded: ManifestoCarregado, actor: CreationActor, id: string, expectedVersion: number): CreationOperation {
  const root = loaded.raiz;
  return withCreationLock(root, `effects-${id}`, () => {
    let op = readCreationOperation(root, id, actor.principal);
    authorize(loaded, actor, op.request, 'resume');
    if (op.version !== expectedVersion) throw new Error('creation.conflict: revisão alterada');
    if (['completed', 'compensated'].includes(op.state)) return op;
    if (['compensating', 'compensation_failed'].includes(op.state)) throw new Error('creation.conflict: retome a compensação');
    const advance = (state: 'entity_persisted' | 'ticket_persisted' | 'completed', entityVersion: number, ticket: boolean, receipts: string[]) => {
      op = advanceCreationOperation(root, id, actor.principal, op.version, { state, confirmed: { entityVersion, ticket }, nextAction: state === 'completed' ? 'none' : 'resume', error: null, receipts }, `${state}.confirmed`);
    };
    try {
      if (op.request.action !== 'open_ticket') createOperationEntity(root, id, actor.principal);
      let entity = entityConfirmed(root, op);
      if (op.state === 'received' || op.state === 'recoverable_failure') advance('entity_persisted', entity.version, op.confirmed.ticket, op.receipts);
      if (op.reserved.ticketId) {
        authorize(loaded, actor, op.request, 'resume');
        entity = entityConfirmed(root, op);
        const scope = scopeFor(root, op, entity);
        if (op.state !== 'ticket_persisted') {
          // Leitor: a operacao durável pode ter sido gravada em modo aposentado; ela
          // continua parseando, e so nao pode mais ABRIR thread nova nesse modo.
          const modoVivo = parseModo(op.request.mode);
          if (!modoVivo) throw new Error(`creation.mode: modo aposentado "${op.request.mode}" nao abre thread nova`);
          createReservedObjective(loaded, { title: entity.title, request: op.request.request, doneWhen: op.request.doneWhen, mode: modoVivo, ...scope }, { operationId: id, principal: actor.principal });
          const receipt = confirmTicket(root, op);
          advance('ticket_persisted', entity.version, true, [...new Set([...op.receipts, receipt])]);
        }
        confirmTicket(root, op);
      }
      entity = entityConfirmed(root, op);
      advance('completed', entity.version, Boolean(op.reserved.ticketId), op.receipts);
      return readCreationOperation(root, id, actor.principal);
    } catch (error) {
      // A gravação pode ter sucedido antes da perda da resposta; releia a revisão real.
      op = readCreationOperation(root, id, actor.principal);
      if (op.state === 'completed') return op;
      return fail(root, op, error);
    }
  });
}

export function compensateCreation(loaded: ManifestoCarregado, actor: CreationActor, id: string, expectedVersion: number): CreationOperation {
  const root = loaded.raiz;
  return withCreationLock(root, `effects-${id}`, () => {
    let op = readCreationOperation(root, id, actor.principal);
    authorize(loaded, actor, op.request, 'compensate');
    if (op.version !== expectedVersion) throw new Error('creation.conflict: revisão alterada');
    if (op.state === 'compensated') return op;
    if (op.state !== 'compensating') op = advanceCreationOperation(root, id, actor.principal, op.version, { state: 'compensating', confirmed: op.confirmed, nextAction: 'compensate', error: null, receipts: op.receipts }, 'compensation.requested');
    try {
      // Conserva entidade preexistente e efeitos próprios; nunca remove catálogo.
      const entity = findEntity(root, op.reserved.entityId);
      if (entity) entityConfirmed(root, op);
      compensateReservedObjective(root, id, actor.principal);
      op = advanceCreationOperation(root, id, actor.principal, op.version, { state: 'compensated', confirmed: op.confirmed, nextAction: 'none', error: null, receipts: op.receipts }, 'compensation.confirmed');
      return readCreationOperation(root, id, actor.principal);
    } catch (error) {
      op = readCreationOperation(root, id, actor.principal);
      if (op.state === 'compensated') return op;
      return fail(root, op, error, true);
    }
  });
}
