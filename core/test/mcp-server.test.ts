import { test, mock } from 'node:test';
import * as util from '../src/util';
import { observarSessao } from '../src/session-watcher';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { criarServidorMcp } from '../src/mcp-server';
import { projetoTemporario, ProjetoDeTeste, ajustarManifesto, commitar, dirTemporario } from './apoio';
import { novaThread, dirThread, gravarThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { registrarPedidoHitl } from '../src/hitl-gates';
import { PedidoHitl } from '../src/hitl-contract';
import { adquirirRegiao, liberar } from '../src/leases';
import { MODOS_APOSENTADOS } from '../src/modos';

async function fixture(body:(p:ProjetoDeTeste,c:Client)=>Promise<void>,nomesProviderHerdados?:string[]) {
  const p=projetoTemporario('mcp-project');
  const server=criarServidorMcp({projeto:p.dir,host:'codex',nomesProviderHerdados});
  const client=new Client({name:'fixture-MCP-SIMULADA',version:'1'},{capabilities:{elicitation:{form:{}}}});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {await server.connect(st);await client.connect(ct);await body(p,client);}
  finally {await client.close();await server.close();p.limpar();}
}
async function comHomeGitIsolado<T>(body:()=>Promise<T>):Promise<T> {
  const home=dirTemporario('mcp-server-home'),anterior=process.env.HOME,xdg=process.env.XDG_CONFIG_HOME;
  process.env.HOME=home;process.env.XDG_CONFIG_HOME=path.join(home,'xdg');
  try{return await body();}
  finally {
    if(anterior===undefined)delete process.env.HOME;else process.env.HOME=anterior;
    if(xdg===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=xdg;
    fs.rmSync(home,{recursive:true,force:true});
  }
}
async function call(c:Client,name:string,args:Record<string,unknown>) {
  const r=await c.callTool({name,arguments:args});
  assert.ok(Array.isArray(r.content));
  const text=r.content.filter(x=>x.type==='text').map(x=>x.text).join('');
  return {error:r.isError===true,text,data:()=>JSON.parse(text)};
}
function pedido(p:ProjetoDeTeste) {
  const t=novaThread(p.carregado,{nome:'decisao',modo:'classic'}).thread;
  const q:PedidoHitl={contrato:'ork.hitl/v1',id:'q-mcp',thread:t.id,fase:t.faseAtual,modo:t.modo,
    alvo:{tipo:'gate',sobre:'premissas'},motivo:'human.pending',pergunta:'Aprovar esta fixture?',
    opcoes:[{numero:1,texto:'Aprovar',acao:'aprovar'},{numero:2,texto:'Esperar',acao:'esperar'}],
    recomendacao:'Somente fixture sintetica',criadoEm:new Date().toISOString(),
    prazo:new Date(Date.now()+60000).toISOString(),acaoPadraoAoExpirar:'esperar',
    respostaAceita:{tipo:'opcao',maxCaracteres:100},profundidade:'detalhada'};
  registrarPedidoHitl(p.dir,q);return {t,q};
}

test('MCP filho fixa thread e omite criacao, redespacho e decisao do dono',async()=>{
  const p=projetoTemporario('mcp-worker-scope');
  const propria=novaThread(p.carregado,{nome:'propria',modo:'auto'}).thread;
  const outra=novaThread(p.carregado,{nome:'outra',modo:'auto'}).thread;
  const server=criarServidorMcp({projeto:p.dir,host:'codex',threadId:propria.id});
  const client=new Client({name:'worker-fixture',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);await client.connect(ct);
    const names=(await client.listTools()).tools.map(t=>t.name);
    for(const name of ['ork_thread_new','ork_phase_run','ork_request_decision','ork_preflight']) {
      assert.ok(!names.includes(name));assert.equal((await call(client,name,{})).error,true);
    }
    assert.equal((await call(client,'ork_thread_status',{threadId:propria.id})).error,false);
    for(const name of ['ork_thread_status','ork_claims_list','ork_artifact_read','ork_git_status']) {
      const r=await call(client,name,{threadId:outra.id,...(name==='ork_artifact_read'?{tipo:'goal'}:{})});
      assert.equal(r.error,true);assert.match(r.text,/mcp.thread.scope/);
    }
    const beforeOther=fs.readFileSync(path.join(dirThread(p.dir,outra.id),'ledger.jsonl'));
    for(const [name,args] of [
      ['ork_claim_add',{arquivo:'sum.cjs',alegacao:'x',verificar:['true']}],
      ['ork_artifact_write',{tipo:'goal',conteudo:'fora',expectedSha256:null}],
      ['ork_ship',{expectedSource:'0'.repeat(40),expectedDestination:'0'.repeat(40)}],
    ] as const) {
      const r=await call(client,name,{threadId:outra.id,...args});assert.equal(r.error,true);assert.match(r.text,/mcp.thread.scope/);
    }
    assert.deepEqual(fs.readFileSync(path.join(dirThread(p.dir,outra.id),'ledger.jsonl')),beforeOther);
    const read=await call(client,'ork_artifact_read',{threadId:propria.id,tipo:'goal'});
    assert.equal(read.error,false);assert.equal(read.data().sha256,null);
    const write=await call(client,'ork_artifact_write',{threadId:propria.id,tipo:'goal',conteudo:'# Fixture',expectedSha256:null});
    assert.equal(write.error,false);assert.equal(write.data().reciboOficial,false);
    assert.equal((await call(client,'ork_artifact_write',{threadId:propria.id,tipo:'goal',conteudo:'obsoleto',expectedSha256:null})).error,true);
  } finally {await client.close();await server.close();p.limpar();}
});

test('MCP schemas fechados recusam shell, raiz, traversal e resposta gerada pelo modelo sem efeito',()=>fixture(async(p,c)=>{
  const {t,q}=pedido(p),before=fs.readFileSync(path.join(dirThread(p.dir,t.id),'ledger.jsonl'));
  const tools=(await c.listTools()).tools;
  assert.equal(tools.length,27);assert.ok(!tools.some(t=>/shell|answer/.test(t.name)));
  assert.equal(tools.find(t=>t.name==='ork_brain_context')?.annotations?.readOnlyHint,true);
  for(const tool of tools) assert.equal(tool.inputSchema.additionalProperties,false);
  for(const [name,args] of [
    ['ork_thread_status',{threadId:'../../other'}],
    ['ork_thread_status',{threadId:t.id,project:'/tmp/other'}],
    ['ork_request_decision',{threadId:t.id,pedidoId:q.id,resposta:'1'}],
    ['ork_request_decision',{threadId:t.id,pedidoId:q.id,aprovado:true}],
    ['ork_phase_run',{threadId:t.id,fase:'GOAL',prompt:'x',cwd:'/tmp'}],
    ['ork_thread_new',{nome:'unsafe',modo:'auto',command:'touch outside'}],
  ] as [string,Record<string,unknown>][]) assert.equal((await call(c,name,args)).error,true,name);
  assert.deepEqual(fs.readFileSync(path.join(dirThread(p.dir,t.id),'ledger.jsonl')),before);
}));
test('MCP cria worktree real no projeto e status/observe nao inventam sessao ou gate',()=>fixture(async(p,c)=>{
  const created=await call(c,'ork_thread_new',{nome:'trabalho MCP',modo:'auto'});assert.equal(created.error,false,created.text);
  const t=created.data().thread;assert.ok(t.worktree.startsWith(p.dir+path.sep));assert.ok(fs.existsSync(path.join(t.worktree,'.git')));
  const before=fs.readFileSync(path.join(dirThread(p.dir,t.id),'ledger.jsonl'));
  const status=await call(c,'ork_thread_status',{threadId:t.id});assert.equal(status.data().thread.id,t.id);
  const observed=await call(c,'ork_observe',{threadId:t.id});assert.deepEqual(observed.data().nativas,[]);
  assert.deepEqual(observed.data().pendencias,[]);
  assert.deepEqual(fs.readFileSync(path.join(dirThread(p.dir,t.id),'ledger.jsonl')),before);
}));
test('MCP preserva bloqueio de lease e allowed_modes antes de criar thread',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'dono lease',modo:'auto'}).thread;
  const lease=adquirirRegiao(p.dir,'main-tree',{thread:t.id,motivo:'fixture',ttlMs:60000});assert.equal(lease.ok,true);
  try {const blocked=await call(c,'ork_thread_new',{nome:'bloqueada',modo:'auto'});assert.equal(blocked.error,true);assert.match(blocked.text,/lease.busy/);}
  finally {liberar(p.dir,'main-tree',t.id,false);}
  ajustarManifesto(p,/allowed_modes:.*$/m,'allowed_modes: [look, classic]');
  const denied=await call(c,'ork_thread_new',{nome:'fora modo',modo:'auto'});assert.equal(denied.error,true);assert.match(denied.text,/allowed_modes/);
}));
test('MCP recusa estado de thread ligado a outro projeto e worktree externa',()=>fixture(async(p,c)=>{
  const other=projetoTemporario('mcp-outside');
  try {
    const t=novaThread(other.carregado,{nome:'externa',modo:'auto'}).thread;
    fs.mkdirSync(path.join(p.dir,'.orkastery','threads'),{recursive:true});
    fs.symlinkSync(dirThread(other.dir,t.id),dirThread(p.dir,t.id));
    assert.equal((await call(c,'ork_thread_status',{threadId:t.id})).error,true);
    const local=novaThread(p.carregado,{nome:'local',modo:'auto'}).thread;
    local.worktree=other.dir;gravarThread(p.dir,local);
    assert.equal((await call(c,'ork_phase_run',{threadId:local.id,fase:'GOAL',prompt:'x',dryRun:true})).error,true);
  } finally {other.limpar();}
}));
test('MCP phase usa guard runtime/modelo do nucleo e dry-run nao cria sessao',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'fase',modo:'auto'}).thread;
  const missing=await call(c,'ork_phase_run',{threadId:t.id,fase:'GOAL',prompt:'fixture',runtime:'codex',dryRun:true});
  assert.equal(missing.error,true);assert.match(missing.text,/setup.model.required/);
  const r=await call(c,'ork_phase_run',{threadId:t.id,fase:'GOAL',prompt:'fixture',runtime:'codex',model:'modelo-SIMULADO',dryRun:true});
  assert.equal(r.error,false,r.text);assert.equal(r.data().runtime,'codex');assert.equal(r.data().model,'modelo-SIMULADO');
  assert.equal(r.data().sessionId,null);
}));
test('MCP elicitation sintetica separa tool args da resposta protocolar e cancel preserva gate',()=>fixture(async(p,c)=>{
  const {t,q}=pedido(p);let forms=0;
  c.setRequestHandler(ElicitRequestSchema,async(req)=>{forms++;assert.equal(req.params.mode,'form');return {action:'cancel' as const};});
  const pending=await call(c,'ork_hitl_pending',{threadId:t.id});
  const pendencia=pending.data().pendencias[0];
  assert.equal(pendencia.pedido.id,q.id);
  // FX6: a oferta de canais acompanha o pedido REAL, com pre-condicoes lidas do ambiente.
  // A conexao viva e ESTA sessao MCP: `codex` pode sair disponivel, `claude-code` nao.
  assert.deepEqual(pendencia.canais.map((o:{canal:string})=>o.canal),['claude-code','codex','hermes','openclaw']);
  assert.equal(pendencia.canais.find((o:{canal:string})=>o.canal==='claude-code').estado,'indisponivel');
  assert.match(pendencia.canais.find((o:{canal:string})=>o.canal==='claude-code').motivo,/sem-conexao/);
  for(const o of pendencia.canais) assert.ok(o.estado==='disponivel'||o.motivo.length>0,'motivo tipado obrigatorio');
  const result=await call(c,'ork_request_decision',{threadId:t.id,pedidoId:q.id});
  assert.equal(result.error,false,result.text);assert.equal(forms,1);assert.equal(result.data().estado,'pendente');
  assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='human_gate'),false);
}));

