// O painel do Mensageiro de Sessoes (RM-059, fatia F9), em funcoes puras: o estado vira linhas da tela, uma por
// elemento, e as linhas viram a arvore do painel com os elementos que a superficie resolveu (so `Box`, `Text` e
// `Button`, os mesmos no terminal e no desktop). Todo estado tem rotulo e glifo, nunca so cor (regra da Partitura).
// O texto da resposta do dono nunca aparece aqui: so a thread, o pedido e o estado da entrega. So importa tipos e
// modulos puros do Mensageiro.
import type { MensageiroDono, MensageiroEntrega, MensageiroEstadoDaEntrega, MensageiroEstadoDaRecebida, MensageiroFase, MensageiroMostrado,
  MensageiroRecebida } from '../types'
import { umaLinha } from './caixa'
import { codigoDoMotivo, motivoLegivel } from './recepcao'

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
  'sem-recibo': 'recebida pela sessão, sem recibo em 5 min: confira pelo claude attach',
  'nao-chegou': 'não entrou na fila da sessão; nova tentativa em breve',
  'desistiu': 'não chegou: responda pelo claude attach',
  'entregue': 'entregue, com o recibo da sessão',
  'saiu-da-caixa': 'saiu da caixa sem recibo: responda pelo claude attach',
}

const GLIFO: Record<MensageiroEstadoDaEntrega, string> = {
  'na-fila': '·', 'a-caminho': '●', 'reservada': '●', 'sem-recibo': '?', 'nao-chegou': '×', 'desistiu': '×', 'entregue': '✓', 'saiu-da-caixa': '?',
}

const TIPO: Record<MensageiroEstadoDaEntrega, LinhaDoMensageiro['tipo']> = {
  'na-fila': 'texto', 'a-caminho': 'texto', 'reservada': 'texto', 'sem-recibo': 'falha', 'nao-chegou': 'falha', 'desistiu': 'falha', 'entregue': 'feito', 'saiu-da-caixa': 'falha',
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
    // O retrato so diz que a entrega esta incerta (sem o runtime): ela pode seguir noutra sessao do dono ou noutro canal
    // (um envio nativo pendente), ou ter se perdido com uma sessao que fechou. O painel nao sabe qual, e diz isso.
    linhas.push({ tipo: 'secao', chave: 'secao-incertas', texto: 'Fora desta sessão' })
    for (const i of dono.incertas) {
      linhas.push({ tipo: 'texto', chave: `incerta:${i.pedidoId}`,
        texto: `· ${i.thread} · pedido ${curto(i.pedidoId)} · entrega incerta fora desta sessão: noutra sessão do dono, noutro canal ou perdida` })
    }
    linhas.push({ tipo: 'dim', chave: 'incertas-limite', texto: '  sem retorno, responda pelo claude attach' })
  }
  linhas.push({ tipo: 'dim', chave: 'limite', texto: 'A resposta chega como mensagem de outra sessão: informa a sessão de fase, não autoriza ação que só você aprova. Para isso, claude attach.' })
  if (dono.lidoEm === null) linhas.push({ tipo: 'dim', chave: 'lido', texto: 'a caixa de saída ainda não foi lida' })
  else linhas.push({ tipo: 'dim', chave: 'lido', texto: `caixa de saída lida ${idade(agora - dono.lidoEm)}` })
  return linhas
}

export const ROTULO_DA_RECEBIDA: Record<MensageiroEstadoDaRecebida, string> = {
  'consumida': 'consumida antes do modelo',
  'confirmando': 'entrou na conversa; gravando o recibo no núcleo',
  'entregue': 'entrou na conversa, com o recibo no núcleo',
  'sem-recibo': 'entrou na conversa, mas o recibo não foi gravado',
  'nao-entrou': 'conferida, mas não entrou na conversa',
}

const GLIFO_DA_RECEBIDA: Record<MensageiroEstadoDaRecebida, string> = {
  'consumida': '○', 'confirmando': '●', 'entregue': '✓', 'sem-recibo': '?', 'nao-entrou': '×',
}

const TIPO_DA_RECEBIDA: Record<MensageiroEstadoDaRecebida, LinhaDoMensageiro['tipo']> = {
  'consumida': 'texto', 'confirmando': 'texto', 'entregue': 'feito', 'sem-recibo': 'falha', 'nao-entrou': 'falha',
}

function linhasDaRecebida(r: MensageiroRecebida, i: number, agora: number): LinhaDoMensageiro[] {
  const k = (s: string) => `recebida:${i}:${s}`
  const quem = r.estado === 'consumida'
    ? `mensagem de outra sessão (${umaLinha(r.origem, 80)})${r.pedidoId ? ` com a marca do pedido ${curto(r.pedidoId)}` : ''}`
    : `resposta do dono ao pedido ${r.pedidoId ? curto(r.pedidoId) : '?'}`
  const linhas: LinhaDoMensageiro[] = [{ tipo: TIPO_DA_RECEBIDA[r.estado], chave: k('estado'),
    texto: umaLinha(`${GLIFO_DA_RECEBIDA[r.estado]} ${quem} · ${ROTULO_DA_RECEBIDA[r.estado]} · ${idade(agora - r.em)}`, 300) }]
  if (r.motivo) {
    const motivo = r.estado === 'consumida' ? `${motivoLegivel(r.motivo)} · ${codigoDoMotivo(r.motivo)}` : r.motivo
    linhas.push({ tipo: 'dim', chave: k('motivo'), texto: `  ${umaLinha(motivo, 200)}` })
  }
  return linhas
}

/**
 * As linhas do painel na sessao de fase: o que chegou de outras sessoes, o mais novo primeiro. Sem botao: o estado so
 * muda quando algo chega, e o painel se redesenha sozinho. O texto de nenhuma mensagem aparece aqui.
 */
export function linhasDaFase(fase: MensageiroFase, agora: number): LinhaDoMensageiro[] {
  const linhas: LinhaDoMensageiro[] = [
    { tipo: 'secao', chave: 'titulo', texto: 'Mensageiro de Sessões' },
    { tipo: 'dim', chave: 'o-que-faz', texto: `Nesta sessão de fase${fase.thread ? ` da ${fase.thread}` : ''}, só entra na conversa a resposta do dono que o núcleo conferiu; o resto que chega de outra sessão é consumido.` },
  ]
  if (fase.erro) linhas.push({ tipo: 'falha', chave: 'erro', texto: `× ${umaLinha(fase.erro, 200)}` })
  linhas.push({ tipo: 'secao', chave: 'secao-recebidas', texto: 'O que chegou de outras sessões' })
  if (!fase.recebidas.length) linhas.push({ tipo: 'dim', chave: 'sem-recebidas', texto: '  nada chegou de outra sessão' })
  const recebidas = fase.recebidas.map((r, i) => ({ r, i })).reverse()
  for (const { r, i } of recebidas) linhas.push(...linhasDaRecebida(r, i, agora))
  linhas.push({ tipo: 'dim', chave: 'limite', texto: 'A resposta do dono informa esta sessão; ação que só o dono aprova continua pedindo o dono.' })
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
