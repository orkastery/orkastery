import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { registerBrainTools, BRAIN_READ_TOOLS } from '../src/company-brain-mcp';
import { projetoTemporario } from './apoio';
import { createProduct, createProject } from '../src/portfolio';
import { novaThread } from '../src/thread';
import { registrarDecisao } from '../src/decisao-autonoma';
import { randomUUID } from 'node:crypto';
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
test('S11 ork_brain_dossie é leitura sem concessão, fecha o schema e repassa a decisão ao dossiê',async()=>{
  const p=projetoTemporario('brain-mcp-dossie');
  try{
    const thread=novaThread(p.carregado,{nome:'Dossiê MCP',modo:'auto'}).thread.id;
    const tools=new Map<string,{config:any;handler:any}>();
    registerBrainTools((name,config,handler)=>{tools.set(name,{config,handler});},()=>p.carregado,()=>{});
    const dossie=tools.get('ork_brain_dossie')!;
    assert.deepEqual(dossie.config.annotations,{readOnlyHint:true,destructiveHint:false});
    assert.throws(()=>dossie.config.inputSchema.parse({threadId:thread,principal:'owner'}));
    for(const decisao of ['../ledger','fact-123','prod-alpha'])assert.throws(()=>dossie.config.inputSchema.parse({threadId:thread,decisao}));
    dossie.config.inputSchema.parse({threadId:thread,decisao:'fact-'+'a'.repeat(64)});
    // Sem decisão e sem projeto, nada é pedido ao Brain: dossiê vazio com as lacunas do vínculo.
    const vazio=await dossie.handler({threadId:thread});
    const d=JSON.parse(vazio.content[0].text);
    assert.equal(d.schema,'ork.dossie-de-decisao/v1');assert.equal(d.state,'empty');assert.equal(vazio.isError,undefined);
    assert.deepEqual(d.lacunas.map((l:any)=>l.codigo),['objetivo.ausente','projeto.ausente']);
    const desconhecida=randomUUID();
    const filtrado=JSON.parse((await dossie.handler({threadId:thread,decisao:desconhecida})).content[0].text);
    assert.equal(filtrado.decisao,desconhecida);assert.ok(filtrado.lacunas.some((l:any)=>l.id===desconhecida&&l.codigo==='decisao.desconhecida'));
    // Com decisão e sem Brain configurado no projeto de teste: indisponível, sem conteúdo montado só da fonte.
    registrarDecisao(p.dir,thread,{decidido:'Decisão MCP',porque:'teste',comoMudar:'trocar',custoDeReverter:{agora:'nada',depois:'nada'},
      criterio:{tipo:'medicao',referencia:'node --version'},quemDecidiu:'sessão SIMULADA',evidencia:'fixture SIMULADA'});
    const fora=await dossie.handler({threadId:thread});
    const semBrain=JSON.parse(fora.content[0].text);
    assert.equal(semBrain.state,'unavailable');assert.equal(fora.isError,true);assert.deepEqual(semBrain.decisoes,[]);
  }finally{p.limpar();}
});
