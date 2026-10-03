/**
 * Suspeitas da revisao de 03/10 (thread ork-suspeitasdar): a prova de ativacao reprova o `ork
 * maestro` pelo shell do host, mas so reconhecia a forma `ork [--projeto X] maestro`. Outras formas
 * que rodam o mesmo CLI (pelo caminho do binario, pelo node, pelo npx, com o projeto entre aspas)
 * passavam como chamada qualquer: ao lado da chamada contratada, a prova saia verde.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { transcriptDoClaude, transcriptDoCodex } from '../src/prova-ativacao';

const viaDoBash = (command: string) => transcriptDoClaude([
  { type: 'system', subtype: 'init', tools: ['Bash', 'mcp__orkastery__ork_maestro'] },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }] } },
  { type: 'result', subtype: 'success', result: 'ok' },
].map((e) => JSON.stringify(e)).join('\n') + '\n').chamadas.map((c) => c.via);

const DESVIOS = [
  'ork maestro --json',
  'bash -lc "$(which ork) maestro --json"',
  'bash -lc "`which ork` maestro"',
  'node core/dist/index.js maestro --json',
  'node /home/julio/orkastery/core/dist/index.js maestro',
  'npx @orkastery/cli maestro --json',
  'npx -y @orkastery/cli@0.5.2 maestro',
  'ork --projeto "/srv/meu projeto" maestro --json',
  "ork --projeto='/srv/meu projeto' maestro",
  'cd /srv/x && ork maestro',
  'ORK_PROJETO=orkastery ork maestro',
];

const NAO_DESVIOS = [
  'grep -n maestro core/src/index.ts',
  'cat ~/orkastery/docs/maestro.md',
  'ork thread status ork-x',
  'ls ork-maestro/',
  'echo maestro && ork doctor',
  'ork maestrox',
  'ork thread new "estudar o maestro" --modo auto',
  'ork claims add t x --claim "o maestro responde"',
];

test('suspeitas 03/10: toda forma de rodar o `ork maestro` pelo shell e desvio', () => {
  const perdidos = DESVIOS.filter((c) => viaDoBash(c)[0] !== 'shell');
  assert.deepEqual(perdidos, [], 'formas que a prova nao reconhecia como desvio');
});

test('suspeitas 03/10: shell que nao roda o maestro do ork nao vira desvio', () => {
  const falsos = NAO_DESVIOS.filter((c) => viaDoBash(c).length !== 0);
  assert.deepEqual(falsos, [], 'comandos classificados como desvio sem rodar o maestro');
});

test('suspeitas 03/10: os outros hosts usam o mesmo reconhecimento', () => {
  const codex = transcriptDoCodex([
    { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'bash -lc "node core/dist/index.js maestro --json"', status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'bash -lc "node core/dist/index.js maestro --json"', aggregated_output: '{}', exit_code: 0, status: 'completed' } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n', ['mcp__orkastery__ork_maestro']);
  assert.deepEqual(codex.chamadas.map((c) => c.via), ['shell']);
});
