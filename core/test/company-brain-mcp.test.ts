import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { registerBrainTools, BRAIN_READ_TOOLS } from '../src/company-brain-mcp';
import { projetoTemporario } from './apoio';
import { createProduct, createProject } from '../src/portfolio';
import { novaThread } from '../src/thread';
test('T16: ferramentas MCP compartilham contratos fechados e não importam identidade autoral',()=>{
  const definitions=new Map<string,any>();
  registerBrainTools((name,config)=>{definitions.set(name,config);},()=>{throw Error('not called');},()=>{});
  assert.deepEqual([...definitions.keys()].sort(),[...BRAIN_READ_TOOLS].sort());
  assert.throws(()=>definitions.get('ork_brain_get').inputSchema.parse({threadId:'thread-one',id:'prod-one',principal:'owner'}));
  assert.throws(()=>definitions.get('ork_brain_query').inputSchema.parse({threadId:'thread-one',root:'/tmp',ids:[]}));
});
test('B4.1: ork_brain_context é leitura sem concessão e repassa os ids ao pacote de contexto',async()=>{
  const p=projetoTemporario('brain-mcp-context');
  try{
    createProduct(p.dir,{id:'prod-alpha',title:'Alpha'});createProject(p.dir,{id:'proj-alpha-core',productId:'prod-alpha',title:'Núcleo'});
    const thread=novaThread(p.carregado,{nome:'Contexto MCP',modo:'auto'}).thread.id;
    const tools=new Map<string,{config:any;handler:any}>();
    registerBrainTools((name,config,handler)=>{tools.set(name,{config,handler});},()=>p.carregado,()=>{});
    const context=tools.get('ork_brain_context')!;
    assert.deepEqual(context.config.annotations,{readOnlyHint:true,destructiveHint:false});
    assert.throws(()=>context.config.inputSchema.parse({threadId:thread,ids:['proj-alpha-core'],principal:'owner'}));
    assert.throws(()=>context.config.inputSchema.parse({threadId:thread,ids:[]}));
    const result=await context.handler({threadId:thread,ids:['proj-alpha-core','prod-alpha']});
    const pacote=JSON.parse(result.content[0].text);
    assert.equal(pacote.schema,'ork.brain-context/v1');
    assert.deepEqual(pacote.pedido,['prod-alpha','proj-alpha-core']);
    // Sem Brain configurado no projeto de teste: o pacote diz indisponível e não inventa conteúdo.
    assert.equal(pacote.state,'unavailable');assert.equal(result.isError,true);assert.deepEqual(pacote.itens,[]);
  }finally{p.limpar();}
});
