// O Mensageiro de Sessoes do Orkastery (RM-059, fatia F9; ficha M9 do plano dos mods). Na sessao do dono, leva a
// resposta que o dono deu pelo dialogo nativo a sessao de fase `claude-bg` que parou esperando por ela: pega a
// mensagem na caixa de saida do nucleo (`ork_session_outbox`, so na memoria do servidor desta sessao), envia por
// `$.session.send` sem mexer no texto e anota o envio no nucleo. Le o que segue incerto pelo `$.ork.retrato`, nunca
// o estado em `.orkastery/` por conta propria. Nunca responde, aprova ou abre pedido pelo dono. A logica fica nos
// modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`, sempre escritas como `x.noun.metodo(...)`, como o
// validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { MensageiroDono, MensageiroMostrado } from '../types'
import type { EntradaDaCaixa } from './caixa'
import {
  argsDaAnotacao, argsDoEnvio, atualizarEntregas, deveEnviar, DONO_VAZIO, entradaAnotada, FERRAMENTA_DA_CAIXA, incertasDoRetrato,
  jsonDoMcp, lerCaixa, pedidosNoRetrato, resultadoDoEnvio, textoDaFaixa, threadDoLedger, umaLinha,
} from './caixa'
import { desenharPainel, linhasDoDono, mostradosVisiveis } from './painel'

const MOD = 'ork-mensageiro'
const PAINEL = 'mensageiro'
const TITULO = 'Mensageiro de Sessões'
const DONO = { plugin: 'ork-mensageiro', key: 'dono' } as const
/** D9 da thread ork-rm059mensag: o tique do lado do dono, que tambem mantem o Mensageiro vivo na caixa de saida. */
const PERIODO_DO_TIQUE_MS = 20000
/** Os ledgers que mudam juntos entram numa leitura so. */
const ESPERA_DO_LOTE_MS = 1000
/** Teto de cada chamada ao nucleo. */
const PRAZO_DO_NUCLEO_MS = 20000
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
const ESPERA_LONGA_DO_PAPEL_MS = 300000

// O que o modulo guarda entre ganchos. O estado em `$.state` (o lado do dono) e o que o desenho le; aqui ficam a copia
// dele, gravada inteira por `$.state.set` sem versao (uma gravacao por mudanca), e o que nao se desenha. Uma recarga
// do modulo zera tudo, e o `session.start` dispara de novo nela.
let ativa = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let lote: { cancel: () => void } | undefined
let lendo: Promise<void> | undefined
let pendente = false
let dono: MensageiroDono = DONO_VAZIO
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

async function gravarDono($: EngineInterface, novo: MensageiroDono): Promise<void> {
  dono = novo
  await $.state.set(DONO, novo)
}

/**
 * Trabalho em segundo plano (o tique, o lote, a leitura pedida): a falha vai ao painel; sem como gravar (a sessao
 * acabou ou o estado recusou), ela fica guardada aqui e o proximo desenho a mostra. O `.catch` nao depende do `$`.
 */
function emSegundoPlano($: EngineInterface, trabalho: Promise<unknown>, oQue: string): void {
  trabalho.catch(async erro => {
    const texto = `${oQue} parou: ${mensagem(erro)}`
    try {
      await gravarDono($, { ...dono, erro: texto })
    } catch (erroDoAviso) {
      problemaSemAviso = `${texto} (o aviso também falhou: ${mensagem(erroDoAviso)})`
    }
  })
}

/**
 * O papel pela ponte. `null` so quando o `$.ork` nao existe (a ponte nao carregou); uma falha da propria ponte conta
 * como dormente e o papel e conferido de novo depois.
 */
async function papelDaSessao($: EngineInterface): Promise<string | null> {
  try {
    return String(await $.ork.papel())
  } catch (erro) {
    return erro instanceof TypeError ? null : 'dormente'
  }
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

/** Confere o papel: o dono liga, a fase fica sem o lado do dono, e a sessao dormente e conferida de novo. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativarDono($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('mensageiro: a ponte ork-ponte não carregou; o Mensageiro de Sessões fica desligado nesta sessão')
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const iniciada = await next(e)
    await conferirPapel($, 0).catch(() => undefined)
    return iniciada
  })

  // O ledger de uma thread mudou (uma resposta entrou na caixa, a sessao reservou ou confirmou): a leitura entra no
  // proximo lote. Os caminhos vigiados sao os que a ponte pede para o papel dono; o Mensageiro nao pede outros.
  on('classic.FileChanged', async ($, e, next) => {
    if (ativa && threadDoLedger(e.file_path) !== null) agendar($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // `/mensageiro` abre o painel e le a caixa agora. O comando so existe com o lado do dono ligado.
  on('command.run', { command: 'mensageiro' }, async ($) => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'O Mensageiro de Sessões só abre na sessão do dono de um projeto do Orkastery.' }
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    emSegundoPlano($, levar($), 'a leitura da caixa de saída')
    return { text: aberto.isPlaced ? 'Mensageiro de Sessões aberto.' : `Mensageiro de Sessões aberto, à espera de lugar: ${aberto.reason}` }
  })

  // O painel: as entregas desta sessao e as que seguem noutra. O desenho nunca escreve: so anota o que pos na janela
  // de rolagem, para o registro do mostrado (M5).
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const atual = (await $.state.get(DONO)).value ?? dono
    const comProblema: MensageiroDono = problemaSemAviso ? { ...atual, erro: problemaSemAviso } : atual
    const linhas = linhasDoDono(comProblema, await $.clock.now())
    for (const m of mostradosVisiveis(linhas, e.props.scroll)) vistosNoDesenho.set(`${m.chave}|${m.texto}`, m)
    return desenharPainel({ Box, Text, Button }, linhas, { atualizar: () => { emSegundoPlano($, levar($), 'a leitura da caixa de saída') } })
  })
}
