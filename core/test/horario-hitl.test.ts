/**
 * I-35 (T2): o pedido HITL chega ao dono no fuso dele em todo canal. Sem host real: MCP em
 * memória, CLI no projeto temporário e mensagem do pulse SIMULADOS. O ISO assinado não muda.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ajustarManifesto, projetoTemporario, ProjetoDeTeste } from './apoio';
import { novaThread } from '../src/thread';
import { registrarPedidoHitl } from '../src/hitl-gates';
import { PedidoHitl } from '../src/hitl-contract';
import { hashPedidoLocal } from '../src/hitl-local-atestado';
import { apresentarDecisao, prazoLocalDoPedido } from '../src/hitl-presentation';
import { assinaturaPulse, mensagemPulse } from '../src/pulse-delivery';
import { ItemPulse } from '../src/pulse';
import { criarServidorMcp } from '../src/mcp-server';
import { definirFusoDoDono, formatarDataHoraRotulada } from '../src/horario';

const SP = 'America/Sao_Paulo';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const CLI = path.join(__dirname, '..', '..', 'dist', 'index.js');

function pedidoFixo(thread: string, fase: PedidoHitl['fase'], modo: PedidoHitl['modo'], criadoEm: string, prazo: string): PedidoHitl {
  return { contrato: 'ork.hitl/v1', id: 'q-horario', thread, fase, modo, alvo: { tipo: 'gate', sobre: 'premissas' },
    motivo: 'human.pending', pergunta: 'Aprovar esta fixture SIMULADA?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Esperar', acao: 'esperar' }],
    recomendacao: 'Somente fixture sintética', criadoEm, prazo, acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' };
}

/** Projeto com o dono em Brasília e um pedido aberto (prazo em 1 h a partir de agora). */
function projetoComPedido(nome: string): { p: ProjetoDeTeste; q: PedidoHitl } {
  const p = projetoTemporario(nome);
  ajustarManifesto(p, 'owner:\n', `owner:\n  timezone: "${SP}"\n`);
  const t = novaThread(p.carregado, { nome: 'decisao', modo: 'classic' }).thread;
  const agora = Date.now();
  const q = pedidoFixo(t.id, t.faseAtual, t.modo, new Date(agora).toISOString(), new Date(agora + 3600000).toISOString());
  registrarPedidoHitl(p.dir, q);
  return { p, q };
}

function semHitlDoHost(tz: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz };
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_')) delete env[nome];
  return env;
}

test('apresentação da decisão (elicitation MCP e oferta nativa) mostra o prazo local com rótulo', () => {
  definirFusoDoDono(SP);
  try {
    const q = pedidoFixo('ork-fixture', 'GOAL', 'ork', '2026-09-19T14:00:30.843Z', '2026-09-19T15:00:30.843Z');
    const { mensagem } = apresentarDecisao(q, '2026-09-19T14:00:30.843Z');
    assert.match(mensagem, /• Prazo: 19\/09 12:00 \(horário de Brasília\), em 1h00\. Sem resposta, aguardamos\./);
    assert.doesNotMatch(mensagem, ISO);
    assert.doesNotMatch(mensagem, /UTC/);
    assert.equal(prazoLocalDoPedido(q, '2026-09-19T14:00:30.843Z'), '19/09 12:00 (horário de Brasília)');
    // O contrato assinado não muda: o ISO continua no pedido.
    assert.equal(q.prazo, '2026-09-19T15:00:30.843Z');
  } finally { definirFusoDoDono(undefined); }
});

