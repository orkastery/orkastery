// A pista de entrega (RM-059, fatia F7; ficha M7 do plano dos mods). Modulo puro: o argv da leitura do nucleo
// (`ork ship pista --json`, contrato `ork.ship-pista/v1`), a conferencia da saida campo a campo, a ordem das pistas, a
// linha da faixa, as linhas do painel com o que cada uma mostra ao dono e o desenho. Quem calcula as etapas e o
// proximo passo e o nucleo (D4 da thread ork-rm059pista); aqui so se le, se ordena e se desenha. O `$` fica no
// register.tsx, e o desenho recebe a tabela de elementos que a superficie resolveu.
import type { PistaAcao, PistaEstadoDaEtapa, PistaEtapa, PistaIdDaEtapa, PistaLinha, PistaMostrado, PistaPr, PistaProximo, PistaQuadro } from '../types'

export const ETAPAS: readonly PistaIdDaEtapa[] = ['check', 'verify', 'bundle', 'branch', 'pr', 'ci', 'conflito', 'entrega']
const ESTADOS: readonly PistaEstadoDaEtapa[] = ['feita', 'pendente', 'falhou', 'nao-lida', 'nao-se-aplica']
const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
const SHA = /^[0-9a-f]{40}$/
/** O nome curto de cada etapa no painel. */
export const NOME_DA_ETAPA: Readonly<Record<PistaIdDaEtapa, string>> = {
  check: 'CHECK', verify: 'verify', bundle: 'bundle', branch: 'branch', pr: 'PR', ci: 'CI', conflito: 'conflito', entrega: 'entrega',
}
/** A marca de cada estado de etapa: o que falta e o que falhou saltam aos olhos. */
export const MARCA_DA_ETAPA: Readonly<Record<PistaEstadoDaEtapa, string>> = {
  'feita': '✓', 'pendente': '·', 'falhou': '✗', 'nao-lida': '?', 'nao-se-aplica': '-',
}
/** Teto de pistas no quadro: cada uma ocupa umas cinco linhas do painel. */
export const TETO_DE_PISTAS = 30
const TETO_DE_TEXTO = 300

export type SaidaDoProcesso = { exitCode: number; stdout: string; stderr: string }

/** Uma linha so, sem caractere de controle, com teto: texto que vem do nucleo e vai para a tela. */
export function umaLinha(v: unknown, teto = TETO_DE_TEXTO): string {
  const s = typeof v === 'string' ? v : v instanceof Error ? v.message : String(v)
  return Array.from(s.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, teto).join('')
}

export function exigirThread(thread: unknown): string {
  if (typeof thread !== 'string' || !ID_DE_THREAD.test(thread)) throw new Error('ork-pista: id de thread invalido')
  return thread
}

/** O argv da leitura da pista, de todas as threads ou de uma: o unico jeito de a Pista ler as etapas. */
export function argvDaPista(thread?: string): string[] {
  return thread === undefined ? ['ork', 'ship', 'pista', '--json'] : ['ork', 'ship', 'pista', exigirThread(thread), '--json']
}

/** A saida de um comando `--json` do nucleo, ou o motivo de nao ter sido lida (o CLI sem o subcomando incluso). */
export function jsonDaSaida(saida: SaidaDoProcesso, comando: string): unknown {
  if (saida.exitCode === 2 && /(subcomando desconhecido|uso: ork ship|usage: ork ship|comando desconhecido)/i.test(`${saida.stderr}\n${saida.stdout}`)) {
    throw new Error(`o ork deste PATH não tem ${comando}: atualize o CLI do Orkastery`)
  }
  try {
    return JSON.parse(saida.stdout)
  } catch {
    const motivo = umaLinha(saida.stderr || saida.stdout, 160) || `saída ${saida.exitCode}`
    throw new Error(`${comando} não devolveu JSON (saída ${saida.exitCode}): ${motivo}`)
  }
}

const texto = (v: unknown, teto = TETO_DE_TEXTO): string | null => (typeof v === 'string' && v.trim() !== '' ? umaLinha(v, teto) : null)

function etapaDe(bruto: unknown, id: PistaIdDaEtapa): PistaEtapa | null {
  if (!bruto || typeof bruto !== 'object') return null
  const e = bruto as Record<string, unknown>
  if (e.id !== id || !ESTADOS.includes(e.estado as PistaEstadoDaEtapa)) return null
  return { id, estado: e.estado as PistaEstadoDaEtapa, texto: texto(e.texto) ?? '' }
}

