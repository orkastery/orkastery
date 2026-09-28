/** Runtime/ledger/casa SIMULADOS e isolados. Nenhuma consulta a sessões operacionais. */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario, runtimeFalso } from './apoio';
import { dirThread, gravarThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { ControleSessao, IdentidadeSessao, superarSessao } from '../src/hitl-sessions';
import { OpcoesDoRadar, varrerSessoes } from '../src/hitl';
import { SessaoRuntime } from '../src/types';

const sid = '11111111-2222-3333-4444-555555555555';
const posterior = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function fixture() {
  const rt = runtimeFalso('superacao-radar');
  const p = projetoTemporario('superacao-radar');
  const t = novaThread(p.carregado, { nome: 'radar simulado', modo: 'auto' }).thread;
  t.faseAtual = 'GO';
  t.sessoes.push({ sessionId: sid, runtime: 'claude-bg', fase: 'GO', slug: t.slug, bloco: 'GO',
    promptPath: 'simulado.md', promptSha256: '0'.repeat(64), verificada: true, despachadaEm: new Date().toISOString() });
  gravarThread(p.dir, t);
  const dir = dirThread(p.dir, t.id);
  registrar(dir, t.id, 'phase_dispatch', { sessionId: sid, runtime: 'claude-bg', fase: 'GO' });
  registrar(dir, t.id, 'phase_dispatch', { sessionId: posterior, runtime: 'claude-bg', fase: 'GO' });
  registrar(dir, t.id, 'phase_dispatch_verified', { sessionId: posterior, encontrada: true });
  const bruta: SessaoRuntime = { id: sid.slice(0, 8), sessionId: sid, cwd: p.dir, state: 'blocked', startedAt: Date.now() - 100000 };
  let atual: IdentidadeSessao | undefined = { sessionId: sid, runtime: 'claude-bg', cwd: p.dir, estado: 'blocked',
    instancia: JSON.stringify([bruta.id, bruta.startedAt]) };
  let stops = 0;
  const ctl: ControleSessao = { consultar: () => ({ ok: true, sessoes: atual ? [atual] : [] }),
    parar: () => { stops++; atual = undefined; return true; } };
  const radar = (mudanca: Partial<SessaoRuntime> = {}, opcoes: Partial<OpcoesDoRadar> = {}) => varrerSessoes({
    raiz: p.dir, casa: path.join(p.dir, 'casa-simulada'), soParadas: true,
    consulta: { ok: true, sessoes: [{ ...bruta, ...mudanca }], detalhe: '' }, ...opcoes });
  const superar = () => superarSessao(p.dir, t.id, sid, 'GO', 'claude-bg', ctl);
  return { rt, p, t, dir, bruta, ctl, radar, superar, stops: () => stops,
    limpar: () => { rt.restaurar(); p.limpar(); } };
}

test('SIMULADO integrado: superação confirmada retira resíduo da fila humana, preservando recibo e idempotência', () => {
  const f = fixture();
  try {
    assert.equal(f.radar().resumo.abandonadas, 1);
    f.superar();
    const recibo = lerLedger(f.dir).find(e => e.tipo === 'session_superseded')!;
    assert.equal(recibo.cwd, f.p.dir);
    assert.equal(recibo.confirmacao, 'ausente');
    const antes = fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8');
    const depois = f.radar();
    assert.equal(depois.resumo.precisamDeHumano, 0);
    assert.equal(depois.sessoes.length, 0);
    assert.equal(f.radar({}, { soParadas: false }).sessoes[0].classe, 'interrompida');
    assert.equal(fs.readFileSync(path.join(f.dir, 'ledger.jsonl'), 'utf8'), antes);
    assert.equal(f.superar().repetida, true);
    assert.equal(f.stops(), 1);
  } finally { f.limpar(); }
});

test('SIMULADO: tentativa sem confirmação, consulta falha e sem logs preservam incerteza', () => {
  const f = fixture();
  try {
    assert.throws(() => superarSessao(f.p.dir, f.t.id, sid, 'GO', 'claude-bg', { ...f.ctl, parar: () => false }), /não confirmado/);
    assert.equal(f.radar().resumo.precisamDeHumano, 1);
    f.superar();
    assert.equal(f.radar({}, { semLogs: true }).resumo.precisamDeHumano, 1);
    const falha = f.radar({}, { consulta: { ok: false, sessoes: [], detalhe: 'falha SIMULADA' } });
    assert.equal(falha.runtimeConsultado, false);
    assert.equal(falha.runtimeDetalhe, 'falha SIMULADA');
    fs.writeFileSync(path.join(f.rt.dir, 'claude'), '#!/bin/sh\nif [ "$1" = "agents" ]; then echo "[]"; exit 0; fi\necho "consulta SIMULADA falhou" >&2\nexit 1\n', { mode: 0o755 });
    assert.equal(f.radar().resumo.precisamDeHumano, 1);
  } finally { f.limpar(); }
});

test('SIMULADO: recibo de outra instância/cwd/UUID e job vivo não ocultam alerta', () => {
  const f = fixture();
  try {
    f.superar();
    for (const mudanca of [{ startedAt: f.bruta.startedAt! + 1 }, { cwd: '/outro' },
      { sessionId: posterior }, { id: '22222222' }, { startedAt: undefined }]) {
      assert.equal(f.radar(mudanca).resumo.precisamDeHumano, 1);
    }
    f.rt.telaDaSessao('Pergunta SIMULADA atual\n1. Responder\n2. Esperar');
    assert.equal(f.radar().resumo.hitl, 1);
    assert.equal(f.radar().resumo.precisamDeHumano, 1);
    assert.equal(f.radar({ state: 'failed' }).resumo.precisamDeHumano, 1);
    assert.equal(f.radar({ state: 'novo-estado' }).resumo.precisamDeHumano, 1);
  } finally { f.limpar(); }
});

test('SIMULADO: novo bloqueio, despacho ou pedido invalida o recibo antigo', () => {
  for (const tipo of ['sessao_bloqueada', 'phase_dispatch', 'hitl_requested']) {
    const f = fixture();
    try {
      f.superar();
      assert.equal(f.radar().resumo.precisamDeHumano, 0);
      registrar(f.dir, f.t.id, tipo, tipo === 'hitl_requested'
        ? { pedido: { alvo: { tipo: 'session', sessionId: sid } } }
        : { sessionId: sid, fase: 'GO', runtime: 'claude-bg' });
      assert.equal(f.radar().resumo.precisamDeHumano, 1);
    } finally { f.limpar(); }
  }
});

test('SIMULADO: registro em outra fase/runtime ou identidade ambígua entre threads não herda superação', () => {
  for (const mudanca of [{ fase: 'CHECK' as const }, { runtime: 'codex' }, { ambigua: true }]) {
    const f = fixture();
    try {
      f.superar();
      if ('ambigua' in mudanca) {
        const outra = novaThread(f.p.carregado, { nome: 'outra simulada', modo: 'auto' }).thread;
        outra.sessoes.push({ ...f.t.sessoes[0] }); gravarThread(f.p.dir, outra);
      } else {
        f.t.sessoes[0] = { ...f.t.sessoes[0], ...mudanca }; gravarThread(f.p.dir, f.t);
      }
      assert.equal(f.radar().resumo.precisamDeHumano, 1);
    } finally { f.limpar(); }
  }
});

import { spawn } from 'node:child_process';
import { esperarCondicao } from './controller-simulado';
test('F6/F7 SIMULADO: radar conserva indisponibilidade tipada e limita sondas de controllers silenciosos', async () => {
  const p = projetoTemporario('radar-budget'); const t = novaThread(p.carregado, { nome: 'orçamento', modo: 'auto' }).thread;
  const dir = dirThread(p.dir, t.id); const filhos: Promise<number | null>[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const sessionId = `aaaaaaaa-bbbb-cccc-dddd-${String(i).padStart(12, '0')}`, controlador = path.join(dir, 'sessoes', `controller-${i}`);
      fs.mkdirSync(controlador, { recursive: true, mode: 0o700 });
      const vinculo = { thread: t.id, fase: 'GO', promptSha256: '0'.repeat(64) };
      fs.writeFileSync(path.join(controlador, 'state.json'), JSON.stringify({ instancia: `fixture-${i}`, sessionId, cwd: p.dir, vinculo,
        pid: 0, estado: i === 0 ? 'unavailable' : 'working', ...(i === 0 ? {
          terminal: { metodo: 'turn/completed', threadId: sessionId, turnId: 'turn', status: 'interrupted' },
          limitacao: { motivo: 'runtime.unavailable', codigo: 'question.multiple', metodo: 'item/tool/requestUserInput' } } : {}) }));
      t.sessoes.push({ sessionId, runtime: 'codex', controlador, fase: 'GO', slug: t.slug, bloco: 'GO',
        promptPath: 'simulado.md', promptSha256: vinculo.promptSha256, verificada: true, despachadaEm: new Date().toISOString() });
      registrar(dir, t.id, 'phase_dispatch', { sessionId, runtime: 'codex', fase: 'GO', controlador, promptSha256: vinculo.promptSha256 });
      if (i > 0) {
        const child = spawn(process.execPath, ['-e', `const fs=require('fs'),net=require('net');net.createServer(s=>s.on('error',()=>{})).listen('control.sock',()=>fs.writeFileSync('ready','1'));setTimeout(()=>process.exit(0),4500);`], { cwd: controlador, stdio: 'ignore' });
        filhos.push(new Promise(resolve => child.on('exit', resolve)));
        esperarCondicao(() => fs.existsSync(path.join(controlador, 'ready')));
      }
    }
    gravarThread(p.dir, t);
    const inicio = performance.now();
    const r = varrerSessoes({ raiz: p.dir, casa: path.join(p.dir, 'casa'), registrar: false, consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    const duracao = performance.now() - inicio;
    assert.ok(duracao < 2400, `orçamento de 1500 ms com margem de agendamento: ${duracao}`);
    assert.equal(r.sessoes.length, 4); assert.equal(r.resumo.precisamDeHumano, 4);
    assert.match(r.sessoes.find(s => s.sessionId.endsWith('000000000000'))!.detalhe, /runtime.unavailable: question.multiple/);
    assert.ok(r.sessoes.filter(s => !s.sessionId.endsWith('000000000000')).every(s => /orçamento nativo/.test(s.detalhe)));
  } finally { await Promise.all(filhos); p.limpar(); }
});
