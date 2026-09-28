/** Reserva durável do ingresso antes do lock; guarda somente o hash da resposta. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { RespostaHumana } from './hitl-gates';
import { nativeBinding, nativeKey, nativeContextSchema, nativeMessage } from './hitl-native';
import { dirThread } from './thread';
import { EventoLedger } from './types';
import { lerLedger } from './ledger';
import { alvoDoPedido, chavesAceitas, escolhasDoPedido, PedidoHitl, PedidoHitlQualquer,
  prazoDoPedido, respostaAceitaDoPedido, validarPedidoHitl, vereditoDoGate } from './hitl-contract';
import { publicBindingMatches, publicReceiptAuthority, signPublicReceipt, verifyPublicReceipt } from './hitl-public-receipt';
import {
  Canal, parseCanal, transporteDoCanal, variavelDaChaveDoCanal, VARIAVEL_DA_CHAVE, VARIAVEL_DA_CONTA,
} from './hitl-canais';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function pedidoDoIngresso(raiz: string, id: string, pedidoId: string): PedidoHitlQualquer {
  const pedidos = lerLedger(dirThread(raiz, id)).filter(e => e.tipo === 'hitl_requested' && (e.pedido as PedidoHitl | undefined)?.id === pedidoId);
  if (pedidos.length !== 1) throw new Error('ingresso durável sem pedido único');
  validarPedidoHitl(pedidos[0].pedido);
  return pedidos[0].pedido as PedidoHitlQualquer;
}
// D12: `canal` entra por ultimo e so quando existe. Um ingresso v1 continua produzindo
// exatamente os mesmos bytes e o mesmo MAC de antes; compatibilidade aqui e literal.
// FX5: `conta` entra depois de `canal`, pela mesma regra e pelo mesmo motivo: e ela que faz
// o recibo provar a CONTA autorizada do canal, e nao so o transporte telegram.
const campos = (raiz: string, id: string, pedido: string, r: RespostaHumana) => {
  const request = pedidoDoIngresso(raiz, id, pedido);
  // Opção usa a mesma normalização do validador. Texto nativo continua literal;
  // a assinatura do envelope autentica os bytes recebidos antes desta projeção.
  const resposta = r.origem === 'native' && respostaAceitaDoPedido(request)?.tipo === 'texto' ? r.resposta : r.resposta.trim();
  return { contrato: 'ork.hitl-ingress/v1', thread: id, pedidoId: pedido,
  pedidoSha256: sha(JSON.stringify(request)), por: r.por, mensagem: r.mensagem, recebidoEm: r.recebidoEm,
  recibo: sha(r.prova), respostaSha256: sha(resposta), ...(r.canal === undefined ? {} : { canal: r.canal }),
  ...(r.conta === undefined ? {} : { conta: r.conta }),
  ...(r.origem === 'native' ? { native: nativeContextSchema.parse(r.native) } : {}) };
};
const arquivo = (raiz: string, id: string, r: RespostaHumana) => path.join(dirThread(raiz, id), 'hitl-ingress', sha(r.mensagem) + '.json');
/**
 * FX1: a chave do MAC vem do CANAL. Envelope v2 sem a variavel do proprio canal nao
 * autentica, mesmo com a chave global presente: e essa recusa que impede um canal de
 * assinar pelo outro. O v1, que nao declara canal, continua na chave global.
 */
export function chaveDoIngresso(canal: Canal | null): string {
  const nome = variavelDaChaveDoCanal(canal);
  const chave = process.env[nome] ?? '';
  if (Buffer.byteLength(chave) < 32) throw new Error(`hitl.credencial: ${nome} ausente ou menor que 32 bytes`);
  // FX16 / SEC7: a oferta e apenas apresentacao. A fronteira que autentica cada
  // operacao tambem precisa falhar fechada quando os dois canais Telegram foram
  // provisionados com o mesmo material, sem revelar esse material no diagnostico.
  if (canal === 'hermes' || canal === 'openclaw') {
    const outro: Canal = canal === 'hermes' ? 'openclaw' : 'hermes';
    const nomeDoOutro = VARIAVEL_DA_CHAVE[outro]!;
    const chaveDoOutro = process.env[nomeDoOutro] ?? '';
    if (chaveDoOutro && chave === chaveDoOutro) {
      throw new Error('hitl.credencial: chaves dos canais telegram precisam de material distinto');
    }
  }
  return chave;
}
/**
 * FX5: a conta declarada por um envelope, conferida contra a allowlist do proprio canal.
 *
 * O adaptador do OpenClaw ja recusava evento de outra conta, mas essa conferencia morria no
 * processo do host. Aqui ela vira parte da autenticacao do nucleo e, por tabela, do corpo
 * assinado: o recibo duravel passa a provar a CONTA, nao so o transporte. Canal sem conta
 * homologada recusa envelope que traga conta, em vez de ignorar o campo.
 */
