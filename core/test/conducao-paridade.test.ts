/**
 * I-36 (RM-036, P6): a mesma pergunta em qualquer canal devolve a mesma resposta.
 *
 * "Conduzido agora por CANAL, sessao ID, fase F, desde HORARIO" sai de UMA funcao do nucleo e
 * aparece igual no `ork thread status`, no board, no monitor, no pulse e no snapshot do Maestro.
 * E a recusa do segundo pedido chega igual pelo CLI e pelo MCP, que disputam o mesmo lease.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { textoDoBoard } from '../src/board';
import { adicionarClaim } from '../src/claims';
import { conducaoDaThread } from '../src/conducao';
import { linhaDeConducao } from '../src/conducao-texto';
import { MaestroReader } from '../src/maestro-sources';
import { operationalSources } from '../src/maestro-runtime';
import { criarServidorMcp } from '../src/mcp-server';
import { montarMonitor, textoDoMonitor } from '../src/orquestracao';
import { rodarFase } from '../src/phase';
import { montarPulse, textoDoPulse } from '../src/pulse';
import { lerThread, novaThread, resumoDaThread } from '../src/thread';
import { commitar, projetoTemporario, runtimeFalso } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');

test('a linha de conducao e a mesma nas cinco superficies e mora num lugar so (T17, CS7)', (t) => {
  const p = projetoTemporario('conducao-paridade');
  const runtime = runtimeFalso('conducao-paridade');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'paridade', modo: 'auto' });
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'hermes' });
  const atual = conducaoDaThread(p.dir, thread.id)!;
  const linha = linhaDeConducao(atual);
  assert.match(linha, /^conduzido agora por hermes, sessao 11111111, fase GO, desde \d{2}\/\d{2} \d{2}:\d{2}$/);

  const superficies: Record<string, string> = {
    'ork thread status': resumoDaThread(lerThread(p.dir, thread.id), conducaoDaThread(p.dir, thread.id)),
    'ork board': textoDoBoard(p.carregado, false),
    'ork monitor': textoDoMonitor(montarMonitor(p.carregado, { semRuntime: true })),
    'ork pulse': textoDoPulse(montarPulse(p.carregado, { semRuntime: true })),
  };
  const snapshot = operationalSources(new MaestroReader(p.dir), [lerThread(p.dir, thread.id)], [], new Date().toISOString());
  const fato = snapshot.sessions?.items.find((i) => i.id === runtime.sessionId)?.facts.conduction;
  superficies['orkastery maestro'] = String(fato);
  for (const [nome, texto] of Object.entries(superficies)) assert.ok(texto.includes(linha), `${nome} nao traz a linha:\n${texto}`);

  // Domicilio unico do texto: nenhuma superficie nem host reimplementa a frase.
  const src = path.resolve(__dirname, '../../src');
  const achados = fs.readdirSync(src).filter((f) => f.endsWith('.ts'))
    .filter((f) => fs.readFileSync(path.join(src, f), 'utf8').includes('conduzido agora por'));
  assert.deepEqual(achados, ['conducao-texto.ts']);
});

test('CLI e MCP disputam o mesmo lease: o MCP recebe a mesma recusa tipada do CLI (T8, T18, CS10)', async () => {
  const p = projetoTemporario('conducao-cruzado');
  const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' }, { capabilities: {} });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const { thread } = novaThread(p.carregado, { nome: 'cruzado', modo: 'auto', criarWorktree: true });
    commitar(thread.worktree as string, 'produto.md', 'produto\n', 'produto');
    adicionarClaim(p.dir, thread.id, { arquivo: 'produto.md', alegacao: 'leva tempo', verificar: ['sleep 3 && echo cli'] });
    // O CLI conduz, pelo canal hermes, num processo filho.
    const filho = spawn(process.execPath, [CLI, 'verify', thread.id, '--so-claims'],
      { cwd: p.dir, env: { ...process.env, ORK_CANAL: 'hermes' }, stdio: 'ignore' });
    const fim = Date.now() + 15_000;
    while (!conducaoDaThread(p.dir, thread.id) && Date.now() < fim) await new Promise((r) => setTimeout(r, 50));
    assert.ok(conducaoDaThread(p.dir, thread.id), 'o CLI tomou a conducao');

    const r = await client.callTool({ name: 'ork_verify', arguments: { threadId: thread.id } });
    assert.equal(r.isError, true);
    const recusa = JSON.parse((r.content as { type: string; text: string }[]).map((c) => c.text).join(''));
    assert.equal(recusa.contrato, 'ork.conducao-recusa/v1');
    assert.equal(recusa.motivo, 'conducao.em-andamento');
    assert.equal(recusa.conducao.canal, 'hermes', 'quem conduz e o CLI do canal hermes');
    assert.equal(recusa.pedido.canal, 'claude-code', 'o canal do MCP e o host validado da conexao');
    assert.equal(recusa.pedido.operacao, 'mcp.verify');
    assert.equal(recusa.conducao.linha, linhaDeConducao(conducaoDaThread(p.dir, thread.id)!), 'a mesma linha do nucleo');
    assert.deepEqual(recusa.acoes.map((a: { acao: string }) => a.acao), ['esperar', 'acompanhar', 'assumir']);
    const status = await client.callTool({ name: 'ork_thread_status', arguments: { threadId: thread.id } });
    const dados = JSON.parse((status.content as { type: string; text: string }[]).map((c) => c.text).join(''));
    assert.equal(dados.linhaDeConducao, recusa.conducao.linha);
    assert.match(dados.resumo, /conducao {2}conduzido agora por hermes/);
    const [codigo] = await once(filho, 'exit');
    assert.equal(codigo, 0);
  } finally { await client.close(); await server.close(); p.limpar(); }
});
