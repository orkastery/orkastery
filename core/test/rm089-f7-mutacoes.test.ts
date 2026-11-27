import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('a lane adversarial tem comando explícito e catálogo completo sem IDs repetidos', () => {
  const raiz = path.resolve(__dirname, '../..');
  const pacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  assert.equal(pacote.scripts?.['test:rm089-f7-mutacoes'],
    'npm run build:test && node scripts/rm089-f7-mutacoes.mjs');
  const fonte = fs.readFileSync(path.join(raiz, 'scripts/rm089-f7-mutacoes.mjs'), 'utf8');
  const ids = [...fonte.matchAll(/M\('(MF\d+)'/g)].map((m) => m[1]);
  assert.equal(ids.length, 58);
  assert.equal(new Set(ids).size, 58);
});
