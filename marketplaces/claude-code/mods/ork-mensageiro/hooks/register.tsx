// O Mensageiro de Sessoes do Orkastery (RM-059, fatia F9; ficha M9 do plano dos mods). Na sessao do dono, leva a
// resposta que o dono deu pelo dialogo nativo a sessao de fase `claude-bg` que parou esperando por ela: pega a
// mensagem na caixa de saida do nucleo (`ork_session_outbox`, so na memoria do servidor desta sessao), envia por
// `$.session.send` sem mexer no texto e anota o envio no nucleo. Na sessao de fase, so deixa entrar na conversa a
// mensagem de outra sessao que o nucleo confirma, pela `ork_session_inbox`, como a resposta do dono reservada para
// ela; o resto que chega de outra sessao e consumido antes do modelo. Le o que segue incerto pelo `$.ork.retrato`,
// nunca o estado em `.orkastery/` por conta propria. Nunca responde, aprova ou abre pedido pelo dono. A logica fica
// nos modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`, sempre escritas como `x.noun.metodo(...)`, como
// o validador exige.
import type { EngineInterface, Register, SessionReceiveInput, SessionReceiveResult } from 'claude-code'
import type { MensageiroDono, MensageiroFase, MensageiroMostrado, MensageiroRecebida } from '../types'
import type { EntradaDaCaixa } from './caixa'
import {
  argsDaAnotacao, argsDoEnvio, atualizarEntregas, deveEnviar, DONO_VAZIO, entradaAnotada, FERRAMENTA_DA_CAIXA, incertasDoRetrato,
  jsonDoMcp, lerCaixa, pedidosNoRetrato, resultadoDoEnvio, textoDaFaixa, threadDoLedger, umaLinha,
} from './caixa'
import { desenharPainel, linhasDaFase, linhasDoDono, mostradosVisiveis } from './painel'
import type { Conferencia } from './recepcao'
import {
  argsDaConferencia, argsDaConfirmacao, classificarOrigem, comRecebida, confirmadasDaFase, ESPERAS_DA_CONFIRMACAO_MS, FASE_VAZIA,
  FERRAMENTA_DA_CONFERENCIA, idsDaMarca, impressaoDoTexto, lerConferencia, lerConfirmacao, LIMITE_DA_MENSAGEM, mensagemSemEnvelope,
  motivoDoConsumo, mudarRecebida, nomeDaOrigem, passaNaFalha, registroDaRecebida, temMarca, textoComRotulo,
} from './recepcao'

const MOD = 'ork-mensageiro'
const PAINEL = 'mensageiro'
const TITULO = 'Mensageiro de Sessões'
const DONO = { plugin: 'ork-mensageiro', key: 'dono' } as const
const FASE = { plugin: 'ork-mensageiro', key: 'fase' } as const
/** D9 da thread ork-rm059mensag: o tique do lado do dono, que tambem mantem o Mensageiro vivo na caixa de saida. */
const PERIODO_DO_TIQUE_MS = 20000
/** Os ledgers que mudam juntos entram numa leitura so. */
const ESPERA_DO_LOTE_MS = 1000
/** Teto de cada chamada ao nucleo. */
const PRAZO_DO_NUCLEO_MS = 20000
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
const ESPERA_LONGA_DO_PAPEL_MS = 300000

// O que o modulo guarda entre ganchos. O estado em `$.state` (o lado do dono e o da fase) e o que o desenho le; aqui
// ficam a copia dele, gravada inteira por `$.state.set` sem versao (uma gravacao por mudanca), e o que nao se
// desenha. Uma recarga do modulo zera tudo, e o `session.start` dispara de novo nela.
let ativa = false
let naFase = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let lote: { cancel: () => void } | undefined
let lendo: Promise<void> | undefined
let pendente = false
let dono: MensageiroDono = DONO_VAZIO
let fase: MensageiroFase = FASE_VAZIA
/**
 * O papel e a thread que a ponte deu. O papel `fase` sai do `ORK_DISPATCH_ID` do despacho e nunca muda na sessao, e
 * a sessao que nao e de fase nunca vira: o receptor decide por isto, lido uma vez.
 */
