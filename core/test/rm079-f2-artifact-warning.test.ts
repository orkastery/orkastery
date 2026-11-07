import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { lerLedger, registrar, registrarSeExiste, TIPOS_DE_EVENTO } from '../src/ledger';
import { criarServidorMcp } from '../src/mcp-server';
import { avisosDeArtefatoRegistrados, TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO } from '../src/phase-artifact-warning';
import { dirThread, novaThread, resumoDaThread } from '../src/thread';
import { commitar, projetoTemporario } from './apoio';

test('RM-079 F2: phase_result registra cada artefato solto, preserva o arquivo e ignora o versionado', () => {
  const p = projetoTemporario('rm079-f2-artifact-warning');
  try {
    commitar(p.dir, 'docs/check.md', '# check versionado\n', 'fixture versionada');
    const { thread } = novaThread(p.carregado, { nome: 'artefato solto', modo: 'auto', worktree: p.dir });
    fs.writeFileSync(path.join(p.dir, 'docs/goal.md'), '# copia solta\n');
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'GOAL', classificacao: 'fase_concluida' });

    let avisos = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO);
    assert.deepEqual(avisos.map((e) => e.caminho), ['docs/goal.md']);
    assert.equal(fs.readFileSync(path.join(p.dir, 'docs/goal.md'), 'utf8'), '# copia solta\n');
    assert.equal(avisos.some((e) => e.caminho === 'docs/check.md'), false);

    fs.writeFileSync(path.join(p.dir, 'docs/plan.md'), '# outra copia solta\n');
    registrarSeExiste(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'PLAN', classificacao: 'fase_concluida' });
    avisos = lerLedger(dirThread(p.dir, thread.id)).filter((e) => e.tipo === TIPOS_DE_EVENTO.artefatoDeFaseForaDoEstado);
    assert.ok(avisos.some((e) => e.caminho === 'docs/plan.md'), 'o watcher destacado grava o aviso antes do resultado');
    assert.ok(avisos.every((e) => e.motivo === 'artefato-de-fase-fora-do-estado'));
    const estruturados = avisosDeArtefatoRegistrados(lerLedger(dirThread(p.dir, thread.id)));
    assert.deepEqual(estruturados.map((a) => a.caminho), ['docs/goal.md', 'docs/plan.md']);
    const resumo = resumoDaThread(thread, null, estruturados);
    assert.match(resumo, /docs\/goal\.md/);
    assert.match(resumo, /ork_artifact_write/);
  } finally { p.limpar(); }
});

test('RM-079 F2: resultado bloqueado não apresenta aviso como fim de fase', () => {
  const p = projetoTemporario('rm079-f2-artifact-warning-blocked');
  try {
    const { thread } = novaThread(p.carregado, { nome: 'fase bloqueada', modo: 'auto', worktree: p.dir });
    fs.mkdirSync(path.join(p.dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'docs/check.md'), '# copia solta\n');
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'CHECK', classificacao: 'gate_blocked' });
    assert.equal(lerLedger(dirThread(p.dir, thread.id)).some((e) => e.tipo === TIPO_AVISO_ARTEFATO_FORA_DO_ESTADO), false);
  } finally { p.limpar(); }
});

test('RM-079 F2: ork_thread_status apresenta o aviso tipado e o caminho', async () => {
  const p = projetoTemporario('rm079-f2-artifact-warning-status');
  const server = criarServidorMcp({ projeto: p.dir, host: 'codex' });
  const client = new Client({ name: 'fixture-MCP-SIMULADA', version: '1' });
  const [cliente, servidor] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(servidor); await client.connect(cliente);
    const { thread } = novaThread(p.carregado, { nome: 'status do aviso', modo: 'auto', worktree: p.dir });
    fs.mkdirSync(path.join(p.dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(p.dir, 'docs/check.md'), '# copia solta\n');
    registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'CHECK', classificacao: 'fase_concluida' });
    const resposta = await client.callTool({ name: 'ork_thread_status', arguments: { threadId: thread.id } });
    const texto = (resposta.content as { type: string; text: string }[]).map((c) => c.text).join('');
    const dados = JSON.parse(texto);
    assert.equal(resposta.isError, undefined);
    assert.deepEqual(dados.avisos.map((a: { caminho: string }) => a.caminho), ['docs/check.md']);
    assert.match(dados.resumo, /docs\/check\.md/);
  } finally { await client.close(); await server.close(); p.limpar(); }
});
