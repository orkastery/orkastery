import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withCreationLock } from '../src/creation-operation-store';
import { comLockInspecionavel, reservarDialogoHitl } from '../src/hitl-lock';

test('journal usa a trava portátil no macOS e libera o candidato do dono', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-journal-portatil-'));
  try {
    withCreationLock(root, 'macos', () => assert.ok(true), 'darwin');
    withCreationLock(root, 'macos', () => assert.ok(true), 'darwin');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('macOS usa trava portátil para lock inspecionável e reserva recuperável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-hitl-portatil-'));
  try {
    comLockInspecionavel(dir, 'primeiro', () => {
      assert.throws(() => comLockInspecionavel(dir, 'concorrente', () => assert.fail(), 'darwin'), /ocupado/);
    }, 'darwin');
    const requestId = randomUUID(), connectionId = 'fixture';
    const soltar = reservarDialogoHitl(dir, requestId, connectionId, false, 'darwin');
    assert.throws(() => reservarDialogoHitl(dir, requestId, connectionId, true, 'darwin'), /in-use/);
    soltar();
    reservarDialogoHitl(dir, requestId, connectionId, true, 'darwin')();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
