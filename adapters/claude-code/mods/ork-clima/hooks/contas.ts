// O cruzamento do Clima de Cota (RM-059, onda 1, F4; T4.2): a previsao das janelas da conta desta sessao
// contra os despachos que dependem de cota (a fila de retomada inteira, de `ork retry list --json`, e as
// threads abertas paradas por cota, no retrato do nucleo) e contra as marcas de esgotamento por conta do
// registro compartilhado (RM-040). D7, D8 e D13 a D15 da thread. Modulo puro: le o que a ponte trouxe, classifica
// e escreve; nenhum `$` passa por aqui.
import type { ClimaEstado, ClimaNaoCabe, ClimaPrevisao } from '../types'
import { duracao, emAlerta, formatarHora, rotuloDaJanela, textoDaFaixa } from './previsao'

/** Uma retomada da fila do nucleo que ainda vai despachar. */
export type ClimaRetomada = {
  id: string
  thread: string
  /** Quando a fila libera, em ms desde a epoca; `null` quando a fila nao disse. */
  liberaEm: number | null
  tentativas: number | null
}

/** Uma thread aberta cujo ultimo gate reprovado foi por cota. */
export type ClimaParada = { thread: string; motivo: string }

/**
 * O que o retrato trouxe dos bloqueios: as paradas, se a pagina veio cortada e quantas threads ficaram sem ledger
 * (`lacunasCortadas` quando o retrato cortou a lista de lacunas e o numero e um piso).
 */
export type ClimaParadas = { itens: ClimaParada[]; paginaCortada: boolean; lacunas: number; lacunasCortadas: boolean }

/** Uma marca do registro compartilhado de contas (`ork.esgotamentos/v1`), com a conta opaca. */
export type ClimaMarca = {
  conta: string
  runtime: string
  estado: string
  motivo: string
  esgotadoAte: number | null
  projeto: string
}

export type ClimaClasse = 'nao-cabe' | 'cabe' | 'depois-de-renovar'

export type ClimaDespacho = {
  retomada: ClimaRetomada
  /** Quando a retomada despacha: a hora de liberar, ou agora se ja liberou. */
  quando: number
  classe: ClimaClasse
  /** A janela que decide a classe; `null` sem janela em alerta. */
  janela: string | null
  estadoDaJanela: ClimaEstado | null
  acabaEm: number | null
  renovaEm: number | null
  /** Na classe `cabe`, a cota que sobra no ritmo atual ate o primeiro esgotamento. */
  folgaMs: number | null
}

/** O que o `/clima` cruzou: `null` onde a leitura falhou, com o motivo ao lado. */
export type ClimaCruzamento = {
  despachos: ClimaDespacho[] | null
  erroDaFila: string | null
  paradas: ClimaParadas | null
  erroDoRetrato: string | null
  marcas: ClimaMarca[] | null
  erroDoRegistro: string | null
}

/** Os motivos de gate que sao de cota: a politica do nucleo espera a janela ou roda o perfil (D7). */
export const MOTIVOS_DE_COTA: readonly string[] = ['runtime.quota-exhausted', 'runtime.rate-limited']
export const CONTRATO_DOS_ESGOTAMENTOS = 'ork.esgotamentos/v1'
/** O que o nucleo ja sabe fazer, com os comandos da propria politica dele; o Clima nunca executa (D7). */
export const SUGESTOES: readonly string[] = [
  'esperar a janela: a retomada fica na fila até renovar, e ork retry list mostra a fila;',
  'seguir em outro perfil: ork accounts list mostra os perfis e quem está esgotado, e ork retry run <thread> segue no próximo perfil do rodízio;',
  'adiar a fase: segurar o despacho da fase seguinte até a janela renovar.',
]

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const ID_DE_RETOMADA = /^R[1-9][0-9]{0,8}$/
const CONTA_OPACA = /^[a-f0-9]{12}$/
const NAO_REGISTRADO = 'nao registrado'
const ORDEM_DA_CLASSE: Readonly<Record<ClimaClasse, number>> = { 'nao-cabe': 0, 'cabe': 1, 'depois-de-renovar': 2 }

type Bruto = Record<string, unknown>

function objeto(v: unknown): Bruto | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : null
}

function texto(v: unknown, teto: number): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : null
}

