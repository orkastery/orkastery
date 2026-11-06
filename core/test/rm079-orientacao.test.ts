import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PROMPTS_EN, PROMPTS_PT_BR } from '../src/locale-prompts';

const RAIZ = path.resolve(__dirname, '../../..');

function ler(relativo: string): string {
  return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

test('RM079 orientacao: CHECK separa claim positiva da reproducao em pt-BR', () => {
  const skill = ler('skills/phases/check-quality/SKILL.md');
  const agente = ler('adapters/claude-code/agents/ork-check.md');
  assert.match(skill, /claim nascida no CHECK afirma o comportamento correto esperado/i);
  assert.match(skill, /comando que reproduz o defeito fica somente no parecer/i);
  assert.match(skill, /- A<n> \[bloqueador\|aviso\|sugestao\] caminho:linha - descricao/);
  assert.match(agente, /reproducao do defeito[\s\S]*nunca vira claim/i);
  assert.match(PROMPTS_PT_BR.contratoDasFases.CHECK, /Claim nova afirma o comportamento correto/);
});

test('RM079 orientation: CHECK separates a positive claim from reproduction in English', () => {
  const skill = ler('core/assets/skills-en/phases/check-quality/SKILL.md');
  const agent = ler('core/assets/adapters-en/claude-code/agents/ork-check.md');
  assert.match(skill, /claim created during CHECK states the expected correct behavior/i);
  assert.match(skill, /command that reproduces the defect stays only in the report/i);
  assert.match(skill, /- A<n> \[blocker\|warning\|suggestion\] path:line - description/);
  assert.match(agent, /defect reproduction[\s\S]*never becomes a claim/i);
  assert.match(PROMPTS_EN.contratoDasFases.CHECK, /new claim states the correct behavior/);
});
