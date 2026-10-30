import { DiscoveryOptions, discoverMaestro, MaestroContext } from './maestro-discovery';
import { MaestroSnapshot, SECTION_NAMES, SectionName } from './maestro-contract';
import { maestroSnapshot, SnapshotOptions } from './maestro-snapshot';
import { collectMaestroSources, digest } from './maestro-sources';
import { ActionHost, proposeMaestroActions } from './maestro-actions';
import { nativeForThread } from './maestro-runtime';
import { formatarDataHoraRotulada } from './horario';
import { MAESTRO_PT_BR, TextosDoMaestro } from './locale-maestro';

export function readMaestro(context: MaestroContext, options: Pick<SnapshotOptions,'offsets'|'threadId'> & {host:ActionHost; native?:boolean}): MaestroSnapshot {
  const observations=options.native&&options.threadId?nativeForThread(context.root,options.threadId):[];
  return maestroSnapshot(context,{...options,collect:ctx=>{
    const sources=collectMaestroSources(ctx,{threadId:options.threadId,native:observations});
    if(options.host.child&&sources.sections.portfolio) {
      const ids=new Set((sources.sections.demands?.items??[]).flatMap(d=>d.refs.filter(r=>r.kind==='project').map(r=>r.id)));
      const visible=sources.sections.portfolio.items.filter(p=>ids.has(p.id));
      const parents=new Set(visible.flatMap(p=>p.refs.map(r=>r.id)));
      sources.sections.portfolio.items=sources.sections.portfolio.items.filter(p=>ids.has(p.id)||parents.has(p.id));
      sources.gaps=sources.gaps.filter(g=>!g.startsWith('portfolio.'));
      sources.conflicts=sources.conflicts.filter(c=>!c.startsWith('entity.')||visible.some(p=>c.endsWith(':'+p.id)));
    }
    sources.sections.nextActions=proposeMaestroActions(sources.sections.threads?.items??[],options.host);
    if (sources.sections.threads?.state === 'unavailable') {
      sources.sections.nextActions.state = 'unavailable';
      sources.sections.nextActions.gaps.push('threads.unavailable');
    }
    sources.fingerprint=digest([sources.fingerprint,sources.sections]);return sources;
  }});
}
export function maestroText(snapshot:MaestroSnapshot, textos:TextosDoMaestro=MAESTRO_PT_BR):string {
  const p=snapshot.project;
  return [textos.titulo(p.name),
    // I-35: o snapshot guarda ISO; o texto ao dono diz quando consultou, no fuso dele.
    textos.consulta(formatarDataHoraRotulada(snapshot.observedAt, { agora: snapshot.observedAt })),
    // RM-052: qual cópia foi lida e o que o panorama não lê, antes de qualquer seção.
    textos.projeto(p.name,p.root??'',p.remote===null?textos.semRemoto:p.remote,textos.origem[p.origin]),
    ...(snapshot.notConsulted?.length?[textos.naoLido(snapshot.notConsulted.join(' · '))]:[]),
    ...SECTION_NAMES.map(name=>{
      const s=snapshot.sections[name];return textos.secao(name,s.state,s.coverage.returned,s.coverage.total,!!s.coverage.omitted);
    }),
    ...snapshot.sections.threads.items.slice(0,8).map(t=>textos.thread(t.title,String(t.facts.phase),t.status)),
    textos.recomendacao(snapshot.conflicts.length,snapshot.gaps.length),textos.final,
  ].join('\n');
}
export function runMaestroCli(argv:string[], cwd=process.cwd(), trusted:Omit<DiscoveryOptions,'cwd'>={},
  io={out:(v:string)=>console.log(v),err:(v:string)=>console.error(v)}, textos:TextosDoMaestro=MAESTRO_PT_BR):number {
  if(argv.length===1&&argv[0]==='--help') {
    io.out(textos.help);return 0;
  }
  try {
    let json=false,threadId:string|undefined,section:SectionName|undefined,offset:number|undefined;
    const seen=new Set<string>();
    for(let i=0;i<argv.length;i++) {
      const arg=argv[i];if(seen.has(arg))throw Error('maestro.arguments.invalid');seen.add(arg);
      if(arg==='--json')json=true;
      else if(arg==='--thread') {threadId=argv[++i];if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId??''))throw Error('maestro.arguments.invalid');}
      else if(arg==='--section') {section=argv[++i] as SectionName;if(!SECTION_NAMES.includes(section))throw Error('maestro.arguments.invalid');}
      else if(arg==='--offset') {const raw=argv[++i];if(!/^\d+$/.test(raw??''))throw Error('maestro.arguments.invalid');offset=Number(raw);if(!Number.isSafeInteger(offset))throw Error('maestro.arguments.invalid');}
      else throw Error('maestro.arguments.invalid');
    }
    if((section===undefined)!==(offset===undefined))throw Error('maestro.arguments.invalid');
    const context=discoverMaestro({cwd,...trusted});
    const snapshot=readMaestro(context,{threadId,offsets:section?{[section]:offset!}:undefined,native:true,
      host:{tools:['ork_thread_status','ork_observe','ork_git_status'],child:false}});
    io.out(json?JSON.stringify(snapshot):maestroText(snapshot,textos));return 0;
  } catch(e) {
    const message=(e as Error).message;const code=/^maestro\.[a-z_.]+$/.test(message)?message:'maestro.source.unavailable';
    io.err(JSON.stringify({error:code}));return code==='maestro.arguments.invalid'?2:1;
  }
}
