import { z } from 'zod';
import { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { SECTION_NAMES } from './maestro-contract';
import { discoverMaestro } from './maestro-discovery';
import { readMaestro } from './maestro-cli';

export const maestroInputSchema=z.object({threadId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/).optional(),
  section:z.enum(SECTION_NAMES).optional(),offset:z.number().int().min(0).max(100000).optional()}).strict();
type Register=<S extends z.AnyZodObject>(name:string,config:{description:string;inputSchema:S;annotations:Tool['annotations']},
  handler:(args:z.infer<S>,extra:{signal:AbortSignal})=>Promise<CallToolResult>)=>void;
export function registerMaestro(register:Register,options:{root:string;threadId?:string;load:()=>unknown;checkThread:(id:string)=>unknown;tools:()=>string[]}):void {
  register('ork_maestro',{description:'Panorama Maestro somente leitura, fixado ao projeto e ao escopo da sessão; cobertura, lacunas e próximas ações pelos endpoints existentes. Não lê o roadmap, as reservas nem as outras máquinas (veja notConsulted): zero threads nunca é roadmap vazio; para o roadmap, com as threads de todas as máquinas, use ork_network_roadmap.',
    inputSchema:maestroInputSchema,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async args=>{
    options.load();
    if((args.section===undefined)!==(args.offset===undefined))throw Error('maestro.page.invalid');
    const threadId=args.threadId??options.threadId;
    if(threadId)options.checkThread(threadId);
    // RM-052 (D5): fixado no projeto servido; os outros projetos da maquina nao entram na conta.
    const context=discoverMaestro({cwd:options.root,pinned:options.root,countOtherProjects:false});
    const result=readMaestro(context,{threadId,native:true,offsets:args.section?{[args.section]:args.offset!}:undefined,
      host:{tools:options.tools(),child:!!options.threadId}});
    return {content:[{type:'text',text:JSON.stringify(result)}]};
  });
}