function prDe(bruto: unknown): PistaPr | null | undefined {
  if (bruto === null) return null
  if (!bruto || typeof bruto !== 'object') return undefined
  const p = bruto as Record<string, unknown>
  if (!Number.isSafeInteger(p.numero) || (p.numero as number) < 1 || !['aberto', 'mesclado', 'fechado'].includes(String(p.estado)) ||
    typeof p.rascunho !== 'boolean' || typeof p.head !== 'string' || !SHA.test(p.head)) return undefined
  const url = typeof p.url === 'string' && /^https:\/\/\S+$/.test(p.url) ? umaLinha(p.url, 300) : null
  return { numero: p.numero as number, url, estado: p.estado as PistaPr['estado'], rascunho: p.rascunho, head: p.head }
}

function proximoDe(bruto: unknown): PistaProximo | null {
  if (!bruto || typeof bruto !== 'object') return null
  const p = bruto as Record<string, unknown>
  const acao = p.acao === 'publicar' || p.acao === 'registrar' ? p.acao : p.acao === null ? null : undefined
  if (acao === undefined || typeof p.disponivel !== 'boolean') return null
  const t = texto(p.texto)
  if (!t) return null
  // So uma acao conhecida pode estar disponivel; o resto vira texto.
  return { acao, disponivel: acao !== null && p.disponivel, texto: t, comando: texto(p.comando, 600) }
}

/** Uma pista do nucleo, conferida campo a campo; `null` quando ela nao tem a forma do contrato. */
export function linhaDaPista(bruto: unknown): PistaLinha | null {
  if (!bruto || typeof bruto !== 'object') return null
  const p = bruto as Record<string, unknown>
  if (typeof p.thread !== 'string' || !ID_DE_THREAD.test(p.thread) || typeof p.publicavel !== 'boolean' || typeof p.conduzida !== 'boolean') return null
  if (!Array.isArray(p.etapas) || p.etapas.length !== ETAPAS.length) return null
  const etapas = ETAPAS.map((id, i) => etapaDe((p.etapas as unknown[])[i], id))
  if (etapas.some(e => e === null)) return null
  const pr = prDe(p.pr)
  const proximo = proximoDe(p.proximo)
  const head = typeof p.head === 'string' && SHA.test(p.head) ? p.head : null
  if (pr === undefined || !proximo) return null
  return {
    thread: p.thread, nome: texto(p.nome, 120) ?? p.thread, tag: texto(p.tag, 20) ?? '', publicavel: p.publicavel, conduzida: p.conduzida,
    branch: texto(p.branch, 200) ?? '', head, pr, etapas: etapas as PistaEtapa[], proximo,
  }
}

/**
 * A saida do `ork ship pista --json`, conferida: o contrato, uma pista por thread (no maximo `TETO_DE_PISTAS`) e os
 * avisos do que nao foi lido. Saida que nao e o contrato lanca, e o quadro anterior fica.
 */
export function lerPista(saida: SaidaDoProcesso, agora: number): PistaQuadro {
  const bruto = jsonDaSaida(saida, 'ork ship pista') as Record<string, unknown> | null
  if (!bruto || typeof bruto !== 'object' || bruto.contrato !== 'ork.ship-pista/v1' || !Array.isArray(bruto.pistas)) {
    throw new Error('a saída do ork ship pista não é o contrato ork.ship-pista/v1')
  }
  const linhas = (bruto.pistas as unknown[]).map(linhaDaPista).filter((l): l is PistaLinha => l !== null)
  const avisos: string[] = []
  if (bruto.remotoLido === false) avisos.push(`o remoto ${texto(bruto.remoto, 60) ?? ''} não respondeu ao ls-remote`)
  if (bruto.prsLidos === false) avisos.push(`os PRs não foram lidos: ${texto(bruto.prsNaoLidos, 200) ?? 'sem motivo'}`)
  const descartadas = (bruto.pistas as unknown[]).length - linhas.length
  if (descartadas > 0) avisos.push(`${descartadas} pista(s) fora do contrato ficaram de fora`)
  if (linhas.length > TETO_DE_PISTAS) avisos.push(`${linhas.length - TETO_DE_PISTAS} pista(s) além do teto ficaram de fora`)
  return { linhas: ordenarLinhas(linhas).slice(0, TETO_DE_PISTAS), lidoEm: agora, erro: null, avisos }
}

