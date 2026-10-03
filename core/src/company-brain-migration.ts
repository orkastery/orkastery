import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ManifestoCarregado } from './manifest';
import { memoryState, stateFile } from './project-state';
import { readPortfolio } from './portfolio';
import { portfolioHistory, SourceScope, readSourceFile } from './company-brain-source';
import { bytesHash, readJournal } from './company-brain-journal';
import { digest, validateContract } from './company-brain-contract';
export type AdminTransport=(operation:'plan'|'apply'|'rollback',payload:unknown)=>any;
export function brainAdmin(c:ManifestoCarregado):AdminTransport{
  const config=memoryState(c).loaded.manifesto.memory;
  return(operation,payload)=>{
    const dsn=config.database_url_env?process.env[config.database_url_env]:undefined;
    if(config.mode!=='orkmind'||!dsn)throw Error('brain.configuration.missing');
    // RM-047: cwd fora do clone; um nome de interpretador em memory.cli não acha arquivo do repositório.
    const r=spawnSync(config.cli,['brain','migration'],{cwd:os.homedir(),shell:false,encoding:'utf8',timeout:Math.min(config.timeout_ms,15000),maxBuffer:2*1024*1024,
      input:JSON.stringify({schema:'orkmind.company-brain-admin/v1',operation,payload}),
      env:{PATH:process.env.PATH??'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',ORKMIND_DATABASE_URL:dsn,ORKMIND_BRAIN_TENANT:config.tenant}});
    try{const response=JSON.parse(r.stdout);if(r.status!==0||response.state!=='ok')throw Error();return response.result;}
    catch{throw Error('brain.migration.unconfirmed');}
  };
}
export function reconcileBrain(c:ManifestoCarregado,scope:SourceScope,batch:string,transport:AdminTransport=brainAdmin(c)){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(batch))throw Error('brain.migration.batch-invalid');
  const file=stateFile(c.raiz,'portfolio.json'),before=bytesHash(readSourceFile(file));
  const catalog=readPortfolio(c.raiz);
  const latest=new Map<string,any>();
  for(const entity of portfolioHistory(catalog,scope,readJournal(file+'.journal.jsonl')))latest.set(entity.id,entity);
  const currentIds=new Set([...catalog.products,...catalog.projects,...catalog.initiatives].map(e=>e.id));
  const entities=[...latest.values()].filter(e=>currentIds.has(e.id));
  if(bytesHash(readSourceFile(file))!==before)throw Error('brain.migration.source-changed');
  const plan=validateContract<any>(transport('plan',{entities,batch_id:batch,source_hash:before,observed_at:catalog.updatedAt}));
  if(plan.schema!=='orkmind.company-brain-migration/v1'||plan.source_hash!==before||plan.tenant_id!==scope.tenant||
    plan.operations.length!==entities.length||new Set(plan.operations.map((o:any)=>o.id)).size!==entities.length||
    entities.some(e=>!plan.operations.some((o:any)=>o.id===e.id&&digest(o.after)===digest(e))))throw Error('brain.migration.plan-invalid');
  return{plan,sha256:digest(plan)};
}
export function applyBrain(c:ManifestoCarregado,plan:unknown,expected:string,transport:AdminTransport=brainAdmin(c)){
  const validated=validateContract<any>(plan);
  const config=memoryState(c).loaded.manifesto.memory;
  if(validated.schema!=='orkmind.company-brain-migration/v1'||validated.tenant_id!==config.tenant||digest(plan)!==expected)throw Error('brain.migration.stale');
  const current=bytesHash(readSourceFile(stateFile(c.raiz,'portfolio.json')));
  if(current!==validated.source_hash)throw Error('brain.migration.source-changed');
  return transport('apply',{plan:validated,expected_hash:expected,current_source_hash:current});
}
