// Os arquivos tocados num lote e as claims que eles afetam (RM-059, F2, T2.2). Modulo puro: le a saida do
// `git status`, compara fotos, junta os caminhos das ferramentas de escrita do lote e casa os caminhos com as
// claims e com os `touch_paths` do plano. As chamadas ao `$` ficam no register.ts.
import type { FreioClaim, FreioFoto, FreioPedido, FreioVigia } from '../types'

/** O `git status` da foto (D4): HEAD, sem renomeacao (vira saida e entrada) e com cada arquivo novo listado. */
export const ARGV_DO_STATUS: readonly string[] = ['git', 'status', '--porcelain=v2', '--branch', '-z', '--no-renames', '--untracked-files=all']
export const TETO_DO_STATUS_MS = 10000
/** Caminhos sujos com `stat` por foto; acima disso, so o codigo XY entra na assinatura. */
export const TETO_DE_STAT = 300
/** Nome-base menor que isto nao casa com comando (D5). */
export const MINIMO_DO_NOME_BASE = 3

/** As ferramentas que escrevem um arquivo e o campo do caminho no `tool_input`. */
const ESCRITA: Readonly<Record<string, string>> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
/** Ferramentas que so leem: o lote feito so delas nao roda o `git status` (D4). */
export const FERRAMENTAS_DE_LEITURA: readonly string[] = [
  'Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'ToolSearch',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskOutput',
  'mcp__orkastery__ork_thread_status', 'mcp__orkastery__ork_artifact_read', 'mcp__orkastery__ork_claims_list',
  'mcp__orkastery__ork_git_status', 'mcp__orkastery__ork_phase_list', 'mcp__orkastery__ork_hitl_pending',
  'mcp__orkastery__ork_observe',
]
const EXTENSOES_DE_CODIGO = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'])
/** O CLI de claims dentro de um comando do `Bash`: o lote mexeu nas claims. */
const CLI_DE_CLAIMS = /\bork\s+claims\s+(?:add|retirar|verificar)\b/

/** Uma chamada do lote como o `classic.PostToolBatch` a entrega. */
export type Chamada = { tool_name?: unknown; tool_input?: unknown }
export type EntradaDoStatus = { caminho: string; xy: string }

/** Pasta e caminho relativo com uma barra so. */
export function juntar(pasta: string, rel: string): string {
  return pasta.replace(/\/+$/, '') + '/' + rel.replace(/^\/+/, '')
}

/**
 * A saida de `git status --porcelain=v2 --branch -z`: o HEAD (`# branch.oid`, `null` antes do primeiro commit)
 * e cada caminho sujo com o codigo XY. Entrada renomeada (`2`) pula o caminho de origem; nova vem como `??`.
 */
export function lerStatus(saida: string): { head: string | null; entradas: EntradaDoStatus[] } {
  let head: string | null = null
  const entradas: EntradaDoStatus[] = []
  const registros = saida.split('\0')
  for (let i = 0; i < registros.length; i++) {
    const r = registros[i] as string
    if (r.startsWith('# branch.oid ')) {
      const oid = r.slice('# branch.oid '.length).trim()
      head = /^[0-9a-f]{7,64}$/.test(oid) ? oid : null
      continue
    }
    const campos = r.split(' ')
    const xy = campos[1] ?? ''
    if (r.startsWith('1 ') && campos.length >= 9) entradas.push({ caminho: campos.slice(8).join(' '), xy })
    else if (r.startsWith('2 ') && campos.length >= 10) { entradas.push({ caminho: campos.slice(9).join(' '), xy }); i++ }
    else if (r.startsWith('u ') && campos.length >= 11) entradas.push({ caminho: campos.slice(10).join(' '), xy })
    else if (r.startsWith('? ') && r.length > 2) entradas.push({ caminho: r.slice(2), xy: '??' })
  }
  return { head, entradas }
}

/** A assinatura de um caminho sujo: o XY e, com `stat`, o tamanho e o `mtimeMs` (D4). */
export function assinatura(xy: string, stat: { size?: unknown; mtimeMs?: unknown } | null | undefined, comStat: boolean): string {
  if (!comStat) return xy
  return stat && typeof stat.size === 'number' && typeof stat.mtimeMs === 'number' ? `${xy}|${stat.size}|${stat.mtimeMs}` : `${xy}|ausente`
}

/**
 * Os caminhos que mudaram entre duas fotos (D4): novo na lista, com assinatura diferente, ou que saiu da lista
 * com o HEAD parado (reversao). Saida da lista com HEAD novo foi commit e nao conta. Sem foto anterior, nada.
 */
