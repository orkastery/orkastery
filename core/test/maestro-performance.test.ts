import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { projetoTemporario } from './apoio';
import { novaThread } from '../src/thread';
import { discoverMaestro } from '../src/maestro-discovery';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { collectMaestroSources, digest, item, MaestroSources } from '../src/maestro-sources';
import { MAESTRO_LIMITS, SECTION_NAMES, validateMaestroSnapshot } from '../src/maestro-contract';
import { observeWithDeadline } from '../src/maestro-runtime';

test('500 threads / 1.000 sessões: cobertura, paginação estável e leitura sem escrita', t => {
  const p=projetoTemporario('maestro-load');
  try {
    const base=novaThread(p.carregado,{nome:'Carga',modo:'auto'}).thread;
    fs.rmSync(path.join(p.dir,'.orkastery/threads',base.id),{recursive:true});
    for(let n=0;n<500;n++) {
      const id=`ork-load-${String(n).padStart(4,'0')}`, dir=path.join(p.dir,'.orkastery/threads',id);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir,'thread.json'),JSON.stringify({...base,id,sessoes:[0,1].map(i=>({
        sessionId:`session-${id}-${i}`,runtime:'codex',fase:'GO',bloco:'GO',slug:id,
        promptPath:'',promptSha256:'',despachadaEm:base.criadaEm,verificada:true}))}));
      fs.writeFileSync(path.join(dir,'ledger.jsonl'),'');
    }
    const inventory=()=>fs.readdirSync(path.join(p.dir,'.orkastery/threads')).map(id=>{
      const dir=path.join(p.dir,'.orkastery/threads',id);
      return [id,...fs.readdirSync(dir).sort().map(file=>[file,fs.readFileSync(path.join(dir,file),'utf8'),fs.statSync(path.join(dir,file)).mtimeMs])];
    });
    const before=inventory(),ctx=discoverMaestro({cwd:p.dir}),times:number[]=[];
    for(let n=0;n<3;n++) {
      let calls=0; const start=performance.now();
      const s=maestroSnapshot(ctx,{collect:c=>{calls++;return collectMaestroSources(c);}}); times.push(performance.now()-start);
      assert.equal(calls,1);assert.equal(s.sections.threads.coverage.total,500);
      assert.equal(s.sections.sessions.coverage.total,1000);assert.ok(Buffer.byteLength(JSON.stringify(s))<=65536);
      assert.ok(Object.values(s.sections).every(x=>x.items.length<=50));
    }
    const ids:string[]=[];let offset=0;
    do {
      const s=maestroSnapshot(ctx,{offsets:{sessions:offset}}).sections.sessions;
      ids.push(...s.items.map(x=>x.id));
      assert.equal(s.coverage.offset+s.coverage.returned+s.coverage.omitted!,1000);
      if(s.coverage.nextOffset===null)break;
      assert.ok(s.coverage.nextOffset>offset);offset=s.coverage.nextOffset;
    } while(offset<1000);
    assert.equal(new Set(ids).size,1000);assert.deepEqual(inventory(),before);
    t.diagnostic(JSON.stringify({kind:'local-fixture-measurement',node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,samplesMs:times,minMs:Math.min(...times),maxMs:Math.max(...times)}));
  } finally {p.limpar();}
});

