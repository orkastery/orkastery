/** Projeção explícita de conteúdo nativo. Segredos nunca saem para o canal HITL. */
import { createHash } from 'node:crypto';
export interface PerguntaNativa {
  id: string; question: string; header: string; isSecret: false; isOther: boolean;
  options: { label: string; description: string }[]; sha256: string;
}
export function projetarPergunta(params: any): PerguntaNativa {
  if (params?.isBlocking !== true) throw new Error('runtime.unavailable: question.nonblocking');
  if (!Array.isArray(params.questions) || params.questions.length !== 1) throw new Error('runtime.unavailable: question.multiple');
  const q = params.questions[0];
  if (q?.isSecret === true) throw new Error('runtime.unavailable: question.secret');
  const texto = (s: unknown, max: number) => typeof s === 'string' && !!s.trim() && s.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(s);
  if (!texto(q?.id, 100) || !texto(q?.question, 2000) || q.header !== undefined && (typeof q.header !== 'string' || q.header.length > 200) ||
      q.isSecret !== undefined && q.isSecret !== false || q.isOther !== undefined && typeof q.isOther !== 'boolean' ||
      q.options != null && (!Array.isArray(q.options) || q.options.length > 12 || q.options.some((o: any) =>
        !texto(o?.label, 200) || !texto(o?.description, 1000) || `${o.label} — ${o.description}`.length > 200))) throw new Error('runtime.unavailable: question.invalid');
  const options = (q.options ?? []).map((o: any) => ({ label: o.label as string, description: o.description as string }));
  if (new Set(options.map((o: { label: string }) => o.label)).size !== options.length) throw new Error('runtime.unavailable: question.invalid');
  // Nenhum spread do runtime: somente os campos que definem a pergunta suportada.
  const content = { id: q.id as string, question: q.question as string, header: (q.header ?? '') as string,
    isSecret: false as const, isOther: q.isOther === true, options };
  return { ...content, sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
}
