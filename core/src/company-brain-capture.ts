import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrainEvent, validateContract } from './company-brain-contract';
import { BrainTransport, BRAIN_API } from './company-brain-client';
import { atomicJson, bytesHash, durableAppend, withProcessLock } from './company-brain-journal';
import { entityEvent, portfolioEntities, portfolioHistory, readCycle, SourceScope } from './company-brain-source';
import { Portfolio } from './portfolio';
type Version = {version:number;hash:string;sequence:number};
interface Pending {event:BrainEvent;version?:Version;end?:number;attempts:number;error:string|null;}
interface Cursor {schema:'ork.brain-cursor/v2';scope:SourceScope;offset:number;prefixHash:string;
  versions:Record<string,Version>;pending:Record<string,Pending>;confirmed:Record<string,boolean>;}
export function capture(scope:SourceScope, dir:string, catalog:Portfolio, ledger:Buffer, transport:BrainTransport,
  fault:(stage:string)=>void=()=>{}, journal:any[]=[]): {state:'ok'|'unavailable';received:number;offset:number;partial:boolean;error?:string;errors?:Record<string,string>} {
  const file=path.join(dir,'cursor.json');fs.mkdirSync(dir,{recursive:true});
  return withProcessLock(path.join(dir,'capture.lock'),'brain.capture.busy',()=>{
    let cursor:Cursor=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema:'ork.brain-cursor/v2',scope,
      offset:0,prefixHash:bytesHash(''),versions:{},pending:{},confirmed:{}};
    // Preserve the single outstanding v1 outbox item and its already-spent attempts.
    const legacy=cursor as any;
    if(legacy.schema==='ork.brain-cursor/v1'){
      const p=legacy.pending;
      cursor={...legacy,schema:'ork.brain-cursor/v2',pending:{},confirmed:{}};
      if(p)cursor.pending[p.event.aggregate_id]={event:p.event,attempts:p.attempts,error:p.error,
        ...(p.next.offset>cursor.offset?{end:p.next.offset}:{version:p.next.versions[p.event.aggregate_id]})};
    }
    if(cursor.schema!=='ork.brain-cursor/v2'||JSON.stringify(cursor.scope)!==JSON.stringify(scope)||
      !Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset>ledger.length||
      bytesHash(ledger.subarray(0,cursor.offset))!==cursor.prefixHash)throw Error('brain.cursor.source-conflict');
    const source=readCycle(ledger,scope,cursor.offset);let received=0;
    const errors:Record<string,string>={};
    // A migration may have materialized the current snapshot before this local
    // cursor existed. Read the authenticated aggregate head and continue from
    // its monotonic sequence; never guess from a local migration plan.
    for(const entity of portfolioEntities(catalog,scope)){
      if(cursor.versions[entity.id]||cursor.pending[entity.id])continue;
      let response;
      try{response=transport({schema:BRAIN_API,operation:'head',payload:{tenant_id:scope.tenant,id:entity.id}});}
      catch{response={state:'unavailable'};}
      if(response.state==='unknown')continue;
      if(response.state!=='ok'){
        if(['forbidden','withheld','conflict'].includes(response.state))errors[entity.id]='brain.capture.head-unavailable';
        continue;
      }
      const head=response as any;
      if(!Number.isSafeInteger(head.sequence)||head.sequence<1||typeof head.active!=='boolean'||
        (head.active&&(!Number.isSafeInteger(head.source_version)||head.source_version<1||
          typeof head.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(head.source_hash)))){
        errors[entity.id]='brain.capture.head-invalid';continue;
      }
      if(!head.active){cursor.versions[entity.id]={version:0,hash:'',sequence:head.sequence};continue;}
      if(head.source_version>entity.version){errors[entity.id]='brain.source.version-conflict';continue;}
      cursor.versions[entity.id]={version:head.source_version,hash:head.source_hash,sequence:head.sequence};
    }
    const flush=(aggregate:string):boolean=>{
      const pending=cursor.pending[aggregate];if(!pending)return true;
      const event=validateContract<BrainEvent>(pending.event);
      while(pending.attempts<3){
        pending.attempts++;atomicJson(file,cursor);fault('attempt');
        let response;try{response=transport({schema:BRAIN_API,operation:'ingest',payload:event});}
        catch{response={state:'unavailable'};}
        try{
          if(response.state!=='ok')throw Error('brain.capture.unconfirmed');
          const receipt=validateContract<any>((response as any).receipt);
          const indexed=validateContract<any>((response as any).indexed);
          for(const [r,stage] of [[receipt,'materialized'],[indexed,'retrievable']]) {
            if(r.schema!=='orkmind.company-brain-receipt/v1'||r.tenant_id!==scope.tenant||r.event_id!==event.id||r.stage!==stage||r.result!=='ok'||
              r.materialized_version!==(event.payload?.version??r.materialized_version))throw Error('brain.receipt.invalid');
          }
          fault('remote-receipt');
          durableAppend(path.join(dir,'receipts.jsonl'),{event_id:event.id,receipt,indexed});
          if(pending.version)cursor.versions[aggregate]=pending.version;
          if(pending.end!==undefined)cursor.confirmed[String(pending.end)]=true;
          delete cursor.pending[aggregate];atomicJson(file,cursor);fault('cursor');received++;return true;
        }catch(error){
          if(error instanceof Error && error.message==='injected-crash')throw error;
          pending.error='brain.capture.unconfirmed';atomicJson(file,cursor);
          if(['conflict','forbidden','withheld'].includes(response.state))break;
        }
      }
      errors[aggregate]='brain.capture.dead-letter';return false;
    };
    for(const aggregate of Object.keys(cursor.pending))flush(aggregate);
    const enqueue=(pending:Pending):boolean=>{
      cursor.pending[pending.event.aggregate_id]=pending;atomicJson(file,cursor);fault('outbox');return flush(pending.event.aggregate_id);
    };
    for(const entity of portfolioHistory(catalog,scope,journal)){
      if(errors[entity.id]||cursor.pending[entity.id])continue;
      const old=cursor.versions[entity.id];
      if(old&&entity.version<old.version)continue;
      if(old?.version===entity.version){if(old.hash!==entity.source.source_hash)errors[entity.id]='brain.source.version-conflict';continue;}
      if(old&&entity.version!==old.version+1){errors[entity.id]='brain.source.version-gap';continue;}
      const sequence=(old?.sequence??0)+1;
      enqueue({event:entityEvent(entity,sequence),version:{version:entity.version,hash:entity.source.source_hash,sequence},attempts:0,error:null});
    }
    for(const record of source.records){
      if(!record.event||cursor.confirmed[String(record.end)]||cursor.pending[record.event.aggregate_id])continue;
      enqueue({event:record.event,end:record.end,attempts:0,error:null});
    }
    // Independent aggregates can confirm out of order; the ledger watermark cannot.
    for(const record of source.records){
      if(record.event&&!cursor.confirmed[String(record.end)])break;
      cursor.offset=record.end;cursor.prefixHash=record.prefixHash;delete cursor.confirmed[String(record.end)];
    }
    atomicJson(file,cursor);
    return {state:Object.keys(errors).length?'unavailable':'ok',received,offset:cursor.offset,partial:source.partial,
      ...(Object.keys(errors).length?{error:'brain.capture.aggregate-blocked',errors}:{})};
  });
}
