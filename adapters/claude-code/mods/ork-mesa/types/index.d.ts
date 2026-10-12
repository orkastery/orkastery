// Contrato do estado da Mesa do Dono (`ork-mesa`, RM-059 fatia F5; ficha M4 do plano dos mods). Sem import nem
// referencia, como o motor exige de um contrato: as chaves de `$.state` que a Mesa usa ficam declaradas aqui. A
// Mesa le o nucleo pela ponte (`$.ork.retrato` e `$.ork.ler`) e por tres ferramentas MCP; nada aqui e resposta
// do dono, e nenhum campo guarda a opcao que o dono escolheu.

/** Uma alternativa de um pedido, como a Mesa a mostra: letra no `ork.hitl/v2`, numero no `ork.hitl/v1`. */
export type MesaAlternativa = {
  chave: string
  texto: string
  acao: string
  /** O que acontece se escolher, em uma linha (so no v2). */
  consequencia: string | null
  recomendada: boolean
  /** O porque da recomendada (so no v2). */
  porque: string | null
}

/** A oferta do canal `claude-code` para o pedido, lida do `ork_hitl_pending`; sem leitura, desconhecida. */
export type MesaCanal = 'disponivel' | 'indisponivel' | 'desconhecido'

/** Um pedido aberto que espera o dono, montado do pulse e conferido no `ork_hitl_pending`. */
export type MesaPergunta = {
  thread: string
  fase: string | null
  modo: string | null
  pedidoId: string
  codigo: string | null
  contrato: 'ork.hitl/v1' | 'ork.hitl/v2'
  alvo: 'gate' | 'session'
  motivo: string
  pergunta: string
  /** A recomendacao em texto, como o nucleo a escreve. */
  recomendacao: string
  alternativas: MesaAlternativa[]
  irreversivel: boolean
  ato: string | null
  tipoDeResposta: string | null
  respostaAceita: string | null
  dependenciaTecnica: boolean
  acaoAoExpirar: string | null
  prazo: string | null
  prazoLocal: string | null
  desdeEm: string | null
  /** O estado do pedido no nucleo (`aberto`, `esperar`, `escalar`, `seguir-recomendada`). */
  estado: string
  canalClaudeCode: MesaCanal
  /** O que o dono digita pelo Telegram ou no terminal, quando o dialogo nao serve. */
  reserva: string | null
}

/** Uma parada sem pedido ou um impedimento que so o dono resolve: so leitura. */
export type MesaOutro = {
  chave: string
  thread: string | null
  fase: string | null
  motivo: string
  texto: string
  recomendacao: string
  comando: string
  desdeEm: string | null
  impedimento: boolean
}

/** Uma decisao que a fabrica (ou a Mesa) tomou pelo dono, como o pulse a traz. */
export type MesaDecisao = {
  id: string
  thread: string
  fase: string
  em: string
  decidido: string
  porque: string
  comoMudar: string
  custoAgora: string
  custoDepois: string
  quemDecidiu: string
  /** Ainda nao mostrada ao dono pela Mesa (registro do mostrado da ponte). */
  nova: boolean
}

export type MesaFila = {
  perguntas: MesaPergunta[]
  outros: MesaOutro[]
  decisoes: MesaDecisao[]
  /** Quantas decisoes a janela do pulse tinha; o painel mostra so as primeiras. */
  totalDeDecisoes: number
  lidoEm: number | null
  erro: string | null
  /** O que nao saiu inteiro na ultima leitura (uma conferencia, a faixa, o registro): o painel mostra cada um. */
  avisos: string[]
}

/** O Decidir de um pedido: o dialogo pedido ao nucleo e o que ele devolveu. */
export type MesaDecidindo = {
  estado: 'abrindo' | 'respondido' | 'sem-resposta' | 'erro'
  texto: string
  em: number
}

/** A decisao obvia que a Mesa registrou pelo nucleo, ou a recusa dele. */
export type MesaObvia = {
  estado: 'registrada' | 'recusada'
  texto: string
  em: number
}

declare module 'claude-code' {
  interface PluginState {
    'ork-mesa': {
      /** A fila lida do nucleo. */
      fila: MesaFila
      /** A thread que o `/mesa <thread>` pediu; `null` mostra todas. */
      foco: string | null
      /** A pagina do lote de perguntas, de cinco em cinco. */
      pagina: number
      /** O Decidir de cada pedido, pelo id do pedido. */
      decidindo: Record<string, MesaDecidindo>
      /** As decisoes obvias desta sessao, pelo id do pedido. */
      obvias: Record<string, MesaObvia>
    }
  }
}
