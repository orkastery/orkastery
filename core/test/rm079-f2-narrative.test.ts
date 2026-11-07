import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (relativo: string) => fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

test('RM-079 F2: página e changelog descrevem o comportamento entregue', () => {
  const pagina = ler('docs/roadmap/RM-079-claims-que-a-correcao-passa.md');
  assert.match(pagina, /## F2 — A claim roda no CI como a sessão escreveu/);
  assert.match(pagina, /opção de valor único repetida com valores diferentes[\s\S]*recusada e nomeada/i);
  assert.match(pagina, /ramo base do manifesto[\s\S]*origin\/<base>/i);
  assert.match(pagina, /artefato `check`[\s\S]*aviso tipado no status/i);

  const naoPublicado = ler('CHANGELOG.md').split('## [0.6.7]')[0];
  assert.match(naoPublicado, /Claims executáveis no CI — F2/);
  assert.match(naoPublicado, /opções de prova repetidas preservam a ordem/i);
  assert.match(naoPublicado, /origin\/<base>/);
  assert.match(naoPublicado, /artefato `check`/);
});

test('RM-079 F2: cópias de marketplace reproduzem as fontes da orientação', () => {
  const skill = ler('skills/phases/check-quality/SKILL.md');
  assert.equal(ler('marketplaces/claude-code/orkastery/skills/phases/check-quality/SKILL.md'), skill);
  assert.equal(ler('marketplaces/codex/orkastery/skills/phases/check-quality/SKILL.md'), skill);
  assert.equal(ler('marketplaces/claude-code/orkastery/agents/ork-check.md'), ler('adapters/claude-code/agents/ork-check.md'));
  assert.match(skill, /ork_artifact_write[\s\S]*tipo `check`/i);
  assert.match(skill, /`docs\/check\.md` na worktree nao e o parecer/i);
});
