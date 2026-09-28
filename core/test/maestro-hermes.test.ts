import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { instalarAdaptador } from '../src/hosts';
import { projetoTemporario } from './apoio';

test('Hermes instalado executa argv sem shell-eval e preserva exit/erro do núcleo fixture', () => {
  const p = projetoTemporario('maestro-hermes');
  try {
    const install = instalarAdaptador('hermes', { projeto: p.dir });
    const bin = path.join(p.dir, 'cli fixture');
    fs.writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n', { mode: 0o755 });
    const literal = 'a b; $(touch INJETADO) `id`';
    const r = spawnSync('/bin/sh', [path.join(install.destino, 'bin/ork-maestro.sh'), '--thread', literal],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ORK_BIN: bin } });
    assert.equal(r.error, undefined, r.error?.message); assert.equal(r.status, 7);
    assert.deepEqual(r.stdout.trim().split('\n'), ['maestro', '--json', '--thread', literal]);
    assert.equal(fs.existsSync(path.join(p.dir, 'INJETADO')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(install.destino, 'hermes.plugin.json'), 'utf8'));
    assert.equal(manifest.bin.ork_maestro, './bin/ork-maestro.sh');
    assert.match(fs.readFileSync(path.join(install.destino, 'skills/orkastery-devmaster/SKILL.md'), 'utf8'), /orkastery maestro/);
  } finally { p.limpar(); }
});
