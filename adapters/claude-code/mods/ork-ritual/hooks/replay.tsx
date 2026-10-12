// O painel do Ritual do MASTER (RM-059, fatia F8, T8.2): a lista das entregas que esperam a nota do dono e o replay da
// prova de uma delas, uma claim por vez, como o replay-theater percorre edicoes. Modulo puro: monta as linhas e a
// arvore com os elementos que a superficie resolveu; o `$` fica no register.tsx. Estado sempre com rotulo e glifo,
// nunca so cor; "espera sua nota" e o ponto de HITL do cartao; numero vem com o comando que o prova (Partitura).
import type { RitualEntrega, RitualMostrado, RitualProva, RitualQuadro } from '../types'
import { JANELA_DIAS, numero, plural } from './ritual'

/** Uma linha do painel: o tipo decide o elemento; `mostrado` e o que o registro da ponte guarda (M5). */
export type LinhaDoPainel = {
  tipo: 'placar' | 'aviso' | 'vazio' | 'cabecalho' | 'situacao' | 'indice' | 'postmortem' | 'ver-prova' | 'prova-placar'
    | 'claim' | 'alegacao' | 'comando' | 'navegacao'
  texto: string
  thread?: string
  mostrado?: RitualMostrado
}

/** O glifo e o rotulo de cada estado de claim que o nucleo registra. */
export const ESTADO_DA_CLAIM: Readonly<Record<string, { glifo: string; rotulo: string }>> = {
  verificado: { glifo: '✓', rotulo: 'verificada' },
  reprovado: { glifo: '×', rotulo: 'reprovada' },
  pendente: { glifo: '·', rotulo: 'pendente' },
  'nao-verificavel': { glifo: '?', rotulo: 'não verificável' },
}

/** Quanto tempo faz a leitura, em palavras curtas. */
export function haQuanto(desde: number | null, agora: number): string {
  if (desde === null) return 'ainda não lido'
  const s = Math.max(0, Math.round((agora - desde) / 1000))
  if (s < 60) return `lido há ${s} s`
  const min = Math.round(s / 60)
  return min < 60 ? `lido há ${min} min` : `lido há ${Math.round(min / 60)} h`
}

/** A situacao da nota na entrega, em uma linha. */
export function situacaoDaEntrega(e: RitualEntrega): string {
  if (e.status === 'recorded') return `aceita por omissão${e.score === null ? '' : ` com ${e.score}/5`}; a sua nota sobrescreve`
  if (e.status === 'ratificacao-pendente') return 'proposta da fábrica esperando a sua nota'
  return 'sem nota: sem a sua, o MASTER fecha por omissão'
}

/** O cartao de uma entrega: cabecalho, situacao, indice e POSTMORTEM. */
export function linhasDaEntrega(e: RitualEntrega): LinhaDoPainel[] {
  const quando = e.entregueEmLocal ?? e.entregueEm
  const merge = e.merge ? ` · merge ${e.merge.slice(0, 8)}` : ''
  const indice = e.indice === null ? 'índice derivado do ledger: lacuna (ork master)'
    : `índice derivado do ledger: ${numero(e.indice)} de 5 (${e.parcelas || 'sem desconto'}) · ork master`
  const reprovacoes = plural(e.reprovacoes, 'reprovação tipada', 'reprovações tipadas')
  return [
    { tipo: 'cabecalho', thread: e.thread, texto: `● espera sua nota · ${e.thread} · entregue ${quando}${merge}` },
    { tipo: 'situacao', thread: e.thread, texto: `  ${situacaoDaEntrega(e)}` },
    { tipo: 'indice', thread: e.thread, texto: `  ${indice}`,
      mostrado: { chave: `nota:${e.thread}`, thread: e.thread,
        texto: `${e.thread}: entregue, espera sua nota${e.indice === null ? '' : ` (índice ${numero(e.indice)} de 5)`}` } },
    { tipo: 'postmortem', thread: e.thread, texto: e.classes ? `  POSTMORTEM: classes ${e.classes} · ${reprovacoes}`
      : `  POSTMORTEM: nasce no fechamento · ${reprovacoes}` },
  ]
}