test('MCP observe Claude usa filtro nativo da raiz e retorna apenas UUID/cwd da fase',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'observada',modo:'auto'}).thread;
  const sid='11111111-2222-4333-8444-555555555555';
  t.sessoes.push({sessionId:sid,slug:t.slug,fase:'GOAL',bloco:'GOAL',runtime:'claude-bg',
    despachadaEm:new Date().toISOString(),promptPath:'',promptSha256:'',verificada:true});gravarThread(p.dir,t);
  const original=util.exec;let consultas=0;
  const stub=mock.method(util,'exec',(cmd:string,args:string[],cwd?:string,timeout?:number,env?:NodeJS.ProcessEnv)=>{
    if(cmd!=='claude') return original(cmd,args,cwd,timeout,env);
    consultas++;assert.deepEqual(args,['agents','--json','--all','--cwd',p.dir]);assert.equal(cwd,p.dir);
    return {ok:true,code:0,stderr:'',stdout:JSON.stringify([{sessionId:sid,cwd:p.dir,state:'working',waitingFor:'permission prompt'},
      {sessionId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',cwd:p.dir,state:'done'}])};
  });
  try {
    const r=await call(c,'ork_observe',{threadId:t.id});assert.equal(r.error,false,r.text);
    assert.equal(consultas,1);assert.equal(r.data().nativas.length,1);
    assert.equal(r.data().nativas[0].sessao.sessionId,sid);assert.equal(r.data().nativas[0].sessao.estado,'working');
    assert.equal(r.data().nativas[0].sessao.waitingFor,'permission prompt');
  } finally {stub.mock.restore();}
}));

test('MCP gate_request usa pausa real do nucleo e Auto sem gate continua sem pedido',()=>fixture(async(p,c)=>{
  const auto=novaThread(p.carregado,{nome:'sem pausa',modo:'auto'}).thread;
  const before=lerLedger(dirThread(p.dir,auto.id)).length;
  const denied=await call(c,'ork_gate_request',{threadId:auto.id});assert.equal(denied.error,true);
  assert.equal(lerLedger(dirThread(p.dir,auto.id)).length,before);
  const t=novaThread(p.carregado,{nome:'pausa real',modo:'classic'}).thread;
  t.faseAtual='PLAN';gravarThread(p.dir,t);
  registrar(dirThread(p.dir,t.id),t.id,'phase_result',{fase:'PLAN',classificacao:'concluida',fonte:'fixture sintetica'});
  const request=await call(c,'ork_gate_request',{threadId:t.id});assert.equal(request.error,false,request.text);
  assert.equal(request.data().thread,t.id);assert.equal(request.data().alvo.tipo,'gate');
  assert.equal(lerLedger(dirThread(p.dir,t.id)).filter(e=>e.tipo==='hitl_requested').length,1);
  assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='human_gate'),false);
  const repeat=await call(c,'ork_gate_request',{threadId:t.id});assert.equal(repeat.data().id,request.data().id);
}));

