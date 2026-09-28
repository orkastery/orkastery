import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { MAESTRO_LIMITS, MAESTRO_SCHEMA, SECTION_NAMES, validateMaestroSnapshot, maestroSnapshotSchema } from '../src/maestro-contract';

export function snapshotExample() {
  const observedAt = '2026-09-18T00:00:00.000Z', fingerprint = 'a'.repeat(64);
  return { schema: MAESTRO_SCHEMA, observedAt, fingerprint,
    project: { id: 'ork', name: 'Orkastery', origin: 'installation', fingerprint }, limits: MAESTRO_LIMITS,
    sections: Object.fromEntries(SECTION_NAMES.map(name => [name, { state: 'empty', source: name, observedAt,
      fingerprint, coverage: { total: 0, offset: 0, returned: 0, omitted: 0, nextOffset: null, limit: 50 }, items: [], gaps: [] as string[] }])), gaps: [], conflicts: [] };
}
test('contrato valida completo, parcial e conflito sem inventar cobertura', () => {
  const full = snapshotExample(); assert.equal(validateMaestroSnapshot(full).schema, MAESTRO_SCHEMA);
  const partial = structuredClone(full);
  Object.assign(partial.sections.sessions, { state: 'unavailable', fingerprint: null, gaps: ['runtime.unavailable'],
    coverage: { total: null, offset: 0, returned: 0, omitted: null, nextOffset: null, limit: 50 } });
  assert.equal(validateMaestroSnapshot(partial).sections.sessions.state, 'unavailable');
  Object.assign(partial.sections.threads, { state: 'conflict', gaps: ['maestro.snapshot.stale'] });
  assert.equal(validateMaestroSnapshot(partial).sections.threads.state, 'conflict');
});
test('schema publicado corresponde ao validador do contrato', () => {
  const file = path.resolve(__dirname, '../../schemas/maestro-snapshot.schema.json');
  const converter = zodToJsonSchema as unknown as (schema: unknown, options: object) => unknown;
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), converter(maestroSnapshotSchema, { name: 'MaestroSnapshot', $refStrategy: 'none' }));
});
test('contrato rejeita versão, seção, cobertura, contagem e payload excessivo', () => {
  const full = snapshotExample();
  assert.throws(() => validateMaestroSnapshot({ ...full, schema: 'ork.maestro-snapshot/v2' }));
  const missing = structuredClone(full); delete (missing.sections as Record<string, unknown>).hitl;
  assert.throws(() => validateMaestroSnapshot(missing));
  const count = structuredClone(full); count.sections.threads.coverage.returned = 1;
  assert.throws(() => validateMaestroSnapshot(count), /coverage/);
  const excessive = structuredClone(full); excessive.sections.threads.gaps = Array(51).fill('gap');
  assert.throws(() => validateMaestroSnapshot(excessive));
});