test('mensagem do pulse ao Telegram: prazo e pergunta locais, assinatura igual à da base', () => {
  definirFusoDoDono(SP);
  try {
    const base: ItemPulse = { id: 'orfa:ork-fixture:GO', classe: 'fase-orfa', motivo: 'runtime.silencio', thread: 'ork-fixture',
      fase: 'GO', sessionId: null, desdeEm: '2026-09-19T14:00:30.843Z', paradaHaMin: 16, impacto: 3,
      pergunta: 'Fase GO sem heartbeat desde 2026-09-19T14:00:30.843Z.', opcoes: [], recomendacao: 'Conferir a sessão SIMULADA.',
      comandoResposta: 'ork phase list ork-fixture', evidencia: [], fontes: [], contextoLogs: [] };
    const semPedido = mensagemPulse(base, '2026-09-19T14:16:30.843Z');
    assert.match(semPedido, /Fase GO sem heartbeat desde 19\/09 11:00\.\nHorários de Brasília\./);
    assert.doesNotMatch(semPedido, ISO);

    const q = pedidoFixo('ork-fixture', 'GO', 'ork', '2026-09-19T14:00:30.843Z', '2026-09-19T15:00:30.843Z');
    const comPedido = mensagemPulse({ ...base, pergunta: q.pergunta, pedido: q }, '2026-09-19T14:00:30.843Z');
    assert.match(comPedido, /Pedido: q-horario; prazo: 19\/09 12:00 \(horário de Brasília\), em 1h00; expirar: esperar/);
    assert.equal((comPedido.match(/horário de Brasília|Horários de Brasília/g) ?? []).length, 1);
    assert.doesNotMatch(comPedido, ISO);

    // O item continua ISO e a assinatura de deduplicação é a mesma fórmula da base: nada é reenviado.
    // I-41 (D9): `apresentacao` saiu da fórmula. O diff dela muda a cada commit em qualquer
    // worktree, e com ela dentro todo commit reenviava todos os itens da thread. O que a I-35
    // provava aqui continua provado: localizar o horário não muda a assinatura.
    assert.equal(base.pergunta, 'Fase GO sem heartbeat desde 2026-09-19T14:00:30.843Z.');
    const formulaDaBase = (i: ItemPulse) => createHash('sha256').update(JSON.stringify(
      [i.id, i.classe, i.motivo, i.desdeEm, i.pergunta, i.opcoes, i.pedido])).digest('hex');
    assert.equal(assinaturaPulse(base), formulaDaBase(base));
    assert.equal(assinaturaPulse({ ...base, pedido: q }), formulaDaBase({ ...base, pedido: q }));
  } finally { definirFusoDoDono(undefined); }
});

test('ork gate context: prazoLocal ao lado do ISO, mesma saída com TZ=UTC e TZ=America/Sao_Paulo', () => {
  const { p, q } = projetoComPedido('horario-gate-context');
  try {
    const saidas = ['UTC', SP].map(tz => {
      const r = spawnSync(process.execPath, [CLI, 'gate', 'context', q.thread, q.id], { cwd: p.dir, encoding: 'utf8', env: semHitlDoHost(tz) });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout) as { pedido: PedidoHitl; pedidoSha256: string; prazoLocal: string; apresentacao: { mensagem: string } };
    });
    const esperado = formatarDataHoraRotulada(q.prazo, { fuso: SP });
    for (const v of saidas) {
      assert.equal(v.prazoLocal, esperado);
      assert.match(v.prazoLocal, / \(horário de Brasília\)$/);
      assert.ok(v.apresentacao.mensagem.includes(`• Prazo: ${esperado}, em `), v.apresentacao.mensagem);
      assert.doesNotMatch(v.apresentacao.mensagem, ISO);
      assert.equal(v.pedido.prazo, q.prazo);
      assert.equal(v.pedidoSha256, hashPedidoLocal(q));
    }
    assert.equal(saidas[0].prazoLocal, saidas[1].prazoLocal);
  } finally { p.limpar(); }
});

test('MCP: ork_hitl_pending traz prazoLocal do manifesto do projeto e a elicitation mostra o prazo local', async () => {
  definirFusoDoDono(undefined);
  const { p, q } = projetoComPedido('horario-mcp');
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex' });
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' }, { capabilities: { elicitation: { form: {} } } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    let mensagem = '';
    client.setRequestHandler(ElicitRequestSchema, async req => { mensagem = String(req.params.message); return { action: 'cancel' as const }; });
    const texto = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return (r.content as { type: string; text: string }[]).filter(x => x.type === 'text').map(x => x.text).join('');
    };
    const pendencia = JSON.parse(await texto('ork_hitl_pending', { threadId: q.thread })).pendencias[0];
    assert.equal(pendencia.pedido.id, q.id);
    assert.equal(pendencia.pedido.prazo, q.prazo);
    assert.equal(pendencia.prazoLocal, formatarDataHoraRotulada(q.prazo, { fuso: SP }));
    await texto('ork_request_decision', { threadId: q.thread, pedidoId: q.id });
    assert.ok(mensagem.includes(`• Prazo: ${pendencia.prazoLocal}, em `), mensagem);
    assert.doesNotMatch(mensagem, ISO);
  } finally { await client.close(); await server.close(); p.limpar(); definirFusoDoDono(undefined); }
});