test('CLI mcp serve negocia stdio real sem banner e sem configuracao global',async()=>{
  const p=projetoTemporario('mcp-stdio');
  const c=new Client({name:'fixture-stdio-SIMULADA',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,
    args:[path.resolve(__dirname,'../src/index.js'),'mcp','serve','--project',p.dir,'--host','codex'],
    cwd:p.dir,env:{PATH:process.env.PATH??'',HOME:p.dir},stderr:'pipe'});
  try {await c.connect(transport);assert.equal((await c.listTools()).tools.length,27);}
  finally {await c.close();await transport.close();p.limpar();}
});

test('MCP commit integra claim e HEAD real sem registrar entrega SHIP',()=>comHomeGitIsolado(()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'commit via MCP',modo:'auto',criarWorktree:true}).thread;
  fs.writeFileSync(path.join(t.worktree!,'produto.txt'),'fixture');
  const claim=await call(c,'ork_claim_add',{threadId:t.id,arquivo:'produto.txt',alegacao:'arquivo da fixture',verificar:['test -f produto.txt']});
  assert.equal(claim.error,false,claim.text);assert.equal(claim.data().estado,'pendente');
  const observed=await call(c,'ork_git_status',{threadId:t.id});assert.equal(observed.error,false,observed.text);
  const head=util.exec('git',['rev-parse','HEAD'],t.worktree!).stdout.trim();assert.equal(observed.data().source.head,head);
  assert.equal((await call(c,'ork_git_status',{threadId:t.id,cwd:p.dir})).error,true);
  const args={threadId:t.id,expectedHead:head,paths:['produto.txt'],mensagem:'fixture MCP'};
  const r=await call(c,'ork_git_commit',args);assert.equal(r.error,false,r.text);
  assert.equal(r.data().estadoAuditado,true);assert.notEqual(r.data().commit,head);
  const verified=await call(c,'ork_verify',{threadId:t.id});assert.equal(verified.error,false,verified.text);
  assert.equal(verified.data().claims.verificadas,1);assert.equal(verified.data().commit,r.data().commit);
  await call(c,'ork_claim_add',{threadId:t.id,arquivo:'produto.txt',alegacao:'contraprova sandbox',verificar:['touch ../outside-not-allowed']});
  const denied=await call(c,'ork_verify',{threadId:t.id});assert.equal(denied.error,true,denied.text);
  assert.equal(denied.data().executor,'codex-sandbox');
  assert.equal(fs.existsSync(path.resolve(t.worktree!,'..','outside-not-allowed')),false);
  assert.equal((await call(c,'ork_git_commit',args)).error,true);
  assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>['artifact_delivered','ship_done'].includes(e.tipo)),false);
})));


