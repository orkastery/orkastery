import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { novaThread, dirThread, listarIds } from '../src/thread';
import { registrar, lerLedger } from '../src/ledger';
import { detectarFasesOrfas, transcricaoClaude } from '../src/liveness';

const hora=(min:number)=>new Date(Date.UTC(2026,8,7,10,min)).toISOString();
const fontes=()=>({});

test('transcrição Claude adia silêncio e heartbeat novo encerra somente o episódio observado', () => {
  const p = projetoTemporario('claude-heartbeat');
  const anterior = process.env.CLAUDE_CONFIG_DIR;
  try {
    const t = novaThread(p.carregado, { nome: 'claude', modo: 'auto' }).thread;
    const sessionId = '8ad19ac4-0a17-4c5e-9909-2ce6b88e605e';
    const config = path.join(p.dir, 'claude-config');
    process.env.CLAUDE_CONFIG_DIR = config;
    const projeto = path.join(config, 'projects', 'projeto-abreviado');
    fs.mkdirSync(projeto, { recursive: true });
    const arquivo = path.join(projeto, `${sessionId}.jsonl`);
    fs.writeFileSync(arquivo, JSON.stringify({ timestamp: hora(8), type: 'assistant' }) + '\n');
    assert.equal(transcricaoClaude('../invalido', p.dir, config), undefined);
    assert.equal(transcricaoClaude(sessionId, p.dir, config), arquivo);
    const dir = dirThread(p.dir, t.id);
    registrar(dir, t.id, 'phase_dispatch', { ts: hora(0), fase: 'CHECK', sessionId, runtime: 'claude-bg' });
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(12), registrar: true, escopo: listarIds(p.dir) }).length, 0);
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(18), registrar: true, escopo: listarIds(p.dir) }).length, 1);
    fs.appendFileSync(arquivo, JSON.stringify({ timestamp: hora(19), type: 'assistant' }) + '\n');
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(20), registrar: true, escopo: listarIds(p.dir) }).length, 0);
    assert.equal(lerLedger(dir).at(-1)?.tipo, 'gate_passed');
    assert.equal(detectarFasesOrfas(p.carregado, { quando: hora(29), registrar: true, escopo: listarIds(p.dir) }).length, 1);
    assert.equal(lerLedger(dir).filter(e => e.tipo === 'gate_blocked' && e.motivo === 'runtime.silencio').length, 2);
  } finally {
    if (anterior === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = anterior;
    p.limpar();
  }
});
function abrir(p:ReturnType<typeof projetoTemporario>, nome='orfã') {
  const t=novaThread(p.carregado,{nome,modo:'auto'}).thread;
  registrar(dirThread(p.dir,t.id),t.id,'phase_dispatch',{ts:hora(0),fase:'GO',sessionId:t.id,runtime:'codex'});
  return t;
}
test('fx-fase-orfa: três despachos silenciosos detectados em 10 minutos, sem confundir polling com heartbeat',()=>{
  const p=projetoTemporario('fase-orfa');
  try {
    for(const nome of ['elevarqualid','fixture-b','trocarosdois']) {
      const t=abrir(p,nome);
      registrar(dirThread(p.dir,t.id),t.id,'worktree_audited',{ts:hora(9)});
    }
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(9),fontes}).length,0);
    const r=detectarFasesOrfas(p.carregado,{quando:hora(10),fontes,registrar:true,escopo:listarIds(p.dir)});
    assert.equal(r.length,3); assert.ok(r.every(x=>x.classe==='fase_orfa'&&!x.retry.automatica));
    detectarFasesOrfas(p.carregado,{quando:hora(11),fontes,registrar:true,escopo:listarIds(p.dir)});
    for(const s of r) assert.equal(lerLedger(dirThread(p.dir,s.thread)).filter(e=>e.motivo==='runtime.silencio').length,1);
  } finally {p.limpar();}
});
test('heartbeat da sessão, commit e crescimento do rollout adiam silêncio; leitura não grava',()=>{
  const p=projetoTemporario('heartbeat');
  try {
    const t=abrir(p), dir=dirThread(p.dir,t.id);
    registrar(dir,t.id,'runtime_event',{ts:hora(8),fase:'GO',sessionId:t.id});
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(12),fontes}).length,0);
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(18),fontes}).length,1);
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(18),fontes:()=>({commitEm:hora(15)})}).length,0);
    const rollout=path.join(p.dir,'rollout.jsonl');
    fs.writeFileSync(rollout,JSON.stringify({timestamp:hora(16),type:'event_msg'})+'\n');
    const leitura=()=>({rollout});
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(18),fontes:leitura}).length,0);
    assert.equal(fs.existsSync(path.join(dir,'liveness.json')),false);
    detectarFasesOrfas(p.carregado,{quando:hora(18),fontes:leitura,registrar:true,escopo:listarIds(p.dir)});
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(26),fontes:leitura}).length,1);
    fs.appendFileSync(rollout,JSON.stringify({timestamp:hora(25),type:'event_msg'})+'\n');
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(26),fontes:leitura}).length,0);
  } finally {p.limpar();}
});
test('evento de outra sessão e futuro não adiam; conclusão e gate humano explícito não são órfãos',()=>{
  const p=projetoTemporario('liveness-filtros');
  try {
    const t=abrir(p),dir=dirThread(p.dir,t.id);
    registrar(dir,t.id,'runtime_event',{ts:hora(9),sessionId:'outra',fase:'GO'});
    registrar(dir,t.id,'runtime_event',{ts:hora(59),sessionId:t.id,fase:'GO'});
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(10),fontes}).length,1);
    registrar(dir,t.id,'gate_blocked',{ts:hora(9),fase:'GO',motivo:'human.pending'});
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(10),fontes}).length,0);
    registrar(dir,t.id,'gate_passed',{ts:hora(10),fase:'GO'});
    registrar(dir,t.id,'phase_result',{ts:hora(11),fase:'GO',estado:'concluida',sessionId:t.id});
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(20),fontes}).length,0);
  } finally {p.limpar();}
});

