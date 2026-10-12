// A regra de autoridade dos mods do Orkastery (RM-059, T0.5 e T0.6; D5 do plano dos mods): nenhum mod
// aprova gate, permissao, nota do MASTER, push ou tag pelo dono, nem fala como o dono. A lista mora em
// `adapters/claude-code/mods/autoridade.json`; este modulo so a interpreta, e e o mesmo casamento para a
// guarda estatica (`core/scripts/checar-mods.cjs`, por transpilacao) e para a guarda em tempo de execucao
// da ponte. Modulo puro: so dados entram e saem, nenhum `$` passa por aqui. E melhor esforco: argv montado
// em tempo de execucao escapa da varredura estatica, e um script em arquivo escapa das duas.

export const FORMATO_DA_AUTORIDADE = 'ork.mods-autoridade/v1'
export const NOME_DA_PONTE = 'ork-ponte'
export const MARCA_DE_MOD = 'orkastery-mod.json'

export type RegraDeArgv = {
  id: string
  porque: string
  /** Comando do `ork`: o prefixo das palavras posicionais, como o `parseArgs` do CLI as separa. */
  sequencia?: string[]
  /** Opcao que precisa estar junto (`--score`, `--por`, `--autorizar-push`). */
  opcao?: string
  /** Programa na posicao de comando (`git`, `gh`). */
  programa?: string
  /** Subcomando do programa (`push`, `tag`); sem ele, o programa inteiro. */
  subcomando?: string
}

export type Autoridade = {
  formato: string
  regra: string
  ganchosProibidos: Array<{ id: string; evento: string; componente?: string; porque: string }>
  decisoesProibidas: Array<{ id: string; evento: string; decisao: string; porque: string }>
  chamadasProibidas: Array<{ id: string; chamada: string; tipo?: string; porque: string }>
  argvProibido: RegraDeArgv[]
  ambienteProibido: Array<{ id: string; prefixo: string; porque: string }>
  caminhosProibidos: Array<{ id: string; trecho: string; porque: string }>
  reservadosAPonte: Array<{ id: string; evento: string; porque: string }>
  permitidos: Array<{ id: string; sequencia: string[]; porque: string }>
}

/** O que a guarda achou: a regra (id) e o porque, para a recusa dizer o motivo. */
export type Achado = { regra: string; porque: string }

const SECOES = ['ganchosProibidos', 'decisoesProibidas', 'chamadasProibidas', 'argvProibido', 'ambienteProibido',
  'caminhosProibidos', 'reservadosAPonte', 'permitidos'] as const

