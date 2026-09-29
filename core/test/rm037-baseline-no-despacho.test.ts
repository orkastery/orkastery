/**
 * RM-037 (rm037defeito, defeito 1): duas vezes em 29/09/2026 a sessao codex parou antes do GO porque o
 * sandbox recusou gravar a baseline no ledger (EROFS) e o MCP nao oferece a operacao; o condutor gravou a
 * baseline e redespachou. Agora o proprio despacho grava a baseline, pela mesma `gravarBaseline` do CLI,
 * antes de soltar o bloco com GO.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { controllerSimulado } from './controller-simulado';
import { encerrarController } from '../src/adapters/codex-controller';
import { lerLedger } from '../src/ledger';
import { baselineDoDespachoNecessaria, garantirBaselineDoDespacho, hashDoPrompt, rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { registrarConducaoDaSessao } from '../src/conducao';
import { criarServidorMcp } from '../src/mcp-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { exec } from '../src/util';

function encerrar(dir: string): void {
  for (const e of lerLedger(dir)) {
    if (e.tipo !== 'phase_dispatch' || typeof e.controlador !== 'string') continue;
    try {
      const launch = JSON.parse(fs.readFileSync(path.join(e.controlador, 'launch.json'), 'utf8'));
      encerrarController(e.controlador, launch.vinculo, launch.instancia, 8000);
    } catch { /* controller ja terminal */ }
  }
}

function projetoCodex(nome: string) {
  const p = projetoTemporario(nome);
  const f = controllerSimulado(p.dir);
  fs.writeFileSync(path.join(p.dir, '.gitignore'), 'fake-bin/\nruntime/\n');
  exec('git', ['add', '-A'], p.dir);
  exec('git', ['commit', '-m', 'base do teste com os stubs ignorados'], p.dir);
  // Comandos reais do manifesto: o build passa e o teste ja falhava (divida que a baseline separa).
  p.carregado.manifesto.verify.build = 'node -e "process.exit(0)"';
  p.carregado.manifesto.verify.test = 'node -e "process.exit(3)"';
  p.carregado.manifesto.runtime.sandbox = 'workspace-write';
  return { p, f };
}

test('defeito 1: o despacho codex do bloco com GO grava a baseline antes do phase_dispatch, uma vez so', () => {
  const { p, f } = projetoCodex('rm037-baseline-codex');
  let dir = '';
  try {
    const t = novaThread(p.carregado, { nome: 'baseline codex', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);
    const head = exec('git', ['rev-parse', 'HEAD'], p.dir).stdout.trim();
    const r = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'bloco SIMULADO FINALIZAR-SIMULADO', runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.verificada, true, r.erro);
    const eventos = lerLedger(dir);
    const iBaseline = eventos.findIndex(e => e.tipo === 'baseline_recorded');
    const iDespacho = eventos.findIndex(e => e.tipo === 'phase_dispatch');
    assert.ok(iBaseline >= 0 && iBaseline < iDespacho, 'a baseline vem antes de a sessao existir');
    const b = eventos[iBaseline];
    assert.equal(b.origem, 'phase.run');
    assert.equal(b.fonte, 'execucao real no HEAD, nao relatorio de fase', 'a mesma prova de origem do CLI');
    assert.equal(b.commit, head);
    assert.deepEqual((b.comandos as { nome: string; ok: boolean; code: number }[]).map(c => [c.nome, c.ok, c.code]),
      [['build', true, 0], ['test', false, 3]]);
    assert.equal(lerThread(p.dir, t.id).baseline?.commit, head);
    assert.equal(eventos.some(e => e.tipo === 'policy_warn' && e.policy === 'verify_regression'), false,
      'o aviso de bloco com GO sem baseline nao dispara: ela ja existe');
    assert.equal(baselineDoDespachoNecessaria(p.carregado, t.id, { fase: 'GO', prompt: 'x', runtime: 'codex', model: 'modelo-SIMULADO' }), false,
      'thread com baseline nao grava de novo');
  } finally { encerrar(dir); f.restaurar(); p.limpar(); }
});

