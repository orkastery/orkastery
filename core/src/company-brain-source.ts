/** D5/D9: deterministic allowlist, references to authoritative sources; no transcript capture. */
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { BrainAssertion, BrainEntity, BrainEvent, digest, Source, validateCatalog, validateContract } from './company-brain-contract';
import { Portfolio } from './portfolio';
import { bytesHash } from './company-brain-journal';

export const CYCLE_TYPES = new Set(['thread_created','phase_dispatch','phase_dispatch_verified','phase_result','fase_concluida',
  'hitl_requested','hitl_answered','hitl_confirmed','hitl_expired','human_gate','autonomous_decision','gate_passed','gate_blocked',
  'claim_added','claim_verified','claim_withdrawn','verify_run','artifact_written','artifact_delivered','phase_artifact_written',
  'ship_started','ship_done','ship_blocked','push_verified','rollback_done','postmortem_recorded','master_done','score_proposto','master_score_recorded',
  // I-43 (D3): a aceitacao por default e fato do ciclo de entrega, nao ruido de
  // operacao. Sem ela na allowlist, o registro de que a entrega passou sem revisao
  // ficaria de fora do ciclo, que e exatamente onde ele precisa ser visivel.
  'aceite_por_omissao',
  'brain_scope_recorded']);
export interface SourceScope {
  tenant: string; instance: string; thread: string; aclRef: string;
  projectId?: string; initiativeIds?: string[];
}
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function portfolioEntities(catalog: Portfolio, scope: SourceScope, observations: Record<string,string> = {}): BrainEntity[] {
  if (catalog.schema !== 'ork.portfolio/v1') throw Error('brain.source.schema');
  return validateCatalog([...catalog.products, ...catalog.projects, ...catalog.initiatives].map(e => {
    const kind = { product: 'prod', project: 'proj', initiative: 'init' }[e.kind];
    return { schema: 'orkmind.company-brain-entity/v1', tenant_id: scope.tenant, id: e.id, kind,
      version: e.version, parent_id: e.kind === 'product' ? null : e.kind === 'project' ? e.productId : e.projectId,
      workspace_ids: e.kind === 'project' ? e.workspaceIds : [], depends_on: e.kind === 'initiative' ? e.dependsOn : [],
      aliases: [{ system: 'ork', instance: scope.instance, id: e.id }], title: e.title, description: e.description,
      status: e.status, acceptance_criteria: e.acceptanceCriteria,
      owner: { raw: e.ownerId, state: e.ownerId === null ? 'unknown' : 'legacy-label', principal: null },
      source: { authority: 'ork', instance: scope.instance, source_ref: `portfolio.json#${e.id}`,
        source_hash: digest(e), source_version: e.version, location: `id:${e.id}` },
      // Global updatedAt describes a snapshot, not this entity version. Unknown stays null.
      acl_ref: scope.aclRef, observed_at: observations[`${e.id}:${e.version}`] ?? null, recorded_at: null };
  }));
}
/** Confirmed journal snapshots retain intermediate versions. Only an actual change
 * observed by the journal supplies a timestamp; legacy observations stay unknown. */
