// O registro do que um mod mostrou ao dono (RM-059, M5 do dono; D8 da thread). O Telegram nao deve
// repetir o que o dono ja viu no terminal: a ponte guarda o que foi mostrado num formato versionado, no
// proprio `$.store`, para o nucleo deduplicar depois. Um item por mod, chave e texto. Modulo puro.
import type { OrkCanal, OrkMostrado, OrkRegistroDeMostrados } from '../types'

export const FORMATO_DO_MOSTRADO = 'ork.mod-mostrado/v1'
export const CHAVE_NO_STORE = 'mostrados'
export const TETO_DE_MOSTRADOS = 200
export const TETO_DO_TEXTO_MOSTRADO = 500
export const CANAIS: readonly OrkCanal[] = ['faixa', 'painel', 'notificacao', 'toast', 'status', 'transcript']
const NOME_DE_MOD = /^[a-z0-9][a-z0-9-]{0,63}$/
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

function vazio(): OrkRegistroDeMostrados {
  return { formato: FORMATO_DO_MOSTRADO, itens: [] }
}

/** O registro guardado, ou um vazio se o que estava no store nao e deste formato. */
export function lerRegistro(guardado: unknown): OrkRegistroDeMostrados {
  const r = guardado as Partial<OrkRegistroDeMostrados> | null | undefined
  if (!r || r.formato !== FORMATO_DO_MOSTRADO || !Array.isArray(r.itens)) return vazio()
  return { formato: FORMATO_DO_MOSTRADO, itens: r.itens.filter(i => i && typeof i.mod === 'string' && typeof i.texto === 'string') }
}

/** Confere o que o mod diz ter mostrado. */
export function conferirMostrado(m: unknown): OrkMostrado {
  const x = (m ?? {}) as Record<string, unknown>
  if (typeof x.mod !== 'string' || !NOME_DE_MOD.test(x.mod)) throw new Error('ork-ponte: nome de mod invalido')
  if (typeof x.canal !== 'string' || !CANAIS.includes(x.canal as OrkCanal)) throw new Error(`ork-ponte: canal desconhecido: ${String(x.canal)}`)
  if (typeof x.texto !== 'string' || x.texto.trim() === '') throw new Error('ork-ponte: texto mostrado vazio')
  if (x.chave !== undefined && (typeof x.chave !== 'string' || x.chave.length > 200)) throw new Error('ork-ponte: chave invalida')
  if (x.thread !== undefined && (typeof x.thread !== 'string' || !ID_DE_THREAD.test(x.thread))) throw new Error('ork-ponte: id de thread invalido')
  return {
    mod: x.mod, canal: x.canal as OrkCanal, texto: x.texto,
    ...(x.chave !== undefined ? { chave: x.chave as string } : {}),
    ...(x.thread !== undefined ? { thread: x.thread as string } : {}),
  }
}

/**
 * Acrescenta o que foi mostrado: o mesmo mod, chave e texto so ganham `ultimaVez` e mais uma vez; o resto
 * entra no fim. Acima do teto saem os vistos ha mais tempo.
 */
export function registrarMostrado(guardado: unknown, m: OrkMostrado, agoraIso: string): OrkRegistroDeMostrados {
  const r = lerRegistro(guardado)
  const texto = m.texto.replace(/\s+/g, ' ').trim().slice(0, TETO_DO_TEXTO_MOSTRADO)
  const chave = m.chave ?? null
  const mesmo = (i: OrkRegistroDeMostrados['itens'][number]) => i.mod === m.mod && i.chave === chave && i.texto === texto
  const anterior = r.itens.find(mesmo)
  const resto = r.itens.filter(i => !mesmo(i))
  const item = anterior
    ? { ...anterior, canal: m.canal, ultimaVez: agoraIso, vezes: anterior.vezes + 1 }
    : { mod: m.mod, canal: m.canal, chave, thread: m.thread ?? null, texto, primeiraVez: agoraIso, ultimaVez: agoraIso, vezes: 1 }
  return { formato: FORMATO_DO_MOSTRADO, itens: [...resto, item].slice(-TETO_DE_MOSTRADOS) }
}
