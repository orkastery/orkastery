// O papel da sessao (RM-059, D4 do plano dos mods). Modulo puro: so dados entram e saem, para o
// teste do nucleo transpila-lo sem o Claude Code. Nenhum `$` passa por aqui.
import type { OrkPapel } from '../types'

/** So o servidor MCP sem thread registra esta ferramenta (core/src/mcp-server.ts). */
export const FERRAMENTA_DO_DONO = 'mcp__orkastery__ork_request_decision'
export const MANIFESTO_DO_PROJETO = 'orkastery.yaml'
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

export type EntradaDoPapel = {
  /** O `ORK_DISPATCH_ID` que o despacho passa pelo `--settings`. */
  dispatchId: string | undefined
  /** A raiz da sessao tem `orkastery.yaml`. */
  temManifesto: boolean
  /** Os nomes das ferramentas que o modelo tem agora (`$.tool.list()`). */
  ferramentas: readonly string[]
}

/**
 * `fase` com `ORK_DISPATCH_ID`; `dono` sem ele, com `orkastery.yaml` na raiz e o servidor `orkastery`
 * sem thread conectado; `dormente` no resto, quando nenhum gancho da ponte age alem do inicio.
 */
export function decidirPapel(e: EntradaDoPapel): OrkPapel {
  if (typeof e.dispatchId === 'string' && e.dispatchId.trim() !== '') return 'fase'
  if (e.temManifesto && e.ferramentas.includes(FERRAMENTA_DO_DONO)) return 'dono'
  return 'dormente'
}

/** A thread do despacho na sessao de fase, so com id valido; `null` fora dela. */
export function threadDoDespacho(papel: OrkPapel, thread: string | undefined): string | null {
  if (papel !== 'fase' || typeof thread !== 'string') return null
  return ID_DE_THREAD.test(thread) ? thread : null
}

export function idDeThreadValido(thread: unknown): thread is string {
  return typeof thread === 'string' && ID_DE_THREAD.test(thread)
}

/** Junta pasta e nome com uma barra so, sem depender de `node:path` (o mod nao tem Node). */
export function juntar(pasta: string, nome: string): string {
  return pasta.replace(/\/+$/, '') + '/' + nome.replace(/^\/+/, '')
}
