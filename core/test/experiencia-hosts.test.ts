import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { instalarAdaptador } from '../src/hosts';
import { skillsDoCatalogo } from '../src/catalogo';
import { projetoTemporario } from './apoio';
const catalogo = path.resolve(__dirname, '../../..');
const variantes = ['orchestration-experience', 'orchestration-experience-pt-br'];

test('Claude declara todas as skills distribuídas; Codex e Hermes referenciam arquivos reais', () => {
  for (const host of ['claude-code', 'codex', 'hermes'] as const) {
    const p = projetoTemporario('experiencia-hosts');
    try {
      const r = instalarAdaptador(host, { projeto: p.dir, catalogo, orkBin: 'ork' });
      for (const nome of variantes) {
        const rel = host === 'hermes' ? `skills/${nome}/SKILL.md` : `skills/core/${nome}/SKILL.md`;
        assert.equal(fs.readFileSync(path.join(r.destino, rel), 'utf8'), fs.readFileSync(path.join(catalogo, 'skills/core', nome, 'SKILL.md'), 'utf8'));
      }
      if (host === 'claude-code') {
        const plugin = JSON.parse(fs.readFileSync(path.join(r.destino, '.claude-plugin/plugin.json'), 'utf8'));
        assert.equal(plugin.skills.length, skillsDoCatalogo(catalogo).length);
        for (const rel of plugin.skills) assert.ok(fs.existsSync(path.join(r.destino, rel, 'SKILL.md')));
        assert.equal(plugin.author.name, 'Equipe Orkastery');
      } else {
        const entrada = fs.readFileSync(path.join(r.destino, host === 'codex' ? 'skills/ork/SKILL.md' : 'skills/orkastery-devmaster/SKILL.md'), 'utf8');
        assert.ok(entrada.includes('ork experiencia show --json'));
        for (const nome of variantes) assert.ok(entrada.includes(nome));
      }
    } finally { p.limpar(); }
  }
});

test('OpenClaw mantém lacuna explícita e não recebe bloco de outro host', () => {
  const p = projetoTemporario('experiencia-openclaw');
  try {
    const r = instalarAdaptador('openclaw', { projeto: p.dir, catalogo, orkBin: 'ork' });
    assert.equal(r.experiencia?.ativa, false);
    assert.ok(!r.arquivos.some(a => variantes.some(v => a.relativo.includes(v))));
    assert.ok(!fs.existsSync(path.join(p.dir, '.orkastery/experiencia')));
  } finally { p.limpar(); }
});
