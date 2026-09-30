import { MAESTRO_LIMITS, MAESTRO_SCHEMA, SECTION_NAMES, SectionName, MaestroSnapshot, MaestroSection, validateMaestroSnapshot } from './maestro-contract';
import { MaestroContext, revalidateMaestroContext } from './maestro-discovery';
import { collectMaestroSources, MaestroSources, digest, safeText } from './maestro-sources';
import type { MaestroItem } from './maestro-contract';

export interface SnapshotOptions { threadId?: string; offsets?: Partial<Record<SectionName, number>>;
  collect?: (context: MaestroContext) => MaestroSources; clock?: () => number; }
/** Defesa final para TODOS os campos públicos, inclusive facts e identificadores. */
function publicItem(raw: MaestroItem): MaestroItem {
  const identity = (v: string) => safeText(v) === v && v.length <= 160 ? v : `redacted:${digest(v)}`;
  const clean: MaestroItem = { id: identity(raw.id), title: safeText(raw.title), status: safeText(raw.status),
    refs: raw.refs.slice(0,16).map(r => ({ kind: identity(r.kind), id: identity(r.id) })),
    facts: Object.fromEntries(Object.entries(raw.facts).filter(([k]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)).slice(0,24)
      .map(([k,v]) => [k, /password|senha|secret|token|authorization|api_?key/i.test(k) ? '[redigido]' : typeof v === 'string' ? safeText(v) : v])),
    ...(raw.action ? { action: { ...raw.action, reason: safeText(raw.action.reason),
      preconditions: raw.action.preconditions.slice(0,10).map(safeText), readback: safeText(raw.action.readback) } } : {}) };
  if (JSON.stringify(raw) !== JSON.stringify(clean)) {
    if (clean.action) clean.action = { ...clean.action, available: false, reason: 'maestro.source.redacted_identity' };
  }
  if (Buffer.byteLength(JSON.stringify(clean)) > 2048) return { ...clean, title: clean.title.slice(0,160),
    refs: [], facts: { reason: 'maestro.item.limit' },
    ...(clean.action ? { action: { ...clean.action, available: false, reason: 'maestro.item.limit', preconditions: [], readback: '' } } : {}) };
  return clean;
}
function publicMessages(values: string[], limit: number): string[] {
  return [...values.slice(0,limit).map(safeText), ...(values.length>limit ? [`maestro.messages.omitted:${values.length-limit}`] : [])];
}
export function maestroSnapshot(context: MaestroContext, options: SnapshotOptions = {}): MaestroSnapshot {
  const clock = options.clock ?? Date.now, started = clock();
  revalidateMaestroContext(context);
  const collect=options.collect??(ctx=>collectMaestroSources(ctx,options));
  let sources=collect(context), stable=sources.unchanged();
  if(!stable && clock() - started < MAESTRO_LIMITS.totalMs){sources=collect(context);stable=sources.unchanged();}
  const timedOut = clock() - started >= MAESTRO_LIMITS.totalMs;
  if (timedOut) sources = { ...sources, sections: {}, gaps: ['maestro.snapshot.timeout'], conflicts: [] };
  const observedAt=new Date().toISOString(),sections={} as MaestroSnapshot['sections'];
  for(const name of SECTION_NAMES) {
    const src=sources.sections[name], all=[...(src?.items??[])].sort((a,b)=>a.id.localeCompare(b.id));
    const requested=options.offsets?.[name]??0;
    if(!Number.isSafeInteger(requested)||requested<0)throw Error('maestro.page.invalid');
    const offset=Math.min(requested,all.length), items=all.slice(offset,offset+50).map(publicItem), omitted=all.length-offset-items.length;
    const unavailable=!src||src.state==='unavailable';
    const state:MaestroSection['state']=timedOut?'unavailable':!stable?'conflict':unavailable?'unavailable':src.state??(all.length?'available':'empty');
    sections[name]={state,source:safeText(src?.source??name).slice(0,160),observedAt,fingerprint:src?digest(src):null,
      coverage:{total:unavailable?null:all.length,offset,returned:items.length,omitted:unavailable?null:omitted,
        nextOffset:omitted?offset+items.length:null,limit:50},items,gaps:publicMessages(src?.gaps??['maestro.source.unavailable'],4)};
  }
  // RM-052: raiz e remoto passam pela mesma redacao dos demais campos publicos.
  const {root,remote}=context.project;
  const result:MaestroSnapshot={schema:MAESTRO_SCHEMA,observedAt,fingerprint:digest([context.fingerprint,sources.fingerprint]),
    project:{...context.project,name:safeText(context.project.name),...(root===undefined?{}:{root:safeText(root)}),
      ...(remote===undefined?{}:{remote:remote===null?null:safeText(remote)})},limits:MAESTRO_LIMITS,sections,gaps:publicMessages(sources.gaps,12),
    conflicts:publicMessages([...sources.conflicts,...(!stable?['maestro.snapshot.stale']:[])],12),
    ...(context.notConsulted?{notConsulted:publicMessages(context.notConsulted,19)}:{})};
  // Orçamento incremental; mantém um item por seção para nextOffset avançar.
  const sizes=new Map(Object.values(sections).map(s=>[s,Buffer.byteLength(JSON.stringify(s))]));
  let bytes=Buffer.byteLength(JSON.stringify(result));
  while(bytes>MAESTRO_LIMITS.bytes) {
    const section=Object.values(sections).filter(s=>s.items.length>1).sort((a,b)=>sizes.get(b)!-sizes.get(a)!)[0];
    if(!section)throw Error('maestro.snapshot.size');
    section.items.pop();section.coverage.returned=section.items.length;
    if(section.coverage.omitted!==null)section.coverage.omitted++;
    section.coverage.nextOffset=section.items.length?section.coverage.offset+section.items.length:null;
    if(!section.gaps.includes('maestro.page.byte_limit'))section.gaps.push('maestro.page.byte_limit');
    const size=Buffer.byteLength(JSON.stringify(section));bytes+=size-sizes.get(section)!;sizes.set(section,size);
  }
  // Inclui projeção e serialização no prazo total; vence sem ações utilizáveis.
  if(clock()-started>=MAESTRO_LIMITS.totalMs) {
    result.gaps=['maestro.snapshot.timeout'];
    for(const section of Object.values(sections)) {
      section.state='unavailable';section.items=[];
      section.coverage={total:null,offset:0,returned:0,omitted:null,nextOffset:null,limit:50};
    }
  }
  revalidateMaestroContext(context);
  return validateMaestroSnapshot(result);
}
