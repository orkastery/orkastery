/**
 * RM-008 (03/10/2026): as orientacoes aos agentes ensinam o aceite por omissao COM a thread.
 *
 * Os condutores copiavam `ork master --aceitar-omissao` das skills, dos adaptadores, do AGENTS.md e dos
 * guias, e a forma sem thread fechava tambem as entregues de outras frentes paralelas. O teste de
 * comportamento esta em `master-omissao-alvo.test.ts`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { blocoAgentsMd } from '../src/agents-md';
import { exigirManifesto } from '../src/manifest';

const RAIZ_DO_REPO = path.resolve(__dirname, '../../..');

test('as orientacoes aos agentes ensinam a forma com a thread', () => {
  // AGENTS.md, as skills, os adaptadores e os guias que citam --aceitar-omissao.
  const arquivos = ['AGENTS.md', 'skills/phases/master-metrics/SKILL.md', 'adapters/claude-code/commands/master.md',
    'adapters/claude-code/agents/ork-master.md', 'adapters/hermes/skills/orkastery-devmaster/SKILL.md',
    'docs/guias/contribuir/com-o-ork.md', 'docs/comecar/quickstart.md', 'docs/referencia/cli.md'];
  for (const a of arquivos) {
    const conteudo = fs.readFileSync(path.join(RAIZ_DO_REPO, a), 'utf8');
    assert.match(conteudo, /ork master <thread(-id)?> --aceitar-omissao/, `${a} ensina a forma com a thread`);
  }
});

test('o bloco do AGENTS.md que o ork init escreve tambem ensina a forma com a thread', () => {
  const bloco = blocoAgentsMd(exigirManifesto(RAIZ_DO_REPO).manifesto);
  assert.match(bloco, /`ork master <thread> --aceitar-omissao`/);
});
