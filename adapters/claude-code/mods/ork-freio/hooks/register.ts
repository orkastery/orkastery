// O Freio de Lote (RM-059, fatia F2). Na sessao de fase, acha as claims que o lote de ferramentas mexeu, pede
// ao nucleo a conferencia delas no sandbox do verify (`ork claims conferir`) e devolve o que quebrou no lote
// seguinte. Nunca para o laco agentico, nunca roda comando de claim, nunca grava estado de claim e nunca fala
// pelo dono. A logica fica nos modulos puros ao lado; aqui so as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { FreioCarga, FreioFoto, FreioVigia } from '../types'
import {
  argsDaFerramenta, cargaVazia, claimsDoNucleo, claimsVelhas, FERRAMENTA_DAS_CLAIMS, FERRAMENTA_DO_PLANO, jsonDoMcp,
  planoVelho, SERVIDOR, statusNoRetrato, textoDoPlano, threadAtiva, touchPathsDoPlano,
} from './carga'
import {
  aplicarLote, ARGV_DO_STATUS, assinatura, caminhosDoLote, diferenca, juntar, lerStatus, mexeuNasClaims, mexeuNoPlano,
  soLeitura, TETO_DE_STAT, TETO_DO_STATUS_MS, textoDoFora, vigiaVazia,
} from './lote'
import type { Chamada } from './lote'

const CARGA = { plugin: 'ork-freio', key: 'carga' } as const
const VIGIA = { plugin: 'ork-freio', key: 'vigia' } as const
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

/** Grava a vigia do mesmo jeito; `mudar` e pura e pode rodar de novo quando outra escrita passou na frente. */
async function atualizarVigia<T>($: EngineInterface, thread: string, mudar: (atual: FreioVigia) => { vigia: FreioVigia; extra: T }): Promise<{ vigia: FreioVigia; extra: T }> {
  for (let i = 0; i < TENTATIVAS_DE_ESCRITA; i++) {
    const lida = await $.state.get(VIGIA)
    const atual = lida.value && lida.value.thread === thread ? lida.value : vigiaVazia(thread)
    const r = mudar(atual)
    const escrita = await $.state.set(VIGIA, r.vigia, { ifVersion: lida.version })
    if (escrita.isSet) return r
  }
  throw new Error('ork-freio: a vigia nao foi guardada')
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

/** A foto do `git status` da worktree (D4), com o `stat` de cada caminho sujo ate o teto; `null` se o git falhar. */
async function fotografar($: EngineInterface, raiz: string): Promise<FreioFoto | null> {
  let r
  try {
    r = await $.process.run(ARGV_DO_STATUS, { cwd: raiz, timeoutMs: TETO_DO_STATUS_MS })
  } catch { return null }
  if (r.exitCode !== 0) return null
  const lido = lerStatus(r.stdout)
  const caminhos: Record<string, string> = {}
  for (let i = 0; i < lido.entradas.length; i++) {
    const entrada = lido.entradas[i] as { caminho: string; xy: string }
    const comStat = i < TETO_DE_STAT
    const stat = comStat ? await $.fs.stat(juntar(raiz, entrada.caminho)).catch(() => null) : null
    caminhos[entrada.caminho] = assinatura(entrada.xy, stat, comStat)
  }
  return { head: lido.head, caminhos }
}

/** A primeira foto, guardada so quando ainda nao ha foto (o reload nao apaga o que o lote anterior viu). */
async function primeiraFoto($: EngineInterface, ctx: ContextoDeFase): Promise<void> {
  const foto = await fotografar($, ctx.raiz)
  if (!foto) return
  await atualizarVigia($, ctx.thread, v => ({ vigia: v.foto ? v : { ...v, foto }, extra: null }))
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
          void (async () => {
            await carregar($, ctx, { retrato: true, claims: true, plano: true }).catch(() => undefined)
            await primeiraFoto($, ctx).catch(() => undefined)
          })()
        })
      }
    } catch { /* sem a ponte, o Freio fica dormente */ }
    return iniciada
  })

  // O lote (T2.2): os arquivos tocados, as claims afetadas na fila e o aviso de `touch_paths`. Responde so com
  // `additionalContext` e nunca para o laco: na sessao de fundo nao ha quem o retome. Falha deixa o lote passar.
  on('classic.PostToolBatch', async ($, e, next) => {
    const resultado = await next(e)
    const ctx = await contextoDeFase($)
    if (!ctx) return resultado
    let carga = (await $.state.get(CARGA)).value
    if (carga && carga.thread === ctx.thread && !threadAtiva(carga.statusDaThread)) return resultado
    const chamadas: Chamada[] = Array.isArray(e.tool_calls) ? e.tool_calls : []
    const doLote = caminhosDoLote(chamadas, ctx.raiz)
    const foto = soLeitura(chamadas) ? null : await fotografar($, ctx.raiz)
    if (doLote.length === 0 && !foto) return resultado
    // Claims e plano so sao relidos quando ha caminho tocado para casar com eles.
    const lida = (await $.state.get(VIGIA)).value
    const anterior = lida && lida.thread === ctx.thread ? lida.foto : null
    const previstos = doLote.length + (foto ? diferenca(anterior, foto).length : 0)
    if (previstos > 0) {
      const agora = await $.clock.now()
      const atual = carga && carga.thread === ctx.thread ? carga : cargaVazia(ctx.thread)
      const relerClaims = claimsVelhas(atual, agora, mexeuNasClaims(chamadas))
      const relerPlano = planoVelho(atual, agora, mexeuNoPlano(chamadas))
      if (relerClaims || relerPlano) carga = await carregar($, ctx, { retrato: false, claims: relerClaims, plano: relerPlano })
    }
    const lote = { foto, doLote, claims: carga?.thread === ctx.thread ? carga.claims : null, touchPaths: carga?.thread === ctx.thread ? carga.touchPaths : null }
    const { extra } = await atualizarVigia($, ctx.thread, v => {
      const r = aplicarLote(v, lote)
      return { vigia: r.vigia, extra: r }
    })
    const texto = textoDoFora(extra.fora)
    return texto ? { ...resultado, additionalContext: [...(resultado.additionalContext ?? []), texto] } : resultado
  }).catch(($, e, next) => next(e))
}