test('MCP SHIP entrega por SDK com perfil bare instalado e recusa opções livres',()=>comHomeGitIsolado(async()=>{
  const p=projetoTemporario('mcp-sdk-ship',true);
  const t=novaThread(p.carregado,{nome:'SHIP SDK',modo:'auto',criarWorktree:true}).thread;
  const source=commitar(t.worktree!,'entrega.txt','fixture SDK','entrega SDK');
  const destination=util.exec('git',['rev-parse','main'],p.dir).stdout.trim();
  const server=criarServidorMcp({projeto:p.dir,host:'codex',threadId:t.id,transporteShip:'bare-local'});
  const c=new Client({name:'fixture-SHIP-SIMULADA',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);await c.connect(ct);
    const claim=await call(c,'ork_claim_add',{threadId:t.id,arquivo:'entrega.txt',alegacao:'fixture SDK',verificar:['test -f entrega.txt']});
    assert.equal(claim.error,false,claim.text);
    const args={threadId:t.id,expectedSource:source,expectedDestination:destination};
    for(const extra of [{remoto:'outro'},{semPush:true},{por:'dono'},{executor:'shell'}])assert.equal((await call(c,'ork_ship',{...args,...extra})).error,true);
    assert.equal(util.exec('git',['rev-parse','main'],p.dir).stdout.trim(),destination);
    const r=await call(c,'ork_ship',args);assert.equal(r.error,false,r.text);
    assert.equal(r.data().resultado.pushVerificado,true);
    assert.equal(util.exec('git',['ls-remote','origin','refs/heads/main'],p.dir).stdout.trim().split(/\s/)[0],r.data().resultado.mergeSha);
    assert.equal(lerLedger(dirThread(p.dir,t.id)).filter(e=>e.tipo==='ship_done').length,1);
  } finally {await c.close();await server.close();p.limpar();}
}));

test('MCP SHIP indisponível preserva consultas e não inventa entrega',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'sem transporte',modo:'auto',criarWorktree:true}).thread;
  const head=util.exec('git',['rev-parse','HEAD'],t.worktree!).stdout.trim();
  const r=await call(c,'ork_ship',{threadId:t.id,expectedSource:head,expectedDestination:head});
  assert.equal(r.error,true);assert.match(r.text,/mcp\.ship|mcp\.git/);
  assert.equal((await call(c,'ork_thread_status',{threadId:t.id})).error,false);
  assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='ship_done'),false);
}));


test('MCP preflight tem modo fechado e não aceita root, thread ou overrides',()=>fixture(async(p,c)=>{
  const tool=(await c.listTools()).tools.find(t=>t.name==='ork_preflight')!;
  assert.equal(tool.annotations?.readOnlyHint,true);
  for(const args of [{modo:'auto',cwd:p.dir},{modo:'auto',threadId:'x'},{modo:'auto',runtime:'codex'},{modo:'outro'},{}]) {
    const r=await call(c,'ork_preflight',args);assert.equal(r.error,true);
  }
}));

