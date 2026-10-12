// Contrato do estado da Sentinela do Condutor (`ork-sentinela`, RM-059, fatia F6). O motor exige que cada chave de
// `$.state` do mod esteja declarada aqui, em `PluginState`. A Sentinela não acrescenta noun ao `$`: lê o núcleo pelo
// `$.ork` da `ork-ponte` (que o plugin.json lista em `dependencies`) e pelo `ork`, e despacha só pelo `ork phase run`.
// Sem import nem referência.

/** O que o núcleo diz que o condutor faz numa thread (contrato `ork.conducao-sentinela/v1`). */
export type SentinelaAcao = 'despachar' | 'retomar' | 'avisar' | 'nada'

/** O passo do condutor numa thread aberta, como o `ork conducao sentinela status --json` o devolve. */
export type SentinelaPasso = {
  thread: string
  modo: string
  faseAtual: string
  conduzida: boolean
  acao: SentinelaAcao
  /** A fase do despacho, só com `acao: despachar`. */
  fase: string | null
  caso: string | null
  proximoPasso: string | null
  porque: string
  /** O fim do turno (ou o bloqueio): a chave do despacho. */
  desdeEm: string | null
  bloqueio: { motivo: string; em: string } | null
  pedidoGuardado: boolean
}

/** De quem é a presença da Sentinela nesta máquina, pela última batida. */
export type SentinelaPresenca = 'minha' | 'outra' | 'nenhuma' | 'desconhecida'

/** A última leitura do status do núcleo, para a faixa e o `/sentinela`. */
export type SentinelaResumo = {
  /** Quando a leitura terminou, em ms desde a época; null antes da primeira. */
  lidoEm: number | null
  presenca: SentinelaPresenca
  passos: SentinelaPasso[]
  /** Por que a última leitura falhou, quando falhou. */
  erro: string | null
}

/** Uma linha do diário do `/sentinela`. */
export type SentinelaEntrada = {
  em: number
  tipo: 'despacho' | 'cedeu' | 'retomada' | 'aviso' | 'erro' | 'pausa'
  thread: string | null
  texto: string
}

declare module 'claude-code' {
  interface PluginState {
    'ork-sentinela': {
      /** O diário do que a Sentinela fez, do mais velho ao mais novo, com teto. */
      diario: SentinelaEntrada[]
      /** O dono pausou a Sentinela pelo `/sentinela pausar`: nada é despachado e a presença sai. */
      pausada: boolean
      /** As chaves `thread|fase|fim do turno` já despachadas: o mesmo turno nunca sai duas vezes. */
      despachados: string[]
      /** As chaves `thread|bloqueio` já levadas ao `ork retry plan`. */
      retomados: string[]
      /** As chaves dos avisos já mostrados, com o texto: o mesmo aviso não se repete. */
      avisados: string[]
      /** A última leitura do status do núcleo. */
      resumo: SentinelaResumo
    }
  }
}