export function diferenca(antes: FreioFoto | null, agora: FreioFoto): string[] {
  if (!antes) return []
  const tocados = new Set<string>()
  for (const [caminho, sig] of Object.entries(agora.caminhos)) if (antes.caminhos[caminho] !== sig) tocados.add(caminho)
  if (antes.head === agora.head) for (const caminho of Object.keys(antes.caminhos)) if (!(caminho in agora.caminhos)) tocados.add(caminho)
  return [...tocados].sort()
}

/** O caminho relativo a raiz da sessao, ou `null` quando ele fica fora dela ou nao e caminho. */
export function relativo(caminho: unknown, raiz: string): string | null {
  if (typeof caminho !== 'string' || caminho.trim() === '') return null
  const base = raiz.replace(/\/+$/, '')
  let rel = caminho.trim()
  if (rel.startsWith('/')) {
    if (!rel.startsWith(base + '/')) return null
    rel = rel.slice(base.length + 1)
  }
  rel = rel.replace(/^(?:\.\/)+/, '')
  const partes = rel.split('/')
  return rel !== '' && !partes.some(p => p === '' || p === '.' || p === '..') ? rel : null
}

const nomeDa = (c: Chamada) => (typeof c?.tool_name === 'string' ? c.tool_name : '')

/** Os caminhos que as ferramentas de escrita do lote citam, dentro da raiz, sem repeticao. */
export function caminhosDoLote(chamadas: readonly Chamada[], raiz: string): string[] {
  const achados = new Set<string>()
  for (const c of chamadas) {
    const campo = ESCRITA[nomeDa(c)]
    if (!campo) continue
    const rel = relativo((c.tool_input as Record<string, unknown> | null)?.[campo], raiz)
    if (rel) achados.add(rel)
  }
  return [...achados].sort()
}

/** O lote so tem ferramentas de leitura (ou nenhuma chamada): nao ha o que fotografar. */
export function soLeitura(chamadas: readonly Chamada[]): boolean {
  return chamadas.every(c => FERRAMENTAS_DE_LEITURA.includes(nomeDa(c)))
}

/** O lote registrou, retirou ou mudou claim: a lista do nucleo precisa ser relida. */
export function mexeuNasClaims(chamadas: readonly Chamada[]): boolean {
  return chamadas.some(c => nomeDa(c) === 'mcp__orkastery__ork_claim_add'
    || (nomeDa(c) === 'Bash' && CLI_DE_CLAIMS.test(String((c.tool_input as { command?: unknown } | null)?.command ?? ''))))
}

/** O lote regravou um artefato de fase: o plano precisa ser relido. */
export function mexeuNoPlano(chamadas: readonly Chamada[]): boolean {
  return chamadas.some(c => nomeDa(c) === 'mcp__orkastery__ork_artifact_write')
}