export function contaDoEnvelope(canal: Canal | null, conta: string | undefined): string | null {
  const nome = canal === null ? null : VARIAVEL_DA_CONTA[canal];
  if (nome === null) {
    if (conta !== undefined) throw new Error('hitl.canal.conta-inesperada: canal sem conta homologada');
    return null;
  }
  const autorizada = (process.env[nome] ?? '').trim();
  if (!autorizada) throw new Error(`hitl.credencial: ${nome} ausente`);
  if (typeof conta !== 'string' || conta !== autorizada) {
    throw new Error('hitl.canal.conta-divergente: envelope nao prova a conta autorizada do canal');
  }
  return conta;
}

/** Canal declarado por um envelope, já conferido contra o registro. `null` é o v1 legado. */
export function canalDoEnvelope(r: Pick<RespostaHumana, 'canal' | 'origem'>): Canal | null {
  if (r.origem === 'native') {
    if (r.canal !== 'hermes' && r.canal !== 'openclaw') throw Error('hitl.native.host');
    return r.canal;
  }
  if (r.canal === undefined) return null;
  const canal = parseCanal(r.canal);
  // Apelido não serve: o valor entra literal no HMAC, então ele tem de ser o nome canônico.
  if (!canal || canal !== r.canal) throw new Error('hitl.canal.desconhecido: envelope declara canal fora do registro');
  if (transporteDoCanal(canal) !== 'telegram') throw new Error('hitl.canal.transporte-divergente: canal não atende por telegram');
  return canal;
}
const mac = (v: unknown, canal: Canal | null, native = false) => createHmac('sha256', native ? nativeKey(String(canal)) : chaveDoIngresso(canal)).update(JSON.stringify(v)).digest('hex');
export function instanteDoIngresso(raiz: string, id: string, pedido: string, r: RespostaHumana): string | undefined {
  const file = arquivo(raiz, id, r);
  if (!fs.existsSync(file)) return undefined;
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.mode & 0o077) throw new Error('ingresso durável inválido');
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = { ...campos(raiz, id, pedido, r), observadoEm: v.observadoEm };
  const idade = Date.parse(v.observadoEm) - Date.parse(r.recebidoEm);
  const esperado = /^[a-f0-9]{64}$/.test(v.assinatura ?? '') ? mac(data, r.canal ?? null, r.origem === 'native') : '';
  if (!esperado || !Number.isFinite(idade) || idade < 0 || idade > 60000 || JSON.stringify(v.dados) !== JSON.stringify(data) ||
      !timingSafeEqual(Buffer.from(v.assinatura, 'hex'), Buffer.from(esperado, 'hex'))) throw new Error('mensagem já reservada; ingresso divergente ou inválido');
  return v.observadoEm;
}
/** Referência imutável do ingresso autenticado; o corpo da resposta nunca entra no artefato. */
export function evidenciaDoIngresso(raiz: string, id: string, pedido: string, r: RespostaHumana): { arquivo: string; sha256: string } {
  if (!instanteDoIngresso(raiz, id, pedido, r)) throw new Error('ingresso durável ausente');
  const file = arquivo(raiz, id, r), bytes = fs.readFileSync(file);
  return { arquivo: `.orkastery/threads/${id}/hitl-ingress/${path.basename(file)}`, sha256: sha(bytes.toString('utf8')) };
}

