/**
 * RM-059 (fatia F8, T8.2a): a seção `master` do retrato diz o que o Ritual do MASTER precisa.
 *
 * O Ritual lê as entregas só pelo retrato da ponte (`$.ork.retrato`). Antes, o item do MASTER trazia só o status e o
 * score: a aceita por omissão e a nota do dono eram iguais. Agora cada item traz o regime e as classes do MASTER log,
 * o índice derivado dos eventos já lidos (sem git, sem ensaio), as reprovações tipadas e a entrega; e o MASTER log da
 * nota pelo diálogo nativo (`mcp-local:claude-code`) é `recorded`, não `master.invalid`.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { discoverMaestro } from '../src/maestro-discovery';
import { collectMaestroSources } from '../src/maestro-sources';
import { aceitarPorOmissao, proporMaster } from '../src/master';
import { criarServidorMcp } from '../src/mcp-server';
import { definirFusoDoDono, formatarDataHoraRotulada } from '../src/horario';

const SHA = 'c'.repeat(40);

function comFuso<T>(corpo: () => T): T {
  definirFusoDoDono('America/Sao_Paulo');
  try { return corpo(); } finally { definirFusoDoDono(undefined); }
}

function itemDo(p: ProjetoDeTeste, id: string) {
  const secao = collectMaestroSources(discoverMaestro({ cwd: p.dir })).sections.master!;
  return { secao, item: secao.items.find(i => i.id === `master:${id}`) };
}

/** Uma thread #Auto que passou por GO-FIX, CHECK refeito e dois gates (um deles ensaio) antes de entregar. */
function comTropecos(p: ProjetoDeTeste, nome: string, entregar = true) {
  const { thread } = novaThread(p.carregado, { nome, modo: 'auto' });
  const dir = dirThread(p.dir, thread.id);
  registrar(dir, thread.id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'CHECK', motivo: 'claims.failed' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'CHECK', motivo: 'verify.regression' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.gateBloqueado, { fase: 'SHIP', motivo: 'ci.failed', dryRun: true });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.fixAberto, { fase: 'GO' });
  registrar(dir, thread.id, TIPOS_DE_EVENTO.reverifyConcluido, { fase: 'CHECK' });
  if (entregar) registrar(dir, thread.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', de: 'ork/x', para: 'main', mergeSha: SHA, pushVerificado: false });
  return thread;
}

test('retrato do MASTER: a aceita por omissão traz o regime, o índice com as parcelas, as reprovações, as classes e a entrega', () => comFuso(() => {
  const p = projetoTemporario('maestro-master-omissao');
  try {
    const t = comTropecos(p, 'omissao');
    aceitarPorOmissao(p.dir, t.id);
    const { secao, item } = itemDo(p, t.id);
    assert.deepEqual(secao.gaps, []);
    assert.equal(item?.status, 'recorded');
    const ts = String(lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === TIPOS_DE_EVENTO.shipConcluido)!.ts);
    const f = item!.facts;
    assert.equal(f.regime, 'omissao');
    assert.equal(f.index, 4);
    assert.equal(f.indexDetail, 'go_fix_opened x1, check_reverify x1');
    assert.equal(f.reprovals, 2, 'o gate de ensaio não conta');
    assert.equal(typeof f.classes, 'string');
    assert.ok(String(f.classes).length > 0);
    assert.equal(f.score, lerThread(p.dir, t.id).score!.valor);
    assert.equal(f.deliveredAt, ts);
    assert.equal(f.deliveredAtLocal, formatarDataHoraRotulada(ts));
    assert.equal(f.deliveredSha, SHA);
  } finally { p.limpar(); }
}));

test('retrato do MASTER: a entrega sem MASTER fica pendente, sem regime nem classes, com o índice do ledger e a entrega', () => comFuso(() => {
  const p = projetoTemporario('maestro-master-pendente');
  try {
    const t = comTropecos(p, 'pendente');
    const { item } = itemDo(p, t.id);
    assert.equal(item?.status, 'pending');
    assert.equal(item!.facts.regime, null);
    assert.equal(item!.facts.classes, null);
    assert.equal(item!.facts.index, 4);
    assert.equal(item!.facts.reprovals, 2);
    assert.equal(item!.facts.deliveredSha, SHA);
    // Recibo de ship inválido depois (GO-FIX7) não entra: nem a entrega nem o índice mudam.
    registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.shipConcluido, { fase: 'SHIP', mergeSha: 'xyz', pushVerificado: true });
    registrar(dirThread(p.dir, t.id), t.id, TIPOS_DE_EVENTO.shipBloqueado, { fase: 'SHIP', ts: 'invalido' });
    const depois = itemDo(p, t.id).item!;
    assert.equal(depois.facts.deliveredSha, SHA);
    assert.equal(depois.facts.deliveredAt, item!.facts.deliveredAt);
    assert.equal(depois.facts.index, 4);
    // Sem ship_done (só o ship barrado), a entrega é lacuna, não data inventada.
    const semEntrega = comTropecos(p, 'sem entrega', false);
    registrar(dirThread(p.dir, semEntrega.id), semEntrega.id, TIPOS_DE_EVENTO.shipBloqueado, { fase: 'SHIP', motivo: 'ci.failed' });
    const vazio = itemDo(p, semEntrega.id).item!;
    assert.equal(vazio.status, 'pending');
    assert.equal(vazio.facts.deliveredAt, null);
    assert.equal(vazio.facts.deliveredAtLocal, null);
    assert.equal(vazio.facts.deliveredSha, null);
    assert.equal(vazio.facts.indexDetail, 'go_fix_opened x1, check_reverify x1, ship_blocked x1');
  } finally { p.limpar(); }
}));

test('retrato do MASTER: a proposta pendente traz as classes da proposta e nenhum regime', () => comFuso(() => {
  const p = projetoTemporario('maestro-master-proposta');
  try {
    const t = comTropecos(p, 'proposta');
    proporMaster(p.dir, t.id, { score: 3, justificativa: 'proposta simulada', classes: ['processo'], por: 'Codex' });
    const { item } = itemDo(p, t.id);
    assert.equal(item?.status, 'ratificacao-pendente');
    assert.equal(item!.facts.score, null);
    assert.equal(item!.facts.regime, null);
    assert.equal(item!.facts.classes, 'processo');
  } finally { p.limpar(); }
}));

test('retrato do MASTER: a nota pelo diálogo nativo é recorded, não master.invalid, e o regime deixa de ser omissão', async () => {
  const p = projetoTemporario('maestro-master-nota-local');
  try {
    const t = comTropecos(p, 'nota local');
    aceitarPorOmissao(p.dir, t.id);
    const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
    const client = new Client({ name: 'cliente-sintetico-do-retrato', version: '1' }, { capabilities: { elicitation: { form: {} } } });
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept' as const, content: { nota: '5', porque: 'entregou o que foi pedido' } }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const r = await client.callTool({ name: 'ork_request_master_note', arguments: { threadId: t.id } });
      assert.equal(r.isError, undefined, JSON.stringify(r.content));
    } finally { await client.close(); await server.close(); }
    const { secao, item } = itemDo(p, t.id);
    assert.ok(!secao.gaps.includes(`master.invalid:${t.id}`), JSON.stringify(secao.gaps));
    assert.equal(item?.status, 'recorded');
    assert.equal(item!.facts.score, 5);
    assert.equal(item!.facts.regime, 'batch');
  } finally { p.limpar(); }
});
