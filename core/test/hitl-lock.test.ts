import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirTemporario } from './apoio';
import { comLockInspecionavel } from '../src/hitl-lock';
test('F4: kernel mantém exclusão no dono, identidade é inspecionável, exceção libera sem apagar inode', () => {
  const dir = dirTemporario('lock-kernel'), file = path.join(dir, '.hitl.lock');
  comLockInspecionavel(dir, 'fixture', () => {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.dono.pid, process.pid); assert.equal(data.dono.uid, process.getuid!()); assert.ok(data.dono.inicio); assert.ok(data.dono.bootId);
    assert.throws(() => comLockInspecionavel(dir, 'concorrente', () => assert.fail()), /ocupado/);
    // TTL/PID falsificados não mudam a exclusão do kernel.
    fs.writeFileSync(file, JSON.stringify({ ...data, dono: { pid: 99999999 }, adquiridoEm: '1900-01-01T00:00:00Z' }));
    assert.throws(() => comLockInspecionavel(dir, 'concorrente', () => assert.fail()), /ocupado/);
  });
  const ino = fs.statSync(file).ino;
  assert.throws(() => comLockInspecionavel(dir, 'falha', () => { throw Error('fixture'); }), /fixture/);
  comLockInspecionavel(dir, 'recuperada', () => assert.equal(fs.statSync(file).ino, ino));
});
test('F4: crash do próprio filho libera descritor; recuperação preserva identidade anterior sem remover lock', () => {
  const dir = dirTemporario('lock-crash'), file = path.join(dir, '.hitl.lock');
  const child = spawnSync(process.execPath, ['-e', `require(process.argv[1]).comLockInspecionavel(process.argv[2],'crash-fixture',()=>process.exit(19))`, require.resolve('../src/hitl-lock'), dir], { encoding: 'utf8' });
  assert.equal(child.status, 19, child.stderr);
  const before = JSON.parse(fs.readFileSync(file, 'utf8')), ino = fs.statSync(file).ino;
  assert.equal(before.estado, 'ocupado'); assert.equal(before.dono.pid, child.pid);
  comLockInspecionavel(dir, 'recuperada', () => {
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.anterior.token, before.token); assert.equal(after.anterior.dono.pid, child.pid); assert.equal(fs.statSync(file).ino, ino);
  });
  fs.writeFileSync(path.join(dir, '.hitl.lock'), 'legado sem identidade');
  assert.throws(() => comLockInspecionavel(dir, 'legado', () => assert.fail()), /legado exige inspeção/);
  assert.equal(fs.readFileSync(path.join(dir, '.hitl.lock'), 'utf8'), 'legado sem identidade');
});
