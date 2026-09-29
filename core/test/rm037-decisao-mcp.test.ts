/**
 * RM-037 (rm037defeito, defeito 1): a sessao codex parou antes do GO porque o sandbox recusou gravar a
 * decisao no ledger (EROFS) e o MCP nao oferecia a operacao. `ork_decision_record` grava pela mesma
 * `registrarDecisao` do CLI, no MCP filho da propria thread.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { criarServidorMcp } from '../src/mcp-server';
import { CONTRATO_DECISAO_AUTONOMA, registrarDecisao } from '../src/decisao-autonoma';
import { lerLedger } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';
import { Thread } from '../src/types';
import { TOOLS_FILHO_CODEX } from '../src/mcp-install';

async function filho(body: (p: ProjetoDeTeste, propria: Thread, outra: Thread, c: Client) => Promise<void>) {
  const p = projetoTemporario('rm037-decisao-mcp');
  const propria = novaThread(p.carregado, { nome: 'propria', modo: 'auto' }).thread;
  const outra = novaThread(p.carregado, { nome: 'outra', modo: 'auto' }).thread;
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex', threadId: propria.id });
  const client = new Client({ name: 'codex-SIMULADO', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try { await server.connect(st); await client.connect(ct); await body(p, propria, outra, client); }
  finally { await client.close(); await server.close(); p.limpar(); }
}

async function chamar(c: Client, args: Record<string, unknown>) {
  const r = await c.callTool({ name: 'ork_decision_record', arguments: args });
  const text = (r.content as { type: string; text: string }[]).filter(x => x.type === 'text').map(x => x.text).join('');
  return { error: r.isError === true, text, data: () => JSON.parse(text) };
}

const decisao = (threadId: string, extra: Record<string, unknown> = {}) => ({
  threadId, decidido: 'A baseline do bloco sai do despacho', porque: 'o sandbox do codex nao grava o ledger',
  comoMudar: 'trocar a regra do despacho', custoAgora: 'uma funcao', custoDepois: 'um PR pequeno',
  criterio: { tipo: 'medicao', referencia: 'node --test core/dist-test/test/rm037-baseline-no-despacho.test.js' },
  quemDecidiu: 'sessao executora codex da thread', evidencia: 'rollout 01a0ecff: EROFS', ...extra,
});

test('defeito 1: o MCP filho registra a decisao autonoma pelo mesmo contrato do CLI, com a origem', async () => {
  await filho(async (p, propria, _outra, c) => {
    const nomes = (await c.listTools()).tools.map(t => t.name);
    assert.ok(nomes.includes('ork_decision_record'), 'a sessao filha tem a ferramenta');
    const r = await chamar(c, decisao(propria.id));
    assert.equal(r.error, false, r.text);
    assert.equal(r.data().reciboOficial, false);
    const [e] = lerLedger(dirThread(p.dir, propria.id)).filter(x => x.tipo === 'autonomous_decision' && x.contratoDecisao);
    assert.equal(e.eventId, r.data().eventId);
    assert.equal(e.contratoDecisao, CONTRATO_DECISAO_AUTONOMA);
    assert.deepEqual([e.origem, e.host, e.quemDecidiu, e.evidencia, e.razao],
      ['mcp', 'codex', 'sessao executora codex da thread', 'rollout 01a0ecff: EROFS', 'o sandbox do codex nao grava o ledger']);
    const pedido = e.pedido as { classe: string; custoDeReverter: { agora: string; depois: string }; criterio: { tipo: string } };
    assert.equal(pedido.classe, 'decidido');
    assert.deepEqual(pedido.custoDeReverter, { agora: 'uma funcao', depois: 'um PR pequeno' });
    assert.equal(pedido.criterio.tipo, 'medicao');
  });
});

test('defeito 1: recusas do MCP nao gravam nada: outra thread, criterio que nao resolve, teto e autoria do dono', async () => {
  await filho(async (p, propria, outra, c) => {
    const dir = dirThread(p.dir, propria.id), antes = lerLedger(dir).length, antesOutra = lerLedger(dirThread(p.dir, outra.id)).length;
    const escopo = await chamar(c, decisao(outra.id));
    assert.equal(escopo.error, true); assert.match(escopo.text, /mcp\.thread\.scope/);
    const criterio = await chamar(c, decisao(propria.id, { criterio: { tipo: 'ledger', referencia: `${propria.id}#evento:999` } }));
    assert.equal(criterio.error, true); assert.match(criterio.text, /critério não resolve/);
    const teto = await chamar(c, decisao(propria.id, { decidido: 'd'.repeat(201) }));
    assert.equal(teto.error, true); assert.match(teto.text, /decidido tem 201 caracteres; o teto é 200/);
    const dono = await chamar(c, decisao(propria.id, { quemDecidiu: 'o dono, pelo pedido' }));
    assert.equal(dono.error, true); assert.match(dono.text, /mcp\.decision\.author/);
    assert.equal(lerLedger(dir).length, antes);
    assert.equal(lerLedger(dirThread(p.dir, outra.id)).length, antesOutra);
  });
});

test('defeito 1: a ferramenta tem o grant de mutacao do filho codex, sem virar decisao do dono', () => {
  assert.ok((TOOLS_FILHO_CODEX as readonly string[]).includes('ork_decision_record'),
    'sem o grant, o codex com approval_policy never recusaria a chamada');
  assert.ok(!TOOLS_FILHO_CODEX.some(t => /gate|request_decision|phase_run/.test(t)));
});

test('defeito 1 (S5): o rastro grava a porta e o despacho do processo, nao so o texto de quemDecidiu', () => {
  const p = projetoTemporario('rm037-decisao-cli-despacho');
  const antes = { id: process.env.ORK_DISPATCH_ID, th: process.env.ORK_DISPATCH_THREAD, sessao: process.env.CLAUDE_CODE_SESSION_ID };
  try {
    const t = novaThread(p.carregado, { nome: 'cli', modo: 'auto' }).thread;
    const entrada = { decidido: 'x', porque: 'y', comoMudar: 'z', custoDeReverter: { agora: 'a', depois: 'b' },
      criterio: { tipo: 'medicao' as const, referencia: 'true' }, quemDecidiu: 'o dono', evidencia: 'e' };
    delete process.env.CLAUDE_CODE_SESSION_ID;
    // Processo de uma sessao despachada desta thread: a identidade vai ao evento, mesmo que o texto diga "o dono".
    process.env.ORK_DISPATCH_ID = '11111111-2222-4333-8444-555555555555'; process.env.ORK_DISPATCH_THREAD = t.id;
    const daSessao = registrarDecisao(p.dir, t.id, entrada).evento;
    assert.equal(daSessao.despacho, '11111111-2222-4333-8444-555555555555');
    assert.equal(daSessao.origem, 'cli');
    assert.equal(typeof daSessao.canal, 'string');
    // O terminal do dono nao tem despacho no ambiente.
    delete process.env.ORK_DISPATCH_ID; delete process.env.ORK_DISPATCH_THREAD;
    assert.equal(registrarDecisao(p.dir, t.id, entrada).evento.despacho, null);
  } finally {
    for (const [k, v] of [['ORK_DISPATCH_ID', antes.id], ['ORK_DISPATCH_THREAD', antes.th], ['CLAUDE_CODE_SESSION_ID', antes.sessao]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    p.limpar();
  }
});
