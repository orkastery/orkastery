import { DiscoveryOptions, discoverMaestro, MaestroContext } from './maestro-discovery';
import { MaestroSnapshot, SECTION_NAMES, SectionName } from './maestro-contract';
import { maestroSnapshot, SnapshotOptions } from './maestro-snapshot';
import { collectMaestroSources, digest } from './maestro-sources';
import { ActionHost, proposeMaestroActions } from './maestro-actions';
import { nativeForThread } from './maestro-runtime';
import { formatarDataHoraRotulada } from './horario';

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
export function maestroText(snapshot:MaestroSnapshot):string {
  return [`${snapshot.project.name} · panorama Maestro`,
    // I-35: o snapshot guarda ISO; o texto ao dono diz quando consultou, no fuso dele.
    `• Consulta: ${formatarDataHoraRotulada(snapshot.observedAt, { agora: snapshot.observedAt })}`,
    ...SECTION_NAMES.map(name=>{
      const s=snapshot.sections[name];return `• ${name}: ${s.state} · ${s.coverage.returned}/${s.coverage.total??'?'}${s.coverage.omitted?' · mais itens disponíveis':''}`;
    }),
    ...snapshot.sections.threads.items.slice(0,8).map(t=>`  ${t.title}: ${t.facts.phase} · ${t.status}`),
    `• Recomendo: ${snapshot.conflicts.length?'reler as fontes em conflito':snapshot.gaps.length?'conferir as lacunas antes de agir':'escolher uma thread para ver o detalhe'}.`,
    'Use ork maestro --json para cobertura e ações; --thread ID consulta o detalhe nativo.',
  ].join('\n');
}
export function runMaestroCli(argv:string[], cwd=process.cwd(), trusted:Omit<DiscoveryOptions,'cwd'>={}, io={out:(v:string)=>console.log(v),err:(v:string)=>console.error(v)}):number {
  if(argv.length===1&&argv[0]==='--help') {
    io.out('ork maestro [--json] [--thread ID] [--section NOME --offset N]\nConsulta sem criar ou despachar trabalho. Na conversa, diga: orkastery maestro.');return 0;
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
    io.out(json?JSON.stringify(snapshot):maestroText(snapshot));return 0;
  } catch(e) {
    const message=(e as Error).message;const code=/^maestro\.[a-z_.]+$/.test(message)?message:'maestro.source.unavailable';
    io.err(JSON.stringify({error:code}));return code==='maestro.arguments.invalid'?2:1;
  }
}
