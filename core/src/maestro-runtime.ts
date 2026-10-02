/** Leitura operacional usa o ledger/recibos; estado nativo desconhecido não é morte. */
import { ConducaoAtual, EventoLedger, Lease, Thread } from './types';
import { z } from 'zod';
import { alvoDoPedido, PedidoHitlQualquer, prazoDoPedido, recomendacaoDoPedido,
  textoDoPedido, validarPedidoHitl, estadoDoPedido } from './hitl-contract';
import { CONTRATO_MASTER_PENDENTE, validarMasterLog, validarMasterPendente } from './master';
import { MaestroReader, SourceSection, item, safeText } from './maestro-sources';
import { SectionName } from './maestro-contract';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { consultarSessoes } from './adapters/claude-bg';
import { controleNativo } from './hitl-sessions';
import { lerThread } from './thread';
import { contextoHitlDosEventos } from './hitl-gates';
import { ehAprovacaoHumana, EVENTOS_QUE_DESTRAVAM } from './ocupacao';
import { ehEnsaio } from './ledger';
import { formatarDataHoraRotulada } from './horario';
import { conducaoDosDados, nomeDaConducao } from './conducao';
import { linhaDeConducao } from './conducao-texto';

/** Valida todos os campos consumidos antes de deduplicar, filtrar ou publicar a fila. */
const retryView = z.object({
  id: z.string().max(160).regex(/^R[1-9]\d*$/),
  thread: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  estado: z.enum(['aguardando', 'retomado', 'escalado', 'cancelado']),
  liberaEm: z.string().max(512).datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v))),
  tentativas: z.number().int().nonnegative().safe(),
});

/** Referências e datas só entram na projeção depois de validar a fonte inteira. */
const leaseView = z.object({
  nome: z.string().min(1).refine(v => v.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(v)),
  thread: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  expiraEm: z.string().max(512).datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v))),
});

/**
 * Recibo de SHIP validado em todos os campos consumidos antes de projetar. Push verificado
 * que contradiz o próprio remoto ou a fonte da prova é recibo inválido, não entrega incompleta.
 */
const shipSha = z.string().regex(/^[a-f0-9]{40}$/);
const shipTs = z.string().max(512).datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)));
const shipView = z.union([
  z.object({
    tipo: z.literal('ship_done'), ts: shipTs, pushVerificado: z.boolean(), mergeSha: shipSha,
    shaRemoto: shipSha.nullable().optional(),
    fonteDaProva: z.string().min(1).max(512).refine(v => !/[\u0000-\u001f\u007f]/.test(v)).nullable().optional(),
  }).refine(s => !s.pushVerificado || (s.shaRemoto === s.mergeSha && typeof s.fonteDaProva === 'string')),
  z.object({ tipo: z.enum(['ship_started', 'ship_blocked']), ts: shipTs }),
]);