/**
 * Revalida no sync o MAC durável e seu vínculo exato ao evento do ledger.
 *
 * FX4: vale para os DOIS alvos do contrato HITL. Antes desta correção havia aqui um
 * `pedido.alvo.tipo !== 'gate'` que devolvia `false` sem dizer nada: uma resposta de SESSÃO
 * vinda por Telegram jamais tinha a sua evidência durável reconferida, embora o ingresso
 * durável dela já existisse em disco, com o mesmo MAC. Metade do HITL tinha prova durável e
 * metade tinha só a palavra do controller, apesar de a narrativa prometer "o mesmo para os
 * quatro canais nos dois alvos".
 *
 * O que muda por alvo é o que o MAC precisa amarrar do outro lado: no `gate`, a opção
 * escolhida e o veredito derivado dela; na `session`, o envio único, a instância e o prompt
 * nativo que receberam a resposta. O corpo respondido continua fora de tudo: o que entra no
 * MAC é `sha256(resposta)`, como sempre foi.
 */
export function validarEvidenciaDoIngresso(raiz: string, id: string, e: EventoLedger): boolean {
  return conferirIngresso(raiz, id, e, true);
}

/**
 * FX10: o MESMO MAC, conferido ANTES de o evento existir no ledger.
 *
 * A reconciliação de um envio pendente reconstrói a referência durável só com o que o ledger
 * já guardava. Reconstruir é legítimo; gravar sem reconferir não é. Antes desta função o
 * núcleo escrevia `session_answered` e só muito depois, no sync, alguém descobria que o MAC
 * não fechava: um byte trocado no pendente, ou no próprio arquivo de ingresso, virava
 * resposta humana aceita, com a etiqueta `prova: 'ingresso-duravel'` por cima.
 *
 * A única diferença para a validação do evento já gravado é onde a resposta precisa estar:
 * aqui ela ainda NÃO pode existir no ledger. É isso que impede esta porta de ser usada para
 * carimbar um evento já persistido por outro caminho.
 */
export function validarEvidenciaReconstruida(raiz: string, id: string, e: EventoLedger): boolean {
  return conferirIngresso(raiz, id, e, false);
}