/** As linhas do replay: a claim do passo, com estado, arquivo, alegacao e comandos; nunca a saida do comando (D6). */
export function linhasDaProva(foco: string, prova: RitualProva | null, passo: number): LinhaDoPainel[] {
  if (!prova || prova.thread !== foco || (prova.lidoEm === null && !prova.erro)) return [{ tipo: 'vazio', thread: foco, texto: 'lendo as claims no núcleo...' }]
  const saida: LinhaDoPainel[] = []
  if (prova.erro) saida.push({ tipo: 'aviso', thread: foco, texto: `as claims não vieram: ${prova.erro}` })
  if (!prova.claims.length) {
    if (!prova.erro) saida.push({ tipo: 'vazio', thread: foco, texto: `Nenhuma claim ativa registrada na ${foco}.` })
    return saida
  }
  const i = Math.min(Math.max(0, passo), prova.claims.length - 1)
  const c = prova.claims[i]!
  const estado = ESTADO_DA_CLAIM[c.estado] ?? { glifo: '?', rotulo: c.estado }
  const retiradas = prova.retiradas ? ` · ${plural(prova.retiradas, 'retirada fora', 'retiradas fora')}` : ''
  saida.push({ tipo: 'prova-placar', thread: foco, texto: `  claim ${i + 1} de ${prova.claims.length}${retiradas} · ork claims list ${foco}` })
  saida.push({ tipo: 'claim', thread: foco, texto: `  ${estado.glifo} ${c.id} · ${estado.rotulo}${c.arquivo ? ` · ${c.arquivo}` : ''}` })
  if (c.alegacao) saida.push({ tipo: 'alegacao', thread: foco, texto: `  ${c.alegacao}` })
  for (const comando of c.comandos) saida.push({ tipo: 'comando', thread: foco, texto: `  $ ${comando}` })
  if (!c.comandos.length) saida.push({ tipo: 'comando', thread: foco, texto: '  sem comando registrado' })
  saida.push({ tipo: 'navegacao', thread: foco, texto: `${i > 0 ? 'anterior' : ''}|${i < prova.claims.length - 1 ? 'proxima' : ''}` })
  return saida
}

/**
 * As linhas do painel, na ordem do desenho. Sem foco: o placar, os avisos e um cartao por entrega com "Ver a prova".
 * Com foco (`/nota <thread>` ou "Ver a prova"): o placar do replay, o cartao da thread e a claim do passo.
 */
export function linhasDoPainel(q: RitualQuadro, opcoes: { agora: number; foco?: string | null; prova?: RitualProva | null; passo?: number }): LinhaDoPainel[] {
  const saida: LinhaDoPainel[] = []
  const foco = opcoes.foco ?? null
  saida.push({ tipo: 'placar', texto: foco ? `Ritual do MASTER · prova da ${foco}`
    : `Ritual do MASTER · ${plural(q.entregas.length, 'entrega espera', 'entregas esperam')} a sua nota · ${haQuanto(q.lidoEm, opcoes.agora)}` })
  if (q.erro) saida.push({ tipo: 'aviso', texto: `a última leitura falhou: ${q.erro}` })
  for (const aviso of q.avisos) saida.push({ tipo: 'aviso', texto: aviso })
  if (foco) {
    const e = q.entregas.find(x => x.thread === foco)
    if (e) saida.push(...linhasDaEntrega(e))
    else if (q.lidoEm !== null) saida.push({ tipo: 'aviso', thread: foco, texto: `a ${foco} não está entre as entregas dos últimos ${JANELA_DIAS} dias que esperam a sua nota` })
    saida.push(...linhasDaProva(foco, opcoes.prova ?? null, opcoes.passo ?? 0))
    return saida
  }
  if (q.foraDaJanela) {
    saida.push({ tipo: 'aviso', texto: `${plural(q.foraDaJanela, 'entrega sem a sua nota ficou', 'entregas sem a sua nota ficaram')} fora da janela de ${JANELA_DIAS} dias (ork master)` })
  }
  if (!q.entregas.length) {
    saida.push({ tipo: 'vazio', texto: q.lidoEm === null ? 'lendo as entregas no núcleo...' : `Nada espera a sua nota nos últimos ${JANELA_DIAS} dias.` })
    return saida
  }
  for (const e of q.entregas) {
    saida.push(...linhasDaEntrega(e))
    saida.push({ tipo: 'ver-prova', thread: e.thread, texto: 'Ver a prova' })
  }
  return saida
}

