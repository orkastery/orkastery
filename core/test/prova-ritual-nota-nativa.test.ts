import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import './apoio';
import { criarServidorMcp } from '../src/mcp-server';
import { lerLedger } from '../src/ledger';
import { dirThread } from '../src/thread';

// RM-059 (fatia F8): o roteiro da prova da nota pelo dialogo nativo. A prova de verdade e do dono, numa sessao interativa
// do Claude Code com o Ritual; aqui o roteiro roda sem `claude`: o ensaio prepara a copia, confere sem resposta e a apaga,
// e um cliente MCP SINTETICO, em memoria, faz o papel do host para provar o lado do nucleo (o servidor da copia pede o
// formulario da nota e grava com o recibo) e a leitura do `--conferir`. Nenhuma nota de dono real entra aqui.
const raizDoRepo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(raizDoRepo, 'core/scripts/prova-ritual-nota-nativa.cjs');
const prova = require(SCRIPT);

function comPasta<T>(corpo: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ork-prova-nota-teste-'));
  return Promise.resolve(corpo(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/** O cliente sintetico no papel do host: pede a nota da thread da copia e responde o formulario como o teste manda. */
async function pedirNaCopia(copia: string, thread: string, resposta: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) {
  const server = criarServidorMcp({ projeto: copia, host: 'claude-code' });
  const client = new Client({ name: 'cliente-sintetico-da-prova-da-nota', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  const formularios: Array<{ message?: string }> = [];
  client.setRequestHandler(ElicitRequestSchema, async (req) => {
    formularios.push({ message: (req.params as { message?: string }).message });
    return resposta;
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const r = await client.callTool({ name: 'ork_request_master_note', arguments: { threadId: thread } });
    return { r, formularios };
  } finally {
    await client.close();
    await server.close();
  }
}

test('ensaio: a copia nasce fora do repositorio com uma entrega aceita por omissao, o veredito fica pendente e a copia some', () => {
  const r = prova.ensaio();
  assert.equal(r.ensaio, true);
  assert.equal(r.preparo.formato, 'ork.prova-ritual-nota-nativa/v1');
  assert.ok(!r.preparo.raiz.startsWith(fs.realpathSync(raizDoRepo) + path.sep), r.preparo.raiz);
  assert.equal(r.conferencia.respondido, false);
  assert.equal(r.conferencia.pedida, false);
  assert.equal(r.conferencia.veredito, 'Veredito: pendente do dono');
  assert.equal(fs.existsSync(r.preparo.raiz), false, 'o ensaio apaga a copia');
  // O comando da sessao do dono: a ponte e o Ritual por --plugin-dir, so o servidor da copia, sem identidade de despacho.
  const c = r.preparo.comando;
  assert.deepEqual(c.argv.slice(0, 5), ['claude', '--plugin-dir', path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ponte'),
    '--plugin-dir', path.join(raizDoRepo, 'adapters/claude-code/mods/ork-ritual')]);
  assert.ok(c.argv.includes('--strict-mcp-config'));
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_PROJETO']) assert.match(c.linha, new RegExp(`-u ${nome} `));
  // A copia nunca e publicada: nem pela sessao do dono nem pelo servidor MCP dela.
  assert.deepEqual(c.env, { ORK_FABRICA_PUBLICAR: '0', ORK_REDE_PUBLICAR: '0' });
  assert.match(c.linha, / ORK_FABRICA_PUBLICAR=0 ORK_REDE_PUBLICAR=0 claude /);
});

test('o servidor MCP da copia nasce sem a publicacao em segundo plano', () => comPasta((fora) => {
  const r = prova.prepararCopia({ saida: fora });
  const mcp = JSON.parse(fs.readFileSync(path.join(r.raiz, 'mcp-prova.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcp.mcpServers), ['orkastery']);
  assert.deepEqual(mcp.mcpServers.orkastery.env, { ORK_FABRICA_PUBLICAR: '0', ORK_REDE_PUBLICAR: '0' });
  assert.deepEqual(mcp.mcpServers.orkastery.args.slice(1), ['mcp', 'serve', '--project', r.raiz, '--host', 'claude-code']);
}));

test('a copia nunca fica dentro do repositorio nem de um projeto, e a recusa nao cria pasta nenhuma', () => comPasta((fora) => {
  const sobras = (dir: string) => fs.readdirSync(dir).filter((n) => n.startsWith('ork-prova-nota-'));
  const antes = sobras(path.join(raizDoRepo, 'core')).length;
  assert.throws(() => prova.prepararCopia({ saida: path.join(raizDoRepo, 'core') }), (e: Error) => e instanceof prova.ErroDeUso);
  assert.throws(() => prova.prepararCopia({ saida: path.join(raizDoRepo, 'core', 'nova', 'funda') }), (e: Error) => e instanceof prova.ErroDeUso);
  assert.equal(sobras(path.join(raizDoRepo, 'core')).length, antes);
  assert.equal(fs.existsSync(path.join(raizDoRepo, 'core', 'nova')), false);
  fs.writeFileSync(path.join(fora, 'orkastery.yaml'), 'version: 1\n');
  assert.throws(() => prova.prepararCopia({ saida: path.join(fora, 'dentro') }), /fora de um projeto do Orkastery/);
  assert.equal(fs.existsSync(path.join(fora, 'dentro')), false);
}));

test('a conferencia separa a nota com recibo, o dialogo fechado sem nota, o recibo que nao confere e o nada', () => comPasta(async (fora) => {
  // O dialogo aceito: o master_done com mcp-local:claude-code e o recibo conferido.
  const aceita = prova.prepararCopia({ saida: fora });
  const { r, formularios } = await pedirNaCopia(aceita.raiz, aceita.thread, { action: 'accept', content: { nota: '4', porque: 'a prova sintetica do roteiro' } });
  assert.equal(r.isError, undefined, JSON.stringify(r.content));
  assert.equal(formularios.length, 1);
  assert.match(String(formularios[0].message), new RegExp(`Nota do MASTER da ${aceita.thread}`));
  const ok = prova.conferirCopia(aceita.raiz);
  assert.equal(ok.respondido, true);
  assert.equal(ok.recibo, true);
  assert.equal(ok.autorizadoPor, 'mcp-local:claude-code');
  assert.equal(ok.veredito, 'Veredito: o diálogo nativo abre pelo $.mcp.call do Ritual e grava a nota 4/5 com autorizadoPor mcp-local:claude-code e recibo conferido');
  // O recibo adulterado: a nota chegou, mas a conferencia nao a aceita.
  const feito = lerLedger(dirThread(aceita.raiz, aceita.thread)).filter((e) => e.tipo === 'master_done').at(-1)!;
  const recibo = path.join(aceita.raiz, String(feito.evidencia));
  const bruto = JSON.parse(fs.readFileSync(recibo, 'utf8'));
  bruto.dados.score = 5;
  fs.writeFileSync(recibo, JSON.stringify(bruto) + '\n');
  assert.match(prova.conferirCopia(aceita.raiz).veredito, /o recibo não confere/);
  // O dialogo recusado: o pedido de nota existe, a nota nao.
  const recusada = prova.prepararCopia({ saida: fora });
  await pedirNaCopia(recusada.raiz, recusada.thread, { action: 'decline' });
  const semNota = prova.conferirCopia(recusada.raiz);
  assert.equal(semNota.respondido, false);
  assert.equal(semNota.pedida, true);
  assert.equal(semNota.veredito, 'Veredito: o diálogo foi pedido pelo Ritual e fechou sem nota; repita respondendo');
  // Nada pedido: o veredito fica pendente.
  const parada = prova.prepararCopia({ saida: fora });
  assert.equal(prova.conferirCopia(parada.raiz).veredito, 'Veredito: pendente do dono');
  assert.throws(() => prova.conferirCopia(fora), (e: Error) => e instanceof prova.ErroDeUso);
}));
