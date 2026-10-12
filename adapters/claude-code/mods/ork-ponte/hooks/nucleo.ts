// A leitura do nucleo pela ponte (RM-059, T0.3; D3 e D10 da thread). Modulo puro: monta o pedido ao
// `ork_maestro`, a lista fechada de consultas do CLI e o cache por `stat`. As chamadas ao `$` ficam
// no register.ts. Dados so pelo nucleo: nada aqui le ou escreve estado em `.orkastery/`.
import type { OrkAssinatura, OrkConsulta, OrkPedidoDeLeitura, OrkPedidoDeRetrato, OrkRetratoGuardado, OrkSecao } from '../types'

export const SERVIDOR = 'orkastery'
export const FERRAMENTA_DO_RETRATO = 'ork_maestro'
/** Teto de cada consulta pelo CLI (D10): o mesmo teto total do retrato no nucleo. */
export const TETO_DO_CLI_MS = 10000
/** O cache vale enquanto os ledgers cobertos nao mudam, e nunca por mais que isto. */
export const TETO_DO_CACHE_MS = 60000
export const TETO_DE_ENTRADAS = 16
export const TETO_DE_LEDGERS = 50
/** As secoes do `ork.maestro-snapshot/v1` (core/src/maestro-contract.ts). */
export const SECOES: readonly OrkSecao[] = ['portfolio', 'demands', 'threads', 'sessions', 'blockers', 'leases',
  'retries', 'hitl', 'ship', 'master', 'nextActions']

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

/** A lista fechada de consultas de leitura (D10): o argv depois de `ork`, e se exige thread. */
export const CONSULTAS: Readonly<Record<OrkConsulta, { argv: readonly string[]; exigeThread: boolean }>> = {
  'maestro': { argv: ['maestro', '--json'], exigeThread: false },
  'thread.status': { argv: ['thread', 'status', '<thread>', '--json'], exigeThread: true },
  'thread.list': { argv: ['thread', 'list', '--json'], exigeThread: false },
  'conducao.status': { argv: ['conducao', 'status', '<thread>', '--json'], exigeThread: true },
  'retry.plan': { argv: ['retry', 'plan', '<thread>', '--json'], exigeThread: true },
  'retry.list': { argv: ['retry', 'list', '--json'], exigeThread: false },
  'pulse': { argv: ['pulse', '--json'], exigeThread: false },
  'orquestracao.status': { argv: ['orquestracao', 'status', '--json'], exigeThread: false },
  'sessions.hitl': { argv: ['sessions', 'hitl', '--json'], exigeThread: false },
  'roadmap.status': { argv: ['roadmap', 'status', '--json'], exigeThread: false },
  'accounts.esgotamentos': { argv: ['accounts', 'esgotamentos', '--json'], exigeThread: false },
  'decisao.placar': { argv: ['decisao', 'placar', '<thread>', '--json'], exigeThread: true },
}

export class ErroDeLeitura extends Error {}

function conferirThread(thread: unknown): string | undefined {
  if (thread === undefined) return undefined
  if (typeof thread !== 'string' || !ID_DE_THREAD.test(thread)) throw new ErroDeLeitura('ork-ponte: id de thread invalido')
  return thread
}

/** Confere o pedido de retrato: secao conhecida, offset inteiro e so junto da secao. */
export function conferirPedidoDeRetrato(p: OrkPedidoDeRetrato | undefined): OrkPedidoDeRetrato {
  const pedido = p ?? {}
  const thread = conferirThread(pedido.thread)
  if (pedido.secao !== undefined && !SECOES.includes(pedido.secao)) throw new ErroDeLeitura(`ork-ponte: secao desconhecida: ${String(pedido.secao)}`)
  if (pedido.offset !== undefined) {
    if (pedido.secao === undefined) throw new ErroDeLeitura('ork-ponte: offset so vale com secao')
    if (!Number.isInteger(pedido.offset) || pedido.offset < 0 || pedido.offset > 100000) throw new ErroDeLeitura('ork-ponte: offset fora da faixa')
  }
  return { ...(thread ? { thread } : {}), ...(pedido.secao ? { secao: pedido.secao, offset: pedido.offset ?? 0 } : {}) }
}

/** Os argumentos do `ork_maestro`: secao e offset andam juntos, como o nucleo exige. */
export function argsDoMaestro(p: OrkPedidoDeRetrato): Record<string, unknown> {
  const a: Record<string, unknown> = {}
  if (p.thread) a.threadId = p.thread
  if (p.secao) { a.section = p.secao; a.offset = p.offset ?? 0 }
  return a
}

/** O argv completo de uma consulta da lista fechada; qualquer outra coisa e recusada. */
export function argvDaConsulta(p: OrkPedidoDeLeitura & { secao?: OrkSecao; offset?: number }): string[] {
  const modelo = Object.prototype.hasOwnProperty.call(CONSULTAS, p.consulta) ? CONSULTAS[p.consulta] : undefined
  if (!modelo) throw new ErroDeLeitura(`ork-ponte: consulta fora da lista fechada: ${String(p.consulta)}`)
  const thread = conferirThread(p.thread)
  if (modelo.exigeThread && !thread) throw new ErroDeLeitura(`ork-ponte: a consulta ${p.consulta} exige thread`)
  const argv = ['ork', ...modelo.argv.map(a => (a === '<thread>' ? (thread as string) : a))]
  if (p.consulta === 'maestro') {
    const r = conferirPedidoDeRetrato({ thread, secao: p.secao, offset: p.offset })
    if (r.thread) argv.push('--thread', r.thread)
    if (r.secao) argv.push('--section', r.secao, '--offset', String(r.offset ?? 0))
  }
  return argv
}

