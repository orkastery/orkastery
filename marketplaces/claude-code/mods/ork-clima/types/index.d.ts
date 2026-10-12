// Contrato do Clima de Cota (RM-059, onda 1, F4): os tipos da serie e da previsao das janelas de limite
// da conta, e o estado do mod. O Clima nao acrescenta noun ao `$`: usa o `$.ork` da `ork-ponte`, que ele
// lista em `dependencies`. Sem import nem referencia, como o motor exige de um contrato.

/** Um ponto da serie: quando foi lido (ms desde a epoca, relogio do `$.clock`) e o percentual. */
export type ClimaPonto = {
  em: number
  pct: number
}

/** A serie de uma janela (`five_hour`, `seven_day` ou a de gasto de um gateway), desde que ela renovou. */
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
 * esgota antes de renovar. `sem-ritmo`: ainda sem leituras para medir o ritmo, ou com uma serie nova demais
 * para prever tao longe (D15).
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

/** Uma retomada da fila que nao cabe, como a ultima leitura da fila deixou. */
export type ClimaNaoCabe = {
  id: string
  thread: string
  /** O que vai ao registro do mostrado da ponte (D8). */
  texto: string
  /** Se o registro ja aceitou; a que falhou e tentada de novo na medicao seguinte (D15). */
  registrada: boolean
}

/** O ultimo problema de uma medicao, que o `/clima` mostra (D15). */
export type ClimaProblema = {
  /** O que aconteceu, numa frase que comeca minuscula. */
  motivo: string
  /** Quando, em ms desde a epoca; `null` quando nem o relogio respondeu. */
  em: number | null
  /** Se veio da leitura: so a proxima leitura boa o limpa. */
  daLeitura: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ork-clima': {
      /** A ultima linha que o Clima publicou na faixa da ponte; `null` depois de tira-la. */
      faixa: string | null
      /** As retomadas que nao cabiam na ultima leitura da fila, para as medicoes sem leitura nova (D13). */
      naoCabem: ClimaNaoCabe[]
      /** O ultimo problema de medicao, ate uma medicao boa limpa-lo (D15). */
      problema: ClimaProblema | null
    }
  }
}