function texto(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function listaDeTexto(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every(texto)
}

/** Confere a forma da lista; qualquer desvio e erro, porque a guarda fecha sem lista valida. */
export function validarAutoridade(x: unknown): Autoridade {
  const a = x as Record<string, unknown> | null
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('lista de autoridade nao e um objeto')
  if (a.formato !== FORMATO_DA_AUTORIDADE) throw new Error(`formato da lista de autoridade: ${String(a.formato)}`)
  if (!texto(a.regra)) throw new Error('lista de autoridade sem regra')
  const ids = new Set<string>()
  for (const secao of SECOES) {
    const itens = a[secao]
    if (!Array.isArray(itens)) throw new Error(`lista de autoridade sem a secao ${secao}`)
    for (const bruto of itens) {
      const item = bruto as Record<string, unknown>
      if (!item || !texto(item.id) || !texto(item.porque)) throw new Error(`item sem id ou porque em ${secao}`)
      if (ids.has(item.id as string)) throw new Error(`id repetido na lista de autoridade: ${String(item.id)}`)
      ids.add(item.id as string)
      const falta = (campo: string) => { throw new Error(`${secao}/${String(item.id)} sem ${campo}`) }
      if ((secao === 'ganchosProibidos' || secao === 'reservadosAPonte' || secao === 'decisoesProibidas') && !texto(item.evento)) falta('evento')
      if (secao === 'decisoesProibidas' && !texto(item.decisao)) falta('decisao')
      if (secao === 'chamadasProibidas' && !texto(item.chamada)) falta('chamada')
      if (secao === 'ambienteProibido' && !texto(item.prefixo)) falta('prefixo')
      if (secao === 'caminhosProibidos' && !texto(item.trecho)) falta('trecho')
      if (secao === 'permitidos' && !listaDeTexto(item.sequencia)) falta('sequencia')
      if (secao === 'argvProibido') {
        const porSequencia = listaDeTexto(item.sequencia)
        const porPrograma = texto(item.programa)
        if (porSequencia === porPrograma) throw new Error(`argvProibido/${String(item.id)} precisa de sequencia ou programa, um so`)
        if (item.opcao !== undefined && !(texto(item.opcao) && (item.opcao as string).startsWith('--'))) falta('opcao com --')
        if (item.subcomando !== undefined && !texto(item.subcomando)) falta('subcomando')
      }
    }
  }
  return a as unknown as Autoridade
}

/** Le e confere o texto do `autoridade.json`. */
export function lerAutoridade(conteudo: string): Autoridade {
  return validarAutoridade(JSON.parse(conteudo))
}

/** Mod do Orkastery: nome `ork-*` ou pasta com `orkastery-mod.json` (os conhecidos vem do `plugin.register`). */
export function ehModDoOrkastery(nome: unknown, conhecidos?: { has: (n: string) => boolean }): boolean {
  return typeof nome === 'string' && (nome.startsWith('ork-') || (conhecidos?.has(nome) ?? false))
}

function nomeBase(token: string): string {
  const t = token.replace(/\/+$/, '')
  return t.slice(t.lastIndexOf('/') + 1)
}

/** As palavras posicionais e as opcoes, exatamente como o `parseArgs` do CLI do ork as separa. */
export function separarArgs(resto: readonly string[]): { posicionais: string[]; opcoes: Set<string> } {
  const posicionais: string[] = []
  const opcoes = new Set<string>()
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i] as string
    if (a.startsWith('--')) {
      const igual = a.indexOf('=')
      if (igual > 0) { opcoes.add(a.slice(2, igual)); continue }
      opcoes.add(a.slice(2))
      const proximo = resto[i + 1]
      if (proximo !== undefined && !proximo.startsWith('--')) i++
    } else posicionais.push(a)
  }
  return { posicionais, opcoes }
}

function comecaCom(lista: readonly string[], prefixo: readonly string[]): boolean {
  return prefixo.length > 0 && prefixo.every((p, i) => lista[i] === p)
}

const WRAPPERS = new Set(['env', 'nohup', 'timeout', 'nice', 'ionice', 'setsid', 'stdbuf', 'sudo', 'doas', 'command',
  'exec', 'time', 'xargs', 'chrt', 'taskset', 'unbuffer', 'then', 'do', 'else', 'if', 'while', 'until', '!'])
const OPCOES_COM_VALOR: Record<string, readonly string[]> = {
  env: ['-u', '--unset', '-C', '--chdir'], sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U'],
  nice: ['-n', '--adjustment'], ionice: ['-c', '-n', '-p'], timeout: ['-k', '--kill-after', '-s', '--signal'],
  xargs: ['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s'], chrt: ['-p'], taskset: ['-p'], doas: ['-u', '-C'],
}
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh', 'mksh', 'ash', 'fish', 'busybox'])
const INTERPRETADORES: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'], nodejs: ['-e', '--eval', '-p', '--print'], deno: ['eval'],
  bun: ['-e', '--eval'], python: ['-c'], python3: ['-c'], perl: ['-e', '-E'], ruby: ['-e'], php: ['-r'],
}
const OPCOES_GLOBAIS_DO_GIT = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']
const ENTRADA_DO_ORK = /(^|\/)(ork|ork\.c?js|ork\.mjs|index\.c?js|cli\.c?js)$/
const MAX_PROFUNDIDADE = 4

