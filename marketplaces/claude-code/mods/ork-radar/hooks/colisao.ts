// O cálculo do Radar de Colisão (RM-059, fatia F3; ficha M10 do plano dos mods). Módulo puro: escolhe as threads
// da rodada, monta o argv e o ambiente de cada comando, lê as saídas do git, cruza os conflitos com os leases e
// acha as colisões novas. Nenhum `$` passa por aqui; as chamadas ficam no register.tsx. Do git, só `ls-remote`
// e `merge-tree` com diretório de objetos temporário (D6 do dono e D2 da thread); o `fetch` fica com o núcleo.
import type { RadarArquivo, RadarBase, RadarCelula, RadarLease, RadarMapa, RadarThread } from '../types'

/** O lado da base nos pares; `@` não cabe em id de thread, então não colide com nenhuma. */
export const BASE = '@main'
export const NOME_DA_BASE = 'origin/main'
/** D7: a `origin/main` local, conferida contra a `main` do `origin`. */
export const REF_DA_BASE = 'refs/remotes/origin/main'
export const REMOTO = 'origin'
export const REF_REMOTA = 'refs/heads/main'
/** D7: no máximo 12 threads por rodada, na ordem das fases mais perto do SHIP; a fase MASTER fica fora. */
export const TETO_DE_THREADS = 12
export const ORDEM_DAS_FASES: readonly string[] = ['SHIP', 'CHECK', 'GO', 'PLAN', 'GOAL']
export const FASES_FORA = ['MASTER']
/** A rodada do relógio, a cada 10 min (ficha M10). */
export const PERIODO_DA_RODADA_MS = 600000
/** D12: os tetos de cada comando, o orçamento de `merge-tree` por rodada e o tamanho do cache. */
export const PRAZO_LOCAL_MS = 5000
export const PRAZO_DO_REMOTO_MS = 15000
export const PRAZO_DO_MERGE_MS = 20000
export const ORCAMENTO_DO_MERGE_MS = 60000
export const TETO_DO_CACHE = 256
/** D5: o temporário fica no `/tmp`, com o nome do Radar e 8 caracteres do `mktemp`. */
export const MODELO_DO_TEMPORARIO = '/tmp/ork-radar.XXXXXXXX'
/** Quantos arquivos de um par a linha do conflito mostra antes de resumir. */
export const ARQUIVOS_POR_LINHA = 5

const ROTULOS = '123456789abcdefghijklmnopqrstuvwxyz'
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/
const BRANCH_DO_ORK = /^ork\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/
/** SHA de commit ou de árvore, em SHA-1 ou SHA-256. */
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const TEMPORARIO = /^\/tmp\/ork-radar\.[A-Za-z0-9]{8}$/
const NUL = String.fromCharCode(0)
/** O ambiente de todo git do Radar: nunca pergunta credencial no terminal. */
export const AMBIENTE_DO_GIT: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: '0' }

export type ThreadDaLista = { id: string; slug: string; fase: string }
export type Escolha = { threads: ThreadDaLista[]; omitidas: number }

function posicaoDaFase(fase: string): number {
  const i = ORDEM_DAS_FASES.indexOf(fase)
  return i < 0 ? ORDEM_DAS_FASES.length : i
}

