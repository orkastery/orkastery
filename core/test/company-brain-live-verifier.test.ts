import { test } from 'node:test';
import { strict as assert } from 'node:assert';
const {assess}=require('../../scripts/verify-company-brain-live.cjs');
test('T19: health, mocks e recibos autorais não encerram paridade ou garantia do agente Hermes',()=>{
  const result=assess({memory:{pedido:'orkmind',efetivo:'orkmind',tenant:'orkastery'},brain:{state:'ok'},portfolio:{historicalPreserved:true},
    hosts:{hermes:{official:true},openclaw:{official:true},codex:{official:true},'claude-code':{official:true}},events:['ship_done','master_done']},'post-master');
  assert.equal(result.ok,false);assert.equal(result.freshness.p95,null);
  assert.ok(result.blockers.includes('brain.live.native-transport-unavailable:hermes'));
  assert.ok(result.blockers.includes('brain.live.freshness-unconfirmed'));assert.equal(result.agenteHermes,'unconfirmed');
  const incomplete=assess({},'post-master');assert.ok(incomplete.blockers.includes('brain.live.master-unconfirmed'));
});
