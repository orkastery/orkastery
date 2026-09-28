import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { projetoTemporario } from './apoio';
import { createProduct } from '../src/portfolio';
import { reconcileBrain, applyBrain, AdminTransport } from '../src/company-brain-migration';
test('T14: dry-run preserva identidade e concorrência invalida aplicação antes do transporte',()=>{
  const p=projetoTemporario('brain-migration');
  try{
    p.carregado.manifesto.memory.tenant='synthetic';createProduct(p.dir,{id:'prod-one',title:'One',ownerId:'Maestro'});
    let writes=0;
    const transport:AdminTransport=(op,args:any)=>{
      if(op!=='plan'){writes++;return{state:'ok'};}
      return{schema:'orkmind.company-brain-migration/v1',tenant_id:'synthetic',batch_id:args.batch_id,source_hash:args.source_hash,observed_at:args.observed_at,
        operations:args.entities.map((e:any)=>({id:e.id,operation:'insert',expected_version:null,before_hash:null,after:e,gaps:['owner-unresolved']}))};
    };
    const r=reconcileBrain(p.carregado,{tenant:'synthetic',instance:'factory',thread:'thread-example',aclRef:'grant'},'batch-one',transport);
    assert.equal(r.plan.operations[0].after.owner.principal,null);assert.equal(writes,0);
    createProduct(p.dir,{id:'prod-new',title:'Concurrent'});
    const replay=reconcileBrain(p.carregado,{tenant:'synthetic',instance:'factory',thread:'thread-example',aclRef:'grant'},'batch-two',transport);
    assert.deepEqual(replay.plan.operations.find((o:any)=>o.id==='prod-one').after,r.plan.operations[0].after);
    assert.throws(()=>applyBrain(p.carregado,r.plan,r.sha256,transport),/source-changed/);assert.equal(writes,0);
  }finally{p.limpar();}
});
