/** Catálogo determinístico de produto -> projeto -> iniciativa. */
import * as fs from 'node:fs';
import { stateFile } from './project-state';
import { raizDoEstado } from './estado-thread';
import { portfolioMutation, replaceWithJournal } from './company-brain-journal';
import { agora, lerJson } from './util';
import { readCreationOperation, withCreationLock } from './creation-operation-store';

export type PortfolioKind = 'product' | 'project' | 'initiative';
export type PortfolioStatus = 'idea' | 'planned' | 'ready' | 'in_progress' | 'validating' | 'delivered' | 'blocked' | 'cancelled';
export interface Product { kind: 'product'; id: string; title: string; description: string; status: PortfolioStatus; ownerId: string | null; acceptanceCriteria: string[]; version: number; }
export interface Project { kind: 'project'; id: string; productId: string; title: string; description: string; status: PortfolioStatus; ownerId: string | null; workspaceIds: string[]; acceptanceCriteria: string[]; version: number; }
export interface Initiative { kind: 'initiative'; id: string; projectId: string; title: string; description: string; status: PortfolioStatus; ownerId: string | null; dependsOn: string[]; acceptanceCriteria: string[]; version: number; }
export type PortfolioEntity = (Product | Project | Initiative) & { creationOperationId?: string };
export interface Portfolio {
  schema: 'ork.portfolio/v1'; updatedAt: string; products: Product[]; projects: Project[]; initiatives: Initiative[];
}
export interface CycleScope { projectId: string; delivery: 'project' | 'initiatives'; initiativeIds: string[]; }

const ID = /^(prod|proj|init)-[a-z0-9][a-z0-9-]{2,47}$/;
const PREFIX: Record<PortfolioKind, string> = { product: 'prod-', project: 'proj-', initiative: 'init-' };
const statuses: PortfolioStatus[] = ['idea', 'planned', 'ready', 'in_progress', 'validating', 'delivered', 'blocked', 'cancelled'];
const unique = (values: string[] = []) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

function file(root: string): string { return stateFile(root, 'portfolio.json'); }
function empty(): Portfolio { return { schema: 'ork.portfolio/v1', updatedAt: agora(), products: [], projects: [], initiatives: [] }; }
export function readPortfolio(root: string): Portfolio {
  const target = file(root);
  if (!fs.existsSync(target)) return empty();
  const value = lerJson<Portfolio>(target);
  if (value.schema !== 'ork.portfolio/v1' || !Array.isArray(value.products) || !Array.isArray(value.projects) || !Array.isArray(value.initiatives)) {
    throw new Error('portfolio inválido');
  }
  return value;
}
function persist(root: string, value: Portfolio): Portfolio { value.updatedAt = agora(); replaceWithJournal(file(root), value); return value; }
function mutatePortfolio<T>(root:string, run:()=>T):T {
  // RM-036 (D5): o portfolio.json e canonico, e o lock de espera tambem: chamado da raiz ou de uma worktree,
  // quem chega depois espera a vez, em vez de recusar com brain.journal.busy no lock interno.
  return withCreationLock(raizDoEstado(root),'portfolio',()=>portfolioMutation(file(root),run));
}

