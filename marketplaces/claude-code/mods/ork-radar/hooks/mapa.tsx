// O painel do Radar de Colisão (RM-059, fatia F3, T3.2). Módulo puro: a grade threads × (base e threads) com a
// faixa de calor de cada par, as células do `Raster` do terminal, a tabela das outras superfícies, as linhas do
// painel com o que entra no registro do mostrado, a linha da faixa e as colisões novas que o dono ainda não viu.
// Nenhum `$` passa por aqui; o register.tsx resolve os elementos da superfície e os passa ao desenho.
import type { RadarCelula, RadarMapa, RadarThread } from '../types'
import { BASE, chaveDoPar, comandoQueResolve, contar, nomeDoLado, NOME_DA_BASE, textoDaBase, textoDosArquivos, textoSemColisao } from './colisao'

/** Largura de cada célula da matriz, em colunas do terminal. */
export const LARGURA_DA_CELULA = 3
/** Teto do rótulo de cada thread na coluna da esquerda. */
export const LARGURA_DO_ROTULO = 28

/** A faixa de calor de um par (D10 e T3.2): limpo, 1 arquivo, 2 ou 3, 4 ou mais, erro, não calculado ou sem par. */
export type Faixa = 'limpa' | 'baixa' | 'media' | 'alta' | 'erro' | 'pendente' | 'vazia' | 'diagonal'

/** As cores de cada faixa (fundo e frente em hex; null é a cor padrão da superfície) e o símbolo da célula. */
export const PALETA: Readonly<Record<Faixa, { fundo: string | null; frente: string | null }>> = {
  limpa: { fundo: '#2e7d32', frente: '#ffffff' },
  baixa: { fundo: '#f9a825', frente: '#000000' },
  media: { fundo: '#ef6c00', frente: '#000000' },
  alta: { fundo: '#c62828', frente: '#ffffff' },
  erro: { fundo: '#6a1b9a', frente: '#ffffff' },
  pendente: { fundo: '#546e7a', frente: '#ffffff' },
  vazia: { fundo: null, frente: null },
  diagonal: { fundo: null, frente: '#757575' },
}
/** A cor padrão do terminal no `Raster` (bit 24 sozinho). */
export const COR_PADRAO = 0x01000000

export type CelulaDaGrade = { faixa: Faixa; simbolo: string; par: RadarCelula | null }
export type Grade = { colunas: string[]; linhas: Array<{ thread: RadarThread; celulas: CelulaDaGrade[] }> }

/** A faixa de um par pelo estado e pelo número de arquivos em conflito. */
export function faixaDaCelula(c: RadarCelula | undefined): Faixa {
  if (c === undefined) return 'vazia'
  if (c.estado === 'limpa') return 'limpa'
  if (c.estado === 'erro') return 'erro'
  if (c.estado === 'pendente') return 'pendente'
  const n = c.arquivos.length
  return n >= 4 ? 'alta' : n >= 2 ? 'media' : 'baixa'
}

/** O símbolo da célula: o número de arquivos em conflito (`+` de 10 em diante), `.` limpo, `!` erro, `?` não calculado. */
export function simboloDaCelula(faixa: Faixa, c: RadarCelula | undefined): string {
  if (faixa === 'diagonal') return '-'
  if (faixa === 'vazia') return ' '
  if (faixa === 'limpa') return '.'
  if (faixa === 'erro') return '!'
  if (faixa === 'pendente') return '?'
  const n = c?.arquivos.length ?? 0
  return n >= 10 ? '+' : String(n)
}

/** A grade do mapa: a coluna da base (`m`) e uma por thread, e uma linha por thread, com a matriz simétrica. */
export function gradeDoMapa(m: RadarMapa): Grade {
  const porPar = new Map(m.celulas.map(c => [c.par, c]))
  const colunas = ['m', ...m.threads.map(t => t.rotulo)]
  const lados = [BASE, ...m.threads.map(x => x.id)]
  const linhas = m.threads.map((t, i) => {
    const celulas = lados.map((lado, j): CelulaDaGrade => {
      if (j === i + 1) return { faixa: 'diagonal', simbolo: simboloDaCelula('diagonal', undefined), par: null }
      const par = porPar.get(chaveDoPar(t.id, lado))
      const faixa = faixaDaCelula(par)
      return { faixa, simbolo: simboloDaCelula(faixa, par), par: par ?? null }
    })
    return { thread: t, celulas }
  })
  return { colunas, linhas }
}

