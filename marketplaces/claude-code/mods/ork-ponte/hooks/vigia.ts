// Os caminhos vigiados dos mods do Orkastery (RM-059, T0.4; D7 do plano dos mods e D12 da thread). Os
// `watchPaths` de varios ganchos de `classic.SessionStart` se fundem e a ultima escrita vence: por isso so
// a ponte responde, juntando o que veio de baixo, os padroes do papel e os pedidos dos mods. Modulo puro.
import type { OrkPapel } from '../types'

export const TETO_DE_CAMINHOS = 64
export const TETO_DE_LEDGERS_DO_DONO = 48
export const TETO_POR_MOD = 16
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const NOME_DE_MOD = /^[a-z0-9][a-z0-9-]{0,63}$/

function juntar(pasta: string, nome: string): string {
  return pasta.replace(/\/+$/, '') + '/' + nome
}

export function pastaDasThreads(raizDoEstado: string): string {
  return juntar(raizDoEstado, '.orkastery/threads')
}

export function ledgerDaThread(raizDoEstado: string, thread: string): string {
  return juntar(pastaDasThreads(raizDoEstado), `${thread}/ledger.jsonl`)
}

/** Ids de thread validos entre as entradas da pasta das threads (so pastas). */
export function idsDeThread(entradas: ReadonlyArray<{ name: string; kind: string }>): string[] {
  return entradas.filter(e => e.kind === 'dir' && ID_DE_THREAD.test(e.name)).map(e => e.name).sort()
}

/** Os ledgers mais recentes por `mtimeMs`, com teto; ausente (sem `mtimeMs`) fica de fora. */
export function ledgersRecentes(ledgers: ReadonlyArray<{ caminho: string; mtimeMs?: number }>, teto = TETO_DE_LEDGERS_DO_DONO): string[] {
  return ledgers.filter(l => typeof l.mtimeMs === 'number')
    .sort((a, b) => (b.mtimeMs as number) - (a.mtimeMs as number) || (a.caminho < b.caminho ? -1 : 1))
    .slice(0, teto).map(l => l.caminho)
}

/** O que a ponte vigia por padrao: o ledger da thread na fase; a pasta e os ledgers recentes no dono. */
export function caminhosPadrao(papel: OrkPapel, raizDoEstado: string | null, thread: string | null, recentes: readonly string[]): string[] {
  if (raizDoEstado === null) return []
  if (papel === 'fase') return thread !== null && ID_DE_THREAD.test(thread) ? [ledgerDaThread(raizDoEstado, thread)] : []
  if (papel === 'dono') return [pastaDasThreads(raizDoEstado), ...recentes]
  return []
}

/** Confere e guarda o pedido de um mod: caminhos absolutos, sem `..`, com teto por mod. */
export function registrarPedido(pedidos: Readonly<Record<string, string[]>> | undefined, mod: unknown,
  caminhos: unknown): Record<string, string[]> {
  if (typeof mod !== 'string' || !NOME_DE_MOD.test(mod)) throw new Error('ork-ponte: nome de mod invalido')
  if (!Array.isArray(caminhos)) throw new Error('ork-ponte: caminhos precisa ser uma lista')
  const validos: string[] = []
  for (const c of caminhos) {
    if (typeof c !== 'string' || !c.startsWith('/') || c.split('/').includes('..')) throw new Error('ork-ponte: caminho vigiado precisa ser absoluto e sem ..')
    if (!validos.includes(c)) validos.push(c)
  }
  if (validos.length > TETO_POR_MOD) throw new Error(`ork-ponte: no maximo ${TETO_POR_MOD} caminhos por mod`)
  const todos = { ...(pedidos ?? {}) }
  if (validos.length === 0) delete todos[mod]
  else todos[mod] = validos
  return todos
}

/**
 * O `watchPaths` final: primeiro o que veio de baixo (nunca cortado, nao e da ponte), depois os padroes e
 * os pedidos dos mods em ordem de nome, sem duplicata, ate o teto.
 */
export function fundirCaminhos(deBaixo: readonly string[] | undefined, padrao: readonly string[],
  pedidos: Readonly<Record<string, readonly string[]>> | undefined, teto = TETO_DE_CAMINHOS): string[] {
  const saida: string[] = []
  for (const c of deBaixo ?? []) if (!saida.includes(c)) saida.push(c)
  const limite = Math.max(teto, saida.length)
  const nossos = [...padrao, ...Object.keys(pedidos ?? {}).sort().flatMap(m => (pedidos ?? {})[m] ?? [])]
  for (const c of nossos) {
    if (saida.length >= limite) break
    if (!saida.includes(c)) saida.push(c)
  }
  return saida
}
