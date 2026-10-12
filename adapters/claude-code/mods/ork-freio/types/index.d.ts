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