/** Hex `#rrggbb` para a cor do `Raster` (`0x00RRGGBB`); null é a cor padrão. */
export function corDoRaster(hex: string | null): number {
  if (hex === null || !/^#[0-9a-fA-F]{6}$/.test(hex)) return COR_PADRAO
  return parseInt(hex.slice(1), 16)
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 padrão com preenchimento, sem depender do ambiente (o `Raster` pede as células assim). */
export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    s += (ALFABETO[(n >> 18) & 63] as string) + (ALFABETO[(n >> 12) & 63] as string)
    s += i + 1 < bytes.length ? ALFABETO[(n >> 6) & 63] : '='
    s += i + 2 < bytes.length ? ALFABETO[n & 63] : '='
  }
  return s
}

/** As triplas u32 `[codePoint, frente, fundo]` em little-endian, em base64, como o `Raster` as lê. */
export function codificarCelulas(palavras: readonly number[]): string {
  const bytes = new Uint8Array(palavras.length * 4)
  palavras.forEach((p, i) => {
    bytes[i * 4] = p & 255
    bytes[i * 4 + 1] = (p >>> 8) & 255
    bytes[i * 4 + 2] = (p >>> 16) & 255
    bytes[i * 4 + 3] = (p >>> 24) & 255
  })
  return base64(bytes)
}

/**
 * O `Raster` do terminal: uma linha de cabeçalho com o nome de cada coluna e uma linha por thread, cada célula com
 * 3 colunas (o símbolo no meio) e o fundo da faixa de calor.
 */
export function rasterDoMapa(m: RadarMapa): { columns: number; rows: number; cells: string } {
  const g = gradeDoMapa(m)
  const palavras: number[] = []
  const celula = (texto: string, frente: number, fundo: number) => {
    for (const ch of texto) palavras.push(ch.codePointAt(0) as number, frente, fundo)
  }
  for (const nome of g.colunas) celula(` ${nome} `, COR_PADRAO, COR_PADRAO)
  for (const linha of g.linhas) {
    for (const c of linha.celulas) celula(` ${c.simbolo} `, corDoRaster(PALETA[c.faixa].frente), corDoRaster(PALETA[c.faixa].fundo))
  }
  return { columns: g.colunas.length * LARGURA_DA_CELULA, rows: g.linhas.length + 1, cells: codificarCelulas(palavras) }
}

/** O rótulo da thread na coluna da esquerda, com a largura de todos os rótulos do mapa. */
export function rotuloDaThread(t: RadarThread, largura: number): string {
  return `${t.rotulo} ${t.id} ${t.fase}`.slice(0, LARGURA_DO_ROTULO).padEnd(largura)
}

/** A largura da coluna de rótulos. */
export function larguraDosRotulos(m: RadarMapa): number {
  return Math.min(LARGURA_DO_ROTULO, Math.max(0, ...m.threads.map(t => `${t.rotulo} ${t.id} ${t.fase}`.length))) + 1
}

/** O que o painel diz ter mostrado ao dono de um conflito, para o registro da ponte (M5 do dono). */
export type RadarMostrado = { chave: string; thread: string; texto: string }

export type LinhaDoPainel =
  | { tipo: 'titulo' | 'base' | 'erro' | 'legenda' | 'resolve' | 'nota'; texto: string }
  | { tipo: 'botao'; texto: string }
  | { tipo: 'matriz'; altura: number }
  | { tipo: 'conflito'; texto: string; nova: boolean; mostrado: RadarMostrado }

/** A legenda da matriz: cada símbolo que a célula pode ter. */
export const LEGENDA = `m = ${NOME_DA_BASE} · número = arquivos em conflito (+ = 10 ou mais) · . limpo · ! erro do git · ? não calculado · - a própria thread · vazio = sem branch local`

/** A idade da leitura, curta. */
export function idade(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  return min < 60 ? `${min} min` : `${Math.round(min / 60)} h`
}

/** O texto de um par em conflito: os dois lados e os arquivos com os leases que os cobrem. */
export function textoDoConflito(c: RadarCelula): string {
  return `${nomeDoLado(c.a)} × ${nomeDoLado(c.b)}: ${textoDosArquivos(c)}`
}

/** A thread que o registro do mostrado leva: o lado que não é a base. */
function threadDoPar(c: RadarCelula): string {
  return c.a === BASE ? c.b : c.a
}

/**
 * As linhas do painel, uma por linha da tela (a matriz ocupa uma por thread mais o cabeçalho): título, base, erro
 * da última rodada, botão Atualizar, matriz, legenda, conflitos com o comando que resolve, erros e lacunas.
 */
