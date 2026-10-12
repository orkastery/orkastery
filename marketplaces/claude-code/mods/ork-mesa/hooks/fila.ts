// A fila da Mesa do Dono (RM-059 F5), em funcoes puras: o que o pulse, o retrato e o `ork_hitl_pending` do nucleo
// trazem vira pergunta, parada ou decisao, e a faixa sai daqui. So importa tipos: o register.tsx le o nucleo pela
// ponte e entrega os objetos a estas funcoes. Nada aqui responde pedido nem escolhe opcao pelo dono.
import type { MesaAlternativa, MesaCanal, MesaDecisao, MesaFila, MesaObvia, MesaOutro, MesaPergunta } from '../types'

/** Perguntas por pagina: o lote de ate cinco da RM-041 e da RM-057. */
export const TAMANHO_DO_LOTE = 5
/** Decisoes informadas que o painel mostra por inteiro; o resto vira uma linha com a contagem. */
export const MAXIMO_DE_DECISOES = 5
/** Paradas e impedimentos que o painel mostra por inteiro. */
export const MAXIMO_DE_OUTROS = 5
/** So a decisao das ultimas 24 h que a Mesa ainda nao mostrou conta como nova. */
export const JANELA_DE_NOVAS_MS = 24 * 60 * 60 * 1000
export const TETO_DO_TEXTO = 200
export const TETO_DA_FAIXA = 200
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

export const FILA_VAZIA: MesaFila = { perguntas: [], outros: [], decisoes: [], totalDeDecisoes: 0, lidoEm: null, erro: null, avisos: [] }

type Bruto = Record<string, unknown>
const objeto = (v: unknown): v is Bruto => !!v && typeof v === 'object' && !Array.isArray(v)
const texto = (v: unknown): string => (typeof v === 'string' ? v : '')
const textoOuNulo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** Uma linha so, sem quebra e sem espaco repetido, cortada no teto. */
export function umaLinha(v: unknown, teto = TETO_DO_TEXTO): string {
  const t = texto(v).replace(/\s+/g, ' ').trim()
  return t.length <= teto ? t : `${t.slice(0, teto - 1).trimEnd()}…`
}

