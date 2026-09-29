import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as experiencia from '../src/mcp-experiencia';
import * as reservas from '../src/roadmap-reservas';
import * as fabrica from '../src/fabrica-estado';
import { criarServidorMcp } from '../src/mcp-server';
import { projetoTemporario } from './apoio';

test('consulta distingue lista atual vazia, cópia desatualizada e indisponibilidade', () => {
  const vazio = experiencia.apresentarConsulta({ reservas: [], atualizado: true, ponta: null });
  assert.equal(vazio.estado, 'atualizado'); assert.ok(vazio.dados);
  assert.equal(experiencia.apresentarConsulta({ maquinas: [], atualizado: false, ponta: 'a'.repeat(40) }).estado, 'desatualizado');
  const offline = experiencia.apresentarConsulta({ reservas: [], atualizado: false, ponta: null });
  assert.equal(offline.estado, 'indisponivel'); assert.equal(offline.dados, null);
  assert.ok(offline.motivo);
});

test('schemas recusam escolha de projeto, remoto ou operação de escrita', () => {
  for (const args of [{ projeto: '/tmp/outro' }, { remoto: 'outro' }, { threadId: 'outra' }, { publicar: true }, { reservar: true }]) {
    assert.equal(experiencia.consultaExperienciaSchema.safeParse(args).success, false);
  }
});

test('MCP expõe somente consultas de argumentos vazios, com raiz e transporte fixados no startup', async () => {
  const p = projetoTemporario('mcp-experiencia');
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex' });
  const client = new Client({ name: 'experiencia-fixture', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const tools = (await client.listTools()).tools;
    for (const name of ['ork_roadmap_reservas', 'ork_fabrica']) {
      const tool = tools.find(t => t.name === name)!;
      assert.equal(tool.annotations?.readOnlyHint, true); assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal((await client.callTool({ name, arguments: { remoto: 'outro' } })).isError, true);
      const r = await client.callTool({ name, arguments: {} });
      assert.ok(!r.isError);
      assert.equal(JSON.parse((r.content as { text: string }[])[0].text).estado, 'indisponivel');
    }
    assert.ok(!tools.some(t => /ork_(roadmap_pegar|fabrica_publicar)/.test(t.name)));
  } finally { await client.close(); await server.close(); p.limpar(); }
});

test('leitores nativos recebem origin fixo, propagam falha e nunca chamam escritores', () => {
  const chamadas: unknown[] = [];
  const r = mock.method(reservas, 'listarReservas', (raiz: string, opcoes: { remoto?: string }) => {
    chamadas.push([raiz, opcoes]); return { atualizado: true, ponta: null, reservas: [] };
  });
  const f = mock.method(fabrica, 'lerFabrica', () => { throw Error('indisponibilidade simulada'); });
  const pegar = mock.method(reservas, 'pegarItem', () => { throw Error('escrita proibida'); });
  const publicar = mock.method(fabrica, 'publicarMaquina', () => { throw Error('escrita proibida'); });
  try {
    assert.equal(experiencia.consultarPainel('/tmp/projeto-fixado', 'reservas').estado, 'atualizado');
    assert.deepEqual(chamadas, [['/tmp/projeto-fixado', { remoto: 'origin' }]]);
    assert.equal(experiencia.consultarPainel('/tmp/projeto-fixado', 'fabrica').estado, 'indisponivel');
    assert.equal(pegar.mock.callCount(), 0); assert.equal(publicar.mock.callCount(), 0);
  } finally { r.mock.restore(); f.mock.restore(); pegar.mock.restore(); publicar.mock.restore(); }
});

test('transporte não autorizado ou indisponível não retorna sucesso vazio', () => {
  const p = projetoTemporario('mcp-experiencia-sem-remoto');
  try {
    const ler = experiencia.criarLeitorExperiencia(p.dir, 'github-ssh');
    assert.equal(ler('reservas').estado, 'indisponivel');
    assert.equal(ler('fabrica').dados, null);
  } finally { p.limpar(); }
});