for(const unavailable of [false,true])test(`orçamento UTF-8 mantém página recuperável: unavailable=${unavailable}`,()=>{
  const p=projetoTemporario('maestro-budget');
  try {
    const sections:MaestroSources['sections']={};
    for(const name of SECTION_NAMES)sections[name]={source:name,gaps:[],...(unavailable?{state:'unavailable' as const}:{}),items:Array.from({length:60},(_,n)=>({
      ...item(`${name}-${n.toString().padStart(3,'0')}`,'á'.repeat(400),'ready',[],{large:'界'.repeat(200)}),
      ...(name==='nextActions'?{action:{operation:'thread.status' as const,available:true,reason:'',preconditions:[],readback:'ork_thread_status'}}:{})}))};
    const source={sections,fingerprint:digest(sections),gaps:[],conflicts:[],unchanged:()=>true};
    const s=maestroSnapshot(discoverMaestro({cwd:p.dir}),{collect:()=>source});
    assert.ok(Buffer.byteLength(JSON.stringify(s))<=MAESTRO_LIMITS.bytes);
    for(const section of Object.values(s.sections)) {
      assert.ok(section.coverage.nextOffset!>0);assert.ok(section.items.length>0);
      if(unavailable){assert.equal(section.coverage.total,null);assert.equal(section.coverage.omitted,null);}
      else assert.equal(section.coverage.returned+section.coverage.omitted!,60);
    }
    assert.ok(Object.values(s.sections).some(section=>section.gaps.includes('maestro.page.byte_limit')));
    const ids:string[]=[];let offset=0;
    do {
      const page=maestroSnapshot(discoverMaestro({cwd:p.dir}),{collect:()=>source,offsets:{sessions:offset}}).sections.sessions;
      ids.push(...page.items.map(i=>i.id));
      if(page.coverage.nextOffset===null)break;
      assert.ok(page.coverage.nextOffset>offset);offset=page.coverage.nextOffset;
    }while(offset<60);
    assert.deepEqual(ids,sections.sessions!.items.map(i=>i.id));
  } finally {p.limpar();}
});

test('fonte unavailable com 75 itens pagina sem transformar cobertura desconhecida em total conhecido',()=>{
  const p=projetoTemporario('maestro-partial-page');
  try {
    const items=Array.from({length:75},(_,i)=>item(`session-${String(i).padStart(3,'0')}`,'Sessão','unknown'));
    const source:MaestroSources={sections:{sessions:{source:'sessions',state:'unavailable',items,gaps:['threads.unavailable']}},
      fingerprint:digest(items),gaps:[],conflicts:[],unchanged:()=>true};
    const ctx=discoverMaestro({cwd:p.dir});
    const first=maestroSnapshot(ctx,{collect:()=>source}),c=first.sections.sessions.coverage;
    assert.deepEqual(c,{total:null,offset:0,returned:50,omitted:null,nextOffset:50,limit:50});
    const second=maestroSnapshot(ctx,{collect:()=>source,offsets:{sessions:c.nextOffset!}}).sections.sessions;
    assert.deepEqual(second.coverage,{total:null,offset:50,returned:25,omitted:null,nextOffset:null,limit:50});
    assert.deepEqual([...first.sections.sessions.items,...second.items].map(i=>i.id),items.map(i=>i.id));
    const empty=maestroSnapshot(ctx,{collect:()=>source,offsets:{sessions:75}}).sections.sessions;
    assert.equal(empty.coverage.returned,0);assert.equal(empty.coverage.nextOffset,null);
    for(const snapshot of [first,maestroSnapshot(ctx,{collect:()=>source,offsets:{sessions:75}})]) {
      snapshot.sections.sessions.coverage.nextOffset=snapshot.sections.sessions.coverage.offset;
      assert.throws(()=>validateMaestroSnapshot(snapshot),/coverage.invalid/);
    }
  }finally{p.limpar();}
});

test('relógio controlado vence no prazo total e limita releitura a duas tentativas',()=>{
  const p=projetoTemporario('maestro-time');let now=0,calls=0;
  try {
    const ctx=discoverMaestro({cwd:p.dir});
    const source=()=>{calls++;now+=5000;return {...collectMaestroSources(ctx),unchanged:()=>false};};
    const s=maestroSnapshot(ctx,{collect:source,clock:()=>now});
    assert.equal(calls,2);assert.equal(now,10000);assert.deepEqual(s.gaps,['maestro.snapshot.timeout']);
    assert.ok(Object.values(s.sections).every(v=>v.state==='unavailable'&&v.items.length===0));
  } finally {p.limpar();}
});

test('fonte remota recebe aborto no limite de 2 s, inclusive prazo não finito',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal!:AbortSignal,calls=0;
  const pending=observeWithDeadline(s=>{signal=s;calls++;return new Promise(()=>{});},Infinity);
  await Promise.resolve();t.mock.timers.tick(1999);assert.equal(signal.aborted,false);
  t.mock.timers.tick(1);assert.deepEqual(await pending,[]);assert.equal(calls,1);assert.equal(signal.aborted,true);
  t.mock.timers.reset();
});
