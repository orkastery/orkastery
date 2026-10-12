// Contrato do estado da Torre de Controle (`ork-torre`, RM-059, fatia F1). O motor exige que cada chave de
// `$.state` do mod esteja declarada aqui, em `PluginState`. A Torre nao acrescenta noun ao `$`: le o nucleo
// pelo `$.ork` da `ork-ponte`, que o plugin.json lista em `dependencies`. Sem import nem referencia.

/** As seis fases do ciclo, na ordem do trilho. */
export type TorreFase = 'GOAL' | 'PLAN' | 'GO' | 'CHECK' | 'SHIP' | 'MASTER'

/** O estado da linha (D6 da thread): o que pede acao vem primeiro. */
export type TorreEstado = 'espera-voce' | 'parada' | 'andando' | 'quieta' | 'sem-leitura'

/** Uma acao que o retrato do nucleo declara disponivel para a thread (`available: true`). */
export type TorreAcao = { operacao: string }

/** Um pedido HITL aberto da thread, como o retrato o mostra. */
export type TorrePedido = { id: string; texto: string; prazo: string; recomendacao: string }

/** Uma sessao da thread: o rotulo (`runtime · fase`), o estado nativo e se e ela quem conduz. */
export type TorreSessao = { id: string; rotulo: string; estado: string; conduz: boolean; confirmada: boolean }

/** Uma thread aberta desta maquina, como o retrato dela (`ork.maestro-snapshot/v1`) a mostra. */
export type TorreLinha = {
  thread: string
  fase: string | null
  modo: string | null
  /** O texto de quem conduz e desde quando, como o nucleo o escreve. */
  conducao: string | null
  bloqueio: { motivo: string; frase: string } | null
  pedidos: TorrePedido[]
  sessoes: TorreSessao[]
  /** O estado da entrega (`delivered`, `incomplete`) e do MASTER (`pending`, `recorded`), quando ha. */
  entrega: string | null
  master: string | null
  acoes: TorreAcao[]
  estado: TorreEstado
  /** De onde veio o retrato (MCP, CLI ou cache da ponte), e quando a ponte o leu. */
  fonte: 'mcp' | 'cli' | 'cache' | null
  lidoEm: number | null
  /** Secoes do retrato que nao vieram inteiras, ou o motivo de a leitura ter falhado. */
  lacunas: string[]
}

/** O que o painel mostrou ao dono e o Telegram tambem avisaria: a chave junta o que e a mesma coisa (D10). */
export type TorreMostrado = { chave: string; thread: string; texto: string }

/** O quadro da fabrica: uma linha por thread aberta, na ordem do estado. */
export type TorreQuadro = {
  linhas: TorreLinha[]
  /** Quantas threads abertas ficaram de fora pelo teto da Torre. */
  omitidas: number
  /** Quando a lista das abertas foi lida (ms desde a epoca); null antes da primeira leitura. */
  lidoEm: number | null
  /** Por que a lista das abertas nao foi lida, quando nao foi. */
  erro: string | null
}

/** O resultado de uma leitura do detalhe: as linhas a mostrar, ou o motivo de nao ter lido. */
export type TorreLeitura = { lidoEm: number; linhas: string[]; erro: string | null }

/** O que o detalhe de uma thread leu: os ultimos eventos, as claims e cada acao de leitura pedida. */
export type TorreDetalhe = {
  eventos: TorreLeitura | null
  claims: TorreLeitura | null
  /** Por operacao de leitura do retrato (`thread.status`, `thread.observe`, `git.status`). */
  leituras: Record<string, TorreLeitura>
}

/** Uma thread ativa de outra maquina, como o panorama da rede (`ork.network-roadmap/v1`) a mostra. */
export type TorreLinhaDaRede = {
  thread: string
  maquina: string
  fase: string
  /** A #TAG do modo, como o retrato da maquina a escreve. */
  modo: string
  esperaVoce: boolean
  pergunta: string | null
  /** Minutos desde a batida da maquina, na hora em que a rede foi lida; null quando a batida e ilegivel. */
  idadeMin: number | null
  semBatida: boolean
}

/** A ultima leitura da rede: as threads das outras maquinas, quantas maquinas e lacunas, e o erro da ultima tentativa. */
export type TorreRede = {
  /** Quando a rede foi lida com sucesso pela ultima vez; null se nunca foi. */
  lidoEm: number | null
  linhas: TorreLinhaDaRede[]
  maquinas: number
  lacunas: number
  erro: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'ork-torre': {
      /** O quadro que o painel desenha. */
      quadro: TorreQuadro
      /** A ultima leitura da rede, ou null antes da primeira. */
      rede: TorreRede | null
      /** A thread com o detalhe aberto no painel, ou null para a lista. */
      aberta: string | null
      /** O que o detalhe leu, por thread. */
      detalhes: Record<string, TorreDetalhe>
      /** Os comandos dos mods donos das acoes carregados nesta sessao, com o plugin que registrou cada um. */
      donos: Record<string, string>
      /** O dono fechou o painel nesta sessao: ele nao abre mais sozinho, nem depois de uma recarga do modulo. */
      fechado: boolean
    }
  }
}
