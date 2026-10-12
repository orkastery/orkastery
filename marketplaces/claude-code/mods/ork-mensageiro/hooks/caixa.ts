// O lado do dono do Mensageiro de Sessoes (RM-059, fatia F9, T9.2), em funcoes puras. A sessao do dono que recebeu a
// resposta pelo dialogo nativo tem a mensagem na caixa de saida do servidor MCP dela (`ork_session_outbox`), so na
// memoria; o Mensageiro a leva a sessao de fase por `$.session.send`, sem mexer no texto, e anota o envio no nucleo.
// O que segue incerto noutra sessao do dono sai do retrato da ponte (secao `hitl`). Nada daqui guarda o texto da
// resposta no estado (D12 da thread ork-rm059mensag). So importa tipos.
import type { MensageiroDono, MensageiroEntrega, MensageiroEstadoDaEntrega, MensageiroIncerta } from '../types'

export const SERVIDOR = 'orkastery'
/** A ferramenta da caixa de saida, so no servidor do dono do Claude Code (T9.1). */
export const FERRAMENTA_DA_CAIXA = 'ork_session_outbox'
/** O contrato da entrega no nucleo (`core/src/entrega-por-mod.ts`), conferido pelo teste do nucleo. */
export const CONTRATO_DA_ENTREGA = 'ork.session-delivery/v1'
/** D10: o envio que nao entrou na fila volta depois do recuo; o que entrou e nao foi reservado, depois da espera. */
export const RECUO_DO_ENVIO_MS = 30000
export const ESPERA_DA_RESERVA_MS = 60000
export const MAXIMO_DE_ENVIOS = 10
/** A faixa diz "entregue" por este tempo; o painel guarda o que terminou por este outro. */
export const FAIXA_DA_ENTREGA_MS = 10 * 60000
export const GUARDA_DO_TERMINADO_MS = 30 * 60000
export const MAXIMO_DE_ENTREGAS = 50
export const DONO_VAZIO: MensageiroDono = { entregas: [], incertas: [], lidoEm: null, erro: null }

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const VIVOS: readonly MensageiroEstadoDaEntrega[] = ['na-fila', 'a-caminho', 'reservada', 'nao-chegou']

/** Uma entrega da caixa de saida como o nucleo a lista, com o ultimo envio em ms. */
export type EntradaDaCaixa = {
  thread: string; pedidoId: string; envioId: string; sessionId: string
  /** A mensagem inteira, com o cabecalho do nucleo: vai ao `$.session.send` como esta e nunca ao estado. */
  mensagem: string
  tentativas: number
  ultimoEnvio: { em: number; entregue: boolean; motivo: string | null } | null
  reservada: boolean
}

