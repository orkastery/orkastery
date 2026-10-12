// O despacho da fase seguinte pela Sentinela (RM-059, fatia F6, T6.2). Módulo puro: quais passos do núcleo despachar
// ou retomar, uma vez por turno, o argv do render, do despacho e da retomada, e a leitura de cada resultado. A
// Sentinela só despacha pelo `ork phase run`, que toma a condução da thread sob a trava do kernel e é idempotente; a
// fase vem do núcleo (`ork conducao sentinela status`), nunca de uma regra daqui, e ela nunca assume a condução.
import type { SentinelaPasso } from '../types'

export const PRAZO_DO_RENDER_MS = 30000
/** O mesmo teto que o condutor externo dá ao `ork phase run`, com folga. */
export const PRAZO_DO_DESPACHO_MS = 200000
export const PRAZO_DA_RETOMADA_MS = 200000
/**
 * A recusa que passa (outro condutor, projeto sem vaga, pedido aberto, falha) não queima o turno: a chave volta e o
 * passo é tentado de novo depois disto. A batida e o adiamento são da Sentinela; quem diz se sai é sempre o núcleo.
 */
export const ADIAMENTO_MS = 3 * 60 * 1000
/** A mesma recusa de novo dobra o adiamento, até este teto: falha que não passa não vira despacho a cada 3 min. */
export const TETO_DO_ADIAMENTO_MS = 30 * 60 * 1000

/** O adiamento da n-ésima recusa seguida do mesmo turno: 3, 6, 12 e 24 min, depois 30. */
export function adiamentoDa(vez: number): number {
  return Math.min(TETO_DO_ADIAMENTO_MS, ADIAMENTO_MS * 2 ** Math.max(0, Math.floor(vez) - 1))
}
/** A linha que o `ork prompt render` imprime quando usa o pedido guardado na criação da thread (T6.0). */
export const MARCA_DO_PEDIDO = '# pedido guardado na criacao da thread'
/** O teto do prompt que o despacho aceita (o mesmo do `ork_phase_run`). */
export const TETO_DO_PROMPT = 65536
export const CANAL = 'claude-code'
/** O `ork retry run` não lê `--canal`: o canal da retomada vai pelo ambiente, como o núcleo o declara (D3). */
export const AMBIENTE_DA_RETOMADA: Readonly<Record<string, string>> = { ORK_CANAL: CANAL }
const FASES: readonly string[] = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER']
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const SESSAO = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
/** Os estados de pedido HITL que ainda esperam o dono no retrato do Maestro. */
const PEDIDO_ABERTO: readonly string[] = ['aberto', 'delivery.uncertain']

type Saida = { exitCode: number; stdout: string; stderr: string }

function exigirThread(thread: unknown): string {
  if (typeof thread !== 'string' || !ID_DE_THREAD.test(thread)) throw new Error('ork-sentinela: id de thread invalido')
  return thread
}

function exigirFase(fase: unknown): string {
  if (typeof fase !== 'string' || !FASES.includes(fase)) throw new Error('ork-sentinela: fase fora do ciclo')
  return fase
}

function ultimaLinha(texto: unknown): string {
  return String(texto ?? '').trim().split('\n').filter(l => l.trim() !== '').slice(-1)[0]?.trim().slice(0, 200) ?? ''
}

function primeiraLinha(texto: unknown): string {
  return String(texto ?? '').trim().split('\n').find(l => l.trim() !== '')?.trim().slice(0, 200) ?? ''
}

/** A chave de um despacho: a thread, a fase e o fim do turno que o pediu. O mesmo turno nunca sai duas vezes. */
export function chaveDoDespacho(p: SentinelaPasso): string | null {
  return p.acao === 'despachar' && p.fase && p.desdeEm ? `${p.thread}|${p.fase}|${p.desdeEm}` : null
}

/** A chave de uma retomada: a thread e o bloqueio. O mesmo bloqueio vai ao `retry plan` uma vez. */
export function chaveDaRetomada(p: SentinelaPasso): string | null {
  return p.acao === 'retomar' && p.bloqueio ? `${p.thread}|${p.bloqueio.motivo}|${p.bloqueio.em}` : null
}

/** Os passos a despachar agora: #Auto, sem condução, com fase do ciclo e turno ainda não despachado. */
export function paraDespachar(passos: readonly SentinelaPasso[], feitos: readonly string[]): SentinelaPasso[] {
  return passos.filter(p => {
    const chave = chaveDoDespacho(p)
    return chave !== null && !p.conduzida && p.modo === 'auto' && ID_DE_THREAD.test(p.thread) && FASES.includes(p.fase as string)
      && !feitos.includes(chave)
  })
}

/** Os passos a levar ao `retry plan` agora: #Auto, sem condução e bloqueio ainda não consultado. */
export function paraRetomar(passos: readonly SentinelaPasso[], feitos: readonly string[]): SentinelaPasso[] {
  return passos.filter(p => {
    const chave = chaveDaRetomada(p)
    return chave !== null && !p.conduzida && p.modo === 'auto' && ID_DE_THREAD.test(p.thread) && !feitos.includes(chave)
  })
}

/** Ninguém conduz a thread: o `ork conducao status --json` (pela ponte) diz `conducao: null`. */
export function conducaoLivre(status: unknown): boolean {
  return !!status && typeof status === 'object' && 'conducao' in status && (status as { conducao: unknown }).conducao === null
}

