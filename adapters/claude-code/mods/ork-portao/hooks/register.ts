// O Portão de Tarefas (RM-059, fatia F10). Na sessão de fase do GO, o quadro de tarefas do Claude Code é o do
// plano: a tarefa nativa só entra apontando uma tarefa do plano com `touch_paths` e verify que o núcleo confere
// (T10.1), só fecha com essa conferência aprovada (T10.2) e, com agent teams no piloto do núcleo, vai ao teammate
// ocioso quando a região dela está livre (T10.3). O Portão lê o núcleo pelo `$.ork` da ponte e pela ferramenta de
// leitura do plano, nunca o estado interno do disco; age só por comando do `ork`; nunca roda o verify por conta
// própria, nunca toma lease e nunca fala pelo dono. A lógica fica nos módulos puros ao lado; aqui só as chamadas ao
// `$`, sempre escritas como `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { PortaoQuadro, PortaoTarefa } from '../types'
import {
  argsDoPlano, decidirCriacao, escopoDoPlano, escopoDoRetrato, FERRAMENTA_DO_PLANO, IDADE_DO_PLANO_MS, IDADE_SEM_PLANO_MS,
  idsNoAssunto, jsonDoMcp, SERVIDOR, serveAoQuadro, tarefasDoPlano, textoDaRecusa, textoDoPlano, threadNoRetrato,
} from './plano'
import {
  argvDaConferencia, assinatura, contarRepeticao, lerConferencia, textoDeOutraConferencia, textoDoBloqueio, textoDoStatus,
  VIGIA_DA_CONFERENCIA_MS,
} from './verify'
import type { Leitura } from './verify'
import {
  escolherTarefa, nomeDoTeammate, paginaDosLeases, recusaDoTeammate, TETO_DE_PAGINAS_DE_LEASES, tetosDoAmbiente,
  textoDaEntrega, VIVOS,
} from './lease'
import type { LeaseAtivo } from './lease'

const QUADRO = { plugin: 'ork-portao', key: 'quadro' } as const

/**
 * O quadro desta carga do módulo (D9 do plano da thread): lido do `$.state` uma vez por thread e mudado só por
 * `mudarQuadro`, que aplica a mudança na versão mais nova sem esperar nada no meio e então grava sem versão. Um gancho
 * que espera uma chamada de `$` deixa outro gancho rodar: mudança feita sobre uma cópia lida antes apagaria a dele.
 */
let quadro: PortaoQuadro | null = null
/** O plano lido e quando, por thread; relido depois da idade (D3). */
let plano: { thread: string; em: number; tarefas: PortaoTarefa[] | null } | null = null
/**
 * A tarefa do plano que o Portão está conferindo no núcleo agora (D5): uma conferência por vez. Fica no módulo, não no
 * `$.state`: uma troca do worker mata o processo junto com a marca.
 */
let conferindo: string | null = null

/** A sessão de fase com thread, pelo contexto da ponte; qualquer outra sessão fica sem Portão (D1). */
type ContextoDeFase = { thread: string; raiz: string }
/**
 * A sessão em que o Portão age (D1): o contexto e as tarefas do plano, ou `null` nelas quando o plano não serve ao quadro
 * (ausente, sem tarefa que sirva ou com a leitura falhando). Sem elas, a criação e o teammate passam, mas a tarefa
 * registrada na criação continua conferida na conclusão: o núcleo lê o plano por conta própria.
 */
type Sessao = { ctx: ContextoDeFase; tarefas: PortaoTarefa[] | null }

const mensagem = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro)).slice(0, 300)

function quadroVazio(thread: string): PortaoQuadro {
  return { thread, tarefas: {}, concluidas: [], repeticoes: {}, atribuicoes: {}, devolvidas: [], ultimaFalha: null }
}

async function contextoDeFase($: EngineInterface): Promise<ContextoDeFase | null> {
  const ctx = await $.ork.contexto()
  return ctx.papel === 'fase' && ctx.thread ? { thread: ctx.thread, raiz: ctx.raiz } : null
}

/** O quadro da thread: o do módulo, ou o do `$.state` na primeira leitura (a que chegar primeiro vale). */
async function lerQuadro($: EngineInterface, thread: string): Promise<PortaoQuadro> {
  if (quadro && quadro.thread === thread) return quadro
  const lido = (await $.state.get(QUADRO)).value
  if (quadro && quadro.thread === thread) return quadro
  quadro = lido && lido.thread === thread ? { ...quadroVazio(thread), ...lido } : quadroVazio(thread)
  return quadro
}

/**
 * Aplica `mudar` ao quadro mais novo, sem esperar nada entre ler e trocar, e grava (D9). `mudar` que devolve o mesmo
 * quadro não grava nada.
 */