/**
 * A assinatura da secao `ship` do retrato do nucleo (o retrato da ponte): muda quando uma entrega anda (`ship_done`,
 * `ship_started`, `ship_blocked`), e entao a pista e relida antes da idade. `null` quando o retrato nao veio.
 */
export function assinaturaDoRetrato(r: unknown): string | null {
  const secao = (r as { retrato?: { sections?: { ship?: { items?: unknown } } } } | null)?.retrato?.sections?.ship
  if (!secao || !Array.isArray(secao.items)) return null
  return (secao.items as unknown[]).map(i => {
    const x = (i ?? {}) as { id?: unknown; status?: unknown; facts?: { receiptAt?: unknown } }
    return `${String(x.id)}|${String(x.status)}|${String(x.facts?.receiptAt ?? '')}`
  }).sort().join(';')
}

/** O ledger de thread que mudou (`classic.FileChanged`), pelo caminho; `null` para outro arquivo. */
export function threadDoLedger(caminho: unknown): string | null {
  if (typeof caminho !== 'string') return null
  const m = /\/\.orkastery\/threads\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,79})\/ledger\.jsonl$/.exec(caminho)
  return m ? m[1] as string : null
}

/** O peso de uma pista na ordem: o que tem botao, o que falhou, o que anda, o que ja foi entregue. */
export function pesoDaPista(l: PistaLinha): number {
  if (l.proximo.disponivel) return 0
  if (l.proximo.acao === 'publicar') return 1
  if (l.etapas.some(e => e.estado === 'falhou')) return 2
  if (l.etapas.find(e => e.id === 'entrega')?.estado === 'feita') return 4
  return 3
}

export function ordenarLinhas(linhas: readonly PistaLinha[]): PistaLinha[] {
  return [...linhas].sort((a, b) => pesoDaPista(a) - pesoDaPista(b) || a.thread.localeCompare(b.thread))
}