export function portfolioHistory(catalog: Portfolio, scope: SourceScope, entries: any[] = []): BrainEntity[] {
  const confirmed = new Set(entries.filter(e => e.type === 'confirmed').map(e => e.id));
  const observations: Record<string,string> = {}, snapshots: Portfolio[] = [];
  let previous: Portfolio | null = null;
  const values = (p: Portfolio | null) => p ? [...p.products, ...p.projects, ...p.initiatives] : [];
  for (const intent of entries.filter(e => e.type === 'intent' && confirmed.has(e.id))) {
    if (bytesHash(JSON.stringify(intent.value, null, 2) + '\n') !== intent.afterHash) throw Error('brain.journal.source-conflict');
    const before = Object.hasOwn(intent, 'beforeValue') ? intent.beforeValue : previous;
    if (before) snapshots.push(before);
    const prior = new Map(values(before).map(e => [e.id, e]));
    for (const e of values(intent.value)) {
      // A legacy first snapshot has no evidence identifying when its versions changed.
      if ((Object.hasOwn(intent, 'beforeValue') || before) && prior.get(e.id)?.version !== e.version)
        observations[`${e.id}:${e.version}`] ??= intent.observedAt;
    }
    snapshots.push(intent.value); previous = intent.value;
  }
  snapshots.push(catalog);
  const seen = new Map<string, BrainEntity>(), result: BrainEntity[] = [];
  for (const snapshot of snapshots) for (const entity of portfolioEntities(snapshot, scope, observations)) {
    const key = `${entity.id}:${entity.version}`, old = seen.get(key);
    if (old && old.source.source_hash === entity.source.source_hash) continue;
    seen.set(key, entity); result.push(entity);
  }
  return result;
}
export function entityEvent(entity: BrainEntity, sequence: number): BrainEvent {
  const identity = `portfolio:${entity.source.instance}:${entity.id}:${entity.version}`;
  return validateContract({ schema: 'orkmind.company-brain-event/v1', tenant_id: entity.tenant_id,
    id: 'event-' + digest(identity), producer_id: 'ork', aggregate_id: entity.id, sequence, source_event_id: 'source-' + digest(identity),
    source: entity.source, operation: 'upsert', payload: entity, payload_hash: digest(entity), cycle: null,
    evidence_refs: [entity.source.source_ref], occurred_at: null, observed_at: entity.observed_at, acl_ref: entity.acl_ref });
}
export interface LedgerRead { records: { event: BrainEvent | null; end: number; prefixHash: string }[]; completeBytes: number; partial: boolean; }
export function readCycle(bytes: Buffer, scope: SourceScope, after = 0): LedgerRead {
  const end = bytes.lastIndexOf(10) + 1;
  const complete = bytes.subarray(0, end).toString('utf8');
  if (!Buffer.from(complete).equals(bytes.subarray(0, end))) throw Error('brain.source.encoding');
  const records: LedgerRead['records'] = []; let offset = 0, line = 0;
  const prefix = createHash('sha256');
  for (const raw of complete.split('\n').slice(0, -1)) {
    line++; offset += Buffer.byteLength(raw) + 1;
    prefix.update(raw + '\n');
    if (offset <= after) continue;
    let fact: any;
    try { fact = JSON.parse(raw); } catch { throw Error('brain.source.corrupt'); }
    if (!fact || fact.thread !== scope.thread || typeof fact.tipo !== 'string' || typeof fact.ts !== 'string') throw Error('brain.source.scope');
    let event: BrainEvent | null = null;
    if (CYCLE_TYPES.has(fact.tipo)) {
      const sourceId = safeId(fact.eventId) ? fact.eventId : 'legacy-' + digest([scope.thread,line,bytesHash(raw)]);
      const assertionId = 'fact-' + digest([scope.instance,scope.thread,sourceId]);
      const source: Source = { authority: 'ork', instance: scope.instance,
        source_ref: `threads/${scope.thread}/ledger.jsonl#L${line}`, source_hash: bytesHash(raw), source_version: line, location: `line:${line}` };
      const fields: Record<string, string | boolean | number> = {};
      for (const key of ['fase','estado','classificacao','claimId','pedidoId','sessionId','tipo','gate','commit','sha','schema','acao','contrato']) if (safeId(fact[key])) fields[key] = fact[key];
      for (const key of ['ok','repetida']) if (typeof fact[key] === 'boolean') fields[key] = fact[key];
      // Free text, rationale, question, answer and tool output stay at the source.
      const assertion: BrainAssertion = { schema: 'orkmind.company-brain-assertion/v1', tenant_id: scope.tenant,
        id: assertionId, version: 1, subject: scope.thread, predicate: fact.tipo, object_id: null,
        value: JSON.stringify(fields), source, producer_id: 'ork', actor_id: null, method: 'deterministic',
        observed_at: fact.ts, recorded_at: null, occurred_at: fact.ts, valid_from: null, valid_to: null,
        precision: 'instant', state: 'accepted', acl_ref: scope.aclRef };
      event = validateContract<BrainEvent>({ schema: 'orkmind.company-brain-event/v1', tenant_id: scope.tenant,
        id: 'event-' + digest([scope.instance,sourceId]), producer_id: 'ork', aggregate_id: assertionId, sequence: 1,
        source_event_id: sourceId, source, operation: 'assert', payload: assertion, payload_hash: digest(assertion),
        cycle: { thread_id: scope.thread, objective_id: safeId(fact.objectiveId) ? fact.objectiveId : null,
          objective_hash: hash(fact.objectiveHash) ? fact.objectiveHash : null,
          project_id: scope.projectId ?? null, initiative_ids: scope.initiativeIds ?? [],
          phase: ['GOAL','PLAN','GO','CHECK','SHIP','MASTER'].includes(fact.fase) ? fact.fase : null,
          session_id: safeId(fact.sessionId) ? fact.sessionId : null, context_hash: hash(fact.contextHash) ? fact.contextHash : null },
        evidence_refs: [source.source_ref], occurred_at: fact.ts, observed_at: fact.ts, acl_ref: scope.aclRef });
    }
    records.push({ event, end: offset, prefixHash: prefix.copy().digest('hex') });
  }
  return { records, completeBytes: end, partial: end !== bytes.length };
}
export function readSourceFile(file: string, limit = 16 * 1024 * 1024): Buffer {
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > limit) throw Error('brain.source.unavailable');
  return fs.readFileSync(file);
}
