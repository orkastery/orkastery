import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { criarServidorMcp } from '../src/mcp-server';
import { lerLedger } from '../src/ledger';
import { dirThread } from '../src/thread';

// RM-059 (T5.1): o roteiro da prova do dialogo nativo. A prova de verdade e do dono, numa sessao interativa do
// Claude Code com a Mesa; aqui o roteiro roda sem `claude`: o ensaio prepara a copia, confere sem resposta e a apaga,
// e um cliente MCP SINTETICO, em memoria, faz o papel do host para provar o lado do nucleo (o servidor da copia pede o
// formulario do pedido de teste) e a leitura do `--conferir`. Nenhuma resposta do dono real entra aqui.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/prova-mods-dialogo-nativo.cjs');
const prova = require(SCRIPT);

function comPasta<T>(corpo: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-dialogo-teste-'));
  return Promise.resolve(corpo(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

type Formulario = { mode?: string; message?: string; requestedSchema?: { properties?: { opcao?: { oneOf?: Array<{ const: string }> } } } };

async function comServidor<T>(copia: string,
  responder: (f: Formulario) => { action: 'accept' | 'decline' | 'cancel'; content?: { opcao: string } },
  corpo: (c: Client, formularios: Array<{ mode?: string; message?: string }>) => Promise<T>): Promise<T> {
  const server = criarServidorMcp({ projeto: copia, host: 'claude-code' });
  const client = new Client({ name: 'cliente-sintetico-da-prova', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  const formularios: Array<{ mode?: string; message?: string }> = [];
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    const f = req.params as Formulario;
    formularios.push({ mode: f.mode, message: f.message });
    return responder(f);
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    return await corpo(client, formularios);
  } finally {
    await client.close();
    await server.close();
  }
}

async function chamar(c: Client, nome: string, args: Record<string, unknown>) {
  const r = await c.callTool({ name: nome, arguments: args });
  const texto = (r.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
  return { erro: r.isError === true, dados: JSON.parse(texto) };
}

test('ensaio: a copia nasce fora do repositorio com a pergunta v2 aberta pelo nucleo, o veredito fica pendente e a copia some', async () => {
  const r = prova.ensaio();
  assert.equal(r.ensaio, true);
  assert.equal(r.preparo.formato, 'ork.prova-mods-dialogo-nativo/v1');
  assert.equal(r.preparo.contrato, 'ork.hitl/v2');
  assert.deepEqual(r.preparo.alternativas, ['a', 'b', 'c']);
  assert.match(r.preparo.codigo, /^[0-9A-Za-z]{3,8}$/);
  assert.ok(!fs.realpathSync(os.tmpdir()).startsWith(fs.realpathSync(raizDoRepo) + path.sep));
  assert.ok(!r.preparo.raiz.startsWith(fs.realpathSync(raizDoRepo) + path.sep), r.preparo.raiz);
  assert.equal(r.conferencia.respondido, false);
  assert.equal(r.conferencia.veredito, 'Veredito: pendente do dono');
  assert.equal(fs.existsSync(r.preparo.raiz), false, 'o ensaio apaga a copia');
  // O comando da sessao do dono: a ponte e a Mesa por --plugin-dir, so o servidor da copia, sem identidade de despacho.
  const c = r.preparo.comando;
  assert.deepEqual(c.argv.slice(0, 5), ['claude', '--plugin-dir', path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte'),
    '--plugin-dir', path.join(raizDoRepo, 'adapters/claude-code/mods/ork-mesa')]);
  assert.ok(c.argv.includes('--strict-mcp-config'));
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_PROJETO']) assert.match(c.linha, new RegExp(`-u ${nome} `));
});

test('a copia nunca fica dentro do repositorio nem de um projeto, e a recusa nao cria pasta nenhuma', () => comPasta((fora) => {
  const sobras = (dir: string) => fs.readdirSync(dir).filter((n) => n.startsWith('ork-prova-dialogo-'));
  const antes = sobras(path.join(raizDoRepo, 'core')).length;
  assert.throws(() => prova.prepararCopia({ saida: path.join(raizDoRepo, 'core') }), (e: Error) => e instanceof prova.ErroDeUso);
  assert.throws(() => prova.prepararCopia({ saida: path.join(raizDoRepo, 'core', 'nova', 'funda') }), (e: Error) => e instanceof prova.ErroDeUso);
  assert.equal(sobras(path.join(raizDoRepo, 'core')).length, antes, 'a recusa vem antes de criar a pasta');
  assert.equal(fs.existsSync(path.join(raizDoRepo, 'core', 'nova')), false);
  // Uma pasta qualquer com orkastery.yaml acima tambem e projeto: a copia nao entra nela.
  fs.writeFileSync(path.join(fora, 'orkastery.yaml'), 'project:\n  name: outro\n');
  assert.throws(() => prova.prepararCopia({ saida: path.join(fora, 'sub') }), /fora de um projeto do Orkastery/);
  assert.deepEqual(fs.readdirSync(fora), ['orkastery.yaml']);
}));

test('cliente sintetico que recusa: o servidor da copia pede o formulario do pedido, nada e gravado como resposta', () => comPasta(async (base) => {
  const copia = prova.prepararCopia({ saida: base });
  const mcp = JSON.parse(fs.readFileSync(path.join(copia.raiz, 'mcp-prova.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.orkastery.args.slice(1), ['mcp', 'serve', '--project', copia.raiz, '--host', 'claude-code']);
  await comServidor(copia.raiz, () => ({ action: 'decline' }), async (c, formularios) => {
    const pendentes = await chamar(c, 'ork_hitl_pending', { threadId: copia.thread });
    assert.equal(pendentes.erro, false);
    const pendencia = pendentes.dados.pendencias[0];
    assert.equal(pendencia.pedido.id, copia.pedidoId);
    assert.equal(pendencia.canais.find((o: { canal: string }) => o.canal === 'claude-code').estado, 'disponivel');
    const r = await chamar(c, 'ork_request_decision', { threadId: copia.thread, pedidoId: copia.pedidoId });
    assert.equal(r.erro, false);
    assert.equal(r.dados.estado, 'pendente');
    assert.equal(formularios.length, 1);
    assert.equal(formularios[0]?.mode, 'form');
  });
  const eventos = lerLedger(dirThread(copia.raiz, copia.thread));
  assert.equal(eventos.some((e) => e.tipo === 'human_gate'), false);
  const conferencia = prova.conferirCopia(copia.raiz);
  assert.deepEqual(conferencia.canaisEscolhidos, ['claude-code']);
  assert.equal(conferencia.veredito, 'Veredito: o diálogo foi pedido pela Mesa e fechou sem resposta gravada; repita respondendo');
}));

test('cliente sintetico que responde: o --conferir le o human_gate com autorizadoPor mcp-local:claude-code', () => comPasta(async (base) => {
  const copia = prova.prepararCopia({ saida: base });
  // O cliente sintetico escolhe a segunda alternativa que o proprio formulario oferece.
  const segunda = (f: Formulario) => String(f.requestedSchema?.properties?.opcao?.oneOf?.[1]?.const ?? '');
  await comServidor(copia.raiz, (f) => ({ action: 'accept', content: { opcao: segunda(f) } }), async (c) => {
    const r = await chamar(c, 'ork_request_decision', { threadId: copia.thread, pedidoId: copia.pedidoId });
    assert.equal(r.erro, false, JSON.stringify(r.dados));
  });
  const conferencia = prova.conferirCopia(copia.raiz);
  assert.equal(conferencia.respondido, true);
  assert.equal(conferencia.pelaMesa, true);
  assert.equal(conferencia.autorizadoPor, 'mcp-local:claude-code');
  assert.match(conferencia.veredito, /^Veredito: o diálogo nativo abre pelo \$\.mcp\.call e grava human_gate com autorizadoPor mcp-local:claude-code \(/);
}));

test('--conferir recusa pasta que nao e copia de prova', () => comPasta((dir) => {
  assert.throws(() => prova.conferirCopia(dir), (e: Error) => e instanceof prova.ErroDeUso);
}));
