// O que a Mesa do Dono manda ao nucleo (RM-059 F5; D6 e D7 da thread ork-rm059mesa), em funcoes puras. Sao so duas
// ferramentas com efeito e uma de leitura, todas no servidor `orkastery`:
//  - `ork_request_decision` recebe exatamente `threadId` e `pedidoId`: o nucleo abre o dialogo nativo do host e grava
//    a resposta que o dono der, com o recibo do ingresso local. A Mesa nunca manda opcao, letra nem texto.
//  - `ork_decision_record` registra a decisao obvia (teste das quatro condicoes) como decisao autonoma do nucleo,
//    com criterio, evidencia, como mudar e o custo de reverter. Nao responde o pedido.
//  - `ork_hitl_pending` le os pedidos abertos de uma thread.
// So importa tipos.
import type { MesaDecidindo, MesaDecisao, MesaPergunta } from '../types'

export const SERVIDOR = 'orkastery'
/** A lista fechada de ferramentas do nucleo que a Mesa chama (D2 e D7). */
export const FERRAMENTAS_DA_MESA: readonly string[] = ['ork_hitl_pending', 'ork_request_decision', 'ork_decision_record']
/** Quem decidiu, no rastro do nucleo: a Mesa, nunca o dono (o nucleo recusa rastro que comeca pelo dono). */
export const QUEM_DECIDIU = 'mod ork-mesa na sessão do dono, pelo teste das quatro condições'
/** Os tetos do nucleo para a decisao informada (`TETOS_HITL_V2` e o esquema do `ork_decision_record`). */
export const TETO_DO_CAMPO = 200
export const TETO_DO_CUSTO = 140
export const TETO_DA_REFERENCIA = 300

/** Uma linha so, cortada no teto, para caber no contrato do nucleo. */
export function linhaNoTeto(v: string, teto: number): string {
  const t = v.replace(/\s+/g, ' ').trim()
  return t.length <= teto ? t : `${t.slice(0, teto - 1).trimEnd()}…`
}

/** Os argumentos do Decidir: so os dois ids, nada que seja resposta. */
export function argsDoDecidir(p: Pick<MesaPergunta, 'thread' | 'pedidoId'>): { threadId: string; pedidoId: string } {
  return { threadId: p.thread, pedidoId: p.pedidoId }
}

/** A marca do pedido no texto da decisao obvia: e por ela que a Mesa sabe que ja decidiu este pedido. */
export function marcaDoPedido(pedidoId: string): string {
  return `(${pedidoId.slice(0, 8)})`
}

/** Ja existe, na janela do pulse, a decisao obvia que a Mesa registrou para este pedido. */
export function jaDecidida(decisoes: readonly MesaDecisao[], p: Pick<MesaPergunta, 'thread' | 'pedidoId'>): boolean {
  const marca = marcaDoPedido(p.pedidoId)
  return decisoes.some(d => d.thread === p.thread && d.quemDecidiu.startsWith('mod ork-mesa') && d.decidido.includes(marca))
}

export type ArgsDaDecisaoObvia = {
  threadId: string
  decidido: string
  porque: string
  comoMudar: string
  custoAgora: string
  custoDepois: string
  criterio: { tipo: 'medicao'; referencia: string }
  quemDecidiu: string
  evidencia: string
}

/**
 * Os argumentos do `ork_decision_record` para uma decisao obvia: o que, o porque, como mudar, o custo de reverter
 * antes e depois do prazo, o criterio (a medicao que mostra o pedido declarando `seguir-recomendada`) e a evidencia
 * (a leitura do `ork_hitl_pending`). Cada campo cabe nos tetos do nucleo, numa linha.
 */
