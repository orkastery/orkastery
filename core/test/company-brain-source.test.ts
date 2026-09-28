import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readCycle } from '../src/company-brain-source';
const scope = { tenant: 'synthetic', instance: 'factory', thread: 'thread-synthetic', aclRef: 'grant-synthetic' };
const corpus = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../core/test/fixtures/company-brain-cycle.json'),'utf8'));
test('T11: percurso do ciclo preserva fatos distintos e fonte sem copiar texto privado', () => {
  const rows = corpus.types.map((tipo: string) => ({ thread: scope.thread, tipo, ts: '2026-09-13T20:00:00Z', fase: 'GO',
    pergunta: 'SENTINEL-private', resposta: 'SENTINEL-private', raciocinio: 'SENTINEL-private' }));
  const bytes = Buffer.from(rows.map((r: unknown) => JSON.stringify(r)+'\n').join(''));
  const first = readCycle(bytes,scope), replay = readCycle(bytes,scope);
  assert.deepEqual(first,replay); assert.equal(first.records.length,corpus.types.length);
  assert.equal(new Set(first.records.map(r => r.event!.id)).size,corpus.types.length);
  assert.doesNotMatch(JSON.stringify(first),/SENTINEL/);
  assert.equal(first.records[0].event!.source.location,'line:1');
  assert.equal(readCycle(Buffer.concat([bytes,Buffer.from('{')]),scope).partial,true);
  assert.throws(() => readCycle(Buffer.concat([bytes,Buffer.from('{\n')]),scope),/corrupt/);
  assert.throws(() => readCycle(bytes,{...scope,thread:'other'}),/scope/);
});

test('GO-FIX CHECK: vínculo imutável projeta projeto e iniciativas em cada fato do ciclo',()=>{
  const bound={...scope,projectId:'proj-example',initiativeIds:['init-example']};
  const row={thread:scope.thread,tipo:'brain_scope_recorded',ts:'2026-09-13T20:00:00Z',fase:'GO'};
  const event=readCycle(Buffer.from(JSON.stringify(row)+'\n'),bound).records[0].event!;
  assert.equal(event.cycle!.project_id,'proj-example');
  assert.deepEqual(event.cycle!.initiative_ids,['init-example']);
});

test('GO-FIX R2: unrelated catalog updates cannot mutate an existing event',()=>{
  const {portfolioEntities,entityEvent,portfolioHistory}=require('../src/company-brain-source');
  const {bytesHash}=require('../src/company-brain-journal');
  const product={id:'prod-example',kind:'product',title:'Example',description:'',status:'idea',ownerId:null,acceptanceCriteria:[],version:1};
  const initial={schema:'ork.portfolio/v1',updatedAt:'2026-09-13T20:00:00Z',products:[product],projects:[],initiatives:[]};
  const later={...initial,updatedAt:'2026-09-13T20:01:00Z',products:[product,{...product,id:'prod-other'}]};
  const event=(c:any)=>entityEvent(portfolioEntities(c,scope)[0],1);
  assert.deepEqual(event(initial),event(later));assert.equal(event(initial).observed_at,null);
  const entries=[{type:'intent',id:'change',beforeValue:initial,value:later,observedAt:later.updatedAt,
    afterHash:bytesHash(JSON.stringify(later,null,2)+'\n')},{type:'confirmed',id:'change'}];
  const history=portfolioHistory(later,scope,entries);
  assert.equal(history.find((e:any)=>e.id==='prod-example').observed_at,null);
  assert.equal(history.find((e:any)=>e.id==='prod-other').observed_at,later.updatedAt);
});

test('GO-FIX P1: incremental prefix hashing consumes each ledger byte once',()=>{
  const crypto=require('node:crypto'),real=crypto.createHash;
  const line=JSON.stringify({thread:scope.thread,tipo:'unrelated',ts:'2026-09-13T20:00:00Z'})+'\n';
  for(const n of [100,200,400]){
    let bytes=0;
    crypto.createHash=(...args:any[])=>{const h=real(...args),update=h.update;
      h.update=function(data:any,...rest:any[]){bytes+=Buffer.byteLength(data);return update.call(this,data,...rest);};return h;};
    const input=Buffer.from(line.repeat(n));
    try{
      const result=readCycle(input,scope,input.length/2);
      assert.equal(bytes,input.length);assert.equal(result.records.length,n/2);
      assert.equal(result.records.at(-1)!.prefixHash,real('sha256').update(input).digest('hex'));
    }finally{crypto.createHash=real;}
  }
});
