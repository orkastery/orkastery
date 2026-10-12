// A carga do Freio de Lote (RM-059, F2, T2.1): o que ele le do nucleo para saber quais claims vigiar.
// Modulo puro: interpreta o que as ferramentas de leitura do servidor `orkastery` devolvem e o retrato
// da ponte. As chamadas ao `$` ficam no register.ts; nada aqui le `.orkastery/` do disco (D2).
import type { FreioCarga, FreioClaim } from '../types'

export const SERVIDOR = 'orkastery'
/**
 * A lista fechada de ferramentas MCP do Freio (D2): as duas de leitura. O `$.mcp.call` nao pede permissao
 * ao dono, entao o teste do nucleo confere pela AST que o mod so chama estas.
 */
export const FERRAMENTA_DAS_CLAIMS = 'ork_claims_list'
export const FERRAMENTA_DO_PLANO = 'ork_artifact_read'
export const FERRAMENTAS_DO_FREIO: readonly string[] = [FERRAMENTA_DAS_CLAIMS, FERRAMENTA_DO_PLANO]
/** Claims com mais idade que isto sao relidas no lote que precisa delas. */
export const IDADE_DAS_CLAIMS_MS = 60000
/** O plano com mais idade que isto e relido no lote que precisa dele. */
export const IDADE_DO_PLANO_MS = 300000