function validateBase(kind: PortfolioKind, input: Partial<PortfolioEntity> & { id: string; title: string }): void {
  if (!ID.test(input.id) || !input.id.startsWith(PREFIX[kind])) throw new Error(`${kind} exige id ${PREFIX[kind]}...`);
  if (!input.title.trim() || input.title.length > 160) throw new Error('título deve ter entre 1 e 160 caracteres');
  if (input.status && !statuses.includes(input.status)) throw new Error('status de portfólio inválido');
}
export function findEntity(root: string, id: string): PortfolioEntity | null {
  const p = readPortfolio(root);
  return [...p.products, ...p.projects, ...p.initiatives].find((item) => item.id === id) ?? null;
}
export function createProduct(root: string, input: { id: string; title: string; description?: string; ownerId?: string; status?: PortfolioStatus; acceptanceCriteria?: string[] }): Product {
  return mutatePortfolio(root, () => {
  validateBase('product', input);
  if (findEntity(root, input.id)) throw new Error(`entidade ${input.id} já existe`);
  const product: Product = { kind: 'product', id: input.id, title: input.title.trim(), description: input.description?.trim() ?? '', ownerId: input.ownerId?.trim() || null, status: input.status ?? 'idea', acceptanceCriteria: unique(input.acceptanceCriteria), version: 1 };
  const p = readPortfolio(root); p.products.push(product); persist(root, p); return product;
  });
}
export function createProject(root: string, input: { id: string; productId: string; title: string; description?: string; ownerId?: string; status?: PortfolioStatus; workspaceIds?: string[]; acceptanceCriteria?: string[] }): Project {
  return mutatePortfolio(root, () => createProjectLocked(root, input));
}
function createProjectLocked(root: string, input: Parameters<typeof createProject>[1], operationId?: string): Project {
  validateBase('project', input);
  if (findEntity(root, input.id)) throw new Error(`entidade ${input.id} já existe`);
  const parent = findEntity(root, input.productId);
  if (!parent || parent.kind !== 'product') throw new Error(`produto ${input.productId} não encontrado`);
  const project: Project = { kind: 'project', id: input.id, productId: input.productId, title: input.title.trim(), description: input.description?.trim() ?? '', ownerId: input.ownerId?.trim() || null, status: input.status ?? 'idea', workspaceIds: unique(input.workspaceIds), acceptanceCriteria: unique(input.acceptanceCriteria), version: 1 };
  if (operationId) Object.assign(project, { creationOperationId: operationId });
  const p = readPortfolio(root); p.projects.push(project); persist(root, p); return project;
}
export function createInitiative(root: string, input: { id: string; projectId: string; title: string; description?: string; ownerId?: string; status?: PortfolioStatus; dependsOn?: string[]; acceptanceCriteria?: string[] }): Initiative {
  return mutatePortfolio(root, () => createInitiativeLocked(root, input));
}
function createInitiativeLocked(root: string, input: Parameters<typeof createInitiative>[1], operationId?: string): Initiative {
  validateBase('initiative', input);
  if (findEntity(root, input.id)) throw new Error(`entidade ${input.id} já existe`);
  const parent = findEntity(root, input.projectId);
  if (!parent || parent.kind !== 'project') throw new Error(`projeto ${input.projectId} não encontrado`);
  const dependencies = unique(input.dependsOn);
  for (const id of dependencies) {
    const dependency = findEntity(root, id);
    if (!dependency || dependency.kind !== 'initiative') throw new Error(`dependência ${id} não encontrada`);
    if (dependency.projectId !== input.projectId) throw new Error('dependências devem pertencer ao mesmo projeto');
  }
  const initiative: Initiative = { kind: 'initiative', id: input.id, projectId: input.projectId, title: input.title.trim(), description: input.description?.trim() ?? '', ownerId: input.ownerId?.trim() || null, status: input.status ?? 'idea', dependsOn: dependencies, acceptanceCriteria: unique(input.acceptanceCriteria), version: 1 };
  if (operationId) Object.assign(initiative, { creationOperationId: operationId });
  const p = readPortfolio(root); p.initiatives.push(initiative); persist(root, p); return initiative;
}

/** CAS do pai e origem do efeito são persistidos sob o mesmo lock dos escritores legados. */
export function createOperationEntity(root: string, operationId: string, principal: string): PortfolioEntity {
  return mutatePortfolio(root, () => {
    const op = readCreationOperation(root, operationId, principal);
    const input = op.request.entity;
    if (!input || ['compensating', 'compensated', 'compensation_failed'].includes(op.state)) throw new Error('creation.conflict: ação não cria entidade');
    const parent = findEntity(root, input.parentId);
    if (!parent || parent.version !== op.request.expectedParentVersion) throw new Error('creation.conflict: versão do pai alterada');
    const existing = findEntity(root, input.id);
    if (existing) {
      if (existing.creationOperationId !== operationId || existing.version !== 1) throw new Error('creation.conflict: entidade alheia ou alterada');
      return existing;
    }
    const common = { id: input.id, title: input.title, description: input.description, acceptanceCriteria: input.acceptanceCriteria };
    if (input.kind === 'project') return createProjectLocked(root, { ...common, productId: input.parentId, workspaceIds: op.request.workspaceIds }, operationId);
    return createInitiativeLocked(root, { ...common, projectId: input.parentId }, operationId);
  });
}
export function listEntities(root: string, kind?: PortfolioKind, parentId?: string): PortfolioEntity[] {
  const p = readPortfolio(root);
  const values: PortfolioEntity[] = kind === 'product' ? p.products : kind === 'project' ? p.projects : kind === 'initiative' ? p.initiatives : [...p.products, ...p.projects, ...p.initiatives];
  return parentId ? values.filter((item) => item.kind === 'project' ? item.productId === parentId : item.kind === 'initiative' ? item.projectId === parentId : false) : values;
}
export function assertCycleScope(root: string, scope: CycleScope): CycleScope {
  const project = findEntity(root, scope.projectId);
  if (!project || project.kind !== 'project') throw new Error(`projeto ${scope.projectId} não encontrado`);
  const ids = unique(scope.initiativeIds);
  if (scope.delivery === 'project' && ids.length) throw new Error('escopo de projeto não aceita iniciativas');
  if (scope.delivery === 'initiatives' && !ids.length) throw new Error('escopo de iniciativas exige ao menos uma iniciativa');
  for (const id of ids) {
    const initiative = findEntity(root, id);
    if (!initiative || initiative.kind !== 'initiative' || initiative.projectId !== scope.projectId) throw new Error(`iniciativa ${id} não pertence ao projeto`);
  }
  return { ...scope, initiativeIds: ids };
}
