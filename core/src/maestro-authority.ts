/** Independência vem do despacho persistido, nunca do nome do runtime ou do relato. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { dirThread, lerThread } from './thread';
import { lerLedger } from './ledger';

export interface SessionReference { threadId: string; sessionId: string; worktree: string }
export interface SessionReviewBinding {
  conductor: SessionReference;
  executor: SessionReference;
  reviewer: SessionReference;
}
export interface SessionReviewEvidence extends SessionReviewBinding {
  schema: 'ork.session-review/v1';
  runtime: string;
  dispatchEvents: string[];
  reviewResultEvent?: string;
  executionEvent?: string;
  envelope?: ReviewEnvelope;
  envelopeApprovalEvent?: string;
}
/** Recebido do objetivo canônico, nunca dos seletores enviados pelo agente. */
export interface ReviewEnvelope { objectiveId: string; hash: string; version: number; approvedAt: string }

/** Stop do Claude prova fim de turno, não um resultado CHECK autenticado. */
export function requireSessionReviewRuntime(runtime: string): void {
  if (runtime !== 'codex') throw Error('maestro.authority.runtime-unsupported: independence=sessions exige revisor codex; ' +
    `runtime ${runtime} ainda não fornece recibo autenticado de conclusão CHECK`);
}

const referenceSchema = z.object({
  threadId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  sessionId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9._-]+$/),
  worktree: z.string().min(1).max(4096).refine(path.isAbsolute),
}).strict();
export function parseSessionReviewBinding(input: unknown): SessionReviewBinding {
  const result = z.object({ conductor: referenceSchema, executor: referenceSchema, reviewer: referenceSchema }).strict().safeParse(input);
  if (!result.success) throw Error('maestro.authority.binding');
  return result.data;
}

/** Todos os caminhos são derivados da thread; referências recebidas são apenas seletores. */
export function verifySessionReview(root: string, binding: SessionReviewBinding): SessionReviewEvidence {
  if (!binding || !binding.conductor || !binding.executor || !binding.reviewer)
    throw Error('maestro.authority.unproven');
  binding = parseSessionReviewBinding(binding);
  const refs = [binding.conductor, binding.executor, binding.reviewer];
  if (new Set(refs.map(r => r.sessionId)).size !== 3) throw Error('maestro.authority.self-review');
  const allowedPhases = [['GOAL', 'PLAN'], ['GO'], ['CHECK']];
  const records = refs.map((ref, index) => {
    const thread = lerThread(root, ref.threadId);
    if (!thread.worktree || !path.isAbsolute(ref.worktree) || thread.worktree !== ref.worktree ||
        fs.realpathSync(ref.worktree) !== ref.worktree) throw Error('maestro.authority.scope');
    const matches = thread.sessoes.filter(s => s.sessionId === ref.sessionId);
    if (matches.length !== 1) throw Error('maestro.authority.unproven');
    const session = matches[0];
    if (!session?.verificada || !session.runtime || !allowedPhases[index].includes(session.fase))
      throw Error('maestro.authority.unproven');
    const events = lerLedger(dirThread(root, thread.id));
    const dispatch = events.filter(e => e.tipo === 'phase_dispatch' && e.sessionId === session.sessionId).at(-1);
    if (!dispatch || !(
      dispatch.fase === session.fase && dispatch.runtime === session.runtime && dispatch.cwd === ref.worktree &&
      dispatch.promptSha256 === session.promptSha256 && dispatch.slug === session.slug)) throw Error('maestro.authority.unproven');
    const verified = events.find(e => e.tipo === 'phase_dispatch_verified' && e.sessionId === session.sessionId &&
      e.slug === session.slug && e.encontrada === true && typeof e.fonte === 'string' && e.fonte.length > 0);
    if (!session.promptPath) throw Error('maestro.authority.unproven');
    const prompt = path.resolve(root, session.promptPath);
    const scope = fs.realpathSync(dirThread(root, thread.id)) + path.sep;
    if (!dispatch?.eventId || !verified?.eventId || !fs.realpathSync(prompt).startsWith(scope) ||
        createHash('sha256').update(fs.readFileSync(prompt)).digest('hex') !== session.promptSha256)
      throw Error('maestro.authority.unproven');
    return { session, dispatch, verified };
  });
  if (binding.executor.threadId !== binding.reviewer.threadId ||
      binding.executor.worktree !== binding.reviewer.worktree) throw Error('maestro.authority.scope');
  return { ...binding, schema: 'ork.session-review/v1', runtime: records[2].session.runtime!,
    dispatchEvents: records.flatMap(r => [String(r.dispatch.eventId), String(r.verified.eventId)]) };
}

