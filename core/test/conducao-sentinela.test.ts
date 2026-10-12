/**
 * RM-059 (fatia F6, T6.4; DD5 do plano dos mods): a conducao pela Sentinela do Condutor no nucleo.
 *
 * A presenca da Sentinela por maquina (a batida toma, renova e recusa a segunda sessao; vencida, outra toma; os
 * eventos vao ao ledger do projeto so na troca), o passo do condutor por thread aberta (a regra do #Auto com a
 * guarda de produto, a conducao, o CHECK sem veredito, o bloqueio e os outros modos) e dois condutores pedindo a
 * mesma fase ao mesmo tempo, em processos de verdade: sai um despacho so.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PRAZO_DA_PRESENCA_MS } from '../src/conducao';
import {
  baterSentinela, bloqueioDepoisDoDespacho, caminhoDaPresenca, CONTRATO_DA_SENTINELA, desligarSentinela, PassoDoCondutor,
  passosDoCondutor, presencaDaSentinela, statusDaSentinela,
} from '../src/conducao-sentinela';
import { lerLedger, registrar } from '../src/ledger';
import { dirEstado } from '../src/manifest';
import { rodarFase } from '../src/phase';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { EventoLedger } from '../src/types';
import { exec } from '../src/util';
import { branchDaWorktree } from '../src/worktree';
import { commitar, envPtBr, projetoTemporario, runtimeFalso } from './apoio';

const CLI = path.resolve(__dirname, '../../dist/index.js');
const PEDIDO = 'Implementar a fatia do mod e provar pelos testes. #Auto';
const MAQUINA = 'maquina-de-teste';

/** O ambiente do filho sem o despacho, o canal e o projeto desta sessao: o teste e o unico condutor dele. */
function ambiente(): NodeJS.ProcessEnv {
  const env = envPtBr({ ...process.env, ORK_MAQUINA: MAQUINA });
  for (const nome of ['ORK_DISPATCH_ID', 'ORK_DISPATCH_THREAD', 'ORK_CANAL', 'CLAUDECODE', 'ORK_PROJETO', 'ORK_PROJETO_EXPLICITO']) delete env[nome];
  for (const nome of Object.keys(env)) if (nome.startsWith('ORK_HITL_')) delete env[nome];
  return env;
}

function ork(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: ambiente() });
}

/** O mesmo, em processo proprio e sem esperar: para dois condutores correrem juntos. */
function orkEmParalelo(dir: string, ...args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: ambiente() });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => { stdout += String(d); });
    filho.stderr.on('data', (d) => { stderr += String(d); });
    filho.on('close', (code) => resolver({ code, stdout, stderr }));
  });
}

const doTipo = (eventos: readonly EventoLedger[], tipo: string) => eventos.filter((e) => e.tipo === tipo);
const passoDe = (passos: PassoDoCondutor[], id: string) => passos.find((x) => x.thread === id) as PassoDoCondutor;

