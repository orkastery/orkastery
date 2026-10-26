/**
 * RM-067 (F1 e F2 da ork-grokbuild, D8 e D14): o `grok` de ponta a ponta pelo `ork phase run` e pelo redespacho do
 * retry, com o `grok` falso (a máquina não tem o runtime). O despacho real sobe o supervisor destacado, verifica a sessão
 * pela pasta dela, registra a fonte do sensor e inicia o watcher destacado, que grava o `phase_result` quando o stream e
 * o recibo dizem que o turno acabou; a condução solta junto. Nada do prompt nem da chave vai ao ledger.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { esperarCondicao } from './controller-simulado';
import { grokFalso } from './grok-falso';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { planejarRetry, redespachar, retomarPedido } from '../src/retry';
import { conducaoDaThread } from '../src/conducao';
import { noPath, exec } from '../src/util';
import { Fase } from '../src/types';

const PROMPT = 'Fatia de fixture SIMULADA para o despacho grok';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function cenario(nome: string, comStub = true, modo: 'auto' | 'classic' = 'auto') {
  const stub = comStub ? grokFalso(nome) : null;
  const p = projetoTemporario(`grok-desp-${nome}`);
  const t = novaThread(p.carregado, { nome, modo, criarWorktree: true }).thread;
  const dir = dirThread(p.dir, t.id);
  return { stub, p, t, dir, wt: lerThread(p.dir, t.id).worktree!, eventos: () => lerLedger(dir),
    limpar: () => { p.limpar(); stub?.restaurar(); } };
}

function despachar(c: ReturnType<typeof cenario>, fase: Fase) {
  return rodarFase(c.p.carregado, c.t.id, { fase, prompt: PROMPT, runtime: 'grok', model: 'grok-modelo' });
}

const resultadoDa = (c: ReturnType<typeof cenario>, sid: string) =>
  c.eventos().find((e) => e.tipo === 'phase_result' && e.sessionId === sid);

test('GD1: o ensaio do --runtime grok mostra o comando e nao despacha, e trocar de runtime sem modelo recusa', () => {
  const c = cenario('ensaio');
  try {
    const r = rodarFase(c.p.carregado, c.t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(r.dryRun, true);
    assert.equal(r.runtime, 'grok');
    assert.equal(r.comando[0], 'grok');
    assert.deepEqual(r.comando.slice(-9), ['--cwd', c.wt, '-m', 'grok-modelo', '--effort', 'high', '--sandbox', 'workspace',
      '--no-auto-update']);
    assert.deepEqual(c.stub!.chamadas(), [], 'o grok nao rodou');
    assert.equal(c.eventos().some((e) => e.tipo === 'phase_dispatch' || e.tipo === 'phase_prompt_recorded'), false);
    assert.throws(() => rodarFase(c.p.carregado, c.t.id, { fase: 'GOAL', prompt: PROMPT, runtime: 'grok', dryRun: true }),
      /setup\.model\.required/);
  } finally { c.limpar(); }
});

test('GD2: sem o grok no PATH, o despacho falha com o gate tipado runtime.unavailable e o prompt gravado', () => {
  const c = cenario('ausente', false);
  const antes = process.env.PATH;
  // Tira do PATH so as pastas com um grok executavel: o resto (git, sh) segue disponivel.
  process.env.PATH = (antes ?? '').split(path.delimiter).filter((d) => !d || !noPath(path.join(d, 'grok'))).join(path.delimiter);
  try {
    const r = despachar(c, 'GOAL');
    assert.equal(r.sessionId, null);
    assert.equal(r.motivo, 'runtime.unavailable');
    assert.equal(r.erro, 'runtime.unavailable: binario grok nao encontrado no PATH');
    const falha = c.eventos().find((e) => e.tipo === 'phase_dispatch_failed');
    assert.equal(falha?.runtime, 'grok');
    const gate = c.eventos().find((e) => e.tipo === 'gate_blocked');
    assert.equal(gate?.motivo, 'runtime.unavailable');
    assert.equal(gate?.runtime, 'grok');
    assert.equal(gate?.promptSha256, r.promptSha256, 'o retry acha o prompt gravado');
  } finally { process.env.PATH = antes; c.limpar(); }
});

test('GD3: o despacho real verifica a sessao, registra a fonte do grok e o watcher conclui pela prova do ork', () => {
  const c = cenario('real');
  const chaveAntes = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'x';
  try {
    c.stub!.stream('fim-normal.jsonl');
    c.stub!.artefato(path.join(c.dir, 'docs', 'plan.md'));
    const r = despachar(c, 'PLAN');
    assert.equal(r.bloqueado, false, r.erro);
    assert.match(r.sessionId!, UUID);
    assert.equal(r.verificada, true);
    const sid = r.sessionId!;
    const despacho = c.eventos().find((e) => e.tipo === 'phase_dispatch' && e.sessionId === sid)!;
    assert.equal(despacho.runtime, 'grok');
    assert.match(String((despacho.comando as string[])[2]), /^<prompt:[a-f0-9]{8}>$/, 'o prompt vai mascarado ao ledger');
    const verificado = c.eventos().find((e) => e.tipo === 'phase_dispatch_verified' && e.sessionId === sid)!;
    assert.equal(verificado.fonte, 'pasta da sessao em $GROK_HOME/sessions');
    assert.equal(verificado.encontrada, true);
    const registro = c.eventos().find((e) => e.tipo === 'session_sensor_registered' && e.sessionId === sid)!;
    assert.equal(registro.grok, 'streaming-json');
    assert.equal(registro.cwd, c.wt);
    assert.equal(registro.grokHome, c.stub!.casa);
    assert.equal(registro.logPath, path.join(c.dir, 'sessoes', `${sid}.grok.jsonl`));
    assert.deepEqual(registro.artefato, { arquivo: 'docs/plan.md', sha256: null }, 'a base do artefato e de antes do despacho');
    assert.ok(c.eventos().some((e) => e.tipo === 'session_watcher_started' && e.sessionId === sid), 'watcher iniciado');
    esperarCondicao(() => resultadoDa(c, sid) !== undefined, 60000);
    const res = resultadoDa(c, sid)!;
    assert.equal(res.runtime, 'grok');
    assert.equal(res.classificacao, 'fase_concluida');
    assert.equal(res.exitCode, 0);
    assert.equal(res.stopReason, 'end_turn');
    assert.equal(res.origem, 'sessions.watch');
    assert.equal(conducaoDaThread(c.p.dir, c.t.id), null, 'a conducao solta com o resultado');
    assert.equal(c.stub!.xaiVisto(), false, 'o filho nao recebe XAI_API_KEY');
    assert.equal(JSON.stringify(c.eventos()).includes(PROMPT), false, 'o ledger nao tem o texto do prompt');
  } finally {
    if (chaveAntes === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = chaveAntes;
    c.limpar();
  }
});

test('GD4: o redespacho do retry pelo grok leva os sensores ao registro e inicia o watcher', () => {
  const c = cenario('retry');
  try {
    c.stub!.stream('fim-normal.jsonl');
    const prompt = path.join(c.dir, 'prompt-retry.md');
    fs.writeFileSync(prompt, PROMPT);
    const sha = createHash('sha256').update(PROMPT).digest('hex');
    const r = redespachar(c.p.carregado, lerThread(c.p.dir, c.t.id), 'GOAL', prompt, sha, { runtime: 'grok', model: 'grok-modelo' });
    assert.ok(r.sessionId, r.detalhe);
    const registro = c.eventos().find((e) => e.tipo === 'session_sensor_registered' && e.sessionId === r.sessionId)!;
    assert.equal(registro.grok, 'streaming-json');
    assert.equal(registro.logPath, path.join(c.dir, 'sessoes', `${r.sessionId}.grok.jsonl`));
    assert.ok(c.eventos().some((e) => e.tipo === 'session_watcher_started' && e.sessionId === r.sessionId));
    esperarCondicao(() => resultadoDa(c, r.sessionId!) !== undefined, 60000);
    assert.equal(resultadoDa(c, r.sessionId!)!.runtime, 'grok');
  } finally { c.limpar(); }
});

test('GD5: o GO pelo grok guarda na fonte o HEAD da worktree lido antes do despacho', () => {
  const c = cenario('go');
  try {
    c.stub!.stream('fim-normal.jsonl');
    const head = exec('git', ['rev-parse', 'HEAD'], c.wt).stdout.trim();
    const r = despachar(c, 'GO');
    assert.ok(r.sessionId, r.erro);
    const registro = c.eventos().find((e) => e.tipo === 'session_sensor_registered' && e.sessionId === r.sessionId)!;
    assert.equal(registro.head, head);
    assert.equal(registro.artefato, undefined, 'o GO nao tem artefato de documento');
    esperarCondicao(() => resultadoDa(c, r.sessionId!) !== undefined, 60000);
    const res = resultadoDa(c, r.sessionId!)!;
    assert.equal(res.motivo, 'human.pending', 'sem commit registrado pelo nucleo, o GO nao conclui');
  } finally { c.limpar(); }
});

test('GD6: a interrupcao real (SIGTERM) vira human.pending com a retomada, e o retry nao a reexecuta sozinho', () => {
  const c = cenario('sigterm');
  try {
    c.stub!.stream('cortado.jsonl');
    c.stub!.sinal('TERM');
    const r = despachar(c, 'GOAL');
    assert.ok(r.sessionId, r.erro);
    esperarCondicao(() => resultadoDa(c, r.sessionId!) !== undefined, 60000);
    const res = resultadoDa(c, r.sessionId!)!;
    assert.equal(res.motivo, 'human.pending');
    assert.equal((res.interrupcao as { sinal: string }).sinal, 'SIGTERM');
    const retomada = (res.retomada as { comando: string[] }).comando;
    assert.deepEqual(retomada.slice(0, 3), ['grok', '-p', 'continue']);
    assert.equal(retomada[retomada.indexOf('-r') + 1], r.sessionId);
    assert.equal(retomada.includes('-s'), false);
    assert.equal(planejarRetry(c.p.carregado, c.t.id).automatica, false, 'a interrupcao nao e reexecutada sozinha');
  } finally { c.limpar(); }
});

test('GD7: o rate limit do grok antes da sessao vai a fila com o runtime grok, e a retomada volta pelo grok com o modelo dele', () => {
  const c = cenario('rate');
  try {
    // Numa regressão, a retomada sairia pelo runtime do bloco: os falsos na frente do PATH impedem que um binário de
    // verdade rode na máquina do teste e deixam a marca da chamada.
    for (const nome of ['claude', 'codex']) {
      fs.writeFileSync(path.join(c.stub!.dir, nome), `#!/bin/sh\nprintf '%s\\n' "$@" >> "$(dirname "$0")/${nome}-chamado"\nexit 1\n`,
        { mode: 0o755 });
    }
    c.stub!.streamTexto(`${JSON.stringify({ type: 'error', message: '429 Too Many Requests, retry after 30 seconds' })}\n`);
    c.stub!.semSessao();
    c.stub!.saida(1);
    const r = despachar(c, 'GOAL');
    assert.equal(r.motivo, 'runtime.rate-limited');
    assert.equal((r.naFila as { runtime?: string } | null | undefined)?.runtime, 'grok', 'o pedido guarda o runtime explicito');
    assert.equal(r.naFila?.model, 'grok-modelo');
    // A retomada forcada redespacha pelo grok, nunca pelo runtime do bloco com o modelo do grok.
    c.stub!.stream('fim-normal.jsonl');
    c.stub!.saida(0);
    fs.rmSync(path.join(c.stub!.dir, 'sem-sessao'));
    const retomada = retomarPedido(c.p.carregado, r.naFila!, { forcar: true });
    assert.equal(retomada.despachada, true, retomada.detalhe);
    const chamadas = c.stub!.chamadas();
    assert.equal(chamadas.length, 2, 'a retomada chamou o grok');
    assert.equal(chamadas[1][chamadas[1].indexOf('-m') + 1], 'grok-modelo');
    assert.equal(c.eventos().filter((e) => e.tipo === 'phase_dispatch').at(-1)?.runtime, 'grok');
    assert.deepEqual(['claude', 'codex'].filter((nome) => fs.existsSync(path.join(c.stub!.dir, `${nome}-chamado`))), [],
      'nenhum outro runtime foi chamado');
  } finally { c.limpar(); }
});

test('GD8: no PLAN que fecha o bloco, o grok vai em read-only pelo phase run e pelo redespacho do retry', () => {
  const sandbox = (comando: string[]) => comando[comando.indexOf('--sandbox') + 1];
  const c = cenario('plano', true, 'classic');
  const auto = cenario('plano-auto');
  try {
    const r = rodarFase(c.p.carregado, c.t.id, { fase: 'PLAN', prompt: PROMPT, runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(r.bloqueado, false, r.erro);
    assert.equal(sandbox(r.comando), 'read-only');
    const prompt = path.join(c.dir, 'prompt-plano.md');
    fs.writeFileSync(prompt, PROMPT);
    const sha = createHash('sha256').update(PROMPT).digest('hex');
    const red = redespachar(c.p.carregado, lerThread(c.p.dir, c.t.id), 'PLAN', prompt, sha,
      { runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(sandbox(red.comando), 'read-only', red.detalhe);
    // No #Auto o PLAN nao fecha o bloco: vale o perfil da postura do manifesto.
    const a = rodarFase(auto.p.carregado, auto.t.id, { fase: 'PLAN', prompt: PROMPT, runtime: 'grok', model: 'grok-modelo', dryRun: true });
    assert.equal(sandbox(a.comando), 'workspace');
  } finally { c.limpar(); auto.limpar(); }
});
