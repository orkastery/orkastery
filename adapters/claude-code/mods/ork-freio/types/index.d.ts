// Contrato de tipos do Freio de Lote (RM-059, fatia F2). O Freio nao acrescenta noun ao `$`: este arquivo
// declara o estado dele (`PluginState['ork-freio']`) e os tipos que os modulos puros e os testes usam.
// Sem import nem referencia, como o motor exige de um contrato.

/** Uma claim ativa da thread, como o Freio a usa: o id, o arquivo e os comandos de verificacao. */
export type FreioClaim = {
  id: string
  arquivo: string | null
  comandos: string[]
}

/** O que a carga leu do nucleo (T2.1). */
export type FreioCarga = {
  /** A thread do despacho, do contexto da ponte. */
  thread: string
  /** O status da thread no retrato do nucleo; `fechada` deixa o Freio dormente. */
  statusDaThread: string | null
  /** As claims nao retiradas; `null` enquanto o nucleo nao respondeu. */
  claims: FreioClaim[] | null
  /** Quando as claims foram lidas, em ms desde a epoca. */
  claimsEm: number
  /** A uniao dos `touch_paths` das tarefas do plano; `null` sem plano ou sem nenhum. */
  touchPaths: string[] | null
  /** O plano ja foi lido (com ou sem `touch_paths`). */
  planoLido: boolean
  /** Quando o plano foi lido, em ms desde a epoca. */
  planoEm: number
  /** O que falhou na ultima carga, para a linha de status e o teste. */
  erros: string[]
}

/** A foto do `git status` da worktree: o HEAD e a assinatura de cada caminho sujo. */
export type FreioFoto = {
  head: string | null
  /** Caminho relativo a raiz da sessao para `XY|tamanho|mtimeMs` (ou `XY|ausente`). */
  caminhos: Record<string, string>
}

/** Uma claim afetada pelo lote, na fila da conferencia (T2.2). */
export type FreioPedido = {
  id: string
  /** 3 pelo `arquivo`, 2 pelo caminho citado no comando, 1 pelo nome-base citado (D5). */
  forca: number
  /** Os caminhos tocados que a afetaram. */
  caminhos: string[]
}

/** O que o Freio vigia entre os lotes. */
export type FreioVigia = {
  thread: string
  /** A ultima foto do `git status`; `null` antes da primeira. */
  foto: FreioFoto | null
  /** O numero do lote, que marca quando cada caminho foi tocado. */
  seq: number
  /** O ultimo lote que tocou cada caminho. */
  toques: Record<string, number>
  /** As claims afetadas que esperam conferencia. */
  fila: FreioPedido[]
  /** Os caminhos fora dos `touch_paths` ja avisados nesta sessao. */
  avisadosFora: string[]
  // Os campos da conferencia (T2.3) faltam na vigia gravada antes deles; `comConferencia` os preenche.
  /** A rodada em curso no nucleo, ou `null`. */
  rodada?: FreioRodada | null
  /** O que o lote seguinte devolve ao modelo. */
  entrega?: FreioEntrega
  /** As claims cuja ultima conferencia reprovou. */
  emRisco?: string[]
  /** Ate quando o Freio nao pede conferencia (depois de uma indisponivel), em ms desde a epoca. */
  pausaAte?: number
  /** Por que a ultima conferencia ficou indisponivel, ou `null`. */
  indisponivel?: string | null
  /** O modelo ja foi avisado da conferencia indisponivel nesta sessao. */
  avisouIndisponivel?: boolean
  /** Caminhos fora dos `touch_paths` que o laco principal ainda nao recebeu (lote de subagente nao recebe aviso). */
  foraPendentes?: string[]
}

/** Uma rodada de conferencia: as claims, os caminhos que afetaram cada uma e o lote em que ela comecou (T2.3). */
export type FreioRodada = {
  ids: string[]
  caminhos: Record<string, string[]>
  /** A forca de cada claim, para ela voltar a fila no mesmo lugar (recusa por claim, conducao alheia). */
  forcas?: Record<string, number>
  /** O numero do lote no inicio; toque mais novo deixa o resultado da claim velho (D6). */
  inicio: number
}

/** Uma claim que a conferencia reprovou (`claims.failed`), como volta ao modelo. */
export type FreioFalha = {
  id: string
  alegacao: string
  arquivo: string | null
  comando: string
  codigo: number | null
  /** O fim da saida, ja redigido pelo nucleo. */
  fim: string
}

/** Uma claim cuja conferencia terminou sem veredito (prazo, comando que nao rodou). */
export type FreioSemVeredito = {
  id: string
  motivo: string
}

/** O que o lote seguinte devolve ao modelo. */
export type FreioEntrega = {
  falhas: FreioFalha[]
  semVeredito: FreioSemVeredito[]
  recuperadas: string[]
  /** O motivo da conferencia indisponivel, so na primeira vez da sessao. */
  indisponivel: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'ork-freio': {
      /** O que a carga leu do nucleo. */
      carga: FreioCarga
      /** O que o Freio vigia entre os lotes. */
      vigia: FreioVigia
    }
  }
}
