// O painel do Mensageiro de Sessoes (RM-059, fatia F9), em funcoes puras: o estado vira linhas da tela, uma por
// elemento, e as linhas viram a arvore do painel com os elementos que a superficie resolveu (so `Box`, `Text` e
// `Button`, os mesmos no terminal e no desktop). Todo estado tem rotulo e glifo, nunca so cor (regra da Partitura).
// O texto da resposta do dono nunca aparece aqui: so a thread, o pedido e o estado da entrega. So importa tipos e
// modulos puros do Mensageiro.
import type { MensageiroDono, MensageiroEntrega, MensageiroEstadoDaEntrega, MensageiroMostrado } from '../types'
import { umaLinha } from './caixa'

export type LinhaDoMensageiro = {
  tipo: 'titulo' | 'secao' | 'texto' | 'dim' | 'falha' | 'feito'
  chave: string
  texto: string
  /** O que vai ao registro do mostrado da ponte quando a linha esta na janela de rolagem do painel a vista. */
  mostrado?: MensageiroMostrado
}

export const ROTULO_DO_ESTADO: Record<MensageiroEstadoDaEntrega, string> = {
  'na-fila': 'na fila do núcleo',
  'a-caminho': 'a caminho: na fila da sessão, esperando a conferência',
  'reservada': 'recebida pela sessão, confirmando',
  'nao-chegou': 'não entrou na fila da sessão; nova tentativa em breve',
  'desistiu': 'não chegou: responda pelo claude attach',
  'entregue': 'entregue, com o recibo da sessão',
  'saiu-da-caixa': 'saiu da caixa sem recibo: responda pelo claude attach',
}

const GLIFO: Record<MensageiroEstadoDaEntrega, string> = {
  'na-fila': '·', 'a-caminho': '●', 'reservada': '●', 'nao-chegou': '×', 'desistiu': '×', 'entregue': '✓', 'saiu-da-caixa': '?',
}

const TIPO: Record<MensageiroEstadoDaEntrega, LinhaDoMensageiro['tipo']> = {
  'na-fila': 'texto', 'a-caminho': 'texto', 'reservada': 'texto', 'nao-chegou': 'falha', 'desistiu': 'falha', 'entregue': 'feito', 'saiu-da-caixa': 'falha',
}

/** Quanto tempo faz, como o dono le. */
export function idade(ms: number): string {
  if (!(ms >= 60000)) return 'agora'
  const min = Math.floor(ms / 60000)
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`
}

const curto = (id: string) => id.slice(0, 8)

function linhasDaEntrega(e: MensageiroEntrega, agora: number): LinhaDoMensageiro[] {
  const k = (s: string) => `${e.envioId}:${s}`
  const envios = e.tentativas > 1 ? ` · ${e.tentativas} envios` : ''
  const texto = `${GLIFO[e.estado]} ${e.thread} · pedido ${curto(e.pedidoId)} · ${ROTULO_DO_ESTADO[e.estado]}${envios} · ${idade(agora - e.em)}`
  const linhas: LinhaDoMensageiro[] = [{ tipo: TIPO[e.estado], chave: k('estado'), texto: umaLinha(texto, 300),
    mostrado: { chave: `hitl:${e.pedidoId}`, thread: e.thread, texto: `${e.thread}: resposta do dono ${ROTULO_DO_ESTADO[e.estado]}` } }]
  if (e.motivo) linhas.push({ tipo: 'dim', chave: k('motivo'), texto: `  ${umaLinha(e.motivo, 200)}` })
  return linhas
}

/** As linhas do painel na sessao do dono. */
export function linhasDoDono(dono: MensageiroDono, agora: number): LinhaDoMensageiro[] {
  const linhas: LinhaDoMensageiro[] = [
    { tipo: 'titulo', chave: 'titulo', texto: 'Mensageiro de Sessões' },
    { tipo: 'dim', chave: 'o-que-faz', texto: 'Leva a resposta que você deu pelo diálogo à sessão de fase que parou esperando por ela.' },
  ]
  if (dono.erro) linhas.push({ tipo: 'falha', chave: 'erro', texto: `× ${umaLinha(dono.erro, 200)}` })
  linhas.push({ tipo: 'secao', chave: 'secao-entregas', texto: 'Respostas desta sessão' })
  if (!dono.entregas.length) linhas.push({ tipo: 'dim', chave: 'sem-entregas', texto: '  nenhuma resposta a caminho agora' })
  for (const e of [...dono.entregas].reverse()) linhas.push(...linhasDaEntrega(e, agora))
  if (dono.incertas.length) {
    linhas.push({ tipo: 'secao', chave: 'secao-incertas', texto: 'Noutra sessão do dono' })
    for (const i of dono.incertas) {
      linhas.push({ tipo: 'texto', chave: `incerta:${i.pedidoId}`, texto: `· ${i.thread} · pedido ${curto(i.pedidoId)} · a entrega segue noutra sessão do dono` })
    }
  }
  linhas.push({ tipo: 'dim', chave: 'limite', texto: 'A resposta chega como mensagem de outra sessão: informa a sessão de fase, não autoriza ação que só você aprova. Para isso, claude attach.' })
  if (dono.lidoEm === null) linhas.push({ tipo: 'dim', chave: 'lido', texto: 'a caixa de saída ainda não foi lida' })
  else linhas.push({ tipo: 'dim', chave: 'lido', texto: `caixa de saída lida ${idade(agora - dono.lidoEm)}` })
  return linhas
}

/**
 * O que esta inteiro dentro da janela de rolagem do painel: so isso conta como mostrado ao dono (M5). Toda linha do
 * painel trunca numa linha da tela, e a do titulo divide a linha com o botao.
 */
export function mostradosVisiveis(linhas: readonly LinhaDoMensageiro[], janela: { offset: number; bodyRows: number } | undefined): MensageiroMostrado[] {
  if (!janela || !(janela.bodyRows > 0)) return []
  const fim = janela.offset + janela.bodyRows
  return linhas.flatMap((l, i) => (l.mostrado && i >= janela.offset && i < fim ? [l.mostrado] : []))
}

export type Gestos = { atualizar?: () => void }

/** A arvore do painel com os elementos que a superficie resolveu. */
export function desenharPainel(el: { Box: any; Text: any; Button: any }, linhas: readonly LinhaDoMensageiro[], gestos: Gestos) {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column">
      {linhas.map(l => {
        if (l.tipo === 'titulo') {
          return (
            <Box key="titulo" flexDirection="row">
              <Text key="titulo-texto" bold wrap="truncate">{l.texto}</Text>
              <Button key="atualizar" label="Atualizar" onPress={() => gestos.atualizar?.()} />
            </Box>
          )
        }
        if (l.tipo === 'secao') return <Text key={l.chave} bold wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'falha') return <Text key={l.chave} color="error" wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'feito') return <Text key={l.chave} color="success" wrap="truncate">{l.texto}</Text>
        if (l.tipo === 'dim') return <Text key={l.chave} dimColor wrap="truncate">{l.texto}</Text>
        return <Text key={l.chave} wrap="truncate">{l.texto}</Text>
      })}
    </Box>
  )
}