test('liveness observa fora do escopo sem escrever; snapshot invalido preservado e diagnosticado', () => {
  const p = projetoTemporario('liveness-escopo');
  try {
    const a = abrir(p, 'permitida'), b = abrir(p, 'observada');
    const dirB = dirThread(p.dir, b.id), ledgerB = path.join(dirB, 'ledger.jsonl');
    const invalido = path.join(dirThread(p.dir, a.id), 'liveness.json');
    fs.writeFileSync(invalido, '{truncado');
    const antes = fs.readFileSync(ledgerB), diagnosticos: string[] = [];
    assert.throws(() => detectarFasesOrfas(p.carregado, { registrar: true, fontes }), /scope.write.required/);
    const resultado = detectarFasesOrfas(p.carregado, { registrar: true, escopo: [a.id],
      quando: hora(20), fontes, diagnosticos });
    assert.equal(resultado.length, 2, 'alerta alheio continua visivel');
    assert.deepEqual(fs.readFileSync(ledgerB), antes);
    assert.equal(fs.existsSync(path.join(dirB, 'liveness.json')), false);
    assert.deepEqual(diagnosticos, [`liveness.snapshot.invalid:${a.id}`]);
    assert.equal(fs.readFileSync(invalido, 'utf8'), '{truncado');
    assert.ok(lerLedger(dirThread(p.dir, a.id)).some(e => e.tipo === 'gate_blocked'));
    const rollout = path.join(p.dir, 'rollout.jsonl');
    fs.writeFileSync(rollout, JSON.stringify({ timestamp: hora(19) }) + '\n');
    detectarFasesOrfas(p.carregado, { registrar: true, escopo: [a.id], quando: hora(20), fontes: () => ({ rollout }) });
    assert.equal(fs.existsSync(path.join(dirB, 'liveness.json')), false, 'heartbeat alheio nao cria snapshot');
    assert.equal(fs.readFileSync(invalido, 'utf8'), '{truncado', 'nao repara apagando evidencia');
    assert.deepEqual(fs.readFileSync(ledgerB), antes);
  } finally { p.limpar(); }
});


