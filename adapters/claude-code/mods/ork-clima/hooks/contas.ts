// O cruzamento do Clima de Cota (RM-059, onda 1, F4; T4.2): a previsao das janelas da conta desta sessao
// contra os despachos que dependem de cota, lidos no retrato do nucleo (a fila de retomada e as threads
// paradas por cota), e contra as marcas de esgotamento por conta do registro compartilhado (RM-040). D7 e
// D8 da thread. Modulo puro: le o que a ponte trouxe, classifica e escreve; nenhum `$` passa por aqui.
import type { ClimaEstado, ClimaPrevisao } from '../types'
import { duracao, emAlerta, formatarHora, rotuloDaJanela, textoDaFaixa } from './previsao'

/** Uma retomada da fila do nucleo que ainda vai despachar. */
export type ClimaRetomada = {
  id: string
  thread: string
  estado: 'aguardando' | 'due'
  /** Quando a fila libera, em ms desde a epoca; `null` quando o retrato nao disse. */
  liberaEm: number | null
  tentativas: number | null
}

/** Uma thread cujo ultimo gate reprovado foi por cota. */
export type ClimaParada = { thread: string; motivo: string }

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

export type ClimaLido<T> = { itens: T[]; parcial: boolean }

/** O que o `/clima` cruzou: `null` em `despachos` ou `marcas` quando a leitura falhou. */
export type ClimaCruzamento = {
  despachos: ClimaDespacho[] | null
  paradas: ClimaParada[]
  parcial: boolean
  erroDoRetrato: string | null
  marcas: ClimaMarca[] | null
  erroDoRegistro: string | null
}

/** Os motivos de gate que sao de cota: a politica do nucleo espera a janela ou roda o perfil (D7). */
export const MOTIVOS_DE_COTA: readonly string[] = ['runtime.quota-exhausted', 'runtime.rate-limited']
export const CONTRATO_DOS_ESGOTAMENTOS = 'ork.esgotamentos/v1'
/** Quantas threads que nao cabem a faixa nomeia antes do `e mais N`. */
export const TETO_NA_FAIXA = 3
/** O que o nucleo ja sabe fazer, com os comandos da propria politica dele; o Clima nunca executa (D7). */
export const SUGESTOES: readonly string[] = [
  'esperar a janela: a retomada fica na fila até renovar, e ork retry list mostra a fila;',
  'seguir em outro perfil: ork accounts list mostra os perfis e quem está esgotado, e ork retry run <thread> segue no próximo perfil do rodízio;',
  'adiar a fase: segurar o despacho da fase seguinte até a janela renovar.',
]

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const ID_DE_RETOMADA = /^R[1-9][0-9]{0,8}$/
const CONTA_OPACA = /^[a-f0-9]{12}$/
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

function secaoDoRetrato(retrato: unknown, nome: string): Bruto | null {
  return objeto(objeto(objeto(retrato)?.sections)?.[nome])
}

/** A secao veio inteira: `available` ou `empty`, sem pagina seguinte. */
function inteira(s: Bruto | null): boolean {
  if (s === null) return false
  const proxima = objeto(s.coverage)?.nextOffset
  return (s.state === 'available' || s.state === 'empty') && (proxima === null || proxima === undefined)
}

function itensDa(s: Bruto | null): unknown[] {
  const itens = s?.items
  return Array.isArray(itens) ? itens : []
}

function threadDasRefs(refs: unknown): string | null {
  for (const r of Array.isArray(refs) ? refs : []) {
    const o = objeto(r)
    if (o?.kind === 'thread' && typeof o.id === 'string' && ID_DE_THREAD.test(o.id)) return o.id
  }
  return null
}

/** As retomadas `aguardando` e `due` da secao `retries` do retrato (D7). */
export function retomadasDoRetrato(retrato: unknown): ClimaLido<ClimaRetomada> {
  const s = secaoDoRetrato(retrato, 'retries')
  const itens: ClimaRetomada[] = []
  for (const bruto of itensDa(s)) {
    const i = objeto(bruto)
    if (i === null || typeof i.id !== 'string' || !ID_DE_RETOMADA.test(i.id)) continue
    if (i.status !== 'aguardando' && i.status !== 'due') continue
    const thread = threadDasRefs(i.refs)
    if (thread === null) continue
    const fatos = objeto(i.facts)
    const tentativas = fatos?.attempts
    itens.push({
      id: i.id, thread, estado: i.status, liberaEm: instante(fatos?.availableAt),
      tentativas: typeof tentativas === 'number' && Number.isInteger(tentativas) && tentativas >= 0 ? tentativas : null,
    })
  }
  return { itens, parcial: !inteira(s) }
}

