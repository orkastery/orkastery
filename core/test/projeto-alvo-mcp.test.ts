/**
 * RM-052 (T4): o MCP (Claude Code e Codex) com `projeto` em toda tool.
 *
 * O servidor nasce fixado num projeto pela instalacao (`--project`). O parametro `projeto` so
 * CONFERE esse projeto: outro nome recusa com `projeto.fora-do-servidor` e a raiz nunca muda por
 * argumento de tool (D5). O `ork_roadmap_status` declara o projeto consultado.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarServidorMcp } from '../src/mcp-server';
import { init } from '../src/init';
import { exigirManifesto } from '../src/manifest';
import { novaThread } from '../src/thread';
import { lerRegistroDeProjetos, registrarProjeto } from '../src/projeto-alvo';
import { dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

async function comServidor(corpo: (p: ProjetoDeTeste, c: Client) => Promise<void>): Promise<void> {
  const p = projetoTemporario('projeto-alvo-mcp');
  const outro = projetoTemporario('projeto-alvo-mcp-outro');
  init(outro.dir, { nome: 'workspace', abbrev: 'wor', force: true });
  outro.carregado = exigirManifesto(outro.dir);
  const anterior = process.env.ORK_USUARIO_DIR, usuario = dirTemporario('projeto-alvo-mcp-usuario');
  process.env.ORK_USUARIO_DIR = usuario;
  registrarProjeto(outro.dir, 'init');
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex' });
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try { await server.connect(st); await client.connect(ct); await corpo(p, client); }
  finally {
    await client.close(); await server.close(); p.limpar(); outro.limpar();
    process.env.ORK_USUARIO_DIR = anterior; fs.rmSync(usuario, { recursive: true, force: true });
  }
}

async function chamar(c: Client, name: string, args: Record<string, unknown>) {
  const r = await c.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[]).filter((x) => x.type === 'text').map((x) => x.text).join('');
  return { erro: r.isError === true, text, data: () => JSON.parse(text) };
}

test('toda tool do MCP aceita projeto (so nome, schema fechado); o projeto servido passa, outro recusa tipado e a raiz nao muda', () =>
  comServidor(async (p, c) => {
    const t = novaThread(p.carregado, { nome: 'Fixture', modo: 'auto' }).thread;
    const tools = (await c.listTools()).tools;
    // A RM-052 nao soma tool; a 26a e o ork_brain_dossie da RM-026, a 27a a ork_decision_record da RM-037, a RM-051 soma
    // ork_roadmap_reservas e ork_fabrica, e a RM-054 (fatia 2) soma ork_network_roadmap, todas com projeto.
    assert.equal(tools.length, 30, 'nenhuma tool nova no catalogo alem das cinco nomeadas');
    for (const nome of ['ork_decision_record', 'ork_brain_dossie', 'ork_roadmap_reservas', 'ork_fabrica', 'ork_network_roadmap']) assert.ok(tools.some((x) => x.name === nome), nome);
    for (const tool of tools) {
      const props = tool.inputSchema.properties as Record<string, { pattern?: string }>;
      assert.ok(props.projeto, `${tool.name} aceita projeto`);
      assert.equal(props.projeto.pattern, '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$');
      assert.ok(!(tool.inputSchema.required ?? []).includes('projeto'), `${tool.name}: projeto e opcional`);
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    assert.equal((await chamar(c, 'ork_thread_status', { threadId: t.id, projeto: 'orkastery' })).erro, false);
    assert.equal((await chamar(c, 'ork_thread_status', { threadId: t.id, projeto: 'ORK' })).erro, false, 'abbrev sem caixa');
    assert.equal((await chamar(c, 'ork_thread_status', { threadId: t.id })).erro, false, 'sem projeto, o servido');

    const fora = await chamar(c, 'ork_thread_status', { threadId: t.id, projeto: 'workspace' });
    assert.equal(fora.erro, true);
    assert.equal(fora.data().erro, 'projeto.fora-do-servidor');
    assert.deepEqual(fora.data().candidatos.map((x: { nome: string }) => x.nome), ['orkastery'], 'so o projeto servido, nunca os outros');
    assert.match(fora.data().correcao, /ork mcp install --project <raiz>/);
    for (const projeto of ['/tmp/outro', '../workspace', '']) {
      const r = await chamar(c, 'ork_thread_status', { threadId: t.id, projeto });
      assert.equal(r.erro, true, `caminho recusado pelo schema: ${projeto}`);
    }
    const depois = await chamar(c, 'ork_thread_status', { threadId: t.id });
    assert.equal(depois.data().thread.id, t.id, 'a raiz servida continua a mesma');
  }));

test('ork_roadmap_status declara o projeto consultado com origem instalacao, sem revelar os outros projetos', () =>
  comServidor(async (_p, c) => {
    const r = await chamar(c, 'ork_roadmap_status', { projeto: 'orkastery' });
    assert.equal(r.erro, false, r.text);
    const { texto, status } = r.data();
    assert.equal(status.consulta.projeto.nome, 'orkastery');
    assert.equal(status.consulta.projeto.origem, 'instalacao');
    assert.ok(!status.consulta.naoLido.some((x: string) => /outros projetos/.test(x)), 'fixado num projeto, nao conta os demais');
    const linhas = texto.split('\n');
    assert.match(linhas[0], /^Roadmap do Orkastery /);
    assert.match(linhas[1], /^Projeto consultado: orkastery \(ork\) · .* · fixado na instalação do servidor MCP$/);
    const tool = (await c.listTools()).tools.find((x) => x.name === 'ork_roadmap_status')!;
    assert.match(tool.description ?? '', /nunca conclua sobre ele a partir de ork_maestro/);
    const maestro = (await c.listTools()).tools.find((x) => x.name === 'ork_maestro')!;
    assert.match(maestro.description ?? '', /zero threads nunca é roadmap vazio/);
    const snapshot = (await chamar(c, 'ork_maestro', { projeto: 'orkastery' })).data();
    assert.ok(!snapshot.notConsulted.some((x: string) => /outros projetos/.test(x)));
    assert.equal((await chamar(c, 'ork_maestro', { projeto: 'workspace' })).data().erro, 'projeto.fora-do-servidor');
  }));

test('ork_thread_new do MCP registra o projeto servido na maquina', () =>
  comServidor(async (p, c) => {
    const r = await chamar(c, 'ork_thread_new', { nome: 'Pelo MCP', modo: 'auto', projeto: 'orkastery' });
    assert.equal(r.erro, false, r.text);
    const registrado = lerRegistroDeProjetos().projetos.find((x) => x.raiz === fs.realpathSync(p.dir));
    assert.equal(registrado?.fonte, 'mcp thread new');
  }));