/** O JSON que o `ork_maestro` devolve no primeiro bloco de texto; recusa resultado com erro. */
export function interpretarMcp(r: { content?: ReadonlyArray<{ type: string; text?: string }>; isError?: boolean }): unknown {
  if (r.isError) throw new ErroDeLeitura('ork-ponte: o ork_maestro respondeu com erro')
  const texto = (r.content ?? []).find(c => c.type === 'text' && typeof c.text === 'string')?.text
  if (texto === undefined) throw new ErroDeLeitura('ork-ponte: o ork_maestro nao devolveu texto')
  return JSON.parse(texto)
}

/** O JSON que o CLI imprime; saida diferente de zero vira erro com o fim do stderr. */
export function interpretarCli(argv: readonly string[], r: { exitCode: number; stdout: string; stderr: string }): unknown {
  if (r.exitCode !== 0) {
    const fim = r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)
    throw new ErroDeLeitura(`ork-ponte: ${argv.slice(0, 3).join(' ')} saiu ${r.exitCode}${fim ? `: ${fim}` : ''}`)
  }
  return JSON.parse(r.stdout)
}

export type Assinatura = OrkAssinatura
export type EntradaDoCache = OrkRetratoGuardado

export function chaveDoPedido(p: OrkPedidoDeRetrato): string {
  return JSON.stringify([p.thread ?? null, p.secao ?? null, p.offset ?? null])
}

function pai(dir: string): string {
  const sem = dir.replace(/\/+$/, '')
  const i = sem.lastIndexOf('/')
  return i <= 0 ? '/' : sem.slice(0, i)
}

function juntar(pasta: string, nome: string): string {
  return pasta.replace(/\/+$/, '') + '/' + nome
}

/** Os ledgers que o retrato cobre: o da thread pedida, ou os das threads da secao `threads` e a pasta delas. */
export function caminhosCobertos(raizDoEstado: string | null, p: OrkPedidoDeRetrato, retrato: unknown): string[] {
  if (!raizDoEstado) return []
  const base = juntar(raizDoEstado, '.orkastery/threads')
  if (p.thread) return [juntar(base, `${p.thread}/ledger.jsonl`)]
  const itens = (retrato as { sections?: { threads?: { items?: Array<{ id?: unknown }> } } } | null)?.sections?.threads?.items ?? []
  const ids = [...new Set(itens.map(i => i.id).filter((id): id is string => typeof id === 'string' && ID_DE_THREAD.test(id)))]
  return [base, ...ids.slice(0, TETO_DE_LEDGERS).map(id => juntar(base, `${id}/ledger.jsonl`))]
}

/** O cache serve so com a mesma assinatura de `stat` e dentro do teto de idade. */
export function cacheValido(e: EntradaDoCache | undefined, atual: Assinatura, agora: number, teto = TETO_DO_CACHE_MS): boolean {
  if (!e || e.caminhos.length === 0) return false
  const idade = agora - e.lidoEm
  if (!(idade >= 0 && idade < teto)) return false
  return JSON.stringify(e.assinatura) === JSON.stringify(atual)
}

/** Guarda a entrada e corta as mais velhas acima do teto de entradas. */
export function guardar(cache: Readonly<Record<string, EntradaDoCache>> | undefined, chave: string, e: EntradaDoCache,
  teto = TETO_DE_ENTRADAS): Record<string, EntradaDoCache> {
  const todas = Object.entries({ ...(cache ?? {}), [chave]: e }).sort((a, b) => b[1].lidoEm - a[1].lidoEm)
  return Object.fromEntries(todas.slice(0, teto))
}

/**
 * Acha a raiz do estado subindo da raiz da sessao ate a pasta com `orkastery.yaml` e `.orkastery/`
 * ao lado (a worktree da thread fica dentro do checkout principal). `existe` vem do register.ts.
 */
export async function subirAteOEstado(raizDaSessao: string, existe: (caminho: string) => Promise<boolean>, niveis = 8): Promise<string | null> {
  let dir = raizDaSessao.replace(/\/+$/, '') || '/'
  for (let i = 0; i <= niveis; i++) {
    if (await existe(juntar(dir, 'orkastery.yaml')) && await existe(juntar(dir, '.orkastery'))) return dir
    const acima = pai(dir)
    if (acima === dir) break
    dir = acima
  }
  return null
}

/** A raiz do checkout principal pelo `git rev-parse --git-common-dir`, quando ele termina em `/.git`. */
export function raizPeloGit(saida: string): string | null {
  const linha = saida.trim().split('\n')[0] ?? ''
  return /^\/.*\/\.git\/?$/.test(linha) ? linha.replace(/\/\.git\/?$/, '') : null
}
