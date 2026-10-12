/**
 * RM-026 K7, fatia 2: as tools `ork_conhecimento_*` no MCP do projeto, só leitura, com o mesmo JSON da consulta da
 * CLI e o id do Brain conferido por `get` pelo transporte do Company Brain (um `memory.cli` falso). Cada teste reprova
 * no código de antes desta fatia: a base (`1079f471`) não tem as tools. Os nomes começam pela decisão do PLAN.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { consultarConhecimento, PedidoDoConhecimento } from '../src/conhecimento-consulta';
import { exigirManifesto } from '../src/manifest';
import { criarServidorMcp } from '../src/mcp-server';
import { novaThread } from '../src/thread';
import { ajustarManifesto, dirTemporario, projetoTemporario, ProjetoDeTeste } from './apoio';

const TOOLS = ['ork_conhecimento_listar', 'ork_conhecimento_mostrar', 'ork_conhecimento_colecoes', 'ork_conhecimento_verificar'];
const DSN = 'KB_MCP_FAKE_DSN';

/** O Brain falso atrás do `memory.cli`: responde o `get` como o OrkMind e anota cada pedido. */
function orkmindFalso(dir: string): { cli: string; log: string } {
  const cli = path.join(dir, 'orkmind-falso.cjs'), log = path.join(dir, 'brain.log');
  fs.writeFileSync(cli, `#!${process.execPath}
const fs = require('fs'), crypto = require('crypto');
const API = 'orkmind.company-brain-api/v1';
const pedido = JSON.parse(fs.readFileSync(0, 'utf8'));
const id = pedido.payload && pedido.payload.id;
fs.appendFileSync(${JSON.stringify(log)}, pedido.operation + ' ' + id + '\\n');
const responder = (r) => process.stdout.write(JSON.stringify({ schema: API, ...r }));
if (id !== 'proj-portal-rh') responder({ state: 'unknown' });
else responder({ state: 'ok', entity: { schema: 'orkmind.company-brain-entity/v1', tenant_id: process.env.ORKMIND_BRAIN_TENANT, id,
  kind: 'proj', version: 3, parent_id: 'prod-portal', workspace_ids: [], depends_on: [], aliases: [{ system: 'ork', instance: 'orkastery', id }],
  title: 'Portal de RH', description: '', status: 'in_progress', acceptance_criteria: [], owner: { raw: null, state: 'unknown', principal: null },
  source: { authority: 'ork', instance: 'orkastery', source_ref: 'portfolio.json#' + id, source_hash: crypto.createHash('sha256').update(id).digest('hex'),
    source_version: 3, location: 'id:' + id }, acl_ref: 'ork-factory', observed_at: null, recorded_at: null } });
`, { mode: 0o755 });
  return { cli, log };
}