async function mudarQuadro($: EngineInterface, thread: string, mudar: (q: PortaoQuadro) => PortaoQuadro): Promise<PortaoQuadro> {
  await lerQuadro($, thread)
  const atual = quadro as PortaoQuadro
  const novo = mudar(atual)
  if (novo === atual) return atual
  quadro = novo
  await $.state.set(QUADRO, novo)
  return novo
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
 * A sessão em que o Portão age (D1): papel `fase` com thread, thread não fechada e GO no bloco pelo retrato da ponte. O
 * retrato que falha conta como GO e aberta, e fica na linha de status. As tarefas vêm do plano legível com ao menos uma
 * tarefa que serve ao quadro; sem ele, `null`.
 */
async function sessaoDoPortao($: EngineInterface): Promise<Sessao | null> {
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
  if (doRetrato.avisos.length > 0) $.ui.status(`portão: ${doRetrato.avisos.join('; ')}`)
  let tarefas: PortaoTarefa[] | null
  try {
    tarefas = await lerTarefas($, ctx)
  } catch (erro) {
    await anotarFalha($, 'leitura do plano', erro, ctx.thread)
    return { ctx, tarefas: null }
  }
  return { ctx, tarefas: escopoDoPlano(tarefas).ativo ? tarefas : null }
}

/**
 * Guarda a falha do próprio Portão no quadro e a diz uma vez no transcript (não vai ao modelo) e na linha de
 * status: nenhuma captura fica muda.
 */
async function anotarFalha($: EngineInterface, onde: string, erro: unknown, thread?: string): Promise<void> {
  const motivo = mensagem(erro)
  $.ui.status(`portão: falhou em ${onde}`)
  const alvo = thread ?? quadro?.thread
  if (!alvo) {
    $.ui.log(`Portão de Tarefas: falhou em ${onde}: ${motivo}`)
    return
  }
  const em = await $.clock.now()
  let nova = false
  await mudarQuadro($, alvo, q => {
    if (q.ultimaFalha?.onde === onde && q.ultimaFalha.motivo === motivo) return q
    nova = true
    return { ...q, ultimaFalha: { onde, motivo, em } }
  })
  if (nova) $.ui.log(`Portão de Tarefas: falhou em ${onde}: ${motivo}`)
}

/**
 * A tarefa do plano de uma tarefa nativa (D2): a registrada na criação vence (renomear não tira a tarefa do portão);
 * sem registro, o assunto que cita uma tarefa do plano que serve ao quadro, e uma só. Fora disso, a tarefa não é do
 * plano: a que o núcleo não confere nunca prende a conclusão.
 */
function tarefaDoEvento(assunto: unknown, taskId: string, q: PortaoQuadro, tarefas: readonly PortaoTarefa[]): string | null {
  const registrada = q.tarefas[taskId]
  if (registrada) return registrada
  const ids = idsNoAssunto(assunto).filter(id => tarefas.some(t => t.id === id && serveAoQuadro(t)))
  return ids.length === 1 ? (ids[0] as string) : null
}

/**
 * A conferência do verify da tarefa no núcleo (D4, D5): `ork claims conferir --tarefa` por `$.process.run`, na raiz
 * da sessão, com o vigia do mod. A espera é chamada de `$` e não conta no orçamento do gancho.
 */
async function rodarConferencia($: EngineInterface, ctx: ContextoDeFase, tarefa: string): Promise<Leitura> {
  try {
    const r = await $.process.run(argvDaConferencia(ctx.thread, tarefa), { cwd: ctx.raiz, timeoutMs: VIGIA_DA_CONFERENCIA_MS })
    return lerConferencia(tarefa, r.stdout, r.exitCode, r.stderr)
  } catch (erro) {
    return { tipo: 'indisponivel', motivo: `ork claims conferir não rodou: ${mensagem(erro)}` }
  }
}

/** Os tetos do piloto de agent teams que o núcleo passou no ambiente da sessão (D10); `null` sem eles. */
async function lerTetos($: EngineInterface): Promise<{ teammates: number; custoUsd: number } | null> {
  // O validador pede o nome literal; o teste do núcleo confere que ele é o de ENV_TEAMMATES e ENV_CUSTO.
  return tetosDoAmbiente(await $.env.get('ORK_AGENT_TEAMS_TEAMMATES'), await $.env.get('ORK_AGENT_TEAMS_CUSTO_USD'))
}

/** O custo da sessão como o `/cost` soma; `null` quando ele não vem. */
async function custoDaSessao($: EngineInterface): Promise<number | null> {
  const uso = await $.session.usage()
  return typeof uso.cost?.usd === 'number' ? uso.cost.usd : null
}

/**
 * Os leases ativos de todas as threads (D8 revista), página a página. O servidor MCP da sessão de fase é fixado na
 * thread e o retrato dele só traz os leases dela; por isso a leitura vai pela consulta `maestro` da lista fechada da
 * ponte (`ork maestro --json --section leases`), que vê o projeto inteiro. Lança se uma página não vem.
 */
async function lerLeases($: EngineInterface): Promise<{ leases: LeaseAtivo[]; lacuna: string | null }> {
  const leases: LeaseAtivo[] = []
  let offset = 0
  for (let pagina = 0; pagina < TETO_DE_PAGINAS_DE_LEASES; pagina++) {
    const pedido = { consulta: 'maestro' as const, secao: 'leases' as const, offset }
    const p = paginaDosLeases(await $.ork.ler(pedido))
    leases.push(...p.leases)
    if (p.lacuna) return { leases, lacuna: p.lacuna }
    if (p.proximo === null) return { leases, lacuna: null }
    offset = p.proximo
  }
  return { leases, lacuna: `mais de ${TETO_DE_PAGINAS_DE_LEASES} páginas de leases; o resto não foi lido` }
}

export const register: Register = on => {
  // A criação (T10.1): a tarefa nativa só entra apontando uma tarefa do plano que serve ao quadro (D2, D3). A recusa
  // volta ao modelo pelo `block`, com o motivo e as tarefas que servem; a que passa fica registrada pelo id nativo.
  on('classic.TaskCreated', async ($, e, next) => {
    const sessao = await sessaoDoPortao($)
    if (!sessao || !sessao.tarefas) return next(e)
    const veredito = decidirCriacao(e.task_subject, sessao.tarefas)
    if (veredito.tipo === 'recusa') return { block: textoDaRecusa(veredito, e.task_subject, sessao.tarefas) }
    await mudarQuadro($, sessao.ctx.thread, q => ({ ...q, tarefas: { ...q.tarefas, [String(e.task_id)]: veredito.tarefa } }))
    return next(e)
  }).catch(async ($, e, next) => {
    // Na reentrada o gancho nem rodou e as chamadas de `$` recusam: só a falha de verdade é anotada.
    if (next.error && next.error.kind !== 're-entry') await anotarFalha($, 'criação de tarefa', next.error.message ?? next.error.kind)
    return next(e)
  })

  // A conclusão (T10.2): a tarefa do plano só fecha com a conferência do núcleo aprovada (D4), uma por vez (D5).
  // Todo bloqueio volta ao modelo com o motivo e a saída (corrigir, ou devolver a tarefa para pending), e a terceira
  // vez seguida com o mesmo resultado manda deixar a tarefa aberta (D6). Tarefa que não é do plano passa.
  on('classic.TaskCompleted', async ($, e, next) => {
    const sessao = await sessaoDoPortao($)
    if (!sessao) return next(e)
    const { ctx } = sessao
    const tarefa = tarefaDoEvento(e.task_subject, String(e.task_id), await lerQuadro($, ctx.thread), sessao.tarefas ?? [])
    if (!tarefa) return next(e)
    if (conferindo) return { block: textoDeOutraConferencia(tarefa, conferindo) }
    conferindo = tarefa
    let leitura: Leitura
    try {
      $.ui.status(`portão: conferindo ${tarefa} no núcleo`)
      leitura = await rodarConferencia($, ctx, tarefa)
    } finally {
      conferindo = null
    }
    if (leitura.tipo === 'aprovada') {
      const resultado = await next(e)
      if (!resultado.block) {
        await mudarQuadro($, ctx.thread, q => {
          const repeticoes = { ...q.repeticoes }
          delete repeticoes[tarefa]
          return { ...q, concluidas: q.concluidas.includes(tarefa) ? q.concluidas : [...q.concluidas, tarefa], repeticoes }
        })
      }
      $.ui.status(textoDoStatus(tarefa, leitura))
      return resultado
    }
    const marca = assinatura(leitura)
    let vezes = 1
    await mudarQuadro($, ctx.thread, q => {
      const repeticao = contarRepeticao(q.repeticoes[tarefa], marca)
      vezes = repeticao.vezes
      return { ...q, repeticoes: { ...q.repeticoes, [tarefa]: repeticao } }
    })
    $.ui.status(textoDoStatus(tarefa, leitura))
    return { block: textoDoBloqueio(tarefa, leitura, vezes) }
  }).catch(async ($, e, next) => {
    // A conclusão fecha só aprovada (D4): se o próprio Portão falhou no meio, a tarefa registrada, ou a que cita um id
    // de tarefa do plano no assunto, não fecha. A anotação é melhor esforço: o bloqueio não depende dela.
    if (!next.error || next.error.kind === 're-entry') return next(e)
    const motivo = next.error.message ?? next.error.kind
    try { await anotarFalha($, 'conclusão de tarefa', motivo) } catch { $.ui.status('portão: falhou na conclusão de tarefa') }
    const ids = idsNoAssunto(e.task_subject)
    const tarefa = quadro?.tarefas[String(e.task_id)] ?? (ids.length === 1 ? ids[0] : undefined)
    if (!tarefa) return next(e)
    return { block: textoDoBloqueio(tarefa, { tipo: 'indisponivel', motivo: `o Portão falhou ao conferir: ${motivo}` }) }
  })

  // O teammate ocioso (T10.3): com os tetos do piloto na sessão, quem ficou ocioso sem concluir devolve a tarefa, e a
  // próxima tarefa livre do plano (D7) vai a ele pelo `block`. Livre é sem lease `path:` ativo de nenhuma thread na
  // região e sem cruzar as tarefas dos outros teammates (D8 revista); a escolha e a atribuição acontecem juntas sobre o
  // quadro mais novo. No teto de custo, sem os leases legíveis ou sem tarefa livre, o teammate fica ocioso.
  on('classic.TeammateIdle', async ($, e, next) => {
    const sessao = await sessaoDoPortao($)
    if (!sessao || !sessao.tarefas) return next(e)
    const tetos = await lerTetos($)
    const teammate = nomeDoTeammate(e.teammate_name)
    if (!tetos || !teammate) return next(e)
    const { ctx, tarefas } = sessao
    await mudarQuadro($, ctx.thread, q => {
      const tinha = q.atribuicoes[teammate]
      if (!tinha) return q
      const atribuicoes = { ...q.atribuicoes }
      delete atribuicoes[teammate]
      const devolvida = !q.concluidas.includes(tinha) && !q.devolvidas.includes(tinha)
      return { ...q, atribuicoes, devolvidas: devolvida ? [...q.devolvidas, tinha] : q.devolvidas }
    })
    const custo = await custoDaSessao($)
    if (custo === null || custo >= tetos.custoUsd) {
      $.ui.status(custo === null ? 'portão: custo da sessão ilegível; nenhuma tarefa nova ao time' : `portão: teto de custo do piloto (US$ ${tetos.custoUsd}) atingido`)
      return next(e)
    }
    let leases: LeaseAtivo[]
    try {
      const lidos = await lerLeases($)
      leases = lidos.leases
      if (lidos.lacuna) $.ui.log(`Portão de Tarefas: ${lidos.lacuna}`, { to: 'debug' })
    } catch (erro) {
      await anotarFalha($, 'leitura dos leases', erro, ctx.thread)
      return next(e)
    }
    let entregue: PortaoTarefa | null = null
    await mudarQuadro($, ctx.thread, q => {
      const escolha = escolherTarefa({ tarefas, quadro: q, teammate, leases })
      if (!escolha) return q
      entregue = escolha
      return { ...q, atribuicoes: { ...q.atribuicoes, [teammate]: escolha.id } }
    })
    const tarefa = entregue as PortaoTarefa | null
    if (!tarefa) return next(e)
    $.ui.status(`portão: ${tarefa.id} com ${teammate}`)
    return { block: textoDaEntrega(tarefa, teammate) }
  }).catch(async ($, e, next) => {
    if (next.error && next.error.kind !== 're-entry') await anotarFalha($, 'teammate ocioso', next.error.message ?? next.error.kind)
    return next(e)
  })

  // Os tetos do piloto (D10): em toda sessão de fase, o teammate só nasce com os tetos do núcleo, abaixo do teto de
  // teammates vivos e do teto de custo. Subagente que não é teammate passa.
  on('agent.spawn', async ($, e, next) => {
    if (!e.isTeammate) return next(e)
    const ctx = await contextoDeFase($)
    if (!ctx) return next(e)
    const tetos = await lerTetos($)
    const vivos = (await $.agent.list()).filter(a => a.teammateId && VIVOS.includes(a.status)).length
    const recusa = recusaDoTeammate(tetos, vivos, tetos ? await custoDaSessao($) : null)
    if (recusa) {
      $.ui.status('portão: teammate recusado pelo teto do piloto')
      return { deny: recusa }
    }
    return next(e)
  }).catch(async ($, e, next) => {
    if (!next.error || next.error.kind === 're-entry' || !e.isTeammate || next.called) return next(e)
    const motivo = next.error.message ?? next.error.kind
    try { await anotarFalha($, 'teto de teammates', motivo) } catch { $.ui.status('portão: falhou no teto de teammates') }
    return { deny: `Portão de Tarefas: teammate recusado. O Portão não conseguiu conferir os tetos do piloto (${motivo}).` }
  })
}
