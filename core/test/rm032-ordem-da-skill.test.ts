/**
 * RM-032 (ordem da skill): a skill de entrada do host so manda consultar o `ork` no shell depois da
 * `ork_maestro`.
 *
 * Na segunda rodada da prova de ativacao do Codex (03/10/2026, PR #66), o `ork doctor`, o
 * `ork onboarding` e o `ork experiencia show` rodaram no shell antes da tool. A skill `ork` do Codex
 * proibia o `ork` no shell antes da tool e, no paragrafo seguinte, mandava "Consulte `ork experiencia
 * show --json`" sem ordem; a do Hermes abria com a mesma consulta. O CLI resolve o projeto pelo
 * diretorio da sessao, a classe de erro que a frase `orkastery maestro` evita.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const RAIZ = path.resolve(__dirname, '..', '..', '..');

const ENTRADAS = [
  'adapters/codex/skills/ork/SKILL.md',
  'marketplaces/codex/orkastery/skills/ork/SKILL.md',
  'adapters/hermes/skills/orkastery-devmaster/SKILL.md',
];

/** Corpo da skill sem o frontmatter: a descricao nao e instrucao de ordem. */
function corpo(rel: string): string {
  const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  return texto.startsWith('---') ? texto.slice(texto.indexOf('\n---', 3) + 4) : texto;
}

test('RM-032 ordem da skill: a consulta de experiencia vem depois da ork_maestro em cada entrada de host', () => {
  for (const rel of ENTRADAS) {
    const texto = corpo(rel);
    const tool = texto.indexOf('ork_maestro');
    const experiencia = texto.indexOf('ork experiencia show');
    assert.ok(tool >= 0, `${rel}: cita a ork_maestro`);
    assert.ok(experiencia >= 0, `${rel}: cita a consulta de experiencia (experiencia-hosts.test)`);
    assert.ok(tool < experiencia, `${rel}: a ork_maestro vem antes de qualquer ork experiencia show`);
    // A frase que manda consultar a experiencia diz que e depois da tool.
    const consulta = texto.search(/consulte `ork experiencia show/i);
    assert.ok(consulta >= 0, `${rel}: tem a instrucao de consultar a experiencia`);
    const frase = texto.slice(Math.max(0, texto.lastIndexOf('\n\n', consulta)), consulta);
    assert.match(frase, /depois d[ae]la|depois da `ork_maestro`/i, `${rel}: a consulta diz "depois da ork_maestro"`);
  }
});

test('RM-032 ordem da skill: o Codex lista a experiencia entre os ork que nao rodam antes da tool', () => {
  for (const rel of ENTRADAS.slice(0, 2)) {
    const texto = corpo(rel).replace(/\s+/g, ' ');
    assert.match(texto, /não rode `ork maestro`, `ork doctor`, `ork onboarding` nem `ork experiencia show` no shell antes/, rel);
  }
});
