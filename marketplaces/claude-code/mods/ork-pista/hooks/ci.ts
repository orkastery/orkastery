// O CI de cada pista (RM-059, fatia F7, T7.4; D7 da thread ork-rm059pista). Modulo puro: o argv da consulta ao nucleo
// (`ork ci status --sha <sha> --json`, contrato `ork.ci-status/v2`; a v1 dos nucleos anteriores continua lida), a
// leitura dela, as pistas que um evento do GitHub cita, as que o relogio de reserva consulta e a etapa de CI que o
// painel mostra com a leitura mais nova. O evento so dispara a consulta: o conteudo dele nunca vira estado, e quem diz o
// CI e o check do nucleo no sha exato.
import type { PistaCi, PistaEstadoDaEtapa, PistaLinha, PistaQuadro } from '../types'
import { jsonDaSaida, umaLinha } from './pista'
import type { SaidaDoProcesso } from './pista'

/** A reserva sem evento: a cada 2 min com o painel a vista, a cada 10 min escondido. */
export const INTERVALO_DO_CI_A_VISTA_MS = 2 * 60000
export const INTERVALO_DO_CI_ESCONDIDO_MS = 10 * 60000
const SHA = /^[0-9a-f]{40}$/
const ESTADOS: readonly PistaCi['estado'][] = ['success', 'pending', 'failure', 'missing', 'unavailable', 'disabled']

/** O argv da consulta do CI no sha exato do head do PR, nunca por ref nem prefixo. */
export function argvDoCi(sha: string): string[] {
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('ork-pista: sha invalido para o ork ci status')
  return ['ork', 'ci', 'status', '--sha', sha, '--json']
}

/** Os contratos do `ork ci status --json` que a Pista le: a v2 (forja, fonte e produtor) e a v1 de antes. */
const CONTRATOS_DO_CI: readonly string[] = ['ork.ci-status/v1', 'ork.ci-status/v2']

/**
 * A saida do `ork ci status --sha <sha> --json`: o comando sai 0 so com o check verde, e o JSON vem nos dois casos.
 * Leitura de outro sha nao vale para a pista.
 */
export function lerCi(saida: SaidaDoProcesso, sha: string, agora: number, motivo: PistaCi['motivo']): PistaCi {
  const r = jsonDaSaida(saida, 'ork ci status') as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || !CONTRATOS_DO_CI.includes(r.schema as string) || !ESTADOS.includes(r.state as PistaCi['estado'])) {
    throw new Error('a saída do ork ci status não é o contrato ork.ci-status (v1 ou v2)')
  }
  if (r.sha !== sha) throw new Error(`o ork ci status respondeu pelo commit ${umaLinha(r.sha, 40)}, e não pelo head ${sha.slice(0, 7)}`)
  const estado = r.state as PistaCi['estado']
  const contexto = typeof r.context === 'string' && r.context ? umaLinha(r.context, 60) : 'ork-verify'
  const curto = sha.slice(0, 7)
  const texto = estado === 'success' ? `check ${contexto} verde no head ${curto}`
    : estado === 'failure' ? `check ${contexto} vermelho no head ${curto}`
    : estado === 'pending' ? `check ${contexto} em andamento no head ${curto}`
    : estado === 'missing' ? `o check ${contexto} ainda não apareceu no head ${curto}`
    : estado === 'disabled' ? 'CI não exigido pelo manifesto'
    : `o CI não foi lido: ${umaLinha(r.detail, 160) || 'sem detalhe'}`
  const url = typeof r.url === 'string' && /^https:\/\/\S+$/.test(r.url) ? umaLinha(r.url, 300) : null
  return { sha, estado, texto, url, lidoEm: agora, motivo }
}

/** A pista com PR aberto cujo CI a leitura da pista ainda nao fechou (nem verde nem vermelho). */
export function precisaDoCi(l: PistaLinha): boolean {
  const etapa = l.etapas.find(e => e.id === 'ci')
  return l.pr?.estado === 'aberto' && SHA.test(l.pr.head) && (etapa?.estado === 'pendente' || etapa?.estado === 'nao-lida')
}