/**
 * As linhas da tela que um texto com `wrap="wrap"` ocupa em `colunas` celulas: quebra por palavra, e a palavra maior que
 * a linha quebra no meio. A `folga` tira colunas da conta: com ela a estimativa sobra.
 */
export function linhasDaTela(texto: string, colunas: number | undefined, folga = 1): number {
  if (typeof colunas !== 'number' || !(colunas > folga)) return 1
  const largura = colunas - folga
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

/** A altura de uma linha do painel na tela, sem e com a folga: so a alegacao quebra; as outras truncam numa so. */
function alturasNaTela(l: { tipo?: string; texto?: string }, colunas: number | undefined): [number, number] {
  if (l.tipo !== 'alegacao') return [1, 1]
  return [linhasDaTela(l.texto ?? '', colunas, 0), linhasDaTela(l.texto ?? '', colunas, 1)]
}

/**
 * O que esta inteiro dentro da janela de rolagem do painel: so isso conta como mostrado ao dono (M5). A linha que quebra
 * tem o topo mais cedo (sem folga) e o mais tarde (com folga): ela so conta com os dois dentro da janela.
 */
export function mostradosVisiveis(linhas: ReadonlyArray<{ tipo?: string; texto?: string; mostrado?: RitualMostrado }>,
  janela: { offset: number; bodyRows: number } | undefined, colunas?: number): RitualMostrado[] {
  if (!janela || !(janela.bodyRows > 0)) return []
  const fim = janela.offset + janela.bodyRows
  const vistos: RitualMostrado[] = []
  let cedo = 0
  let tarde = 0
  for (const l of linhas) {
    const [menor, maior] = alturasNaTela(l, colunas)
    if (l.mostrado && cedo >= janela.offset && tarde + maior <= fim) vistos.push(l.mostrado)
    cedo += menor
    tarde += maior
  }
  return vistos
}

/** Os gestos do painel: reler, abrir e fechar o replay e andar entre as claims. */
export type Gestos = {
  atualizar?: () => void
  verProva?: (thread: string) => void
  voltar?: () => void
  anterior?: () => void
  proxima?: () => void
}

/**
 * A arvore do painel com os elementos que a superficie resolveu (no register.tsx), uma linha da tela por elemento: so
 * `Box`, `Text` e `Button`, no terminal e no desktop.
 */
export function desenharRitual(el: { Box: any; Text: any; Button: any }, linhas: readonly LinhaDoPainel[], opcoes: { foco?: string | null } & Gestos) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {linhas.map((l, i) => {
        if (l.tipo === 'placar') {
          return (
            <Box key="placar" flexDirection="row">
              <Text key="placar-texto" bold wrap="truncate">{l.texto}</Text>
              {opcoes.foco ? <Button key="voltar" label="Voltar" onPress={() => opcoes.voltar?.()} /> : null}
              <Button key="atualizar" label="Atualizar" onPress={() => opcoes.atualizar?.()} />
            </Box>
          )
        }
        if (l.tipo === 'cabecalho') return <Text key={`cabecalho:${l.thread}`} bold wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'ver-prova' && l.thread) {
          const thread = l.thread
          return <Button key={`prova:${thread}`} label={l.texto} onPress={() => opcoes.verProva?.(thread)} />
        }
        if (l.tipo === 'navegacao') {
          const [anterior, proxima] = l.texto.split('|')
          return (
            <Box key="navegacao" flexDirection="row">
              {anterior ? <Button key="anterior" label="Anterior" onPress={() => opcoes.anterior?.()} /> : null}
              {proxima ? <Button key="proxima" label="Próxima" onPress={() => opcoes.proxima?.()} /> : null}
            </Box>
          )
        }
        if (l.tipo === 'claim') return <Text key="claim" bold wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'alegacao') return <Text key="alegacao" wrap="wrap">{l.texto}</Text>
        if (l.tipo === 'aviso') return <Text key={`aviso:${i}`} color="warning" wrap="truncate">{l.texto}</Text>
        return <Text key={`${l.tipo}:${l.thread ?? ''}:${i}`} dimColor={l.tipo !== 'comando'} wrap="truncate">{l.texto}</Text>
      })}
    </Box>
  )
}
