// A faixa acima do prompt dos mods do Orkastery (RM-059, T0.4; D7 do plano dos mods). A faixa e uma
// instancia so, e a arvore de um mod esconde a dos seguintes: por isso so a ponte desenha, uma linha por
// mod, a partir do que cada mod publica por `$.ork.faixa`. Modulo puro; o `$` fica no register.ts.
import type { OrkLinhaDaFaixa } from '../types'

export const TETO_DE_LINHAS = 4
export const TETO_DO_TEXTO = 200
const NOME_DE_MOD = /^[a-z0-9][a-z0-9-]{0,63}$/

export function nomeDeModValido(mod: unknown): mod is string {
  return typeof mod === 'string' && NOME_DE_MOD.test(mod)
}

/** Troca a linha de um mod (ou tira, sem texto), uma linha por mod, texto de uma linha e com teto. */
export function trocarLinha(linhas: readonly OrkLinhaDaFaixa[] | undefined, mod: string, texto: string | undefined,
  agora: number): OrkLinhaDaFaixa[] {
  const resto = (linhas ?? []).filter(l => l.mod !== mod)
  const limpo = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim().slice(0, TETO_DO_TEXTO) : ''
  return limpo === '' ? resto : [...resto, { mod, texto: limpo, em: agora }]
}

function rotulo(mod: string): string {
  return mod.startsWith('ork-') ? mod.slice(4) : mod
}

function cortar(texto: string, largura: number): string {
  if (largura < 2) return ''
  return texto.length <= largura ? texto : texto.slice(0, largura - 1) + '…'
}

/**
 * As linhas que a faixa mostra: uma por mod, em ordem de nome, cortadas a largura do corpo, no maximo
 * `TETO_DE_LINHAS` (e nunca mais que as linhas que a faixa pode ter), a ultima dizendo quantas ficaram.
 */
export function comporFaixa(linhas: readonly OrkLinhaDaFaixa[] | undefined, largura: number, maxLinhas: number): string[] {
  const todas = [...(linhas ?? [])].filter(l => l.texto !== '').sort((a, b) => (a.mod < b.mod ? -1 : a.mod > b.mod ? 1 : 0))
  const cabem = Math.max(0, Math.min(TETO_DE_LINHAS, Math.floor(maxLinhas)))
  if (todas.length === 0 || cabem === 0) return []
  const mostradas = todas.length <= cabem ? todas : todas.slice(0, cabem - 1)
  const saida = mostradas.map(l => cortar(`${rotulo(l.mod)}: ${l.texto}`, largura))
  if (mostradas.length < todas.length) saida.push(cortar(`+${todas.length - mostradas.length} mods do Orkastery`, largura))
  return saida.filter(l => l !== '')
}

/** A arvore da faixa com os elementos que a superficie resolveu (`$.ui.resolve(e)` no register.ts). */
export function desenharFaixa(el: { Box: any; Text: any }, linhas: readonly string[]) {
  const { Box, Text } = el
  return (
    <Box flexDirection="column">
      {linhas.map((linha, i) => (
        <Text key={`ork-faixa-${i}`} dimColor wrap="truncate">
          {linha}
        </Text>
      ))}
    </Box>
  )
}