/** As pistas que o relogio de reserva consulta agora: as que precisam, sem leitura do head atual dentro do intervalo. */
export function vencidasDoCi(linhas: readonly PistaLinha[], ci: Readonly<Record<string, PistaCi>>, agora: number, intervalo: number): string[] {
  return linhas.filter(l => {
    if (!precisaDoCi(l)) return false
    const lido = ci[l.thread]
    return !lido || lido.sha !== l.pr?.head || agora - lido.lidoEm >= intervalo
  }).map(l => l.thread)
}

/**
 * As pistas que um evento do GitHub cita, so pelos campos que o servidor assere (fora de `untrustedKeys`): o PR (o
 * numero, ou `dono/repo#N`), a branch ou o sha. Evento de outra fonte, ou que nao cita pista nenhuma, nao consulta nada.
 */
export function pistasDoEvento(evento: unknown, linhas: readonly PistaLinha[]): string[] {
  if (!evento || typeof evento !== 'object') return []
  const e = evento as { source?: unknown; data?: unknown; untrustedKeys?: unknown }
  if (e.source !== 'github' || !e.data || typeof e.data !== 'object') return []
  const deTerceiros = new Set(Array.isArray(e.untrustedKeys) ? e.untrustedKeys.map(String) : [])
  const numeros = new Set<number>()
  const textos = new Set<string>()
  for (const [chave, valor] of Object.entries(e.data as Record<string, unknown>)) {
    if (deTerceiros.has(chave)) continue
    if (typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0 && /^(pr|number|pull_request|pull)$/i.test(chave)) numeros.add(valor)
    if (typeof valor !== 'string') continue
    const pr = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#(\d{1,9})$/.exec(valor.trim()) ?? (/^(pr|number|pull_request|pull)$/i.test(chave) ? /^#?(\d{1,9})$/.exec(valor.trim()) : null)
    if (pr) numeros.add(Number(pr[1]))
    textos.add(valor.trim())
  }
  return linhas.filter(l => (l.pr && numeros.has(l.pr.numero)) || textos.has(l.branch) || (!!l.head && textos.has(l.head)) ||
    (!!l.pr && textos.has(l.pr.head))).map(l => l.thread)
}

const ETAPA_DO_CI: Readonly<Record<PistaCi['estado'], PistaEstadoDaEtapa>> = {
  success: 'feita', failure: 'falhou', pending: 'pendente', missing: 'pendente', unavailable: 'nao-lida', disabled: 'nao-se-aplica',
}

/** A consulta leu o check no head: `unavailable` (a consulta falhou) e `disabled` (o CI nao e exigido) nao leram nada. */
function leuOCheck(lido: PistaCi): boolean {
  return lido.estado !== 'unavailable' && lido.estado !== 'disabled'
}

/**
 * A pista com a leitura do CI mais nova por cima da etapa da leitura da pista, so quando ela e do head do PR aberto. A
 * consulta que nao leu nada nunca apaga o que o nucleo ja leu: a etapa fica como o nucleo disse, com a falha ao lado.
 */
export function comCi(q: PistaQuadro, ci: Readonly<Record<string, PistaCi>>): PistaQuadro {
  return {
    ...q,
    linhas: q.linhas.map(l => {
      const lido = ci[l.thread]
      if (!lido || l.pr?.estado !== 'aberto' || lido.sha !== l.pr.head) return l
      if (!leuOCheck(lido)) {
        return { ...l, etapas: l.etapas.map(e => (e.id === 'ci' ? { ...e, texto: `${e.texto} (consulta: ${lido.texto})` } : e)) }
      }
      const origem = lido.motivo === 'evento' ? ' (pelo evento do GitHub)' : ''
      return { ...l, etapas: l.etapas.map(e => (e.id === 'ci' ? { id: 'ci', estado: ETAPA_DO_CI[lido.estado], texto: `${lido.texto}${origem}` } : e)) }
    }),
  }
}

/**
 * A leitura nova diz do CI outra coisa que a etapa da pista: o CI fechou, ou mudou depois de uma rodada nova. O proximo
 * passo do nucleo muda com ele, e a pista inteira e relida. A consulta que nao leu nada nao muda nada.
 */
export function mudouOCi(l: PistaLinha, lido: PistaCi): boolean {
  if (!leuOCheck(lido) || l.pr?.estado !== 'aberto' || lido.sha !== l.pr.head) return false
  return l.etapas.find(e => e.id === 'ci')?.estado !== ETAPA_DO_CI[lido.estado]
}
