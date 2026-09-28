import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateCatalog, validateContract } from '../src/company-brain-contract';
const root = path.resolve(__dirname, '../../..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'core/test/fixtures/company-brain-v1.json'), 'utf8'));

for (const c of corpus.cases) test(`T05: corpus comum ${c.name}`, () => {
  if (c.valid) assert.deepEqual(validateContract(c.value), c.value);
  else assert.throws(() => validateContract(c.value), /brain.contract.invalid/);
});
test('T05: referências, escopo vazio, identidade e ciclos recusados', () => {
  const catalog = corpus.catalog;
  assert.deepEqual(validateCatalog(catalog), catalog);
  const scope = { project_id: 'proj-example', delivery: 'initiatives', initiative_ids: ['init-example'] };
  validateCatalog(catalog, scope);
  for (const bad of [[...catalog, catalog[0]], catalog.slice(1), [catalog[0], catalog[2]]]) assert.throws(() => validateCatalog(bad));
  assert.throws(() => validateCatalog(catalog, { ...scope, initiative_ids: [] }));
  assert.throws(() => validateCatalog(catalog, { ...scope, delivery: 'project' }));
  const bad = structuredClone(catalog); bad.push({ ...structuredClone(catalog[2]), id: 'init-second', depends_on: ['init-example'] });
  bad[2].depends_on = ['init-second']; assert.throws(() => validateCatalog(bad), /brain.catalog.cycle/);
});
test('T05: integração C1 exige schema e corpus byte a byte da WT OrkMind', () => {
  // O checkout padrão da CI não contém outro repositório. Quando a WT externa
  // está provisionada, a comparação byte a byte continua obrigatória.
  const external = path.join(root, '.orkastery/tmp/orkmind');
  if (!fs.existsSync(external)) {
    assert.deepEqual(validateCatalog(corpus.catalog), corpus.catalog);
    return;
  }
  for (const [local, upstream] of [['core/schemas/company-brain.schema.json', 'src/orkmind/contracts/company-brain.v1.json'],
    ['core/test/fixtures/company-brain-v1.json', 'tests/fixtures/company-brain-v1.json']]) {
    assert.ok(fs.readFileSync(path.join(root, local)).equals(fs.readFileSync(path.join(external, upstream))));
  }
});
