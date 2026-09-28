/** Inspeção por identidade: o estado do catálogo não é inferido de ciclos. */
import { findEntity, PortfolioEntity, readPortfolio } from './portfolio';
import { listObjectives, Objective } from './objective';

export interface PortfolioCycleContext {
  id: string;
  title: string;
  status: Objective['status'];
  statusLabel: string;
  relation: 'project_delivery' | 'initiative_delivery' | 'project_context';
  projectId: string;
  initiativeIds: string[];
  updatedAt: string;
  envelopeHash: string;
  /** Link de ciclo não é recibo de SHIP da entidade. */
  entityDeliveryProven: false;
}
export interface PortfolioContext {
  schema: 'ork.portfolio-context/v1';
  entity: PortfolioEntity;
  parent: PortfolioEntity | null;
  origin: { authority: 'ork.portfolio'; schema: 'ork.portfolio/v1'; reference: string; catalogUpdatedAt: string; observedAt: string; creationOperationId: string | null };
  cycles: PortfolioCycleContext[];
  cyclesState: 'available' | 'unavailable';
  cyclesMessage: string;
  gaps: string[];
  conflicts: Array<{ code: string; cycleId: string }>;
  references: Array<{ kind: 'entity' | 'objective'; id: string }>;
}
const statusLabels: Record<Objective['status'], string> = {
  awaiting_approval: 'Aguardando aprovação', running: 'Em andamento', paused: 'Pausado', validated: 'Validado no ciclo', stopped: 'Interrompido',
};

export function inspectPortfolio(root: string, id: string, readCycles: (root: string) => Objective[] = listObjectives): PortfolioContext {
  if (!/^(prod|proj|init)-[a-z0-9][a-z0-9-]{2,47}$/.test(id)) throw new Error('portfolio.id: identidade inválida');
  const entity = findEntity(root, id);
  if (!entity) throw new Error('portfolio.unavailable: entidade indisponível');
  const portfolio = readPortfolio(root);
  const parentId = entity.kind === 'project' ? entity.productId : entity.kind === 'initiative' ? entity.projectId : null;
  const parent = parentId ? findEntity(root, parentId) : null;
  const result: PortfolioContext = {
    schema: 'ork.portfolio-context/v1', entity, parent,
    origin: { authority: 'ork.portfolio', schema: portfolio.schema, reference: `portfolio:${entity.id}`, catalogUpdatedAt: portfolio.updatedAt, observedAt: new Date().toISOString(), creationOperationId: entity.creationOperationId ?? null },
    cycles: [], cyclesState: 'available', cyclesMessage: 'Nenhum ciclo vinculado',
    gaps: ['delivery.receipt_not_loaded'], conflicts: [], references: parentId ? [{ kind: 'entity', id: parentId }] : [],
  };
  if (!entity.creationOperationId) result.gaps.push('origin.legacy');
  if (parentId && !parent) result.gaps.push('parent.unavailable');
  try {
    for (const cycle of readCycles(root)) {
      const scope = cycle.envelope.portfolio;
      if (!scope) continue;
      const matches = entity.kind === 'product' ? scope.productId === entity.id
        : entity.kind === 'project' ? scope.projectId === entity.id
          : scope.projectId === entity.projectId && (scope.delivery === 'project' || scope.initiativeIds.includes(entity.id));
      if (!matches) continue;
      const relation = entity.kind === 'product' || (entity.kind === 'initiative' && scope.delivery === 'project') ? 'project_context'
        : scope.delivery === 'project' ? 'project_delivery' : 'initiative_delivery';
      result.cycles.push({ id: cycle.id, title: cycle.title, status: cycle.status, statusLabel: statusLabels[cycle.status] ?? 'Estado não confirmado', relation,
        projectId: scope.projectId, initiativeIds: [...scope.initiativeIds], updatedAt: cycle.updatedAt, envelopeHash: cycle.envelope.hash, entityDeliveryProven: false });
      result.references.push({ kind: 'objective', id: cycle.id });
      if (entity.status === 'delivered' && ['running', 'paused', 'awaiting_approval'].includes(cycle.status)) {
        result.conflicts.push({ code: 'entity.delivered_cycle_open', cycleId: cycle.id });
      }
    }
    result.cycles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    if (result.cycles.length) result.cyclesMessage = 'Ciclos vinculados; escopo e estado independentes do catálogo';
  } catch {
    result.cycles = []; result.conflicts = [];
    result.references = result.references.filter((reference) => reference.kind === 'entity');
    result.cyclesState = 'unavailable'; result.cyclesMessage = 'Consulta de ciclos indisponível'; result.gaps.push('cycles.unavailable');
  }
  return result;
}