test('S1 presenca: a batida toma, renova e recusa a segunda sessao; vencida, outra toma; eventos so na troca', (t) => {
  const p = projetoTemporario('sentinela-presenca');
  t.after(() => p.limpar());
  const t0 = new Date('2026-10-12T15:00:00.000Z');
  const em = (ms: number) => new Date(t0.getTime() + ms);
  const a = baterSentinela(p.dir, { sessao: 'sessao-a', agora: t0, maquina: MAQUINA });
  assert.deepEqual([a.ok, a.ligou, a.presenca.ativa, a.presenca.canal], [true, true, true, 'claude-code']);
  assert.equal(a.presenca.contrato, CONTRATO_DA_SENTINELA);
  assert.equal(a.presenca.expiraEm, em(PRAZO_DA_PRESENCA_MS).toISOString());
  const renovada = baterSentinela(p.dir, { sessao: 'sessao-a', agora: em(60000), maquina: MAQUINA });
  assert.deepEqual([renovada.ok, renovada.ligou, renovada.presenca.desde], [true, false, t0.toISOString()]);
  const outra = baterSentinela(p.dir, { sessao: 'sessao-b', agora: em(90000), maquina: MAQUINA });
  assert.deepEqual([outra.ok, outra.ligou, outra.presenca.sessao], [false, false, 'sessao-a'], 'uma Sentinela por maquina');
  const vencida = em(60000 + PRAZO_DA_PRESENCA_MS + 1);
  assert.equal(presencaDaSentinela(p.dir, { agora: vencida, maquina: MAQUINA })?.ativa, false);
  const tomada = baterSentinela(p.dir, { sessao: 'sessao-b', agora: vencida, maquina: MAQUINA });
  assert.deepEqual([tomada.ok, tomada.ligou, tomada.presenca.desde], [true, true, vencida.toISOString()]);
  assert.equal(desligarSentinela(p.dir, { sessao: 'sessao-a', agora: vencida, maquina: MAQUINA }).desligada, false, 'so a propria sessao desliga');
  assert.equal(desligarSentinela(p.dir, { sessao: 'sessao-b', motivo: 'sessao do dono fechou', agora: vencida, maquina: MAQUINA }).desligada, true);
  assert.equal(presencaDaSentinela(p.dir, { maquina: MAQUINA }), null);
  const eventos = lerLedger(dirEstado(p.dir)).filter((e) => e.tipo.startsWith('sentinela_'));
  assert.deepEqual(eventos.map((e) => [e.tipo, e.sessao, e.canal, e.maquina]), [
    ['sentinela_ligada', 'sessao-a', 'claude-code', MAQUINA],
    ['sentinela_ligada', 'sessao-b', 'claude-code', MAQUINA],
    ['sentinela_desligada', 'sessao-b', 'claude-code', MAQUINA],
  ], 'a renovacao e a batida recusada nao vao ao ledger');
  assert.deepEqual(eventos[1].anterior, { sessao: 'sessao-a', expiraEm: em(60000 + PRAZO_DA_PRESENCA_MS).toISOString() });
  assert.equal(eventos[2].motivo, 'sessao do dono fechou');
  assert.throws(() => baterSentinela(p.dir, { sessao: 'com espaco', maquina: MAQUINA }), /conducao\.sentinela\.sessao/);
  assert.equal(path.basename(caminhoDaPresenca(p.dir, 'maquina/casa 2')), 'sentinela-maquina-casa-2.json');
  assert.equal(path.dirname(caminhoDaPresenca(p.dir, MAQUINA)), path.join(dirEstado(p.dir), 'conducao'));
});

test('S2 CLI: bater, a segunda sessao sai 3, status com o contrato e desligar', (t) => {
  const p = projetoTemporario('sentinela-cli');
  t.after(() => p.limpar());
  const bater = ork(p.dir, 'conducao', 'sentinela', 'bater', '--sessao', 'sessao-a', '--json');
  assert.equal(bater.status, 0, bater.stderr);
  assert.deepEqual([JSON.parse(bater.stdout).ok, JSON.parse(bater.stdout).ligou], [true, true]);
  const segunda = ork(p.dir, 'conducao', 'sentinela', 'bater', '--sessao', 'sessao-b', '--json');
  assert.equal(segunda.status, 3, segunda.stderr);
  assert.equal(JSON.parse(segunda.stdout).presenca.sessao, 'sessao-a');
  const status = ork(p.dir, 'conducao', 'sentinela', 'status', '--json');
  assert.equal(status.status, 0, status.stderr);
  const s = JSON.parse(status.stdout);
  assert.deepEqual([s.contrato, s.maquina, s.presenca.sessao, s.presenca.ativa], [CONTRATO_DA_SENTINELA, MAQUINA, 'sessao-a', true]);
  assert.deepEqual(s.threads, []);
  assert.match(ork(p.dir, 'conducao', 'sentinela', 'status').stdout, /Sentinela: ligada na maquina maquina-de-teste, canal claude-code/);
  assert.equal(ork(p.dir, 'conducao', 'sentinela', 'bater', '--json').status, 1, 'sem --sessao e erro de uso');
  const desligar = ork(p.dir, 'conducao', 'sentinela', 'desligar', '--sessao', 'sessao-a', '--json');
  assert.equal(desligar.status, 0, desligar.stderr);
  assert.equal(JSON.parse(desligar.stdout).desligada, true);
  assert.equal(JSON.parse(ork(p.dir, 'conducao', 'sentinela', 'status', '--json').stdout).presenca, null);
});

