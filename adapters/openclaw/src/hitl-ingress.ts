/** Native inbound_claim hook only. Never register this callback as a model tool. */
/** D12: this host is the `openclaw` channel, and the channel is signed, not labelled. */
import { createHash, createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';

interface NativeEvent {
  content: string; channel: string; commandAuthorized?: boolean; accountId?: string;
  senderId?: string; conversationId?: string; messageId?: string; timestamp?: number;
  sessionKey?: string; senderIsOwner?: boolean;
}
interface NativeContext { channelId: string; accountId?: string; senderId?: string; conversationId?: string; messageId?: string; sessionKey?: string }
interface NativeApi { on: (name: 'inbound_claim', handler: (event: NativeEvent, ctx: NativeContext) => unknown) => void }

/**
 * I-41 (GO-FIX 1): the two shapes of an answer to the pulse summary, typed with no slash and no
 * identifier: "P4EJ a" answers the summary and "1a 2c" answers the questions. The SAME sources
 * live in the core (GRAMATICA_DO_PULSE, core/src/pulse-resposta.ts) and a core test checks they
 * stay equal. The code starts with a letter and has a digit: ordinary chat never has this shape,
 * and it never reads as an answer to the batch, which starts with the question number.
 */
const PULSE_CONSENT = new RegExp("^[ \\t]*(?=[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{0,2}[2-9])[A-HJKMNP-TV-Z][2-9A-HJKMNP-TV-Z]{3}[ \\t]+[^\\r\\n]{1,40}$", 'i');
const PULSE_LOTE = new RegExp("^[ \\t]*[0-9]{1,2}[ \\t]*[a-zA-Z](?:[ \\t,;]*[0-9]{1,2}[ \\t]*[a-zA-Z])*[ \\t]*[.!]?[ \\t]*$");
/** I-50 (RM-039): the pulse cadence tag, alone in the message. It starts with '#', so it never reads as the other two. */
const PULSE_CADENCIA = new RegExp("^[ \\t]*#OrkPulse(?:On(?:-(?:15|30|60)m)?|Off)[ \\t]*[.!]?[ \\t]*$", 'i');
/** The pulse address inside the signed body: neither a thread nor a request. The core translates. */
const PULSE_ALVO = 'pulse', PULSE_ENDERECO = 'resposta';
export function isPulseAnswer(text: string): boolean {
  return !text.includes('\0') && (PULSE_CONSENT.test(text) || PULSE_LOTE.test(text) || PULSE_CADENCIA.test(text));
}

export function registerHitlIngress(api: NativeApi, bin: string): void {
  api.on('inbound_claim', async (event, ctx) => {
    if (typeof event.content !== 'string') return { handled: false };
    const pulse = !event.content.startsWith('/ork ') && isPulseAnswer(event.content);
    if (!event.content.startsWith('/ork ') && !pulse) return { handled: false };
    const denied = { handled: true, reply: { text: 'Resposta HITL não confirmada. Confira ingresso e ledger do pedido.' } };
    // The pulse summary goes out on Telegram; only there is an answer to it recognized.
    if (event.channel !== 'telegram') return pulse ? { handled: false } : nativeIngress(event, ctx, bin).catch(() => denied);
    try {
      const env = process.env, user = event.senderId ?? '', chat = event.conversationId ?? '', message = event.messageId ?? '';
      const allowed = (key: string, value: string) => (env[key] ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(value);
      const age = Date.now() - Number(event.timestamp);
      if (event.channel !== 'telegram' || ctx.channelId !== 'telegram' || event.commandAuthorized !== true ||
          !env.ORK_HITL_OPENCLAW_ACCOUNT || event.accountId !== env.ORK_HITL_OPENCLAW_ACCOUNT || event.accountId !== ctx.accountId ||
          !env.ORK_HITL_TELEGRAM_BOT_ID || user === env.ORK_HITL_TELEGRAM_BOT_ID ||
          !/^\d+$/.test(user) || !/^-?\d+$/.test(chat) || !/^\d+$/.test(message) ||
          user !== ctx.senderId || chat !== ctx.conversationId || message !== ctx.messageId ||
          !allowed('ORK_HITL_TELEGRAM_USERS', user) || !allowed('ORK_HITL_TELEGRAM_CHATS', chat) ||
          !Number.isFinite(age) || age < 0 || age > 60000) return denied;
      const match = /^\/ork (gate|session) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79}) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79}) ([\s\S]{1,4096})$/.exec(event.content);
      // FX1: this channel signs with ITS OWN key. The shared ORK_HITL_INGRESS_KEY is kept
      // for the legacy v1 envelope only, which this adapter no longer produces.
      const key = env.ORK_HITL_INGRESS_KEY_OPENCLAW, root = env.ORK_HITL_ROOT;
      if ((!pulse && !match) || event.content.includes('\0') || !key || Buffer.byteLength(key) < 32 || !root?.startsWith('/')) return denied;
      if (pulse) return pulseIngress(event.content, { user, chat, message, key, root, bin, timestamp: Number(event.timestamp) }, denied);
      const [, operation, thread, pedido, resposta] = match!;
      const canal = 'openclaw';
      // FX5: the authorized account goes INSIDE the signed body. Checking `accountId` only
      // here left the durable receipt proving generic telegram transport and nothing else:
      // nobody reading it later could tell which OpenClaw account the decision came from.
      const conta = env.ORK_HITL_OPENCLAW_ACCOUNT;
      const envelope = { resposta, canal, conta, origem: 'telegram', por: `telegram:${user}`, mensagem: `telegram:${chat}:${message}`,
        recebidoEm: new Date(Number(event.timestamp)).toISOString(), prova: '' };
      envelope.prova = createHmac('sha256', key).update(JSON.stringify(['ork.hitl-answer/v2', thread, pedido, canal, conta,
        envelope.origem, envelope.por, envelope.mensagem, envelope.recebidoEm, resposta])).digest('hex');
      // `gate answer` exige --resposta-stdin; `sessions answer` exige --stdin. A mesma flag
      // para os dois fazia o CLI recusar toda resposta de sessao antes de conferir qualquer coisa.
      const args = [operation === 'gate' ? 'gate' : 'sessions', 'answer', thread, pedido,
        operation === 'gate' ? '--resposta-stdin' : '--stdin',
        '--origem', 'telegram', '--canal', canal, '--conta', conta, '--por', envelope.por, '--mensagem', envelope.mensagem];
      // FX5: `ok` alone was never a receipt. The core answers with the typed verdict, and a
      // reply to the human must only claim what that verdict says: a gate lands in one of
      // three states, a session answer lands `entregue` with the session it reached, and
      // `repetida` says whether this call caused the effect or merely found it already done.
      const estados = operation === 'gate' ? ['aprovado', 'recusado', 'aguardando'] : ['entregue'];
      const ok = await new Promise<boolean>(resolve => {
        const child = execFile(bin, args, { cwd: root, timeout: 10000, maxBuffer: 65536 }, (err, stdout) => {
          try {
            const r = JSON.parse(stdout);
            resolve(!err && r.ok === true && r.pedidoId === pedido && estados.includes(r.estado) &&
              typeof r.repetida === 'boolean' &&
              (operation === 'gate' || typeof r.sessionId === 'string' && r.sessionId.length > 0));
          } catch { resolve(false); }
        });
        child.stdin?.on('error', () => resolve(false));
        child.stdin?.end(JSON.stringify(envelope));
      });
      return ok ? { handled: true, reply: { text: `Resposta recebida pelo núcleo para o pedido ${pedido}.` } } : denied;
    } catch { return denied; }
  });
}

