import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { BRAIN_HOST_SURFACES, instalarAdaptador } from '../src/hosts';
import { registerBrainTools } from '../src/company-brain-mcp';
import { validateRequest, BRAIN_API } from '../src/company-brain-client';
test('T18: ensaio SIMULADO dos quatro hosts preserva consulta e não inventa principal',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-hosts-')),root=path.resolve(__dirname,'../../..');
  const query={schema:BRAIN_API,operation:'get',payload:{tenant_id:'synthetic',id:'prod-synthetic'}};
  try{
    const executable=path.join(dir,'ork-simulated');
    fs.writeFileSync(executable,`#!/bin/sh\nprintf '%s\\n' "$@"\n`,{mode:0o755});
    const results=[];
    for(const [host,surface] of Object.entries(BRAIN_HOST_SURFACES)){
      if(surface==='cli'){
        const result=instalarAdaptador(host as 'hermes'|'openclaw',{projeto:dir,catalogo:root,orkBin:executable});assert.equal(result.ok,true);
        const launcher=path.join(result.destino,'bin/ork-brain.sh');
        const run=spawnSync('/bin/sh',[launcher,'get','prod-synthetic'],{encoding:'utf8',timeout:5000});
        assert.equal(run.status,0,run.stderr);assert.deepEqual(run.stdout.trim().split('\n'),['brain','get','prod-synthetic']);
      }else{
        const tools=new Map();registerBrainTools((name,config)=>{tools.set(name,config);},()=>{throw Error();},()=>{});
        tools.get('ork_brain_get').inputSchema.parse({threadId:'thread-one',id:'prod-synthetic'});
      }
      results.push({host,simulation:true,request:validateRequest(query)});
    }
    assert.equal(results.length,4);assert.equal(new Set(results.map(r=>JSON.stringify(r.request))).size,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('B4.1: context chega aos hosts de CLI pelo repasse do Hermes e pela tool do plugin OpenClaw',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-hosts-context-')),root=path.resolve(__dirname,'../../..');
  try{
    const executable=path.join(dir,'ork-simulated');
    fs.writeFileSync(executable,`#!/bin/sh\nprintf '%s\\n' "$@"\n`,{mode:0o755});
    const hermes=instalarAdaptador('hermes',{projeto:dir,catalogo:root,orkBin:executable});assert.equal(hermes.ok,true);
    const run=spawnSync('/bin/sh',[path.join(hermes.destino,'bin/ork-brain.sh'),'context','--thread','thread-one','--ids','init-alpha-one,prod-alpha'],{encoding:'utf8',timeout:5000});
    assert.equal(run.status,0,run.stderr);
    assert.deepEqual(run.stdout.trim().split('\n'),['brain','context','--thread','thread-one','--ids','init-alpha-one,prod-alpha']);
    const openclaw=instalarAdaptador('openclaw',{projeto:dir,catalogo:root,orkBin:executable});assert.equal(openclaw.ok,true);
    const plugin=path.join(dir,'.openclaw','extensions','orkastery');
    const manifesto=JSON.parse(fs.readFileSync(path.join(plugin,'openclaw.plugin.json'),'utf8'));
    assert.ok(manifesto.contracts.tools.includes('ork_brain_context'));
    const entry=fs.readFileSync(path.join(plugin,'dist','index.js'),'utf8');
    assert.match(entry,/name: 'ork_brain_context'[\s\S]*?\['brain', 'context', '--thread', texto\(p, 'thread'\), '--ids', texto\(p, 'ids'\)\]/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