const ID_DE_CLAIM = /^C\d+$/
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
/** O rotulo de `touch_paths` de uma tarefa nos formatos em uso nos planos; o grupo 1 e o resto da linha. */
const ROTULO_DE_TOUCH_PATHS = /^\s*(?:[-*+]\s+)?(?:\*\*touch_paths:?\*\*\s*:?|`touch_paths`\s*:|touch_paths\s*:)\s*(.*)$/i
/** Linha que abre outro item de lista, cabecalho ou cerca de codigo (a mesma regra do verify da tarefa no nucleo). */
const ABRE_BLOCO = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```|~~~)/
const TRECHO = /`([^`]+)`/g

export class ErroDeCarga extends Error {}

/** Os argumentos de cada ferramenta da lista fechada para a thread do despacho. */
export function argsDaFerramenta(ferramenta: string, thread: string): Record<string, unknown> {
  if (!ID_DE_THREAD.test(thread)) throw new ErroDeCarga('ork-freio: id de thread invalido')
  if (ferramenta === FERRAMENTA_DAS_CLAIMS) return { threadId: thread }
  if (ferramenta === FERRAMENTA_DO_PLANO) return { threadId: thread, tipo: 'plan' }
  throw new ErroDeCarga(`ork-freio: ferramenta fora da lista fechada: ${ferramenta}`)
}

/** O JSON do primeiro bloco de texto de um resultado MCP; resultado com erro vira excecao. */
export function jsonDoMcp(r: unknown, ferramenta: string): unknown {
  const resultado = r as { content?: ReadonlyArray<{ type?: string; text?: unknown }>; isError?: boolean } | null
  const texto = (resultado?.content ?? []).find(c => c?.type === 'text' && typeof c.text === 'string')?.text as string | undefined
  if (resultado?.isError) throw new ErroDeCarga(`ork-freio: ${ferramenta} respondeu com erro${texto ? `: ${texto.slice(0, 200)}` : ''}`)
  if (texto === undefined) throw new ErroDeCarga(`ork-freio: ${ferramenta} nao devolveu texto`)
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErroDeCarga(`ork-freio: ${ferramenta} devolveu texto que nao e JSON`)
  }
}

/** Caminho relativo normalizado: barras para a frente, sem `./` na frente nem barra no fim. */
export function normalizar(caminho: string): string {
  return caminho.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
}

/**
 * As claims nao retiradas, com o que o Freio precisa: id, arquivo e comandos. O `claims.jsonl` e append-only e
 * o nucleo ja devolve a versao mais nova de cada claim; se vier repetida, a ultima vence do mesmo jeito.
 */
export function claimsDoNucleo(bruto: unknown): FreioClaim[] {
  if (!Array.isArray(bruto)) throw new ErroDeCarga('ork-freio: a lista de claims nao e lista')
  const porId = new Map<string, FreioClaim | null>()
  for (const item of bruto) {
    const c = item as { id?: unknown; arquivo?: unknown; verificar?: unknown; estado?: unknown } | null
    if (!c || typeof c.id !== 'string' || !ID_DE_CLAIM.test(c.id)) continue
    if (c.estado === 'retirada') { porId.set(c.id, null); continue }
    const comandos = Array.isArray(c.verificar) ? c.verificar.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []
    const arquivo = typeof c.arquivo === 'string' && c.arquivo.trim() !== '' ? normalizar(c.arquivo) : null
    porId.set(c.id, { id: c.id, arquivo, comandos })
  }
  return [...porId.values()].filter((c): c is FreioClaim => c !== null)
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
}

/** O texto do plano que o `ork_artifact_read` devolve, ou `null` quando a thread ainda nao tem plano. */
export function textoDoPlano(bruto: unknown): string | null {
  const documento = bruto as { tipo?: unknown; conteudo?: unknown } | null
  if (!documento || typeof documento !== 'object') throw new ErroDeCarga('ork-freio: o plano lido nao e objeto')
  return typeof documento.conteudo === 'string' ? documento.conteudo : null
}

function ehCaminho(texto: string): boolean {
  return texto !== '' && !/\s/.test(texto) && !texto.startsWith('-') && !texto.split('/').includes('..')
}

/**
 * A uniao dos `touch_paths` de todas as tarefas do plano (D9): os trechos entre crases do item do rotulo inteiro,
 * como o Markdown o junta e como o nucleo le o verify da tarefa: a linha do rotulo, as linhas mais recuadas que
 * ela (sub-itens e continuacao quebrada) e a continuacao logo abaixo que nao abre outro bloco. `null` sem plano
 * ou sem nenhum caminho.
 */
export function touchPathsDoPlano(conteudo: string | null): string[] | null {
  if (typeof conteudo !== 'string') return null
  const achados = new Set<string>()
  const juntar = (texto: string) => {
    for (const m of texto.matchAll(TRECHO)) {
      const caminho = normalizar(m[1] as string)
      if (ehCaminho(caminho)) achados.add(caminho)
    }
  }
  let recuoDoRotulo = -1
  let depoisDeBranco = false
  for (const linha of conteudo.replace(/\r\n/g, '\n').split('\n')) {
    const recuo = linha.length - linha.trimStart().length
    const rotulo = ROTULO_DE_TOUCH_PATHS.exec(linha)
    if (rotulo) {
      juntar(rotulo[1] as string)
      recuoDoRotulo = recuo
      depoisDeBranco = false
      continue
    }
    if (recuoDoRotulo < 0) continue
    if (linha.trim() === '') { depoisDeBranco = true; continue }
    if (recuo <= recuoDoRotulo && (depoisDeBranco || ABRE_BLOCO.test(linha))) { recuoDoRotulo = -1; continue }
    juntar(linha)
    depoisDeBranco = false
  }
  return achados.size > 0 ? [...achados].sort() : null
}

/** O status da thread na secao `threads` do retrato `ork.maestro-snapshot/v1`, ou `null` quando ele nao diz. */
export function statusNoRetrato(retrato: unknown, thread: string): string | null {
  const itens = (retrato as { sections?: { threads?: { items?: unknown } } } | null)?.sections?.threads?.items
  if (!Array.isArray(itens)) return null
  const item = itens.find(i => (i as { id?: unknown } | null)?.id === thread) as { status?: unknown } | undefined
  return typeof item?.status === 'string' ? item.status : null
}

/** O Freio age na thread? So deixa de agir com a thread fechada no retrato (D10). */
export function threadAtiva(status: string | null): boolean {
  return status !== 'fechada'
}

/** A carga de uma thread antes da primeira leitura. */
export function cargaVazia(thread: string): FreioCarga {
  return { thread, statusDaThread: null, claims: null, claimsEm: 0, touchPaths: null, planoLido: false, planoEm: 0, erros: [] }
}

/** As claims precisam ser relidas: nunca lidas, velhas, ou o lote mexeu nelas. */
export function claimsVelhas(carga: FreioCarga, agora: number, loteMexeuNasClaims: boolean): boolean {
  return carga.claims === null || loteMexeuNasClaims || !(agora - carga.claimsEm >= 0 && agora - carga.claimsEm < IDADE_DAS_CLAIMS_MS)
}

/** O plano precisa ser relido: nunca lido, velho, ou o lote o regravou. */
export function planoVelho(carga: FreioCarga, agora: number, loteMexeuNoPlano: boolean): boolean {
  return !carga.planoLido || loteMexeuNoPlano || !(agora - carga.planoEm >= 0 && agora - carga.planoEm < IDADE_DO_PLANO_MS)
}
