// Os cartoes da Mesa do Dono (RM-059 F5; D4 da thread ork-rm059mesa), em funcoes puras: a fila vira linhas da tela,
// uma por elemento, e as linhas viram a arvore do painel com os elementos que a superficie resolveu. Cada pergunta
// traz a recomendada primeiro, com o porque, depois as outras alternativas com a consequencia; a decisao que a
// fabrica (ou a Mesa) tomou pelo dono traz o que, o porque, como mudar e o custo de reverter. O unico botao com
// efeito e o Decidir, que so pede ao nucleo o dialogo nativo do pedido. So importa tipos e modulos puros da Mesa.
import type { MesaDecidindo, MesaDecisao, MesaFila, MesaObvia, MesaOutro, MesaPergunta } from '../types'
import { duracao, esperamODono, MAXIMO_DE_DECISOES, MAXIMO_DE_OUTROS, TAMANHO_DO_LOTE } from './fila'
import { FALHA_DA_CONDICAO, testeDaObvia } from './obvia'

export type MesaMostrado = { chave: string; thread: string | null; texto: string }

export type LinhaDaMesa = {
  tipo: 'titulo' | 'aviso' | 'foco' | 'secao' | 'cabecalho' | 'texto' | 'dim' | 'decidir' | 'nav'
  chave: string
  texto: string
  /** O pedido do botao Decidir. */
  pedidoId?: string
  /** O que vai ao registro do mostrado da ponte quando a linha esta na janela de rolagem do painel a vista. */
  mostrado?: MesaMostrado
}

export type EstadoDaMesa = {
  fila: MesaFila
  foco: string | null
  pagina: number
  decidindo: Readonly<Record<string, MesaDecidindo>>
  obvias: Readonly<Record<string, MesaObvia>>
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/** O prazo como o dono le: o horario local que o nucleo mandou, ou quanto falta. */
function textoDoPrazo(p: MesaPergunta, agora: number): string | null {
  if (p.prazoLocal) return `prazo ${p.prazoLocal}`
  const t = Date.parse(p.prazo ?? '')
  if (!Number.isFinite(t)) return null
  return t > agora ? `vence em ${duracao(t - agora)}` : `venceu há ${duracao(agora - t)}`
}

/** As paginas do lote de perguntas, e a pagina pedida dentro delas. */
export function paginaDoLote(total: number, pagina: number): { pagina: number; paginas: number } {
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_DO_LOTE))
  return { pagina: Math.min(Math.max(0, Math.floor(pagina) || 0), paginas - 1), paginas }
}