/** `registrado` diz se a resposta já está no ledger; o resto da conferência é idêntico. */
function conferirIngresso(raiz: string, id: string, e: EventoLedger, registrado: boolean): boolean {
  try {
    // FX1: a chave e a do canal gravado. Um evento v2 cujo canal saiu do registro, ou cuja
    // variavel de chave nao esta no ambiente, reprova aqui e nao cai na chave global.
    const canal = e.canal == null ? null : parseCanal(String(e.canal));
    if (e.canal != null && (canal !== e.canal || transporteDoCanal(canal) !== 'telegram')) return false;
    const isNative = e.origem === 'native';
    // Ausência da chave no filho usa só a autoridade pública fixada no startup.
    // Chave presente, porém inválida, continua falhando fechada.
    const keyName = isNative ? `ORK_HITL_NATIVE_KEY_${String(canal).toUpperCase()}` : variavelDaChaveDoCanal(canal);
    const publicAuthority = process.env[keyName] === undefined ? publicReceiptAuthority(canal, isNative) : undefined;
    const chave = publicAuthority ? undefined : isNative ? nativeKey(String(canal)) : chaveDoIngresso(canal);
    const native = isNative ? nativeContextSchema.parse(e.native) : undefined;
    if (native) {
      const { messageId: _message, context: _context, pedidoSha256: _pedido, expiresAt: _expires, ...identity } = native;
      const bindingValid = publicAuthority ? publicBindingMatches(publicAuthority, identity) :
        Object.entries(nativeBinding(String(canal))).every(([k, v]) => native[k as keyof typeof native] === v);
      if (!bindingValid ||
          e.mensagem !== nativeMessage(native) || e.autorizadoPor !== `native:${native.host}:${native.personId}` ||
          e.conta !== native.accountId) return false;
    }
    // FX5: a conta gravada tem de ser a conta autorizada do canal, agora e no MAC.
    const conta = native ? native.accountId : publicAuthority ? e.conta ?? null :
      contaDoEnvelope(canal, e.conta == null ? undefined : String(e.conta));
    if (!native && publicAuthority && !publicBindingMatches(publicAuthority, conta)) return false;
    if ((!isNative && (e.origem !== 'telegram' || !/^telegram:\d+$/.test(String(e.autorizadoPor ?? '')))) || typeof e.pedidoId !== 'string' ||
        typeof e.mensagem !== 'string' || typeof e.recebidoEm !== 'string' ||
        !/^[a-f0-9]{64}$/.test(String(e.recibo ?? '')) || typeof e.evidencia !== 'string' ||
        !/^[a-f0-9]{64}$/.test(String(e.evidenciaSha256 ?? ''))) return false;
    const nome = sha(e.mensagem) + '.json';
    const referencia = `.orkastery/threads/${id}/hitl-ingress/${nome}`;
    if (e.evidencia !== referencia) return false;
    const file = path.join(dirThread(raiz, id), 'hitl-ingress', nome);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600) return false;
      const bytes = fs.readFileSync(fd), v = JSON.parse(bytes.toString('utf8'));
      if (Object.keys(v).sort().join(',') !== 'assinatura,dados,observadoEm' ||
          !/^[a-f0-9]{64}$/.test(v.assinatura ?? '') || e.evidenciaSha256 !== sha(bytes)) return false;
      const eventos = lerLedger(dirThread(raiz, id));
      const solicitados = eventos.filter(x => x.tipo === 'hitl_requested' && (x.pedido as PedidoHitl | undefined)?.id === e.pedidoId);
      if (solicitados.length !== 1) return false;
      const pedido = solicitados[0].pedido as PedidoHitl;
      validarPedidoHitl(pedido);
      if (pedido.thread !== id) return false;
      const tipoEsperado = pedido.alvo.tipo === 'gate' ? 'human_gate' : 'session_answered';
      const respostas = eventos.filter(x => x.tipo === tipoEsperado && x.pedidoId === e.pedidoId);
      if (Object.hasOwn(e, 'observacao')) return false;
      // Já gravado: a resposta do ledger tem de ser exatamente esta. Ainda por gravar: não
      // pode haver nenhuma, senão esta porta viraria um segundo caminho de revalidação.
      if (registrado ? respostas.length !== 1 || JSON.stringify(respostas[0]) !== JSON.stringify(e)
        : respostas.length !== 0) return false;
      const pedidoSha256 = sha(JSON.stringify(pedido));
      if (v.dados?.pedidoSha256 !== pedidoSha256) return false;
      if (native && (native.pedidoSha256 !== pedidoSha256 || native.expiresAt !== prazoDoPedido(pedido) ||
          native.context !== solicitados[0].contexto || Date.parse(e.recebidoEm) >= Date.parse(native.expiresAt))) return false;
      const respostaSha256 = String(v.dados?.respostaSha256 ?? '');
      if (!vinculoDoAlvo(pedido, e, eventos, respostaSha256)) return false;
      const contratoResposta = native ? 'ork.hitl-native/v1' : canal ? 'ork.hitl-answer/v2' : 'ork.hitl-answer/v1';
      if ((e.contratoResposta ?? 'ork.hitl-answer/v1') !== contratoResposta) return false;
      const data = { contrato: 'ork.hitl-ingress/v1', thread: id, pedidoId: e.pedidoId,
        pedidoSha256, por: e.autorizadoPor, mensagem: e.mensagem, recebidoEm: e.recebidoEm,
        recibo: e.recibo, respostaSha256, ...(canal ? { canal } : {}), ...(conta === null ? {} : { conta }), ...(native ? { native } : {}),
        observadoEm: v.observadoEm };
      const idade = Date.parse(v.observadoEm) - Date.parse(e.recebidoEm);
      const signatureValid = publicAuthority ? verifyPublicReceipt(file, bytes, publicAuthority) :
        timingSafeEqual(Buffer.from(v.assinatura, 'hex'), createHmac('sha256', chave!).update(JSON.stringify(data)).digest());
      return Number.isFinite(idade) && idade >= 0 && idade <= 60000 &&
        JSON.stringify(v.dados) === JSON.stringify(data) &&
        signatureValid;
    } finally { fs.closeSync(fd); }
  } catch { return false; }
}