test('MCP preflight preserva nomes de provider capturados antes da limpeza CLI sem expor valores',()=>fixture(async(_p,c)=>{
  const r=await call(c,'ork_preflight',{modo:'auto'});assert.equal(r.error,false,r.text);
  const provider=r.data().blocos[0].checks.find((x:{nome:string})=>x.nome==='provider');
  assert.equal(provider.nivel,'fail');assert.match(provider.detalhe,/ANTHROPIC_API_KEY/);
  assert.equal(r.text.includes('NOT_A_PROVIDER_SECRET'),false);
},['ANTHROPIC_API_KEY','NOT_A_PROVIDER_SECRET']));


test('MCP elicitation usa timeout cinco minutos e signal do ingresso, sem aceitar resposta do modelo',()=>fixture(async(p,c)=>{
  const {t,q}=pedido(p);let visto=false;
  const stub=mock.method(Server.prototype,'elicitInput',async(_params:unknown,options?:{signal?:AbortSignal;timeout?:number})=>{
    visto=true;assert.equal(options?.timeout,300000);assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(options?.signal?.aborted,false);return {action:'cancel' as const};
  });
  try {
    const r=await call(c,'ork_request_decision',{threadId:t.id,pedidoId:q.id});
    assert.equal(r.error,false,r.text);assert.equal(visto,true);assert.equal(r.data().estado,'pendente');
    assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='human_gate'),false);
  } finally {stub.mock.restore();}
}));

test('D12: elicitation de pergunta aberta nao vira menu, e gate oferece opções com rótulos',()=>fixture(async(p,c)=>{
  const {t,q}=pedido(p);
  const sessao:PedidoHitl={...q,id:'q-mcp-sessao',
    alvo:{tipo:'session',sessionId:'00000000-0000-0000-0000-000000000042',runtime:'claude-bg'},
    motivo:'hitl.pergunta',pergunta:'Qual e o diretorio correto?',
    opcoes:[],recomendacao:'Esta pergunta aceita texto livre.',
    criadoEm:new Date().toISOString(),prazo:new Date(Date.now()+60000).toISOString(),
    respostaAceita:{tipo:'texto',maxCaracteres:4096}};
  registrarPedidoHitl(p.dir,sessao);
  type Campo = {type?:string;enum?:string[];oneOf?:{const:string;title:string}[];maxLength?:number};
  const vistos:Record<string,Campo>={};
  const stub=mock.method(Server.prototype,'elicitInput',async(params:{requestedSchema:{properties:{opcao:Campo}}})=>{
    vistos[Object.keys(vistos).length===0?'gate':'sessao']=params.requestedSchema.properties.opcao;
    return {action:'cancel' as const};
  });
  try {
    await call(c,'ork_request_decision',{threadId:t.id,pedidoId:q.id});
    await call(c,'ork_request_decision',{threadId:t.id,pedidoId:sessao.id});
  } finally {stub.mock.restore();}
  // Gate: seletor fechado, com correlação numérica e rótulos legíveis.
  assert.deepEqual(vistos.gate.oneOf,[{const:'1',title:'Aprovar'},{const:'2',title:'Esperar'}]);
  assert.equal(vistos.gate.maxLength,undefined);
  // Sessao com pergunta aberta: SEM enum. Um menu sobre pergunta aberta muda a pergunta.
  assert.equal(vistos.sessao.enum,undefined);
  assert.equal(vistos.sessao.oneOf,undefined);
  assert.equal(vistos.sessao.type,'string');
  assert.equal(vistos.sessao.maxLength,4096);
  assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='human_gate'),false);
  assert.equal(lerLedger(dirThread(p.dir,t.id)).some(e=>e.tipo==='session_answered'),false);
}));

