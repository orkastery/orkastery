// O que o Ritual do MASTER le do nucleo (RM-059, fatia F8; ficha M8 do plano dos mods), em funcoes puras: as entregas
// que esperam a nota do dono, saidas da secao `master` do retrato da ponte (D2 da thread ork-rm059ritual), a
// linha da faixa e as claims do replay, saidas do `ork_claims_list`. Nada aqui le `.orkastery/` nem chama o `$`: as
// chamadas ficam no register.tsx. So importa tipos.
import type { RitualClaim, RitualEntrega, RitualQuadro } from '../types'

/** D1: a entrega dos ultimos 7 dias sem nota humana (sem MASTER, com proposta ou aceita por omissao). */
export const JANELA_DIAS = 7
/** A secao `master` vem em paginas de ate 50 itens; mais que isso e retrato quebrado, nao fila. */
export const TETO_DE_PAGINAS = 20
/** O painel mostra no maximo isto; o resto vira aviso com a contagem. */
export const TETO_DE_ENTREGAS = 40
export const TETO_DE_TEXTO = 200
export const SERVIDOR = 'orkastery'
export const QUADRO_VAZIO: RitualQuadro = { entregas: [], lidoEm: null, erro: null, avisos: [], foraDaJanela: 0 }

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const DIA_MS = 86400000

/** Uma linha so, sem caractere de controle e com teto. */
export function umaLinha(v: unknown, teto = TETO_DE_TEXTO): string {
  const s = typeof v === 'string' ? v : v instanceof Error ? v.message : String(v)
  return Array.from(s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('')
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

export function exigirThread(thread: unknown): string {
  if (typeof thread !== 'string' || !ID_DE_THREAD.test(thread)) throw new Error('ork-ritual: id de thread invalido')
  return thread
}

/** O numero com virgula, como o dono le: 3.75 vira "3,75". */
export function numero(n: number): string {
  return String(n).replace('.', ',')
}

/** O JSON do primeiro bloco de texto de uma resposta MCP; a resposta com erro vira erro com o motivo do nucleo. */
export function jsonDoMcp(r: { content?: ReadonlyArray<{ type?: string; text?: string }>; isError?: boolean } | null | undefined): unknown {
  const texto = (r?.content ?? []).find(c => c.type === 'text' && typeof c.text === 'string')?.text
  if (!r || r.isError) {
    let motivo = 'o núcleo respondeu com erro'
    try {
      const corpo = JSON.parse(texto ?? '') as { erro?: unknown }
      if (typeof corpo.erro === 'string' && corpo.erro.trim()) motivo = umaLinha(corpo.erro)
    } catch {
      // Sem JSON no corpo do erro: fica o motivo generico.
    }
    throw new Error(motivo)
  }
  if (texto === undefined) throw new Error('o núcleo não devolveu texto')
  return JSON.parse(texto)
}

/** Uma pagina da secao `master` do retrato: os itens, a proxima pagina e as lacunas. */
export function paginaDoMaster(r: unknown): { itens: unknown[]; proxima: number | null; lacunas: string[] } {
  const secao = (r as { retrato?: { sections?: { master?: unknown } } } | null)?.retrato?.sections?.master as
    { items?: unknown; gaps?: unknown; coverage?: { nextOffset?: unknown } } | undefined
  if (!secao || !Array.isArray(secao.items)) throw new Error('o retrato do núcleo não trouxe a seção master')
  const proxima = secao.coverage?.nextOffset
  return {
    itens: secao.items as unknown[],
    proxima: typeof proxima === 'number' && Number.isInteger(proxima) && proxima >= 0 ? proxima : null,
    lacunas: Array.isArray(secao.gaps) ? (secao.gaps as unknown[]).filter((g): g is string => typeof g === 'string').map(g => umaLinha(g, 120)) : [],
  }
}

const textoOuNulo = (v: unknown, teto = TETO_DE_TEXTO): string | null => (typeof v === 'string' && v.trim() ? umaLinha(v, teto) : null)
const numeroOuNulo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * A entrega de um item da secao `master`, quando ela espera a nota do dono: sem MASTER (`pending`), com proposta
 * (`ratificacao-pendente`) ou aceita por omissao (`recorded` com regime `omissao`). Nota humana registrada, item sem
 * entrega ou fora do contrato devolvem null.
 */
export function entregaDoItem(item: unknown): RitualEntrega | null {
  const i = (item ?? {}) as { id?: unknown; status?: unknown; facts?: Record<string, unknown> }
  const m = typeof i.id === 'string' ? /^master:(.+)$/.exec(i.id) : null
  const thread = m && ID_DE_THREAD.test(m[1] as string) ? m[1] as string : null
  const f = i.facts ?? {}
  if (!thread || (i.status !== 'pending' && i.status !== 'ratificacao-pendente' && i.status !== 'recorded')) return null
  if (i.status === 'recorded' && f.regime !== 'omissao') return null
  const entregueEm = typeof f.deliveredAt === 'string' && Number.isFinite(Date.parse(f.deliveredAt)) ? f.deliveredAt : null
  if (!entregueEm) return null
  return {
    thread, status: i.status, regime: textoOuNulo(f.regime, 40), score: numeroOuNulo(f.score), indice: numeroOuNulo(f.index),
    parcelas: textoOuNulo(f.indexDetail) ?? '', reprovacoes: numeroOuNulo(f.reprovals) ?? 0, classes: textoOuNulo(f.classes),
    entregueEm, entregueEmLocal: textoOuNulo(f.deliveredAtLocal, 80),
    merge: typeof f.deliveredSha === 'string' && /^[a-f0-9]{40}$/.test(f.deliveredSha) ? f.deliveredSha : null,
  }
}

/** As entregas da janela, a mais nova primeiro, com o teto do painel; e quantas ficaram fora da janela. */
export function entregasDaJanela(itens: readonly unknown[], agora: number, dias = JANELA_DIAS): { entregas: RitualEntrega[]; fora: number; alemDoTeto: number } {
  const todas = itens.map(entregaDoItem).filter((e): e is RitualEntrega => e !== null)
  const desde = agora - dias * DIA_MS
  const dentro = todas.filter(e => Date.parse(e.entregueEm) >= desde)
    .sort((a, b) => Date.parse(b.entregueEm) - Date.parse(a.entregueEm) || (a.thread < b.thread ? -1 : 1))
  return { entregas: dentro.slice(0, TETO_DE_ENTREGAS), fora: todas.length - dentro.length, alemDoTeto: Math.max(0, dentro.length - TETO_DE_ENTREGAS) }
}

/** O aviso da secao que veio incompleta: uma linha so, com as primeiras lacunas. */
export function avisoDasLacunas(lacunas: readonly string[]): string | null {
  const unicas = [...new Set(lacunas)]
  if (!unicas.length) return null
  const primeiras = unicas.slice(0, 3).join(', ')
  return `o retrato do MASTER veio incompleto: ${plural(unicas.length, 'lacuna', 'lacunas')} (${primeiras}${unicas.length > 3 ? ', ...' : ''})`
}

/** A linha da faixa: quantas entregas esperam a nota e quais; sem nenhuma (ou antes da primeira leitura), sem linha. */
export function textoDaFaixa(q: RitualQuadro): string | undefined {
  if (q.lidoEm === null || !q.entregas.length) return undefined
  const nomes = q.entregas.slice(0, 3).map(e => e.thread)
  const resto = q.entregas.length - nomes.length
  return `${plural(q.entregas.length, 'entrega espera', 'entregas esperam')} a sua nota: ${nomes.join(', ')}${resto > 0 ? ` e +${resto}` : ''} · /nota`
}

/** A thread do ledger que mudou (`classic.FileChanged`), quando o caminho e o ledger de uma thread. */
export function threadDoLedger(caminho: unknown): string | null {
  if (typeof caminho !== 'string') return null
  const m = /\/\.orkastery\/threads\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})\/ledger\.jsonl$/.exec(caminho)
  return m ? m[1] as string : null
}

