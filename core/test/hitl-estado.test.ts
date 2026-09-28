import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { carimbarSessoes, ledgerDeSessao } from '../src/hitl-estado';
import { varrerSessoes } from '../src/hitl';
import { novaThread, dirThread, listarIds } from '../src/thread';
import { projetoTemporario } from './apoio';
import { lerLedger } from '../src/ledger';
import { spawnSync } from 'node:child_process';

const hora = (min: number) => new Date(Date.UTC(2026,8,7,10,min)).toISOString();
function sessao(raiz: string) {
  return varrerSessoes({raiz, casa:path.join(raiz, 'maquina'), semLogs:true, consulta:{ok:true,detalhe:'',sessoes:[{
    sessionId:'sessao-teste', id:'teste', state:'blocked', startedAt:Date.UTC(2026,0,1)
  }]}}).sessoes[0];
}

test('lock HITL preserva dono vivo e recupera processo morto ou criação interrompida antiga', () => {
  const p = projetoTemporario('hitl-lock');
  try {
    const casa = path.join(p.dir, 'maquina'), s = sessao(p.dir);
    const opcoes = { raiz: p.dir, quando: hora(0), casa, registrar: true, registrarMaquina: true };
    carimbarSessoes([s], opcoes);
    const file = ledgerDeSessao(p.dir, s, casa), lock = file + '.hitl-lock';
    const antes = fs.readFileSync(file, 'utf8');
    fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
    assert.throws(() => carimbarSessoes([s], opcoes), /ocupado/);
    assert.equal(fs.readFileSync(file, 'utf8'), antes);
    const morto = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    fs.writeFileSync(path.join(lock, 'pid'), morto.stdout);
    carimbarSessoes([s], opcoes);
    assert.equal(fs.existsSync(lock), false);
    fs.mkdirSync(lock);
    assert.throws(() => carimbarSessoes([s], opcoes), /ocupado/);
    const antigo = new Date(Date.now() - 120000);
    fs.utimesSync(lock, antigo, antigo);
    carimbarSessoes([s], opcoes);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.readFileSync(file, 'utf8'), antes);
  } finally { p.limpar(); }
});

test('carimbo idempotente, espera real e desbloqueio confirmado no ledger da thread', () => {
  const p = projetoTemporario('hitl-estado');
  try {
    const t = novaThread(p.carregado,{nome:'carimbo',modo:'auto'}).thread;
    const s = sessao(p.dir); s.thread={id:t.id,fase:'GO',slug:t.slug};
    carimbarSessoes([s],{raiz:p.dir,quando:hora(0)});
    assert.equal(s.paradaHaMin,null);
    carimbarSessoes([s],{raiz:p.dir,quando:hora(1),registrar:true,escopo:listarIds(p.dir)});
    carimbarSessoes([s],{raiz:p.dir,quando:hora(11),registrar:true,escopo:listarIds(p.dir)});
    assert.equal(s.paradaHaMin,10); assert.equal(s.bloqueadaDesdeEm,hora(1));
    assert.equal(lerLedger(dirThread(p.dir,t.id)).filter(e=>e.tipo==='sessao_bloqueada').length,1);
    s.classe='desconhecida'; carimbarSessoes([s],{raiz:p.dir,quando:hora(12),registrar:true,escopo:listarIds(p.dir)});
    assert.equal(lerLedger(dirThread(p.dir,t.id)).at(-1)?.tipo,'sessao_bloqueada');
    s.classe='trabalhando'; s.estadoBruto='working';
    carimbarSessoes([s],{raiz:p.dir,quando:hora(13),registrar:true,escopo:listarIds(p.dir)});
    carimbarSessoes([s],{raiz:p.dir,quando:hora(14),registrar:true,escopo:listarIds(p.dir)});
    assert.equal(lerLedger(dirThread(p.dir,t.id)).filter(e=>e.tipo==='sessao_destravada').length,1);
    s.classe='hitl'; s.estadoBruto='blocked';
    carimbarSessoes([s],{raiz:p.dir,quando:hora(15),registrar:true,escopo:listarIds(p.dir)});
    assert.equal(s.bloqueadaDesdeEm,hora(15));
  } finally { p.limpar(); }
});

test('sessão sem thread usa ledger de máquina; leitura e falha de runtime não escrevem', () => {
  const p = projetoTemporario('hitl-maquina');
  try {
    const casa=path.join(p.dir,'maquina'), s=sessao(p.dir);
    carimbarSessoes([s],{raiz:p.dir,quando:hora(0),casa});
    assert.equal(fs.existsSync(casa),false);
    carimbarSessoes([s],{raiz:p.dir,quando:hora(0),casa,registrar:true,registrarMaquina:true});
    const file=ledgerDeSessao(p.dir,s,casa), before=fs.readFileSync(file,'utf8');
    assert.equal(path.basename(file),'sessoes.jsonl');
    const r=varrerSessoes({raiz:p.dir,casa,registrar:true,registrarMaquina:true,consulta:{ok:false,sessoes:[],detalhe:'offline'}});
    assert.equal(r.runtimeConsultado,false); assert.equal(fs.readFileSync(file,'utf8'),before);
    varrerSessoes({raiz:p.dir,casa,registrar:true,registrarMaquina:true,consulta:{ok:true,sessoes:[],detalhe:''}});
    assert.equal(fs.readFileSync(file,'utf8'),before,'sessão ausente não é prova de desbloqueio');
  } finally { p.limpar(); }
});

test('carimbo requer escopo; pergunta fora dele continua visivel sem criar lock nem evento', () => {
  const p = projetoTemporario('hitl-escopo');
  try {
    const a = novaThread(p.carregado, { nome: 'permitida', modo: 'auto' }).thread;
    const b = novaThread(p.carregado, { nome: 'observada', modo: 'auto' }).thread;
    const primeira = sessao(p.dir), segunda = sessao(p.dir), avulsa = sessao(p.dir);
    primeira.thread = { id: a.id, fase: 'GO', slug: a.slug };
    segunda.thread = { id: b.id, fase: 'GO', slug: b.slug };
    const arquivo = path.join(dirThread(p.dir, b.id), 'ledger.jsonl'), antes = fs.readFileSync(arquivo);
    const casa = path.join(p.dir, 'maquina');
    assert.throws(() => carimbarSessoes([primeira], { raiz: p.dir, quando: hora(0), registrar: true }), /scope.write.required/);
    carimbarSessoes([primeira, segunda, avulsa], { raiz: p.dir, casa, quando: hora(0), registrar: true, escopo: [a.id] });
    assert.equal(segunda.classe, 'hitl'); assert.equal(segunda.precisaDeHumano, true);
    assert.equal(segunda.bloqueadaDesdeEm, null);
    assert.deepEqual(fs.readFileSync(arquivo), antes);
    assert.equal(fs.existsSync(arquivo + '.hitl-lock'), false);
    assert.equal(fs.existsSync(casa), false, 'escopo de thread nao autoriza ledger de maquina');
    assert.equal(lerLedger(dirThread(p.dir, a.id)).filter(e => e.tipo === 'sessao_bloqueada').length, 1);
  } finally { p.limpar(); }
});
