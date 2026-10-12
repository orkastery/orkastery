// O lado da sessao de fase do Mensageiro de Sessoes (RM-059, fatia F9, T9.3), em funcoes puras. Na sessao de fase,
// a mensagem que chega de outra sessao so entra na conversa do modelo depois que o nucleo confirma, pela
// `ork_session_inbox` do servidor preso ao despacho, que ela e a resposta do dono reservada para esta sessao, com o
// mesmo texto. O nome do plugin remetente (`origin.plugin`) e so o que o remetente declara: entra no registro, nunca
// na decisao. Nada daqui guarda o texto da mensagem no estado (D12 da thread ork-rm059mensag). So importa tipos e o
// modulo puro da caixa.
import type { MensageiroEstadoDaRecebida, MensageiroFase, MensageiroRecebida } from '../types'
import { CONTRATO_DA_ENTREGA, umaLinha } from './caixa'

/** A ferramenta da conferencia no receptor, so no servidor preso ao despacho (T9.1). */
export const FERRAMENTA_DA_CONFERENCIA = 'ork_session_inbox'
/** A maior mensagem que vai a conferencia, o mesmo teto do nucleo (`LIMITE_DA_MENSAGEM` de `entrega-por-mod.ts`). */
export const LIMITE_DA_MENSAGEM = 8192
export const MAXIMO_DE_RECEBIDAS = 30
/** O recibo que nao foi gravado volta nestas esperas; depois delas, a linha fica sem recibo. */
export const ESPERAS_DA_CONFIRMACAO_MS = [5000, 30000, 120000]
export const FASE_VAZIA: MensageiroFase = { thread: null, recebidas: [], erro: null }

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const objeto = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const curto = (id: string) => id.slice(0, 8)

/**
 * As origens que trazem texto de outra sessao (G4 da thread ork-rm059mensag): a mensagem de outra sessao (`peer`,
 * `peer-send-message`), a de uma sessao coordenadora (`coordinator`, `projects-relay`) e a que ninguem classificou
 * (`unclassified`). `peer` e `coordinator` com `agentId` sao de agentes desta sessao.
 */
const SO_DE_FORA = ['peer-send-message', 'projects-relay', 'unclassified']
const ENTRE_AGENTES = ['peer', 'coordinator']

export type ClasseDaOrigem = 'outra-sessao' | 'da-propria-sessao' | 'externa'

/**
 * Classifica uma entrega que chegou: de outra sessao (so entra confirmada pelo nucleo), da propria sessao (agentes e
 * teammates que o harness verificou) ou externa (Remote Control do dono, notificacao de tarefa, agendamento, canais).
 * O mailbox de teammate que o harness nao verificou (`isVerified` diferente de `true`) conta como outra sessao: o
 * despacho roda os teammates no mesmo processo (`teammateMode: in-process`), e ali a entrada sem verificacao e uma
 * que nenhum membro mandou.
 */
export function classificarOrigem(origem: unknown, agentId: unknown): ClasseDaOrigem {
  const o = objeto(origem) ? origem : {}
  if ('teammate' in o || 'isVerified' in o) return o.isVerified === true ? 'da-propria-sessao' : 'outra-sessao'
  const kind = typeof o.kind === 'string' ? o.kind : ''
  if (SO_DE_FORA.includes(kind)) return 'outra-sessao'
  if (ENTRE_AGENTES.includes(kind)) return typeof agentId === 'string' && agentId !== '' ? 'da-propria-sessao' : 'outra-sessao'
  return 'externa'
}

/** A origem para o registro e o painel, numa linha curta: o tipo e o plugin que o remetente diz ser. */
export function nomeDaOrigem(origem: unknown): string {
  const o = objeto(origem) ? origem : {}
  const kind = typeof o.kind === 'string' && /^[a-z-]{1,40}$/.test(o.kind) ? o.kind : 'desconhecida'
  const plugin = typeof o.plugin === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(o.plugin) ? `, plugin declarado ${o.plugin}` : ''
  return `${kind}${'teammate' in o || 'isVerified' in o ? ' do mailbox' : ''}${plugin}`
}

/** O cabecalho que o nucleo compoe (`cabecalhoDaEntrega` de `entrega-por-mod.ts`), conferido pelo teste do nucleo. */
export function cabecalhoDaEntrega(pedidoId: string, envioId: string): string {
  return `[${CONTRATO_DA_ENTREGA} pedido=${pedidoId} entrega=${envioId}] Resposta do dono à pergunta deste turno, conferida pelo núcleo do Orkastery:`
}

