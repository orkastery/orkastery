// Contrato do estado do Radar de Colisão (`ork-radar`, RM-059, fatia F3). O motor exige que cada chave de
// `$.state` do mod esteja declarada aqui, em `PluginState`. O Radar não acrescenta noun ao `$`: lê o núcleo
// pelo `$.ork` da `ork-ponte`, que o plugin.json lista em `dependencies`. Sem import nem referência.

/** Como um par ficou na última conta: limpo, em conflito, com erro do git ou ainda não calculado. */
export type RadarEstado = 'limpa' | 'conflito' | 'erro' | 'pendente'

/** Um lease `path:<glob>` ativo que cobre um arquivo em conflito, com a thread que o segura. */
export type RadarLease = { lease: string; thread: string }

/** Um arquivo em conflito num par e os leases que o cobrem. */
export type RadarArquivo = { caminho: string; leases: RadarLease[] }

/** Um par: uma thread contra a base (`@main`) ou duas threads, com o que o `merge-tree` disse dele. */
export type RadarCelula = {
  /** Os dois lados em ordem, separados por `|`. */
  par: string
  a: string
  b: string
  estado: RadarEstado
  arquivos: RadarArquivo[]
  /** A primeira linha do erro do git, ou o motivo de o par não ter sido calculado. */
  erro: string | null
}

/** Uma thread aberta da rodada: o rótulo do mapa, a branch e o SHA dela, ou por que não tem. */
export type RadarThread = {
  id: string
  fase: string
  /** O nome curto no mapa: de 1 a 9, depois a, b e c. */
  rotulo: string
  /** A ref da branch, como o `ls-remote` a lista. */
  branch: string
  sha: string | null
  motivo: string | null
}

/** A base da conta: a `origin/main` local e o que o remoto disse dela. */
export type RadarBase = {
  ref: string
  sha: string | null
  remoto: string | null
  /** `igual` ao remoto, `diferente` dele, ou `nao-conferida` quando o remoto não respondeu. */
  situacao: 'igual' | 'diferente' | 'nao-conferida'
  erroRemoto: string | null
}

/** O mapa de uma rodada. */
export type RadarMapa = {
  threads: RadarThread[]
  base: RadarBase
  celulas: RadarCelula[]
  /** Threads abertas que ficaram de fora pelo teto da rodada. */
  omitidas: number
  /** O que não veio inteiro: os leases, a branch de uma thread, o orçamento do `merge-tree`, o temporário. */
  lacunas: string[]
  /** Quando a rodada terminou, em ms desde a época; null antes da primeira. */
  lidoEm: number | null
  /** Por que a rodada não foi feita, quando não foi. */
  erro: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'ork-radar': {
      /** O mapa da última rodada. */
      mapa: RadarMapa
    }
  }
}