export function linhasDoPainel(m: RadarMapa, novas: readonly string[], agora: number): LinhaDoPainel[] {
  const conflitos = m.celulas.filter(c => c.estado === 'conflito')
  if (m.lidoEm === null) {
    const linhas: LinhaDoPainel[] = [{ tipo: 'titulo', texto: 'Radar de Colisão · ainda sem rodada' }]
    if (m.erro) linhas.push({ tipo: 'erro', texto: `a rodada parou: ${m.erro}` })
    linhas.push({ tipo: 'botao', texto: 'Atualizar' })
    return linhas
  }
  const omitidas = m.omitidas > 0 ? ` (mais ${m.omitidas} fora do teto)` : ''
  const comNovas = novas.length > 0 ? ` (${contar(novas.length, 'novo', 'novos')})` : ''
  const linhas: LinhaDoPainel[] = [
    { tipo: 'titulo', texto: `Radar de Colisão · ${contar(m.threads.length, 'thread', 'threads')}${omitidas} · ${contar(conflitos.length, 'par em conflito', 'pares em conflito')}${comNovas} · lido há ${idade(agora - m.lidoEm)}` },
    { tipo: 'base', texto: `base: ${textoDaBase(m.base)}` },
  ]
  if (m.erro) linhas.push({ tipo: 'erro', texto: `a última rodada parou: ${m.erro}; o mapa é o da rodada anterior` })
  linhas.push({ tipo: 'botao', texto: 'Atualizar' })
  if (m.threads.length === 0) {
    linhas.push({ tipo: 'nota', texto: 'nenhuma thread aberta para cruzar' })
    return linhas
  }
  linhas.push({ tipo: 'matriz', altura: m.threads.length + 1 })
  linhas.push({ tipo: 'legenda', texto: LEGENDA })
  for (const c of conflitos) {
    const texto = textoDoConflito(c)
    const nova = novas.includes(c.par)
    linhas.push({ tipo: 'conflito', texto: nova ? `nova: ${texto}` : texto, nova, mostrado: { chave: `radar:${c.par}`, thread: threadDoPar(c), texto } })
    linhas.push({ tipo: 'resolve', texto: `  resolve: ${comandoQueResolve(c)}` })
  }
  if (conflitos.length === 0) linhas.push({ tipo: 'nota', texto: textoSemColisao(m).replace(/^N/, 'n') })
  for (const c of m.celulas.filter(x => x.estado === 'erro')) linhas.push({ tipo: 'nota', texto: `erro em ${nomeDoLado(c.a)} × ${nomeDoLado(c.b)}: ${c.erro}` })
  const pendentes = m.celulas.filter(c => c.estado === 'pendente').length
  if (pendentes > 0) linhas.push({ tipo: 'nota', texto: `${pendentes === 1 ? '1 par ficou' : `${pendentes} pares ficaram`} para a próxima rodada` })
  const semBranch = m.threads.filter(t => t.sha === null).map(t => t.id)
  if (semBranch.length > 0) linhas.push({ tipo: 'nota', texto: `sem branch local: ${semBranch.join(', ')}` })
  for (const l of m.lacunas) linhas.push({ tipo: 'nota', texto: `lacuna: ${l}` })
  return linhas
}

/** Os conflitos que o mapa mostraria, com o texto do registro: o que pode ter ido ao registro e ainda vale. */
export function mostradosDoMapa(m: RadarMapa): RadarMostrado[] {
  return m.celulas.filter(c => c.estado === 'conflito').map(c => ({ chave: `radar:${c.par}`, thread: threadDoPar(c), texto: textoDoConflito(c) }))
}

/**
 * O pedaço da linha do conflito que coube na largura do painel: a linha é cortada (`wrap="truncate"`, com a
 * reticência na última coluna), e o registro leva só o que apareceu; null quando nada do conflito apareceu.
 */
export function mostradoNaLargura(l: Extract<LinhaDoPainel, { tipo: 'conflito' }>, colunas: number | undefined): RadarMostrado | null {
  if (colunas === undefined || !(colunas > 0) || l.texto.length <= colunas) return l.mostrado
  const prefixo = l.texto.length - l.mostrado.texto.length
  const texto = l.mostrado.texto.slice(0, Math.max(0, colunas - 1 - prefixo))
  return texto.trim() === '' ? null : { ...l.mostrado, texto }
}

/**
 * O que está dentro da janela de rolagem: as linhas da tela de `offset` até `offset + bodyRows`, cada conflito
 * só com o que coube na largura. Sem janela, nada conta como visto, porque o registro nunca diz que o dono viu
 * o que talvez não estivesse na tela.
 */
export function mostradosVisiveis(linhas: readonly LinhaDoPainel[], janela: { offset: number; bodyRows: number } | undefined,
  colunas?: number): RadarMostrado[] {
  if (!janela || !(janela.bodyRows > 0)) return []
  const fim = janela.offset + janela.bodyRows
  const vistos: RadarMostrado[] = []
  let linha = 0
  for (const l of linhas) {
    const altura = l.tipo === 'matriz' ? l.altura : 1
    if (l.tipo === 'conflito' && linha >= janela.offset && linha < fim) {
      const visto = mostradoNaLargura(l, colunas)
      if (visto) vistos.push(visto)
    }
    linha += altura
  }
  return vistos
}

