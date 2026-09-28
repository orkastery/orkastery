/** D6: consume o schema canônico OrkMind; transporte não concede autoridade. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Source { authority: 'ork'; instance: string; source_ref: string; source_hash: string; source_version: number; location: string; }
export interface BrainEntity {
  schema: 'orkmind.company-brain-entity/v1'; tenant_id: string; id: string; kind: 'prod' | 'proj' | 'init';
  version: number; parent_id: string | null; workspace_ids: string[]; depends_on: string[];
  aliases: { system: string; instance: string; id: string }[]; title: string; description: string;
  status: string; acceptance_criteria: string[]; owner: { raw: string | null; state: 'legacy-label' | 'unknown'; principal: null };
  source: Source; acl_ref: string; observed_at: string | null; recorded_at: string | null;
}
export interface BrainAssertion {
  schema: 'orkmind.company-brain-assertion/v1'; tenant_id: string; id: string; version: number;
  subject: string; predicate: string; object_id: string | null; value: string | number | boolean | null;
  source: Source; producer_id: string; actor_id: string | null; method: 'deterministic';
  observed_at: string; recorded_at: string | null; occurred_at: string | null;
  valid_from: string | null; valid_to: string | null; precision: 'instant' | 'unknown'; state: string; acl_ref: string;
}
export interface BrainEvent {
  schema: 'orkmind.company-brain-event/v1'; tenant_id: string; id: string; producer_id: string;
  aggregate_id: string; sequence: number; source_event_id: string; source: Source;
  operation: 'upsert' | 'assert' | 'tombstone'; payload: BrainEntity | BrainAssertion | null; payload_hash: string;
  cycle: { thread_id: string; objective_id: string | null; objective_hash: string | null; project_id: string | null;
    initiative_ids: string[]; phase: string | null; session_id: string | null; context_hash: string | null } | null;
  evidence_refs: string[]; occurred_at: string | null; observed_at: string | null; acl_ref: string;
}
type RecordValue = Record<string, any>;
const file = path.resolve(__dirname, __dirname.endsWith(`${path.sep}src`) ? '../../schemas/company-brain.schema.json' : '../schemas/company-brain.schema.json');
const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
export const CONTRACT_HASH = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
export const digest = (v: unknown): string => createHash('sha256').update(canonical(v)).digest('hex');
const fail = (): never => { throw Error('brain.contract.invalid'); };

/** Closed vocabulary emitted by Pydantic. Unknown validation keywords fail closed. */
function matches(v: any, rule: RecordValue, depth = 0): boolean {
  if (depth > 32) return false;
  const known = ['$ref', 'anyOf', 'type', 'const', 'enum', 'properties', 'required', 'additionalProperties', 'items',
    'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'title', 'description'];
  if (Object.keys(rule).some(k => !known.includes(k))) return false;
  if (rule.$ref) return rule.$ref.startsWith('#/$defs/') && matches(v, schema.$defs[rule.$ref.slice(8)], depth + 1);
  if (rule.anyOf) return rule.anyOf.some((r: RecordValue) => matches(v, r, depth + 1));
  if ('const' in rule && v !== rule.const || rule.enum && !rule.enum.includes(v)) return false;
  switch (rule.type) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'integer': return Number.isSafeInteger(v) && (rule.minimum === undefined || v >= rule.minimum) && (rule.maximum === undefined || v <= rule.maximum);
    case 'string': return typeof v === 'string' && (rule.minLength === undefined || [...v].length >= rule.minLength) &&
      (rule.maxLength === undefined || [...v].length <= rule.maxLength) && (!rule.pattern || new RegExp(rule.pattern, 'u').test(v));
    case 'array': return Array.isArray(v) && (rule.minItems === undefined || v.length >= rule.minItems) &&
      (rule.maxItems === undefined || v.length <= rule.maxItems) && v.every(i => matches(i, rule.items, depth + 1));
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v) &&
      (!rule.required || rule.required.every((k: string) => Object.hasOwn(v, k))) &&
      Object.keys(v).every(k => Object.hasOwn(rule.properties ?? {}, k) ? matches(v[k], rule.properties[k], depth + 1) : rule.additionalProperties !== false);
    default: return false;
  }
}

