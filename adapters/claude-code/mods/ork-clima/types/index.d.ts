// Contrato do Clima de Cota (RM-059, onda 1, F4): os tipos da serie e da previsao das janelas de limite
// da conta, e o estado do mod. O Clima nao acrescenta noun ao `$`: usa o `$.ork` da `ork-ponte`, que ele
// lista em `dependencies`. Sem import nem referencia, como o motor exige de um contrato.

/** Uma janela de limite como o motor a entrega em `session.measure` (`SessionRateLimit`). */
export type ClimaLeitura = {
  /** `five_hour`, `seven_day` ou a de gasto de um gateway (`spend_limit`). */
  kind: string
  /** De 0 a 100 (passa de 100 num limite de gasto estourado). */
  percentUsed: number
  /** Quando a janela renova, em ISO 8601. */
  resetsAt?: string
}

/** Um ponto da serie: quando foi lido (ms desde a epoca, relogio do `$.clock`) e o percentual. */
export type ClimaPonto = {
  em: number
  pct: number
}

/** A serie de uma janela, desde que ela renovou pela ultima vez. */
export type ClimaJanela = {
  kind: string
  /** Quando renova, em ms desde a epoca; `null` quando o motor nao disse. */
  renovaEm: number | null
  pontos: ClimaPonto[]
}

/** A serie `ork.clima-serie/v1` no `$.store` do mod, que dura entre sessoes. */
export type ClimaSerie = {
  formato: 'ork.clima-serie/v1'
  janelas: ClimaJanela[]
}

/**
 * `esgotada`: 100% ou mais. `acaba-antes`: no ritmo atual, acaba antes de renovar. `folga`: o ritmo nao
 * esgota antes de renovar. `sem-ritmo`: ainda sem leituras para medir o ritmo.
 */
export type ClimaEstado = 'esgotada' | 'acaba-antes' | 'folga' | 'sem-ritmo'

/** A previsao de uma janela no ritmo atual. */
export type ClimaPrevisao = {
  kind: string
  /** `5 h`, `7 d`, `gasto` ou o proprio `kind`. */
  rotulo: string
  /** O percentual da ultima leitura. */
  pct: number
  /** Quando a ultima leitura chegou, em ms desde a epoca. */
  lidaEm: number
  renovaEm: number | null
  /** Pontos percentuais por hora no intervalo recente; `null` sem leituras suficientes. */
  ritmoPorHora: number | null
  /** Quando acaba no ritmo atual, em ms desde a epoca; `null` sem ritmo que esgote. */
  acabaEm: number | null
  estado: ClimaEstado
}

declare module 'claude-code' {
  interface PluginState {
    'ork-clima': {
      /** A ultima linha que o Clima publicou na faixa da ponte; `null` depois de tira-la. */
      faixa: string | null
    }
  }
}