test('MCP observe preserva idle/working e correlaciona fim de turno sem concluir fase',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'turno-correlacionado',modo:'auto'}).thread;
  const sid='11111111-2222-4333-8444-555555555555',despacho='2026-09-09T10:00:00.000Z';
  t.sessoes.push({sessionId:sid,slug:t.slug,fase:'GOAL',bloco:'GOAL-PLAN-GO-CHECK-SHIP-MASTER',runtime:'claude-bg',
    despachadaEm:despacho,promptPath:'',promptSha256:'',verificada:true});gravarThread(p.dir,t);
  const dir=dirThread(p.dir,t.id),original=util.exec;
  let nativeState='working',nativeStatus='idle';
  const stub=mock.method(util,'exec',(cmd:string,args:string[],cwd?:string,timeout?:number,env?:NodeJS.ProcessEnv)=>{
    if(cmd!=='claude')return original(cmd,args,cwd,timeout,env);
    return {ok:true,code:0,stderr:'',stdout:JSON.stringify([{sessionId:sid,cwd:p.dir,state:nativeState,status:nativeStatus}])};
  });
  const stop={fase:'GOAL',sessionId:sid,runtime:'claude-bg',despachoEm:despacho,
    fonte:'ork sessions event',sensor:'stop',sensorEventId:'a'.repeat(64)};
  const observe=async()=>{const r=await call(c,'ork_observe',{threadId:t.id});assert.equal(r.error,false,r.text);return r.data();};
  try {
    let d=await observe();assert.equal(d.nativas[0].turno.estado,'nao-confirmado');
    assert.equal(d.nativas[0].sessao.state,'working');assert.equal(d.nativas[0].sessao.status,'idle');
    assert.equal(d.nativas[0].sessao.divergenciaEstado,true);
    for(const status of ['busy','running','working']){
      nativeStatus=status;d=await observe();assert.equal(d.nativas[0].sessao.divergenciaEstado,false);
      assert.equal(d.nativas[0].sessao.status,status);assert.equal(d.nativas[0].sessao.state,'working');
    }
    nativeState='completed';nativeStatus='stopped';
    assert.equal((await observe()).nativas[0].sessao.divergenciaEstado,true);
    nativeState='working';nativeStatus='idle';
    for(const extra of [{sessionId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},{fase:'PLAN'},{runtime:'codex'},
      {despachoEm:'2026-09-09T09:00:00.000Z'},{fonte:'relato-modelo'},{sensorEventId:'invalido'}]){
      registrar(dir,t.id,'runtime_stop',{...stop,...extra});
      assert.equal((await observe()).nativas[0].turno.estado,'nao-confirmado');
    }
    registrar(dir,t.id,'runtime_stop',stop);
    d=await observe();assert.equal(d.nativas[0].turno.estado,'encerrado');
    assert.equal(d.nativas[0].turno.conclusaoDeFase,'nao-inferida');
    assert.equal(d.nativas[0].turno.evidencia.despachoEm,despacho);
    assert.equal(d.phases.eventos.some((e:{tipo:string})=>e.tipo==='phase_result'),false);
    assert.equal(d.thread.faseAtual,'GOAL');assert.equal(d.thread.status,'aberta');
    registrar(dir,t.id,'runtime_event',{...stop,sensor:'heartbeat',sensorEventId:'b'.repeat(64)});
    assert.equal((await observe()).nativas[0].turno.estado,'nao-confirmado');
    registrar(dir,t.id,'runtime_stop',{...stop,sensorEventId:'c'.repeat(64)});
    registrar(dir,t.id,'runtime_event',{...stop,despachoEm:'2026-09-09T09:00:00.000Z',sensor:'heartbeat'});
    assert.equal((await observe()).nativas[0].turno.estado,'encerrado');
    for(const semData of [undefined,'data-invalida']) {
      t.sessoes[0].despachadaEm=semData;gravarThread(p.dir,t);
      assert.equal((await observe()).nativas[0].turno.estado,'nao-confirmado');
    }
    assert.equal(lerLedger(dir).some(e=>e.tipo==='phase_result'),false);
  } finally {stub.mock.restore();}
}));

test('I-34: MCP observe deixa de devolver nao-inferida quando há evidência nativa, sem gravar nada',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'turno-i34',modo:'auto'}).thread;
  const sid='11111111-2222-4333-8444-555555555555',despacho='2026-09-09T10:00:00.000Z';
  t.sessoes.push({sessionId:sid,slug:t.slug,fase:'GOAL',bloco:'GOAL-PLAN-GO-CHECK-SHIP-MASTER',runtime:'claude-bg',
    despachadaEm:despacho,promptPath:'',promptSha256:'',verificada:true});gravarThread(p.dir,t);
  const dir=dirThread(p.dir,t.id),original=util.exec;
  let nativo:Record<string,unknown>={state:'working',status:'busy',pid:process.pid};
  const stub=mock.method(util,'exec',(cmd:string,args:string[],cwd?:string,timeout?:number,env?:NodeJS.ProcessEnv)=>{
    if(cmd!=='claude')return original(cmd,args,cwd,timeout,env);
    return {ok:true,code:0,stderr:'',stdout:JSON.stringify([{sessionId:sid,cwd:p.dir,...nativo}])};
  });
  const stop={fase:'GOAL',sessionId:sid,runtime:'claude-bg',despachoEm:despacho,
    fonte:'ork sessions event',sensor:'stop',sensorEventId:'a'.repeat(64)};
  const turno=async()=>{const r=await call(c,'ork_observe',{threadId:t.id});assert.equal(r.error,false,r.text);return r.data().nativas[0].turno;};
  try {
    registrar(dir,t.id,'runtime_stop',stop);
    assert.equal((await turno()).conclusaoDeFase,'nao-inferida');
    // Ociosidade depois do Stop não é atividade.
    registrar(dir,t.id,'runtime_event',{...stop,sensor:'notification',notificationType:'idle_prompt',sensorEventId:'b'.repeat(64)});
    nativo={state:'done',status:'idle',pid:process.pid};
    // GO-FIX 2 (D12): done com Stop sem o artefato do GOAL não conclui; escala ao humano.
    let d=await turno();
    assert.equal(d.estado,'encerrado');assert.equal(d.conclusaoDeFase,'gate_blocked:human.pending');assert.equal(d.registrada,false);
    assert.match(d.conclusao.fonte,/sem prova do ork: docs\/goal\.md/);
    fs.mkdirSync(path.join(dir,'docs'),{recursive:true});fs.writeFileSync(path.join(dir,'docs','goal.md'),'# objetivo\n');
    d=await turno();
    assert.equal(d.estado,'encerrado');assert.equal(d.conclusaoDeFase,'fase_concluida');assert.equal(d.registrada,false);
    assert.equal(d.conclusao.estadoNativo,'done');
    // GO-FIX 3 (D17): failed depois do Stop correlacionado escala ao humano, como no watcher.
    nativo={state:'failed'};
    d=await turno();assert.equal(d.conclusaoDeFase,'gate_blocked:human.pending');assert.equal(d.registrada,false);
    assert.equal(lerLedger(dir).some(e=>e.tipo==='phase_result'),false,'observe nao grava resultado');
    registrar(dir,t.id,'phase_result',{fase:'GOAL',sessionId:sid,despachoEm:despacho,runtime:'claude-bg',origem:'sessions.watch',
      classificacao:'gate_blocked',motivo:'human.pending',sensorResultId:'claude-bg:'+'c'.repeat(64),estadoNativo:'done',fonte:'fixture SIMULADA'});
    d=await turno();
    assert.equal(d.conclusaoDeFase,'gate_blocked:human.pending');assert.equal(d.registrada,true);
    assert.equal(d.conclusao.sensorResultId,'claude-bg:'+'c'.repeat(64));
    nativo={state:'working',status:'busy',pid:process.pid};
    assert.equal((await turno()).conclusaoDeFase,'gate_blocked:human.pending','registro do watcher prevalece sobre a leitura atual');
  } finally {stub.mock.restore();}
}));

