#!/usr/bin/env node
/* Operational CHECK: results are collected in this process from installed
 * CLI/MCP transports. Files never supply a principal or a host receipt. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const HOSTS=['hermes','openclaw','claude-code','codex'];
const PROBE_CLAIMS=new Set(['C119','C120','C121']);

function envFile(file){
  const result={};let contents='';try{contents=fs.readFileSync(file,'utf8');}catch{return result;}
  for(const line of contents.split(/\r?\n/)){
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)continue;
    let value=match[2].trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    result[match[1]]=value;
  }
  return result;
}
function run(command,args,cwd,env,input,timeout=20000){
  const started=Date.now(),result=spawnSync(command,args,{cwd,env,encoding:'utf8',input,timeout,maxBuffer:4*1024*1024,shell:false});
  let json=null;try{json=JSON.parse(result.stdout);}catch{}
  return{ok:result.status===0&&!result.error&&!result.signal,json,stdout:result.stdout??'',elapsedMs:Date.now()-started,status:result.status};
}
function idsOf(result){
  if(!result||result.state!=='ok'||!Array.isArray(result.items))return[];
  return result.items.map(item=>item?.entity?.id).filter(id=>typeof id==='string').sort();
}
function idsHash(ids){return crypto.createHash('sha256').update(ids.join('\n')).digest('hex');}
function percentile95(values){if(!values.length)return null;const ordered=[...values].sort((a,b)=>a-b);return ordered[Math.ceil(ordered.length*.95)-1];}
function assess(evidence,stage){
  const blockers=[];
  if(evidence.memory?.pedido!=='orkmind'||evidence.memory?.efetivo!=='orkmind'||evidence.memory?.tenant!=='orkastery')blockers.push('brain.live.memory-unconfirmed');
  if(evidence.brain?.state!=='ok')blockers.push('brain.live.api-unavailable');
  const expected=evidence.portfolio?.idsHash;
  for(const host of HOSTS){
    const proof=evidence.hosts?.[host];
    if(!proof||proof.state!=='ok'||proof.count!==evidence.portfolio?.count||proof.idsHash!==expected||proof.elapsedMs<0)
      blockers.push(`brain.live.native-transport-unavailable:${host}`);
  }
  if(!evidence.portfolio?.historicalPreserved||!evidence.portfolio?.brainReadback)blockers.push('brain.live.portfolio-incomplete');
  const fresh=evidence.freshness;
  if(!fresh||fresh.denominator<3||fresh.failures!==0||fresh.samples!==fresh.denominator||fresh.p95===null||fresh.p95>60000)
    blockers.push('brain.live.freshness-unconfirmed');
  if(evidence.agenteHermes?.state!=='ok'||evidence.agenteHermes?.gateway!=='active'||!evidence.agenteHermes?.adapterMatch||!evidence.agenteHermes?.orkmindEditable||!evidence.agenteHermes?.brainReadback)
    blockers.push('brain.live.hermes-agent-unconfirmed');
  if(stage==='post-master'){
    if(!evidence.events?.includes('ship_done'))blockers.push('brain.live.ship-unconfirmed');
    if(!evidence.events?.includes('master_done'))blockers.push('brain.live.master-unconfirmed');
  }
  return{schema:'ork.brain-live-verification/v1',stage,ok:blockers.length===0,blockers,
    freshness:fresh??{state:'unmeasured',p95:null,denominator:null},
    hostParity:blockers.some(item=>item.includes('native-transport'))?'unconfirmed':'confirmed',
    agenteHermes:blockers.includes('brain.live.hermes-agent-unconfirmed')?'unconfirmed':'confirmed'};
}
async function mcpHost(host,root,canonical,thread,env){
  const client=new Client({name:'ork-brain-live-verifier',version:'1.0.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'core/dist/index.js'),'mcp','serve','--project',canonical,'--host',host,'--thread',thread],env,stderr:'pipe'});
  const started=Date.now();
  try{
    await client.connect(transport);
    const listed=await client.listTools();
    if(!listed.tools.some(tool=>tool.name==='ork_brain_query'))throw Error('tool absent');
    const response=await client.callTool({name:'ork_brain_query',arguments:{threadId:thread,kinds:['prod','proj','init'],limit:50}});
    if(response.isError||!Array.isArray(response.content)||response.content[0]?.type!=='text')throw Error('tool failed');
    const result=JSON.parse(response.content[0].text),ids=idsOf(result);
    return{state:result.state,count:result.count,ids,idsHash:idsHash(ids),elapsedMs:Date.now()-started,surface:'mcp'};
  }catch{return{state:'unavailable',count:0,ids:[],idsHash:null,elapsedMs:Date.now()-started,surface:'mcp'};}
  finally{try{await client.close();}catch{}}
}
function cliHost(bin,root,thread,env){
  const result=run(bin,['query','--thread',thread,'--kinds','prod,proj,init','--limit','50'],root,env),ids=idsOf(result.json);
  return{state:result.ok?result.json?.state:'unavailable',count:result.json?.count??0,ids,idsHash:idsHash(ids),elapsedMs:result.elapsedMs,surface:'cli'};
}
function probeEvents(canonical,thread){
  const file=path.join(canonical,'.orkastery/threads',thread,'ledger.jsonl'),bytes=fs.readFileSync(file);
  const lines=bytes.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  const {readCycle}=require('../dist/company-brain-source.js');
  const records=readCycle(bytes,{tenant:'orkastery',instance:'orkastery',thread,aclRef:'ork-factory'},0).records;
  const probes=[];
  for(let index=0;index<lines.length;index++)if(lines[index].tipo==='claim_added'&&PROBE_CLAIMS.has(lines[index].claim)&&records[index]?.event)
    probes.push({claim:lines[index].claim,observedAt:lines[index].ts,event:records[index].event});
  return probes.sort((a,b)=>a.claim.localeCompare(b.claim));
}
function installedMatch(root,host,installed){
  const expected=fs.readFileSync(path.join(root,'adapters',host,'bin/ork-brain.sh'),'utf8').replace(/\{\{ork_bin\}\}/g,path.join(root,'core/dist/index.js'));
  try{return fs.readFileSync(installed,'utf8')===expected&&(fs.statSync(installed).mode&0o111)!==0;}catch{return false;}
}
async function main(args){
  const allowed=['--thread','--tenant','--hosts','--stage'],options={};
  for(let index=0;index<args.length;index+=2){if(!allowed.includes(args[index])||!args[index+1]||Object.hasOwn(options,args[index]))throw Error('brain.live.arguments');options[args[index]]=args[index+1];}
  if(options['--thread']!=='ork-c1contratosa'||options['--tenant']!=='orkastery'||options['--hosts']!==HOSTS.join(',')||!['check','post-master'].includes(options['--stage']))throw Error('brain.live.scope');
  const root=path.resolve(__dirname,'../..'),thread=options['--thread'];
  const {raizDoEstado}=require('../dist/estado-thread.js'),canonical=raizDoEstado(root);
  const secrets={...envFile(path.join(os.homedir(),'.hermes/.env')),...process.env};
  const baseEnv={PATH:secrets.PATH??'/usr/bin:/bin',HOME:secrets.HOME??os.homedir(),LANG:secrets.LANG??'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'};
  const serviceEnv={...baseEnv,ORKASTERY_ORKMIND_DATABASE_URL:secrets.ORKASTERY_ORKMIND_DATABASE_URL??''};
  const readEnv={...baseEnv,ORKASTERY_ORKMIND_DATABASE_URL:secrets.ORKASTERY_BRAIN_READ_DATABASE_URL??''};
  const invoke=(argv,env=serviceEnv)=>run(process.execPath,[path.join(root,'core/dist/index.js'),...argv],root,env).json??{state:'unavailable'};
  const memory=invoke(['memory','status','--json']),brain=invoke(['brain','status']);
  const catalog=JSON.parse(fs.readFileSync(path.join(canonical,'.orkastery/portfolio.json'),'utf8'));
  const ids=[...catalog.products,...catalog.projects,...catalog.initiatives].map(entity=>entity.id).sort();
  const historical=['prod-orkastery','prod-orkmind','proj-maestro-workspace','init-i18-portfolio-ontology','init-i19-multirepo-catalog','init-i20-kanban-modes','init-i21-channel-continuity','init-i22-runtime-config','init-i23-copilot-maestro','init-i24-ux-docs'];
  const expectedHash=idsHash(ids),hermesBin=path.join(os.homedir(),'.hermes/bin/ork-brain.sh');
  const openclawBin=path.join(os.homedir(),'.openclaw/extensions/orkastery/bin/ork-brain.sh');
  const hosts={hermes:cliHost(hermesBin,root,thread,readEnv),openclaw:cliHost(openclawBin,root,thread,readEnv)};
  hosts['claude-code']=await mcpHost('claude-code',root,canonical,thread,readEnv);hosts.codex=await mcpHost('codex',root,canonical,thread,readEnv);
  const probes=probeEvents(canonical,thread),queryAt=Date.now();
  const probeRun=run(hermesBin,['query','--thread',thread,'--ids',probes.map(probe=>probe.event.aggregate_id).join(','),'--kinds','assertion','--limit','50'],root,readEnv);
  const found=new Set(idsOf(probeRun.json)),readbacks=[];
  for(const probe of probes){
    const receipt=run(hermesBin,['receipts',probe.event.id,'--thread',thread],root,readEnv).json;
    const retrievable=receipt?.items?.find(item=>item.stage==='retrievable'&&item.result==='ok');
    if(found.has(probe.event.aggregate_id)&&retrievable)readbacks.push({claim:probe.claim,eventId:probe.event.id,aggregateId:probe.event.aggregate_id,
      sourceHash:probe.event.source.source_hash,originAt:probe.observedAt,retrievableAt:retrievable.recorded_at});
  }
  const receiptFile=path.join(canonical,'.orkastery/threads',thread,'brain/live-query-receipt.json');
  let firstQueryAt=queryAt,receiptState='unavailable';
  try{
    if(fs.existsSync(receiptFile)){
      const stored=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
      const expected=readbacks.map(({claim,eventId,aggregateId,sourceHash})=>({claim,eventId,aggregateId,sourceHash}));
      if(stored.schema!=='ork.brain-live-query-receipt/v1'||stored.thread!==thread||JSON.stringify(stored.probes)!==JSON.stringify(expected)||!Number.isFinite(Date.parse(stored.firstAuthorizedQueryAt)))throw Error();
      firstQueryAt=Date.parse(stored.firstAuthorizedQueryAt);receiptState='validated';
    }else if(readbacks.length===probes.length&&probes.length>=3){
      const body={schema:'ork.brain-live-query-receipt/v1',thread,firstAuthorizedQueryAt:new Date(queryAt).toISOString(),
        probes:readbacks.map(({claim,eventId,aggregateId,sourceHash})=>({claim,eventId,aggregateId,sourceHash}))};
      fs.mkdirSync(path.dirname(receiptFile),{recursive:true});
      const temporary=receiptFile+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(body,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,receiptFile);
      receiptState='recorded';
    }
  }catch{receiptState='invalid';}
  const samples=readbacks.map(readback=>({...readback,firstAuthorizedQueryAt:new Date(firstQueryAt).toISOString(),latencyMs:firstQueryAt-Date.parse(readback.originAt)}));
  const latencies=samples.map(sample=>sample.latencyMs),freshness={state:samples.length===probes.length&&probes.length>=3&&receiptState!=='invalid'?'measured':'incomplete',
    window:'C119-C121 operational CHECK probes',clock:'UTC canonical Ork ledger and first live authorized query receipt',receipt:receiptState,
    denominator:probes.length,samples:samples.length,failures:probes.length-samples.length,p95:percentile95(latencies),valuesMs:latencies};
  const python=path.join(os.homedir(),'.hermes/hermes-agent/venv/bin/python');
  const pip=run(python,['-m','pip','show','orkmind'],canonical,baseEnv),gateway=run('hermes',['gateway','status'],canonical,baseEnv);
  const adapterMatch=installedMatch(root,'hermes',hermesBin),orkmindEditable=pip.stdout.includes(path.join(root,'.orkastery/tmp/orkmind'));
  const agenteHermes={state:adapterMatch&&gateway.stdout.includes('active (running)')&&orkmindEditable&&hosts.hermes.idsHash===expectedHash?'ok':'unconfirmed',
    gateway:gateway.stdout.includes('active (running)')?'active':'unconfirmed',adapterMatch,orkmindEditable,brainReadback:hosts.hermes.idsHash===expectedHash};
  const ledger=fs.readFileSync(path.join(canonical,'.orkastery/threads',thread,'ledger.jsonl'),'utf8');
  const events=ledger.trimEnd().split('\n').map(line=>JSON.parse(line).tipo);
  const portfolio={ids,count:ids.length,idsHash:expectedHash,historicalPreserved:historical.every(id=>ids.includes(id))&&new Set(ids).size===ids.length,
    brainReadback:HOSTS.every(host=>hosts[host].idsHash===expectedHash)};
  const evidence={memory,brain,hosts,portfolio,freshness,agenteHermes,events};
  const result={...assess(evidence,options['--stage']),observedAt:new Date().toISOString(),portfolio,hosts,freshness,agenteHermes,
    schemaHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'core/schemas/company-brain.schema.json'))).digest('hex')};
  console.log(JSON.stringify(result,null,2));return result.ok?0:1;
}
module.exports={assess,main};
if(require.main===module)main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{console.log(JSON.stringify({schema:'ork.brain-live-verification/v1',ok:false,blockers:['brain.live.source-unavailable']}));process.exitCode=1;});