export function argsDaDecisaoObvia(p: MesaPergunta, recomendada: { chave: string; texto: string }, referencia: string,
  lidoEmIso: string): ArgsDaDecisaoObvia {
  const pedido = p.codigo ?? p.pedidoId.slice(0, 8)
  const prazo = p.prazoLocal ?? p.prazo ?? 'no prazo do pedido'
  const reserva = p.reserva ? ` ou ${p.reserva} pelo Telegram` : ''
  return {
    threadId: p.thread,
    decidido: linhaNoTeto(`Sem te chamar: o pedido ${pedido} ${marcaDoPedido(p.pedidoId)} da ${p.thread} segue a recomendada ` +
      `${recomendada.chave} (${recomendada.texto}) no prazo ${prazo}`, TETO_DO_CAMPO),
    porque: linhaNoTeto('O pedido declara que segue a recomendada no prazo, é reversível antes da entrega e passou nas quatro ' +
      'condições da decisão óbvia (M4)', TETO_DO_CAMPO),
    comoMudar: linhaNoTeto(`Na Mesa, Decidir no cartão do pedido ${pedido} antes do prazo${reserva}`, TETO_DO_CAMPO),
    custoAgora: linhaNoTeto('Nenhum: o pedido segue aberto até o prazo e o dono escolhe outra alternativa no diálogo', TETO_DO_CUSTO),
    custoDepois: linhaNoTeto('Depois do prazo a recomendada já seguiu; mudar pede nova decisão na thread', TETO_DO_CUSTO),
    criterio: { tipo: 'medicao', referencia: linhaNoTeto(referencia, TETO_DA_REFERENCIA) },
    quemDecidiu: QUEM_DECIDIU,
    evidencia: linhaNoTeto(`ork_hitl_pending ${p.thread} lido em ${lidoEmIso}: pedido ${p.pedidoId}, estado ${p.estado}, ` +
      `acaoPadraoAoExpirar ${p.acaoAoExpirar ?? '-'}, irreversivel ${String(p.irreversivel)}, fase ${p.fase ?? '-'}`, 4096),
  }
}

/**
 * Depois de uma recarga do modulo nenhum Decidir esta em curso: o que ficou `abrindo` no estado vira `sem-resposta`,
 * e o cartao volta a ter o botao.
 */
export function soltarAbrindo(decidindo: Readonly<Record<string, MesaDecidindo>>): Record<string, MesaDecidindo> {
  return Object.fromEntries(Object.entries(decidindo).map(([id, v]) => [id, v.estado === 'abrindo'
    ? { estado: 'sem-resposta' as const, texto: 'o diálogo ficou sem resposta (a Mesa recarregou); o pedido segue aberto', em: v.em } : v]))
}

/** Por que a notificacao do sistema nao saiu, em pt-BR (o motor manda o codigo em ingles). */
export function motivoDaNotificacao(reason: unknown): string {
  const motivos: Record<string, string> = {
    'no-channel': 'nenhum canal de notificação configurado',
    'no-surface': 'nenhuma superfície para mostrar',
    refused: 'o terminal recusou a notificação',
    disabled: 'as notificações estão desligadas',
  }
  return `a notificação do sistema não saiu (${motivos[String(reason)] ?? String(reason)})`
}

/** O que o cartao diz do Decidir, a partir do que o nucleo devolveu (`{ ok, pedidoId, estado, repetida }`). */
export function resultadoDoDecidir(resposta: unknown, agora: number): MesaDecidindo {
  const r = (resposta && typeof resposta === 'object' ? resposta : {}) as { ok?: unknown; estado?: unknown; repetida?: unknown }
  const estado = typeof r.estado === 'string' ? r.estado : ''
  if (r.ok === true) {
    if (r.repetida === true) return { estado: 'respondido', texto: `o pedido já estava respondido no núcleo: ${estado || 'registrado'}`, em: agora }
    return { estado: 'respondido', texto: `respondido pelo diálogo: ${estado || 'registrado'}`, em: agora }
  }
  return { estado: 'sem-resposta', texto: 'o diálogo fechou sem resposta; o pedido segue aberto', em: agora }
}
