/** Ingresso v3 exclusivo do callback do host. Nunca exposto como tool do modelo. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/^[^\u0000-\u001f]+$/);
export const nativeBindingSchema = z.object({
  host: z.enum(['hermes', 'openclaw']), installationId: id, connectionId: id,
  sessionId: id, accountId: id, channelId: id, conversationId: id, personId: id,
}).strict();
export type NativeBinding = z.infer<typeof nativeBindingSchema>;
export const nativeContextSchema = nativeBindingSchema.extend({
  messageId: id, context: z.string().regex(/^[a-f0-9]{64}$/),
  pedidoSha256: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.string().datetime(),
}).strict();
export type NativeContext = z.infer<typeof nativeContextSchema>;
export interface NativeAnswer {
  origem: 'native'; canal: 'hermes' | 'openclaw'; conta: string; native: NativeContext;
  por: string; mensagem: string; recebidoEm: string; resposta: string; prova: string;
}
const prefix = (host: string) => host === 'hermes' ? 'HERMES' : host === 'openclaw' ? 'OPENCLAW' : (() => { throw Error('hitl.native.host'); })();
/** Configuração privada do processo de ingresso; não é argumento da ferramenta. */
export function nativeBinding(host: string, env: NodeJS.ProcessEnv = process.env): NativeBinding {
  try {
    const value = nativeBindingSchema.parse(JSON.parse(env[`ORK_HITL_NATIVE_BINDING_${prefix(host)}`] ?? 'null'));
    if (value.host !== host) throw Error('scope');
    return value;
  } catch { throw Error('hitl.native.capability-unavailable'); }
}
export function nativeKey(host: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env[`ORK_HITL_NATIVE_KEY_${prefix(host)}`] ?? '';
  const other = env[`ORK_HITL_NATIVE_KEY_${host === 'hermes' ? 'OPENCLAW' : 'HERMES'}`];
  if (Buffer.byteLength(key) < 32 || key === other || key === env.ORK_HITL_INGRESS_KEY_HERMES || key === env.ORK_HITL_INGRESS_KEY_OPENCLAW)
    throw Error('hitl.native.credentials-unavailable');
  return key;
}
export function nativeSignature(thread: string, pedido: string, r: Omit<NativeAnswer, 'prova'>, key: string): string {
  const n = nativeContextSchema.parse(r.native);
  return createHmac('sha256', key).update(JSON.stringify(['ork.hitl-native/v1', thread, pedido,
    n.host, n.installationId, n.connectionId, n.sessionId, n.accountId, n.channelId,
    n.conversationId, n.personId, n.messageId, n.context, n.pedidoSha256, n.expiresAt,
    r.origem, r.canal, r.conta, r.por, r.mensagem, r.recebidoEm, r.resposta])).digest('hex');
}
export function nativeMessage(n: NativeContext): string {
  return 'native:' + createHash('sha256').update(JSON.stringify([n.host, n.installationId,
    n.connectionId, n.sessionId, n.channelId, n.accountId, n.conversationId, n.messageId])).digest('hex');
}
export function authenticateNative(thread: string, pedido: string, r: NativeAnswer,
  when = new Date().toISOString(), env: NodeJS.ProcessEnv = process.env): void {
  const n = nativeContextSchema.parse(r.native), binding = nativeBinding(r.canal, env);
  const age = Date.parse(when) - Date.parse(r.recebidoEm);
  if (Object.entries(binding).some(([k, v]) => n[k as keyof NativeBinding] !== v) ||
      r.origem !== 'native' || r.conta !== binding.accountId || r.por !== `native:${n.host}:${n.personId}` ||
      r.mensagem !== nativeMessage(n) || !Number.isFinite(age) || age < 0 || age > 60000 ||
      !Number.isFinite(Date.parse(n.expiresAt)) || Date.parse(r.recebidoEm) >= Date.parse(n.expiresAt) ||
      typeof r.resposta !== 'string' || !r.resposta.length || r.resposta.length > 4096 || r.resposta.includes('\0') ||
      !/^[a-f0-9]{64}$/.test(r.prova ?? '')) throw Error('hitl.native.untrusted');
  const expected = nativeSignature(thread, pedido, r, nativeKey(n.host, env));
  if (!timingSafeEqual(Buffer.from(r.prova, 'hex'), Buffer.from(expected, 'hex'))) throw Error('hitl.native.untrusted');
}