/** O rotulo visual da entrega confirmada (`rotuloDaEntrega` do nucleo). */
export function rotuloDaEntrega(pedidoId: string): string {
  return `Resposta do dono ao pedido ${curto(pedidoId)}, conferida pelo núcleo`
}

/** A mensagem traz a marca da entrega do nucleo: so essa vai a conferencia (D13); quem decide e o nucleo. */
export function temMarca(texto: unknown): boolean {
  return typeof texto === 'string' && texto.length <= LIMITE_DA_MENSAGEM && texto.includes(`[${CONTRATO_DA_ENTREGA} pedido=`)
}

/** Os ids que a marca diz ter, sem conferir nada: so para o registro de quem chegou. */
export function idsDaMarca(texto: unknown): { pedidoId: string | null; envioId: string | null } {
  const m = typeof texto === 'string' ? /\[ork\.session-delivery\/v1 pedido=([0-9a-f-]{36}) entrega=([0-9a-f-]{36})\]/.exec(texto) : null
  return { pedidoId: m && uuid(m[1]) ? m[1] : null, envioId: m && uuid(m[2]) ? m[2] : null }
}

export function argsDaConferencia(thread: string, texto: string): Record<string, unknown> {
  return { threadId: thread, operacao: 'conferir', texto }
}

export function argsDaConfirmacao(thread: string, envioId: string, texto: string): Record<string, unknown> {
  return { threadId: thread, operacao: 'confirmar', envioId, texto }
}

export type Conferencia = { confirmada: true; pedidoId: string; envioId: string } | { confirmada: false; motivo: string }

/** A resposta do `conferir`: so `confirmada: true` com os dois ids passa; o resto e recusa, com o motivo do nucleo. */
export function lerConferencia(dados: unknown): Conferencia {
  if (objeto(dados) && dados.confirmada === true && uuid(dados.pedidoId) && uuid(dados.envioId)) {
    return { confirmada: true, pedidoId: dados.pedidoId, envioId: dados.envioId }
  }
  const motivo = objeto(dados) && dados.confirmada === false && typeof dados.motivo === 'string' && /^entrega\.[a-z-]{1,40}$/.test(dados.motivo)
    ? dados.motivo : 'entrega.fora-do-contrato'
  return { confirmada: false, motivo }
}

/** A resposta do `confirmar`: entregue com o recibo; a recusa do nucleo e definitiva; o resto volta a tentar. */
export function lerConfirmacao(dados: unknown): { ok: boolean; definitiva: boolean; motivo: string | null } {
  if (objeto(dados) && dados.ok === true && dados.estado === 'entregue') return { ok: true, definitiva: true, motivo: null }
  const recusada = objeto(dados) && dados.estado === 'recusada'
  const motivo = objeto(dados) && typeof dados.motivo === 'string' ? dados.motivo
    : objeto(dados) && typeof dados.estado === 'string' ? `o núcleo respondeu ${dados.estado}` : 'a confirmação respondeu fora do contrato'
  return { ok: false, definitiva: recusada, motivo: umaLinha(motivo, 120) }
}

/** O que cada motivo quer dizer, para o painel e para o registro. Os do nucleo sao os de `MotivoDoReceptor`. */
export const MOTIVO_LEGIVEL: Record<string, string> = {
  'entrega.sem-marca': 'sem a marca da entrega do núcleo',
  'entrega.grande': 'maior que qualquer entrega do núcleo',
  'entrega.formato': 'fora do formato da entrega',
  'entrega.despacho': 'o despacho desta sessão não confere no núcleo',
  'entrega.desconhecida': 'o núcleo não tem essa entrega',
  'entrega.outra-sessao': 'a entrega é de outra sessão',
  'entrega.texto-diferente': 'o texto não é o da resposta do dono',
  'entrega.respondida': 'o pedido já foi respondido',
  'entrega.reservada': 'cópia de uma entrega que já entrou',
  'entrega.turno-mudou': 'a sessão já saiu do turno do pedido',
  'entrega.sem-reserva': 'a entrega não foi reservada por esta sessão',
  'entrega.fora-do-contrato': 'a conferência respondeu fora do contrato',
  'entrega.conferencia-falhou': 'a conferência no núcleo falhou',
  'entrega.sem-ponte': 'a ponte do Orkastery não carregou nesta sessão',
  'entrega.sem-papel': 'a ponte não disse o papel desta sessão',
}

