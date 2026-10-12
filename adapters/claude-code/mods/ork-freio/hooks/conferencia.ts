// A conferencia pelo nucleo e a devolucao no lote seguinte (RM-059, F2, T2.3). Modulo puro: monta o argv do
// `ork claims conferir`, le o JSON `ork.claims-conferencia/v1`, cuida da rodada, apura o resultado e escreve o
// texto do lote e a linha de status. O Freio nunca roda o comando de uma claim: quem roda e o nucleo, no
// sandbox do verify (D12 do plano dos mods), e quem verifica de verdade continua sendo o `ork verify`.
import type { FreioEntrega, FreioFalha, FreioRodada, FreioVigia } from '../types'

export const FORMATO_DA_CONFERENCIA = 'ork.claims-conferencia/v1'
/** O prazo total pedido ao nucleo, em segundos (o padrao do `ork claims conferir`, D6). */
export const PRAZO_DA_CONFERENCIA_S = 180
/** O vigia do mod: a conferencia que passar disto e encerrada e fica sem veredito (D6, D7). */
export const VIGIA_DA_CONFERENCIA_MS = 240000
/** Claims por rodada; so uma rodada roda por vez (D5). */
export const TETO_POR_RODADA = 6
/** A pausa depois de uma conferencia indisponivel (D7). */
export const PAUSA_SEM_CONFERENCIA_MS = 600000
/** Tetos do texto ao modelo (D8). */
export const TETO_DE_CLAIMS_NO_TEXTO = 3
export const TETO_DE_LINHAS_DA_SAIDA = 12
export const TETO_DE_CARACTERES_DA_SAIDA = 1200
export const TETO_DO_TEXTO = 6000
/** O que o mod guarda da saida do processo: o JSON inteiro cabe com folga; do stderr, so o fim. */
export const TETO_DA_SAIDA_LIDA = 4194304
export const TETO_DO_ERRO_LIDO = 2000

const ID_DE_CLAIM = /^C\d+$/
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

/** Uma claim como a conferencia a devolveu, so com o que o Freio entrega. */
export type ItemConferido = {
  id: string
  alegacao: string
  arquivo: string | null
  verificado: boolean
  motivo: string | null
  comando: string
  codigo: number | null
  fim: string
}

/** A leitura de uma rodada: o resultado do nucleo, a conferencia indisponivel ou o vigia do mod vencido. */
export type Leitura = { tipo: 'resultado'; itens: ItemConferido[] } | { tipo: 'indisponivel'; motivo: string } | { tipo: 'prazo' }

/** O argv do `ork claims conferir` de uma rodada; o comando das claims fica com o nucleo. */
export function argvDaConferencia(thread: string, ids: readonly string[]): string[] {
  if (!ID_DE_THREAD.test(thread)) throw new Error('ork-freio: id de thread invalido')
  if (ids.length === 0 || ids.some(id => !ID_DE_CLAIM.test(id))) throw new Error('ork-freio: ids de claim invalidos')
  return ['ork', 'claims', 'conferir', thread, '--claims', ids.join(','), '--prazo', String(PRAZO_DA_CONFERENCIA_S), '--json']
}

/** Junta um pedaco da saida, ate o teto; do stderr fica so o fim. */
export function acumular(atual: string, pedaco: string, doErro: boolean): string {
  const junto = atual + pedaco
  if (doErro) return junto.length > TETO_DO_ERRO_LIDO ? junto.slice(-TETO_DO_ERRO_LIDO) : junto
  return junto.length > TETO_DA_SAIDA_LIDA ? junto.slice(0, TETO_DA_SAIDA_LIDA) : junto
}

const ultimaLinha = (texto: string) => texto.trim().split('\n').filter(l => l.trim() !== '').slice(-1)[0]?.trim().slice(0, 300) ?? ''

function itemDoNucleo(bruto: unknown): ItemConferido | null {
  const i = bruto as { id?: unknown; alegacao?: unknown; arquivo?: unknown; verificado?: unknown; motivo?: unknown; execucoes?: unknown } | null
  if (!i || typeof i.id !== 'string' || !ID_DE_CLAIM.test(i.id)) return null
  const execucoes = Array.isArray(i.execucoes) ? i.execucoes as Array<{ comando?: unknown; ok?: unknown; code?: unknown; fim?: unknown }> : []
  const chave = execucoes.find(x => x && x.ok === false) ?? execucoes[0]
  return {
    id: i.id,
    alegacao: typeof i.alegacao === 'string' ? i.alegacao : '',
    arquivo: typeof i.arquivo === 'string' ? i.arquivo : null,
    verificado: i.verificado === true,
    motivo: typeof i.motivo === 'string' ? i.motivo : null,
    comando: typeof chave?.comando === 'string' ? chave.comando : '',
    codigo: typeof chave?.code === 'number' ? chave.code : null,
    fim: typeof chave?.fim === 'string' ? chave.fim : '',
  }
}

