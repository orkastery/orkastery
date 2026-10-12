// O plano da thread como o Portão de Tarefas o usa (RM-059, fatia F10, T10.1). Módulo puro: interpreta o que o
// `ork_artifact_read` devolve, acha as tarefas `T<id>` com os `touch_paths` e o verify de cada uma pela mesma regra
// do `ork claims conferir --tarefa` do núcleo, tira o id da tarefa do assunto da tarefa nativa, decide a criação e
// lê o escopo no retrato da ponte. As chamadas ao `$` ficam no register.ts; nada aqui lê `.orkastery/` do disco.
import type { PortaoTarefa } from '../types'

export const SERVIDOR = 'orkastery'
/**
 * A lista fechada de ferramentas MCP do Portão: só a leitura do plano. O `$.mcp.call` não pede permissão ao
 * dono, então o teste do núcleo confere pela AST que o mod só chama esta.
 */
export const FERRAMENTA_DO_PLANO = 'ork_artifact_read'
export const FERRAMENTAS_DO_PORTAO: readonly string[] = [FERRAMENTA_DO_PLANO]
/** O plano lido vale por este tempo; sem plano (ou com erro), a leitura se repete depois de pouco. */
export const IDADE_DO_PLANO_MS = 60000
export const IDADE_SEM_PLANO_MS = 5000
/** Quantas tarefas do plano a recusa lista ao modelo, e o teto do texto inteiro. */
export const TETO_DE_TAREFAS_NO_TEXTO = 12
export const TETO_DO_TEXTO = 4000

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
/** O cabeçalho de tarefa do núcleo (`verifyDaTarefa`): `##` a `######`, `T<id>`, e o resto da linha. */
const CABECALHO_DE_TAREFA = /^(#{2,6})\s+T(\d+(?:\.\d+)*)(?=[\s.:)]|$)(.*)$/
/** A linha de verify nos formatos que o núcleo aceita; o grupo 1 é o que vem depois do rótulo. */
const ROTULO_DE_VERIFY = /^\s*(?:[-*]\s+)?(?:\*\*verify:\*\*|\*\*verify\*\*\s*:|`verify`\s*:|verify\s*:)\s*(.*)$/i
/** O rótulo de `touch_paths` nos formatos em uso nos planos (o mesmo da carga do Freio). */
const ROTULO_DE_TOUCH_PATHS = /^\s*(?:[-*+]\s+)?(?:\*\*touch_paths:?\*\*\s*:?|`touch_paths`\s*:|touch_paths\s*:)\s*(.*)$/i
/** Linha que abre outro item de lista, cabeçalho ou cerca de código. */
const ABRE_BLOCO = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```|~~~)/
const TRECHO = /`([^`]+)`/g
/** O id de uma tarefa do plano como palavra própria no assunto (`T2.1 ...`, `[T3]`), nunca colado a letra. */
const ID_NO_ASSUNTO = /(?:^|[^A-Za-z0-9_])T(\d+(?:\.\d+)*)(?![A-Za-z0-9_]|\.\d)/g
/** As fases na ordem do núcleo, com o dígito que o slug do bloco usa (`DIGITO_DA_FASE`). */
const FASES = ['GOAL', 'PLAN', 'GO', 'CHECK', 'SHIP', 'MASTER'] as const

export class ErroDoPlano extends Error {}

/** Os argumentos da leitura do plano da thread do despacho. */
export function argsDoPlano(thread: string): Record<string, unknown> {
  if (!ID_DE_THREAD.test(thread)) throw new ErroDoPlano('ork-portao: id de thread inválido')
  return { threadId: thread, tipo: 'plan' }
}

/** O JSON do primeiro bloco de texto de um resultado MCP; resultado com erro vira exceção. */
export function jsonDoMcp(r: unknown, ferramenta: string): unknown {
  const resultado = r as { content?: ReadonlyArray<{ type?: string; text?: unknown }>; isError?: boolean } | null
  const texto = (resultado?.content ?? []).find(c => c?.type === 'text' && typeof c.text === 'string')?.text as string | undefined
  if (resultado?.isError) throw new ErroDoPlano(`ork-portao: ${ferramenta} respondeu com erro${texto ? `: ${texto.slice(0, 200)}` : ''}`)
  if (texto === undefined) throw new ErroDoPlano(`ork-portao: ${ferramenta} não devolveu texto`)
  try {
    return JSON.parse(texto)
  } catch {
    throw new ErroDoPlano(`ork-portao: ${ferramenta} devolveu texto que não é JSON`)
  }
}

/** O texto do plano que o `ork_artifact_read` devolve, ou `null` quando a thread ainda não tem plano. */
export function textoDoPlano(bruto: unknown): string | null {
  const documento = bruto as { conteudo?: unknown } | null
  if (!documento || typeof documento !== 'object') throw new ErroDoPlano('ork-portao: o plano lido não é objeto')
  return typeof documento.conteudo === 'string' ? documento.conteudo : null
}

/** Caminho relativo normalizado: barras para a frente, sem `./` na frente nem barra no fim. */
export function normalizar(caminho: string): string {
  return caminho.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
}

function ehCaminho(texto: string): boolean {
  return texto !== '' && !/\s/.test(texto) && !texto.startsWith('-') && !texto.split('/').includes('..')
}

const recuo = (linha: string) => (/^[ \t]*/.exec(linha)?.[0] ?? '').replace(/\t/g, '    ').length

/**
 * O item inteiro do verify da linha `k` (a regra de `itemDoVerify` do núcleo): o texto depois do rótulo, a
 * continuação logo abaixo que não abre outro item e as linhas mais recuadas que o rótulo, mesmo depois de branco.
 */
function itemDoVerify(bloco: readonly string[], k: number, inicio: string): string {
  const base = recuo(bloco[k] as string)
  const partes = [inicio]
  let depoisDeBranco = false
  for (const linha of bloco.slice(k + 1)) {
    if (!linha.trim()) { depoisDeBranco = true; continue }
    if (recuo(linha) <= base && (depoisDeBranco || ABRE_BLOCO.test(linha))) break
    partes.push(linha.trim())
    depoisDeBranco = false
  }
  return partes.join(' ').trim()
}

/** O verify de uma tarefa pela regra do núcleo: o comando, ou o motivo com que o `ork claims conferir` recusaria. */
function verifyDoBloco(bloco: readonly string[]): { verify: string | null; problema: PortaoTarefa['problema'] } {
  const verifies = bloco.flatMap((l, k) => {
    const m = ROTULO_DE_VERIFY.exec(l)
    return m ? [itemDoVerify(bloco, k, (m[1] as string).trim())] : []
  })
  if (verifies.length === 0) return { verify: null, problema: 'tarefa-sem-verify' }
  if (verifies.length > 1) return { verify: null, problema: 'tarefa-ambigua' }
  const resto = verifies[0] as string
  if ([...resto.matchAll(TRECHO)].length === 0) return { verify: null, problema: 'tarefa-sem-comando' }
  const unico = /^`([^`]+)`\s*\.?$/.exec(resto)
  if (!unico || !(unico[1] as string).trim()) return { verify: null, problema: 'tarefa-ambigua' }
  return { verify: (unico[1] as string).trim(), problema: null }
}

/** Os `touch_paths` de uma tarefa: os trechos entre crases do item do rótulo e das linhas que o continuam. */
function touchPathsDoBloco(bloco: readonly string[]): string[] {
  const achados: string[] = []
  const juntar = (texto: string) => {
    for (const m of texto.matchAll(TRECHO)) {
      const caminho = normalizar(m[1] as string)
      if (ehCaminho(caminho) && !achados.includes(caminho)) achados.push(caminho)
    }
  }
  let recuoDoRotulo = -1
  let depoisDeBranco = false
  for (const linha of bloco) {
    const r = recuo(linha)
    const rotulo = ROTULO_DE_TOUCH_PATHS.exec(linha)
    if (rotulo) {
      juntar(rotulo[1] as string)
      recuoDoRotulo = r
      depoisDeBranco = false
      continue
    }
    if (recuoDoRotulo < 0) continue
    if (linha.trim() === '') { depoisDeBranco = true; continue }
    if (r <= recuoDoRotulo && (depoisDeBranco || ABRE_BLOCO.test(linha))) { recuoDoRotulo = -1; continue }
    juntar(linha)
    depoisDeBranco = false
  }
  return achados
}

/**
 * As tarefas do plano, na ordem do texto (D3 do plano da thread): o cabeçalho `##` a `######` com `T<id>`, o bloco
 * até o próximo cabeçalho de nível igual ou maior, os `touch_paths` e o verify pela regra do núcleo. Id repetido
 * fica uma vez só, com o problema `tarefa-repetida`. `null` sem plano.
 */
export function tarefasDoPlano(conteudo: string | null): PortaoTarefa[] | null {
  if (typeof conteudo !== 'string') return null
  const linhas = conteudo.replace(/\r\n/g, '\n').split('\n')
  const inicios = linhas.flatMap((l, i) => {
    const m = CABECALHO_DE_TAREFA.exec(l)
    return m ? [{ i, nivel: (m[1] as string).length, id: `T${m[2] as string}`, titulo: (m[3] as string).replace(/^[\s.:)-]+/, '').trim() }] : []
  })
  const vistos = new Map<string, number>()
  for (const c of inicios) vistos.set(c.id, (vistos.get(c.id) ?? 0) + 1)
  const tarefas: PortaoTarefa[] = []
  for (const c of inicios) {
    if (tarefas.some(t => t.id === c.id)) continue
    const fim = linhas.findIndex((l, j) => j > c.i && new RegExp(`^#{1,${c.nivel}}\\s`).test(l))
    const bloco = linhas.slice(c.i + 1, fim < 0 ? undefined : fim)
    const { verify, problema } = (vistos.get(c.id) ?? 0) > 1 ? { verify: null, problema: 'tarefa-repetida' as const } : verifyDoBloco(bloco)
    tarefas.push({ id: c.id, titulo: c.titulo.slice(0, 120), touchPaths: touchPathsDoBloco(bloco), verify, problema })
  }
  return tarefas
}

/** Os ids distintos de tarefa do plano que o assunto da tarefa nativa cita, na ordem. */
export function idsNoAssunto(assunto: unknown): string[] {
  if (typeof assunto !== 'string') return []
  const ids: string[] = []
  for (const m of assunto.matchAll(ID_NO_ASSUNTO)) {
    const id = `T${m[1] as string}`
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** A tarefa serve para o quadro: tem `touch_paths` e um verify que o núcleo confere. */
export function serveAoQuadro(t: PortaoTarefa): boolean {
  return t.touchPaths.length > 0 && t.verify !== null && t.problema === null
}

/** Por que a criação foi recusada (D2 e D3 do plano da thread). */
export type MotivoDaRecusa = 'sem-id' | 'ambigua' | 'fora-do-plano' | 'repetida' | 'sem-touch-paths' | 'sem-verify'

export type VereditoDaCriacao =
  | { tipo: 'passa'; tarefa: string }
  | { tipo: 'recusa'; motivo: MotivoDaRecusa; ids: string[]; tarefa: PortaoTarefa | null }

/** A criação de uma tarefa nativa contra as tarefas do plano. */
export function decidirCriacao(assunto: unknown, tarefas: readonly PortaoTarefa[]): VereditoDaCriacao {
  const ids = idsNoAssunto(assunto)
  if (ids.length === 0) return { tipo: 'recusa', motivo: 'sem-id', ids, tarefa: null }
  if (ids.length > 1) return { tipo: 'recusa', motivo: 'ambigua', ids, tarefa: null }
  const tarefa = tarefas.find(t => t.id === ids[0]) ?? null
  if (!tarefa) return { tipo: 'recusa', motivo: 'fora-do-plano', ids, tarefa: null }
  if (tarefa.problema === 'tarefa-repetida') return { tipo: 'recusa', motivo: 'repetida', ids, tarefa }
  if (tarefa.touchPaths.length === 0) return { tipo: 'recusa', motivo: 'sem-touch-paths', ids, tarefa }
  if (!serveAoQuadro(tarefa)) return { tipo: 'recusa', motivo: 'sem-verify', ids, tarefa }
  return { tipo: 'passa', tarefa: tarefa.id }
}

const DETALHE_DO_VERIFY: Record<string, string> = {
  'tarefa-sem-verify': 'não há linha de verify',
  'tarefa-sem-comando': 'o verify não tem comando entre crases',
  'tarefa-ambigua': 'o verify tem mais de uma linha, mais de um comando ou texto além do comando',
}

function motivoEmTexto(v: Extract<VereditoDaCriacao, { tipo: 'recusa' }>): string {
  const id = v.ids[0] ?? ''
  switch (v.motivo) {
    case 'sem-id': return 'o assunto não traz o id de uma tarefa do plano'
    case 'ambigua': return `o assunto cita mais de uma tarefa do plano (${v.ids.join(', ')}), e cada tarefa do quadro é uma tarefa do plano`
    case 'fora-do-plano': return `o plano não tem a tarefa ${id}`
    case 'repetida': return `o plano tem mais de um cabeçalho da tarefa ${id}`
    case 'sem-touch-paths': return `a tarefa ${id} do plano não tem touch_paths, então ninguém sabe que arquivos ela toca`
    case 'sem-verify': return `a tarefa ${id} do plano não tem um verify que o núcleo confira (${DETALHE_DO_VERIFY[v.tarefa?.problema ?? ''] ?? 'sem comando'})`
  }
}

/** Uma tarefa do plano como a lista ao modelo: o id e o título. */
export function rotulo(t: PortaoTarefa): string {
  return t.titulo ? `${t.id} (${t.titulo})` : t.id
}

/** O texto do `block` da criação recusada: o motivo, a regra e as tarefas do plano que servem. */
export function textoDaRecusa(v: Extract<VereditoDaCriacao, { tipo: 'recusa' }>, assunto: unknown, tarefas: readonly PortaoTarefa[]): string {
  const nome = typeof assunto === 'string' ? assunto.trim().slice(0, 120) : ''
  const servem = tarefas.filter(serveAoQuadro)
  const partes = [
    `Portão de Tarefas: a tarefa "${nome}" não entrou no quadro: ${motivoEmTexto(v)}.`,
    'No GO desta thread, cada tarefa do quadro é uma tarefa do plano: o assunto leva o id dela (por exemplo, "T2.1 título"), ' +
      'e a tarefa do plano precisa de touch_paths e de um verify com um comando só entre crases, que o núcleo confere ' +
      'quando a tarefa fecha (ork claims conferir --tarefa).',
  ]
  if (servem.length === 0) partes.push('Nenhuma tarefa do plano serve hoje: o plano precisa de touch_paths e de verify nas tarefas antes de abrir o quadro.')
  else {
    const lista = servem.slice(0, TETO_DE_TAREFAS_NO_TEXTO).map(rotulo).join('; ')
    const mais = servem.length > TETO_DE_TAREFAS_NO_TEXTO ? `; e mais ${servem.length - TETO_DE_TAREFAS_NO_TEXTO}` : ''
    partes.push(`Tarefas do plano que servem: ${lista}${mais}.`)
  }
  return limitarTexto(partes.join('\n'))
}

/** Um texto ao modelo dentro do teto, com a marca de corte. */
export function limitarTexto(texto: string): string {
  return texto.length > TETO_DO_TEXTO ? `${texto.slice(0, TETO_DO_TEXTO - 40)}\n(texto cortado pelo Portão de Tarefas)` : texto
}

/**
 * O GO está no bloco pelo slug que o núcleo dá a ele (`slugDasFases`): `full` são todas as fases, o nome de uma
 * fase em minúsculas é ela só, e `f` seguido de dígitos são as fases desses dígitos. `null` quando o slug não diz.
 */
export function faseNoBloco(slug: unknown, fase: string = 'GO'): boolean | null {
  if (typeof slug !== 'string' || slug === '') return null
  if (slug === 'full') return true
  const so = FASES.find(f => f.toLowerCase() === slug)
  if (so) return so === fase
  if (!/^f[1-6]+$/.test(slug)) return null
  const digito = String(FASES.indexOf(fase as (typeof FASES)[number]) + 1)
  return slug.slice(1).includes(digito)
}

/** O status e o slug do bloco da thread no retrato `ork.maestro-snapshot/v1`; `null` no que ele não diz. */
export function threadNoRetrato(retrato: unknown, thread: string): { status: string | null; bloco: string | null } {
  const itens = (retrato as { sections?: { threads?: { items?: unknown } } } | null)?.sections?.threads?.items
  if (!Array.isArray(itens)) return { status: null, bloco: null }
  const item = itens.find(i => (i as { id?: unknown } | null)?.id === thread) as { status?: unknown; facts?: { block?: unknown } } | undefined
  return {
    status: typeof item?.status === 'string' ? item.status : null,
    bloco: typeof item?.facts?.block === 'string' ? item.facts.block : null,
  }
}

/** O que decide se o Portão age (D1). */
export type Escopo = { ativo: true; avisos: string[] } | { ativo: false; motivo: string }

/** A metade do escopo que o retrato decide, antes de ler o plano: sem retrato, conta como bloco com GO e aberta. */
export function escopoDoRetrato(retrato: { status: string | null; bloco: string | null } | null): Escopo {
  if (retrato === null) return { ativo: true, avisos: ['retrato indisponível; o Portão confere mesmo assim'] }
  if (retrato.status === 'fechada') return { ativo: false, motivo: 'thread fechada' }
  if (faseNoBloco(retrato.bloco) === false) return { ativo: false, motivo: `o bloco ${retrato.bloco} não tem o GO` }
  return { ativo: true, avisos: [] }
}

/** A outra metade: o plano legível com ao menos uma tarefa `T<n>`. */
export function escopoDoPlano(tarefas: readonly PortaoTarefa[] | null): Escopo {
  if (tarefas === null) return { ativo: false, motivo: 'a thread ainda não tem plano legível' }
  if (tarefas.length === 0) return { ativo: false, motivo: 'o plano não tem tarefas T<n>' }
  return { ativo: true, avisos: [] }
}

/** O escopo inteiro, como o register.ts o compõe: o retrato primeiro, o plano depois. */
export function decidirEscopo(retrato: { status: string | null; bloco: string | null } | null, tarefas: readonly PortaoTarefa[] | null): Escopo {
  const doRetrato = escopoDoRetrato(retrato)
  if (!doRetrato.ativo) return doRetrato
  const doPlano = escopoDoPlano(tarefas)
  return doPlano.ativo ? doRetrato : doPlano
}