/** Tira o que so embrulha o comando (`env A=1`, `nohup`, `timeout 10`, `sudo -u x`) e devolve o comando de fato. */
function semEmbrulho(tokens: readonly string[]): { tokens: string[]; scriptDoEnv?: string } {
  let t = [...tokens]
  for (let voltas = 0; voltas < 8 && t.length > 0; voltas++) {
    while (t.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0] as string)) t = t.slice(1)
    const base = nomeBase(t[0] ?? '')
    if (!WRAPPERS.has(base)) break
    t = t.slice(1)
    const comValor = OPCOES_COM_VALOR[base] ?? []
    while (t.length > 0) {
      const a = t[0] as string
      if (base === 'env' && (a === '-S' || a === '--split-string')) return { tokens: [], scriptDoEnv: t[1] ?? '' }
      if (comValor.includes(a)) { t = t.slice(2); continue }
      if (a.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) { t = t.slice(1); continue }
      if (base === 'timeout' && /^\d+(\.\d+)?[smhd]?$/.test(a)) { t = t.slice(1); continue }
      break
    }
  }
  return { tokens: t }
}

/** O resto do argv quando ele chama o CLI do ork (por `ork`, `node .../index.js` ou `npx ork`); `null` se nao chama. */
function restoDoOrk(tokens: readonly string[]): string[] | null {
  const base = nomeBase(tokens[0] ?? '')
  if (base === 'ork') return tokens.slice(1)
  if (base === 'node' || base === 'nodejs') {
    let i = 1
    while (i < tokens.length && (tokens[i] as string).startsWith('-')) i += ['-r', '--require', '--import', '--loader'].includes(tokens[i] as string) ? 2 : 1
    const script = tokens[i]
    if (script !== undefined && (ENTRADA_DO_ORK.test(script) || script.includes('@orkastery/'))) return tokens.slice(i + 1)
  }
  return null
}

function avaliarOrk(a: Autoridade, resto: readonly string[]): Achado | null {
  const { posicionais, opcoes } = separarArgs(resto)
  if (a.permitidos.some(p => comecaCom(posicionais, p.sequencia))) return null
  for (const r of a.argvProibido) {
    if (!r.sequencia || !comecaCom(posicionais, r.sequencia)) continue
    if (r.opcao !== undefined && !opcoes.has(r.opcao.replace(/^--/, ''))) continue
    return { regra: r.id, porque: r.porque }
  }
  return null
}

function avaliarPrograma(a: Autoridade, tokens: readonly string[]): Achado | null {
  const base = nomeBase(tokens[0] ?? '')
  for (const r of a.argvProibido) {
    if (!r.programa || r.programa !== base) continue
    if (r.subcomando === undefined) return { regra: r.id, porque: r.porque }
    let i = 1
    while (i < tokens.length) {
      const t = tokens[i] as string
      if (base === 'git' && OPCOES_GLOBAIS_DO_GIT.includes(t)) { i += 2; continue }
      if (t.startsWith('-')) { i++; continue }
      break
    }
    if (tokens[i] === r.subcomando) return { regra: r.id, porque: r.porque }
  }
  return null
}

/** Um caminho lido ou citado que esta na lista (`.hermes/.env`), com as barras normalizadas. */
export function avaliarCaminho(a: Autoridade, caminho: unknown): Achado | null {
  if (typeof caminho !== 'string') return null
  const normal = caminho.replace(/\\/g, '/').replace(/\/(\.\/)+/g, '/').replace(/\/{2,}/g, '/')
  const r = a.caminhosProibidos.find(c => normal.includes(c.trecho))
  return r ? { regra: r.id, porque: r.porque } : null
}

/** Uma variavel de ambiente da lista (`ORK_HITL_*`). */
export function avaliarAmbiente(a: Autoridade, nome: unknown): Achado | null {
  if (typeof nome !== 'string') return null
  const r = a.ambienteProibido.find(p => nome.startsWith(p.prefixo))
  return r ? { regra: r.id, porque: r.porque } : null
}