/**
 * FX4: o que o MAC precisa amarrar do lado do ledger, por alvo do pedido.
 *
 * Gate: a opção existe no pedido e o veredito gravado é exatamente o que ela deriva.
 * Sessão: a entrega foi única, correlacionada ao envio reservado, e caiu na mesma instância
 * e no mesmo prompt nativo que abriram o pedido. Em pedido de OPÇÃO o conteúdo entregue
 * ainda precisa ser uma das opções; em texto livre o `sha256` do MAC é a única amarra
 * possível, e é ela que vale, porque o corpo nunca é persistido.
 */
function vinculoDoAlvo(pedido: PedidoHitlQualquer, e: EventoLedger, eventos: EventoLedger[], respostaSha256: string): boolean {
  const alvo = alvoDoPedido(pedido);
  // Fato consumado nao tem alvo nem resposta: nao ha vinculo a conferir, e por isso nao passa.
  if (!alvo) return false;
  // I-41: a resposta digitada pode ser a letra (v2) ou o numero (as duas versoes). Conferir so
  // o numero faria uma resposta legitima por letra deixar de bater com o proprio pedido.
  const bate = (numero: number) => chavesAceitas(pedido, numero).some(c => sha(c) === respostaSha256);
  if (alvo.tipo === 'gate') {
    const opcao = escolhasDoPedido(pedido).find(o => bate(o.numero));
    if (!opcao) return false;
    const veredito = vereditoDoGate(pedido, opcao);
    return e.fase === veredito.fase && e.sobre === veredito.sobre &&
      e.estado === veredito.estado && e.opcao === veredito.opcao;
  }
  if (e.estado !== 'entregue' || e.fase !== pedido.fase || e.sessionId !== alvo.sessionId ||
      e.runtime !== alvo.runtime || typeof e.envioId !== 'string' ||
      typeof e.instancia !== 'string' || typeof e.bloqueio !== 'string') return false;
  if (respostaAceitaDoPedido(pedido)?.tipo === 'opcao' && !escolhasDoPedido(pedido).some(o => bate(o.numero))) return false;
  const solicitado = eventos.find(x => x.tipo === 'hitl_requested' && (x.pedido as PedidoHitl | undefined)?.id === pedido.id);
  const sessao = solicitado?.sessao as { instancia?: string; bloqueio?: string } | undefined;
  if (sessao?.instancia !== e.instancia || sessao?.bloqueio !== e.bloqueio) return false;
  const envios = eventos.filter(x => x.tipo === 'session_answer_sending' && x.pedidoId === e.pedidoId);
  return envios.length === 1 && envios[0].envioId === e.envioId && envios[0].mensagem === e.mensagem &&
    envios[0].recibo === e.recibo && envios[0].autorizadoPor === e.autorizadoPor;
}

/** O chamador autentica assinatura, janela e pedido antes de chamar; revalida sob lock depois. */
export function gravarIngresso(raiz: string, id: string, pedido: string, r: RespostaHumana, observadoEm: string): void {
  const file = arquivo(raiz, id, r), dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dados = { ...campos(raiz, id, pedido, r), observadoEm };
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ dados, observadoEm, assinatura: mac(dados, r.canal ?? null, r.origem === 'native') })); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); const d = fs.openSync(dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  finally { fs.unlinkSync(temp); }
  instanteDoIngresso(raiz, id, pedido, r); // corrida: só aceita vencedor idêntico
  signPublicReceipt(file, r.canal ?? null, r.origem === 'native');
}

/** Núcleo antes do despacho: acrescenta prova pública a recibos legados autenticados.
 * Nunca certifica um hash fornecido pelo modelo, nem altera recibo/ledger antigos.
 */
export function prepararRecibosParaDespacho(raiz: string, id: string): void {
  for (const e of lerLedger(dirThread(raiz, id))) {
    if (!['human_gate', 'session_answered'].includes(e.tipo) || !['telegram', 'native'].includes(String(e.origem))) continue;
    const canal = e.canal == null ? null : parseCanal(String(e.canal));
    const keyName = e.origem === 'native' ? `ORK_HITL_NATIVE_KEY_${String(canal).toUpperCase()}` : variavelDaChaveDoCanal(canal);
    if (process.env[keyName] === undefined || !validarEvidenciaDoIngresso(raiz, id, e)) continue;
    signPublicReceipt(path.join(dirThread(raiz, id), 'hitl-ingress', sha(String(e.mensagem)) + '.json'), canal, e.origem === 'native');
  }
}
