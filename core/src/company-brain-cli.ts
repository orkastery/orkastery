import * as fs from 'node:fs';
import * as path from 'node:path';
import { ManifestoCarregado } from './manifest';
import { memoryState, stateFile } from './project-state';
import { assertCycleScope, readPortfolio } from './portfolio';
import { dirThread, lerThread } from './thread';
import { exigirAtivacao } from './write-activation';
import { registrar } from './ledger';
import { brainClient, BRAIN_API, BrainTransport } from './company-brain-client';
import { capture } from './company-brain-capture';
import { readSourceFile, SourceScope } from './company-brain-source';
import { brainAdmin, reconcileBrain, applyBrain } from './company-brain-migration';
import { atomicJson, readJournal } from './company-brain-journal';
import { digest, validateContract } from './company-brain-contract';
import { buildContext } from './company-brain-context';
export const BRAIN_READ=['status','inventory','get','query','receipts','reconcile','context'] as const;
export const BRAIN_WRITE=['sync','apply','rollback','bind'] as const;
export function runBrain(c:ManifestoCarregado,sub:string,options:Record<string,string|boolean>,positionals:string[]=[],transport?:BrainTransport):any{
  const context=memoryState(c);c=context.loaded;const config=c.manifesto.memory;
  if(![...BRAIN_READ,...BRAIN_WRITE].includes(sub as any))throw Error('brain.operation.invalid');
  const allowed=new Set(['thread','json','id','ids','kinds','workspaces','limit','offset','batch','dry-run','plan','expected-sha256','project','initiatives']);
  if(Object.keys(options).some(k=>!allowed.has(k)))throw Error('brain.argument.invalid');
  const value=(name:string)=>typeof options[name]==='string'?options[name] as string:undefined;
  const thread=value('thread');
  let scope:SourceScope={tenant:config.tenant,instance:c.manifesto.project.name,thread:thread??'',aclRef:'ork-factory'};
  const client=transport??brainClient(c);
  if(sub==='status')return{...client({schema:BRAIN_API,operation:'capabilities'}),tenant:config.tenant,configSource:context.source};
  if(sub==='get'||sub==='receipts')return client({schema:BRAIN_API,operation:sub,payload:{tenant_id:config.tenant,[sub==='get'?'id':'event_id']:value('id')??positionals[0]??''}});
  if(sub==='query'||sub==='inventory'){
    const split=(name:string)=>(value(name)??'').split(',').filter(Boolean);
    return client({schema:BRAIN_API,operation:'query',payload:validateContract({schema:'orkmind.company-brain-selection/v1',tenant_id:config.tenant,
      facets:{ids:split('ids'),kinds:split('kinds'),workspace_ids:split('workspaces'),source_instances:[]},mode:'selection',limit:Number(value('limit')??50),offset:Number(value('offset')??0)})});
  }
  if(!thread)throw Error('brain.thread.required');lerThread(c.raiz,thread);
  if(sub==='reconcile'){
    if(options['dry-run']!==true)throw Error('brain.migration.dry-run-required');
    return{state:'ok',...reconcileBrain(c,scope,value('batch')??'inventory-'+digest(readPortfolio(c.raiz)).slice(0,20))};
  }
  // B4.1: só leitura, por isso fica antes da ativação. Sem --ids, vale o escopo vinculado da thread.
  if(sub==='context'){
    let ids=(value('ids')??'').split(',').filter(Boolean);
    const bindingFile=path.join(dirThread(c.raiz,thread),'brain-scope.json');
    if(!ids.length&&fs.existsSync(bindingFile)){const binding=JSON.parse(fs.readFileSync(bindingFile,'utf8'));ids=[binding.projectId,...(binding.initiativeIds??[])].filter(Boolean);}
    return buildContext(c,ids,client,thread);
  }
  // Existing reviewed activation plus dedicated Brain DB grants: neither grants the other.
  exigirAtivacao(c,thread,'memory');
  const dir=dirThread(c.raiz,thread);
  if(sub==='bind'){
    const selection=assertCycleScope(c.raiz,{projectId:value('project')??'',delivery:'initiatives',initiativeIds:(value('initiatives')??'').split(',').filter(Boolean)});
    const binding={schema:'ork.brain-cycle-scope/v1',version:1,thread,...selection};
    const file=path.join(dir,'brain-scope.json');
    if(fs.existsSync(file)){if(digest(JSON.parse(fs.readFileSync(file,'utf8')))!==digest(binding))throw Error('brain.scope.immutable');return{state:'ok',binding};}
    atomicJson(file,binding);registrar(dir,thread,'brain_scope_recorded',{binding,sha256:digest(binding)});return{state:'ok',binding};
  }
  if(sub==='sync'){
    const bindingFile=path.join(dir,'brain-scope.json');
    if(fs.existsSync(bindingFile)){
      const binding=JSON.parse(fs.readFileSync(bindingFile,'utf8'));
      if(binding.schema!=='ork.brain-cycle-scope/v1'||binding.version!==1||binding.thread!==thread)throw Error('brain.scope.invalid');
      const selection=assertCycleScope(c.raiz,{projectId:binding.projectId,delivery:binding.delivery,initiativeIds:binding.initiativeIds});
      scope={...scope,projectId:selection.projectId,initiativeIds:selection.initiativeIds};
    }
    return capture(scope,path.join(dir,'brain'),readPortfolio(c.raiz),readSourceFile(path.join(dir,'ledger.jsonl')),client,
      undefined,readJournal(stateFile(c.raiz,'portfolio.json')+'.journal.jsonl'));
  }
  if(sub==='apply'){
    const filename=value('plan');if(!filename)throw Error('brain.migration.plan-required');
    const file=path.resolve(c.raiz,filename);if(!file.startsWith(path.resolve(c.raiz)+path.sep))throw Error('brain.migration.path-invalid');
    const plan=JSON.parse(readSourceFile(file,2*1024*1024).toString('utf8'));
    return applyBrain(c,plan,value('expected-sha256')??'');
  }
  if(sub==='rollback')return brainAdmin(c)('rollback',{batch_id:value('batch')??''});
  throw Error('brain.operation.invalid');
}
