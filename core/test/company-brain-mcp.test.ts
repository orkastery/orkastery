import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { registerBrainTools, BRAIN_READ_TOOLS } from '../src/company-brain-mcp';
test('T16: ferramentas MCP compartilham contratos fechados e não importam identidade autoral',()=>{
  const definitions=new Map<string,any>();
  registerBrainTools((name,config)=>{definitions.set(name,config);},()=>{throw Error('not called');},()=>{});
  assert.deepEqual([...definitions.keys()].sort(),[...BRAIN_READ_TOOLS].sort());
  assert.throws(()=>definitions.get('ork_brain_get').inputSchema.parse({threadId:'thread-one',id:'prod-one',principal:'owner'}));
  assert.throws(()=>definitions.get('ork_brain_query').inputSchema.parse({threadId:'thread-one',root:'/tmp',ids:[]}));
});