const fronteira = (c: string) => c === '' || /[\s'"=:(),;|&<>]/.test(c)

/** O texto cita `alvo` com fronteira dos dois lados. */
function cita(texto: string, alvo: string, antes: (c: string) => boolean): boolean {
  for (let i = texto.indexOf(alvo); i >= 0; i = texto.indexOf(alvo, i + 1)) {
    if (antes(i === 0 ? '' : (texto[i - 1] as string)) && fronteira(texto[i + alvo.length] ?? '')) return true
  }
  return false
}

/** O comando cita o caminho inteiro, com ou sem `./` na frente (D5, forca 2). */
export function citaCaminho(comando: string, caminho: string): boolean {
  return cita(comando, caminho, fronteira) || cita(comando, './' + caminho, fronteira)
}

/**
 * O comando cita o mesmo nome-base de um fonte TS ou JS, com extensao de codigo (D5, forca 1): pega o teste
 * compilado (`core/test/x.test.ts` contra `core/dist-test/test/x.test.js`). Nome-base curto nao casa.
 */
export function citaNomeBase(comando: string, caminho: string): boolean {
  const base = caminho.slice(caminho.lastIndexOf('/') + 1)
  const ponto = base.lastIndexOf('.')
  if (ponto <= 0 || !EXTENSOES_DE_CODIGO.has(base.slice(ponto + 1))) return false
  const nome = base.slice(0, ponto)
  if (nome.length < MINIMO_DO_NOME_BASE) return false
  const alvo = nome + '.'
  for (let i = comando.indexOf(alvo); i >= 0; i = comando.indexOf(alvo, i + 1)) {
    const antes = i === 0 ? '' : (comando[i - 1] as string)
    if (antes !== '/' && !fronteira(antes)) continue
    let j = i + alvo.length
    while (j < comando.length && /[a-z]/.test(comando[j] as string)) j++
    if (EXTENSOES_DE_CODIGO.has(comando.slice(i + alvo.length, j)) && fronteira(comando[j] ?? '')) return true
  }
  return false
}

const numero = (id: string) => Number(id.slice(1)) || 0

/** Ordem da fila: a forca maior antes; na mesma forca, a claim mais nova antes. */
function ordenar(pedidos: FreioPedido[]): FreioPedido[] {
  return pedidos.sort((a, b) => b.forca - a.forca || numero(b.id) - numero(a.id))
}

/** As claims que os caminhos tocados afetam, com a forca e os caminhos de cada uma (D5). */
export function claimsAfetadas(claims: readonly FreioClaim[], tocados: readonly string[]): FreioPedido[] {
  const afetadas: FreioPedido[] = []
  for (const c of claims) {
    let forca = 0
    const caminhos: string[] = []
    for (const t of tocados) {
      const f = c.arquivo === t ? 3 : c.comandos.some(cmd => citaCaminho(cmd, t)) ? 2 : c.comandos.some(cmd => citaNomeBase(cmd, t)) ? 1 : 0
      if (f > 0) { caminhos.push(t); forca = Math.max(forca, f) }
    }
    if (forca > 0) afetadas.push({ id: c.id, forca, caminhos })
  }
  return ordenar(afetadas)
}

/** A fila com as claims novas, sem repeticao: a claim que ja esta nela junta os caminhos e fica com a forca maior. */
export function enfileirar(fila: readonly FreioPedido[], afetadas: readonly FreioPedido[]): FreioPedido[] {
  const porId = new Map(fila.map(p => [p.id, { ...p, caminhos: [...p.caminhos] }]))
  for (const a of afetadas) {
    const ja = porId.get(a.id)
    if (!ja) { porId.set(a.id, { ...a, caminhos: [...a.caminhos] }); continue }
    ja.forca = Math.max(ja.forca, a.forca)
    for (const c of a.caminhos) if (!ja.caminhos.includes(c)) ja.caminhos.push(c)
  }
  return ordenar([...porId.values()])
}

/** O caminho casa com um `touch_path`: caminho exato ou pasta (com ou sem barra no fim), `*` sem barra e `**` (D9). */
export function casaTouchPath(caminho: string, padrao: string): boolean {
  const p = padrao.replace(/\/+$/, '')
  if (p === '') return false
  if (!p.includes('*')) return caminho === p || caminho.startsWith(p + '/')
  let fonte = '^'
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string
    if (c === '*') {
      if (p[i + 1] === '*') { fonte += '.*'; i++ } else fonte += '[^/]*'
    } else fonte += /[.+?^${}()|[\]\\]/.test(c) ? '\\' + c : c
  }
  return new RegExp(fonte + '$').test(caminho)
}

/** Os caminhos tocados fora da uniao dos `touch_paths` do plano; plano sem `touch_paths` nao avisa nada (D9). */
export function foraDosTouchPaths(tocados: readonly string[], touchPaths: readonly string[] | null): string[] {
  if (!touchPaths || touchPaths.length === 0) return []
  return tocados.filter(t => !touchPaths.some(p => casaTouchPath(t, p)))
}

/** A vigia de uma thread antes da primeira foto. */
export function vigiaVazia(thread: string): FreioVigia {
  return { thread, foto: null, seq: 0, toques: {}, fila: [], avisadosFora: [] }
}

/** O que um lote faz na vigia: foto nova, toques, claims afetadas na fila e `touch_paths` avisados uma vez. */
export function aplicarLote(v: FreioVigia, lote: { foto: FreioFoto | null; doLote: readonly string[]; claims: readonly FreioClaim[] | null; touchPaths: readonly string[] | null }):
  { vigia: FreioVigia; tocados: string[]; afetadas: FreioPedido[]; fora: string[] } {
  const tocados = [...new Set([...lote.doLote, ...(lote.foto ? diferenca(v.foto, lote.foto) : [])])].sort()
  const seq = v.seq + 1
  const toques = { ...v.toques }
  for (const t of tocados) toques[t] = seq
  const afetadas = lote.claims ? claimsAfetadas(lote.claims, tocados) : []
  const fora = foraDosTouchPaths(tocados, lote.touchPaths).filter(c => !v.avisadosFora.includes(c))
  return {
    vigia: { ...v, foto: lote.foto ?? v.foto, seq, toques, fila: enfileirar(v.fila, afetadas), avisadosFora: [...v.avisadosFora, ...fora] },
    tocados, afetadas, fora,
  }
}

/** O aviso de `touch_paths` para o modelo; sem caminho novo fora do plano, nenhum texto. */
export function textoDoFora(fora: readonly string[]): string {
  return fora.length > 0 ? `Freio de Lote: o lote mexeu fora dos touch_paths do plano: ${fora.join(', ')}.` : ''
}