/** O cartao de uma pergunta. */
export function linhasDaPergunta(p: MesaPergunta, e: EstadoDaMesa, agora: number): LinhaDaMesa[] {
  const k = (s: string) => `${p.pedidoId}:${s}`
  const obvia = e.obvias[p.pedidoId]
  const decidida = obvia?.estado === 'registrada'
  const decidindo = e.decidindo[p.pedidoId]
  const cabecalho = [p.thread, p.fase, p.codigo ? `código ${p.codigo}` : null, textoDoPrazo(p, agora)].filter(Boolean).join(' · ')
  const linhas: LinhaDaMesa[] = [{
    tipo: 'cabecalho', chave: k('cabecalho'), texto: `${decidida ? '✓' : '?'} ${cabecalho}`,
    mostrado: { chave: `hitl:${p.pedidoId}`, thread: p.thread, texto: `${p.thread}: espera você: ${p.pergunta}` },
  }]
  linhas.push({ tipo: 'texto', chave: k('pergunta'), texto: `  ${p.pergunta}` })
  if (decidida) {
    linhas.push({ tipo: 'texto', chave: k('obvia'), texto: `  decidido sem te chamar: segue a recomendada no prazo; ${comoMudarDaObvia(p, agora)}` })
  } else if (obvia?.estado === 'incerta') {
    linhas.push({ tipo: 'dim', chave: k('obvia'), texto: '  a Mesa pediu ao núcleo a decisão óbvia e confere na próxima leitura se ela foi gravada' })
  } else if (obvia?.estado === 'recusada') {
    linhas.push({ tipo: 'aviso', chave: k('obvia'), texto: `  a Mesa não decidiu: ${obvia.texto}` })
  } else {
    // Sem criterio escrito e o caso de todo gate que espera o dono: dizer isso em cada cartao so repetiria a regra.
    const teste = testeDaObvia(p, agora)
    const motivo = teste.obvia ? undefined : teste.falhou[0]
    if (motivo && motivo !== 'criterio') linhas.push({ tipo: 'dim', chave: k('porque-pergunta'), texto: `  pergunta: ${FALHA_DA_CONDICAO[motivo]}` })
  }
  const recomendada = p.alternativas.find(a => a.recomendada)
  if (recomendada) {
    linhas.push({ tipo: 'texto', chave: k('recomendada'), texto: `  Recomendada: ${recomendada.chave}) ${recomendada.texto}` })
    if (recomendada.porque) linhas.push({ tipo: 'dim', chave: k('porque'), texto: `    porque: ${recomendada.porque}` })
    if (recomendada.consequencia) linhas.push({ tipo: 'dim', chave: k('consequencia'), texto: `    se escolher: ${recomendada.consequencia}` })
  } else if (p.recomendacao) {
    linhas.push({ tipo: 'texto', chave: k('recomendada'), texto: `  Recomendação: ${p.recomendacao}` })
  }
  for (const a of p.alternativas) {
    if (a.recomendada) continue
    linhas.push({ tipo: 'dim', chave: k(`alt:${a.chave}`), texto: `  ${a.chave}) ${a.texto}${a.consequencia ? `: ${a.consequencia}` : ''}` })
  }
  if (p.irreversivel) linhas.push({ tipo: 'aviso', chave: k('sem-volta'), texto: `  sem volta: ${p.ato ?? 'ato irreversível'}` })
  if (decidindo?.estado === 'abrindo') {
    linhas.push({ tipo: 'texto', chave: k('decidindo'), texto: '  diálogo pedido: responda na janela do Claude Code' })
  } else {
    if (decidindo) linhas.push({ tipo: decidindo.estado === 'erro' ? 'aviso' : 'dim', chave: k('decidindo'), texto: `  ${decidindo.texto}` })
    if (p.canalClaudeCode === 'disponivel') linhas.push({ tipo: 'decidir', chave: `decidir:${p.pedidoId}`, texto: 'Decidir', pedidoId: p.pedidoId })
  }
  if (p.reserva) {
    const telegram = p.contrato === 'ork.hitl/v2' && p.alvo === 'gate' && p.codigo !== null
    linhas.push({ tipo: 'dim', chave: k('reserva'), texto: telegram ? `  reserva: ${p.reserva} pelo Telegram` : `  reserva: ${p.reserva}` })
  }
  return linhas
}

/** Como o dono muda a decisao obvia que a Mesa registrou: o Decidir ou a reserva antes do prazo; depois dele, nada. */
function comoMudarDaObvia(p: MesaPergunta, agora: number): string {
  const prazo = Date.parse(p.prazo ?? '')
  if (Number.isFinite(prazo) && prazo <= agora) return 'o prazo passou e a recomendada seguiu'
  return p.canalClaudeCode === 'disponivel' ? 'para mudar, Decidir antes do prazo' : 'para mudar, use a reserva antes do prazo'
}

/** O cartao de uma decisao que a fabrica (ou a Mesa) tomou sem chamar o dono. */
export function linhasDaDecisao(d: MesaDecisao, agora: number): LinhaDaMesa[] {
  const k = (s: string) => `${d.id}:${s}`
  const em = Date.parse(d.em)
  const quando = Number.isFinite(em) ? ` · há ${duracao(agora - em)}` : ''
  const marca = d.revertidaPor ? ' · revertida' : d.nova ? ' · nova' : ''
  return [
    { tipo: 'cabecalho', chave: k('cabecalho'), texto: `${d.revertidaPor ? '↺' : '✓'} ${d.thread} · ${d.fase}${quando}${marca}`,
      mostrado: { chave: `decisao:${d.id}`, thread: d.thread || null, texto: `${d.thread}: decidido sem te chamar: ${d.decidido}` } },
    { tipo: 'texto', chave: k('decidido'), texto: `  ${d.decidido}` },
    ...(d.revertidaPor ? [{ tipo: 'aviso' as const, chave: k('revertida'), texto: `  desfeita pela decisão ${d.revertidaPor.slice(0, 8)}` }] : []),
    ...(d.reverte ? [{ tipo: 'dim' as const, chave: k('reverte'), texto: `  desfaz a decisão ${d.reverte.slice(0, 8)}` }] : []),
    { tipo: 'dim', chave: k('porque'), texto: `  porque: ${d.porque}` },
    { tipo: 'dim', chave: k('como-mudar'), texto: `  como mudar: ${d.comoMudar}` },
    { tipo: 'dim', chave: k('custo'), texto: `  reverter: agora, ${d.custoAgora}; depois, ${d.custoDepois}` },
    { tipo: 'dim', chave: k('quem'), texto: `  quem decidiu: ${d.quemDecidiu}` },
  ]
}

