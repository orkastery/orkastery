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
  soLeitura, TETO_DE_STAT, TETO_DO_STATUS_MS, textoDoFora, tomarFora, vigiaVazia,
} from './lote'
import type { Chamada } from './lote'
import {
  acumular, argvDaConferencia, ESPERA_DO_FIM_MS, fecharRodada, iniciarRodada, lerConferencia, limitarTexto, precisaDeLaco,
  TETO_POR_RODADA, textoDaEntrega, textoDoStatus, tomarEntrega, VIGIA_DA_CONFERENCIA_MS,
} from './conferencia'
import type { Leitura } from './conferencia'

const CARGA = { plugin: 'ork-freio', key: 'carga' } as const
const VIGIA = { plugin: 'ork-freio', key: 'vigia' } as const
const TENTATIVAS_DE_ESCRITA = 5
/**
 * O laco de conferencia desta carga do modulo esta rodando (D10). Fica no modulo, nao no `$.state`: uma troca do
 * worker mata o laco junto com a marca, e a rodada que ficou aberta no estado e retomada pelo laco seguinte.
 */
let rodando = false

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
    // Sem lock opcional: o `git status` do Freio nunca segura o `index.lock` que um commit do modelo precisa.
    r = await $.process.run(ARGV_DO_STATUS, { cwd: raiz, timeoutMs: TETO_DO_STATUS_MS, env: { GIT_OPTIONAL_LOCKS: '0' } })
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

/**
 * Uma rodada no nucleo (D6): `ork claims conferir` por `$.process.spawn`, na raiz da sessao, com o vigia do mod.
 * O processo que nao abre e a saida fora do formato viram conferencia indisponivel (D7).
 */
async function rodarConferencia($: EngineInterface, ctx: ContextoDeFase, ids: readonly string[]): Promise<Leitura> {
  let stdout = ''
  let stderr = ''
  let vigia: { cancel: () => void } | undefined
  try {
    const fluxo = $.process.spawn({ argv: argvDaConferencia(ctx.thread, ids), cwd: ctx.raiz })
    const lido = (async () => {
      for await (const pedaco of fluxo) {
        if (pedaco.stream === 'stdout') stdout = acumular(stdout, pedaco.text, false)
        else stderr = acumular(stderr, pedaco.text, true)
      }
      return fluxo.result
    })()
    lido.catch(() => undefined)
    const vencido = new Promise<'vencido'>(resolver => { vigia = $.clock.after(VIGIA_DA_CONFERENCIA_MS, () => resolver('vencido')) })
    const fim = await Promise.race([lido, vencido])
    if (fim === 'vencido') {
      // Encerra o processo e espera ele fechar (com teto), para a rodada seguinte nao correr junto com ele.
      void fluxo.return(undefined as never).catch(() => undefined)
      await Promise.race([lido.catch(() => undefined), new Promise(resolver => { $.clock.after(ESPERA_DO_FIM_MS, () => resolver(undefined)) })])
      return { tipo: 'prazo' }
    }
    return lerConferencia(stdout, fim.code, stderr)
  } catch (erro) {
    return { tipo: 'indisponivel', motivo: `ork claims conferir nao rodou: ${mensagem(erro)}` }
  } finally {
    vigia?.cancel()
  }
}

/** As claims ativas da carga, para a rodada nao levar claim retirada ou desconhecida; `null` sem lista lida. */
async function claimsAtivas($: EngineInterface, ctx: ContextoDeFase): Promise<string[] | null> {
  const carga = (await $.state.get(CARGA)).value
  return carga && carga.thread === ctx.thread && carga.claims ? carga.claims.map(c => c.id) : null
}

/**
 * O laco de fundo (T2.3): uma rodada por vez, ate a fila acabar, a pausa chegar ou a conferencia faltar. A recusa
 * de uma claim so rele as claims e segue com as outras; a conducao alheia pausa um minuto.
 */