/** A marca da pista no painel: `!` com botao, `?` pede o dono, `x` falhou, `>` anda, `-` entregue. */
export function marcaDaPista(l: PistaLinha): string {
  return ['!', '?', 'x', '>', '-'][pesoDaPista(l)] as string
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * A linha da faixa (D9): so o que pede o dono, sem repetir o que anda sozinho. Sem nada disso, a linha sai da
 * faixa. A ponte ja escreve `pista: ` antes dela.
 */
export function textoDaFaixa(q: PistaQuadro): string | undefined {
  const prontas = q.linhas.filter(l => l.proximo.acao === 'publicar' && l.proximo.disponivel).length
  const doDono = q.linhas.filter(l => l.proximo.acao === 'publicar' && !l.proximo.disponivel).length
  const registrar = q.linhas.filter(l => l.proximo.acao === 'registrar' && l.proximo.disponivel).length
  const vermelhas = q.linhas.filter(l => l.etapas.some(e => (e.id === 'ci' || e.id === 'conflito') && e.estado === 'falhou')).length
  const partes = [
    prontas ? plural(prontas, 'pronta para publicar', 'prontas para publicar') : null,
    doDono ? plural(doDono, 'pede o seu push', 'pedem o seu push') : null,
    registrar ? plural(registrar, 'para registrar', 'para registrar') : null,
    vermelhas ? plural(vermelhas, 'com CI vermelho ou conflito', 'com CI vermelho ou conflito') : null,
  ].filter((p): p is string => p !== null)
  return partes.length ? `${partes.join(' · ')} · /pista` : undefined
}

/** Quanto tempo faz, em palavras curtas. */
export function haQuanto(desde: number | null, agora: number): string {
  if (desde === null) return 'ainda não lida'
  const s = Math.max(0, Math.round((agora - desde) / 1000))
  if (s < 60) return `lida há ${s} s`
  const min = Math.round(s / 60)
  return min < 60 ? `lida há ${min} min` : `lida há ${Math.round(min / 60)} h`
}

/** Uma linha do painel, com o tipo que decide o elemento e o que ela mostra ao dono (para o registro da ponte). */
export type LinhaDoPainel = {
  tipo: 'placar' | 'aviso' | 'vazio' | 'cabecalho' | 'etapas' | 'etapa' | 'proximo' | 'botao' | 'comando' | 'resultado'
  texto: string
  thread?: string
  /** So na linha do botao: o comando do nucleo que ele chama (T7.3). */
  acao?: 'publicar' | 'registrar'
  mostrado?: PistaMostrado
}

/** O botao que o register.tsx decidiu para uma pista (o nucleo o declara disponivel), com o rotulo. */
export type BotaoDaPista = { acao: 'publicar' | 'registrar'; rotulo: string }

const linhaDasEtapas = (l: PistaLinha) => l.etapas.map(e => {
  const nome = e.id === 'pr' && l.pr ? `PR #${l.pr.numero}` : NOME_DA_ETAPA[e.id]
  return `${nome} ${MARCA_DA_ETAPA[e.estado]}`
}).join(' · ')

/** O texto do resultado do ultimo botao da thread, quando ha. */
export function textoDaAcao(a: PistaAcao | undefined): string | null {
  if (!a) return null
  const rotulo = a.acao === 'publicar' ? 'publicar' : 'registrar'
  if (a.estado === 'rodando') return `${rotulo}: rodando no núcleo...`
  return `${rotulo}: ${a.texto}`
}

/**
 * As linhas do painel, na ordem do desenho. A pista em foco (`/pista <thread>`) vem primeiro. Cada pista: o
 * cabecalho, as oito etapas numa linha, o texto de cada etapa que nao esta feita, o proximo passo do nucleo, o
 * comando (para o dono, quando o modo pede o push dele) e o resultado do ultimo botao.
 */
export function linhasDoPainel(q: PistaQuadro, opcoes: { agora: number; foco?: string | null; acoes?: Readonly<Record<string, PistaAcao>>;
  botoes?: Readonly<Record<string, BotaoDaPista>> }): LinhaDoPainel[] {
  const saida: LinhaDoPainel[] = []
  const prontas = q.linhas.filter(l => l.proximo.disponivel).length
  saida.push({ tipo: 'placar', texto: `Pista de Entrega · ${plural(q.linhas.length, 'entrega', 'entregas')}` +
    `${prontas ? ` · ${plural(prontas, 'com botão', 'com botão')}` : ''} · ${haQuanto(q.lidoEm, opcoes.agora)}` })
  if (q.erro) saida.push({ tipo: 'aviso', texto: `a última leitura falhou: ${q.erro}` })
  for (const aviso of q.avisos) saida.push({ tipo: 'aviso', texto: aviso })
  if (!q.linhas.length) {
    saida.push({ tipo: 'vazio', texto: q.lidoEm === null ? 'lendo a pista do núcleo...'
      : 'Nenhuma entrega na pista: a thread entra aqui depois do CHECK, com a branch publicada ou com PR.' })
    return saida
  }
  const foco = opcoes.foco ?? null
  const ordem = foco ? [...q.linhas.filter(l => l.thread === foco), ...q.linhas.filter(l => l.thread !== foco)] : q.linhas
  for (const l of ordem) {
    const emFoco = l.thread === foco ? '  (em foco)' : ''
    saida.push({ tipo: 'cabecalho', thread: l.thread, texto: `${marcaDaPista(l)}  ${l.thread}  ${l.tag}  ${l.branch}${emFoco}` })
    saida.push({ tipo: 'etapas', thread: l.thread, texto: `  ${linhaDasEtapas(l)}` })
    for (const e of l.etapas.filter(x => x.estado === 'pendente' || x.estado === 'falhou' || x.estado === 'nao-lida')) {
      saida.push({ tipo: 'etapa', thread: l.thread, texto: `    ${NOME_DA_ETAPA[e.id]}: ${e.texto}` })
    }
    const proximo = `  próximo: ${l.proximo.texto}`
    saida.push({ tipo: 'proximo', thread: l.thread, texto: proximo,
      mostrado: { chave: `pista:${l.thread}`, thread: l.thread, texto: `${l.thread}: ${l.proximo.texto}` } })
    // O botao so aparece com a acao declarada e sem outro clique da mesma thread rodando no nucleo.
    const botao = opcoes.botoes?.[l.thread]
    if (botao && opcoes.acoes?.[l.thread]?.estado !== 'rodando') saida.push({ tipo: 'botao', thread: l.thread, acao: botao.acao, texto: botao.rotulo })
    if (l.proximo.comando && !l.proximo.disponivel) {
      const quem = l.proximo.acao === 'publicar' ? 'no seu terminal' : 'comando do núcleo'
      saida.push({ tipo: 'comando', thread: l.thread, texto: `  ${quem}: ${l.proximo.comando}` })
    }
    const acao = textoDaAcao(opcoes.acoes?.[l.thread])
    if (acao) saida.push({ tipo: 'resultado', thread: l.thread, texto: `  ${acao}`,
      mostrado: { chave: `pista:${l.thread}:acao`, thread: l.thread, texto: `${l.thread}: ${acao}` } })
  }
  return saida
}

/**
 * As linhas da tela que um texto com `wrap="wrap"` ocupa em `colunas` celulas: quebra por palavra, e a palavra maior que
 * a linha quebra no meio. A conta usa uma coluna de folga: na duvida sobra linha, e o que sobra fica fora da janela; o
 * mostrado nunca passa do que o dono viu.
 */
export function linhasDaTela(texto: string, colunas: number | undefined): number {
  if (typeof colunas !== 'number' || !(colunas > 1)) return 1
  const largura = colunas - 1
  let linhas = 1
  let usadas = 0
  texto.split(' ').forEach((palavra, i) => {
    let tamanho = Array.from(palavra).length
    const espaco = i === 0 ? 0 : 1
    if (usadas + espaco + tamanho <= largura) {
      usadas += espaco + tamanho
      return
    }
    if (usadas > 0) {
      linhas++
      usadas = 0
    }
    while (tamanho > largura) {
      linhas++
      tamanho -= largura
    }
    usadas = tamanho
  })
  return linhas
}

/** A altura de uma linha do painel na tela: `proximo` e `comando` quebram (`wrap="wrap"`); as outras truncam numa so. */
function alturaNaTela(l: { tipo?: string; texto?: string }, colunas: number | undefined): number {
  return l.tipo === 'proximo' || l.tipo === 'comando' ? linhasDaTela(l.texto ?? '', colunas) : 1
}

/**
 * O que esta inteiro dentro da janela de rolagem do painel: so isso conta como mostrado ao dono (M5). A janela conta
 * linhas da tela (`offset` e `bodyRows`), e a linha que quebra nas `colunas` do corpo ocupa mais de uma.
 */
export function mostradosVisiveis(linhas: ReadonlyArray<{ tipo?: string; texto?: string; mostrado?: PistaMostrado }>,
  janela: { offset: number; bodyRows: number } | undefined, colunas?: number): PistaMostrado[] {
  if (!janela || !(janela.bodyRows > 0)) return []
  const fim = janela.offset + janela.bodyRows
  const vistos: PistaMostrado[] = []
  let topo = 0
  for (const l of linhas) {
    const altura = alturaNaTela(l, colunas)
    if (l.mostrado && topo >= janela.offset && topo + altura <= fim) vistos.push(l.mostrado)
    topo += altura
  }
  return vistos
}

/** Os gestos do painel: atualizar a pista e, na T7.3, os botoes que o nucleo declara. */
export type Gestos = {
  atualizar?: () => void
  publicar?: (thread: string) => void
  registrar?: (thread: string) => void
}

/**
 * A arvore do painel com os elementos que a superficie resolveu (no register.tsx), uma linha da
 * tela por elemento: so `Box`, `Text` e `Button`, no terminal e no desktop.
 */
export function desenharPista(el: { Box: any; Text: any; Button: any }, q: PistaQuadro,
  opcoes: { agora: number; foco?: string | null; acoes?: Readonly<Record<string, PistaAcao>>; botoes?: Readonly<Record<string, BotaoDaPista>> } & Gestos) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {linhasDoPainel(q, opcoes).map((l, i) => {
        if (l.tipo === 'placar') {
          return (
            <Box key="placar" flexDirection="row">
              <Text key="placar-texto" bold wrap="truncate">{l.texto}</Text>
              <Button key="atualizar" label="Atualizar" onPress={() => opcoes.atualizar?.()} />
            </Box>
          )
        }
        if (l.tipo === 'cabecalho') return <Text key={`cabecalho:${l.thread}`} bold wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'botao' && l.thread && l.acao) {
          const thread = l.thread
          const apertar = l.acao === 'publicar' ? opcoes.publicar : opcoes.registrar
          return <Button key={`${l.acao}:${thread}`} label={l.texto} onPress={() => apertar?.(thread)} />
        }
        if (l.tipo === 'comando') return <Text key={`comando:${l.thread}`} wrap="wrap">{l.texto}</Text>
        if (l.tipo === 'proximo') return <Text key={`proximo:${l.thread}`} wrap="wrap">{l.texto}</Text>
        return <Text key={`${l.tipo}:${l.thread ?? ''}:${i}`} dimColor wrap="truncate">{l.texto}</Text>
      })}
    </Box>
  )
}
