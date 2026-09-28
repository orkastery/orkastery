/** Projeções das fontes canônicas. Nunca cria estado nem usa títulos como vínculo. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Thread } from './types';
import { Objective } from './objective';
import { Portfolio } from './portfolio';
import { redigirSegredos } from './hitl';
import { MaestroContext, revalidateMaestroContext } from './maestro-discovery';
import { MaestroItem, MaestroSection, SectionName } from './maestro-contract';
import { operationalSources, NativeObservation } from './maestro-runtime';

export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const safeText = (value: unknown): string => redigirSegredos(String(value ?? ''))
  .replace(/\/(?:home|tmp|etc|root)\/[^\s]+/g, '[caminho privado]').slice(0, 512);
export const item = (id: string, title: unknown, status: unknown, refs: MaestroItem['refs'] = [], facts: MaestroItem['facts'] = {}): MaestroItem =>
  ({ id, title: safeText(title), status: safeText(status), refs: refs.slice(0, 16), facts });
export interface SourceSection { source: string; items: MaestroItem[]; gaps: string[]; state?: MaestroSection['state']; }
export interface MaestroSources {
  sections: Partial<Record<SectionName, SourceSection>>; fingerprint: string;
  gaps: string[]; conflicts: string[]; unchanged: () => boolean;
}
/** Bounded, regular, physical files only. Re-check tracks missing files and directories too. */
export class MaestroReader {
  private versions = new Map<string, string>();
  private bytes = 0;
  private start = Date.now();
  constructor(readonly root: string) {}
  private inspect(relative: string, file: boolean): string {
    if (Date.now() - this.start > 2000) throw Error('maestro.source.timeout');
    if (path.isAbsolute(relative) || relative.split('/').some(x => x === '..' || x === '.')) throw Error('maestro.project.scope');
    const name = path.join(this.root, relative);
    let cursor = this.root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      const s = fs.lstatSync(cursor, { throwIfNoEntry: false });
      if (s?.isSymbolicLink()) throw Error('maestro.project.scope');
    }
    if (!fs.existsSync(name)) return 'missing';
    const stat = fs.statSync(name);
    if (file ? !stat.isFile() || stat.size > 1048576 : !stat.isDirectory()) throw Error('maestro.source.invalid');
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }
  list(relative: string): string[] {
    const version = this.inspect(relative, false); this.versions.set(relative + '/', version);
    if (version === 'missing') return [];
    const names = fs.readdirSync(path.join(this.root, relative)).sort();
    if (names.length > 10000) throw Error('maestro.source.limit');
    return names;
  }
  read(relative: string): string | null {
    const version = this.inspect(relative, true); this.versions.set(relative, version);
    if (version === 'missing') return null;
    const fd = fs.openSync(path.join(this.root, relative), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const s=fs.fstatSync(fd);
      if(!s.isFile() || s.size>1048576 || (this.bytes += s.size)>33554432) throw Error('maestro.source.limit');
      const bytes=Buffer.alloc(s.size + 1), count=fs.readSync(fd,bytes,0,bytes.length,0);
      if(count>s.size || this.inspect(relative,true)!==version) throw Error('maestro.snapshot.stale');
      return bytes.subarray(0,count).toString('utf8');
    } finally {fs.closeSync(fd);}
  }
  json<T>(relative: string): T | null { const text=this.read(relative);return text===null?null:JSON.parse(text) as T; }
  fingerprint(): string { return digest([...this.versions].sort()); }
  unchanged(): boolean {
    try {return [...this.versions].every(([file,version])=>this.inspect(file.replace(/\/$/,''),!file.endsWith('/'))===version);}
    catch {return false;}
  }
}
const validId = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(s);
// Validar os campos consumidos antes de publicar um valor para outras fontes.
const sourceId = z.string().refine(validId);
const entityView = z.object({ id: sourceId, title: z.string(), status: z.string() });
const portfolioView = z.object({ schema: z.literal('ork.portfolio/v1'),
  products: z.array(entityView.extend({ kind: z.literal('product') })),
  projects: z.array(entityView.extend({ kind: z.literal('project'), productId: sourceId })),
  initiatives: z.array(entityView.extend({ kind: z.literal('initiative'), projectId: sourceId })),
});
const objectiveView = z.object({ schema: z.literal('ork.objective/v1'), id: sourceId,
  title: z.string(), status: z.string(), threads: z.array(z.object({ id: sourceId })),
  envelope: z.object({ schema: z.literal('ork.objective-envelope/v1'), hash: z.string().regex(/^[a-f0-9]{64}$/),
    portfolio: z.object({ productId: sourceId, projectId: sourceId, initiativeIds: z.array(sourceId) }).nullable() }),
});
const threadView = z.object({ id: sourceId, nome: z.string(), status: z.string(), faseAtual: z.string(), modo: z.string(),
  sessoes: z.array(z.object({ sessionId: sourceId, fase: z.string(), runtime: z.string().optional() })),
  blocos: z.array(z.object({ fases: z.array(z.string()), slugFases: z.string() })),
});
export function collectMaestroSources(context: MaestroContext, options: { threadId?: string; native?: readonly NativeObservation[] } = {}): MaestroSources {
  revalidateMaestroContext(context);
  const reader=new MaestroReader(context.root), sections: MaestroSources['sections']={}, gaps:string[]=[], conflicts:string[]=[];
  const source=(name:SectionName, reference:string, read:()=>MaestroItem[])=>{
    try {sections[name]={source:reference,items:read(),gaps:[]};}
    catch {sections[name]={source:reference,items:[],gaps:['maestro.source.unavailable'],state:'unavailable'};}
  };
  let objectives:Objective[]=[], threads:Thread[]=[];
  source('portfolio','ork.portfolio/v1',()=>{
    const portfolio=reader.json<Portfolio>('.orkastery/portfolio.json');
    if(!portfolio || !portfolioView.safeParse(portfolio).success)throw Error('unavailable');
    return [...portfolio.products,...portfolio.projects,...portfolio.initiatives].map(p=>item(p.id,p.title,p.status,
      'productId' in p?[{kind:'product',id:p.productId}]:'projectId' in p?[{kind:'project',id:p.projectId}]:[],
      {kind:p.kind,deliveryProven:false,origin:'creationOperationId' in p && p.creationOperationId?'creation.operation':'legacy'}));
  });
  source('demands','ork.objective/v1',()=>{
    let loaded=reader.list('.orkastery/objectives').map(id=>{
      if(!validId(id))throw Error('invalid');
      const value=reader.json<Objective>(`.orkastery/objectives/${id}/objective.json`);
      if(!value || value.id!==id || !objectiveView.safeParse(value).success)throw Error('invalid');
      return value;
    });
    if(options.threadId) loaded=loaded.filter(o=>o.threads.some(t=>t.id===options.threadId));
    const items=loaded.map(o=>{
      const p=o.envelope.portfolio;
      return item(o.id,o.title,o.status,[...(p?[{kind:'product',id:p.productId},{kind:'project',id:p.projectId},
        ...p.initiativeIds.map(id=>({kind:'initiative',id}))]:[]),...o.threads.map(t=>({kind:'thread',id:t.id}))],
        {threadCount:o.threads.length,envelopeHash:o.envelope.hash});
    });
    objectives=loaded;
    for(const o of loaded) if(!o.threads.length)gaps.push(`demand.without_thread:${o.id}`);
    return items;
  });
  source('threads','ork.thread',()=>{
    const ids=options.threadId?[options.threadId]:reader.list('.orkastery/threads');
    const loaded=ids.map(id=>{
      if(!validId(id))throw Error('invalid');
      const t=reader.json<Thread>(`.orkastery/threads/${id}/thread.json`);
      if(!t || t.id!==id || !threadView.safeParse(t).success)throw Error('invalid');return t;
    });
    const items=loaded.map(t=>{
      const matches=objectives.filter(o=>o.threads.some(v=>v.id===t.id));
      return item(t.id,t.nome,t.status,matches.map(o=>({kind:'objective',id:o.id})),
        {phase:t.faseAtual,mode:t.modo,sessionCount:t.sessoes.length,block:t.blocos.find(b=>b.fases.includes(t.faseAtual))?.slugFases??null});
    });
    threads=loaded;
    if(sections.demands?.state!=='unavailable') for(const t of loaded) {
      if(!objectives.some(o=>o.threads.some(v=>v.id===t.id)))gaps.push(`thread.without_objective:${t.id}`);
    }
    return items;
  });
  if(sections.demands?.state==='unavailable') {
    sections.threads?.gaps.push('demands.unavailable');
    sections.portfolio?.gaps.push('demands.unavailable');
  }
  for(const p of sections.demands?.state==='unavailable'?[]:sections.portfolio?.items??[]) {
    const matches=objectives.filter(o=>o.envelope.portfolio && (o.envelope.portfolio.productId===p.id ||
      o.envelope.portfolio.projectId===p.id || o.envelope.portfolio.initiativeIds.includes(p.id)));
    if(!matches.length)gaps.push(`portfolio.without_demand:${p.id}`);
    if(p.status==='delivered' && matches.some(o=>['running','paused','awaiting_approval'].includes(o.status)))conflicts.push(`entity.delivered_cycle_open:${p.id}`);
  }
  Object.assign(sections,operationalSources(reader,threads,options.native,undefined,options.threadId));
  if (sections.threads?.state === 'unavailable') {
    for (const name of ['sessions', 'blockers', 'hitl', 'ship', 'master'] as const) {
      const section = sections[name]!;
      section.state = 'unavailable';
      section.gaps.push('threads.unavailable');
    }
  }
  return {sections,fingerprint:reader.fingerprint(),gaps,conflicts,unchanged:()=>reader.unchanged()};
}