/** Despachar CHECK não equivale a concluí-lo. Só o resultado observado pelo núcleo conta. */
export function verifyCompletedSessionReview(root: string, binding: SessionReviewBinding, envelope?: ReviewEnvelope,
  verdict: 'approved' | 'rejected' = 'approved'): SessionReviewEvidence {
  const proof = verifySessionReview(root, binding);
  const thread = lerThread(root, proof.reviewer.threadId);
  const session = thread.sessoes.find(s => s.sessionId === proof.reviewer.sessionId)!;
  requireSessionReviewRuntime(session.runtime!);
  const events = lerLedger(dirThread(root, thread.id));
  const executor = thread.sessoes.filter(s => s.fase === 'GO').at(-1);
  const executionIndex = events.findIndex(e => e.eventId === proof.dispatchEvents[2]);
  const reviewIndex = events.findIndex(e => e.eventId === proof.dispatchEvents[4]);
  const executionTime = Date.parse(executor?.despachadaEm ?? '');
  const reviewTime = Date.parse(session.despachadaEm ?? '');
  // CHECK antigo não pode validar GO novo, mesmo na mesma thread/worktree.
  if (executor?.sessionId !== proof.executor.sessionId || executionIndex < 0 || reviewIndex <= executionIndex ||
      !Number.isFinite(executionTime) || !Number.isFinite(reviewTime) || reviewTime < executionTime ||
      events.slice(executionIndex + 1).some(e => e.tipo === 'phase_dispatch' && e.fase === 'GO'))
    throw Error('maestro.authority.review-stale');
  const approval = envelope ? events.filter(e => e.tipo === 'objective_envelope_approved' && e.objectiveId === envelope.objectiveId).at(-1) : undefined;
  if (envelope && (!approval?.eventId || approval.envelopeHash !== envelope.hash || approval.version !== envelope.version ||
      approval.approvedAt !== envelope.approvedAt || events.indexOf(approval) >= executionIndex ||
      !/^[a-f0-9]{64}$/.test(envelope.hash) || !Number.isSafeInteger(envelope.version) || envelope.version < 1 ||
      !Number.isFinite(Date.parse(envelope.approvedAt)) || executionTime < Date.parse(envelope.approvedAt) ||
      Date.parse(events[executionIndex].ts) < Date.parse(envelope.approvedAt)))
    throw Error('maestro.authority.envelope-stale');
  const result = events.filter(e => e.tipo === 'phase_result' && e.sessionId === session.sessionId).at(-1);
  const completed = result?.classificacao === 'fase_concluida' && result.ok === true;
  // Falha de qualidade pode concluir CHECK com parecer negativo. Transporte interrompido,
  // espera humana e precondições ausentes não são revisão, mesmo com verdict=rejected.
  // Política sem retry (ci.failed) preserva o bloqueio, mas não equivale a fase concluída:
  // todo parecer negativo exige o terminal nativo do controller correlacionado pelo watcher.
  const rejected = verdict === 'rejected' && result?.classificacao === 'gate_blocked' && result.ok === false &&
    ['claims.failed', 'claims.unverifiable', 'verify.regression', 'verify.failed', 'ci.failed'].includes(String(result.motivo)) &&
    result.conclusaoNativa === true && result.conclusaoNativaAusente === null &&
    result.exitCode === 0 && result.signal === null &&
    result.exitCodeFonte === 'controller.close' && result.fonteVencedora === 'rollout';
  if (typeof result?.eventId !== 'string' || !result.eventId || result.fase !== 'CHECK' || result.runtime !== session.runtime ||
      result.despachoEm !== session.despachadaEm || result.origem !== 'sessions.watch' ||
      (!completed && !rejected) ||
      typeof result.sensorResultId !== 'string' || !result.sensorResultId ||
      typeof session.despachadaEm !== 'string' || !Number.isFinite(Date.parse(session.despachadaEm)) ||
      !Number.isFinite(Date.parse(result.ts)) || Date.parse(result.ts) < Date.parse(session.despachadaEm))
    throw Error('maestro.authority.review-incomplete');
  if (events.indexOf(result) <= reviewIndex) throw Error('maestro.authority.review-stale');
  return { ...proof, executionEvent: String(events[executionIndex].eventId), reviewResultEvent: result.eventId,
    ...(envelope ? { envelope: { ...envelope }, envelopeApprovalEvent: String(approval!.eventId) } : {}) };
}