/**
 * As colisões novas depois de uma rodada (D6): as que continuam em conflito somadas aos pares que a rodada
 * achou novos, sem repetição, na ordem do mapa.
 */
export function novasDepoisDaRodada(antigas: readonly string[], novosPares: readonly string[], m: RadarMapa): string[] {
  const emConflito = m.celulas.filter(c => c.estado === 'conflito').map(c => c.par)
  const querida = new Set([...antigas, ...novosPares])
  return emConflito.filter(par => querida.has(par))
}

/** A linha da faixa (D6): só com colisão nova ainda não vista; sem novas, a linha sai. */
export function textoDaFaixa(m: RadarMapa, novas: readonly string[]): string | undefined {
  const primeira = m.celulas.find(c => c.par === novas[0] && c.estado === 'conflito')
  if (!primeira) return undefined
  const n = primeira.arquivos.length
  const resto = novas.length > 1 ? ` e mais ${novas.length - 1}` : ''
  // A ponte já põe o nome do mod antes da linha (`radar: `).
  return `colisão nova entre ${nomeDoLado(primeira.a)} e ${nomeDoLado(primeira.b)} (${contar(n, 'arquivo', 'arquivos')})${resto}; /radar abre o mapa`
}

export type ElementosDoPainel = { Box: any; Text: any; Button: any; Raster?: any }

/**
 * A matriz: no terminal, rótulos em `Text` e as células num `Raster`; fora dele, uma tabela de `Box` e `Text`. A
 * superfície decide, não a presença do construtor: fora do terminal o `Raster` existe e vira fragmento vazio.
 */
function desenharMatriz(el: ElementosDoPainel, m: RadarMapa, terminal: boolean) {
  const { Box, Text, Raster } = el
  const largura = larguraDosRotulos(m)
  if (terminal && Raster) {
    const r = rasterDoMapa(m)
    return (
      <Box key="matriz" flexDirection="row">
        <Box key="rotulos" flexDirection="column">
          <Text key="rotulo-cabecalho" dimColor wrap="truncate">{''.padEnd(largura)}</Text>
          {m.threads.map(t => <Text key={`rotulo:${t.id}`} wrap="truncate">{rotuloDaThread(t, largura)}</Text>)}
        </Box>
        <Raster key="mapa" columns={r.columns} rows={r.rows} cells={r.cells} />
      </Box>
    )
  }
  const g = gradeDoMapa(m)
  return (
    <Box key="matriz" flexDirection="column">
      <Box key="cabecalho" flexDirection="row">
        <Text key="rotulo-cabecalho" dimColor wrap="truncate">{''.padEnd(largura)}</Text>
        {g.colunas.map(nome => <Text key={`coluna:${nome}`} dimColor>{` ${nome} `}</Text>)}
      </Box>
      {g.linhas.map(linha => (
        <Box key={`linha:${linha.thread.id}`} flexDirection="row">
          <Text key={`rotulo:${linha.thread.id}`} wrap="truncate">{rotuloDaThread(linha.thread, largura)}</Text>
          {linha.celulas.map((c, j) => {
            const cor = PALETA[c.faixa]
            return <Text key={`celula:${linha.thread.id}:${j}`} {...(cor.frente ? { color: cor.frente } : {})} {...(cor.fundo ? { backgroundColor: cor.fundo } : {})}>{` ${c.simbolo} `}</Text>
          })}
        </Box>
      ))}
    </Box>
  )
}

/** A árvore do painel com os elementos que a superfície resolveu, uma linha da tela por linha do painel. */
export function desenharPainel(el: ElementosDoPainel, m: RadarMapa, linhas: readonly LinhaDoPainel[],
  opcoes: { terminal: boolean; atualizar?: () => unknown }) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {linhas.map((l, i) => {
        if (l.tipo === 'titulo') return <Text key="titulo" bold wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'base') return <Text key="base" dimColor wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'erro') return <Text key="erro" color="error" wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'botao') return <Button key="atualizar" label={l.texto} onPress={() => opcoes.atualizar?.()} />
        if (l.tipo === 'matriz') return desenharMatriz(el, m, opcoes.terminal)
        if (l.tipo === 'legenda') return <Text key="legenda" dimColor wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'conflito') return <Text key={`conflito:${l.mostrado.chave}`} bold={l.nova} wrap="truncate">{l.texto}</Text>
        return <Text key={`${l.tipo}:${i}`} dimColor={l.tipo === 'nota'} wrap="truncate">{l.texto}</Text>
      })}
    </Box>
  )
}