export interface NativeObservation { sessionId: string; runtime: string; state?: string; status?: string; reason?: string; }
export function operationalSources(reader: MaestroReader, threads: Thread[], native: readonly NativeObservation[] = [], now = new Date().toISOString(), threadScope?: string): Partial<Record<SectionName, SourceSection>> {
  const names=['sessions','blockers','leases','retries','hitl','ship','master'] as const;
  const sections={} as Record<typeof names[number],SourceSection>;
  for(const name of names)sections[name]={source:`ork.${name}`,items:[],gaps:[]};
  // I-35: fato local absoluto e rotulado ao lado do ISO, nunca relativo (o fingerprint conta).
  const local=(iso:string)=>formatarDataHoraRotulada(iso,{agora:now});
  for(const t of threads) {
    const refs=[{kind:'thread',id:t.id}];
    let events:EventoLedger[];
    try {
      const raw=reader.read(`.orkastery/threads/${t.id}/ledger.jsonl`);
      if(raw===null)throw Error('missing');
      events=raw.split('\n').filter(Boolean).map(line=>JSON.parse(line));
      if(events.some(e=>typeof e.tipo!=='string'||e.thread!==t.id))throw Error('invalid');
      // Fatia 2 do ensaio da 0.5.0 (P2): o ensaio (`dryRun: true`) nao vira bloqueio nem entrega incompleta.
      events=events.filter(e=>!ehEnsaio(e));
    } catch {
      for(const name of names.filter(n=>!['leases','retries'].includes(n))) sections[name].gaps.push(`ledger.unavailable:${t.id}`);
      continue;
    }
    // I-36 (T17): quem conduz, pela mesma leitura das outras superficies. O leitor confinado nao sonda
    // processo: conducao de processo vale ate o lease sair, como nas demais telas sem prova de morte.
    let conducao:ConducaoAtual|null=null;
    try {conducao=conducaoDosDados(reader.json<Lease>(`.orkastery/leases/${encodeURIComponent(nomeDaConducao(t.id))}.json`),events,{agora:new Date(now)});}
    catch {sections.sessions.gaps.push(`conducao.unavailable:${t.id}`);}
    const linhaDaConducao=conducao?linhaDeConducao(conducao,{agora:now}):null;
    if(conducao&&!t.sessoes.some(s=>s.sessionId===conducao!.sessao))
      sections.sessions.items.push(item(`conducao:${t.id}`,'Conducao em andamento','active',refs,{conduction:safeText(linhaDaConducao)}));
    for(const s of t.sessoes) {
      const observed=native.filter(n=>n.sessionId===s.sessionId&&n.runtime===(s.runtime??'claude-bg'));
      const n=observed.length===1?observed[0]:undefined;
      const divergence=!!n?.state&&!!n.status&&n.state!==n.status;
      const phaseResult=events.some(e=>e.tipo==='phase_result'&&e.sessionId===s.sessionId&&e.fase===s.fase);
      const terminal=['done','completed','exited','stopped'].includes(n?.state??n?.status??'');
      sections.sessions.items.push(item(s.sessionId,`${s.runtime??'claude-bg'} · ${s.fase}`,divergence?'conflict':n?.state??n?.status??'unknown',refs,
        {runtime:s.runtime??'claude-bg',phase:s.fase,nativeConfirmed:!!n&&!n.reason,phaseResult,
          ...(conducao&&conducao.sessao===s.sessionId?{conduction:safeText(linhaDaConducao)}:{}),
          reason:safeText(divergence?'runtime.state_conflict':n?.reason??(!n?'runtime.unavailable':terminal&&!phaseResult?'phase.result_missing':''))}));
    }
    const lastGate=events.filter(e=>e.tipo==='gate_blocked'||
      EVENTOS_QUE_DESTRAVAM.includes(e.tipo)||ehAprovacaoHumana(e)).at(-1);
    if(lastGate?.tipo==='gate_blocked')sections.blockers.items.push(item(`gate:${t.id}`,lastGate.motivo,'blocked',refs,{reason:safeText(lastGate.motivo)}));
    const currentHitlContext = contextoHitlDosEventos(t, events);
    for(const e of events.filter(e=>e.tipo==='hitl_requested')) {
      try {
        validarPedidoHitl(e.pedido);const p=e.pedido as PedidoHitlQualquer;
        if(p.thread!==t.id)throw Error('scope');
        const answered=events.some(r=>['human_gate','session_answered'].includes(r.tipo)&&r.pedidoId===p.id);
        if(answered)continue;
        const sending=events.some(r=>r.tipo==='session_answer_sending'&&r.pedidoId===p.id);
        const stale = e.contexto !== currentHitlContext;
        const prazo=prazoDoPedido(p)??'';
        sections.hitl.items.push(item(p.id,textoDoPedido(p),stale?'stale':sending?'delivery.uncertain':estadoDoPedido(p,now),refs,
          {deadline:prazo,deadlineLocal:local(prazo),target:alvoDoPedido(p)?.tipo??'decidido',recommendation:safeText(recomendacaoDoPedido(p)),
            deliveryUncertain:sending,reason:stale?'hitl.context.stale':''}));
      } catch {sections.hitl.gaps.push(`hitl.invalid:${t.id}`);}
    }
    const lastShip=events.filter(e=>['ship_done','ship_started','ship_blocked'].includes(e.tipo)).at(-1);
    if(lastShip) {
      const ship=shipView.safeParse(lastShip);
      if(!ship.success)sections.ship.gaps.push(`ship.invalid:${t.id}`);
      else {
        const done=ship.data.tipo==='ship_done'?ship.data:null,proven=done?.pushVerificado===true;
        sections.ship.items.push(item(`ship:${t.id}`,'Entrega',proven?'delivered':'incomplete',refs,
          {pushVerified:proven,mergeSha:done?.mergeSha??null,receiptAt:ship.data.ts,receiptAtLocal:local(ship.data.ts)}));
      }
    }
    try {
      const receipt=reader.json<Record<string,unknown>>(`.orkastery/threads/${t.id}/master-log.json`);
      if(receipt) {
        const pending = receipt.contrato === CONTRATO_MASTER_PENDENTE;
        if((pending ? validarMasterPendente(receipt) : validarMasterLog(receipt)).length||receipt.thread!==t.id)throw Error('invalid');
        sections.master.items.push(item(`master:${t.id}`,pending?'Ratificação humana pendente':'MASTER',pending?'ratificacao-pendente':'recorded',refs,
          {score:pending?null:typeof receipt.score==='number'?receipt.score:null}));
      } else if(lastShip || t.faseAtual==='MASTER')sections.master.items.push(item(`master:${t.id}`,'Score humano pendente','pending',refs,{score:null}));
    } catch {sections.master.gaps.push(`master.invalid:${t.id}`);}
  }
  try {
    const leases=reader.list('.orkastery/leases').filter(f=>f.endsWith('.json')&&f!=='fila.json')
      .map(file=>leaseView.parse(reader.json<unknown>(`.orkastery/leases/${file}`)));
    sections.leases.items=leases.filter(lease=>!threadScope||lease.thread===threadScope)
      .map(lease=>item(lease.nome.slice(0,160),'Região reservada',Date.parse(lease.expiraEm)<=Date.parse(now)?'expired':'active',
        [{kind:'thread',id:lease.thread}],{expiresAt:lease.expiraEm,expiresAtLocal:local(lease.expiraEm)}));
  } catch {sections.leases.state='unavailable';sections.leases.gaps.push('leases.unavailable');}
  try {
    const raw=reader.read('.orkastery/retry/fila.jsonl')??'';
    const queue=new Map<string,z.infer<typeof retryView>>();
    for(const line of raw.split('\n').filter(Boolean)) {
      const retry=retryView.parse(JSON.parse(line));queue.set(retry.id,retry);
    }
    sections.retries.items=[...queue.values()].filter(retry=>!threadScope||retry.thread===threadScope)
      .map(retry=>item(retry.id,'Retomada',retry.estado==='aguardando'&&Date.parse(retry.liberaEm)<=Date.parse(now)?'due':retry.estado,
        [{kind:'thread',id:retry.thread}],{availableAt:retry.liberaEm,availableAtLocal:local(retry.liberaEm),attempts:retry.tentativas}));
  } catch {sections.retries.state='unavailable';sections.retries.gaps.push('retries.unavailable');}
  for(const section of Object.values(sections)) if(section.gaps.length) section.state='unavailable';
  return sections;
}

