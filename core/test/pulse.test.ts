import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { projetoTemporario, runtimeFalso } from './apoio';
import { dirThread, novaThread } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { rodarFase } from '../src/phase';
import { montarPulse } from '../src/pulse';
import { pendentesDeScore } from '../src/master';
import { varrerSessoes } from '../src/hitl';
import { montarMonitor } from '../src/orquestracao';
import { assinaturaPulse, varrerPulse } from '../src/pulse-delivery';

test('mesma órfã escalada não é novidade só porque o tempo passou; novo episódio notifica', () => {
  const p = projetoTemporario('orfa-sem-spam');
  try {
    const t = novaThread(p.carregado, { nome: 'órfã', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id), sessionId = 'sessao-orfa-sem-rollout';
    registrar(dir, t.id, 'phase_dispatch', { ts: '2026-09-07T10:00:00Z', fase: 'GO', sessionId, runtime: 'codex' });
    for (let i = 0; i < p.carregado.manifesto.retry.max_tentativas; i++) {
      registrar(dir, t.id, 'retry_attempt', { ts: '2026-09-07T10:00:00Z', fase: 'GO', motivo: 'runtime.silencio' });
    }
    const consultar = (minuto: number) => montarPulse(p.carregado, { fontes: () => ({}),
      quando: `2026-09-07T10:${minuto}:00Z`, consulta: { ok: true, sessoes: [], detalhe: '' },
    });
    const primeiro = consultar(11), seguinte = consultar(16);
    const a = primeiro.precisaDeHumanoAgora.find(i => i.classe === 'fase_orfa')!;
    const b = seguinte.precisaDeHumanoAgora.find(i => i.classe === 'fase_orfa')!;
    assert.ok(a && b, 'órfã escalada precisa de humano');
    assert.notEqual(a.paradaHaMin, b.paradaHaMin);
    assert.equal(assinaturaPulse(a), assinaturaPulse(b), 'relógio não muda a assinatura');
    let enviadas = 0;
    const enviar = () => { enviadas++; return true; };
    assert.equal(varrerPulse({ raiz: p.dir, consultar: () => primeiro, enviar }).enviadas, 1);
    assert.equal(varrerPulse({ raiz: p.dir, consultar: () => seguinte, enviar }).enviadas, 0);
    registrar(dir, t.id, 'runtime_heartbeat', { ts: '2026-09-07T10:17:00Z', fase: 'GO', sessionId });
    assert.equal(varrerPulse({ raiz: p.dir, consultar: () => consultar(18), enviar }).enviadas, 0);
    assert.equal(varrerPulse({ raiz: p.dir, consultar: () => consultar(28), enviar }).enviadas, 1);
    assert.equal(enviadas, 2);
  } finally { p.limpar(); }
});

test('consulta indisponível não grava silêncio nem recomenda retry sobre sessão não observada', () => {
  const p = projetoTemporario('pulse-consulta-falhou');
  try {
    const t = novaThread(p.carregado, { nome: 'incerta', modo: 'auto' }).thread;
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_dispatch', { ts: '2026-09-07T10:00:00Z', fase: 'GO',
      sessionId: 'possivelmente-bloqueada', runtime: 'claude-bg' });
    const antes = lerLedger(dir);
    const pulse = montarPulse(p.carregado, { fontes: () => ({}), quando: '2026-09-07T10:20:00Z', registrar: true, escopo: [t.id],
      consulta: { ok: false, sessoes: [], detalhe: 'claude agents falhou (código 7)' } });
    assert.equal(pulse.runtime.ok, false);
    assert.equal(pulse.resumo.fasesOrfas, 0);
    assert.ok(!pulse.acoesAutomaticas.some(i => i.motivo === 'runtime.silencio'));
    assert.deepEqual(lerLedger(dir), antes);
  } finally { p.limpar(); }
});