test('defeito 1: ensaio, claude-bg, sandbox que grava o estado e bloco sem GO nao gravam baseline pelo despacho', () => {
  const { p, f } = projetoCodex('rm037-baseline-negativos');
  const claude = runtimePorConta('rm037-baseline-negativos');
  try {
    claude.conta(p.dir, 'a');
    const auto = novaThread(p.carregado, { nome: 'auto', modo: 'auto' }).thread;
    const classic = novaThread(p.carregado, { nome: 'classic', modo: 'classic' }).thread;
    const precisa = (id: string, fase: 'GOAL' | 'PLAN' | 'GO' | 'CHECK', runtime: string, dryRun = false) =>
      baselineDoDespachoNecessaria(p.carregado, id, { fase, prompt: 'x', runtime, model: 'modelo-SIMULADO', dryRun });
    assert.equal(precisa(auto.id, 'GOAL', 'codex'), true, 'positivo: codex, bloco com GO, sem baseline');
    assert.equal(precisa(auto.id, 'GOAL', 'codex', true), false, 'o ensaio nao executa nada');
    assert.equal(precisa(auto.id, 'GOAL', 'claude-bg'), false, 'no claude-bg a sessao grava a baseline ela mesma');
    assert.equal(precisa(auto.id, 'CHECK', 'codex'), false, 'do CHECK em diante o bloco ja nao tem GO');
    assert.equal(precisa(classic.id, 'GOAL', 'codex'), false, 'bloco so de GOAL nao tem GO');
    p.carregado.manifesto.runtime.sandbox = 'danger-full-access';
    assert.equal(precisa(auto.id, 'GOAL', 'codex'), false, 'sandbox que grava o estado deixa a sessao gravar');

    // claude-bg de verdade: o despacho sai e nenhuma baseline aparece.
    const r = rodarFase(p.carregado, auto.id, { fase: 'GOAL', prompt: 'objetivo SIMULADO', runtime: 'claude-bg' });
    assert.equal(r.verificada, true, r.erro);
    assert.equal(lerLedger(dirThread(p.dir, auto.id)).some(e => e.tipo === 'baseline_recorded'), false);
  } finally { f.restaurar(); p.limpar(); claude.restaurar(); }
});

// GO-FIX do CHECK 1 (A2, A3, S2).

test('defeito 1 (A3): no MCP o despacho nao roda a suite; a baseline que falta volta como baseline.pendente', async () => {
  const { p, f } = projetoCodex('rm037-baseline-mcp');
  const server = criarServidorMcp({ projeto: p.dir, host: 'claude-code' });
  const client = new Client({ name: 'condutor-SIMULADO', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    const t = novaThread(p.carregado, { nome: 'mcp', modo: 'auto' }).thread;
    const direto = rodarFase(p.carregado, t.id, { fase: 'GOAL', prompt: 'x', runtime: 'codex', model: 'modelo-SIMULADO', baselinePeloDespacho: false });
    assert.equal(direto.motivo, 'baseline.pendente');
    assert.match(direto.erro ?? '', new RegExp(`ork verify ${t.id} --baseline`));
    await server.connect(st); await client.connect(ct);
    const r = await client.callTool({ name: 'ork_phase_run', arguments: { threadId: t.id, fase: 'GOAL', prompt: 'bloco SIMULADO', runtime: 'codex', model: 'modelo-SIMULADO' } });
    const texto = (r.content as { type: string; text: string }[]).map(x => x.text).join('');
    assert.match(texto, /baseline\.pendente/);
    const eventos = lerLedger(dirThread(p.dir, t.id));
    assert.equal(eventos.some(e => e.tipo === 'baseline_recorded'), false, 'o MCP nao executou a suite');
    assert.equal(eventos.some(e => e.tipo === 'phase_dispatch'), false, 'nem abriu a sessao sem a baseline');
  } finally { await client.close(); await server.close(); f.restaurar(); p.limpar(); }
});

test('defeito 1 (A2): o redespacho do retry para o codex tambem grava a baseline antes da sessao', () => {
  const { p, f } = projetoCodex('rm037-baseline-retry');
  let dir = '';
  try {
    const t = novaThread(p.carregado, { nome: 'retry codex', modo: 'auto' }).thread;
    dir = dirThread(p.dir, t.id);
    const prompt = 'retomada SIMULADA FINALIZAR-SIMULADO';
    const relativo = path.join('.orkastery', 'threads', t.id, 'prompts', 'retomada.md');
    fs.mkdirSync(path.dirname(path.join(p.dir, relativo)), { recursive: true });
    fs.writeFileSync(path.join(p.dir, relativo), prompt);
    const r = redespachar(p.carregado, lerThread(p.dir, t.id), 'GOAL', relativo, hashDoPrompt(prompt), { runtime: 'codex', model: 'modelo-SIMULADO' });
    assert.equal(r.ok, true, r.detalhe);
    const eventos = lerLedger(dir);
    const iBaseline = eventos.findIndex(e => e.tipo === 'baseline_recorded');
    const iDespacho = eventos.findIndex(e => e.tipo === 'phase_dispatch');
    assert.ok(iBaseline >= 0 && iBaseline < iDespacho, 'a baseline vem antes da sessao retomada');
  } finally { encerrar(dir); f.restaurar(); p.limpar(); }
});

test('defeito 1 (S2): thread que ja conduz nao ganha baseline nem conducao_recusada espuria', () => {
  const { p, f } = projetoCodex('rm037-baseline-conduz');
  try {
    const t = novaThread(p.carregado, { nome: 'conduz', modo: 'auto' }).thread;
    assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 3600_000 },
      { sessionId: '00000000-0000-4000-8000-000000000041', runtime: 'codex', perfil: null }), true);
    garantirBaselineDoDespacho(p.carregado, t.id, { fase: 'GOAL', prompt: 'x', runtime: 'codex', model: 'modelo-SIMULADO' });
    const tipos = lerLedger(dirThread(p.dir, t.id)).map(e => e.tipo);
    assert.equal(tipos.includes('baseline_recorded'), false);
    assert.equal(tipos.includes('conducao_recusada'), false);
  } finally { f.restaurar(); p.limpar(); }
});
