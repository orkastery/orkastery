/** Prova efêmera de callback para apresentação. Não autoriza resposta nem gate. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import { z } from 'zod';
import { PedidoHitlQualquer, prazoDoPedido } from './hitl-contract';
import { nativeBinding, nativeBindingSchema, nativeKey } from './hitl-native';

const offerSchema = z.object({
  native: nativeBindingSchema.extend({ messageId: z.string().min(1).max(200).regex(/^[^\u0000-\u001f]+$/) }).strict(),
  recebidoEm: z.string().datetime(), prova: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type NativeOffer = z.infer<typeof offerSchema>;
export function nativeOfferSignature(thread: string, pedido: string, offer: NativeOffer, key: string): string {
  const n = offer.native;
  return createHmac('sha256', key).update(JSON.stringify(['ork.hitl-native-offer/v1', thread, pedido,
    n.host, n.installationId, n.connectionId, n.sessionId, n.accountId, n.channelId,
    n.conversationId, n.personId, n.messageId, offer.recebidoEm])).digest('hex');
}
/**
 * I-41 (T4b): as duas versoes entram, e um fato consumado NUNCA sai provado.
 *
 * A prova serve para oferecer um caminho de resposta. `decidido` nao tem prazo e nao tem
 * resposta: sem prazo nao existe a janela que esta funcao confere, e deixar `Date.parse('')`
 * virar `NaN` faria a comparacao ser falsa e a oferta seguir adiante. Prazo ausente barra aqui,
 * explicitamente, para que nenhum canal apareca `disponivel` para quem nao tem o que responder.
 */
export function provenNativeOffer(pedido: PedidoHitlQualquer, value: unknown): 'hermes' | 'openclaw' | undefined {
  try {
    const prazo = prazoDoPedido(pedido);
    if (prazo === undefined) return undefined;
    const offer = offerSchema.parse(value), n = offer.native, binding = nativeBinding(n.host);
    const age = Date.now() - Date.parse(offer.recebidoEm);
    if (age < 0 || age > 60000 || Date.now() >= Date.parse(prazo) ||
        Object.entries(binding).some(([k, v]) => n[k as keyof typeof n] !== v)) return undefined;
    const expected = nativeOfferSignature(pedido.thread, pedido.id, offer, nativeKey(n.host));
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(offer.prova, 'hex')) ? n.host : undefined;
  } catch { return undefined; }
}
export function readNativeOfferStdin(): unknown {
  const buffer = Buffer.alloc(8193); let total = 0;
  for (;;) {
    const count = fs.readSync(0, buffer, total, buffer.length - total, null);
    total += count;
    if (total > 8192) throw Error('hitl.native.offer-limit');
    if (!count) break;
  }
  try { return JSON.parse(buffer.subarray(0, total).toString('utf8')); }
  catch { throw Error('hitl.native.offer-invalid'); }
}
