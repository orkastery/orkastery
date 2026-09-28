import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { instalarAdaptador, MAESTRO_HOST_SURFACES, Host } from '../src/hosts';
import { criarServidorMcp } from '../src/mcp-server';
import { projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';
import { runMaestroCli } from '../src/maestro-cli';
import { validateMaestroSnapshot } from '../src/maestro-contract';

test('quatro instalações reais temporárias; paridade de contrato MCP/CLI SIMULADA', async () => {
  const p = projetoTemporario('maestro-parity');
  try {
    const t = novaThread(p.carregado, { nome: 'Paridade', modo: 'auto' }).thread;
    const matrix = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/maestro-host-matrix.json'), 'utf8'));
    assert.equal(matrix.evidenceKind, 'simulated'); assert.equal(matrix.liveActivation, 'pending');
    let expected: unknown;
    for (const row of matrix.hosts) {
      const host = row.host as Host, install = instalarAdaptador(host, { projeto: p.dir });
      assert.equal(install.ok, true); assert.equal(row.entry, MAESTRO_HOST_SURFACES[host].entry);
      const receipt = JSON.parse(fs.readFileSync(path.join(install.destino, 'INSTALADO.json'), 'utf8'));
      for (const a of receipt.arquivos) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(install.destino, a.arquivo))).digest('hex'), a.sha256);
      assert.ok(receipt.arquivos.some((a: { arquivo: string }) => a.arquivo === row.entry));
      let raw: unknown;
      if (host === 'codex' || host === 'claude-code') {
        const server = criarServidorMcp({ projeto: p.dir, host }), client = new Client({ name: 'SIMULADO', version: '1' });
        const [ct, st] = InMemoryTransport.createLinkedPair();
        try {
          await server.connect(st); await client.connect(ct);
          const result = await client.callTool({ name: 'ork_maestro', arguments: {} });
          assert.ok(!result.isError); raw = JSON.parse((result.content as { text: string }[])[0].text);
          assert.equal((await client.callTool({ name: 'ork_maestro', arguments: { shell: 'true' } })).isError, true);
        } finally { await client.close(); await server.close(); }
      } else {
        // CLI em processo: os wrappers e o SDK têm testes próprios de argv/erro.
        assert.equal(runMaestroCli(['--json'], p.dir, {}, { out: s => { raw = JSON.parse(s); }, err: assert.fail }), 0);
        assert.equal(runMaestroCli(['--shell', 'true'], p.dir, {}, { out: assert.fail, err: () => {} }), 2);
      }
      const snapshot = validateMaestroSnapshot(raw);
      const normalized = { project: snapshot.project.id, threads: snapshot.sections.threads.items,
        blockers: snapshot.sections.blockers.items, hitl: snapshot.sections.hitl.items, ship: snapshot.sections.ship.items };
      assert.equal(snapshot.sections.threads.items[0].id, t.id);
      if (!expected) expected = normalized; else assert.deepEqual(normalized, expected);
    }
  } finally { p.limpar(); }
});
