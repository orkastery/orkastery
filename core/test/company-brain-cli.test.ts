import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { projetoTemporario } from './apoio';
import { runBrain } from '../src/company-brain-cli';
import { createProduct } from '../src/portfolio';
import { BRAIN_API } from '../src/company-brain-client';
test('GO-FIX S1: inventory and query use the same authorization transport',()=>{
  const p=projetoTemporario('brain-cli');
  try{
    createProduct(p.dir,{id:'prod-test',title:'Synthetic'});
    let calls=0;
    const result=runBrain(p.carregado,'inventory',{},[],request=>{
      calls++;assert.equal(request.operation,'query');return {schema:BRAIN_API,state:'forbidden'};
    });
    assert.equal(calls,1);assert.deepEqual(result,{schema:BRAIN_API,state:'forbidden'});
    assert.throws(()=>runBrain(p.carregado,'query',{principal:'owner'}),/argument.invalid/);
    const response=runBrain(p.carregado,'get',{id:'prod-test'},[],()=>({schema:BRAIN_API,state:'forbidden'}));
    assert.equal(response.state,'forbidden');
    assert.throws(()=>runBrain(p.carregado,'sync',{}),/thread.required/);
  }finally{p.limpar();}
});