/** O retrato da thread tem pedido ao dono ainda sem resposta (seção `hitl` do `ork.maestro-snapshot/v1`). */
export function pedidoAbertoNoRetrato(retrato: unknown, thread: string): boolean {
  const itens = (retrato as { sections?: { hitl?: { items?: unknown } } } | null)?.sections?.hitl?.items
  if (!Array.isArray(itens)) return false
  return itens.some(bruto => {
    const i = bruto as { status?: unknown; refs?: unknown; facts?: { target?: unknown } } | null
    if (!i || !PEDIDO_ABERTO.includes(String(i.status)) || i.facts?.target === 'decidido') return false
    return Array.isArray(i.refs) && i.refs.some(r => (r as { kind?: unknown; id?: unknown })?.kind === 'thread' && (r as { id?: unknown }).id === thread)
  })
}

/** O render do prompt da fase com o pedido guardado: sem `--pedido`, o núcleo usa o da criação da thread. */
export function argvDoRender(thread: string, fase: string): string[] {
  return ['ork', 'prompt', 'render', exigirThread(thread), exigirFase(fase)]
}

/** O prompt do render; sem a linha do pedido guardado ele seria o texto de exemplo, e não serve. */
export function promptDoRender(r: Saida): { prompt: string } | { motivo: string } {
  if (r.exitCode !== 0) return { motivo: `o render do prompt saiu ${r.exitCode}${ultimaLinha(r.stderr) ? `: ${ultimaLinha(r.stderr)}` : ''}` }
  if (!r.stdout.split('\n').some(l => l.startsWith(MARCA_DO_PEDIDO))) {
    return { motivo: 'a thread não tem o pedido guardado na criação (ork thread new --pedido): o render cairia no texto de exemplo' }
  }
  const prompt = r.stdout.trimEnd()
  if (prompt.length > TETO_DO_PROMPT) return { motivo: `o prompt tem ${prompt.length} caracteres, acima do teto de ${TETO_DO_PROMPT}` }
  return { prompt }
}

/** O despacho pelo núcleo, com o canal da Sentinela e a correlação que a marca no ledger (D3). */
export function argvDoDespacho(thread: string, fase: string, prompt: string, sessao: string): string[] {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('ork-sentinela: prompt vazio')
  if (typeof sessao !== 'string' || !SESSAO.test(sessao)) throw new Error('ork-sentinela: id de sessao invalido')
  return ['ork', 'phase', 'run', exigirThread(thread), exigirFase(fase), '--prompt', prompt, '--canal', CANAL, '--correlacao', `sentinela:${sessao}`]
}

export type ResultadoDoDespacho = { resultado: 'despachada' | 'repetida' | 'ocupada' | 'falhou'; detalhe: string }

/**
 * O que o `ork phase run` disse. Saída 3: outro condutor conduz a thread, ou o projeto está sem vaga. Saída 1 com
 * `HITL ocupado`: outro despacho tomou a trava do kernel no mesmo instante. Pedido repetido: a sessão de quem já
 * conduz atende. Nenhum desses abre sessão nova, e nenhum é repetido pela Sentinela.
 */
export function lerDespacho(r: Saida): ResultadoDoDespacho {
  if (r.exitCode === 0 && /Pedido ja em andamento|Request already in progress/.test(r.stdout)) {
    return { resultado: 'repetida', detalhe: primeiraLinha(r.stdout) }
  }
  if (r.exitCode === 0) {
    const sessao = /sessionId\s*:\s*([0-9a-f-]{8,})/.exec(r.stdout)?.[1]
    return { resultado: 'despachada', detalhe: sessao ? `sessão ${sessao.slice(0, 8)}` : primeiraLinha(r.stdout) }
  }
  if (r.exitCode === 3) return { resultado: 'ocupada', detalhe: primeiraLinha(r.stdout) || ultimaLinha(r.stderr) }
  if (r.exitCode === 1 && /HITL ocupado/.test(r.stderr)) return { resultado: 'ocupada', detalhe: 'outro despacho tomou a vez no mesmo instante' }
  return { resultado: 'falhou', detalhe: `o despacho saiu ${r.exitCode}${ultimaLinha(r.stderr) ? `: ${ultimaLinha(r.stderr)}` : ''}` }
}

/** O plano do retry declara a retomada automática, sem bloqueio: só ela a Sentinela executa. */
export function retomadaAutomatica(plano: unknown): boolean {
  const p = plano as { automatica?: unknown; bloqueio?: unknown } | null
  return !!p && p.automatica === true && (p.bloqueio === null || p.bloqueio === undefined)
}

/** A retomada pelo núcleo, sem `--por`: no #Auto o retry automático não pede autorização. */
export function argvDaRetomada(thread: string): string[] {
  return ['ork', 'retry', 'run', exigirThread(thread)]
}

export function lerRetomada(r: Saida): { resultado: 'retomada' | 'recusada'; detalhe: string } {
  return r.exitCode === 0 ? { resultado: 'retomada', detalhe: primeiraLinha(r.stdout) }
    : { resultado: 'recusada', detalhe: `o retry saiu ${r.exitCode}${ultimaLinha(r.stderr || r.stdout) ? `: ${ultimaLinha(r.stderr || r.stdout)}` : ''}` }
}