test('S3 passo do #Auto: sai a fase depois da prova mais adiantada do bloco; passado o CHECK, aviso; conduzida, nada', (t) => {
  const p = projetoTemporario('sentinela-passo');
  const runtime = runtimeFalso('sentinela-passo');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'passo', modo: 'auto', pedido: PEDIDO });
  rodarFase(p.carregado, thread.id, { fase: 'GOAL', prompt: 'faca o goal', canal: 'cli' });
  assert.deepEqual([passoDe(passosDoCondutor(p.carregado), thread.id).acao, passoDe(passosDoCondutor(p.carregado), thread.id).conduzida],
    ['nada', true], 'a sessao do despacho conduz');
  registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'GOAL', sessionId: runtime.sessionId,
    classificacao: 'fase_concluida', estado: 'concluida', ok: true });
  const passo = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([passo.acao, passo.fase, passo.conduzida, passo.pedidoGuardado, passo.modo], ['despachar', 'PLAN', false, true, 'auto']);
  assert.ok(passo.desdeEm, 'a chave do despacho e o fim do turno');
  assert.match(passo.porque, /GOAL concluida: a seguinte e PLAN/);
  // A sessao do bloco fez o PLAN (D1): o plan.md gravado depois do despacho prova o PLAN, e quem sai e o GO.
  const docs = path.join(dirThread(p.dir, thread.id), 'docs');
  const plano = path.join(docs, 'plan.md');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(plano, '# PLAN\n', 'utf8');
  const comPlano = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([comPlano.acao, comPlano.fase], ['despachar', 'GO']);
  assert.match(comPlano.porque, /ja fez ate PLAN: o plan\.md foi gravado depois do despacho: a seguinte e GO/);
  // O plan.md de antes do despacho (de outra sessao) nao prova nada: volta o PLAN.
  const antes = new Date(Date.now() - 24 * 60 * 60 * 1000);
  fs.utimesSync(plano, antes, antes);
  assert.deepEqual([passoDe(passosDoCondutor(p.carregado), thread.id).acao, passoDe(passosDoCondutor(p.carregado), thread.id).fase], ['despachar', 'PLAN']);
  // O bloco passou do CHECK (plan.md e check.md depois do despacho, produto fora da branch): o passo e o da entrega.
  fs.utimesSync(plano, new Date(), new Date());
  fs.writeFileSync(path.join(docs, 'check.md'), '# CHECK\n', 'utf8');
  const entrega = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([entrega.acao === 'despachar', entrega.fase], [false, null]);
  assert.match(entrega.porque, /ja passou do CHECK \(CHECK: o check\.md foi gravado depois do despacho\): o passo e o da entrega/);
  fs.rmSync(plano);
  fs.rmSync(path.join(docs, 'check.md'));
  // Com produto na branch (houve GO) e sem check.md, o PLAN nao sai: sai o CHECK.
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch], p.dir);
  commitar(p.dir, 'src/fatia.ts', 'export const fatia = 1;\n', 'feat: a fatia');
  exec('git', ['checkout', '-q', 'main'], p.dir);
  const comProduto = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([comProduto.acao, comProduto.fase], ['despachar', 'CHECK']);
  assert.match(comProduto.porque, /ja fez ate GO: a branch ja tem produto, e o GO vem antes dele: a seguinte e CHECK/);
  const status = statusDaSentinela(p.carregado, { maquina: MAQUINA });
  assert.equal(status.contrato, CONTRATO_DA_SENTINELA);
  assert.equal(passoDe(status.threads, thread.id).acao, comProduto.acao);
});