/**
 * A saida do `ork claims conferir --json` (D6, D7): o resultado so com o formato certo, itens em lista e saida
 * 0 ou 1; saida 2 com `erro`, outra saida ou JSON fora do formato (um `ork` antigo) e conferencia indisponivel.
 */
export function lerConferencia(stdout: string, codigo: number | null, stderr: string): Leitura {
  let j: { formato?: unknown; itens?: unknown; erro?: unknown } | null = null
  try { j = JSON.parse(stdout) } catch { j = null }
  if (j && j.formato === FORMATO_DA_CONFERENCIA && Array.isArray(j.itens) && (codigo === 0 || codigo === 1)) {
    return { tipo: 'resultado', itens: j.itens.map(itemDoNucleo).filter((i): i is ItemConferido => i !== null) }
  }
  if (j && typeof j.erro === 'string' && j.erro.trim() !== '') return { tipo: 'indisponivel', motivo: j.erro.trim().slice(0, 300) }
  // JSON que nao serve nao vira motivo: o fim do stderr diz mais; texto solto (um `ork` antigo) entra pelo fim.
  const motivo = ultimaLinha(stderr) || (j === null ? ultimaLinha(stdout) : '') || `saiu com codigo ${codigo ?? 'desconhecido'}`
  return { tipo: 'indisponivel', motivo: `ork claims conferir sem resultado: ${motivo}` }
}

export function entregaVazia(): FreioEntrega {
  return { falhas: [], semVeredito: [], recuperadas: [], indisponivel: null }
}

/** A vigia com os campos da conferencia preenchidos (a vigia gravada antes deles nasce sem eles). */
export function comConferencia(v: FreioVigia): Required<FreioVigia> {
  return {
    rodada: null, entrega: entregaVazia(), emRisco: [], pausaAte: 0, indisponivel: null, avisouIndisponivel: false,
    ...v,
  } as Required<FreioVigia>
}

/** Abre a rodada: tira da fila ate o teto, se nao ha rodada aberta nem pausa; a rodada aberta segue como esta. */
export function iniciarRodada(vigia: FreioVigia, agora: number, teto = TETO_POR_RODADA): Required<FreioVigia> {
  const v = comConferencia(vigia)
  if (v.rodada || v.fila.length === 0 || agora < v.pausaAte) return v
  const escolhidos = v.fila.slice(0, teto)
  const rodada: FreioRodada = { ids: escolhidos.map(p => p.id), caminhos: Object.fromEntries(escolhidos.map(p => [p.id, [...p.caminhos]])), inicio: v.seq }
  return { ...v, fila: v.fila.slice(teto), rodada }
}

/** A claim teve arquivo tocado depois do inicio da rodada: o resultado dela e velho (D6). */
function velha(v: Required<FreioVigia>, rodada: FreioRodada, id: string): boolean {
  return (rodada.caminhos[id] ?? []).some(c => (v.toques[c] ?? 0) > rodada.inicio)
}

/** Fecha a rodada com a leitura: quebra, sem veredito, recuperada, indisponivel e o que fica em risco (D6, D7). */
export function fecharRodada(vigia: FreioVigia, leitura: Leitura, agora: number): Required<FreioVigia> {
  const v = comConferencia(vigia)
  const rodada = v.rodada
  if (!rodada) return v
  if (leitura.tipo === 'indisponivel') {
    return {
      ...v, rodada: null, fila: [], pausaAte: agora + PAUSA_SEM_CONFERENCIA_MS, indisponivel: leitura.motivo,
      entrega: v.avisouIndisponivel ? v.entrega : { ...v.entrega, indisponivel: leitura.motivo }, avisouIndisponivel: true,
    }
  }
  const falhas = new Map(v.entrega.falhas.map(f => [f.id, f]))
  const semVeredito = new Map(v.entrega.semVeredito.map(s => [s.id, s]))
  const recuperadas = new Set(v.entrega.recuperadas)
  const emRisco = new Set(v.emRisco)
  const semVez = (id: string, motivo: string) => { semVeredito.set(id, { id, motivo }); falhas.delete(id) }
  if (leitura.tipo === 'prazo') {
    for (const id of rodada.ids) if (!velha(v, rodada, id)) semVez(id, 'prazo do Freio')
  } else {
    for (const item of leitura.itens) {
      if (!rodada.ids.includes(item.id) || velha(v, rodada, item.id)) continue
      if (item.verificado) {
        falhas.delete(item.id)
        semVeredito.delete(item.id)
        if (emRisco.delete(item.id)) recuperadas.add(item.id)
      } else if (item.motivo === 'claims.failed') {
        const falha: FreioFalha = { id: item.id, alegacao: item.alegacao, arquivo: item.arquivo, comando: item.comando, codigo: item.codigo, fim: item.fim }
        falhas.set(item.id, falha)
        semVeredito.delete(item.id)
        recuperadas.delete(item.id)
        emRisco.add(item.id)
      } else semVez(item.id, item.motivo ?? 'sem motivo')
    }
  }
  return {
    ...v, rodada: null, indisponivel: null, emRisco: [...emRisco],
    entrega: { ...v.entrega, falhas: [...falhas.values()], semVeredito: [...semVeredito.values()], recuperadas: [...recuperadas] },
  }
}