async function conferirEmLaco($: EngineInterface, ctx: ContextoDeFase): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    for (;;) {
      const agora = await $.clock.now()
      const ativas = await claimsAtivas($, ctx)
      const { vigia } = await atualizarVigia($, ctx.thread, v => ({ vigia: iniciarRodada(v, agora, TETO_POR_RODADA, ativas), extra: null }))
      if (!vigia.rodada) break
      $.ui.status(textoDoStatus(vigia, agora))
      const leitura = await rodarConferencia($, ctx, vigia.rodada.ids)
      const depois = await $.clock.now()
      const fechada = await atualizarVigia($, ctx.thread, v => ({ vigia: fecharRodada(v, leitura, depois), extra: null }))
      $.ui.status(textoDoStatus(fechada.vigia, depois))
      if (leitura.tipo === 'recusada') await carregar($, ctx, { retrato: false, claims: true, plano: false })
      if (leitura.tipo === 'indisponivel' || leitura.tipo === 'ocupada') break
    }
  } finally {
    rodando = false
  }
}

/** Abre o laco fora do despacho do lote, por `$.clock.after`; o laco que ja roda pega a fila nova. */
function pedirConferencia($: EngineInterface, ctx: ContextoDeFase): void {
  if (rodando) return
  $.clock.after(0, () => { void conferirEmLaco($, ctx).catch(() => undefined) })
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

  // O lote (T2.2 e T2.3): devolve o que a conferencia apurou desde o lote anterior, acha os arquivos tocados e as
  // claims afetadas, pede a conferencia ao nucleo e avisa os `touch_paths`. Responde so com `additionalContext` e
  // nunca para o laco: na sessao de fundo nao ha quem o retome. Falha deixa o lote passar. O lote de subagente
  // (`agent_id`) conta os toques, mas a entrega e o aviso ficam para o lote do laco principal, que e quem os le.
  on('classic.PostToolBatch', async ($, e, next) => {
    const resultado = await next(e)
    const ctx = await contextoDeFase($)
    if (!ctx) return resultado
    let carga = (await $.state.get(CARGA)).value
    if (carga && carga.thread === ctx.thread && !threadAtiva(carga.statusDaThread)) return resultado
    const chamadas: Chamada[] = Array.isArray(e.tool_calls) ? e.tool_calls : []
    const doSubagente = typeof e.agent_id === 'string' && e.agent_id !== ''
    const doLote = caminhosDoLote(chamadas, ctx.raiz)
    const foto = soLeitura(chamadas) ? null : await fotografar($, ctx.raiz)
    const mexeu = doLote.length > 0 || foto !== null
    // O lote que mexeu nas claims ou no plano rele na hora; a lista velha so e relida quando ha caminho para casar.
    const lida = (await $.state.get(VIGIA)).value
    const anterior = lida && lida.thread === ctx.thread ? lida.foto : null
    const previstos = doLote.length + (foto ? diferenca(anterior, foto).length : 0)
    const nasClaims = mexeuNasClaims(chamadas)
    const noPlano = mexeuNoPlano(chamadas)
    if (previstos > 0 || nasClaims || noPlano) {
      const agora = await $.clock.now()
      const atual = carga && carga.thread === ctx.thread ? carga : cargaVazia(ctx.thread)
      const relerClaims = nasClaims || (previstos > 0 && claimsVelhas(atual, agora, false))
      const relerPlano = noPlano || (previstos > 0 && planoVelho(atual, agora, false))
      if (relerClaims || relerPlano) carga = await carregar($, ctx, { retrato: false, claims: relerClaims, plano: relerPlano })
    }
    const lote = { foto, doLote, claims: carga?.thread === ctx.thread ? carga.claims : null, touchPaths: carga?.thread === ctx.thread ? carga.touchPaths : null }
    const { vigia, extra } = await atualizarVigia($, ctx.thread, v => {
      const aplicada = mexeu ? aplicarLote(v, lote).vigia : v
      if (doSubagente) return { vigia: aplicada, extra: { entrega: null, fora: [] as string[] } }
      const f = tomarFora(aplicada)
      const t = tomarEntrega(f.vigia)
      return { vigia: t.vigia, extra: { entrega: t.entrega, fora: f.fora } }
    })
    // A rodada que ficou aberta no estado (o laco morreu com o worker) e retomada como a fila.
    if (precisaDeLaco(vigia)) pedirConferencia($, ctx)
    $.ui.status(textoDoStatus(vigia, await $.clock.now()))
    const partes = [extra.entrega ? textoDaEntrega(extra.entrega) : '', textoDoFora(extra.fora)].filter(t => t !== '')
    const texto = limitarTexto(partes.join('\n'))
    return texto ? { ...resultado, additionalContext: [...(resultado.additionalContext ?? []), texto] } : resultado
  }).catch(($, e, next) => next(e))
}