function instante(v: unknown): number | null {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * As retomadas que ainda vao despachar, da fila inteira (`ork retry list --json`, D13): a fila e um JSONL so de
 * acrescimo, entao a ultima gravacao de um id vence, e so o estado `aguardando` conta. `null` fora do formato.
 */
export function retomadasDaFila(fila: unknown): ClimaRetomada[] | null {
  if (!Array.isArray(fila)) return null
  const porId = new Map<string, Bruto>()
  for (const bruto of fila) {
    const p = objeto(bruto)
    if (p !== null && typeof p.id === 'string' && ID_DE_RETOMADA.test(p.id)) porId.set(p.id, p)
  }
  const itens: ClimaRetomada[] = []
  for (const p of porId.values()) {
    if (p.estado !== 'aguardando' || typeof p.thread !== 'string' || !ID_DE_THREAD.test(p.thread)) continue
    const tentativas = p.tentativas
    itens.push({
      id: p.id as string, thread: p.thread, liberaEm: instante(p.liberaEm),
      tentativas: typeof tentativas === 'number' && Number.isInteger(tentativas) && tentativas >= 0 ? tentativas : null,
    })
  }
  return itens
}

/** As threads abertas, de `ork thread list --json` (que sem `--todas` so lista as nao fechadas); `null` fora do formato. */
export function threadsAbertas(lista: unknown): string[] | null {
  const threads = objeto(lista)?.threads
  if (!Array.isArray(threads)) return null
  return threads.map(objeto).filter((t): t is Bruto => t !== null && typeof t.id === 'string' && t.status !== 'fechada')
    .map(t => t.id as string)
}

function threadDasRefs(refs: unknown): string | null {
  for (const r of Array.isArray(refs) ? refs : []) {
    const o = objeto(r)
    if (o?.kind === 'thread' && typeof o.id === 'string' && ID_DE_THREAD.test(o.id)) return o.id
  }
  return null
}

/**
 * As threads paradas por cota, da secao `blockers` do retrato (D7), so as abertas quando a lista delas veio
 * (o retrato tambem traz thread fechada). A pagina cortada e a lacuna de ledger sao ditas a parte (D13).
 */
export function paradasDoRetrato(retrato: unknown, abertas: readonly string[] | null): ClimaParadas {
  const s = objeto(objeto(objeto(retrato)?.sections)?.blockers)
  const itens: ClimaParada[] = []
  const lista = s?.items
  for (const bruto of Array.isArray(lista) ? lista : []) {
    const i = objeto(bruto)
    const motivo = objeto(i?.facts)?.reason
    if (i === null || typeof motivo !== 'string' || !MOTIVOS_DE_COTA.includes(motivo)) continue
    const thread = threadDasRefs(i.refs)
    if (thread === null || (abertas !== null && !abertas.includes(thread)) || itens.some(p => p.thread === thread)) continue
    itens.push({ thread, motivo })
  }
  const proxima = objeto(s?.coverage)?.nextOffset
  const gaps = Array.isArray(s?.gaps) ? (s?.gaps as unknown[]).filter((g): g is string => typeof g === 'string') : []
  const lacunas = gaps.filter(g => g.startsWith('ledger.unavailable:')).length
  // O retrato guarda so as primeiras lacunas e conta o resto em `maestro.messages.omitted:N` (D14).
  return { itens, paginaCortada: typeof proxima === 'number', lacunas, lacunasCortadas: gaps.some(g => g.startsWith('maestro.messages.omitted:')) }
}

/** As marcas do registro de contas; `null` quando o relatorio nao e do contrato `ork.esgotamentos/v1`. */
export function marcasDoRelatorio(relatorio: unknown): ClimaMarca[] | null {
  const r = objeto(relatorio)
  if (r === null || r.contrato !== CONTRATO_DOS_ESGOTAMENTOS || !Array.isArray(r.marcas)) return null
  const marcas: ClimaMarca[] = []
  for (const bruta of r.marcas) {
    const m = objeto(bruta)
    if (m === null || typeof m.conta !== 'string' || !CONTA_OPACA.test(m.conta)) continue
    const runtime = texto(m.runtime, 40)
    const estado = texto(m.estado, 40)
    if (runtime === null || estado === null) continue
    marcas.push({
      conta: m.conta, runtime, estado, motivo: texto(m.motivo, 80) ?? 'sem motivo',
      esgotadoAte: instante(m.esgotadoAte), projeto: texto(m.projeto, 80) ?? NAO_REGISTRADO,
    })
  }
  return marcas
}

/** O trecho sem cota de uma janela em alerta: do esgotamento (ou da leitura, se ja esgotou) ate renovar. */
function trechoSemCota(p: ClimaPrevisao): { p: ClimaPrevisao; inicio: number; fim: number } | null {
  if (!emAlerta(p)) return null
  const inicio = p.estado === 'esgotada' ? p.lidaEm : p.acabaEm
  if (inicio === null) return null
  return { p, inicio, fim: p.renovaEm ?? Number.POSITIVE_INFINITY }
}

/**
 * Cada retomada contra os trechos sem cota das janelas em alerta (D7): `nao-cabe` quando despacha dentro de
 * um deles (na hora exata da renovacao a janela ja renovou); `cabe`, com a folga ate o primeiro esgotamento,
 * quando despacha antes; `depois-de-renovar` quando todos ja renovaram. Sem janela em alerta, `cabe` sem folga.
 */
export function cruzar(previsoes: readonly ClimaPrevisao[], retomadas: readonly ClimaRetomada[], agora: number): ClimaDespacho[] {
  const trechos = previsoes.map(trechoSemCota).filter((t): t is NonNullable<ReturnType<typeof trechoSemCota>> => t !== null)
  const despacho = (r: ClimaRetomada, quando: number, classe: ClimaClasse, t: (typeof trechos)[number] | undefined,
    folgaMs: number | null): ClimaDespacho => ({
    retomada: r, quando, classe, janela: t?.p.kind ?? null, estadoDaJanela: t?.p.estado ?? null,
    acabaEm: t?.inicio ?? null, renovaEm: t?.p.renovaEm ?? null, folgaMs,
  })
  return retomadas.map(r => {
    const quando = Math.max(agora, r.liberaEm ?? agora)
    const dentro = trechos.filter(t => quando >= t.inicio && quando < t.fim)
    if (dentro.length > 0) return despacho(r, quando, 'nao-cabe', dentro.reduce((a, b) => (b.fim > a.fim ? b : a)), null)
    const antes = trechos.filter(t => quando < t.inicio)
    if (antes.length > 0) {
      const primeiro = antes.reduce((a, b) => (b.inicio < a.inicio ? b : a))
      return despacho(r, quando, 'cabe', primeiro, primeiro.inicio - quando)
    }
    if (trechos.length > 0) return despacho(r, quando, 'depois-de-renovar', trechos.reduce((a, b) => (b.fim > a.fim ? b : a)), null)
    return despacho(r, quando, 'cabe', undefined, null)
  }).sort((a, b) => ORDEM_DA_CLASSE[a.classe] - ORDEM_DA_CLASSE[b.classe] || a.quando - b.quando)
}

/** As threads das retomadas que nao cabem, sem repetir, na ordem do cruzamento. */
export function threadsQueNaoCabem(despachos: readonly ClimaDespacho[]): string[] {
  const threads: string[] = []
  for (const d of despachos) if (d.classe === 'nao-cabe' && !threads.includes(d.retomada.thread)) threads.push(d.retomada.thread)
  return threads
}

/** Uma retomada no `/clima`. */
export function textoDoDespacho(d: ClimaDespacho, fuso: string, agora: number): string {
  const volta = d.quando <= agora ? 'volta agora' : `volta ${formatarHora(d.quando, fuso, agora)}`
  const quem = `${d.retomada.id} da ${d.retomada.thread} ${volta}`
  const janela = d.janela === null ? 'a janela' : `a janela de ${rotuloDaJanela(d.janela)}`
  if (d.classe === 'nao-cabe') {
    const acaba = d.estadoDaJanela === 'esgotada' || d.acabaEm === null ? 'já esgotou' : `acaba ~${formatarHora(d.acabaEm, fuso, agora)}`
    const renova = d.renovaEm === null ? 'não tem hora de renovar' : `renova ${formatarHora(d.renovaEm, fuso, agora)}`
    return `${quem} e não cabe: ${janela} ${acaba} e ${renova}.`
  }
  if (d.classe === 'depois-de-renovar') return `${quem}, depois de ${janela} renovar.`
  if (d.folgaMs !== null) return `${quem}, com ~${duracao(d.folgaMs)} de cota no ritmo atual.`
  return `${quem}.`
}

/** As retomadas que nao cabiam, como o estado guardou; a entrada fora do formato fica de fora (D15). */
export function naoCabemGuardados(valor: unknown): ClimaNaoCabe[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((n): n is ClimaNaoCabe => !!n && typeof n.id === 'string' && typeof n.thread === 'string'
    && typeof n.texto === 'string' && typeof n.registrada === 'boolean')
}

/** O que vai ao registro do mostrado por retomada que nao cabe: so o que nao muda a cada leitura (D13). */
export function textoDoNaoCabe(d: ClimaDespacho, fuso: string, agora: number): string {
  const janela = d.janela === null ? 'na janela' : `na janela de ${rotuloDaJanela(d.janela)}`
  const renova = d.renovaEm === null ? ', que não tem hora de renovar' : `, que renova ${formatarHora(d.renovaEm, fuso, agora)}`
  return `${d.retomada.id} da ${d.retomada.thread} não cabe ${janela}${renova}.`
}

/** O resumo que o `/clima` registra como mostrado (D8): a linha da faixa, ou que nada pede atencao. */
export function resumoDoClima(previsoes: readonly ClimaPrevisao[], naoCabem: readonly string[], fuso: string, agora: number): string {
  return textoDaFaixa(previsoes, fuso, agora, naoCabem) ?? 'nenhuma janela pede atenção'
}

export function textoDaParada(p: ClimaParada): string {
  return `${p.thread} parada por ${p.motivo}.`
}

export function textoDaMarca(m: ClimaMarca, fuso: string, agora: number): string {
  const prazo = m.esgotadoAte === null ? 'sem prazo' : `até ${formatarHora(m.esgotadoAte, fuso, agora)}`
  const onde = m.projeto === NAO_REGISTRADO ? 'em projeto não registrado' : `em ${m.projeto}`
  return `conta ${m.conta} (${m.runtime}): ${m.estado} ${prazo}, visto ${onde} (${m.motivo}).`
}

/** As linhas do cruzamento no `/clima`: fila, paradas, contas do registro e, se algo aperta, as sugestoes. */
export function linhasDoCruzamento(c: ClimaCruzamento, previsoes: readonly ClimaPrevisao[], fuso: string, agora: number): string[] {
  const linhas = ['Despachos que dependem da cota (fila de retomada do núcleo):']
  if (c.despachos === null) linhas.push(`- Fila de retomada indisponível (${c.erroDaFila ?? 'fora do formato'}).`)
  else if (c.despachos.length === 0) linhas.push('- Nenhuma retomada na fila.')
  else for (const d of c.despachos) linhas.push(`- ${textoDoDespacho(d, fuso, agora)}`)
  linhas.push('Threads abertas paradas por cota (retrato do núcleo):')
  if (c.paradas === null) linhas.push(`- Não deu para conferir as paradas (${c.erroDoRetrato ?? 'sem resposta'}).`)
  else {
    if (c.paradas.itens.length === 0) linhas.push('- Nenhuma.')
    for (const p of c.paradas.itens) linhas.push(`- ${textoDaParada(p)}`)
    if (c.paradas.paginaCortada) linhas.push('- Os bloqueios vieram em mais de uma página; o Clima leu a primeira.')
    if (c.paradas.lacunas > 0) {
      linhas.push(`- O retrato não leu o ledger de ${c.paradas.lacunasCortadas ? 'pelo menos ' : ''}${c.paradas.lacunas} thread(s).`)
    }
  }
  linhas.push('Contas no registro do núcleo (ork accounts esgotamentos):')
  if (c.marcas === null) linhas.push(`- Registro de contas indisponível (${c.erroDoRegistro ?? 'fora do contrato ork.esgotamentos/v1'}).`)
  else if (c.marcas.length === 0) linhas.push('- Nenhuma conta marcada no registro.')
  else for (const m of c.marcas) linhas.push(`- ${textoDaMarca(m, fuso, agora)}`)
  const aperta = previsoes.some(emAlerta) || (c.despachos ?? []).some(d => d.classe === 'nao-cabe') || (c.paradas?.itens.length ?? 0) > 0
  if (aperta) linhas.push('O que o núcleo já sabe fazer:', ...SUGESTOES.map(s => `- ${s}`))
  return linhas
}