/**
 * I-41 (GO-FIX 1): the owner answered the pulse summary or its questions. The whole text is the
 * answer and the signed address is the pulse's; this adapter knows no request and picks nothing.
 * The reply is the text the core composed, transported as is.
 */
async function pulseIngress(texto: string, m: { user: string; chat: string; message: string; key: string; root: string;
  bin: string; timestamp: number }, denied: { handled: boolean; reply: { text: string } }) {
  const canal = 'openclaw', conta = process.env.ORK_HITL_OPENCLAW_ACCOUNT ?? '';
  const envelope = { resposta: texto, canal, conta, origem: 'telegram', por: `telegram:${m.user}`,
    mensagem: `telegram:${m.chat}:${m.message}`, recebidoEm: new Date(m.timestamp).toISOString(), prova: '' };
  envelope.prova = createHmac('sha256', m.key).update(JSON.stringify(['ork.hitl-answer/v2', PULSE_ALVO, PULSE_ENDERECO, canal, conta,
    envelope.origem, envelope.por, envelope.mensagem, envelope.recebidoEm, texto])).digest('hex');
  const args = ['pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', canal, '--conta', conta,
    '--por', envelope.por, '--mensagem', envelope.mensagem];
  const receipt = await new Promise<any>(resolve => {
    const child = execFile(m.bin, args, { cwd: m.root, timeout: 10000, maxBuffer: 65536 }, (err, stdout) => {
      try { resolve(err ? null : JSON.parse(stdout)); } catch { resolve(null); }
    });
    child.stdin?.on('error', () => resolve(null));
    child.stdin?.end(JSON.stringify(envelope));
  });
  if (!receipt || receipt.ok !== true || receipt.contrato !== 'ork.pulse-resposta/v1' ||
      typeof receipt.mensagem !== 'string' || !receipt.mensagem || typeof receipt.repetida !== 'boolean') return denied;
  // Same message already handled: never resend blindly.
  return receipt.repetida ? { handled: true } : { handled: true, reply: { text: receipt.mensagem } };
}

