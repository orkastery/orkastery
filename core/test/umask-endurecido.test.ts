/**
 * O ork endurece o umask ao iniciar: o que ele cria e o que ele despacha nasce sem escrita de grupo
 * nem de outros (bits 0o022, a mesma regra do sensor), sem afrouxar um umask mais restrito.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { endurecerUmask } from '../src/preflight';

test('umask 002 vira 022 e o arquivo criado depois nasce sem escrita de grupo', () => {
  const original = process.umask(0o002);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-umask-'));
  try {
    const r = endurecerUmask();
    assert.equal(r.anterior, 0o002);
    assert.equal(r.atual, 0o022);
    const f = path.join(dir, 'arquivo');
    fs.writeFileSync(f, 'x');
    assert.equal(fs.statSync(f).mode & 0o777, 0o644);
  } finally {
    process.umask(original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('umask mais restrito continua como esta', () => {
  const original = process.umask(0o077);
  try {
    assert.equal(endurecerUmask().atual, 0o077);
  } finally {
    process.umask(original);
  }
});

test('processo filho herda o umask endurecido', () => {
  const original = process.umask(0o002);
  try {
    endurecerUmask();
    const r = spawnSync('sh', ['-c', 'umask'], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '0022');
  } finally {
    process.umask(original);
  }
});
