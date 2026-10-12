// A rede e a linha da faixa na Torre de Controle (RM-059, fatia F1, T1.3; D9 e D11 da thread). O retrato do
// nucleo nao le outras maquinas (`notConsulted` do `ork_maestro`): as threads delas vem do panorama da rede
// (`ork_network_roadmap`, contrato `ork.network-roadmap/v1`), lido so quando o dono pede ou, com o painel a
// vista, no maximo a cada 10 min. Lacuna nunca vira "vazio", e thread que esta aberta aqui nao se repete. A
// linha da faixa resume o quadro numa linha so, e a ponte a desenha. Modulo puro.
import type { TorreLinhaDaRede, TorreQuadro, TorreRede } from '../types'

export const CONTRATO_DA_REDE = 'ork.network-roadmap/v1'
/** Com o painel a vista, a rede e relida no maximo neste intervalo; o botao le na hora. */
export const PERIODO_DA_REDE_MS = 600000
export const TETO_DE_LINHAS_DA_REDE = 30
/** O mesmo teto que a ponte aplica ao texto de cada linha da faixa. */
export const TETO_DO_TEXTO_DA_FAIXA = 200

const ID_DE_THREAD = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

function lista(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
}

/**
 * As threads ativas das outras maquinas, lidas do panorama da rede que o `ork_network_roadmap` devolve
 * (`{ texto, panorama }`). Entra so maquina que nao e esta e cujas threads foram lidas; thread aberta aqui
 * (`locais`) ou repetida em outra maquina entra uma vez so. As lacunas do panorama sao contadas, nunca
 * escondidas.
 */
export function redeDoPanorama(resposta: unknown, locais: readonly string[], agora: number): TorreRede {
  const panorama = (resposta as { panorama?: unknown } | null)?.panorama as Record<string, unknown> | null | undefined
  if (!panorama || panorama.contrato !== CONTRATO_DA_REDE || !Array.isArray(panorama.projetos)) {
    throw new Error('o panorama da rede veio fora do contrato')
  }
  const vistas = new Set(locais)
  const linhas: TorreLinhaDaRede[] = []
  let maquinas = 0
  let lacunas = lista(panorama.lacunas).length
  for (const projeto of lista(panorama.projetos)) {
    lacunas += lista(projeto.lacunas).length
    for (const m of lista(projeto.maquinas)) {
      if (m.estaMaquina === true || m.threadsLidas !== true) continue
      maquinas++
      for (const t of lista(m.ativas)) {
        if (typeof t.id !== 'string' || !ID_DE_THREAD.test(t.id) || vistas.has(t.id) || t.status === 'fechada') continue
        vistas.add(t.id)
        linhas.push({
          thread: t.id,
          maquina: typeof m.maquina === 'string' ? m.maquina : '?',
          fase: typeof t.fase === 'string' ? t.fase : '?',
          modo: typeof t.modo === 'string' ? t.modo : '',
          esperaVoce: t.esperaVoce === true,
          pergunta: typeof t.pergunta === 'string' && t.pergunta.trim() !== '' ? t.pergunta.trim() : null,
          idadeMin: typeof m.idadeMin === 'number' && Number.isFinite(m.idadeMin) ? Math.max(0, Math.round(m.idadeMin)) : null,
          semBatida: m.semBatida === true,
        })
      }
    }
  }
  linhas.sort((a, b) => Number(b.esperaVoce) - Number(a.esperaVoce) || (a.maquina < b.maquina ? -1 : a.maquina > b.maquina ? 1 : 0) ||
    (a.thread < b.thread ? -1 : a.thread > b.thread ? 1 : 0))
  return { lidoEm: agora, linhas: linhas.slice(0, TETO_DE_LINHAS_DA_REDE), maquinas, lacunas, erro: null }
}

/** A leitura que falhou guarda o que havia e diz o motivo. */
export function redeComErro(anterior: TorreRede | null | undefined, erro: string): TorreRede {
  return { lidoEm: anterior?.lidoEm ?? null, linhas: anterior?.linhas ?? [], maquinas: anterior?.maquinas ?? 0,
    lacunas: anterior?.lacunas ?? 0, erro }
}

function cortar(texto: string, teto: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length <= teto ? limpo : `${limpo.slice(0, teto - 1)}…`
}

/**
 * A linha da faixa (D9): as threads abertas e o que pede acao primeiro (quem espera o dono e as paradas,
 * com a primeira de cada), a rede quando lida e o aviso de lista velha. Sem quadro lido, nenhuma linha (a
 * faixa fica com os outros).
 */
export function textoDaFaixa(q: TorreQuadro, rede: TorreRede | null): string | undefined {
  if (q.lidoEm === null) return undefined
  const total = q.linhas.length + q.omitidas
  const partes = [total === 0 ? 'nenhuma thread aberta nesta máquina' : total === 1 ? '1 thread aberta' : `${total} threads abertas`]
  const espera = q.linhas.filter(l => l.estado === 'espera-voce')
  const paradas = q.linhas.filter(l => l.estado === 'parada')
  const andando = q.linhas.filter(l => l.estado === 'andando').length
  if (espera.length) partes.push(`${espera.length} ${espera.length === 1 ? 'espera' : 'esperam'} você (${espera[0]?.thread})`)
  if (paradas.length) {
    const p = paradas[0]
    partes.push(`${paradas.length} ${paradas.length === 1 ? 'parada' : 'paradas'} (${p?.thread}: ${p?.bloqueio?.frase ?? '?'})`)
  }
  if (!espera.length && !paradas.length && andando) partes.push(`${andando} andando`)
  if (rede && rede.lidoEm !== null) {
    const esperaNaRede = rede.linhas.filter(l => l.esperaVoce).length
    partes.push(`rede: ${rede.linhas.length} em outras máquinas${esperaNaRede ? `, ${esperaNaRede} espera você` : ''}`)
  }
  if (q.erro) partes.push('lista não relida')
  return cortar(partes.join(' · '), TETO_DO_TEXTO_DA_FAIXA)
}
