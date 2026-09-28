import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { discoverMaestro } from '../src/maestro-discovery';
import { maestroSnapshot } from '../src/maestro-snapshot';
import { collectMaestroSources,item } from '../src/maestro-sources';
import { performMaestroAction,proposeMaestroActions } from '../src/maestro-actions';

test('ação usa porta fixa uma vez e repetição consulta recibo e readback',()=>{
  const p=projetoTemporario('maestro-actions');
  try {
    const context=discoverMaestro({cwd:p.dir});
    const snapshot=maestroSnapshot(context,{collect:ctx=>{
      const src=collectMaestroSources(ctx);
      src.sections.nextActions=proposeMaestroActions([item('ork-fixture','Fixture','open')],{tools:['ork_thread_status'],child:true});return src;
    }});
    let calls=0,receipt:unknown|null=null,reads=0;
    const fingerprint=snapshot.fingerprint;
    const ports={snapshot:()=>snapshot,receipts:(_id:string,fp:string)=>fp===fingerprint?receipt:null,readback:()=>{reads++;return 'current';},operations:{'thread.status':(id:string)=>{calls++;assert.equal(id,'ork-fixture');return receipt={ok:true};}}};
    const input={id:'thread.status:ork-fixture',expectedFingerprint:snapshot.fingerprint};
    assert.equal(performMaestroAction(context,input,ports).repeated,false);
    snapshot.fingerprint='f'.repeat(64); // O efeito pode mudar o estado antes do replay.
    assert.equal(performMaestroAction(context,input,ports).repeated,true);
    assert.equal(calls,1);assert.equal(reads,2);
    for(const extra of [{shell:'true'},{root:'/other'},{human:'owner'}])assert.throws(()=>performMaestroAction(context,{...input,...extra},ports));
    assert.throws(()=>performMaestroAction(context,{...input,expectedFingerprint:'0'.repeat(64)},ports),/stale/);
    assert.throws(()=>performMaestroAction(context,{...input,id:'phase:ork-fixture'},ports),/conductor/);
    assert.equal(calls,1);
  } finally {p.limpar();}
});