/** Separa um texto de shell em comandos e palavras: aspas respeitadas; `;`, `&`, `|`, `(`, `)`, crase e `$(` cortam. */
export function comandosDoTexto(textoDoShell: string): string[][] {
  const comandos: string[][] = []
  let atual: string[] = []
  let palavra = ''
  let temPalavra = false
  let aspa: '"' | "'" | null = null
  const fecharPalavra = () => { if (temPalavra) atual.push(palavra); palavra = ''; temPalavra = false }
  const fecharComando = () => { fecharPalavra(); if (atual.length > 0) comandos.push(atual); atual = [] }
  for (let i = 0; i < textoDoShell.length; i++) {
    const c = textoDoShell[i] as string
    if (aspa !== null) {
      if (c === aspa) aspa = null
      else palavra += c
      continue
    }
    if (c === '"' || c === "'") { aspa = c; temPalavra = true; continue }
    if (c === '\\' && i + 1 < textoDoShell.length) { palavra += textoDoShell[++i]; temPalavra = true; continue }
    if (c === ' ' || c === '\t') { fecharPalavra(); continue }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '(' || c === ')' || c === '`' || c === '{' || c === '}') { fecharComando(); continue }
    if (c === '$' && textoDoShell[i + 1] === '(') { fecharComando(); i++; continue }
    palavra += c
    temPalavra = true
  }
  fecharComando()
  return comandos
}

/** Codigo de interpretador (`node -e`, `python -c`): leitura solta, por palavras, so para pegar o obvio. */
function avaliarCodigoSolto(a: Autoridade, codigo: string): Achado | null {
  const palavras = codigo.split(/[^A-Za-z0-9_.\/@-]+/).filter(Boolean)
  for (let i = 0; i < palavras.length; i++) {
    const base = nomeBase(palavras[i] as string)
    for (const r of a.argvProibido) {
      if (r.programa && r.programa === base) {
        if (r.subcomando === undefined || palavras.slice(i + 1, i + 6).includes(r.subcomando)) return { regra: r.id, porque: r.porque }
      }
      if (r.sequencia && comecaCom(palavras.slice(i), r.sequencia)) {
        if (r.opcao === undefined || palavras.includes(r.opcao)) return { regra: r.id, porque: r.porque }
      }
    }
  }
  return avaliarCaminho(a, codigo)
}

/** Um texto de shell: cada comando dele passa pela regra de argv. */
export function avaliarTexto(a: Autoridade, textoDoShell: string, profundidade = 0): Achado | null {
  const direto = avaliarCaminho(a, textoDoShell)
  if (direto) return direto
  for (const comando of comandosDoTexto(textoDoShell)) {
    const achado = avaliarArgv(a, comando, undefined, profundidade + 1)
    if (achado) return achado
  }
  return null
}

/**
 * Um argv que um mod quer rodar (`$.process.run`, `$.process.spawn`), com o texto do `stdin` quando o comando e
 * um shell que le o script da entrada. Devolve o primeiro achado ou `null`.
 */