/** Tira a entrega da vigia para o lote devolver: a vigia fica com a entrega vazia. */
export function tomarEntrega(vigia: FreioVigia): { vigia: Required<FreioVigia>; entrega: FreioEntrega } {
  const v = comConferencia(vigia)
  return { vigia: { ...v, entrega: entregaVazia() }, entrega: v.entrega }
}

/** O fim da saida de uma claim: as ultimas linhas e o ultimo trecho, dentro dos tetos (D8). */
export function fimDaSaida(fim: string): string[] {
  let texto = fim.replace(/\s+$/, '')
  if (texto.length > TETO_DE_CARACTERES_DA_SAIDA) texto = texto.slice(-TETO_DE_CARACTERES_DA_SAIDA)
  return texto.split('\n').slice(-TETO_DE_LINHAS_DA_SAIDA)
}

const lista = (ids: readonly string[]) => ids.join(', ')

/** O texto que o lote devolve ao modelo (D8); sem novidade, nenhum texto. */
export function textoDaEntrega(e: FreioEntrega): string {
  const partes: string[] = []
  const n = e.falhas.length
  if (n > 0) {
    partes.push(`Freio de Lote: a conferencia do nucleo reprovou ${n === 1 ? '1 claim ligada' : `${n} claims ligadas`} ao que voce mexeu (ork claims conferir, no sandbox do verify, sem recibo).`)
    for (const f of e.falhas.slice(0, TETO_DE_CLAIMS_NO_TEXTO)) {
      partes.push(`- ${f.id}${f.arquivo ? ` (${f.arquivo})` : ''}: ${f.alegacao}`)
      partes.push(`  comando: ${f.comando}`)
      partes.push(`  saiu com codigo ${f.codigo ?? 'desconhecido'}; fim da saida:`)
      for (const linha of fimDaSaida(f.fim)) partes.push(`  | ${linha}`)
    }
    if (n > TETO_DE_CLAIMS_NO_TEXTO) partes.push(`- e mais ${n - TETO_DE_CLAIMS_NO_TEXTO}: ${lista(e.falhas.slice(TETO_DE_CLAIMS_NO_TEXTO).map(f => f.id))}`)
    partes.push('Rode o comando para confirmar: teste que cria processo pode reprovar no sandbox e passar no ork verify, que continua sendo quem verifica.')
  }
  if (e.recuperadas.length > 0) {
    partes.push(`Freio de Lote: ${lista(e.recuperadas)} ${e.recuperadas.length === 1 ? 'voltou' : 'voltaram'} a passar na conferencia do nucleo.`)
  }
  if (e.semVeredito.length > 0) {
    const motivos = [...new Set(e.semVeredito.map(s => s.motivo))]
    partes.push(`Freio de Lote: a conferencia de ${lista(e.semVeredito.map(s => s.id))} terminou sem veredito (${motivos.join(', ')}); o ork verify decide.`)
  }
  if (e.indisponivel) {
    partes.push(`Freio de Lote: a conferencia das claims esta indisponivel nesta sessao (${e.indisponivel}). O Freio segue sem conferir; o ork verify continua valendo.`)
  }
  const texto = partes.join('\n')
  return texto.length > TETO_DO_TEXTO ? `${texto.slice(0, TETO_DO_TEXTO - 40)}\n(texto cortado pelo Freio de Lote)` : texto
}

/** A linha de status do Freio (D8); `undefined` limpa a linha. */
export function textoDoStatus(vigia: FreioVigia, agora: number): string | undefined {
  const v = comConferencia(vigia)
  if (v.indisponivel && agora < v.pausaAte) return 'freio: conferencia indisponivel'
  if (v.rodada) return `freio: conferindo ${lista(v.rodada.ids)}`
  const n = v.emRisco.length
  if (n > 0) return `freio: ${n === 1 ? '1 claim' : `${n} claims`} em risco (${lista(v.emRisco.slice(0, 5))}${n > 5 ? ', ...' : ''})`
  return undefined
}
