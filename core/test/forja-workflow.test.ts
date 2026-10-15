import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('o job ork-verify faz checkout do head exato do PR', () => {
  const yml = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/ci.yml'), 'utf8');
  const job = yml.slice(yml.indexOf('  ork-verify:'), yml.indexOf('\n  documentacao'));
  assert.match(job, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
});
