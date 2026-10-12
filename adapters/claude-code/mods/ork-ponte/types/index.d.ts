// Contrato do noun `$.ork`, que a ponte acrescenta ao `$` no `engine.create` (RM-059, onda 0).
// Um mod do Orkastery lista `ork-ponte` em `dependencies` no proprio plugin.json e recebe estes tipos
// em `.claude-plugin/types/ork-ponte/`. Todo metodo recebe um objeto so: o host recusa noun com mais
// de um argumento. Sem import nem referencia, como o motor exige de um contrato.

/**
 * O papel da sessao: `dono` na sessao interativa do dono (servidor `orkastery` sem thread),
 * `fase` na sessao despachada pelo nucleo (`ORK_DISPATCH_ID`), `dormente` fora do Orkastery.
 */
export type OrkPapel = 'dono' | 'fase' | 'dormente'

/** O que a ponte sabe da sessao, calculado a cada chamada (o MCP pode conectar depois do inicio). */
export type OrkContexto = {
  papel: OrkPapel
  /** A thread do despacho, so na sessao de fase e com id valido. */
  thread: string | null
  /** A raiz da sessao, absoluta. */
  raiz: string
}

/** As secoes do retrato `ork.maestro-snapshot/v1` do nucleo. */
export type OrkSecao = 'portfolio' | 'demands' | 'threads' | 'sessions' | 'blockers' | 'leases' | 'retries' | 'hitl'
  | 'ship' | 'master' | 'nextActions'

/** A lista fechada de consultas de leitura do CLI, todas com `--json` (D10). */
export type OrkConsulta = 'maestro' | 'thread.status' | 'thread.list' | 'conducao.status' | 'retry.plan' | 'retry.list'
  | 'pulse' | 'orquestracao.status' | 'sessions.hitl' | 'roadmap.status' | 'accounts.esgotamentos' | 'decisao.placar'

/** O retrato inteiro, uma secao (com `offset`, padrao 0) ou o recorte de uma thread. */
export type OrkPedidoDeRetrato = {
  secao?: OrkSecao
  thread?: string
  offset?: number
}

export type OrkPedidoDeLeitura = {
  consulta: OrkConsulta
  /** Obrigatoria em `thread.status`, `conducao.status`, `retry.plan` e `decisao.placar`. */
  thread?: string
}

/** A acao que o nucleo declara para um item, quando declara (projecao de `ork.maestro-snapshot/v1`). */
export type OrkAcaoDoMaestro = {
  operation: string
  available: boolean
  reason: string
  preconditions: string[]
  readback: string
}

export type OrkItemDoMaestro = {
  id: string
  title: string
  status: string
  refs: Array<{ kind: string; id: string }>
  facts: Record<string, string | number | boolean | null>
  action?: OrkAcaoDoMaestro
}

export type OrkSecaoDoMaestro = {
  state: 'available' | 'empty' | 'unavailable' | 'stale' | 'conflict'
  source: string
  observedAt: string
  items: OrkItemDoMaestro[]
  gaps: string[]
}

/** Projecao minima do `ork.maestro-snapshot/v1`; o resto do objeto chega como o nucleo mandou. */
export type OrkMaestro = {
  schema: 'ork.maestro-snapshot/v1'
  observedAt: string
  sections: Partial<Record<OrkSecao, OrkSecaoDoMaestro>>
  gaps: string[]
}

export type OrkRetrato = {
  /** De onde veio: o MCP do nucleo, a reserva pelo CLI ou o cache da ponte. */
  fonte: 'mcp' | 'cli' | 'cache'
  /** Quando a ponte leu, em ms desde a epoca (relogio do `$.clock`). */
  lidoEm: number
  retrato: OrkMaestro
}

/** O `stat` dos ledgers cobertos por um retrato guardado. */
export type OrkAssinatura = Array<{ caminho: string; tamanho: number; mtimeMs: number } | { caminho: string; ausente: true }>

export type OrkRetratoGuardado = {
  fonte: 'mcp' | 'cli'
  lidoEm: number
  retrato: unknown
  caminhos: string[]
  assinatura: OrkAssinatura
}

export type Ork = {
  /** O papel desta sessao. */
  papel: () => Promise<OrkPapel>
  /** Papel, thread do despacho e raiz da sessao. */
  contexto: () => Promise<OrkContexto>
  /**
   * O retrato do nucleo pelo `ork_maestro`, com reserva na consulta `maestro` do CLI (teto de 10 s).
   * Volta do cache enquanto o `stat` dos ledgers cobertos nao muda, por no maximo 60 s.
   */
  retrato: (pedido?: OrkPedidoDeRetrato) => Promise<OrkRetrato>
  /** Uma consulta da lista fechada pelo CLI, com teto de 10 s; recusa o que estiver fora dela. */
  ler: (pedido: OrkPedidoDeLeitura) => Promise<unknown>
}

declare module 'claude-code' {
  interface EngineInterface {
    ork: Ork
  }
  interface PluginState {
    'ork-ponte': {
      /** Os retratos guardados, por pedido. */
      retratos: Record<string, OrkRetratoGuardado>
    }
  }
}
