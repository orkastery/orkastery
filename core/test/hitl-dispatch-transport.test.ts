/** Transporte real de configuração com runtime simulado; nenhum modelo é aberto. */
import { test, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { instalarAdaptador } from '../src/hosts';
import { instalarMcp } from '../src/mcp-install';
import { novaThread, dirThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { abrirPedidoGate, assinaturaDaResposta, responderGate } from '../src/hitl-gates';
import { contextoDoProjeto, validarContextoRuntime } from '../src/runtime-context';
import { ambienteDeAssinatura } from '../src/runtime-ambiente';
import { ENV_HITL_VERIFIERS } from '../src/hitl-public-receipt';
import { aprovacaoHumanaProvada } from '../src/gates';
import { resolverRuntime } from '../src/runtimes';

for (const host of ['codex', 'claude-code'] as const) test(`${host}: despacho prepara legado e MCP recebe somente verificador público`, () => {
  const p = projetoTemporario('hitl-dispatch-transport'), saved = { ...process.env };
  const key = 'fixture-trusted-dispatch-key-'.repeat(3);
  Object.assign(process.env, { ORK_HITL_INGRESS_KEY_HERMES: key, ORK_HITL_TELEGRAM_USERS: '42', ORK_HITL_TELEGRAM_CHATS: '-7' });
  const runtime = host === 'codex' ? 'codex' : 'claude-bg';
  let mocked: ReturnType<typeof mock.method> | undefined;
  try {
    instalarAdaptador(host, { projeto: p.dir }); instalarMcp({ projeto: p.dir, host });
    const t = novaThread(p.carregado, { nome: 'Workflow HITL', modo: 'classic' }).thread;
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL' });
    const q = abrirPedidoGate(p.dir, t.id);
    const r = { resposta: '1', origem: 'telegram' as const, canal: 'hermes' as const,
      por: 'telegram:42', mensagem: 'telegram:-7:dispatch', recebidoEm: new Date().toISOString() };
    responderGate(p.dir, t.id, q.id, { ...r, prova: assinaturaDaResposta(t.id, q.id, r, key) });
    const event = lerLedger(dirThread(p.dir, t.id)).find(e => e.tipo === 'human_gate')!;
    const proof = path.join(p.dir, String(event.evidencia)) + '.public';
    fs.unlinkSync(proof);
    const context = contextoDoProjeto(p.dir, runtime, p.dir, t.id)!;
    const server = validarContextoRuntime(context, p.dir).servidor;
    assert.deepEqual(Object.keys(server.env!), [ENV_HITL_VERIFIERS]);
    assert.ok(!JSON.stringify(server).includes(key));
    assert.equal(server.args.includes('--child-permissions'), false);
    let calls = 0;
    const adapter = require(`../src/adapters/${runtime}`);
    mocked = mock.method(adapter, 'despachar', (request: { dryRun?: boolean }) => {
      calls++;
      assert.equal(fs.existsSync(proof), !request.dryRun);
      const parent = process.env;
      try {
        process.env = { ...ambienteDeAssinatura(parent), ...server.env };
        assert.equal(process.env.ORK_HITL_INGRESS_KEY_HERMES, undefined);
        assert.equal(aprovacaoHumanaProvada(p.dir, t.id, event), !request.dryRun);
        assert.deepEqual(validarContextoRuntime(context, p.dir).servidor.env, server.env);
      } finally { process.env = parent; }
      return { ok: true, comando: [], sessionId: null, verificada: false, stdout: '', stderr: '' };
    });
    const request = { cwd: p.dir, nome: 'fixture', prompt: 'fixture', contextoRuntime: context,
      vinculo: { thread: t.id, fase: 'PLAN', promptSha256: 'a'.repeat(64) } };
    assert.equal(resolverRuntime(runtime).despachar({ ...request, dryRun: true }).ok, true);
    assert.equal(resolverRuntime(runtime).despachar(request).ok, true);
    assert.equal(calls, 2);
  } finally { mocked?.mock.restore(); process.env = saved; p.limpar(); }
});
