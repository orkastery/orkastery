import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { instalarAdaptador } from '../src/hosts';
import { criarServidorMcp } from '../src/mcp-server';
import { projetoTemporario } from './apoio';

test('claude-code: instalação real temporária e transporte MCP SIMULADO consultam sem criar', async () => {
  const p = projetoTemporario('maestro-claude');
  const install = instalarAdaptador('claude-code', { projeto: p.dir });
  const entry = fs.readFileSync(path.join(install.destino, 'commands/ork.md'), 'utf8');
  for (const text of ['orkastery maestro', 'ork_maestro', 'ork_request_decision', 'sandbox']) assert.ok(entry.includes(text), text);
  const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
  const client = new Client({ name: 'SIMULADO-claude', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const result = await client.callTool({ name: 'ork_maestro', arguments: {} });
    assert.ok(!result.isError);
    const snapshot = JSON.parse((result.content as { text: string }[])[0].text);
    assert.equal(snapshot.schema, 'ork.maestro-snapshot/v1');
    assert.equal(snapshot.sections.threads.coverage.total, 0);
    assert.equal((await client.callTool({ name: 'ork_maestro', arguments: { resposta: '1', root: '/tmp' } })).isError, true);
  } finally { await client.close(); await server.close(); p.limpar(); }
});
