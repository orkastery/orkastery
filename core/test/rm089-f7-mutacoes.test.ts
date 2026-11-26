import assert from 'node:assert/strict';
import test from 'node:test';

test('C124 a lane adversarial fica fora da lane hermética comum', () => {
  assert.equal(process.env.NODE_TEST_CONTEXT === 'child-v8' || process.env.NODE_TEST_CONTEXT === undefined, true);
  assert.equal(process.env.ORK_MUTATION_CHILD, undefined);
});
