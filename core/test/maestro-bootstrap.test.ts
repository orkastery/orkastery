import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { instalarAdaptador } from '../src/hosts';
import { runMaestroCli } from '../src/maestro-cli';

test('catálogo instalado roteia frase exata para consulta; consulta fixture não cria ciclo', () => {
  const p = projetoTemporario('maestro-bootstrap');
  try {
    const installation = instalarAdaptador('codex', { projeto: p.dir });
    const skill = fs.readFileSync(path.join(installation.destino, 'skills/core/orkastery-bootstrap/SKILL.md'), 'utf8');
    for (const expected of ['orkastery maestro', 'ork_maestro', 'maestro.project.ambiguous', 'a frase não abre outra orquestração', 'Prioridade máxima: usabilidade HITL']) assert.ok(skill.includes(expected), expected);
    let output = ''; const before = fs.readdirSync(path.join(p.dir, '.orkastery')).sort();
    const code = runMaestroCli(['--json'], p.dir, {}, { out: s => { output += s; }, err: s => assert.fail(s) });
    assert.equal(code, 0);
    assert.equal(JSON.parse(output).sections.threads.coverage.total, 0);
    assert.deepEqual(fs.readdirSync(path.join(p.dir, '.orkastery')).sort(), before);
  } finally { p.limpar(); }
});