export function avaliarArgv(a: Autoridade, argv: readonly unknown[], stdin?: unknown, profundidade = 0): Achado | null {
  if (profundidade > MAX_PROFUNDIDADE) return { regra: 'profundidade', porque: 'comando aninhado demais para a guarda conferir' }
  const brutos = argv.map(t => String(t))
  for (const t of brutos) {
    const caminho = avaliarCaminho(a, t)
    if (caminho) return caminho
  }
  const { tokens, scriptDoEnv } = semEmbrulho(brutos)
  if (scriptDoEnv !== undefined) return avaliarTexto(a, scriptDoEnv, profundidade)
  if (tokens.length === 0) return null
  const base = nomeBase(tokens[0] as string)
  if (base === 'eval') return avaliarTexto(a, tokens.slice(1).join(' '), profundidade)
  if (SHELLS.has(base)) {
    const i = tokens.findIndex((t, j) => j > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(t))
    if (i > 0) return tokens[i + 1] === undefined ? null : avaliarTexto(a, tokens[i + 1] as string, profundidade)
    const temScript = tokens.slice(1).some(t => !t.startsWith('-'))
    if (!temScript && typeof stdin === 'string') return avaliarTexto(a, stdin, profundidade)
    return null
  }
  const inline = INTERPRETADORES[base]
  if (inline) {
    const i = tokens.findIndex((t, j) => j > 0 && inline.includes(t))
    if (i > 0 && tokens[i + 1] !== undefined) return avaliarCodigoSolto(a, tokens[i + 1] as string)
  }
  if (['npx', 'pnpx', 'bunx'].includes(base)) {
    let i = 1
    while (i < tokens.length && (tokens[i] as string).startsWith('-')) i++
    const alvo = tokens[i] ?? ''
    if (alvo === 'ork' || alvo.startsWith('@orkastery/')) return avaliarOrk(a, tokens.slice(i + 1))
    return avaliarArgv(a, tokens.slice(i), undefined, profundidade + 1)
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(base)) {
    const i = tokens.findIndex((t, j) => j > 0 && (t === 'exec' || t === 'x' || t === 'dlx'))
    if (i > 0) {
      let j = i + 1
      while (j < tokens.length && (tokens[j] as string).startsWith('-')) j++
      const alvo = tokens[j] ?? ''
      if (alvo === 'ork' || alvo.startsWith('@orkastery/')) return avaliarOrk(a, tokens.slice(j + 1))
      return avaliarArgv(a, tokens.slice(j), undefined, profundidade + 1)
    }
  }
  const programa = avaliarPrograma(a, tokens)
  if (programa) return programa
  const resto = restoDoOrk(tokens)
  return resto === null ? null : avaliarOrk(a, resto)
}

type Glob = { exato: string } | { prefixo: string }

function glob(padrao: string): Glob {
  if (padrao === '*') return { prefixo: '' }
  return padrao.endsWith('.*') ? { prefixo: padrao.slice(0, -1) } : { exato: padrao }
}

/** O padrao de um `on(...)` (`*`, `fs.*`, `fs.read`) alcanca o evento ou o padrao da lista? */
export function sobrepoe(padraoDoMod: string, padraoDaLista: string): boolean {
  if (padraoDoMod.startsWith('!')) return false
  if (padraoDoMod.startsWith('telemetry.') || padraoDaLista.startsWith('telemetry.')) return padraoDoMod === padraoDaLista
  const m = glob(padraoDoMod)
  const l = glob(padraoDaLista)
  if ('exato' in m && 'exato' in l) return m.exato === l.exato
  if ('exato' in m) return m.exato.startsWith((l as { prefixo: string }).prefixo)
  if ('exato' in l) return l.exato.startsWith(m.prefixo)
  return m.prefixo.startsWith(l.prefixo) || l.prefixo.startsWith(m.prefixo)
}

/** Ganchos de um mod (os padroes do `on`): proibidos (sem componente) ou reservados a ponte. */
export function avaliarEventos(a: Autoridade, eventos: readonly string[], ehPonte = false): Achado | null {
  for (const evento of eventos) {
    const proibido = a.ganchosProibidos.find(g => g.componente === undefined && sobrepoe(evento, g.evento))
    if (proibido) return { regra: proibido.id, porque: proibido.porque }
    if (ehPonte) continue
    const reservado = a.reservadosAPonte.find(r => sobrepoe(evento, r.evento))
    if (reservado) return { regra: reservado.id, porque: `gancho reservado a ponte: ${reservado.porque}` }
  }
  return null
}

/** O que o motor escaneou de um modulo no `plugin.register`: ganchos, chamadas e variaveis lidas. */
export function avaliarUses(a: Autoridade, uses: { events?: readonly string[]; calls?: readonly string[]; env?: { reads?: readonly string[] } },
  ehPonte = false): Achado | null {
  const eventos = avaliarEventos(a, uses.events ?? [], ehPonte)
  if (eventos) return eventos
  for (const c of a.chamadasProibidas) {
    if (c.tipo === undefined && (uses.calls ?? []).includes(c.chamada)) return { regra: c.id, porque: c.porque }
  }
  for (const nome of uses.env?.reads ?? []) {
    const achado = avaliarAmbiente(a, nome)
    if (achado) return achado
  }
  return null
}