let contextoVisto: { papel: string; thread: string | null } | null = null
/** As mensagens que o nucleo confirmou e que ainda nao entraram na fila: o `.catch` do receptor deixa passar so elas. */
const confirmadasEmVoo = new Set<string>()
/** O ultimo texto publicado na faixa; null antes da primeira publicacao. */
let ultimaFaixa: string | undefined | null = null
/** O que o desenho pos na janela de rolagem e ainda nao foi ao registro da ponte (M5). */
const vistosNoDesenho = new Map<string, MensageiroMostrado>()
/** O que ja foi ao registro nesta sessao, por chave e texto. */
const jaMostrado = new Set<string>()
/** A falha de um trabalho em segundo plano que nem o painel conseguiu guardar. */
let problemaSemAviso: string | null = null

const mensagem = (erro: unknown) => umaLinha(erro, 200)

/** A chamada com teto proprio: o relogio da sessao recusa a espera que passar dele. */
function comPrazo<T>($: EngineInterface, chamada: Promise<T>, ms = PRAZO_DO_NUCLEO_MS): Promise<T> {
  return new Promise<T>((resolver, recusar) => {
    const prazo = $.clock.after(ms, () => recusar(new Error(`o núcleo passou de ${Math.round(ms / 1000)} s`)))
    chamada.then(v => { prazo.cancel(); resolver(v) }, e => { prazo.cancel(); recusar(e) })
  })
}

/** O instante do relogio da sessao; sem ele, o da ultima linha: o receptor nunca para por falta de relogio. */
async function instante($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return fase.recebidas.at(-1)?.em ?? 0
  }
}

async function gravarDono($: EngineInterface, novo: MensageiroDono): Promise<void> {
  dono = novo
  await $.state.set(DONO, novo)
}

async function gravarFase($: EngineInterface, nova: MensageiroFase): Promise<void> {
  fase = nova
  await $.state.set(FASE, nova)
}

/**
 * Trabalho em segundo plano (o tique, o lote, a leitura pedida, o recibo da entrega): a falha vai ao painel; sem como
 * gravar (a sessao acabou ou o estado recusou), ela fica guardada aqui e o proximo desenho a mostra. O `.catch` nao
 * depende do `$`.
 */
function emSegundoPlano($: EngineInterface, trabalho: Promise<unknown>, oQue: string): void {
  trabalho.catch(async erro => {
    const texto = `${oQue} parou: ${mensagem(erro)}`
    try {
      if (naFase) await gravarFase($, { ...fase, erro: texto })
      else await gravarDono($, { ...dono, erro: texto })
    } catch (erroDoAviso) {
      problemaSemAviso = `${texto} (o aviso também falhou: ${mensagem(erroDoAviso)})`
    }
  })
}

/**
 * O papel e a thread pela ponte. `null` so quando o `$.ork` nao existe (a ponte nao carregou); a falha da propria
 * ponte lanca. O que a ponte respondeu fica em `contextoVisto`.
 */
async function contextoDaSessao($: EngineInterface): Promise<{ papel: string; thread: string | null } | null> {
  let lido: { papel: unknown; thread: unknown }
  try {
    lido = await comPrazo($, $.ork.contexto())
  } catch (erro) {
    if (erro instanceof TypeError) return null
    throw erro
  }
  contextoVisto = { papel: String(lido.papel), thread: typeof lido.thread === 'string' ? lido.thread : null }
  return contextoVisto
}

/** Liga o lado do dono: o `/mensageiro`, o tique e a primeira leitura da caixa. */
async function ativarDono($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  try {
    await $.command.register({ name: 'mensageiro', description: 'Abre o Mensageiro de Sessões: as respostas do dono a caminho das sessões de fase', immediate: true })
  } catch (erro) {
    // Sem o /mensageiro o painel nao abre: o lado do dono volta a dormente e tenta de novo na espera longa.
    ativa = false
    $.clock.after(ESPERA_LONGA_DO_PAPEL_MS, () => { emSegundoPlano($, conferirPapel($, ESPERAS_DO_PAPEL_MS.length), 'a conferência do papel') })
    throw erro
  }
  dono = (await $.state.get(DONO)).value ?? DONO_VAZIO
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DO_TIQUE_MS, () => { emSegundoPlano($, levar($), 'o tique do Mensageiro') })
  agendar($, 1)
}

