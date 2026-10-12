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
/**
 * D21: o prazo que a conferencia leva ao nucleo (`ate`), bem antes do teto de 20 s da chamada no mod. O nucleo nao
 * reserva depois dele: a conferencia atrasada nao deixa reserva sem ninguem para confirma-la.
 */
export const PRAZO_DA_CONFERENCIA_MS = 15000
export const FASE_VAZIA: MensageiroFase = { thread: null, recebidas: [], erro: null }

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const objeto = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const curto = (id: string) => id.slice(0, 8)

/**
 * As origens que nao trazem texto de outra sessao (G4, D22 da thread ork-rm059mensag): o Remote Control do dono
 * (`bridge`), a notificacao de tarefa, o agendamento e o canal. A lista e fechada: tipo novo ou desconhecido conta
 * como outra sessao ate entrar aqui.
 */
const EXTERNAS = ['bridge', 'task-notification', 'scheduled-trigger', 'slack-ping']
/** Entre a conversa principal e os agentes desta sessao: so com o `agentId` do agente de destino. */
const ENTRE_AGENTES = ['peer', 'coordinator']

export type ClasseDaOrigem = 'outra-sessao' | 'da-propria-sessao' | 'externa'

/**
 * Classifica uma entrega que chegou: externa (a lista fechada acima), da propria sessao (para um agente desta sessao,
 * ou de teammate que o harness verificou) ou de outra sessao, que so entra confirmada pelo nucleo. Conta como outra
 * sessao o mailbox que o harness nao verificou (`isVerified` diferente de `true`, D17: o despacho roda os teammates no
 * mesmo processo, e ali a entrada sem verificacao e uma que nenhum membro mandou), `peer` e `coordinator` sem agente
 * desta sessao como destino, inclusive a mensagem de um agente desta sessao para a conversa principal, que chega sem
 * `agentId` e nao se distingue da de outra sessao (D22), e todo tipo desconhecido ou origem malformada.
 */