test('S4 passo: GO concluida com produto despacha o CHECK; CHECK sem veredito redespacha; sem pedido guardado avisa no campo', (t) => {
  const p = projetoTemporario('sentinela-check');
  const runtime = runtimeFalso('sentinela-check');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'check', modo: 'auto' });
  const branch = branchDaWorktree(thread);
  exec('git', ['checkout', '-q', '-b', branch], p.dir);
  commitar(p.dir, 'src/go.ts', 'export const go = 1;\n', 'feat: o go');
  exec('git', ['checkout', '-q', 'main'], p.dir);
  rodarFase(p.carregado, thread.id, { fase: 'GO', prompt: 'implemente', canal: 'cli' });
  registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'GO', sessionId: runtime.sessionId,
    classificacao: 'fase_concluida', estado: 'concluida', ok: true });
  const doGo = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([doGo.acao, doGo.fase, doGo.pedidoGuardado], ['despachar', 'CHECK', false], 'depois do GO, produto e o esperado');
  // O CHECK terminou em done sem o veredito: o passo do nucleo e redespachar o CHECK.
  rodarFase(p.carregado, thread.id, { fase: 'CHECK', prompt: 'verifique', canal: 'cli' });
  const fimDoCheck = new Date(Date.now() - 1000).toISOString();
  registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'CHECK', sessionId: runtime.sessionId,
    classificacao: 'gate_blocked', motivo: 'human.pending', origem: 'sessions.watch', estadoNativo: 'done', ok: false,
    stop: { ts: fimDoCheck }, provaOrk: { ok: false } });
  const doCheck = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([doCheck.acao, doCheck.fase], ['despachar', 'CHECK']);
  assert.match(doCheck.porque, /redespachar o CHECK/);
  // O redespacho do CHECK falhou antes de abrir sessao: o passo e o retry plan, com o fallback, e nao outro despacho.
  registrar(dirThread(p.dir, thread.id), thread.id, 'phase_dispatch_failed', { fase: 'CHECK', erro: 'runtime.unavailable: x' });
  registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', { gate: 'phase.dispatch', motivo: 'runtime.unavailable', fase: 'CHECK' });
  const falhou = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([falhou.acao, falhou.bloqueio?.motivo, falhou.bloqueio?.deDespacho], ['retomar', 'runtime.unavailable', true]);
  assert.match(falhou.porque, /o despacho depois do fim do turno falhou/);
});

test('S5 passo: bloqueio depois do despacho vira retomar; o gate liberado depois dele, nao; fora do #Auto, nunca despacha', (t) => {
  const evento = (tipo: string, ts: string, extra: Record<string, unknown> = {}) =>
    ({ ts, thread: 't', tipo, eventId: `${tipo}-${ts}`, ...extra }) as EventoLedger;
  assert.deepEqual(bloqueioDepoisDoDespacho([evento('phase_dispatch', '1'), evento('gate_blocked', '2', { motivo: 'runtime.quota-exhausted' })]),
    { motivo: 'runtime.quota-exhausted', em: '2', deDespacho: false });
  assert.deepEqual(bloqueioDepoisDoDespacho([evento('phase_dispatch', '1'), evento('gate_blocked', '2', { motivo: 'runtime.unavailable', gate: 'phase.dispatch' })]),
    { motivo: 'runtime.unavailable', em: '2', deDespacho: true });
  assert.equal(bloqueioDepoisDoDespacho([evento('gate_blocked', '1', { motivo: 'x' }), evento('phase_dispatch', '2')]), null);
  assert.equal(bloqueioDepoisDoDespacho([evento('phase_dispatch', '1'), evento('gate_blocked', '2'), evento('gate_passed', '3')]), null);
  assert.deepEqual(bloqueioDepoisDoDespacho([evento('phase_dispatch_failed', '1', { motivo: '' })]), { motivo: 'phase_dispatch_failed', em: '1', deDespacho: true });

  const p = projetoTemporario('sentinela-retomar');
  const runtime = runtimeFalso('sentinela-retomar');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'retomar', modo: 'auto', pedido: PEDIDO });
  registrar(dirThread(p.dir, thread.id), thread.id, 'gate_blocked', { gate: 'phase.dispatch', motivo: 'runtime.quota-exhausted', fase: 'GOAL' });
  const retomar = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.deepEqual([retomar.acao, retomar.bloqueio?.motivo, retomar.fase], ['retomar', 'runtime.quota-exhausted', null]);

  const { thread: classica } = novaThread(p.carregado, { nome: 'classica', modo: 'classic', pedido: PEDIDO });
  rodarFase(p.carregado, classica.id, { fase: 'GOAL', prompt: 'faca o goal', canal: 'cli' });
  registrar(dirThread(p.dir, classica.id), classica.id, 'phase_result', { fase: 'GOAL', sessionId: runtime.sessionId,
    classificacao: 'fase_concluida', estado: 'concluida', ok: true });
  const doClassico = passoDe(passosDoCondutor(p.carregado), classica.id);
  assert.notEqual(doClassico.acao, 'despachar', 'fora do #Auto a Sentinela nao despacha');
  assert.match(doClassico.porque, /so o #Auto e conduzido sem o dono|o passo e do dono/);
  // A thread que o dono pausou nao e retomada, nem com o bloqueio de cota depois do despacho (B3 da revisao).
  const pausada = lerThread(p.dir, thread.id);
  gravarThread(p.dir, { ...pausada, status: 'pausada' });
  const daPausada = passoDe(passosDoCondutor(p.carregado), thread.id);
  assert.notEqual(daPausada.acao, 'retomar');
  assert.match(daPausada.porque, /o passo e do dono \(thread pausada\)/);
});

