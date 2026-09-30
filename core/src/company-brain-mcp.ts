import { z } from 'zod';
import { ManifestoCarregado } from './manifest';
import { runBrain } from './company-brain-cli';
import { ID_DE_DECISAO } from './company-brain-dossie';
export const BRAIN_READ_TOOLS=['ork_brain_status','ork_brain_inventory','ork_brain_get','ork_brain_query','ork_brain_receipts','ork_brain_context','ork_brain_dossie'] as const;
export const BRAIN_WRITE_TOOLS=['ork_brain_sync','ork_brain_apply','ork_brain_rollback','ork_brain_bind'] as const;
/** Installation supplies exact grants; presence of a tool is never activation or human identity. */
export function registerBrainTools(register:(name:string,config:any,handler:any)=>void,load:()=>ManifestoCarregado,
  checkThread:(id:string)=>unknown,writeGrants:readonly string[]=[]):void{
  if(writeGrants.some(n=>!(BRAIN_WRITE_TOOLS as readonly string[]).includes(n)))throw Error('brain.mcp.grant-invalid');
  const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),base=z.object({threadId:id}).strict();
  const definitions:[string,z.AnyZodObject][]=[['status',base],['inventory',base],['get',base.extend({id})],['receipts',base.extend({id})],
    ['query',base.extend({ids:z.array(id).max(1000).optional(),kinds:z.array(z.enum(['prod','proj','init','assertion'])).optional(),limit:z.number().int().min(1).max(1000).optional()})],
    ['context',base.extend({ids:z.array(id).min(1).max(1000).optional()})],
    ['dossie',base.extend({decisao:z.string().regex(ID_DE_DECISAO).optional()})],
    ['sync',base],['apply',base.extend({plan:z.string().min(1).max(512),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/)})],
    ['rollback',base.extend({batch:id})],['bind',base.extend({project:id,initiatives:z.array(id).min(1).max(1000)})]];
  for(const [operation,inputSchema] of definitions){
    const name='ork_brain_'+operation,writing=(BRAIN_WRITE_TOOLS as readonly string[]).includes(name);
    if(writing&&!writeGrants.includes(name))continue;
    register(name,{description:`Company Brain ${operation}: estado e fontes pelo contrato canônico; identidade humana nunca vem de argumento.`,inputSchema:inputSchema.strict(),annotations:{readOnlyHint:!writing,destructiveHint:writing}},async(args:any)=>{
      const c=load();checkThread(args.threadId);
      const options:Record<string,string|boolean>={thread:args.threadId,json:true};
      for(const [key,value] of Object.entries(args))if(key!=='threadId')options[key==='expectedSha256'?'expected-sha256':key]=Array.isArray(value)?value.join(','):String(value);
      const result=runBrain(c,operation,options);
      return{content:[{type:'text',text:JSON.stringify(result)}],...(['unavailable','forbidden','conflict'].includes(result.state)?{isError:true}:{})};
    });
  }
}
