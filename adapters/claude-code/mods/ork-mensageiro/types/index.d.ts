// Contrato do estado do Mensageiro de Sessoes (`ork-mensageiro`, RM-059, fatia F9). O motor exige que cada chave de
// `$.state` do mod esteja declarada aqui, em `PluginState`. O Mensageiro nao acrescenta noun ao `$`: le o nucleo pelo
// `$.ork` da `ork-ponte`, que o plugin.json lista em `dependencies`, e pelas duas ferramentas MCP da entrega. Nenhum
// campo guarda o texto da resposta do dono (D12 da thread ork-rm059mensag): so ids, estado, motivo e instantes.
// Sem import nem referencia.

/** Onde uma entrega esta, vista da sessao do dono que a leva. */
export type MensageiroEstadoDaEntrega =
  | 'na-fila' | 'a-caminho' | 'reservada' | 'nao-chegou' | 'desistiu' | 'entregue' | 'saiu-da-caixa'

/** Uma entrega da caixa de saida desta sessao do dono, sem o texto. */
export type MensageiroEntrega = {
  thread: string
  pedidoId: string
  envioId: string
  sessionId: string
  estado: MensageiroEstadoDaEntrega
  /** Quantas vezes a mensagem foi enviada (`$.session.send`), pela conta do nucleo. */
  tentativas: number
  /** Por que o ultimo envio nao entrou na fila da sessao, ou por que o Mensageiro parou de tentar. */
  motivo: string | null
  /** Quando a entrega mudou de estado aqui (ms desde a epoca). */
  em: number
}

/** Um pedido que o retrato mostra com a entrega incerta e que a caixa desta sessao nao tem: segue noutra sessao. */
export type MensageiroIncerta = { thread: string; pedidoId: string }

/** O lado do dono: as entregas desta sessao e as incertas de fora, com a ultima leitura. */
export type MensageiroDono = {
  entregas: MensageiroEntrega[]
  incertas: MensageiroIncerta[]
  /** Quando a caixa foi lida (ms desde a epoca); null antes da primeira leitura. */
  lidoEm: number | null
  /** Por que a ultima leitura falhou, quando falhou (a anterior fica no painel). */
  erro: string | null
}

/**
 * O que aconteceu, na sessao de fase, com uma mensagem que chegou de outra sessao: consumida antes do modelo (sem
 * entrega confirmada pelo nucleo), confirmando (conferida, na conversa, gravando o recibo), entregue (com o recibo),
 * sem recibo (na conversa, mas o recibo nao foi gravado) ou nao entrou (conferida, e outro plugin a consumiu abaixo).
 */
export type MensageiroEstadoDaRecebida = 'consumida' | 'confirmando' | 'entregue' | 'sem-recibo' | 'nao-entrou'

/** Uma mensagem de outra sessao que chegou a sessao de fase, sem o texto dela. */
export type MensageiroRecebida = {
  /** Quando chegou ou mudou de estado (ms desde a epoca). */
  em: number
  /** O tipo da origem e o plugin que o remetente diz ser, numa linha. */
  origem: string
  estado: MensageiroEstadoDaRecebida
  /** O pedido e a entrega: conferidos pelo nucleo na entrega confirmada; na consumida, so o que a marca dizia. */
  pedidoId: string | null
  envioId: string | null
  /** Por que foi consumida ou ficou sem recibo, com o codigo do nucleo. */
  motivo: string | null
}

/** O lado da sessao de fase: a thread do despacho e o que chegou de outras sessoes. */
export type MensageiroFase = {
  thread: string | null
  recebidas: MensageiroRecebida[]
  /** Por que um trabalho em segundo plano parou, quando parou. */
  erro: string | null
}

/** O que o painel mostrou ao dono e o Telegram tambem diria: a chave junta o que e a mesma coisa (M5). */
export type MensageiroMostrado = { chave: string; thread: string | null; texto: string }

declare module 'claude-code' {
  interface PluginState {
    'ork-mensageiro': {
      /** O lado do dono: as entregas a caminho das sessoes de fase. */
      dono: MensageiroDono
      /** O lado da sessao de fase: o que chegou de outras sessoes e o que o nucleo confirmou. */
      fase: MensageiroFase
    }
  }
}
