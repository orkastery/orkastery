// Contrato do estado da Pista de Entrega (`ork-pista`, RM-059, fatia F7). O motor exige que cada chave de `$.state`
// do mod esteja declarada aqui, em `PluginState`. A Pista nao acrescenta noun ao `$`: le o nucleo pelo `$.ork` da
// `ork-ponte`, que o plugin.json lista em `dependencies`, e pelos comandos `ork ... --json` da lista fechada dela.
// Sem import nem referencia.

/** As oito etapas da pista, na ordem do contrato `ork.ship-pista/v1` do nucleo. */
export type PistaIdDaEtapa = 'check' | 'verify' | 'bundle' | 'branch' | 'pr' | 'ci' | 'conflito' | 'entrega'

export type PistaEstadoDaEtapa = 'feita' | 'pendente' | 'falhou' | 'nao-lida' | 'nao-se-aplica'

export type PistaEtapa = { id: PistaIdDaEtapa; estado: PistaEstadoDaEtapa; texto: string }

/** O proximo passo que o nucleo declara: so `publicar` e `registrar` viram botao, e so com `disponivel`. */
export type PistaProximo = {
  acao: 'publicar' | 'registrar' | null
  disponivel: boolean
  texto: string
  /** O comando do nucleo que resolve, ou o que o dono roda no terminal dele (texto, nunca rodado pela Pista). */
  comando: string | null
}

export type PistaPr = { numero: number; url: string | null; estado: 'aberto' | 'mesclado' | 'fechado'; rascunho: boolean; head: string }

/** A pista de uma thread, como o `ork ship pista --json` a dá. */
export type PistaLinha = {
  thread: string
  nome: string
  tag: string
  /** O modo da thread ja autoriza o push (#Auto e #Maestro). */
  publicavel: boolean
  conduzida: boolean
  branch: string
  head: string | null
  pr: PistaPr | null
  etapas: PistaEtapa[]
  proximo: PistaProximo
}

/** A leitura da pista inteira: uma linha por thread aberta na entrega. */
export type PistaQuadro = {
  linhas: PistaLinha[]
  /** Quando a pista foi lida (ms desde a epoca); null antes da primeira leitura. */
  lidoEm: number | null
  /** Por que a ultima leitura falhou, quando falhou (a anterior continua no quadro). */
  erro: string | null
  /** Avisos da leitura do nucleo: o remoto ou os PRs que nao responderam. */
  avisos: string[]
}

/** O que um botao fez, uma linha por thread: em curso, ou o resultado do comando do nucleo. */
export type PistaAcao = {
  acao: 'publicar' | 'registrar'
  estado: 'rodando' | 'feita' | 'recusada' | 'mudou' | 'falhou'
  texto: string
  em: number
}

/** O CI de uma pista lido por consulta ao nucleo (`ork ci status --sha`), pelo evento do GitHub ou pelo relogio. */
export type PistaCi = {
  sha: string
  estado: 'success' | 'pending' | 'failure' | 'missing' | 'unavailable' | 'disabled'
  texto: string
  url: string | null
  lidoEm: number
  /** O que pediu a leitura: um evento do GitHub, o relogio de reserva ou o dono. */
  motivo: 'evento' | 'consulta' | 'dono'
}

/** O que o painel mostrou ao dono e o Telegram tambem diria: a chave junta o que e a mesma coisa (M5). */
export type PistaMostrado = { chave: string; thread: string; texto: string }

declare module 'claude-code' {
  interface PluginState {
    'ork-pista': {
      /** A ultima leitura da pista do nucleo. */
      quadro: PistaQuadro
      /** A thread em foco, pedida por `/pista <thread>` (a Torre abre a Pista assim). */
      foco: string | null
      /** O ultimo botao de cada thread. */
      acoes: Record<string, PistaAcao>
      /** O CI lido de cada thread com PR aberto. */
      ci: Record<string, PistaCi>
    }
  }
}