/** O cartao de uma parada sem pedido ou de um impedimento: so leitura, com a recomendacao e o comando. */
export function linhasDoOutro(o: MesaOutro, agora: number): LinhaDaMesa[] {
  const k = (s: string) => `${o.chave}:${s}`
  const desde = Date.parse(o.desdeEm ?? '')
  const partes = [o.thread ?? 'sem thread', o.fase, o.motivo, Number.isFinite(desde) ? `há ${duracao(agora - desde)}` : null,
    o.impedimento ? 'só você resolve' : null].filter(Boolean)
  const linhas: LinhaDaMesa[] = [{
    tipo: 'cabecalho', chave: k('cabecalho'), texto: `! ${partes.join(' · ')}`,
    mostrado: { chave: `parada:${o.chave}`, thread: o.thread, texto: `${o.thread ?? 'sem thread'}: ${o.motivo}: ${o.texto}` },
  }]
  if (o.texto) linhas.push({ tipo: 'texto', chave: k('texto'), texto: `  ${o.texto}` })
  if (o.recomendacao) linhas.push({ tipo: 'dim', chave: k('recomendacao'), texto: `  recomendação: ${o.recomendacao}` })
  if (o.comando && o.comando !== o.recomendacao) linhas.push({ tipo: 'dim', chave: k('comando'), texto: `  comando: ${o.comando}` })
  return linhas
}

/** As linhas do painel: o placar, o foco, as perguntas do lote, as decisoes por voce e as paradas. */
export function linhasDaMesa(e: EstadoDaMesa, opcoes: { agora: number }): LinhaDaMesa[] {
  const { fila, foco } = e
  const agora = opcoes.agora
  const daThread = <T extends { thread: string | null }>(xs: readonly T[]): T[] => (foco ? xs.filter(x => x.thread === foco) : [...xs])
  const perguntas = daThread(fila.perguntas)
  const decisoes = daThread(fila.decisoes)
  const outros = daThread(fila.outros)
  const esperam = esperamODono({ ...fila, perguntas }, e.obvias)
  const desde = esperam.map(p => Date.parse(p.desdeEm ?? '')).filter(Number.isFinite)
  const novas = decisoes.filter(d => d.nova).length
  const placar = [
    `${plural(esperam.length, 'espera', 'esperam')} você${desde.length ? ` (a mais antiga há ${duracao(agora - Math.min(...desde))})` : ''}`,
    `${plural(decisoes.length, 'decidida', 'decididas')} sem te chamar${novas ? ` (${plural(novas, 'nova', 'novas')})` : ''}`,
    plural(outros.length, 'parada', 'paradas'),
    fila.lidoEm === null ? 'ainda não li a fila' : `lido há ${duracao(agora - fila.lidoEm)}`,
  ]
  const linhas: LinhaDaMesa[] = [{ tipo: 'titulo', chave: 'titulo', texto: placar.join(' · ') }]
  if (fila.erro) linhas.push({ tipo: 'aviso', chave: 'erro', texto: `não reli a fila: ${fila.erro}` })
  fila.avisos.forEach((a, i) => linhas.push({ tipo: 'aviso', chave: `aviso:${i}`, texto: a }))
  if (foco) linhas.push({ tipo: 'foco', chave: 'foco', texto: `só ${foco}` })

  linhas.push({ tipo: 'secao', chave: 'secao-perguntas', texto: 'Esperam você' })
  if (!perguntas.length) linhas.push({ tipo: 'dim', chave: 'sem-perguntas', texto: '  nenhum pedido espera você agora' })
  const { pagina, paginas } = paginaDoLote(perguntas.length, e.pagina)
  for (const p of perguntas.slice(pagina * TAMANHO_DO_LOTE, (pagina + 1) * TAMANHO_DO_LOTE)) linhas.push(...linhasDaPergunta(p, e, agora))
  if (paginas > 1) linhas.push({ tipo: 'nav', chave: 'nav', texto: `lote ${pagina + 1} de ${paginas}` })

  linhas.push({ tipo: 'secao', chave: 'secao-decisoes', texto: 'Decididas sem te chamar' })
  if (!decisoes.length) linhas.push({ tipo: 'dim', chave: 'sem-decisoes', texto: '  nenhuma decisão tomada sem te chamar na janela do pulse' })
  for (const d of decisoes.slice(0, MAXIMO_DE_DECISOES)) linhas.push(...linhasDaDecisao(d, agora))
  if (decisoes.length > MAXIMO_DE_DECISOES) {
    linhas.push({ tipo: 'dim', chave: 'mais-decisoes', texto: `  e mais ${decisoes.length - MAXIMO_DE_DECISOES} na janela do pulse (7 dias)` })
  }

  if (outros.length) {
    linhas.push({ tipo: 'secao', chave: 'secao-outros', texto: 'Paradas e impedimentos' })
    for (const o of outros.slice(0, MAXIMO_DE_OUTROS)) linhas.push(...linhasDoOutro(o, agora))
    if (outros.length > MAXIMO_DE_OUTROS) linhas.push({ tipo: 'dim', chave: 'mais-outros', texto: `  e mais ${outros.length - MAXIMO_DE_OUTROS}` })
  }
  return linhas
}