const objeto = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** Uma linha so, sem caractere de controle e com teto: o que vem do nucleo ou de um erro nunca quebra a tela. */
export function umaLinha(v: unknown, teto = 200): string {
  const s = typeof v === 'string' ? v : v instanceof Error ? v.message : String(v)
  return Array.from(s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('')
}

/** O JSON que uma ferramenta do nucleo devolveu; a recusa vira erro com o motivo dela. */
export function jsonDoMcp(r: unknown, ferramenta: string): unknown {
  const o = objeto(r) ? r : {}
  const conteudo = Array.isArray(o.content) ? o.content : []
  const texto = conteudo.filter(c => objeto(c) && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('')
  let dados: unknown
  try { dados = JSON.parse(texto) } catch { throw new Error(`${ferramenta} respondeu fora do JSON`) }
  if (o.isError === true) throw new Error(`${ferramenta} recusou: ${umaLinha(objeto(dados) && typeof dados.erro === 'string' ? dados.erro : texto)}`)
  return dados
}

function lerEntrada(e: unknown): EntradaDaCaixa[] {
  if (!objeto(e) || typeof e.thread !== 'string' || !ID_DE_THREAD.test(e.thread) || !uuid(e.pedidoId) || !uuid(e.envioId) ||
      !uuid(e.sessionId) || typeof e.mensagem !== 'string' ||
      !e.mensagem.startsWith(`[${CONTRATO_DA_ENTREGA} pedido=${e.pedidoId} entrega=${e.envioId}] `)) return []
  const u = objeto(e.ultimoEnvio) ? e.ultimoEnvio : null
  const em = u && typeof u.em === 'string' ? Date.parse(u.em) : NaN
  return [{ thread: e.thread, pedidoId: e.pedidoId, envioId: e.envioId, sessionId: e.sessionId, mensagem: e.mensagem,
    tentativas: Number.isSafeInteger(e.tentativas) && e.tentativas > 0 ? e.tentativas : 0,
    ultimoEnvio: u && Number.isFinite(em) ? { em, entregue: u.entregue === true, motivo: typeof u.motivo === 'string' ? umaLinha(u.motivo) : null } : null,
    reservada: e.reservada === true }]
}

/** A caixa de saida do `listar`; o que nao bate com o contrato fica de fora, e a resposta fora do contrato e erro. */
export function lerCaixa(dados: unknown): EntradaDaCaixa[] {
  if (!objeto(dados) || dados.contrato !== CONTRATO_DA_ENTREGA || !Array.isArray(dados.entregas)) {
    throw new Error('a caixa de saída respondeu fora do contrato ork.session-delivery/v1')
  }
  return dados.entregas.flatMap(lerEntrada)
}

/** A entrega que o `enviada` devolveu, com a reserva que ela tinha na lista (o nucleo so a le no `listar`). */
export function entradaAnotada(dados: unknown, reservada: boolean): EntradaDaCaixa | null {
  const lida = objeto(dados) && dados.contrato === CONTRATO_DA_ENTREGA ? lerEntrada({ ...(objeto(dados.entrega) ? dados.entrega : {}), reservada }) : []
  return lida[0] ?? null
}

/** D10: envia o que nunca foi, o que nao entrou na fila depois do recuo e o que entrou e ninguem reservou depois da espera. */
export function deveEnviar(e: EntradaDaCaixa, agora: number): boolean {
  if (e.reservada || e.tentativas >= MAXIMO_DE_ENVIOS) return false
  if (!e.ultimoEnvio) return true
  return agora - e.ultimoEnvio.em >= (e.ultimoEnvio.entregue ? ESPERA_DA_RESERVA_MS : RECUO_DO_ENVIO_MS)
}

/** O argumento do `$.session.send`: a sessao do pedido e a mensagem do nucleo, sem mexer em nada. */
export function argsDoEnvio(e: EntradaDaCaixa): { to: { sessionId: string }; text: string } {
  return { to: { sessionId: e.sessionId }, text: e.mensagem }
}

/** O resultado do `$.session.send` como o nucleo o anota. */
export function resultadoDoEnvio(r: unknown): { entregue: boolean; motivo: string | null } {
  if (objeto(r) && r.isDelivered === true) return { entregue: true, motivo: null }
  return { entregue: false, motivo: umaLinha(objeto(r) && typeof r.reason === 'string' && r.reason ? r.reason : 'a sessão não recebeu a mensagem') }
}

export function argsDaAnotacao(e: EntradaDaCaixa, r: { entregue: boolean; motivo: string | null }): Record<string, unknown> {
  return { operacao: 'enviada', threadId: e.thread, envioId: e.envioId, entregue: r.entregue, ...(r.motivo ? { motivo: r.motivo } : {}) }
}

/** A secao `hitl` do retrato, quando ela veio lida (disponivel ou vazia); `null` quando nao da para concluir nada. */
function secaoHitl(retrato: unknown): Record<string, any>[] | null {
  const secoes = objeto(retrato) && objeto(retrato.sections) ? retrato.sections : {}
  const hitl = objeto(secoes.hitl) ? secoes.hitl : null
  if (!hitl || (hitl.state !== 'available' && hitl.state !== 'empty')) return null
  return Array.isArray(hitl.items) ? hitl.items.filter(objeto) : []
}

const threadDoItem = (i: Record<string, any>): string | null => {
  const ref = Array.isArray(i.refs) ? i.refs.find((r: unknown) => objeto(r) && r.kind === 'thread' && typeof r.id === 'string') : null
  return ref && ID_DE_THREAD.test(ref.id) ? ref.id : null
}

/** Os pedidos abertos que o retrato mostra (respondido sai da secao); `null` quando a secao nao veio lida. */
export function pedidosNoRetrato(retrato: unknown): Set<string> | null {
  const itens = secaoHitl(retrato)
  return itens === null ? null : new Set(itens.flatMap(i => (typeof i.id === 'string' ? [i.id] : [])))
}

/** Os pedidos de sessao com a entrega incerta no retrato (`delivery.uncertain`): a entrega segue em alguma sessao do dono. */
export function incertasDoRetrato(retrato: unknown): MensageiroIncerta[] {
  return (secaoHitl(retrato) ?? []).flatMap(i => {
    const thread = threadDoItem(i)
    return i.status === 'delivery.uncertain' && objeto(i.facts) && i.facts.target === 'session' && uuid(i.id) && thread
      ? [{ thread, pedidoId: i.id }] : []
  })
}

/** O estado de uma entrega que esta na caixa. */
export function estadoDaEntrada(e: EntradaDaCaixa): MensageiroEstadoDaEntrega {
  if (e.reservada) return 'reservada'
  if (!e.ultimoEnvio) return 'na-fila'
  if (e.tentativas >= MAXIMO_DE_ENVIOS) return 'desistiu'
  return e.ultimoEnvio.entregue ? 'a-caminho' : 'nao-chegou'
}

function motivoDaEntrada(e: EntradaDaCaixa, estado: MensageiroEstadoDaEntrega): string | null {
  if (estado === 'desistiu') {
    return e.ultimoEnvio?.entregue
      ? `a sessão de fase não confirmou a entrega depois de ${e.tentativas} envios`
      : e.ultimoEnvio?.motivo ?? `a mensagem não entrou na fila da sessão em ${e.tentativas} envios`
  }
  return estado === 'nao-chegou' ? e.ultimoEnvio?.motivo ?? null : null
}

/**
 * As entregas desta sessao depois de uma leitura da caixa. A que saiu da caixa terminou: entregue, quando o retrato
 * nao mostra mais o pedido (respondido); "saiu da caixa", quando o pedido segue aberto. Sem o retrato, nada se conclui.
 */
export function atualizarEntregas(anteriores: readonly MensageiroEntrega[], caixa: readonly EntradaDaCaixa[],
  noRetrato: Set<string> | null, agora: number): MensageiroEntrega[] {
  const restantes = new Map(anteriores.map(e => [e.envioId, e]))
  const saida: MensageiroEntrega[] = []
  for (const c of caixa) {
    const estado = estadoDaEntrada(c)
    const antes = restantes.get(c.envioId)
    restantes.delete(c.envioId)
    saida.push({ thread: c.thread, pedidoId: c.pedidoId, envioId: c.envioId, sessionId: c.sessionId, estado, tentativas: c.tentativas,
      motivo: motivoDaEntrada(c, estado), em: antes && antes.estado === estado ? antes.em : agora })
  }
  for (const e of restantes.values()) {
    if (!VIVOS.includes(e.estado) && e.estado !== 'desistiu') {
      if (agora - e.em <= GUARDA_DO_TERMINADO_MS) saida.push(e)
      continue
    }
    if (noRetrato === null) { saida.push(e); continue }
    const aberto = noRetrato.has(e.pedidoId)
    saida.push({ ...e, estado: aberto ? 'saiu-da-caixa' : 'entregue', em: agora,
      motivo: aberto ? 'a caixa de saída soltou a entrega sem recibo; responda pelo claude attach' : null })
  }
  return saida.slice(-MAXIMO_DE_ENTREGAS)
}

/** A thread do ledger que mudou, pelos caminhos que a ponte vigia (`.orkastery/threads/<thread>/ledger.jsonl`). */
export function threadDoLedger(caminho: unknown): string | null {
  if (typeof caminho !== 'string') return null
  const m = /\.orkastery\/threads\/([^/]+)\/ledger\.jsonl$/.exec(caminho)
  return m && ID_DE_THREAD.test(m[1]) ? m[1] : null
}

function daThread(entregas: readonly MensageiroEntrega[], um: string, varios: (n: number) => string): string {
  return entregas.length === 1 ? `${um} ${entregas[0].thread}` : varios(entregas.length)
}

/**
 * A linha da faixa (D7 do plano dos mods): o que nao chegou e precisa do dono vem primeiro; depois o que esta a caminho;
 * depois o que acabou de ser entregue. Sem nada disso, a linha sai da faixa.
 */
export function textoDaFaixa(dono: MensageiroDono, agora: number): string | undefined {
  const falhas = dono.entregas.filter(e => e.estado === 'desistiu' || e.estado === 'saiu-da-caixa')
  if (falhas.length) return falhas.length === 1
    ? `a resposta para a ${falhas[0].thread} não chegou; responda pelo claude attach` : `${falhas.length} respostas não chegaram; abra /mensageiro`
  const vivas = dono.entregas.filter(e => VIVOS.includes(e.estado))
  if (vivas.length) return daThread(vivas, 'resposta a caminho da', n => `${n} respostas a caminho das sessões de fase`)
  const entregues = dono.entregas.filter(e => e.estado === 'entregue' && agora - e.em <= FAIXA_DA_ENTREGA_MS)
  if (entregues.length) return daThread(entregues, 'resposta entregue à', n => `${n} respostas entregues às sessões de fase`)
  return undefined
}
