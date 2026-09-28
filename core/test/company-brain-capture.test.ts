import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { capture } from '../src/company-brain-capture';
import { BRAIN_API, BrainTransport } from '../src/company-brain-client';
import { Portfolio } from '../src/portfolio';
const scope={tenant:'synthetic',instance:'factory',thread:'thread-example',aclRef:'grant-synthetic'};
const catalog:Portfolio={schema:'ork.portfolio/v1',updatedAt:'2026-09-13T20:00:00Z',products:[],projects:[],initiatives:[]};
const ledger=Buffer.from(JSON.stringify({thread:scope.thread,tipo:'phase_result',ts:catalog.updatedAt,fase:'GO'})+'\n');
test('T13: reinício em cada fronteira e três replays mantêm evento único e cursor confirmado',()=>{
  for(const boundary of ['outbox','attempt','remote-receipt','cursor']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-capture-'));const effects=new Map();
    const transport:BrainTransport=r=>{
      const event=r.payload as any;if(!effects.has(event.id))effects.set(event.id,event);
      const receipt=(stage:string)=>({schema:'orkmind.company-brain-receipt/v1',tenant_id:scope.tenant,id:'receipt-'+stage,event_id:event.id,
        stage,result:'ok',attempt:1,materialized_version:1,recorded_at:catalog.updatedAt,previous_receipt_id:null,error:null});
      return{schema:BRAIN_API,state:'ok',receipt:receipt('materialized'),indexed:receipt('retrievable')};
    };
    try{
      assert.throws(()=>capture(scope,dir,catalog,ledger,transport,s=>{if(s===boundary)throw Error('injected-crash');}),/injected-crash/);
      for(let i=0;i<3;i++)assert.equal(capture(scope,dir,catalog,ledger,transport).state,'ok');
      assert.equal(effects.size,1);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'cursor.json'),'utf8')).offset,ledger.length);
      assert.throws(()=>capture(scope,dir,catalog,Buffer.from('changed\n'),transport),/source-conflict/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('T13: resposta sem recibo durável não avança watermark; tentativas sobrevivem ao reinício',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-capture-'));let calls=0;
  try{
    const transport:BrainTransport=()=>{calls++;return{schema:BRAIN_API,state:'ok'};};
    assert.equal(capture(scope,dir,catalog,ledger,transport).state,'unavailable');
    assert.equal(capture(scope,dir,catalog,ledger,transport).offset,0);assert.equal(calls,3);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

function accepting(events:any[]):BrainTransport{return r=>{
  if(r.operation==='head')return{schema:BRAIN_API,state:'unknown'};
  const e=r.payload as any;events.push(e);
  const receipt=(stage:string)=>({schema:'orkmind.company-brain-receipt/v1',tenant_id:scope.tenant,id:'receipt-'+stage,event_id:e.id,
    stage,result:'ok',attempt:1,materialized_version:e.payload.version,recorded_at:catalog.updatedAt,previous_receipt_id:null,error:null});
  return{schema:BRAIN_API,state:'ok',receipt:receipt('materialized'),indexed:receipt('retrievable')};
};}
const product={id:'prod-example',kind:'product' as const,title:'Example',description:'',status:'idea' as const,ownerId:null,acceptanceCriteria:[],version:1};
test('GO-FIX R5: consume durable versions 1→2→3 and isolate a missing version',()=>{
  const {replaceWithJournal,readJournal}=require('../src/company-brain-journal');
  for(const history of [true,false]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-history-')),file=path.join(dir,'portfolio.json'),events:any[]=[];
    const first={...catalog,products:[product]};
    try{
      replaceWithJournal(file,first);
      capture(scope,dir,first,Buffer.alloc(0),accepting(events),undefined,readJournal(file+'.journal.jsonl'));
      replaceWithJournal(file,{...first,products:[{...product,version:2,title:'Second'}]});
      const last={...first,products:[{...product,version:3,title:'Third'},{...product,id:'prod-independent'}]};
      replaceWithJournal(file,last);
      const result=capture(scope,dir,last,ledger,accepting(events),undefined,history?readJournal(file+'.journal.jsonl'):[]);
      assert.equal(result.state,history?'ok':'unavailable');
      assert.deepEqual(events.filter(e=>e.aggregate_id===product.id).map(e=>e.payload.version),history?[1,2,3]:[1]);
      assert.ok(events.some(e=>e.aggregate_id==='prod-independent'));assert.equal(result.offset,ledger.length);
      const cursor=JSON.parse(fs.readFileSync(path.join(dir,'cursor.json'),'utf8'));assert.equal(cursor.versions[product.id].version,history?3:1);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('GO-FIX R5: out-of-order receipts never move the contiguous watermark across a failure',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-watermark-')),events:any[]=[];
  try{
    const two=Buffer.concat([ledger,ledger]);let denied:string|undefined;
    const transport:BrainTransport=r=>{const e=r.payload as any;denied??=e.id;return e.id===denied?{schema:BRAIN_API,state:'forbidden'}:accepting(events)(r);};
    assert.equal(capture(scope,dir,catalog,two,transport).offset,0);
    assert.equal(events.length,1);
    const cursor=JSON.parse(fs.readFileSync(path.join(dir,'cursor.json'),'utf8'));
    assert.equal(Object.keys(cursor.confirmed).length,1);assert.equal(Object.keys(cursor.pending).length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('GO-FIX R3: SIGKILL in capture preserves outbox and permits recovery',()=>{
  const {spawnSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-capture-kill-')),events:any[]=[];
  try{
    const module=path.resolve(__dirname,'../src/company-brain-capture');
    const script=`require(${JSON.stringify(module)}).capture(${JSON.stringify(scope)},${JSON.stringify(dir)},${JSON.stringify(catalog)},Buffer.from(${JSON.stringify(ledger.toString())}),()=>({state:'unavailable'}),s=>{if(s==='outbox')process.kill(process.pid,'SIGKILL')});`;
    const killed=spawnSync(process.execPath,['-e',script],{stdio:'ignore'});
    assert.equal(killed.error,undefined);assert.equal(killed.signal,'SIGKILL');
    assert.equal(capture(scope,dir,catalog,ledger,accepting(events)).state,'ok');assert.equal(events.length,1);
    assert.equal(capture(scope,dir,catalog,ledger,accepting(events)).received,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('GO-FIX CHECK: migration head bootstraps version and monotonic sequence before sync',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-migration-head-')),events:any[]=[];
  const migrated={...catalog,products:[product]};
  const {portfolioEntities}=require('../src/company-brain-source');
  const entity=portfolioEntities(migrated,scope)[0];
  try{
    const transport:BrainTransport=r=>{
      if(r.operation==='head')return{schema:BRAIN_API,state:'ok',active:true,sequence:1,
        source_version:entity.version,source_hash:entity.source.source_hash};
      return accepting(events)(r);
    };
    const result=capture(scope,dir,migrated,ledger,transport);
    assert.equal(result.state,'ok');
    assert.equal(events.filter(e=>e.aggregate_id===product.id).length,0);
    assert.equal(events.filter(e=>e.aggregate_id.startsWith('fact-')).length,1);
    const cursor=JSON.parse(fs.readFileSync(path.join(dir,'cursor.json'),'utf8'));
    assert.deepEqual(cursor.versions[product.id],{version:1,hash:entity.source.source_hash,sequence:1});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