/** O codigo de um motivo (`entrega.x`, ou `entrega.x: detalhe`). */
export function codigoDoMotivo(motivo: string): string {
  const i = motivo.indexOf(': ')
  return i < 0 ? motivo : motivo.slice(0, i)
}

/** O motivo como o dono le, com o detalhe entre parenteses quando ha. */
export function motivoLegivel(motivo: string): string {
  const codigo = codigoDoMotivo(motivo)
  const base = MOTIVO_LEGIVEL[codigo]
  if (!base) return umaLinha(motivo, 120)
  return codigo === motivo ? base : `${base} (${umaLinha(motivo.slice(codigo.length + 2), 120)})`
}

/** O motivo que vai ao `{ consumed }`: o Claude Code o registra com o nome do plugin. */
export function motivoDoConsumo(motivo: string): string {
  const codigo = codigoDoMotivo(motivo)
  return `mensagem de outra sessão sem entrega confirmada pelo núcleo do Orkastery (${MOTIVO_LEGIVEL[codigo] ?? 'motivo desconhecido'}; ${umaLinha(codigo, 60)})`
}

/** A linha do transcript (dim, fora do modelo) para o que nao entrou na conversa como devia. */
export function registroDaRecebida(r: MensageiroRecebida): string | null {
  const pedido = r.pedidoId ? curto(r.pedidoId) : null
  if (r.estado === 'consumida') return `Mensageiro de Sessões: mensagem de outra sessão (${r.origem}) consumida antes do modelo: ${motivoLegivel(r.motivo ?? '')}.`
  if (r.estado === 'nao-entrou') return `Mensageiro de Sessões: a resposta do dono ao pedido ${pedido}, conferida pelo núcleo, não entrou na conversa: ${r.motivo ?? 'consumida abaixo do Mensageiro'}.`
  if (r.estado === 'sem-recibo') return `Mensageiro de Sessões: a resposta do dono ao pedido ${pedido} entrou na conversa, mas o recibo não foi gravado no núcleo (${r.motivo ?? 'sem motivo'}); a entrega segue incerta para o dono.`
  return null
}

/** Guarda o que chegou, o mais novo por ultimo e com teto, sem o texto da mensagem. */
export function comRecebida(fase: MensageiroFase, r: MensageiroRecebida): MensageiroFase {
  return { ...fase, recebidas: [...fase.recebidas, r].slice(-MAXIMO_DE_RECEBIDAS) }
}

/** Muda a recebida de uma entrega confirmada (pelo `envioId`); sem ela, a fase fica como estava. */
export function mudarRecebida(fase: MensageiroFase, envioId: string, estado: MensageiroEstadoDaRecebida, motivo: string | null, em: number): MensageiroFase {
  if (!fase.recebidas.some(r => r.envioId === envioId && r.estado !== 'consumida')) return fase
  return { ...fase, recebidas: fase.recebidas.map(r => (r.envioId === envioId && r.estado !== 'consumida' ? { ...r, estado, motivo, em } : r)) }
}

/** As entregas que o nucleo confirmou nesta sessao: so a linha de uma delas ganha o rotulo. */
export function confirmadasDaFase(fase: MensageiroFase | null | undefined): Set<string> {
  return new Set((fase?.recebidas ?? []).flatMap(r => (r.envioId && r.estado !== 'consumida' && r.estado !== 'nao-entrou' ? [r.envioId] : [])))
}

/**
 * O texto da linha da mensagem com o rotulo no lugar do cabecalho, so para a entrega que o nucleo confirmou nesta
 * sessao; `null` deixa a linha como o Claude Code a desenha. So visual: o que fica guardado e o que o modelo le nao
 * mudam (D11).
 */
export function textoComRotulo(texto: unknown, confirmadas: ReadonlySet<string>): string | null {
  const { pedidoId, envioId } = idsDaMarca(texto)
  if (typeof texto !== 'string' || !pedidoId || !envioId || !confirmadas.has(envioId)) return null
  const cabecalho = `${cabecalhoDaEntrega(pedidoId, envioId)}\n`
  return texto.startsWith(cabecalho) ? `${rotuloDaEntrega(pedidoId)}\n${texto.slice(cabecalho.length)}` : null
}