test('silencio vivo ou estado ausente permanece alerta humano; apenas terminal permite plano automatico', () => {
  const p = projetoTemporario('liveness-retry');
  try {
    const t = abrir(p);
    for (const estado of ['working', 'unknown', '']) {
      const r = detectarFasesOrfas(p.carregado, { quando: hora(20), fontes, estados: new Map([[t.id, estado]]) });
      assert.equal(r.length, 1); assert.equal(r[0].retry.automatica, false);
    }
    const r = detectarFasesOrfas(p.carregado, { quando: hora(20), fontes, estados: new Map([[t.id, 'completed']]) });
    assert.equal(r[0].retry.automatica, true);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// I-34: o phase_result claude-bg do watcher é terminal para o radar de liveness (D10).
// ---------------------------------------------------------------------------
import { gravarThread } from '../src/thread';
import { ingerirEvento } from '../src/session-events';
import { observarSessao } from '../src/session-watcher';
import { fonteClaudeDoDespacho } from '../src/session-watcher-claude';
import { Modo } from '../src/types';

function claudeBg(p:ReturnType<typeof projetoTemporario>, nome:string, modo:Modo) {
  const t=novaThread(p.carregado,{nome,modo}).thread, dir=dirThread(p.dir,t.id);
  const sid=['11111111','2222','3333','4444',t.id.replace(/[^0-9a-f]/g,'').padEnd(12,'0').slice(0,12)].join('-');
  t.sessoes.push({sessionId:sid,slug:t.slug,fase:'GOAL',bloco:'GOAL',runtime:'claude-bg',despachadaEm:hora(0),
    promptPath:'',promptSha256:'',verificada:true});gravarThread(p.dir,t);
  registrar(dir,t.id,'phase_dispatch',{ts:hora(0),fase:'GOAL',sessionId:sid,runtime:'claude-bg',cwd:p.dir});
  registrar(dir,t.id,'session_sensor_registered',{ts:hora(0),fase:'GOAL',sessionId:sid,despachoEm:hora(0),...fonteClaudeDoDespacho(p.dir,t.id,'GOAL',p.dir)});
  const concluir=()=>{
    // GO-FIX 2 (D12): o GOAL só conclui com o artefato gravado depois do despacho.
    fs.mkdirSync(path.join(dir,'docs'),{recursive:true});fs.writeFileSync(path.join(dir,'docs','goal.md'),'# objetivo\n');
    ingerirEvento(p.dir,sid,'stop',JSON.stringify({observedAt:hora(5),eventId:'stop-'+nome}),Date.parse(hora(60)));
    return observarSessao(p.carregado,sid,{agoraMs:Date.parse(hora(6)),consultaClaude:()=>({ok:true,detalhe:'',consultadoEm:hora(6),
      registros:[{sessionId:sid,cwd:p.dir,state:'done'}]})});
  };
  return {t,dir,sid,concluir};
}

test('I-34: fase claude-bg concluída ou em pausa prevista pelo watcher não é órfã; sem resultado continua órfã',()=>{
  const p=projetoTemporario('liveness-claude-bg');
  try {
    const controle=claudeBg(p,'controle','auto');
    const orfas=detectarFasesOrfas(p.carregado,{quando:hora(20),fontes});
    assert.deepEqual(orfas.map(o=>o.thread),[controle.t.id]);
    assert.equal(orfas[0].sessionId,controle.sid);
    assert.equal(controle.concluir().classificacao,'fase_concluida');
    const resultado=lerLedger(controle.dir).find(e=>e.tipo==='phase_result')!;
    assert.equal(resultado.estado,'concluida'); assert.equal(resultado.ok,true); assert.equal(resultado.runtime,'claude-bg');
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(20),fontes}).length,0);
    const pausa=claudeBg(p,'pausa','classic');
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(20),fontes}).length,1);
    assert.equal(pausa.concluir().classificacao,'gate_blocked');
    assert.ok(lerLedger(pausa.dir).some(e=>e.tipo==='gate_blocked'&&e.motivo==='human.pending'&&e.origem==='sessions.watch'));
    assert.equal(detectarFasesOrfas(p.carregado,{quando:hora(40),fontes}).length,0);
  } finally {p.limpar();}
});