/**
 * O que o desenho poe na janela de rolagem e vai ao registro do mostrado: so linha com `mostrado` cuja posicao esta
 * entre `offset` e `offset + bodyRows`. Sem janela, nada: o que nao estava na tela nao conta como visto.
 */
export function mostradosVisiveis(linhas: readonly LinhaDaMesa[], janela: { offset: number; bodyRows: number } | undefined): MesaMostrado[] {
  if (!janela || !(janela.bodyRows > 0)) return []
  const fim = janela.offset + janela.bodyRows
  return linhas.flatMap((l, i) => (l.mostrado && i >= janela.offset && i < fim ? [l.mostrado] : []))
}

export type AcoesDaMesa = {
  decidir?: (pedidoId: string) => void
  atualizar?: () => void
  verTodas?: () => void
  anteriores?: () => void
  proximas?: () => void
}

/** A arvore do painel com os elementos que a superficie resolveu (`$.ui.resolve(e)` no register.tsx). */
export function desenharMesa(el: { Box: any; Text: any; Button: any }, linhas: readonly LinhaDaMesa[], acoes: AcoesDaMesa) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {linhas.map(l => {
        if (l.tipo === 'titulo') {
          return (
            <Box key="titulo" flexDirection="row">
              <Text key="placar" bold wrap="truncate">{l.texto}</Text>
              <Button key="atualizar" label="Atualizar" onPress={() => acoes.atualizar?.()} />
            </Box>
          )
        }
        if (l.tipo === 'foco') {
          return (
            <Box key="foco" flexDirection="row">
              <Text key="foco-texto" dimColor wrap="truncate">{l.texto}</Text>
              <Button key="ver-todas" label="Ver todas" onPress={() => acoes.verTodas?.()} />
            </Box>
          )
        }
        if (l.tipo === 'nav') {
          return (
            <Box key="nav" flexDirection="row">
              <Button key="anteriores" label="Anteriores" onPress={() => acoes.anteriores?.()} />
              <Text key="nav-texto" dimColor wrap="truncate">{l.texto}</Text>
              <Button key="proximas" label="Próximas" onPress={() => acoes.proximas?.()} />
            </Box>
          )
        }
        if (l.tipo === 'decidir') {
          const pedidoId = l.pedidoId ?? ''
          return <Button key={l.chave} label="Decidir" onPress={() => acoes.decidir?.(pedidoId)} />
        }
        if (l.tipo === 'secao' || l.tipo === 'cabecalho') return <Text key={l.chave} bold wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'aviso') return <Text key={l.chave} color="warning" wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'dim') return <Text key={l.chave} dimColor wrap="truncate">{l.texto}</Text>
        return <Text key={l.chave} wrap="truncate">{l.texto}</Text>
      })}
    </Box>
  )
}
