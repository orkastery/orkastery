/** Projeção pública, sem autoridade para executar operações. */
import { z } from 'zod';

export const MAESTRO_SCHEMA = 'ork.maestro-snapshot/v1' as const;
export const MAESTRO_LIMITS = { items: 50, bytes: 65536, sourceMs: 2000, totalMs: 10000 } as const;
export const SECTION_NAMES = ['portfolio', 'demands', 'threads', 'sessions', 'blockers', 'leases', 'retries', 'hitl', 'ship', 'master', 'nextActions'] as const;
export type SectionName = typeof SECTION_NAMES[number];
export const MAESTRO_ERRORS = ['maestro.project.missing', 'maestro.project.ambiguous', 'maestro.project.scope', 'maestro.source.unavailable', 'maestro.snapshot.stale'] as const;
const text = z.string().max(512);
const identity = z.string().min(1).max(160);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const maestroActionSchema = z.object({
  operation: z.enum(['thread.status', 'thread.observe', 'hitl.decide', 'git.status', 'git.commit', 'verify', 'ship', 'retry', 'master', 'phase', 'creation']),
  available: z.boolean(), reason: text, preconditions: z.array(text).max(10), readback: text,
}).strict();
export const maestroItemSchema = z.object({
  id: identity, title: text, status: text,
  refs: z.array(z.object({ kind: identity, id: identity }).strict()).max(16),
  facts: z.record(z.union([text, z.number().finite(), z.boolean(), z.null()])),
  action: maestroActionSchema.optional(),
}).strict();
export type MaestroItem = z.infer<typeof maestroItemSchema>;
export const maestroSectionSchema = z.object({
  state: z.enum(['available', 'empty', 'unavailable', 'stale', 'conflict']),
  source: identity, observedAt: z.string().datetime(), fingerprint: fingerprint.nullable(),
  coverage: z.object({ total: z.number().int().nonnegative().nullable(), offset: z.number().int().nonnegative(),
    returned: z.number().int().min(0).max(50), omitted: z.number().int().nonnegative().nullable(),
    nextOffset: z.number().int().nonnegative().nullable(), limit: z.literal(50) }).strict(),
  items: z.array(maestroItemSchema).max(50), gaps: z.array(text).max(50),
}).strict();
export type MaestroSection = z.infer<typeof maestroSectionSchema>;
export const maestroSnapshotSchema = z.object({
  schema: z.literal(MAESTRO_SCHEMA), observedAt: z.string().datetime(), fingerprint,
  project: z.object({ id: identity, name: text, origin: z.enum(['installation', 'cwd', 'worktree', 'selection']), fingerprint }).strict(),
  limits: z.object({ items: z.literal(50), bytes: z.literal(65536), sourceMs: z.literal(2000), totalMs: z.literal(10000) }).strict(),
  sections: z.object(Object.fromEntries(SECTION_NAMES.map(name => [name, maestroSectionSchema])) as Record<SectionName, typeof maestroSectionSchema>).strict(),
  gaps: z.array(text).max(100), conflicts: z.array(text).max(100),
}).strict();
export type MaestroSnapshot = z.infer<typeof maestroSnapshotSchema>;
export function validateMaestroSnapshot(input: unknown): MaestroSnapshot {
  const value = maestroSnapshotSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(value)) > MAESTRO_LIMITS.bytes) throw Error('maestro.snapshot.size');
  for (const name of SECTION_NAMES) {
    const s = value.sections[name], c = s.coverage;
    if (c.returned !== s.items.length || (c.total !== null && (c.offset + c.returned + (c.omitted ?? 0) !== c.total)) ||
        (s.state === 'empty' && (c.total !== 0 || s.items.length)) ||
        // Fonte parcial pode paginar itens observados sem inventar total/omissões.
        (c.nextOffset !== null && (c.nextOffset !== c.offset + c.returned || c.returned === 0 ||
          (c.omitted === null ? c.total !== null : c.omitted === 0)))) throw Error('maestro.coverage.invalid');
    if (name === 'nextActions' && s.items.some(item => !item.action)) throw Error('maestro.action.invalid');
  }
  return value;
}