/** As threads paradas por cota, da secao `blockers` do retrato (D7). */
export function paradasDoRetrato(retrato: unknown): ClimaLido<ClimaParada> {
  const s = secaoDoRetrato(retrato, 'blockers')
  const itens: ClimaParada[] = []
  for (const bruto of itensDa(s)) {
    const i = objeto(bruto)
    const motivo = objeto(i?.facts)?.reason
    if (i === null || typeof motivo !== 'string' || !MOTIVOS_DE_COTA.includes(motivo)) continue
    const thread = threadDasRefs(i.refs)
    if (thread !== null && !itens.some(p => p.thread === thread)) itens.push({ thread, motivo })
  }
  return { itens, parcial: !inteira(s) }
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
      esgotadoAte: instante(m.esgotadoAte), projeto: texto(m.projeto, 80) ?? 'nao registrado',
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
 * um deles; `cabe`, com a folga ate o primeiro esgotamento, quando despacha antes; `depois-de-renovar`
 * quando todos ja renovaram. Sem janela em alerta, `cabe` sem folga.
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

/** Uma retomada no `/clima` e no registro do mostrado. */
export function textoDoDespacho(d: ClimaDespacho, fuso: string, agora: number): string {
  const volta = d.quando <= agora ? 'volta agora' : `volta ${formatarHora(d.quando, fuso, agora)}`
  const quem = `${d.retomada.id} da ${d.retomada.thread} ${volta}`
  const janela = d.janela === null ? 'a janela' : `a janela de ${rotuloDaJanela(d.janela)}`
  if (d.classe === 'nao-cabe') {
    const acaba = d.estadoDaJanela === 'esgotada' || d.acabaEm === null ? 'já se esgotou' : `acaba ~${formatarHora(d.acabaEm, fuso, agora)}`
    const renova = d.renovaEm === null ? 'não tem hora de renovar' : `renova ${formatarHora(d.renovaEm, fuso, agora)}`
    return `${quem} e não cabe: ${janela} ${acaba} e ${renova}.`
  }
  if (d.classe === 'depois-de-renovar') return `${quem}, depois de ${janela} renovar.`
  if (d.folgaMs !== null) return `${quem}, com ~${duracao(d.folgaMs)} de cota no ritmo atual.`
  return `${quem}.`
}

export function textoDaParada(p: ClimaParada): string {
  return `${p.thread} parada por ${p.motivo}.`
}

export function textoDaMarca(m: ClimaMarca, fuso: string, agora: number): string {
  const prazo = m.esgotadoAte === null ? 'sem prazo' : `até ${formatarHora(m.esgotadoAte, fuso, agora)}`
  return `conta ${m.conta} (${m.runtime}): ${m.estado} ${prazo}, visto em ${m.projeto} (${m.motivo}).`
}

/** O fim da linha da faixa com as threads que nao cabem (D7). */
export function sufixoDaFaixa(despachos: readonly ClimaDespacho[]): string {
  const threads: string[] = []
  for (const d of despachos) if (d.classe === 'nao-cabe' && !threads.includes(d.retomada.thread)) threads.push(d.retomada.thread)
  if (threads.length === 0) return ''
  const nomeadas = threads.slice(0, TETO_NA_FAIXA)
  return `; não cabe: ${nomeadas.join(', ')}${threads.length > nomeadas.length ? ` e mais ${threads.length - nomeadas.length}` : ''}`
}

/** O resumo que o `/clima` registra como mostrado (D8): a linha da faixa, ou que nada pede atencao. */
export function resumoDoClima(previsoes: readonly ClimaPrevisao[], despachos: readonly ClimaDespacho[] | null, fuso: string, agora: number): string {
  return textoDaFaixa(previsoes, fuso, agora, sufixoDaFaixa(despachos ?? [])) ?? 'nenhuma janela pede atenção'
}

/** As linhas do cruzamento no `/clima`: despachos, paradas, contas do registro e, se algo aperta, as sugestoes. */
export function linhasDoCruzamento(c: ClimaCruzamento, previsoes: readonly ClimaPrevisao[], fuso: string, agora: number): string[] {
  const linhas = ['Despachos que dependem da cota (retrato do núcleo):']
  if (c.despachos === null) linhas.push(`- Retrato do núcleo indisponível (${c.erroDoRetrato ?? 'sem resposta'}).`)
  else {
    for (const d of c.despachos) linhas.push(`- ${textoDoDespacho(d, fuso, agora)}`)
    for (const p of c.paradas) linhas.push(`- ${textoDaParada(p)}`)
    if (c.despachos.length === 0 && c.paradas.length === 0) linhas.push('- Nenhuma retomada na fila nem thread parada por cota.')
    if (c.parcial) linhas.push('- Retrato parcial: a fila de retomada ou os bloqueios vieram incompletos.')
  }
  linhas.push('Contas no registro do núcleo (ork accounts esgotamentos):')
  if (c.marcas === null) linhas.push(`- Registro de contas indisponível (${c.erroDoRegistro ?? 'fora do contrato ork.esgotamentos/v1'}).`)
  else if (c.marcas.length === 0) linhas.push('- Nenhuma conta marcada no registro.')
  else for (const m of c.marcas) linhas.push(`- ${textoDaMarca(m, fuso, agora)}`)
  const aperta = previsoes.some(emAlerta) || (c.despachos ?? []).some(d => d.classe === 'nao-cabe') || c.paradas.length > 0
  if (aperta) linhas.push('O que o núcleo já sabe fazer:', ...SUGESTOES.map(s => `- ${s}`))
  return linhas
}
