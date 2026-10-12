// Os avisos da Sentinela (RM-059, fatia F6, T6.3). Módulo puro: do `ork pulse --json` (pela ponte), o que só o dono
// resolve e o que está parado no condutor fora do que o condutor externo ou a própria Sentinela fazem sozinhos, cada um
// com o próximo passo que o próprio núcleo dá. Em #Auto, nunca o comando de pedir gate: o núcleo o recusa no modo sem
// pausa humana (D7). O que vira aviso, e uma vez só por texto, sai daqui; as chamadas ao `$` ficam no register.ts.
import type { SentinelaPasso } from '../types'

export const CONTRATO_DO_PULSE = 'ork.pulse/v1'
/** O pulse lê a fábrica inteira (e a forja): a cada 5 min, como resumo, e não a cada ledger que muda. */
export const PERIODO_DO_PULSE_MS = 5 * 60 * 1000
/** Numa rodada, no máximo estes avisos novos viram notificação; o resto fica para a seguinte. */
export const TETO_DE_AVISOS_POR_RODADA = 5
export const TITULO = 'Sentinela'
/** Os casos parados no condutor que alguém faz sozinho: o condutor externo publica e mergeia; a Sentinela despacha. */
export const CASOS_DE_OUTRO: readonly string[] = ['sem-push', 'pr-verde', 'fase-seguinte', 'check-sem-veredito']
/** Os motivos que o condutor externo também não leva ao dono: a política do núcleo já reexecuta sozinha. */
export const MOTIVOS_SEM_AVISO: readonly string[] = ['verify.timeout']
const TETO_DO_TEXTO = 300
const PEDIR_GATE = /`?ork gate request[^`;\n]*`?/g

export type Aviso = { chave: string; thread: string | null; texto: string }

function limpar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, TETO_DO_TEXTO)
}

/** Em #Auto o núcleo recusa o pedido de gate: o comando sai do texto, e o aviso diz por quê (D7). */
export function semPedirGate(texto: string, modo: string | null): string {
  if (modo !== 'auto' || !/ork gate request/.test(texto)) return texto
  const sem = texto.replace(PEDIR_GATE, '').replace(/\s+([;,.])/g, '$1').replace(/[:;,]\s*$/, '').replace(/\s+/g, ' ').trim()
  return `${sem}${sem ? ' ' : ''}(em #Auto o núcleo não abre gate; resolva pela ação da thread)`
}

/**
 * Os avisos de um pulse: o que precisa do dono agora, com o comando de resposta do núcleo (ou a recomendação), e o
 * que está parado no condutor fora dos casos que alguém faz sozinho, com o próximo passo do núcleo. Thread que alguém
 * conduz agora não vira aviso (é trabalho em curso, como no condutor externo). Pulse fora do contrato é erro.
 */
export function avisosDoPulse(pulse: unknown, passos: readonly SentinelaPasso[]): Aviso[] {
  const p = pulse as { contrato?: unknown; precisaDeHumanoAgora?: unknown; paradoNoCondutor?: unknown } | null
  if (!p || typeof p !== 'object' || p.contrato !== CONTRATO_DO_PULSE) throw new Error(`o pulse nao e o contrato ${CONTRATO_DO_PULSE}`)
  const modo = new Map(passos.map(x => [x.thread, x.modo]))
  const conduzidas = new Set(passos.filter(x => x.conduzida).map(x => x.thread))
  const avisos: Aviso[] = []
  for (const bruto of Array.isArray(p.precisaDeHumanoAgora) ? p.precisaDeHumanoAgora : []) {
    const i = (bruto ?? {}) as { thread?: unknown; motivo?: unknown; comandoResposta?: unknown; recomendacao?: unknown; pergunta?: unknown }
    const thread = typeof i.thread === 'string' && i.thread ? i.thread : null
    const motivo = typeof i.motivo === 'string' && i.motivo ? i.motivo : 'pendente'
    if (MOTIVOS_SEM_AVISO.includes(motivo) || (thread && conduzidas.has(thread))) continue
    const comando = semPedirGate(typeof i.comandoResposta === 'string' ? i.comandoResposta.trim() : '', thread ? modo.get(thread) ?? null : null)
    const reserva = typeof i.recomendacao === 'string' && i.recomendacao.trim() ? i.recomendacao : typeof i.pergunta === 'string' ? i.pergunta : ''
    const passo = comando || reserva || 'veja o ork pulse'
    avisos.push({ chave: `dono:${thread ?? '-'}:${motivo}`, thread, texto: limpar(`${thread ?? 'fábrica'} (${motivo}): ${passo}`) })
  }
  for (const bruto of Array.isArray(p.paradoNoCondutor) ? p.paradoNoCondutor : []) {
    const x = (bruto ?? {}) as { thread?: unknown; caso?: unknown; proximoPasso?: unknown }
    if (typeof x.thread !== 'string' || !x.thread || typeof x.caso !== 'string' || CASOS_DE_OUTRO.includes(x.caso) || conduzidas.has(x.thread)) continue
    const passo = semPedirGate(typeof x.proximoPasso === 'string' ? x.proximoPasso : '', modo.get(x.thread) ?? null)
    avisos.push({ chave: `parado:${x.thread}:${x.caso}`, thread: x.thread, texto: limpar(`${x.thread} parado no condutor (${x.caso}): ${passo || 'veja o ork pulse'}`) })
  }
  return avisos
}

/** A marca de um aviso no estado: a chave e o texto. Texto novo é aviso novo, como no condutor externo. */
export function marcaDoAviso(a: Aviso): string {
  return `${a.chave}|${a.texto}`
}

/** Os avisos que ainda não foram mostrados ao dono, até o teto da rodada. */
export function avisosNovos(avisos: readonly Aviso[], avisados: readonly string[], teto = TETO_DE_AVISOS_POR_RODADA): Aviso[] {
  const vistos = new Set(avisados)
  const saida: Aviso[] = []
  for (const a of avisos) {
    const marca = marcaDoAviso(a)
    if (vistos.has(marca)) continue
    vistos.add(marca)
    saida.push(a)
    if (saida.length >= teto) break
  }
  return saida
}

/** O aviso de um despacho que a Sentinela não conseguiu fazer: vai ao dono uma vez por turno. */
export function avisoDoDespacho(p: SentinelaPasso, motivo: string): Aviso {
  return { chave: `despacho:${p.thread}:${p.fase}:${p.desdeEm}`, thread: p.thread, texto: limpar(`${p.thread}: a Sentinela não despachou o ${p.fase} (${motivo})`) }
}
