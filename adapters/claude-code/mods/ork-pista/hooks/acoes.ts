// Os botoes da Pista (RM-059, fatia F7, T7.3; D6 da thread ork-rm059pista). Modulo puro: o botao que o nucleo declara
// para cada pista, o argv dos dois comandos que um botao chama e a leitura do resultado de cada um. Botao so existe
// quando o nucleo declara a acao com `disponivel`, e o argv sai sempre daqui, nunca do texto que veio no JSON: a Pista
// so publica pelo `ork ship publicar` (que so age em #Auto e #Maestro) e so registra pelo `ork ship registrar-pr`.
import type { PistaAcao, PistaLinha } from '../types'
import { exigirThread, jsonDaSaida, umaLinha } from './pista'
import type { SaidaDoProcesso } from './pista'

export type AcaoDoBotao = PistaAcao['acao']

/** O rotulo de cada botao no painel. */
export const ROTULO_DO_BOTAO: Readonly<Record<AcaoDoBotao, string>> = { publicar: 'Publicar', registrar: 'Registrar a entrega' }

/** O argv do `ork ship publicar`, sem flag de autorizacao: quem decide se o modo autoriza o push e o nucleo. */
export function argvDoPublicar(thread: string): string[] {
  return ['ork', 'ship', 'publicar', exigirThread(thread), '--json']
}

/** O argv do `ork ship registrar-pr` da thread: o nucleo confere o merge na base e o CI antes de gravar o `ship_done`. */
export function argvDoRegistro(thread: string): string[] {
  return ['ork', 'ship', 'registrar-pr', exigirThread(thread), '--json']
}

/**
 * O botao da pista (D6): so `publicar`, no modo que ja autoriza o push, e `registrar`, e so quando o nucleo os declara
 * disponiveis. Fora disso, nenhum botao: o proximo passo fica como texto, com o comando para o dono.
 */
export function botaoDaPista(l: PistaLinha): AcaoDoBotao | null {
  if (!l.proximo.disponivel) return null
  if (l.proximo.acao === 'publicar') return l.publicavel ? 'publicar' : null
  if (l.proximo.acao === 'registrar') return 'registrar'
  return null
}

export type ResultadoDoBotao = { estado: 'feita' | 'recusada' | 'falhou'; texto: string }

const curto = (sha: unknown) => (typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : '-')
const texto = (v: unknown, teto = 300) => (typeof v === 'string' ? umaLinha(v, teto) : '')

/** O resultado do `ork ship publicar --json` (`ork.ship-publicar/v1`), numa linha para o painel. */
export function lerPublicacao(saida: SaidaDoProcesso): ResultadoDoBotao {
  const r = jsonDaSaida(saida, 'ork ship publicar') as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || r.contrato !== 'ork.ship-publicar/v1') {
    return { estado: 'falhou', texto: 'a saída do ork ship publicar não é o contrato ork.ship-publicar/v1' }
  }
  const pr = (r.pr ?? null) as { numero?: unknown; criado?: unknown } | null
  const numero = pr && Number.isSafeInteger(pr.numero) ? `PR #${pr.numero as number}` : 'sem PR'
  if (r.acao === 'publicou') {
    return { estado: 'feita', texto: `publicada no HEAD ${curto(r.head)}, push provado pelo ls-remote; ${numero} ${pr?.criado === true ? 'aberto agora' : 'reaproveitado'}` }
  }
  if (r.acao === 'ja-publicada') {
    return { estado: 'feita', texto: `já estava publicada no HEAD ${curto(r.head)}; ${numero}${texto(r.correcao) ? `; ${texto(r.correcao)}` : ''}` }
  }
  if (r.acao === 'recusada') {
    const correcao = texto(r.correcao, 400)
    return { estado: 'recusada', texto: `recusada (${texto(r.motivo, 60) || 'sem motivo'}): ${texto(r.detalhe) || 'sem detalhe'}${correcao ? `; ${correcao}` : ''}` }
  }
  return { estado: 'falhou', texto: `o ork ship publicar respondeu ${texto(r.acao, 40) || 'sem ação'}` }
}

/** O resultado do `ork ship registrar-pr <thread> --json` (uma lista de entregas), numa linha para o painel. */
export function lerRegistro(saida: SaidaDoProcesso, thread: string): ResultadoDoBotao {
  const lista = jsonDaSaida(saida, 'ork ship registrar-pr')
  const item = Array.isArray(lista) ? (lista as Array<Record<string, unknown> | null>).find(x => x?.thread === thread) : undefined
  if (!item) return { estado: 'falhou', texto: `o ork ship registrar-pr não respondeu pela thread ${thread}` }
  const motivo = texto(item.motivo) || 'sem motivo'
  if (item.acao === 'registrou') return { estado: 'feita', texto: `ship_done registrado: ${motivo}` }
  if (item.acao === 'ja-registrada') return { estado: 'feita', texto: `a entrega já estava registrada: ${motivo}` }
  if (item.acao === 'sem-merge' || item.acao === 'recusada') return { estado: 'recusada', texto: `${String(item.acao)}: ${motivo}` }
  return { estado: 'falhou', texto: `o ork ship registrar-pr respondeu ${texto(item.acao, 40) || 'sem ação'}` }
}