/** Liga o lado da sessao de fase: o `/mensageiro` mostra o que chegou. O filtro do receptor nao depende disto. */
async function ativarFase($: EngineInterface): Promise<void> {
  if (naFase) return
  naFase = true
  desistiu = true
  const guardada = (await $.state.get(FASE)).value
  // O que chegou antes desta leitura ja esta na memoria e no estado: a copia guardada so volta quando nada chegou.
  if (guardada && !fase.recebidas.length) fase = guardada
  fase = { ...fase, thread: contextoVisto?.thread ?? fase.thread }
  try {
    await $.command.register({ name: 'mensageiro', description: 'Abre o Mensageiro de Sessões: o que chegou de outras sessões a esta sessão de fase', immediate: true })
  } catch (erro) {
    // O filtro segue sem o comando; o painel diz por que ele nao abre.
    await gravarFase($, { ...fase, erro: `o /mensageiro não foi registrado: ${mensagem(erro)}` })
  }
}

/** Confere o papel: o dono liga o lado do dono, a fase liga o da fase, e a sessao dormente e conferida de novo. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || naFase || desistiu) return
  let papel: string | null
  try {
    papel = (await contextoDaSessao($))?.papel ?? null
  } catch {
    // A ponte falhou: a sessao conta como dormente e o papel e conferido de novo depois.
    papel = 'dormente'
  }
  if (papel === 'dono') return ativarDono($)
  if (papel === 'fase') return ativarFase($)
  if (papel === null) {
    desistiu = true
    $.ui.toast('mensageiro: a ponte ork-ponte não carregou; o Mensageiro de Sessões não leva respostas nesta sessão, e mensagem de outra sessão é consumida antes do modelo')
    return
  }
  const espera = ESPERAS_DO_PAPEL_MS[tentativa] ?? ESPERA_LONGA_DO_PAPEL_MS
  $.clock.after(espera, () => { emSegundoPlano($, conferirPapel($, tentativa + 1), 'a conferência do papel') })
}

/** Uma leitura daqui a pouco, uma por vez: os ledgers que mudam juntos entram nela. */
function agendar($: EngineInterface, ms = ESPERA_DO_LOTE_MS): void {
  if (lote) return
  lote = $.clock.after(Math.max(1, ms), () => {
    lote = undefined
    emSegundoPlano($, levar($), 'a leitura da caixa de saída')
  })
}

/** Uma rodada por vez; pedido que chega no meio volta a rodar logo depois, e quem pediu espera as duas. */
async function levar($: EngineInterface): Promise<void> {
  if (!ativa) return
  if (lendo) {
    pendente = true
    return lendo
  }
  lendo = (async () => {
    try {
      do {
        pendente = false
        await umaRodada($)
      } while (pendente)
    } finally {
      lendo = undefined
    }
  })()
  return lendo
}

/**
 * Uma rodada: a caixa de saida (o `listar` tambem mantem o Mensageiro vivo para o nucleo, D9), o envio do que deve ir
 * (D10), o retrato da secao `hitl` para saber o que ja foi respondido e o que segue noutra sessao, a faixa e o registro
 * do que o painel mostrou.
 */