test('pulse une monitor, HITL e batch, deduplica a mesma espera e preserva política distinta',t=>{
  const runtime=runtimeFalso('pulse'),p=projetoTemporario('pulse');
  t.after(()=>{runtime.restaurar();p.limpar();});
  const thread=novaThread(p.carregado,{nome:'bloqueio',modo:'classic'}).thread;
  rodarFase(p.carregado,thread.id,{fase:'GOAL',prompt:'Definir objetivo'});
  runtime.estadoDaSessao('blocked'); runtime.telaDaSessao('Aprovar a execução?\n1. Sim\n2. Não');
  const entrega=novaThread(p.carregado,{nome:'entrega',modo:'auto'}).thread;
  registrar(dirThread(p.dir,entrega.id),entrega.id,'ship_done',{ts:'2026-09-07T09:00:00Z'});
  const opts={registrar:true,escopo:[thread.id],quando:'2026-09-07T10:00:00Z'};
  const pulse=montarPulse(p.carregado,{...opts,fontes:()=>({})});
  assert.equal(pulse.contrato,'ork.pulse/v1');
  assert.equal(pulse.resumo.scores,pendentesDeScore(p.dir).length);
  // I-45: a entrega sem nota (fila aposentada na I-43) vai para a faixa automatica.
  assert.equal(pulse.resumo.humanos,1);
  assert.ok(pulse.acoesAutomaticas.some(i=>i.classe==='score_pendente'&&i.thread===entrega.id));
  const hitl=pulse.precisaDeHumanoAgora.find(i=>i.sessionId===runtime.sessionId)!;
  assert.ok(hitl.fontes.includes('monitor'));assert.ok(hitl.fontes.includes('sessions hitl'));
  assert.equal(hitl.paradaHaMin,0);
  assert.equal(varrerSessoes({raiz:p.dir}).resumo.precisamDeHumano,1);
  assert.equal(montarMonitor(p.carregado).resumo.aguardandoHumano,1);
  registrar(dirThread(p.dir,thread.id),thread.id,'gate_blocked',{fase:'GOAL',motivo:'policy.violation',detalhe:'política independente'});
  const depois=montarPulse(p.carregado,{fontes:()=>({}),quando:'2026-09-07T10:05:00Z'});
  assert.equal(depois.precisaDeHumanoAgora.find(i=>i.sessionId===runtime.sessionId)?.paradaHaMin,5);
  assert.ok(depois.precisaDeHumanoAgora.some(i=>i.motivo==='policy.violation'));
});

test('pulse ordena pelo tempo real e desempata por impacto; não cria idade de bloqueio',()=>{
  const p=projetoTemporario('pulse-ordem');
  try {
    for(const fase of ['GOAL','SHIP']) {
      const t=novaThread(p.carregado,{nome:fase,modo:'auto'}).thread;
      registrar(dirThread(p.dir,t.id),t.id,'gate_blocked',{fase,motivo:'human.pending',ts:'2026-09-07T09:00:00Z'});
    }
    const r=montarPulse(p.carregado,{fontes:()=>({}),quando:'2026-09-07T10:00:00Z',consulta:{ok:true,sessoes:[],detalhe:''}});
    assert.deepEqual(r.precisaDeHumanoAgora.map(i=>i.fase),['SHIP','GOAL']);
    assert.ok(r.precisaDeHumanoAgora.every(i=>i.paradaHaMin===60));
  } finally {p.limpar();}
});

test('CLI pulse retorna contrato e leitura pura não acrescenta eventos',t=>{
  const runtime=runtimeFalso('pulse-cli'),p=projetoTemporario('pulse-cli');
  t.after(()=>{runtime.restaurar();p.limpar();});
  const thread=novaThread(p.carregado,{nome:'puro',modo:'auto'}).thread;
  const before=lerLedger(dirThread(p.dir,thread.id)).length;
  const data=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../../dist/index.js'),'pulse','--json'],{cwd:p.dir,encoding:'utf8'}));
  assert.equal(data.contrato,'ork.pulse/v1');assert.ok(Array.isArray(data.precisaDeHumanoAgora));
  assert.equal(lerLedger(dirThread(p.dir,thread.id)).length,before);
});


test('pulse e CLI exigem escopo de escrita e mantem alerta alheio sem carimbo', t => {
  const runtime = runtimeFalso('pulse-escopo'), p = projetoTemporario('pulse-escopo');
  t.after(() => { runtime.restaurar(); p.limpar(); });
  const permitida = novaThread(p.carregado, { nome: 'permitida', modo: 'auto' }).thread;
  const observada = novaThread(p.carregado, { nome: 'observada', modo: 'auto' }).thread;
  const dir = dirThread(p.dir, observada.id);
  registrar(dir, observada.id, 'gate_blocked', { fase: 'GO', motivo: 'human.pending', ts: '2026-09-07T09:00:00Z' });
  const before = fs.readFileSync(path.join(dir, 'ledger.jsonl'));
  const consulta = { ok: true, sessoes: [], detalhe: '' };
  assert.throws(() => montarPulse(p.carregado, { fontes: () => ({}), registrar: true, consulta }), /scope.write.required/);
  const pulse = montarPulse(p.carregado, { fontes: () => ({}), registrar: true, escopo: [permitida.id], consulta, quando: '2026-09-07T10:00:00Z' });
  assert.ok(pulse.precisaDeHumanoAgora.some(i => i.thread === observada.id));
  const cli = path.resolve(__dirname, '../../dist/index.js');
  assert.throws(() => execFileSync(process.execPath, [cli, 'pulse', '--json', '--registrar'],
    { cwd: p.dir, encoding: 'utf8', stdio: 'pipe' }), /scope.write.required/);
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'pulse', '--json', '--registrar', '--escopo', permitida.id],
    { cwd: p.dir, encoding: 'utf8' }));
  assert.ok(result.precisaDeHumanoAgora.some((i: {thread: string}) => i.thread === observada.id));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'ledger.jsonl')), before);
  assert.equal(fs.existsSync(path.join(dir, 'liveness.json')), false);
});