function documento(raiz: string, rel: string, frontmatter: string, corpo = '# Política\n\nTexto.\n'): void {
  const abs = path.join(raiz, 'docs', 'conhecimento', rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n${frontmatter}---\n${corpo}`);
}

interface Cena { p: ProjetoDeTeste; c: Client; log: string; fora: string }
/** O projeto com a pasta de conhecimento e o Brain falso no manifesto, servido pelo MCP. */
async function comServidor(nome: string, corpo: (cena: Cena) => Promise<void>, threadId?: (p: ProjetoDeTeste) => string): Promise<void> {
  const p = projetoTemporario(`mcp-conhecimento-${nome}`);
  const fora = dirTemporario(`mcp-conhecimento-${nome}-brain`);
  const brain = orkmindFalso(fora);
  ajustarManifesto(p, /\n {2}mode: files\n/, '\n  mode: orkmind\n');
  ajustarManifesto(p, /\n {2}database_url_env: ""\n/, `\n  database_url_env: "${DSN}"\n`);
  ajustarManifesto(p, /\n {2}cli: orkmind\n/, `\n  cli: ${JSON.stringify(brain.cli)}\n`);
  fs.appendFileSync(path.join(p.dir, 'orkastery.yaml'), 'conhecimento:\n  dir: docs/conhecimento\n');
  p.carregado = exigirManifesto(p.dir);
  documento(p.dir, 'rh/ferias.md', 'id: doc-ferias\ntitulo: Política de férias\ncolecoes: [rh, politicas]\nreferencias:\n' +
    '  brain: [proj-portal-rh, proj-sumiu]\n');
  documento(p.dir, 'guia.md', 'id: doc-guia\ntitulo: Guia\ncolecoes: [engenharia]\n');
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex', ...(threadId ? { threadId: threadId(p) } : {}) });
  const c = new Client({ name: 'fixture-conhecimento', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const antes = process.env[DSN];
  process.env[DSN] = 'sintetico-nao-e-conexao';
  try { await server.connect(st); await c.connect(ct); await corpo({ p, c, log: brain.log, fora }); }
  finally {
    if (antes === undefined) delete process.env[DSN]; else process.env[DSN] = antes;
    await c.close(); await server.close(); p.limpar(); fs.rmSync(fora, { recursive: true, force: true });
  }
}

async function chamar(c: Client, name: string, args: Record<string, unknown>) {
  const r = await c.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[]).filter((x) => x.type === 'text').map((x) => x.text).join('');
  return { erro: r.isError === true, text, data: () => JSON.parse(text) };
}
const pedidos = (log: string) => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];

test('D11: as tools ork_conhecimento_* estão no MCP, só leitura e de schema fechado, e devolvem o JSON da consulta da CLI', () =>
  comServidor('paridade', async ({ p, c, log }) => {
    const tools = (await c.listTools()).tools.filter((t) => TOOLS.includes(t.name));
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    for (const t of tools) {
      assert.equal(t.annotations?.readOnlyHint, true, t.name);
      assert.equal(t.annotations?.destructiveHint, false, t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      assert.ok(!(t.inputSchema.required ?? []).includes('threadId'), `${t.name} é do projeto, não da thread`);
    }
    const casos: [string, Record<string, unknown>, PedidoDoConhecimento, boolean][] = [
      ['ork_conhecimento_listar', {}, { consulta: 'listar' }, false],
      ['ork_conhecimento_listar', { colecao: 'rh' }, { consulta: 'listar', colecao: 'rh' }, false],
      ['ork_conhecimento_colecoes', {}, { consulta: 'colecoes' }, false],
      ['ork_conhecimento_mostrar', { id: 'doc-ferias' }, { consulta: 'mostrar', id: 'doc-ferias' }, false],
      ['ork_conhecimento_mostrar', { id: 'doc-nao-tem' }, { consulta: 'mostrar', id: 'doc-nao-tem' }, true],
      ['ork_conhecimento_verificar', { projeto: 'orkastery' }, { consulta: 'verificar' }, true],
    ];
    for (const [nome, args, pedido, erro] of casos) {
      const r = await chamar(c, nome, args);
      assert.equal(r.erro, erro, `${nome} ${JSON.stringify(args)}: isError segue a saída da CLI`);
      // A mesma consulta que a CLI imprime com --json, no mesmo projeto e com o mesmo Brain.
      assert.deepEqual(r.data(), JSON.parse(JSON.stringify(consultarConhecimento(exigirManifesto(p.dir), pedido))), nome);
    }
    assert.deepEqual(await chamar(c, 'ork_conhecimento_listar', {}).then((r) => r.data().documentos.map((d: { id: string }) => d.id)),
      ['doc-ferias', 'doc-guia']);
    assert.ok(pedidos(log).every((l) => l.startsWith('get ')), 'só get');
  }));

test('D12: pelo MCP, o id do Brain confere por get; id inexistente e Brain fora do ar vêm como lacunas distintas, nunca como resposta', () =>
  comServidor('brain', async ({ c, log }) => {
    const r = await chamar(c, 'ork_conhecimento_mostrar', { id: 'doc-ferias' });
    assert.equal(r.erro, false);
    assert.deepEqual(pedidos(log), ['get proj-portal-rh', 'get proj-sumiu']);
    const d = r.data();
    assert.deepEqual(d.documento.referencias.brain, [{ id: 'proj-portal-rh', kind: 'proj', titulo: 'Portal de RH', versao: 3,
      fonte: 'portfolio.json#proj-portal-rh', sha256: createHash('sha256').update('proj-portal-rh').digest('hex') }]);
    assert.equal(d.documento.corpo, '# Política\n\nTexto.\n');
    assert.deepEqual(d.lacunas.map((l: { codigo: string; referencia: string }) => [l.codigo, l.referencia]),
      [['referencia.brain-inexistente', 'proj-sumiu']]);
    // listar e colecoes não chamam o Brain.
    await chamar(c, 'ork_conhecimento_listar', {});
    await chamar(c, 'ork_conhecimento_colecoes', {});
    assert.equal(pedidos(log).length, 2);
    // Sem a DSN o Brain está fora do ar: as duas referências viram brain-indisponivel, e nenhuma vira resposta.
    delete process.env[DSN];
    const fora = await chamar(c, 'ork_conhecimento_verificar', {});
    assert.equal(fora.erro, true);
    const ferias = fora.data().documentos.find((x: { id: string }) => x.id === 'doc-ferias');
    assert.deepEqual(ferias.referencias.brain, []);
    assert.deepEqual(fora.data().lacunas.map((l: { codigo: string; referencia: string }) => [l.codigo, l.referencia]),
      [['referencia.brain-indisponivel', 'proj-portal-rh'], ['referencia.brain-indisponivel', 'proj-sumiu']]);
    assert.equal(pedidos(log).length, 2, 'Brain sem configuração não cria processo');
  }));

test('D11: argumento fora do schema recusa sem ler, e a sessão filha vinculada à thread também lê o conhecimento', async () => {
  await comServidor('schema', async ({ c, log }) => {
    for (const [nome, args] of [
      ['ork_conhecimento_mostrar', { id: 'DOC-FERIAS' }], ['ork_conhecimento_mostrar', {}], ['ork_conhecimento_mostrar', { id: '../x' }],
      ['ork_conhecimento_listar', { colecao: 'RH' }], ['ork_conhecimento_listar', { raiz: '/tmp' }],
      ['ork_conhecimento_verificar', { threadId: 'ork-x' }], ['ork_conhecimento_colecoes', { projeto: 'outro' }],
    ] as [string, Record<string, unknown>][]) {
      const r = await chamar(c, nome, args);
      assert.equal(r.erro, true, `${nome} ${JSON.stringify(args)}`);
      assert.ok(!r.text.includes('"contrato"'), `${nome}: nada foi lido`);
    }
    assert.deepEqual(pedidos(log), []);
  });
  await comServidor('filho', async ({ c }) => {
    const nomes = (await c.listTools()).tools.map((t) => t.name);
    for (const nome of TOOLS) assert.ok(nomes.includes(nome), nome);
    assert.equal((await chamar(c, 'ork_conhecimento_colecoes', {})).erro, false);
  }, (p) => novaThread(p.carregado, { nome: 'leitora', modo: 'auto' }).thread.id);
});
