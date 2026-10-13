// Contrato do estado do Ritual do MASTER (`ork-ritual`, RM-059, fatia F8; ficha M8 do plano dos mods). O motor exige
// que cada chave de `$.state` do mod esteja declarada aqui, em `PluginState`. O Ritual nao acrescenta noun ao `$`: le as
// entregas pelo retrato da `ork-ponte` (`$.ork.retrato`, secao `master`) e as claims pelo `ork_claims_list` do nucleo.
// Nenhum campo guarda o porque do dono, e a nota so aparece como o texto do que o nucleo registrou: quem recebe e grava
// a nota e o nucleo, pelo dialogo nativo do host. Sem import nem referencia.

/** Uma entrega que espera a nota do dono, como a secao `master` do retrato do nucleo a da. */
export type RitualEntrega = {
  thread: string
  /** `pending` (sem MASTER), `ratificacao-pendente` (proposta) ou `recorded` (so a aceita por omissao entra aqui). */
  status: 'pending' | 'ratificacao-pendente' | 'recorded'
  /** O regime do MASTER log: `omissao` na aceita por omissao; null sem MASTER log. */
  regime: string | null
  /** O score que a omissao gravou (o indice arredondado), quando ha. */
  score: number | null
  /** O indice derivado do ledger, de 0 a 5, e as parcelas que o descontaram. */
  indice: number | null
  parcelas: string
  /** Os gates que barraram a thread (reprovacoes tipadas), fora os de ensaio. */
  reprovacoes: number
  /** As classes de falha do MASTER log (ou da proposta); null quando o POSTMORTEM ainda nao nasceu. */
  classes: string | null
  /** A entrega (`ship_done` ou artefato), em ISO e na hora local que o nucleo formatou, e o merge. */
  entregueEm: string
  entregueEmLocal: string | null
  merge: string | null
  /** O arquivo da entrega por artefato (a thread so de planejamento); ausente no quadro gravado antes deste campo. */
  artefato?: string | null
}

/** A ultima leitura das entregas. */
export type RitualQuadro = {
  entregas: RitualEntrega[]
  /** Quando foi lida (ms desde a epoca); null antes da primeira leitura. */
  lidoEm: number | null
  /** Por que a ultima leitura falhou, quando falhou (a anterior continua no quadro). */
  erro: string | null
  /** O que veio incompleto do retrato (lacunas da secao, paginas que sobraram). */
  avisos: string[]
  /** Quantas entregas sem nota humana ficaram fora da janela de dias. */
  foraDaJanela: number
  /**
   * Quantas threads o retrato nao leu (o ledger passou do teto de leitura do Maestro, ou o MASTER log nao vale): com
   * alguma, a contagem da faixa e "pelo menos". Ausente no quadro gravado antes deste campo.
   */
  semLeitura?: number
}

/** Uma claim no replay: o ultimo registro de cada id, como o `ork_claims_list` a da. Nunca a saida do comando. */
export type RitualClaim = {
  id: string
  estado: string
  arquivo: string
  alegacao: string
  comandos: string[]
}

/** A prova de uma thread no replay. */
export type RitualProva = {
  thread: string
  /** As claims ativas, na ordem dos ids. */
  claims: RitualClaim[]
  retiradas: number
  lidoEm: number | null
  erro: string | null
}

/** O que o painel mostrou ao dono e o Telegram tambem diria: a chave junta o que e a mesma coisa (M5). */
export type RitualMostrado = { chave: string; thread: string; texto: string }

/**
 * O "Dar a nota" de uma entrega (T8.3): o dialogo pedido ao nucleo e o que ele devolveu. So o estado e o texto do
 * resultado; a nota e o porque que o dono deu ficam no nucleo, nunca aqui.
 */
export type RitualNota = {
  estado: 'abrindo' | 'registrada' | 'repetida' | 'pendente' | 'sem-dialogo' | 'erro'
  texto: string
  em: number
}

/** A reserva pelo Telegram (T8.3): o pedido de nota do nucleo e o codigo que o dono responde por la. */
export type RitualReserva = {
  estado: 'pedindo' | 'pronta' | 'erro'
  texto: string
  codigo: string | null
  em: number
}

declare module 'claude-code' {
  interface PluginState {
    'ork-ritual': {
      /** A ultima leitura das entregas. */
      quadro: RitualQuadro
      /** A thread no replay da prova, pedida por "Ver a prova" ou por `/nota <thread>`. */
      foco: string | null
      /** A claim que o replay mostra, a partir de 0. */
      passo: number
      /** As claims da thread em foco. */
      prova: RitualProva | null
      /** O "Dar a nota" de cada entrega, pelo id da thread. */
      notas: Record<string, RitualNota>
      /** A reserva pelo Telegram de cada entrega, pelo id da thread. */
      reservas: Record<string, RitualReserva>
    }
  }
}
