import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarServidorMcp } from '../src/mcp-server';
import { listarReservas } from '../src/roadmap-reservas';
import { executarReservaCoordenada, executarSagaDaThread, type PortaColetivaDaSaga,
  type PortaLocalDaSaga } from '../src/rede-empresa-operacao';
import { commitar, projetoTemporario } from './apoio';
import { exec } from '../src/util';

async function chamar(client: Client, nome: string, argumentos: Record<string, unknown>) {
  const r = await client.callTool({ name: nome, arguments: argumentos });
  assert.ok(Array.isArray(r.content));
  const texto = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return { erro: r.isError === true, dados: JSON.parse(texto) };
}

test('ork_thread_new aceita roadmap, usa a saga e preserva o contrato sem roadmap', async () => {
  const p = projetoTemporario('rm089-mcp-entrada', true);
  commitar(p.dir, 'docs/roadmap/RM-089-rede.md', '# RM-089\n', 'roadmap: RM-089');
  exec('git', ['push', '-q', 'origin', 'main'], p.dir);
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex' });
  const client = new Client({ name: 'rm089-fixture', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'ork_thread_new');
    assert.ok(tool && 'properties' in tool.inputSchema && (tool.inputSchema.properties as Record<string, unknown>).roadmap);
    const antiga = await chamar(client, 'ork_thread_new', { nome: 'sem item', modo: 'auto' });
    assert.equal(antiga.erro, false); assert.equal(antiga.dados.thread.roadmap, undefined); assert.equal(antiga.dados.coordenacao, undefined);
    const nova = await chamar(client, 'ork_thread_new', { nome: 'com item', modo: 'auto', roadmap: 'RM-089' });
    assert.equal(nova.erro, false);
    assert.deepEqual([nova.dados.thread.roadmap, nova.dados.coordenacao.cobertura.permite], ['RM-089', true]);
    assert.match(nova.dados.coordenacao.operationId, /^op-/);
    const reserva = listarReservas(p.dir).reservas.find((r) => r.item === 'RM-089');
    assert.equal(reserva?.thread, nova.dados.thread.id);
    assert.equal(reserva?.operationId, nova.dados.coordenacao.operationId);
  } finally { await client.close(); await server.close(); p.limpar(); }
});

test('reserva e criação de thread propagam a mesma recusa coletiva antes do efeito local', () => {
  const coletiva: PortaColetivaDaSaga = { reservar: () => { throw Object.assign(new Error('reserva existente'),
    { codigo: 'rede-empresa.reserva-existente' }); }, soltar: () => true };
  let locais = 0;
  const local: PortaLocalDaSaga<string> = { reservar: () => { locais++; return { fingerprint: 'local', valor: 'local' }; },
    vincular: () => { locais++; return { fingerprint: 'vinculo', valor: 'vinculo' }; }, soltar: () => true };
  for (const comThread of [false, true]) {
    const p = projetoTemporario(`rm089-paridade-${comThread}`);
    try {
      const base = { raiz: p.dir, projectKey: 'github:github.com/time/projeto', itemId: 'RM-089', coletiva, local,
        operationId: `op-${comThread ? 'a' : 'b'}1234567890abcdef` };
      assert.throws(() => comThread
        ? executarSagaDaThread({ ...base, criarThread: () => ({ threadId: 'ork-x', valor: 'thread' }) })
        : executarReservaCoordenada(base), (e: unknown) => (e as { codigo?: string }).codigo === 'rede-empresa.reserva-existente');
    } finally { p.limpar(); }
  }
  assert.equal(locais, 0);
});
