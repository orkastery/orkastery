// O Freio de Lote (RM-059, fatia F2). Na sessao de fase, acha as claims que o lote de ferramentas mexeu, pede
// ao nucleo a conferencia delas no sandbox do verify (`ork claims conferir`) e devolve o que quebrou no lote
// seguinte. Nunca para o laco agentico, nunca roda comando de claim, nunca grava estado de claim e nunca fala
// pelo dono. A logica fica nos modulos puros ao lado; aqui so as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { FreioCarga } from '../types'
import {
  argsDaFerramenta, cargaVazia, claimsDoNucleo, FERRAMENTA_DAS_CLAIMS, FERRAMENTA_DO_PLANO, jsonDoMcp, SERVIDOR,
  statusNoRetrato, textoDoPlano, touchPathsDoPlano,
} from './carga'

const CARGA = { plugin: 'ork-freio', key: 'carga' } as const
const TENTATIVAS_DE_ESCRITA = 5

/** A sessao de fase com thread, pelo contexto da ponte; qualquer outra sessao fica sem Freio (D10). */
type ContextoDeFase = { thread: string; raiz: string }

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro)).slice(0, 300)

async function contextoDeFase($: EngineInterface): Promise<ContextoDeFase | null> {
  const ctx = await $.ork.contexto()
  return ctx.papel === 'fase' && ctx.thread ? { thread: ctx.thread, raiz: ctx.raiz } : null
}

/** Grava a carga com `ifVersion`, aplicando `mudar` sobre a versao mais nova (como a ponte faz com a faixa). */
async function atualizarCarga($: EngineInterface, thread: string, mudar: (atual: FreioCarga) => FreioCarga): Promise<FreioCarga> {
  for (let i = 0; i < TENTATIVAS_DE_ESCRITA; i++) {
    const lida = await $.state.get(CARGA)
    const atual = lida.value && lida.value.thread === thread ? lida.value : cargaVazia(thread)
    const nova = mudar(atual)
    const escrita = await $.state.set(CARGA, nova, { ifVersion: lida.version })
    if (escrita.isSet) return nova
  }
  throw new Error('ork-freio: a carga nao foi guardada')
}

/**
 * A carga (T2.1): o estado da thread pelo retrato da ponte, as claims e o plano pelas duas ferramentas de
 * leitura do nucleo (D2). Cada parte falha sozinha e fica para a proxima leitura.
 */
async function carregar($: EngineInterface, ctx: ContextoDeFase, partes: { retrato: boolean; claims: boolean; plano: boolean }): Promise<FreioCarga> {
  const agora = await $.clock.now()
  const erros: string[] = []
  let status: string | null | undefined
  let claims: FreioCarga['claims'] | undefined
  let touchPaths: string[] | null = null
  let planoLido = false
  if (partes.retrato) {
    try {
      status = statusNoRetrato((await $.ork.retrato({ thread: ctx.thread })).retrato, ctx.thread)
    } catch (erro) { erros.push(`retrato: ${mensagem(erro)}`) }
  }
  if (partes.claims) {
    try {
      const r = await $.mcp.call(SERVIDOR, FERRAMENTA_DAS_CLAIMS, argsDaFerramenta(FERRAMENTA_DAS_CLAIMS, ctx.thread))
      claims = claimsDoNucleo(jsonDoMcp(r, FERRAMENTA_DAS_CLAIMS))
    } catch (erro) { erros.push(`claims: ${mensagem(erro)}`) }
  }
  if (partes.plano) {
    try {
      const r = await $.mcp.call(SERVIDOR, FERRAMENTA_DO_PLANO, argsDaFerramenta(FERRAMENTA_DO_PLANO, ctx.thread))
      touchPaths = touchPathsDoPlano(textoDoPlano(jsonDoMcp(r, FERRAMENTA_DO_PLANO)))
      planoLido = true
    } catch (erro) { erros.push(`plano: ${mensagem(erro)}`) }
  }
  return atualizarCarga($, ctx.thread, atual => ({
    ...atual,
    ...(status !== undefined ? { statusDaThread: status } : {}),
    ...(claims !== undefined ? { claims, claimsEm: agora } : {}),
    ...(planoLido ? { touchPaths, planoLido: true, planoEm: agora } : {}),
    erros,
  }))
}

export const register: Register = on => {
  // A carga roda fora do inicio da sessao: o MCP pode ainda estar conectando, e o inicio nao espera por ela.
  // O `session.start` dispara de novo num reload, e a carga refaz a leitura do mesmo jeito (D10).
  on('session.start', async ($, e, next) => {
    const iniciada = await next(e)
    try {
      const ctx = await contextoDeFase($)
      if (ctx) {
        $.clock.after(0, () => {
          void carregar($, ctx, { retrato: true, claims: true, plano: true }).catch(() => undefined)
        })
      }
    } catch { /* sem a ponte, o Freio fica dormente */ }
    return iniciada
  })
}
