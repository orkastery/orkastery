import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('job macOS executa a prova do pacote instalado', () => {
  const raiz = path.resolve(__dirname, '..', '..', '..');
  const workflow = fs.readFileSync(path.join(raiz, '.github/workflows/ci.yml'), 'utf8');
  const script = fs.readFileSync(path.join(raiz, 'core/scripts/provar-macos-instalado.cjs'), 'utf8');
  assert.match(workflow, /portabilidade-macos:[\s\S]*runs-on: macos-latest/);
  assert.match(workflow, /node core\/scripts\/provar-macos-instalado\.cjs/);
  assert.match(script, /npm', \['pack'/);
  assert.match(script, /npm', \['install'/);
  assert.match(script, /node_modules', '\.bin'/);
  assert.match(script, /\['demo'\]/);
  assert.match(script, /'thread', 'new'/);
  assert.match(script, /'doctor', '--json'/);
  assert.match(script, /dist', 'verify\.js'/);
  assert.doesNotMatch(script, /node core\/dist\/index\.js/);
});