async function umaRodada($: EngineInterface): Promise<void> {
  let caixa: EntradaDaCaixa[]
  try {
    caixa = lerCaixa(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_session_outbox', { operacao: 'listar' })), FERRAMENTA_DA_CAIXA))
  } catch (erro) {
    await gravarDono($, { ...dono, erro: `a caixa de saída não foi lida: ${mensagem(erro)}` })
    await publicarFaixa($)
    return
  }
  const agora = await $.clock.now()
  const levadas: EntradaDaCaixa[] = []
  for (const e of caixa) levadas.push(deveEnviar(e, agora) ? await enviar($, e) : e)
  let retrato: unknown = null
  try {
    retrato = (await comPrazo($, $.ork.retrato({ secao: 'hitl' }))).retrato
  } catch {
    // Sem o retrato, nada se conclui sobre o que saiu da caixa nesta volta.
  }
  const noRetrato = retrato === null ? null : pedidosNoRetrato(retrato)
  const depois = await $.clock.now()
  const entregas = atualizarEntregas(dono.entregas, levadas, noRetrato, depois)
  // So e "noutra sessao" o pedido incerto que esta sessao nao conhece: o que saiu da caixa daqui fica na linha dele.
  await gravarDono($, {
    entregas,
    incertas: retrato === null ? dono.incertas : incertasDoRetrato(retrato).filter(i => !entregas.some(e => e.pedidoId === i.pedidoId)),
    lidoEm: depois,
    erro: null,
  })
  await publicarFaixa($)
  await registrarMostrados($)
}

/** Envia a mensagem como o nucleo a compos e anota o resultado no nucleo; a anotacao que falha nao desfaz o envio. */
async function enviar($: EngineInterface, e: EntradaDaCaixa): Promise<EntradaDaCaixa> {
  let r: { entregue: boolean; motivo: string | null }
  try {
    r = resultadoDoEnvio(await comPrazo($, $.session.send(argsDoEnvio(e))))
  } catch (erro) {
    r = { entregue: false, motivo: `o envio falhou: ${mensagem(erro)}` }
  }
  try {
    const anotada = entradaAnotada(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_session_outbox', argsDaAnotacao(e, r))), FERRAMENTA_DA_CAIXA), e.reservada)
    if (anotada) return anotada
  } catch {
    // O nucleo nao anotou: a proxima leitura da caixa traz a conta dele.
  }
  return { ...e, tentativas: e.tentativas + 1, ultimoEnvio: { em: await $.clock.now(), entregue: r.entregue, motivo: r.motivo } }
}

/** A linha da faixa pela ponte (D7 do plano dos mods), so quando o texto muda; sem nada a dizer, a linha sai. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(dono, await $.clock.now())
  if (texto === ultimaFaixa) return
  try {
    if (texto === undefined) await $.ork.faixa({ mod: MOD })
    else await $.ork.faixa({ mod: MOD, texto })
    ultimaFaixa = texto
  } catch {
    // A ponte recusou ou falhou: a proxima rodada tenta de novo.
  }
}

/** O painel do Mensageiro esta posto e a vista do dono. */
async function painelAVista($: EngineInterface): Promise<boolean> {
  const paineis = await $.ui.panes().catch(() => [])
  return paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)
}

/**
 * O que o desenho pos na janela de rolagem do painel posto e a vista vai ao registro da ponte (M5 do dono), uma vez
 * por chave e texto: o Telegram nao repete o que o dono ja viu no terminal.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  if (vistosNoDesenho.size === 0) return
  if (!await painelAVista($)) { vistosNoDesenho.clear(); return }
  for (const [vista, m] of [...vistosNoDesenho]) {
    vistosNoDesenho.delete(vista)
    if (jaMostrado.has(vista)) continue
    try {
      await $.ork.mostrado({ mod: MOD, canal: 'painel', chave: m.chave, ...(m.thread ? { thread: m.thread } : {}), texto: m.texto })
      jaMostrado.add(vista)
    } catch {
      // A ponte recusou ou falhou: volta para a proxima vez.
      vistosNoDesenho.set(vista, m)
    }
  }
}

/**
 * Anota o que chegou no estado da fase e, quando a mensagem nao entrou como devia, uma linha no transcript (dim, fora
 * do modelo). Nunca lanca: o receptor decide sem depender do estado nem do transcript.
 */
async function anotar($: EngineInterface, mudar: (f: MensageiroFase) => MensageiroFase, registro: MensageiroRecebida | null): Promise<void> {
  try {
    await gravarFase($, mudar(fase))
  } catch (erro) {
    problemaSemAviso = `o estado da sessão de fase não foi gravado: ${mensagem(erro)}`
  }
  const linha = registro ? registroDaRecebida(registro) : null
  if (!linha) return
  try {
    $.ui.log(linha)
  } catch (erro) {
    problemaSemAviso = `o transcript recusou a linha do Mensageiro: ${mensagem(erro)}`
  }
}

/** Consome a mensagem de outra sessao antes do modelo, com o motivo no estado, no transcript e no registro do Claude Code. */
async function consumir($: EngineInterface, e: SessionReceiveInput, motivo: string, detalhe?: string): Promise<SessionReceiveResult> {
  const r: MensageiroRecebida = { em: await instante($), origem: nomeDaOrigem(e.origin), estado: 'consumida', ...idsDaMarca(e.text),
    motivo: detalhe ? `${motivo}: ${umaLinha(detalhe, 160)}` : motivo, impressao: null }
  await anotar($, f => comRecebida(f, r), r)
  return { consumed: motivoDoConsumo(motivo) }
}

/**
 * A mensagem de outra sessao (T9.3). Na sessao de fase: sem a marca, consumida sem chamar o nucleo (D13); com ela, vai
 * ao `conferir` do nucleo, e so a confirmada segue para a conversa, como chegou (D11), com o `confirmar` depois de
 * entrar na fila. Falha, prazo vencido e resposta fora do contrato consomem. Sem a ponte, ou sem o papel, consome.
 * Nas sessoes do dono e dormente, passa como chegou.
 */
async function receber($: EngineInterface, e: SessionReceiveInput, next: (e: SessionReceiveInput) => Promise<SessionReceiveResult>): Promise<SessionReceiveResult> {
  let contexto = contextoVisto
  if (contexto === null) {
    try {
      contexto = await contextoDaSessao($)
    } catch (erro) {
      return consumir($, e, 'entrega.sem-papel', mensagem(erro))
    }
    if (contexto === null) return consumir($, e, 'entrega.sem-ponte')
  }
  if (contexto.papel !== 'fase') return next(e)
  if (typeof e.text !== 'string' || e.text.length > LIMITE_DA_MENSAGEM) return consumir($, e, 'entrega.grande')
  if (!temMarca(e.text)) return consumir($, e, 'entrega.sem-marca')
  const thread = contexto.thread
  if (thread === null) return consumir($, e, 'entrega.despacho')
  let conferencia: Conferencia
  try {
    conferencia = lerConferencia(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_session_inbox', argsDaConferencia(thread, e.text, await instante($)))), FERRAMENTA_DA_CONFERENCIA))
  } catch (erro) {
    return consumir($, e, 'entrega.conferencia-falhou', mensagem(erro))
  }
  if (!conferencia.confirmada) return consumir($, e, conferencia.motivo)
  const { pedidoId, envioId } = conferencia
  const texto = e.text
  // A impressao da mensagem como a linha da conversa a mostra (sem o envelope do motor), para o rotulo visual.
  const semEnvelope = mensagemSemEnvelope(texto)
  const impressao = semEnvelope === null ? null : impressaoDoTexto(semEnvelope)
  confirmadasEmVoo.add(texto)
  let r: SessionReceiveResult
  try {
    const chegada: MensageiroRecebida = { em: await instante($), origem: nomeDaOrigem(e.origin), estado: 'confirmando', pedidoId, envioId,
      motivo: null, impressao }
    await anotar($, f => comRecebida(f, chegada), null)
    r = await next(e)
  } finally {
    confirmadasEmVoo.delete(texto)
  }
  if (r.consumed !== undefined) {
    const caiu: MensageiroRecebida = { em: await instante($), origem: nomeDaOrigem(e.origin), estado: 'nao-entrou', pedidoId, envioId,
      motivo: `outro plugin a consumiu abaixo do Mensageiro (${umaLinha(r.consumed, 120)})`, impressao: null }
    await anotar($, f => mudarRecebida(f, envioId, caiu.estado, caiu.motivo, caiu.em), caiu)
    return r
  }
  emSegundoPlano($, confirmar($, thread, pedidoId, envioId, texto, 0), 'a confirmação da entrega')
  return r
}

/** O recibo da entrega que entrou na conversa; a falha volta nas esperas e, esgotadas, a linha fica sem recibo. */
async function confirmar($: EngineInterface, thread: string, pedidoId: string, envioId: string, texto: string, tentativa: number): Promise<void> {
  let r: { ok: boolean; definitiva: boolean; motivo: string | null }
  try {
    r = lerConfirmacao(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_session_inbox', argsDaConfirmacao(thread, envioId, texto))), FERRAMENTA_DA_CONFERENCIA))
  } catch (erro) {
    r = { ok: false, definitiva: false, motivo: mensagem(erro) }
  }
  const em = await instante($)
  if (r.ok) return anotar($, f => mudarRecebida(f, envioId, 'entregue', null, em), null)
  const motivo = r.motivo
  const espera = r.definitiva ? undefined : ESPERAS_DA_CONFIRMACAO_MS[tentativa]
  if (espera === undefined) {
    const semRecibo: MensageiroRecebida = { em, origem: '', estado: 'sem-recibo', pedidoId, envioId, motivo, impressao: null }
    return anotar($, f => mudarRecebida(f, envioId, 'sem-recibo', motivo, em), semRecibo)
  }
  await anotar($, f => mudarRecebida(f, envioId, 'confirmando', `o recibo volta a ser gravado: ${motivo ?? 'sem motivo'}`, em), null)
  $.clock.after(espera, () => { emSegundoPlano($, confirmar($, thread, pedidoId, envioId, texto, tentativa + 1), 'a confirmação da entrega') })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const iniciada = await next(e)
    await conferirPapel($, 0).catch(() => undefined)
    return iniciada
  })

  // Toda entrega que chega a sessao. So a de outra sessao passa pelo receptor (G4); Remote Control, notificacao de
  // tarefa, agendamento, canais, agentes e teammates verificados desta sessao seguem como chegaram, sem chamada ao
  // nucleo. O `.catch` fecha: a mensagem de outra sessao que o gancho nao decidiu e consumida, salvo a que o nucleo
  // ja confirmou e reservou, que segue.
  on('session.receive', async ($, e, next) => {
    if (classificarOrigem(e.origin, e.agentId) !== 'outra-sessao') return next(e)
    return receber($, e, next)
  }).catch(($, e, next) => {
    const passa = passaNaFalha({ chamouNext: next.called, origem: e.origin, agentId: e.agentId, texto: e.text,
      papel: contextoVisto?.papel ?? null, emVoo: confirmadasEmVoo })
    return passa ? next(e) : { consumed: motivoDoConsumo('entrega.conferencia-falhou') }
  })

  // O ledger de uma thread mudou (uma resposta entrou na caixa, a sessao reservou ou confirmou): a leitura entra no
  // proximo lote. Os caminhos vigiados sao os que a ponte pede para o papel dono; o Mensageiro nao pede outros.
  on('classic.FileChanged', async ($, e, next) => {
    if (ativa && threadDoLedger(e.file_path) !== null) agendar($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // `/mensageiro` abre o painel: na sessao do dono, as entregas, e le a caixa agora; na de fase, o que chegou.
  on('command.run', { command: 'mensageiro' }, async ($) => {
    if (!ativa && !naFase && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa && !naFase) return { text: 'O Mensageiro de Sessões só abre numa sessão do Orkastery: a do dono ou a de uma fase.' }
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    if (ativa) emSegundoPlano($, levar($), 'a leitura da caixa de saída')
    return { text: aberto.isPlaced ? 'Mensageiro de Sessões aberto.' : `Mensageiro de Sessões aberto, à espera de lugar: ${aberto.reason}` }
  })

  // O painel: na sessao do dono, as entregas desta sessao e as que seguem noutra; na de fase, o que chegou. O desenho
  // nunca escreve: so anota o que pos na janela de rolagem, para o registro do mostrado (M5).
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (naFase) {
      const daFase = (await $.state.get(FASE)).value ?? fase
      const comProblema: MensageiroFase = problemaSemAviso ? { ...daFase, erro: problemaSemAviso } : daFase
      return desenharPainel({ Box, Text, Button }, linhasDaFase(comProblema, await $.clock.now()), {})
    }
    const atual = (await $.state.get(DONO)).value ?? dono
    const comProblema: MensageiroDono = problemaSemAviso ? { ...atual, erro: problemaSemAviso } : atual
    const linhas = linhasDoDono(comProblema, await $.clock.now())
    for (const m of mostradosVisiveis(linhas, e.props.scroll)) vistosNoDesenho.set(`${m.chave}|${m.texto}`, m)
    return desenharPainel({ Box, Text, Button }, linhas, { atualizar: () => { emSegundoPlano($, levar($), 'a leitura da caixa de saída') } })
  })

  // Na sessao de fase, a linha da resposta que o nucleo confirmou mostra o rotulo no lugar do cabecalho. So visual: o
  // que fica guardado e o que o modelo le nao mudam (D11).
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // So a linha de mensagem de outra sessao (`peer`): a de teammate chega `unclassified`, e a do dono, de outra origem.
    if (!naFase || e.props.origin.kind !== 'peer' || !temMarca(e.props.text)) return next(e)
    const daFase = (await $.state.get(FASE)).value ?? fase
    const texto = textoComRotulo(e.props.text, confirmadasDaFase(daFase))
    return texto === null ? next(e) : next({ ...e, props: { ...e.props, text: texto } })
  }).catch(($, e, next) => next(e))
}