function semantic(v: RecordValue): void {
  for (const [key, value] of Object.entries(v)) if ((key.endsWith('_at') || ['valid_from', 'valid_to'].includes(key)) && value !== null) {
    const time = new Date(value as string);
    if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 19) !== (value as string).slice(0, 19)) fail();
  }
  if (v.schema.endsWith('entity/v1')) {
    if (!v.id.startsWith(v.kind + '-')) fail();
    if (v.kind === 'prod' ? v.parent_id !== null : !v.parent_id?.startsWith(v.kind === 'proj' ? 'prod-' : 'proj-')) fail();
    if (v.kind !== 'init' && v.depends_on.length || v.kind !== 'proj' && v.workspace_ids.length) fail();
    if (v.depends_on.some((d: string) => !d.startsWith('init-') || d === v.id)) fail();
    if ((v.owner.raw === null) !== (v.owner.state === 'unknown')) fail();
  }
  if (v.schema.endsWith('event/v1')) {
    if (digest(v.payload) !== v.payload_hash || (v.operation === 'tombstone') !== (v.payload === null)) fail();
    if (v.payload !== null) {
      validateContract(v.payload);
      if (v.payload.tenant_id !== v.tenant_id || v.payload.id !== v.aggregate_id || v.payload.acl_ref !== v.acl_ref ||
        canonical(v.payload.source) !== canonical(v.source) ||
        v.operation !== (v.payload.schema.endsWith('entity/v1') ? 'upsert' : 'assert')) fail();
    }
  }
  if (v.schema.endsWith('assertion/v1')) {
    if (v.object_id !== null && v.value !== null || v.valid_from && v.valid_to && v.valid_from >= v.valid_to) fail();
  }
  if (v.schema.endsWith('migration/v1')) for (const op of v.operations) {
    validateContract(op.after);
    if (op.id !== op.after.id || op.after.tenant_id !== v.tenant_id) fail();
  }
}

export function validateContract<T = RecordValue>(value: unknown): T {
  try {
    if (!schema.anyOf.some((r: RecordValue) => matches(value, r))) fail();
    semantic(value as RecordValue);
    return JSON.parse(JSON.stringify(value)) as T;
  } catch { return fail(); }
}

export function validateCatalog(values: unknown[], scope?: { project_id: string; delivery: string; initiative_ids: string[] }): BrainEntity[] {
  const entities = values.map(v => validateContract<BrainEntity>(v));
  if (entities.some(e => e.schema !== 'orkmind.company-brain-entity/v1')) fail();
  const ids = new Map(entities.map(e => [e.id, e]));
  if (ids.size !== entities.length || new Set(entities.map(e => e.tenant_id)).size > 1) throw Error('brain.catalog.conflict');
  for (const e of entities) {
    if (e.parent_id !== null && !ids.has(e.parent_id)) throw Error('brain.catalog.parent-missing');
    if (e.depends_on.some(d => !ids.has(d) || ids.get(d)!.parent_id !== e.parent_id)) throw Error('brain.catalog.dependency-invalid');
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw Error('brain.catalog.cycle');
    if (done.has(id)) return;
    visiting.add(id); ids.get(id)!.depends_on.forEach(visit); visiting.delete(id); done.add(id);
  };
  entities.forEach(e => visit(e.id));
  if (scope) {
    const project = ids.get(scope.project_id), selected = scope.initiative_ids;
    if (project?.kind !== 'proj' || !Array.isArray(selected) || !['project', 'initiatives'].includes(scope.delivery) ||
      (scope.delivery === 'project' ? selected.length !== 0 : selected.length === 0) ||
      selected.some(id => ids.get(id)?.parent_id !== project.id)) throw Error('brain.scope.invalid');
  }
  return entities;
}