test('GO-FIX 2 (D15, achado 6): MCP observe mostra sessão stopped sem resultado como encerrada pelo condutor, sem gate inventado',()=>fixture(async(p,c)=>{
  const t=novaThread(p.carregado,{nome:'turno-stopped',modo:'auto'}).thread;
  const sid='11111111-2222-4333-8444-666666666666',despacho='2026-09-09T10:00:00.000Z';
  t.sessoes.push({sessionId:sid,slug:t.slug,fase:'GOAL',bloco:'GOAL-PLAN-GO-CHECK-SHIP-MASTER',runtime:'claude-bg',
    despachadaEm:despacho,promptPath:'',promptSha256:'',verificada:true});gravarThread(p.dir,t);
  const dir=dirThread(p.dir,t.id),original=util.exec;
  let nativo:Record<string,unknown>={state:'stopped'};
  const stub=mock.method(util,'exec',(cmd:string,args:string[],cwd?:string,timeout?:number,env?:NodeJS.ProcessEnv)=>{
    if(cmd!=='claude')return original(cmd,args,cwd,timeout,env);
    return {ok:true,code:0,stderr:'',stdout:JSON.stringify([{sessionId:sid,cwd:p.dir,...nativo}])};
  });
  const turno=async()=>{const r=await call(c,'ork_observe',{threadId:t.id});assert.equal(r.error,false,r.text);return r.data().nativas[0].turno;};
  try {
    let d=await turno();
    assert.equal(d.conclusaoDeFase,'encerrada-pelo-condutor');assert.equal(d.registrada,false);
    assert.notEqual(d.conclusaoDeFase,'gate_blocked:runtime.unavailable');
    // GO-FIX 3 (D17): a leitura declara o que o watcher grava para o mesmo estado.
    assert.equal(d.classificacaoDoWatcher,'gate_blocked:runtime.unavailable');
    assert.equal(lerLedger(dir).some(e=>e.tipo==='gate_blocked'||e.tipo==='phase_result'),false,'observe nao grava');
    // Negativo: failed continua sendo a classificação imediata de falha nativa.
    nativo={state:'failed'};
    assert.equal((await turno()).conclusaoDeFase,'gate_blocked:runtime.unavailable');
    // O resultado registrado pelo watcher prevalece sobre a leitura atual.
    nativo={state:'stopped'};
    registrar(dir,t.id,'phase_result',{fase:'GOAL',sessionId:sid,despachoEm:despacho,runtime:'claude-bg',origem:'sessions.watch',
      classificacao:'gate_blocked',motivo:'runtime.unavailable',sensorResultId:'claude-bg:'+'e'.repeat(64),estadoNativo:'stopped',fonte:'fixture SIMULADA'});
    d=await turno();
    assert.equal(d.conclusaoDeFase,'gate_blocked:runtime.unavailable');assert.equal(d.registrada,true);
  } finally {stub.mock.restore();}
}));