export function classificarOrigem(origem: unknown, agentId: unknown): ClasseDaOrigem {
  const o = objeto(origem) ? origem : {}
  if ('teammate' in o || 'isVerified' in o) return o.isVerified === true ? 'da-propria-sessao' : 'outra-sessao'
  const kind = typeof o.kind === 'string' ? o.kind : ''
  if (EXTERNAS.includes(kind)) return 'externa'
  if (ENTRE_AGENTES.includes(kind) && typeof agentId === 'string' && agentId !== '') return 'da-propria-sessao'
  return 'outra-sessao'
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

/** O argumento do `conferir`, com o prazo (`ate`) contado do relogio da sessao. */
export function argsDaConferencia(thread: string, texto: string, agora: number): Record<string, unknown> {
  return { threadId: thread, operacao: 'conferir', texto, ate: new Date(agora + PRAZO_DA_CONFERENCIA_MS).toISOString() }
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
  'entrega.prazo': 'a conferência chegou ao núcleo depois do prazo',
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

/** O remetente do envelope fixo com que o receptor entrega a resposta conferida ao modelo (D23). */
export const REMETENTE_DO_MENSAGEIRO = 'ork-mensageiro'

/**
 * O texto que a sessao de fase le (D23): a mensagem que o nucleo conferiu, no envelope fixo do Mensageiro. O envelope
 * que chegou sai inteiro, com os rotulos que o remetente escolhe (o nome da sessao, o plugin, o endereco): nada que o
 * nucleo nao compos chega ao modelo, e o enquadramento de mensagem de outra sessao fica.
 */
export function textoParaOModelo(mensagem: string): string {
  return `<cross-session-message from="${REMETENTE_DO_MENSAGEIRO}">\n${mensagem}\n</cross-session-message>`
}

export type DecisaoNaFalha = { acao: 'passa' } | { acao: 'conferida'; texto: string } | { acao: 'consome' }

/**
 * O que o `.catch` do receptor faz quando o gancho falha antes de chamar `next` (D18): a entrega que nao e de outra
 * sessao passa como chegou, como na sessao que nao e de fase; a de outra sessao que o nucleo ja confirmou e reservou
 * (em voo) segue no envelope do Mensageiro, como no caminho normal; o resto e consumido. Papel desconhecido conta como
 * fase.
 */
export function decisaoNaFalha(f: { origem: unknown; agentId: unknown; texto: unknown; papel: string | null;
  emVoo: ReadonlyMap<string, string> }): DecisaoNaFalha {
  if (classificarOrigem(f.origem, f.agentId) !== 'outra-sessao') return { acao: 'passa' }
  if (f.papel !== null && f.papel !== 'fase') return { acao: 'passa' }
  const conferida = typeof f.texto === 'string' ? f.emVoo.get(f.texto) : undefined
  return conferida !== undefined ? { acao: 'conferida', texto: conferida } : { acao: 'consome' }
}

/** Um valor de atributo do envelope do motor: uma linha so, sem aspas nem sinal de tag (o mesmo do nucleo). */
const VALOR_DE_LINHA = '[^"<>\\n\\r\\v\\f\\u0085\\u2028\\u2029]{1,200}'
/** O envelope do Claude Code na forma que o motor escreve, o mesmo que o nucleo aceita (`entrega-por-mod.ts`). */
const ENVELOPE_DO_MOTOR = new RegExp('^<cross-session-message' +
  '(?: from="[^"<>\\s]{1,300}")?' +
  '(?: from-session="[A-Za-z0-9_-]{1,80}")?' +
  '(?: hop-chain="[0-9a-f]{24}(?:,[0-9a-f]{24}){0,31}")?' +
  `(?: from-name="${VALOR_DE_LINHA}")?` +
  '(?: from-mode="[A-Za-z-]{1,40}")?' +
  `(?: from-plugin="${VALOR_DE_LINHA}")?` +
  '>\\n([\\s\\S]*)\\n</cross-session-message>$')

/** A mensagem sem o envelope do motor, como a linha da conversa a mostra; o texto como veio quando nao ha envelope. */
export function mensagemSemEnvelope(texto: string): string | null {
  const t = texto.replace(/\r\n?/g, '\n')
  if (!t.startsWith('<')) return t
  const m = ENVELOPE_DO_MOTOR.exec(t)
  return m ? m[1] : null
}

/**
 * A impressao do texto de uma mensagem (FNV-1a de 32 bits do texto normalizado, com o tamanho): so diz se a linha da
 * conversa e a mensagem que o nucleo confirmou, sem guardar o texto (D12). Nao e prova: o que prova e a conferencia.
 */
export function impressaoDoTexto(texto: string): string {
  const t = texto.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${t.length.toString(16)}-${h.toString(16).padStart(8, '0')}`
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

/** As entregas que o nucleo confirmou nesta sessao, com a impressao do texto: so a linha de uma delas ganha o rotulo. */
export function confirmadasDaFase(fase: MensageiroFase | null | undefined): Map<string, string> {
  return new Map((fase?.recebidas ?? []).flatMap(r =>
    (r.envioId && r.impressao && r.estado !== 'consumida' && r.estado !== 'nao-entrou' ? [[r.envioId, r.impressao] as [string, string]] : [])))
}

/**
 * O texto da linha da mensagem com o rotulo no lugar do cabecalho, so para a entrega que o nucleo confirmou nesta
 * sessao e com o mesmo texto (a impressao); `null` deixa a linha como o Claude Code a desenha. So visual: o que fica
 * guardado e o que o modelo le nao mudam.
 */
export function textoComRotulo(texto: unknown, confirmadas: ReadonlyMap<string, string>): string | null {
  const { pedidoId, envioId } = idsDaMarca(texto)
  if (typeof texto !== 'string' || !pedidoId || !envioId || confirmadas.get(envioId) !== impressaoDoTexto(texto)) return null
  const cabecalho = `${cabecalhoDaEntrega(pedidoId, envioId)}\n`
  return texto.startsWith(cabecalho) ? `${rotuloDaEntrega(pedidoId)}\n${texto.slice(cabecalho.length)}` : null
}