test('S6 dois condutores ao mesmo tempo: a Sentinela e o cron pedem o PLAN em processos paralelos e sai um despacho so', async (t) => {
  const p = projetoTemporario('sentinela-dois');
  const runtime = runtimeFalso('sentinela-dois');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const { thread } = novaThread(p.carregado, { nome: 'dois', modo: 'auto', pedido: PEDIDO });
  const [sentinela, cron] = await Promise.all([
    orkEmParalelo(p.dir, 'phase', 'run', thread.id, 'PLAN', '--prompt', 'prompt renderizado pela Sentinela',
      '--canal', 'claude-code', '--correlacao', 'sentinela:sessao-a'),
    orkEmParalelo(p.dir, 'phase', 'run', thread.id, 'PLAN', '--prompt', 'prompt renderizado pelo cron', '--canal', 'hermes'),
  ]);
  const eventos = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(doTipo(eventos, 'phase_dispatch').length, 1, `${sentinela.stderr}\n${cron.stderr}`);
  assert.equal(runtime.chamadas().length, 1, 'uma sessao so no runtime');
  // Quem perde no mesmo instante cai na exclusao do kernel do despacho (saida 1, "HITL ocupado"); quem chega com a
  // conducao ja tomada recebe conducao.em-andamento (saida 3). Nos dois casos, nenhuma sessao a mais.
  const [venceu, perdeu] = sentinela.code === 0 ? [sentinela, cron] : [cron, sentinela];
  assert.equal(venceu.code, 0, venceu.stderr);
  assert.ok(perdeu.code === 3 || (perdeu.code === 1 && /HITL ocupado/.test(perdeu.stderr)), `${perdeu.code}: ${perdeu.stderr}`);
  const despacho = doTipo(eventos, 'phase_dispatch')[0];
  if (despacho.canal === 'claude-code') assert.equal(despacho.correlacao, 'sentinela:sessao-a');
  // Logo depois, com a sessao conduzindo: outro prompt e recusado com o motivo tipado, e o mesmo prompt e o repetido.
  const tarde = ork(p.dir, 'phase', 'run', thread.id, 'PLAN', '--prompt', 'outro prompt', '--canal', 'hermes');
  assert.equal(tarde.status, 3, tarde.stderr);
  const promptDoVencedor = venceu === sentinela ? 'prompt renderizado pela Sentinela' : 'prompt renderizado pelo cron';
  const repetido = ork(p.dir, 'phase', 'run', thread.id, 'PLAN', '--prompt', promptDoVencedor, '--canal', 'claude-code');
  assert.equal(repetido.status, 0, repetido.stderr);
  const logoDepois = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(doTipo(logoDepois, 'phase_dispatch').length, 1);
  assert.ok(doTipo(logoDepois, 'conducao_recusada').length >= 1);
  assert.equal(doTipo(logoDepois, 'despacho_idempotente').length, 1);
  assert.equal(runtime.chamadas().length, 1, 'nem a recusa nem o pedido repetido chegam ao runtime');
  // O mesmo pedido duas vezes ao mesmo tempo (duas rodadas da Sentinela): um despacho so.
  registrar(dirThread(p.dir, thread.id), thread.id, 'phase_result', { fase: 'PLAN', sessionId: runtime.sessionId,
    classificacao: 'fase_concluida', estado: 'concluida', ok: true });
  const mesmo = ['phase', 'run', thread.id, 'GO', '--prompt', 'o mesmo prompt', '--canal', 'claude-code', '--correlacao', 'sentinela:sessao-a'];
  const [um, outro] = await Promise.all([orkEmParalelo(p.dir, ...mesmo), orkEmParalelo(p.dir, ...mesmo)]);
  const depois = lerLedger(dirThread(p.dir, thread.id));
  assert.equal(doTipo(depois, 'phase_dispatch').filter((e) => e.fase === 'GO').length, 1, `${um.stderr}\n${outro.stderr}`);
  assert.equal(runtime.chamadas().length, 2, 'o pedido repetido nao abre sessao nova');
  assert.deepEqual([um.code, outro.code].filter((c) => c === 0).length >= 1, true);
});