/** Detalhe nativo isolado do event loop, com deadline efetivo inclusive para CLI síncrono. */
export function nativeForThread(root: string, threadId: string): readonly NativeObservation[] {
  if(!path.isAbsolute(root)||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(threadId))throw Error('maestro.project.scope');
  const result=spawnSync(process.execPath,[__filename,'--native',root,threadId],{
    encoding:'utf8',timeout:2000,killSignal:'SIGKILL',maxBuffer:1048576,
    env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},});
  if(result.status!==0||result.error)return [];
  try {const list=JSON.parse(result.stdout);return Array.isArray(list)?list:[];} catch {return [];}
}
if(require.main===module&&process.argv[2]==='--native') {
  try {
    const root=process.argv[3],id=process.argv[4],t=lerThread(root,id),cwd=path.resolve(t.worktree??root);
    const result:NativeObservation[]=[];
    const claude=t.sessoes.some(s=>s.runtime==='claude-bg')?consultarSessoes(cwd,true):null;
    for(const s of t.sessoes) {
      try {
        if(s.runtime==='claude-bg') {
          const matches=claude?.sessoes.filter(n=>n.sessionId===s.sessionId&&n.cwd===cwd)??[];
          if(claude?.ok&&matches.length===1) result.push({sessionId:s.sessionId,runtime:s.runtime,state:matches[0].state,status:matches[0].status});
        } else if(s.runtime==='codex') {
          const obs=controleNativo(s.runtime,root,id,s.sessionId).consultar();
          const matches=obs.sessoes.filter(n=>n.sessionId===s.sessionId&&n.cwd===cwd);
          if(obs.ok&&matches.length===1)result.push({sessionId:s.sessionId,runtime:s.runtime,state:matches[0].estado});
        }
      } catch {result.push({sessionId:s.sessionId,runtime:s.runtime??'claude-bg',reason:'runtime.unavailable'});}
    }
    process.stdout.write(JSON.stringify(result));
  } catch {process.exitCode=1;}
}

/** Deadline cancela a consulta; nunca transforma indisponibilidade em sessão encerrada. */
export async function observeWithDeadline(read: (signal: AbortSignal) => Promise<readonly NativeObservation[]>, timeoutMs = 2000): Promise<readonly NativeObservation[]> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const duration=Number.isFinite(timeoutMs)?Math.min(2000,Math.max(1,timeoutMs)):2000;
  try {return await Promise.race([new Promise<readonly NativeObservation[]>(resolve=>{
    timer=setTimeout(()=>{controller.abort();resolve([]);},duration);
  }),Promise.resolve().then(()=>read(controller.signal))]);} catch {return [];} finally {clearTimeout(timer!);controller.abort();}
}
