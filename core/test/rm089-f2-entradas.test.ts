import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarServidorMcp } from '../src/mcp-server';
import { listarReservas } from '../src/roadmap-reservas';
import { executarReservaCoordenada, executarSagaDaThread, type PortaColetivaDaSaga,
  portaColetivaDoProjeto, type PortaLocalDaSaga } from '../src/rede-empresa-operacao';
import { gravarAdesaoRedeEmpresa } from '../src/rede-empresa-config';
import { commitar, projetoTemporario } from './apoio';
import { exec } from '../src/util';
import { coordenacaoColetivaDosArgs } from '../src/index';

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
    assert.ok(tool && 'properties' in tool.inputSchema && (tool.inputSchema.properties as Record<string, unknown>).coordenacao);
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

test('B2/B6: CLI interpreta colaboração, acordo e exceção auditável com referências fechadas', () => {
  const sha = 'a'.repeat(64);
  const acordo = coordenacaoColetivaDosArgs({ coordenacao: 'acordo', 'atestacao-forja': 'github',
    'atestacao-id': '77', 'atestacao-endpoint': 'repos/time/rede/issues/comments/77', 'atestacao-sha256': sha });
  assert.deepEqual(acordo, { acao: 'acordo', atestacao: { forja: 'github', id: 77,
    endpoint: 'repos/time/rede/issues/comments/77', sha256: sha } });
  const excecao = coordenacaoColetivaDosArgs({ coordenacao: 'reserva', 'excecao-responsavel': '41',
    'excecao-justificativa': 'incidente-17', 'excecao-expira-em': '2026-11-12T12:00:00.000Z',
    'excecao-forja': 'gitlab', 'excecao-id': '88',
    'excecao-endpoint': 'projects/time%2Frede/issues/1/notes/88', 'excecao-sha256': sha });
  assert.deepEqual(excecao.excecao, { responsavelAccountId: 41, justificativaId: 'incidente-17',
    expiraEm: '2026-11-12T12:00:00.000Z', referencia: { forja: 'gitlab', id: 88,
      endpoint: 'projects/time%2Frede/issues/1/notes/88', sha256: sha } });
  assert.throws(() => coordenacaoColetivaDosArgs({ coordenacao: 'acordo' }), /acordo-ausente/);
});

test('B6: inscrição ativa sem cache fica configurada e não conferida no fail-open', () => {
  const p = projetoTemporario('rm089-cobertura-configurada', true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rm089-cobertura-home-'));
  const ref = (caminho: string) => ({ forja: 'github' as const, host: 'github.com', caminho });
  try {
    exec('git', ['remote', 'set-url', 'origin', 'https://github.com/time/projeto.git'], p.dir);
    gravarAdesaoRedeEmpresa({ inscricaoId: 'inscricao-a', empresa: ref('time/rede'), rede: ref('pessoa/rede'),
      maestroRef: { forja: 'github', host: 'github.com', accountId: 41 }, loginAtual: 'login', politicaVersao: 'v2',
      projetos: [ref('time/projeto')], estado: 'ativa', ultimaPublicacao: null, pendencia: null }, { ORKASTERY_HOME: home });
    const coletiva = portaColetivaDoProjeto(p.dir, p.carregado.manifesto, 'RM-089', 'GOAL',
      { env: { ORKASTERY_HOME: home } });
    const cobertura = coletiva.porta.reservar('op-cobertura1234567890').valor.cobertura;
    assert.deepEqual([coletiva.configurada, cobertura.estado, cobertura.codigo, cobertura.permite],
      [true, 'nao-conferida', 'rede-empresa.cobertura-aviso', true]);
  } finally { fs.rmSync(home, { recursive: true, force: true }); p.limpar(); }
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