/** SDK instalado: inbound_claim fornece commandAuthorized, senderIsOwner e sessionKey.
 * Somente esta callback usa a chave privada; nenhuma tool registra nativeIngress. */
async function nativeIngress(event: NativeEvent, ctx: NativeContext, bin: string) {
  const denied = { handled: true, reply: { text: 'Ingresso nativo indisponível ou identidade não comprovada. O pedido permanece pendente.' } };
  const env = process.env, root = env.ORK_HITL_ROOT, key = env.ORK_HITL_NATIVE_KEY_OPENCLAW;
  const binding = JSON.parse(env.ORK_HITL_NATIVE_BINDING_OPENCLAW ?? 'null');
  const age = Date.now() - Number(event.timestamp);
  if (!binding || binding.host !== 'openclaw' || !root?.startsWith('/') || !key || Buffer.byteLength(key) < 32 ||
      event.commandAuthorized !== true || event.senderIsOwner !== true ||
      !event.sessionKey || event.sessionKey !== ctx.sessionKey || event.sessionKey !== binding.sessionId ||
      !event.messageId || event.messageId !== ctx.messageId || !binding.installationId || !binding.connectionId ||
      event.channel !== ctx.channelId || event.channel !== binding.channelId ||
      event.accountId !== ctx.accountId || event.accountId !== binding.accountId ||
      event.senderId !== ctx.senderId || event.senderId !== binding.personId ||
      event.conversationId !== ctx.conversationId || event.conversationId !== binding.conversationId ||
      !Number.isFinite(age) || age < 0 || age > 60000) return denied;
  const match = /^\/ork (offer|gate|session) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79}) ([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})(?: ([\s\S]{1,4096}))?$/.exec(event.content);
  if (!match || event.content.includes('\0') || (match[1] === 'offer' ? match[4] !== undefined : !match[4])) return denied;
  const [, operation, thread, pedido, resposta] = match;
  const call = (args: string[], input?: unknown) => new Promise<any>((resolve, reject) => {
    const child = execFile(bin, args, { cwd: root, timeout: 10000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) { reject(Error('native.core.unavailable')); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(Error('native.core.invalid')); }
    });
    child.stdin?.on('error', () => reject(Error('native.core.unavailable')));
    if (input !== undefined) child.stdin?.end(JSON.stringify(input));
  });
  const offer = { native: { ...binding, messageId: event.messageId }, recebidoEm: new Date(Number(event.timestamp)).toISOString(), prova: '' };
  const b = offer.native;
  offer.prova = createHmac('sha256', key).update(JSON.stringify(['ork.hitl-native-offer/v1', thread, pedido,
    b.host, b.installationId, b.connectionId, b.sessionId, b.accountId, b.channelId,
    b.conversationId, b.personId, b.messageId, offer.recebidoEm])).digest('hex');
  const view = await call(['gate', 'context', thread, pedido, '--native-offer-stdin'], offer);
  if (view.pedido?.id !== pedido || view.pedido?.thread !== thread || (operation !== 'offer' && view.pedido?.alvo?.tipo !== operation) ||
      !view.canais?.some((c: any) => c.canal === 'openclaw' && c.transporte === 'native' && c.estado === 'disponivel') ||
      !/^[a-f0-9]{64}$/.test(view.contexto) || !/^[a-f0-9]{64}$/.test(view.pedidoSha256)) return denied;
  if (operation === 'offer') {
    if (typeof view.apresentacao?.mensagem !== 'string') return denied;
    // I-35: o prazo chega ao dono no fuso dele; núcleo de outra versão pode não ter posto o
    // prazo local na mensagem, então o campo local vai junto.
    const prazo = typeof view.prazoLocal === 'string' && view.prazoLocal && !view.apresentacao.mensagem.includes(view.prazoLocal)
      ? `\nPrazo (fuso do dono): ${view.prazoLocal}` : '';
    return { handled: true, reply: { text: view.apresentacao.mensagem + prazo + '\nCanal nativo OpenClaw disponível nesta conversa.' } };
  }
  const n = { ...binding, messageId: event.messageId, context: view.contexto,
    pedidoSha256: view.pedidoSha256, expiresAt: view.pedido.prazo };
  const message = 'native:' + createHash('sha256').update(JSON.stringify([n.host, n.installationId, n.connectionId,
    n.sessionId, n.channelId, n.accountId, n.conversationId, n.messageId])).digest('hex');
  const r = { origem: 'native', canal: 'openclaw', conta: n.accountId, native: n, por: `native:openclaw:${n.personId}`,
    mensagem: message, recebidoEm: new Date(Number(event.timestamp)).toISOString(), resposta, prova: '' };
  r.prova = createHmac('sha256', key).update(JSON.stringify(['ork.hitl-native/v1', thread, pedido,
    n.host, n.installationId, n.connectionId, n.sessionId, n.accountId, n.channelId, n.conversationId, n.personId,
    n.messageId, n.context, n.pedidoSha256, n.expiresAt, r.origem, r.canal, r.conta, r.por, r.mensagem, r.recebidoEm, resposta])).digest('hex');
  const receipt = await call([operation === 'gate' ? 'gate' : 'sessions', 'answer', thread, pedido,
    operation === 'gate' ? '--resposta-stdin' : '--stdin', '--origem', 'native', '--canal', 'openclaw',
    '--conta', r.conta, '--por', r.por, '--mensagem', message], r);
  if (receipt.ok !== true || receipt.pedidoId !== pedido || typeof receipt.repetida !== 'boolean' ||
      !(operation === 'gate' ? ['aprovado', 'recusado', 'aguardando'] : ['entregue']).includes(receipt.estado) ||
      (operation === 'session' && !receipt.sessionId)) return denied;
  return receipt.repetida ? { handled: true } : { handled: true, reply: { text: 'Resposta nativa confirmada pelo núcleo.' } };
}
