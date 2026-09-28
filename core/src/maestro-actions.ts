/** Ações são propostas. A autoridade continua nos endpoints existentes do núcleo. */
import { z } from 'zod';
import { MaestroItem, MaestroSnapshot } from './maestro-contract';
import { MaestroContext, revalidateMaestroContext } from './maestro-discovery';
import { SourceSection, item } from './maestro-sources';

export const ACTION_TRANSPORT = {
  'thread.status':'ork_thread_status', 'thread.observe':'ork_observe', 'hitl.decide':'ork_request_decision',
  'git.status':'ork_git_status', 'git.commit':'ork_git_commit', verify:'ork_verify', ship:'ork_ship',
  retry:'ork retry', master:'ork master', phase:'ork_phase_run', creation:'ork creation',
} as const;
type Operation=keyof typeof ACTION_TRANSPORT;
export interface ActionHost { tools: readonly string[]; child: boolean; }
export function proposeMaestroActions(threads: readonly MaestroItem[], host: ActionHost): SourceSection {
  const items:MaestroItem[]=[];
  for(const t of threads) {
    const operations:Operation[]=['thread.status','thread.observe','git.status','git.commit','verify','ship','hitl.decide','retry','master','phase'];
    for(const operation of operations) {
      const tool=ACTION_TRANSPORT[operation],ownerOnly=['hitl.decide','phase','master','creation'].includes(operation);
      const supported=host.tools.includes(tool), available=supported&&!(host.child&&ownerOnly);
      items.push({...item(`${operation}:${t.id}`,operation,available?'proposed':'unavailable',[{kind:'thread',id:t.id}],{}),
        action:{operation,available,reason:available?'':host.child&&ownerOnly?'authority.conductor_required':'transport.unavailable',
          preconditions:['state.revalidate',...(!['thread.status','thread.observe','git.status'].includes(operation)?['native.authorization','core.gates','operation.required_arguments']:[])],readback:'ork_thread_status'}});
    }
  }
  return {source:'ork.maestro.actions/v1',items,gaps:[]};
}
const requestSchema=z.object({id:z.string().min(1).max(160),expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export interface ActionPorts {
  /** Portas vinculadas pelo host, nunca funções/configuração provenientes de tools/call. */
  snapshot:()=>MaestroSnapshot;
  receipts:(id:string,fingerprint:string)=>unknown|null;
  readback:(threadId:string)=>unknown;
  operations:Partial<Record<Operation,(threadId:string)=>unknown>>;
}
export function performMaestroAction(context:MaestroContext,input:unknown,ports:ActionPorts): { receipt:unknown; readback:unknown; repeated:boolean } {
  const request=requestSchema.parse(input);revalidateMaestroContext(context);
  const current=ports.snapshot();
  const selected=current.sections.nextActions.items.find(a=>a.id===request.id), action=selected?.action;
  if(!selected||!action?.available)throw Error(action?.reason||'maestro.action.unavailable');
  const target=selected.refs.find(r=>r.kind==='thread')?.id;
  if(!target||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(target))throw Error('maestro.project.scope');
  const previous=ports.receipts(request.id,request.expectedFingerprint);
  if(previous!==null)return {receipt:previous,readback:ports.readback(target),repeated:true};
  if(current.fingerprint!==request.expectedFingerprint||current.conflicts.length||Object.values(current.sections).some(s=>['stale','conflict'].includes(s.state)))throw Error('maestro.snapshot.stale');
  const execute=ports.operations[action.operation];
  if(!execute)throw Error('transport.unavailable');
  revalidateMaestroContext(context);
  const receipt=execute(target);
  return {receipt,readback:ports.readback(target),repeated:false};
}