test('GO-FIX 3 (D17): ork_observe e o watcher dão a mesma leitura para stopped e failed, com e sem Stop correlacionado',()=>fixture(async(p,c)=>{
  const original=util.exec;
  const casos=[['stopped',true,'gate_blocked:human.pending'],['failed',true,'gate_blocked:human.pending'],
    ['stopped',false,'gate_blocked:runtime.unavailable'],['failed',false,'gate_blocked:runtime.unavailable']] as const;
  const nativos=new Map<string,string>();
  const stub=mock.method(util,'exec',(cmd:string,args:string[],cwd?:string,timeout?:number,env?:NodeJS.ProcessEnv)=>{
    if(cmd!=='claude')return original(cmd,args,cwd,timeout,env);
    return {ok:true,code:0,stderr:'',stdout:JSON.stringify([...nativos].map(([sessionId,state])=>({sessionId,cwd:p.dir,state})))};
  });
  try {
    for (const [i,[state,comStop,esperado]] of casos.entries()) {
      const t=novaThread(p.carregado,{nome:`d17-${i}`,modo:'auto'}).thread;
      const sid=`11111111-2222-4333-8444-${String(i).padStart(12,'7')}`,despacho='2026-09-09T10:00:00.000Z';
      t.sessoes.push({sessionId:sid,slug:t.slug,fase:'GOAL',bloco:'GOAL-PLAN-GO-CHECK-SHIP-MASTER',runtime:'claude-bg',
        despachadaEm:despacho,promptPath:'',promptSha256:'',verificada:true});gravarThread(p.dir,t);
      const dir=dirThread(p.dir,t.id);nativos.set(sid,state);
      if(comStop) registrar(dir,t.id,'runtime_stop',{fase:'GOAL',sessionId:sid,runtime:'claude-bg',despachoEm:despacho,
        fonte:'ork sessions event',sensor:'stop',sensorEventId:String(i).repeat(64)});
      const r=await call(c,'ork_observe',{threadId:t.id});assert.equal(r.error,false,r.text);
      const d=r.data().nativas[0].turno;
      const leitura=d.conclusaoDeFase==='encerrada-pelo-condutor'?d.classificacaoDoWatcher:d.conclusaoDeFase;
      assert.equal(leitura,esperado,`${state} comStop=${comStop}`);
      assert.equal(d.registrada,false);
      // O watcher, observando o mesmo estado, grava exatamente essa leitura.
      observarSessao(p.carregado,sid,{consultaClaude:()=>({ok:true,detalhe:'',consultadoEm:new Date().toISOString(),
        registros:[{sessionId:sid,cwd:p.dir,state}]})});
      const pr=lerLedger(dir).filter(e=>e.tipo==='phase_result').at(-1)!;
      assert.equal(pr.classificacao==='fase_concluida'?'fase_concluida':`gate_blocked:${String(pr.motivo)}`,esperado,`watcher ${state} comStop=${comStop}`);
      const depois=(await call(c,'ork_observe',{threadId:t.id})).data().nativas[0].turno;
      assert.deepEqual([depois.conclusaoDeFase,depois.registrada],[esperado,true]);
      nativos.delete(sid);
    }
  } finally {stub.mock.restore();}
}));

/**
 * GO-FIX 1 (A2): paridade de canal na recusa de modo aposentado.
 *
 * O GOAL da I-43 pediu que `#Look` ou `#Ork` escrito em QUALQUER canal recebesse
 * `modo.aposentado` nomeando o substituto vivo. O CLI dava; o MCP devolvia a frase do zod
 * ("Invalid enum value...") IGUAL para modo aposentado e para typo: em ingles, sem motivo
 * tipado e sem dizer por qual modo trocar. Quem decide e o nucleo; o host so transporta.
 */
test('MCP recusa modo aposentado com o motivo tipado do nucleo, e typo continua typo',async()=>await fixture(async(_p,c)=>{
  // O modo vem da lista do nucleo, nunca de literal: este teste PROVA A RECUSA, e escrever
  // `modo: 'look'` a mao o faria casar com o grep que cobra que nenhum teste CRIE thread em
  // modo aposentado (C8/C29). A propriedade e a mesma; a fonte do valor e que fica correta.
  const [look,ork]=MODOS_APOSENTADOS;
  const aposentado=await call(c,'ork_thread_new',{nome:'no canal MCP',modo:look});
  assert.equal(aposentado.error,true);
  assert.match(aposentado.text,/modo\.aposentado/);
  assert.match(aposentado.text,/#Look/);
  assert.match(aposentado.text,/#Classic/,'a recusa nomeia o substituto vivo, derivado da lista');
  assert.doesNotMatch(aposentado.text,/Invalid enum value/);

  const outro=await call(c,'ork_thread_new',{nome:'no canal MCP',modo:ork});
  assert.match(outro.text,/modo\.aposentado/);
  assert.match(outro.text,/#Ork/);

  // Aposentado e typo sao erros diferentes, porque a acao do dono tambem e.
  const typo=await call(c,'ork_thread_new',{nome:'no canal MCP',modo:'xyzinexistente'});
  assert.equal(typo.error,true);
  assert.match(typo.text,/modo\.desconhecido/);

  // O preflight e o outro ponto do canal que recebe modo, e segue a mesma regra.
  const preflight=await call(c,'ork_preflight',{modo:look});
  assert.equal(preflight.error,true);
  assert.match(preflight.text,/modo\.aposentado/);

  // E o modo vivo continua passando inteiro.
  const viva=await call(c,'ork_thread_new',{nome:'thread viva',modo:'auto'});
  assert.equal(viva.error,false,viva.text);
}));
