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

export type Ork = {
  /** O papel desta sessao. */
  papel: () => Promise<OrkPapel>
  /** Papel, thread do despacho e raiz da sessao. */
  contexto: () => Promise<OrkContexto>
}

declare module 'claude-code' {
  interface EngineInterface {
    ork: Ork
  }
}
