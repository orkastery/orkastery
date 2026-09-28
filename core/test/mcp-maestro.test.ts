import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarServidorMcp } from '../src/mcp-server';
import { projetoTemporario } from './apoio';
import { novaThread,dirThread } from '../src/thread';

test('MCP tools/list e tools/call confinam panorama filho e recusam efeitos/raiz/identidade humana',async()=>{
  const p=projetoTemporario('maestro-mcp');
  const t=novaThread(p.carregado,{nome:'Própria',modo:'auto'}).thread,other=novaThread(p.carregado,{nome:'Alheia',modo:'auto'}).thread;
  const server=criarServidorMcp({projeto:p.dir,host:'codex',threadId:t.id}),client=new Client({name:'maestro-SIMULADO',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);await client.connect(ct);
    const definition=(await client.listTools()).tools.find(t=>t.name==='ork_maestro')!;
    assert.equal(definition.annotations?.readOnlyHint,true);assert.equal(definition.inputSchema.additionalProperties,false);
    const before=fs.readFileSync(dirThread(p.dir,t.id)+'/ledger.jsonl');
    const call=(args:Record<string,unknown>)=>client.callTool({name:'ork_maestro',arguments:args});
    for(const args of [{threadId:other.id},{shell:'true'},{root:p.dir},{resposta:'1'},{phase:'GO'},{offset:2}])assert.equal((await call(args)).isError,true);
    const result=await call({});assert.ok(!result.isError);
    const snapshot=JSON.parse((result.content as {text:string}[])[0].text);
    assert.deepEqual(snapshot.sections.threads.items.map((i:{id:string})=>i.id),[t.id]);
    assert.ok(snapshot.sections.nextActions.items.filter((i:{action:{operation:string}})=>i.action.operation==='phase').every((i:{action:{available:boolean}})=>!i.action.available));
    assert.deepEqual(fs.readFileSync(dirThread(p.dir,t.id)+'/ledger.jsonl'),before);
  } finally {await client.close();await server.close();p.limpar();}
});