/** Quanto tempo, como o dono le: segundos, minutos, horas e dias. */
export function duracao(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} dias`
}

/** O texto que um JSON traz, ou `undefined` quando nao e JSON. */
function lerJson(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

/** O JSON que uma ferramenta MCP do nucleo devolve no primeiro bloco de texto; erro vira excecao com o motivo. */
export function jsonDoMcp(r: unknown): unknown {
  const bruto = (objeto(r) ? r : {}) as { content?: unknown; isError?: unknown }
  const blocos = Array.isArray(bruto.content) ? bruto.content.filter(objeto) : []
  const corpo = blocos.find(c => c.type === 'text' && typeof c.text === 'string')?.text as string | undefined
  if (bruto.isError === true) {
    const j = corpo === undefined ? undefined : lerJson(corpo)
    throw new Error(umaLinha(objeto(j) && typeof j.erro === 'string' ? j.erro : corpo ?? 'o nucleo respondeu com erro'))
  }
  if (corpo === undefined) throw new Error('o nucleo nao devolveu texto')
  const j = lerJson(corpo)
  if (j === undefined) throw new Error('o nucleo devolveu texto que nao e JSON')
  return j
}

/** As alternativas de um pedido: letras no `ork.hitl/v2`, numeros no `ork.hitl/v1`, como o nucleo as declara. */
export function alternativasDoPedido(p: Bruto): MesaAlternativa[] {
  if (p.contrato === 'ork.hitl/v2' && Array.isArray(p.alternativas)) {
    return p.alternativas.filter(objeto).map(a => ({
      chave: texto(a.letra), texto: umaLinha(a.texto), acao: texto(a.acao), consequencia: textoOuNulo(a.consequencia),
      recomendada: a.recomendada === true, porque: textoOuNulo(a.porque),
    }))
  }
  if (Array.isArray(p.opcoes)) {
    return p.opcoes.filter(objeto).map(o => ({
      chave: typeof o.numero === 'number' ? String(o.numero) : texto(o.numero), texto: umaLinha(o.texto), acao: texto(o.acao),
      consequencia: null, recomendada: false, porque: null,
    }))
  }
  return []
}

/**
 * A pergunta de um pedido aberto (`ork.hitl/v1`, ou `ork.hitl/v2` de classe `pergunta`); `null` para o que nao e
 * pergunta (a decisao informada nao pede nada) ou nao tem identificacao valida.
 */
export function perguntaDoPedido(pedido: unknown, extra: { desdeEm?: string | null; reserva?: string | null } = {}): MesaPergunta | null {
  if (!objeto(pedido)) return null
  const v2 = pedido.contrato === 'ork.hitl/v2'
  if (!v2 && pedido.contrato !== 'ork.hitl/v1') return null
  if (v2 && pedido.classe !== 'pergunta') return null
  const alvo = objeto(pedido.alvo) ? pedido.alvo.tipo : undefined
  if (alvo !== 'gate' && alvo !== 'session') return null
  const thread = texto(pedido.thread)
  const id = texto(pedido.id)
  if (!ID.test(thread) || !ID.test(id)) return null
  const alternativas = alternativasDoPedido(pedido)
  const recomendada = alternativas.find(a => a.recomendada)
  const codigo = v2 ? textoOuNulo(pedido.codigo) : null
  return {
    thread, fase: textoOuNulo(pedido.fase), modo: textoOuNulo(pedido.modo), pedidoId: id, codigo,
    contrato: v2 ? 'ork.hitl/v2' : 'ork.hitl/v1', alvo, motivo: texto(pedido.motivo), pergunta: umaLinha(pedido.pergunta),
    recomendacao: v2 ? (recomendada ? `${recomendada.chave}) ${recomendada.texto}` : '') : umaLinha(pedido.recomendacao),
    alternativas, irreversivel: pedido.irreversivel === true, ato: textoOuNulo(pedido.ato),
    tipoDeResposta: v2 ? textoOuNulo(pedido.tipoDeResposta) : null,
    respostaAceita: objeto(pedido.respostaAceita) ? textoOuNulo(pedido.respostaAceita.tipo) : null,
    dependenciaTecnica: pedido.dependenciaTecnica !== undefined, acaoAoExpirar: textoOuNulo(pedido.acaoPadraoAoExpirar),
    prazo: textoOuNulo(pedido.prazo), prazoLocal: null, desdeEm: extra.desdeEm ?? textoOuNulo(pedido.criadoEm),
    estado: 'desconhecido', conferida: false, canalClaudeCode: 'desconhecido',
    reserva: extra.reserva ?? (codigo && recomendada ? `${codigo} ${recomendada.chave}` : null),
  }
}

/** As chaves que a Mesa ja registrou na ponte por um canal (`decisao:` no painel, `hitl:` na notificacao), sem o prefixo. */
function chavesDaMesa(registro: unknown, prefixo: string, canal?: string): Set<string> {
  const itens = objeto(registro) && Array.isArray(registro.itens) ? registro.itens.filter(objeto) : []
  const chaves = new Set<string>()
  for (const i of itens) {
    const chave = texto(i.chave)
    if (i.mod === 'ork-mesa' && chave.startsWith(prefixo) && (canal === undefined || i.canal === canal)) chaves.add(chave.slice(prefixo.length))
  }
  return chaves
}

/** Os ids das decisoes que a Mesa ja mostrou ao dono, pelo registro do mostrado da ponte. */
export function decisoesVistas(registro: unknown): Set<string> {
  return chavesDaMesa(registro, 'decisao:')
}

/** Os pedidos que a Mesa ja levou ao dono por notificacao, pelo registro da ponte: valem depois de uma recarga do modulo. */
export function pedidosNotificados(registro: unknown): Set<string> {
  return chavesDaMesa(registro, 'hitl:', 'notificacao')
}

/** A ordem das perguntas: o prazo mais perto primeiro, depois a mais antiga; sem prazo vai para o fim. */
export function ordenarPerguntas(perguntas: readonly MesaPergunta[]): MesaPergunta[] {
  const prazo = (p: MesaPergunta) => {
    const t = Date.parse(p.prazo ?? '')
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }
  const desde = (p: MesaPergunta) => {
    const t = Date.parse(p.desdeEm ?? '')
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }
  return [...perguntas].sort((a, b) => prazo(a) - prazo(b) || desde(a) - desde(b) || a.pedidoId.localeCompare(b.pedidoId))
}

/**
 * A fila a partir do `ork pulse --json`: as perguntas com pedido, as paradas e os impedimentos de
 * `precisaDeHumanoAgora`, e as decisoes que a fabrica tomou pelo dono na janela do pulse.
 */
export function filaDoPulse(pulse: unknown, vistas: ReadonlySet<string>, agora: number): Omit<MesaFila, 'lidoEm' | 'erro' | 'avisos'> {
  const p = objeto(pulse) ? pulse : {}
  const humanos = Array.isArray(p.precisaDeHumanoAgora) ? p.precisaDeHumanoAgora.filter(objeto) : []
  const perguntas: MesaPergunta[] = []
  const outros: MesaOutro[] = []
  for (const item of humanos) {
    const pergunta = item.pedido === undefined ? null
      : perguntaDoPedido(item.pedido, { desdeEm: textoOuNulo(item.desdeEm), reserva: textoOuNulo(item.comandoResposta) })
    if (pergunta) {
      if (!perguntas.some(x => x.pedidoId === pergunta.pedidoId)) perguntas.push(pergunta)
      continue
    }
    if (item.classe === 'score_pendente') continue
    const impedimento = objeto(item.impedimento) ? item.impedimento : null
    outros.push({
      chave: umaLinha(item.id, 160), thread: textoOuNulo(item.thread), fase: textoOuNulo(item.fase), motivo: texto(item.motivo),
      texto: umaLinha(item.pergunta), recomendacao: umaLinha(item.recomendacao),
      comando: umaLinha(impedimento ? impedimento.comando : item.comandoResposta), desdeEm: textoOuNulo(item.desdeEm),
      impedimento: impedimento !== null,
    })
  }
  const brutas = Array.isArray(p.decisoes) ? p.decisoes.filter(objeto) : []
  // A decisao que outra desfez continua na janela, marcada como revertida, e nunca conta como nova.
  const revertidaPor = new Map<string, string>()
  for (const d of brutas) if (typeof d.reverte === 'string' && ID.test(d.reverte)) revertidaPor.set(d.reverte, texto(d.id))
  const decisoes: MesaDecisao[] = brutas.flatMap(d => {
    const id = texto(d.id)
    if (!ID.test(id)) return []
    const custo = objeto(d.custoDeReverter) ? d.custoDeReverter : {}
    const em = texto(d.em)
    const recente = Number.isFinite(Date.parse(em)) && agora - Date.parse(em) <= JANELA_DE_NOVAS_MS
    const desfeita = revertidaPor.get(id) ?? null
    return [{
      id, thread: texto(d.thread), fase: texto(d.fase), em, decidido: umaLinha(d.decidido), porque: umaLinha(d.porque),
      comoMudar: umaLinha(d.comoMudar), custoAgora: umaLinha(custo.agora, 140), custoDepois: umaLinha(custo.depois, 140),
      quemDecidiu: umaLinha(d.quemDecidiu, 120), reverte: typeof d.reverte === 'string' && ID.test(d.reverte) ? d.reverte : null,
      revertidaPor: desfeita, nova: recente && desfeita === null && !vistas.has(id),
    }]
  })
  decisoes.sort((a, b) => Number(b.nova) - Number(a.nova) || b.em.localeCompare(a.em))
  return { perguntas: ordenarPerguntas(perguntas), outros, decisoes, totalDeDecisoes: decisoes.length }
}

/**
 * A assinatura do retrato da secao `hitl`: cada pedido com o estado dele. Muda quando um pedido abre, e respondido,
 * vence ou fica velho, e e o sinal barato para reler o pulse.
 */
export function assinaturaDoRetrato(retrato: unknown): string {
  const secoes = objeto(retrato) && objeto(retrato.sections) ? retrato.sections : {}
  const hitl = objeto(secoes.hitl) ? secoes.hitl : {}
  const itens = Array.isArray(hitl.items) ? hitl.items.filter(objeto) : []
  return itens.map(i => `${texto(i.id)}:${texto(i.status)}`).sort().join(',')
}

/**
 * Confere a pergunta no `ork_hitl_pending` da thread: o pedido de agora, o estado, o prazo local e a oferta do canal
 * `claude-code`. Pedido que o nucleo nao lista mais saiu da fila (respondido, substituido ou de outra fase): `null`.
 */
export function conferirNoNucleo(pergunta: MesaPergunta, resposta: unknown): MesaPergunta | null {
  const pendencias = objeto(resposta) && Array.isArray(resposta.pendencias) ? resposta.pendencias.filter(objeto) : []
  const achada = pendencias.find(x => objeto(x.pedido) && x.pedido.id === pergunta.pedidoId)
  if (!achada) return null
  const fresca = perguntaDoPedido(achada.pedido, { desdeEm: pergunta.desdeEm, reserva: pergunta.reserva })
  if (!fresca) return null
  const canais = Array.isArray(achada.canais) ? achada.canais.filter(objeto) : []
  const claudeCode = canais.find(c => c.canal === 'claude-code')
  const canal: MesaCanal = claudeCode?.estado === 'disponivel' ? 'disponivel' : 'indisponivel'
  return { ...fresca, estado: textoOuNulo(achada.estado) ?? 'desconhecido', conferida: true, prazoLocal: textoOuNulo(achada.prazoLocal),
    canalClaudeCode: canal }
}

/** As threads que tem pergunta na fila, sem repetir, na ordem da fila. */
export function threadsComPergunta(perguntas: readonly MesaPergunta[]): string[] {
  return [...new Set(perguntas.map(p => p.thread))]
}

/**
 * O que espera o dono de fato: a pergunta que a Mesa decidiu pelo nucleo nao conta, nem a que ainda confere no nucleo
 * se a decisao chegou (ela volta a esperar o dono se a leitura seguinte nao a mostrar).
 */
export function esperamODono(fila: MesaFila, obvias: Readonly<Record<string, MesaObvia>>): MesaPergunta[] {
  return fila.perguntas.filter(p => {
    const estado = obvias[p.pedidoId]?.estado
    return estado !== 'registrada' && estado !== 'incerta'
  })
}

/**
 * A linha da Mesa na faixa: quantos pedidos esperam o dono (com a thread do primeiro), as paradas e as decisoes novas
 * tomadas por ele. Sem idade no texto, para a linha so mudar quando a fila muda. Sem nada, a linha sai.
 */
export function textoDaFaixa(fila: MesaFila, obvias: Readonly<Record<string, MesaObvia>>): string | undefined {
  if (fila.lidoEm === null) return undefined
  const partes: string[] = []
  const esperam = esperamODono(fila, obvias)
  if (esperam.length) partes.push(`${esperam.length} ${esperam.length === 1 ? 'espera' : 'esperam'} você (${esperam[0]?.thread})`)
  if (fila.outros.length) partes.push(`${fila.outros.length} ${fila.outros.length === 1 ? 'parada' : 'paradas'}`)
  const novas = fila.decisoes.filter(d => d.nova).length
  if (novas) partes.push(`${novas} ${novas === 1 ? 'decidida' : 'decididas'} sem te chamar`)
  if (!partes.length) return undefined
  return umaLinha(`mesa: ${partes.join(' · ')}`, TETO_DA_FAIXA)
}
