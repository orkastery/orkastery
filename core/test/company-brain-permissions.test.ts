import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { registerBrainTools } from '../src/company-brain-mcp';
import { TOOLS_FILHO_CODEX } from '../src/mcp-install';
test('T16: grants anteriores não passam a autorizar mutações Brain',()=>{
  assert.equal(TOOLS_FILHO_CODEX.some(n=>n.startsWith('ork_brain_')),false);
  const names:string[]=[];registerBrainTools(name=>{names.push(name);},()=>{throw Error('not called');},()=>{},['ork_brain_sync']);
  assert.ok(names.includes('ork_brain_sync'));assert.ok(!names.includes('ork_brain_apply'));
  assert.throws(()=>registerBrainTools(()=>{},()=>{throw Error();},()=>{},['ork_ship']),/grant-invalid/);
});
