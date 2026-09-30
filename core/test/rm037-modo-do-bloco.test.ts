/**
 * RM-037 (rm037defeito, defeito 2): "codex em #Auto roda so a primeira fase". O PLAN redespachado da
 * ork-pacotedeexpe (bloco GOAL..MASTER) abriu o codex com `collaboration_mode_kind: plan` (rollout
 * 01a0ed23): a sessao inteira ficou em modo plano e o GO teve de sair num despacho a parte. A regra
 * olhava a FASE DE ENTRADA; agora olha o bloco, a mesma nos dois runtimes.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimePorConta } from './apoio';
import { controllerSimulado } from './controller-simulado';
import { encerrarController } from '../src/adapters/codex-controller';
import { lerLedger } from '../src/ledger';
import { hashDoPrompt, modoDaSessaoDoBloco, rodarFase } from '../src/phase';
import { redespachar } from '../src/retry';
import { dirThread, lerThread, novaThread } from '../src/thread';
import { Modo } from '../src/types';
import { exec } from '../src/util';

test('defeito 2: o modo de sessao sai do bloco, nao da fase de entrada', () => {
  const p = projetoTemporario('rm037-modo-regra');
  try {
    const modo = (m: Modo) => novaThread(p.carregado, { nome: `regra ${m}`, modo: m }).thread;
    const auto = modo('auto'), classic = modo('classic'), maestro = modo('maestro');
    // Bloco que segue depois da entrada: a sessao precisa implementar, verificar e entregar.
    assert.deepEqual(modoDaSessaoDoBloco(auto, 'PLAN'), { plano: false, revisaoNativa: false });
    assert.deepEqual(modoDaSessaoDoBloco(auto, 'CHECK'), { plano: false, revisaoNativa: false });
    assert.deepEqual(modoDaSessaoDoBloco(maestro, 'CHECK'), { plano: false, revisaoNativa: false }, 'GO-CHECK-SHIP segue para o SHIP');
    // Bloco que termina na entrada: o modo da fase vale, como antes.
    assert.deepEqual(modoDaSessaoDoBloco(classic, 'PLAN'), { plano: true, revisaoNativa: false });
    assert.deepEqual(modoDaSessaoDoBloco(maestro, 'PLAN'), { plano: true, revisaoNativa: false }, 'GOAL-PLAN termina no PLAN');
    assert.deepEqual(modoDaSessaoDoBloco(classic, 'CHECK'), { plano: false, revisaoNativa: true }, 'GO-CHECK termina no CHECK');
  } finally { p.limpar(); }
});

test('defeito 2: claude-bg no PLAN de bloco GOAL..MASTER nao nega Edit/Write; no bloco so de PLAN, nega', () => {
  const p = projetoTemporario('rm037-modo-claude');
  const claude = runtimePorConta('rm037-modo-claude');
  try {
    claude.conta(p.dir, 'a');
    const auto = novaThread(p.carregado, { nome: 'plan auto', modo: 'auto' }).thread;
    const classic = novaThread(p.carregado, { nome: 'plan classic', modo: 'classic' }).thread;
    const negaEscrita = (id: string) => {
      const r = rodarFase(p.carregado, id, { fase: 'PLAN', prompt: 'plano SIMULADO', runtime: 'claude-bg', dryRun: true });
      assert.equal(r.bloqueado, false, r.erro);
      const i = r.comando.indexOf('--disallowedTools');
      return i >= 0 && /\bEdit\b/.test(r.comando[i + 1]) && /\bWrite\b/.test(r.comando[i + 1]);
    };
    assert.equal(negaEscrita(auto.id), false, 'o bloco segue para o GO: a sessao precisa escrever');
    assert.equal(negaEscrita(classic.id), true, 'o bloco termina no PLAN: plano nao implementa');
  } finally { p.limpar(); claude.restaurar(); }
});

/** Ultima chamada que abriu o turno no app-server simulado. */
function turnoAberto(runtimeHome: string): { method: string; params: Record<string, unknown> } {
  const calls = fs.readFileSync(path.join(runtimeHome, 'params.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s));
  return calls.filter(c => c.method === 'turn/start' || c.method === 'review/start').at(-1);
}

function encerrar(dir: string): void {
  for (const e of lerLedger(dir)) {
    if (e.tipo !== 'phase_dispatch' || typeof e.controlador !== 'string') continue;
    try {
      const launch = JSON.parse(fs.readFileSync(path.join(e.controlador, 'launch.json'), 'utf8'));
      encerrarController(e.controlador, launch.vinculo, launch.instancia, 8000);
    } catch { /* controller ja terminal */ }
  }
}

for (const caso of [
  { modo: 'auto' as Modo, fase: 'PLAN' as const, metodo: 'turn/start', plano: false, rotulo: 'PLAN de bloco GOAL..MASTER sai sem modo plano' },
  { modo: 'auto' as Modo, fase: 'CHECK' as const, metodo: 'turn/start', plano: false, rotulo: 'CHECK de bloco que segue para SHIP abre turno comum' },
  { modo: 'classic' as Modo, fase: 'PLAN' as const, metodo: 'turn/start', plano: true, rotulo: 'PLAN de bloco so de PLAN continua em modo plano' },
  { modo: 'classic' as Modo, fase: 'CHECK' as const, metodo: 'review/start', plano: false, rotulo: 'CHECK de bloco GO-CHECK continua no review nativo' },
]) {
  test(`defeito 2: codex, ${caso.rotulo}`, () => {
    const p = projetoTemporario(`rm037-modo-codex-${caso.modo}-${caso.fase.toLowerCase()}`);
    const f = controllerSimulado(p.dir);
    let dir = '';
    try {
      fs.writeFileSync(path.join(p.dir, '.gitignore'), 'fake-bin/\nruntime/\n');
      exec('git', ['add', '-A'], p.dir);
      exec('git', ['commit', '-m', 'base do teste com os stubs ignorados'], p.dir);
      const t = novaThread(p.carregado, { nome: `codex ${caso.modo}`, modo: caso.modo }).thread;
      dir = dirThread(p.dir, t.id);
      const r = rodarFase(p.carregado, t.id, { fase: caso.fase, prompt: 'fase SIMULADA FINALIZAR-SIMULADO', runtime: 'codex', model: 'modelo-SIMULADO' });
      assert.equal(r.verificada, true, r.erro);
      const turno = turnoAberto(f.runtimeHome);
      assert.equal(turno.method, caso.metodo);
      const colaboracao = (turno.params.collaborationMode as { mode?: string } | undefined)?.mode ?? null;
      assert.equal(colaboracao, caso.plano ? 'plan' : null);
    } finally { encerrar(dir); f.restaurar(); p.limpar(); }
  });
}

test('defeito 2 (A1 do CHECK 6): o redespacho do retry no claude-bg segue a regra do bloco', () => {
  const p = projetoTemporario('rm037-modo-retry');
  const claude = runtimePorConta('rm037-modo-retry');
  try {
    claude.conta(p.dir, 'a');
    const negaEscrita = (modo: Modo) => {
      const t = novaThread(p.carregado, { nome: `retry ${modo}`, modo }).thread;
      const prompt = `plano SIMULADO do ${modo}`;
      const relativo = path.join('.orkastery', 'threads', t.id, 'prompts', 'plano.md');
      fs.mkdirSync(path.dirname(path.join(p.dir, relativo)), { recursive: true });
      fs.writeFileSync(path.join(p.dir, relativo), prompt);
      const r = redespachar(p.carregado, lerThread(p.dir, t.id), 'PLAN', relativo, hashDoPrompt(prompt), { runtime: 'claude-bg', dryRun: true });
      assert.equal(r.ok, true, r.detalhe);
      const i = r.comando.indexOf('--disallowedTools');
      return i >= 0 && /\bWrite\b/.test(r.comando[i + 1]);
    };
    assert.equal(negaEscrita('auto'), false, 'no #Auto o bloco segue para o GO: a retomada do PLAN escreve');
    assert.equal(negaEscrita('classic'), true, 'no #Classic o bloco termina no PLAN: a retomada nao escreve');
  } finally { p.limpar(); claude.restaurar(); }
});