/** As threads abertas da consulta `thread.list`, na ordem da rodada e até o teto; a fase MASTER fica fora (D7). */
export function threadsDaLista(json: unknown, teto = TETO_DE_THREADS): Escolha {
  const lista = (json as { threads?: unknown } | null)?.threads
  if (!Array.isArray(lista)) throw new Error('a lista das threads abertas veio sem threads')
  const validas: ThreadDaLista[] = []
  const vistas = new Set<string>()
  for (const bruto of lista) {
    const t = (bruto ?? {}) as { id?: unknown; slug?: unknown; fase?: unknown; status?: unknown }
    if (typeof t.id !== 'string' || !ID_DE_THREAD.test(t.id) || vistas.has(t.id)) continue
    if (typeof t.slug !== 'string' || !SLUG.test(t.slug) || t.slug.includes('..')) continue
    if (t.status === 'fechada') continue
    const fase = typeof t.fase === 'string' ? t.fase : ''
    if (FASES_FORA.includes(fase)) continue
    vistas.add(t.id)
    validas.push({ id: t.id, slug: t.slug, fase })
  }
  validas.sort((x, y) => posicaoDaFase(x.fase) - posicaoDaFase(y.fase) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
  return { threads: validas.slice(0, teto), omitidas: Math.max(0, validas.length - teto) }
}

/** O nome curto da thread no mapa: de 1 a 9, depois letras. */
export function rotuloDe(i: number): string {
  return ROTULOS[i] ?? '?'
}

/** A branch canônica da thread pelo slug, como o núcleo a cria (`ork/<slug>`). */
export function refDaThread(slug: string): string {
  return `refs/heads/ork/${slug}`
}

/** A branch pelo `base.branch` da consulta `thread.status`, só quando começa com `ork/` (`branchDaWorktree` do núcleo). */
export function refDoStatus(json: unknown): string | null {
  const b = (json as { base?: { branch?: unknown } } | null)?.base?.branch
  if (typeof b !== 'string' || !BRANCH_DO_ORK.test(b) || b.includes('..') || b.includes('//') || b.endsWith('/') || b.endsWith('.lock')) return null
  return `refs/heads/${b}`
}

/** O `ls-remote` no próprio repositório: o SHA da base e o de cada branch pedida, sem escrever nada. */
export function argvDoLsRemoteLocal(refs: readonly string[]): string[] {
  return ['git', 'ls-remote', '.', REF_DA_BASE, ...refs]
}

/** O `ls-remote` no `origin`: só o SHA da `main` remota, para saber se a base local ficou para trás (D4). */
export function argvDoLsRemoteRemoto(): string[] {
  return ['git', 'ls-remote', REMOTO, REF_REMOTA]
}

/** As linhas `<sha> <ref>` do `ls-remote`; linha que não tem essa forma fica de fora. */
export function lerLsRemote(stdout: string): Record<string, string> {
  const shas: Record<string, string> = {}
  for (const linha of stdout.split('\n')) {
    const [sha, ref, sobra] = linha.trim().split(/\s+/)
    if (sha && ref && sobra === undefined && SHA.test(sha) && ref.startsWith('refs/')) shas[ref] = sha
  }
  return shas
}

/** O diretório de objetos temporário da rodada (D5). */
export function argvDoTemporario(): string[] {
  return ['mktemp', '-d', MODELO_DO_TEMPORARIO]
}

/** O caminho que o `mktemp` devolveu, só quando é um temporário do Radar; senão null. */
export function temporarioValido(saida: unknown): string | null {
  if (typeof saida !== 'string') return null
  const caminho = saida.trim()
  return TEMPORARIO.test(caminho) ? caminho : null
}

/** O `rm` do temporário da rodada; recusa qualquer outro caminho. */
export function argvDeApagar(temporario: string): string[] {
  if (temporarioValido(temporario) !== temporario) throw new Error('o Radar so apaga o proprio temporario')
  return ['rm', '-rf', '--', temporario]
}

/** Junta pasta e nome com uma barra só. */
export function juntar(pasta: string, nome: string): string {
  return pasta.replace(/\/+$/, '') + '/' + nome.replace(/^\/+/, '')
}

/** Resolve `.` e `..` de um caminho absoluto, sem tocar o disco. */
export function normalizar(caminho: string): string {
  const partes: string[] = []
  for (const p of caminho.split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') partes.pop()
    else partes.push(p)
  }
  return '/' + partes.join('/')
}

/** O `gitdir:` do arquivo `.git` de uma worktree vinculada, absoluto; null se o texto não tem essa linha. */
export function gitdirDoArquivo(texto: string, raiz: string): string | null {
  const linha = texto.split('\n').map(l => l.trim()).find(l => l.startsWith('gitdir:'))
  const alvo = linha?.slice('gitdir:'.length).trim()
  if (!alvo) return null
  return normalizar(alvo.startsWith('/') ? alvo : juntar(raiz, alvo))
}

/** Os objetos do repositório: o `commondir` da worktree vinculada (relativo ao gitdir) ou o próprio gitdir. */
export function objetosDoComum(gitdir: string, commondir: string | null): string {
  const comum = commondir?.trim()
  const base = !comum ? gitdir : comum.startsWith('/') ? comum : juntar(gitdir, comum)
  return juntar(normalizar(base), 'objects')
}

/** O `merge-tree` de um par, só com SHAs: sem worktree e com os arquivos em conflito pelo nome. */
export function argvDoMergeTree(a: string, b: string): string[] {
  if (!SHA.test(a) || !SHA.test(b)) throw new Error('o merge-tree do Radar so recebe SHA')
  return ['git', 'merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', a, b]
}

/** O ambiente do `merge-tree`: objetos novos no temporário, os do repositório só como alternativo (D2 e D3). */
export function ambienteDoMerge(temporario: string, objetos: string): Record<string, string> {
  return { ...AMBIENTE_DO_GIT, GIT_OBJECT_DIRECTORY: temporario, GIT_ALTERNATE_OBJECT_DIRECTORIES: objetos }
}

export type Resultado = { estado: 'limpa' } | { estado: 'conflito'; arquivos: string[] } | { estado: 'erro'; erro: string }

/**
 * A saída do `merge-tree`: 0 com a árvore no começo é par limpo; 1 com a árvore no começo é conflito, com os
 * arquivos depois dela; o resto é erro. A saída 1 sozinha não basta: ref que não existe também sai 1, sem árvore.
 */
export function lerMergeTree(r: { exitCode: number; stdout: string; stderr: string }): Resultado {
  const partes = String(r.stdout ?? '').split(NUL)
  const temArvore = SHA.test(partes[0] ?? '')
  if (temArvore && r.exitCode === 0) return { estado: 'limpa' }
  if (temArvore && r.exitCode === 1) {
    const arquivos = [...new Set(partes.slice(1).filter(p => p !== ''))].sort()
    if (arquivos.length > 0) return { estado: 'conflito', arquivos }
    return { estado: 'erro', erro: 'o merge-tree acusou conflito sem arquivo' }
  }
  const primeira = String(r.stderr ?? '').trim().split('\n')[0]?.trim().slice(0, 200)
  return { estado: 'erro', erro: primeira || `o merge-tree saiu ${r.exitCode}` }
}

/** A chave de um par ou de um par de SHAs: os dois lados em ordem. */
export function chaveDoPar(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export type Par = { a: string; b: string; shaA: string; shaB: string }

/** Os pares da rodada: cada thread com SHA contra a base, depois cada par de threads com SHA, na ordem do mapa. */
export function paresDaRodada(threads: readonly RadarThread[], shaDaBase: string | null): Par[] {
  const com = threads.filter(t => t.sha !== null)
  const pares: Par[] = []
  if (shaDaBase !== null) for (const t of com) pares.push({ a: t.id, b: BASE, shaA: t.sha as string, shaB: shaDaBase })
  for (let i = 0; i < com.length; i++) {
    for (let j = i + 1; j < com.length; j++) {
      const x = com[i] as RadarThread
      const y = com[j] as RadarThread
      pares.push({ a: x.id, b: y.id, shaA: x.sha as string, shaB: y.sha as string })
    }
  }
  return pares
}

/** Guarda um resultado no cache pelo par de SHAs; acima do teto sai o mais antigo (D12). Erro não entra. */
export function guardarNoCache(cache: Map<string, Resultado>, chave: string, r: Resultado, teto = TETO_DO_CACHE): void {
  if (r.estado === 'erro') return
  cache.delete(chave)
  cache.set(chave, r)
  while (cache.size > teto) {
    const primeira = cache.keys().next()
    if (primeira.done) break
    cache.delete(primeira.value)
  }
}

export type LeaseDePath = { glob: string; thread: string }

/** Os leases `path:<glob>` ativos da seção `leases` do retrato, com a thread que segura cada um (D1 e D10). */
export function leasesDoRetrato(retrato: unknown): LeaseDePath[] {
  const itens = (retrato as { sections?: { leases?: { items?: unknown } } } | null)?.sections?.leases?.items
  if (!Array.isArray(itens)) throw new Error('o retrato veio sem a secao leases')
  const leases: LeaseDePath[] = []
  for (const bruto of itens) {
    const x = (bruto ?? {}) as { id?: unknown; status?: unknown; refs?: unknown }
    if (typeof x.id !== 'string' || !x.id.startsWith('path:') || x.status !== 'active') continue
    const refs = Array.isArray(x.refs) ? x.refs as Array<{ kind?: unknown; id?: unknown }> : []
    const thread = refs.find(r => r && r.kind === 'thread' && typeof r.id === 'string' && ID_DE_THREAD.test(r.id))?.id
    const glob = x.id.slice('path:'.length).trim()
    if (typeof thread === 'string' && glob !== '') leases.push({ glob, thread })
  }
  return leases
}

/** O glob de um lease `path:` como regex, com a mesma regra do núcleo (`globParaRegex` de `core/src/leases.ts`). */
export function globParaRegex(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Os leases que cobrem um arquivo em conflito. */
export function leasesDoArquivo(caminho: string, leases: readonly LeaseDePath[]): RadarLease[] {
  return leases.filter(l => globParaRegex(l.glob).test(caminho)).map(l => ({ lease: `path:${l.glob}`, thread: l.thread }))
}

/** A célula de um par: o resultado do `merge-tree` (null quando ficou para a próxima rodada) e os leases de cada arquivo. */
export function celulaDoPar(par: { a: string; b: string }, r: Resultado | null, leases: readonly LeaseDePath[], motivo?: string): RadarCelula {
  const base = { par: chaveDoPar(par.a, par.b), a: par.a, b: par.b }
  if (r === null) return { ...base, estado: 'pendente', arquivos: [], erro: motivo ?? 'não calculado nesta rodada' }
  if (r.estado === 'erro') return { ...base, estado: 'erro', arquivos: [], erro: r.erro }
  if (r.estado === 'limpa') return { ...base, estado: 'limpa', arquivos: [], erro: null }
  const arquivos: RadarArquivo[] = r.arquivos.map(caminho => ({ caminho, leases: leasesDoArquivo(caminho, leases) }))
  return { ...base, estado: 'conflito', arquivos, erro: null }
}

/** A base do mapa: o SHA local e o que o remoto disse (D4: sem `fetch`, só os dois SHAs). */
export function baseDoMapa(shaLocal: string | null, remoto: { sha: string | null; erro: string | null }): RadarBase {
  const situacao = remoto.sha === null ? 'nao-conferida' : remoto.sha === shaLocal ? 'igual' : 'diferente'
  return { ref: REF_DA_BASE, sha: shaLocal, remoto: remoto.sha, situacao, erroRemoto: remoto.erro }
}

/** As colisões de um mapa, uma por par e arquivo. */
export function colisoesDoMapa(m: RadarMapa): string[] {
  return m.celulas.flatMap(c => (c.estado === 'conflito' ? c.arquivos.map(a => `${c.par}|${a.caminho}`) : []))
}

/**
 * Os pares com colisão nova (D6): par com algum arquivo em conflito que não estava na rodada anterior da sessão.
 * Na primeira rodada (`anteriores` null), toda colisão é nova.
 */
export function paresComColisaoNova(anteriores: ReadonlySet<string> | null, m: RadarMapa): string[] {
  const pares: string[] = []
  for (const c of m.celulas) {
    if (c.estado !== 'conflito') continue
    if (anteriores === null || c.arquivos.some(a => !anteriores.has(`${c.par}|${a.caminho}`))) pares.push(c.par)
  }
  return pares
}

/** Como um lado do par aparece para o dono. */
export function nomeDoLado(id: string): string {
  return id === BASE ? NOME_DA_BASE : id
}

/** O comando que resolve um conflito, como texto (D10): o Radar nunca o roda. */
export function comandoQueResolve(c: Pick<RadarCelula, 'a' | 'b'>): string {
  if (c.b === BASE) return `ork worktree sync ${c.a} --dry-run`
  if (c.a === BASE) return `ork worktree sync ${c.b} --dry-run`
  return `a que entregar depois roda: ork worktree sync <${c.a} ou ${c.b}> --dry-run`
}

/** Um arquivo em conflito com os leases que o cobrem. */
export function textoDoArquivo(a: RadarArquivo): string {
  if (a.leases.length === 0) return a.caminho
  return `${a.caminho} (${a.leases.map(l => `lease ${l.lease} de ${l.thread}`).join(', ')})`
}

/** Os arquivos de um par, os primeiros 5 por inteiro e o resto contado. */
export function textoDosArquivos(c: Pick<RadarCelula, 'arquivos'>): string {
  const mostrados = c.arquivos.slice(0, ARQUIVOS_POR_LINHA).map(textoDoArquivo).join(', ')
  const resto = c.arquivos.length - ARQUIVOS_POR_LINHA
  return resto > 0 ? `${mostrados} e mais ${resto}` : mostrados
}

/** Uma contagem com o substantivo no número certo. */
export function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** O SHA curto, como o git mostra. */
export function curto(sha: string | null): string {
  return sha === null ? '?' : sha.slice(0, 7)
}

/** A situação da base numa frase (D4). */
export function textoDaBase(b: RadarBase): string {
  if (b.sha === null) return `sem ${NOME_DA_BASE} local`
  if (b.situacao === 'igual') return `${NOME_DA_BASE} ${curto(b.sha)}, igual ao remoto`
  if (b.situacao === 'diferente') return `${NOME_DA_BASE} ${curto(b.sha)}, diferente do remoto (${curto(b.remoto)}): a conta vale até o fetch do núcleo`
  return `${NOME_DA_BASE} ${curto(b.sha)}, remoto não conferido${b.erroRemoto ? ` (${b.erroRemoto})` : ''}`
}

/** O resumo do mapa que o `/radar` devolve: base, colisões com arquivos e comando, e o que ficou de fora. */
export function resumoDoMapa(m: RadarMapa): string {
  if (m.lidoEm === null) return `Radar de Colisão: ainda sem rodada${m.erro ? ` (${m.erro})` : ''}.`
  const linhas: string[] = []
  const omitidas = m.omitidas > 0 ? ` (mais ${m.omitidas} fora do teto)` : ''
  linhas.push(`Radar de Colisão: ${contar(m.threads.length, 'thread aberta', 'threads abertas')}${omitidas}; base ${textoDaBase(m.base)}.`)
  if (m.erro) linhas.push(`A rodada parou: ${m.erro}.`)
  const conflitos = m.celulas.filter(c => c.estado === 'conflito')
  for (const c of conflitos) {
    linhas.push(`- ${nomeDoLado(c.a)} × ${nomeDoLado(c.b)}: ${textoDosArquivos(c)}; resolve: ${comandoQueResolve(c)}`)
  }
  const limpas = m.celulas.filter(c => c.estado === 'limpa').length
  if (conflitos.length === 0 && !m.erro) linhas.push(`Nenhuma colisão: ${contar(limpas, 'par limpo', 'pares limpos')}.`)
  else if (!m.erro) linhas.push(`${contar(conflitos.length, 'par em conflito', 'pares em conflito')} e ${contar(limpas, 'limpo', 'limpos')}.`)
  for (const c of m.celulas.filter(x => x.estado === 'erro')) linhas.push(`Erro em ${nomeDoLado(c.a)} × ${nomeDoLado(c.b)}: ${c.erro}`)
  const pendentes = m.celulas.filter(c => c.estado === 'pendente').length
  if (pendentes > 0) linhas.push(`${pendentes === 1 ? '1 par ficou' : `${pendentes} pares ficaram`} para a próxima rodada.`)
  const semBranch = m.threads.filter(t => t.sha === null).map(t => t.id)
  if (semBranch.length > 0) linhas.push(`Sem branch local: ${semBranch.join(', ')}.`)
  for (const l of m.lacunas) linhas.push(`Lacuna: ${l}.`)
  return linhas.join('\n')
}