/** Os argumentos do `ork_claims_list`: so o id da thread. */
export function argsDasClaims(thread: string): { threadId: string } {
  return { threadId: exigirThread(thread) }
}

const numeroDoId = (id: string) => { const m = /^C(\d+)$/.exec(id); return m ? Number(m[1]) : Number.POSITIVE_INFINITY }

/**
 * As claims do `ork_claims_list` (o arquivo e so de acrescimo: a retirada e uma linha nova): o ultimo registro de cada
 * id, as retiradas contadas a parte, na ordem dos ids. Registro fora do contrato fica de fora. Nunca a saida do comando:
 * o nucleo nao a devolve aqui, e o replay nao a mostra (D6).
 */
export function claimsDaProva(resposta: unknown): { claims: RitualClaim[]; retiradas: number } {
  if (!Array.isArray(resposta)) throw new Error('o ork_claims_list não devolveu a lista de claims')
  const ultimas = new Map<string, RitualClaim>()
  for (const bruto of resposta as unknown[]) {
    const c = (bruto ?? {}) as Record<string, unknown>
    if (typeof c.id !== 'string' || !/^C\d+$/.test(c.id) || typeof c.estado !== 'string') continue
    ultimas.set(c.id, {
      id: c.id, estado: umaLinha(c.estado, 40), arquivo: typeof c.arquivo === 'string' ? umaLinha(c.arquivo, 300) : '',
      alegacao: typeof c.alegacao === 'string' ? umaLinha(c.alegacao, 1200) : '',
      comandos: Array.isArray(c.verificar) ? (c.verificar as unknown[]).filter((v): v is string => typeof v === 'string').map(v => umaLinha(v, 600)) : [],
    })
  }
  const todas = [...ultimas.values()].sort((a, b) => numeroDoId(a.id) - numeroDoId(b.id) || (a.id < b.id ? -1 : 1))
  return { claims: todas.filter(c => c.estado !== 'retirada'), retiradas: todas.filter(c => c.estado === 'retirada').length }
}
