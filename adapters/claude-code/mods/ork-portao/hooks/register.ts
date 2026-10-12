// O Portão de Tarefas (RM-059, fatia F10). Na sessão de fase do GO, o quadro de tarefas do Claude Code é o do
// plano: a tarefa nativa só entra apontando uma tarefa do plano com `touch_paths` e verify que o núcleo confere
// (T10.1). O Portão lê o núcleo pelo `$.ork` da ponte e pela ferramenta de leitura do plano, nunca o estado interno
// do disco, e nunca fala pelo dono. A lógica fica nos módulos puros ao lado; aqui só as chamadas ao `$`, sempre
// escritas como `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { PortaoQuadro, PortaoTarefa } from '../types'
import {
  argsDoPlano, decidirCriacao, escopoDoPlano, escopoDoRetrato, FERRAMENTA_DO_PLANO, IDADE_DO_PLANO_MS, IDADE_SEM_PLANO_MS,
  jsonDoMcp, SERVIDOR, tarefasDoPlano, textoDaRecusa, textoDoPlano, threadNoRetrato,
} from './plano'

const QUADRO = { plugin: 'ork-portao', key: 'quadro' } as const

/**
 * O quadro desta carga do módulo (D9 do plano da thread): lido do `$.state` uma vez por thread e gravado sem versão a
 * cada mudança. Uma segunda gravação com `ifVersion` no mesmo despacho nunca acertaria.
 */
let quadro: PortaoQuadro | null = null
/** O plano lido e quando, por thread; relido depois da idade (D3). */
let plano: { thread: string; em: number; tarefas: PortaoTarefa[] | null } | null = null

/** A sessão de fase com thread, pelo contexto da ponte; qualquer outra sessão fica sem Portão (D1). */
type ContextoDeFase = { thread: string; raiz: string }
/** O Portão age nesta sessão: o contexto e as tarefas do plano. */
type Ativo = { ctx: ContextoDeFase; tarefas: PortaoTarefa[] }

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro)).slice(0, 300)

function quadroVazio(thread: string): PortaoQuadro {
  return { thread, tarefas: {}, ultimaFalha: null }
}

async function contextoDeFase($: EngineInterface): Promise<ContextoDeFase | null> {
  const ctx = await $.ork.contexto()
  return ctx.papel === 'fase' && ctx.thread ? { thread: ctx.thread, raiz: ctx.raiz } : null
}

async function lerQuadro($: EngineInterface, thread: string): Promise<PortaoQuadro> {
  if (quadro && quadro.thread === thread) return quadro
  const lido = (await $.state.get(QUADRO)).value
  quadro = lido && lido.thread === thread ? { ...quadroVazio(thread), ...lido } : quadroVazio(thread)
  return quadro
}

async function gravarQuadro($: EngineInterface, novo: PortaoQuadro): Promise<void> {
  quadro = novo
  await $.state.set(QUADRO, novo)
}

/** As tarefas do plano pela ferramenta de leitura do núcleo, com a idade da D3; erro sobe para quem chamou. */
async function lerTarefas($: EngineInterface, ctx: ContextoDeFase): Promise<PortaoTarefa[] | null> {
  const agora = await $.clock.now()
  if (plano && plano.thread === ctx.thread) {
    const idade = agora - plano.em
    const teto = plano.tarefas && plano.tarefas.length > 0 ? IDADE_DO_PLANO_MS : IDADE_SEM_PLANO_MS
    if (idade >= 0 && idade < teto) return plano.tarefas
  }
  const r = await $.mcp.call(SERVIDOR, FERRAMENTA_DO_PLANO, argsDoPlano(ctx.thread))
  const tarefas = tarefasDoPlano(textoDoPlano(jsonDoMcp(r, FERRAMENTA_DO_PLANO)))
  plano = { thread: ctx.thread, em: agora, tarefas }
  return tarefas
}

/**
 * O Portão age nesta sessão (D1): papel `fase` com thread, thread não fechada e GO no bloco pelo retrato da ponte,
 * e plano legível com tarefas. O retrato que falha conta como GO e aberta, e fica na linha de status.
 */
async function portaoAtivo($: EngineInterface): Promise<Ativo | null> {
  const ctx = await contextoDeFase($)
  if (!ctx) return null
  let retrato: { status: string | null; bloco: string | null } | null
  try {
    retrato = threadNoRetrato((await $.ork.retrato({ thread: ctx.thread })).retrato, ctx.thread)
  } catch {
    retrato = null
  }
  const doRetrato = escopoDoRetrato(retrato)
  if (!doRetrato.ativo) return null
  let tarefas: PortaoTarefa[] | null
  try {
    tarefas = await lerTarefas($, ctx)
  } catch (erro) {
    await anotarFalha($, 'leitura do plano', erro, ctx.thread)
    return null
  }
  if (!escopoDoPlano(tarefas).ativo || !tarefas) return null
  if (doRetrato.avisos.length > 0) $.ui.status(`portão: ${doRetrato.avisos.join('; ')}`)
  return { ctx, tarefas }
}

/**
 * Guarda a falha do próprio Portão no quadro e a diz uma vez no transcript (não vai ao modelo) e na linha de
 * status: nenhuma captura fica muda.
 */
async function anotarFalha($: EngineInterface, onde: string, erro: unknown, thread?: string): Promise<void> {
  const motivo = mensagem(erro)
  $.ui.status(`portão: falhou em ${onde}`)
  const atual = thread ? await lerQuadro($, thread) : quadro
  if (atual && atual.ultimaFalha?.onde === onde && atual.ultimaFalha.motivo === motivo) return
  $.ui.log(`Portão de Tarefas: falhou em ${onde}: ${motivo}`)
  if (atual) await gravarQuadro($, { ...atual, ultimaFalha: { onde, motivo, em: await $.clock.now() } })
}

export const register: Register = on => {
  // A criação (T10.1): a tarefa nativa só entra apontando uma tarefa do plano que serve ao quadro (D2, D3). A recusa
  // volta ao modelo pelo `block`, com o motivo e as tarefas que servem; a que passa fica registrada pelo id nativo.
  on('classic.TaskCreated', async ($, e, next) => {
    const ativo = await portaoAtivo($)
    if (!ativo) return next(e)
    const veredito = decidirCriacao(e.task_subject, ativo.tarefas)
    if (veredito.tipo === 'recusa') return { block: textoDaRecusa(veredito, e.task_subject, ativo.tarefas) }
    const q = await lerQuadro($, ativo.ctx.thread)
    await gravarQuadro($, { ...q, tarefas: { ...q.tarefas, [String(e.task_id)]: veredito.tarefa } })
    return next(e)
  }).catch(async ($, e, next) => {
    // Na reentrada o gancho nem rodou e as chamadas de `$` recusam: só a falha de verdade é anotada.
    if (next.error && next.error.kind !== 're-entry') await anotarFalha($, 'criação de tarefa', next.error.message ?? next.error.kind)
    return next(e)
  })
}
