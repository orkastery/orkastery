// A Pista de Entrega do Orkastery (RM-059, fatia F7; ficha M7 do plano dos mods). Na sessao do dono, um painel com a
// pista de cada entrega: do CHECK verde ao merge, cada etapa com a prova que o nucleo deu e o proximo passo que ele
// declara. A Pista le o nucleo pela ponte (`$.ork.retrato`, que diz quando uma entrega andou) e pelo comando de
// leitura `ork ship pista --json`, nunca o estado em `.orkastery/` por conta propria (D8 da thread ork-rm059pista). A
// logica fica nos modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { PistaMostrado, PistaQuadro } from '../types'
import {
  argvDaPista, assinaturaDoRetrato, desenharPista, exigirThread, lerPista, linhasDoPainel, mostradosVisiveis, textoDaFaixa,
  threadDoLedger, umaLinha,
} from './pista'

const MOD = 'ork-pista'
const PAINEL = 'pista'
const TITULO = 'Pista de Entrega'
const QUADRO = { plugin: 'ork-pista', key: 'quadro' } as const
const FOCO = { plugin: 'ork-pista', key: 'foco' } as const
const QUADRO_VAZIO: PistaQuadro = { linhas: [], lidoEm: null, erro: null, avisos: [] }
/** O tique: idade da pista, assinatura do retrato e registro do mostrado. */
const PERIODO_DO_TIQUE_MS = 60000
/** A pista e relida por idade: a cada 5 min com o painel a vista, a cada 15 min escondido. */
const IDADE_A_VISTA_MS = 5 * 60000
const IDADE_ESCONDIDO_MS = 15 * 60000
/** Entre duas leituras que nao foram pedidas pelo dono, no minimo isto: a leitura vai ao remoto e a forja. */
const INTERVALO_MINIMO_MS = 30000
/** Os ledgers que mudam juntos entram numa leitura so. */
const ESPERA_DO_LOTE_MS = 5000
/** Teto do `ork ship pista`: um `ls-remote` e a lista de PRs. */
const PRAZO_DA_PISTA_MS = 120000
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
const ESPERA_LONGA_DO_PAPEL_MS = 300000

// O que o modulo guarda entre ganchos. O estado em `$.state` (o quadro e o foco) e o que o desenho le; aqui ficam a
// copia dele, sempre gravada inteira por `$.state.set` sem versao (uma gravacao por mudanca, nunca o laco de
// releitura no mesmo despacho), e o que nao se desenha. Uma recarga do modulo zera tudo, e o `session.start` dispara
// de novo nela.
let ativa = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let lote: { cancel: () => void } | undefined
let lendo: Promise<void> | undefined
let pendente = false
let quadro: PistaQuadro = QUADRO_VAZIO
let foco: string | null = null
/** A ultima tentativa de leitura (ms), lida ou nao: segura o intervalo minimo. */
let tentadaEm = 0
let assinatura: string | null = null
/** O que o desenho pos na janela de rolagem e ainda nao foi ao registro da ponte (D9). */
const vistosNoDesenho = new Map<string, PistaMostrado>()
/** O que ja foi ao registro nesta sessao, por chave e texto. */
const jaMostrado = new Set<string>()
/** O ultimo texto publicado na faixa; null antes da primeira publicacao. */
let ultimaFaixa: string | undefined | null = null
/** A falha de um trabalho em segundo plano que nem o quadro conseguiu guardar. */
let problemaSemAviso: string | null = null

function mensagem(erro: unknown): string {
  return umaLinha(erro, 200)
}

/**
 * Trabalho em segundo plano (o tique, o lote, a leitura pedida): a falha vai ao quadro, como aviso; sem como gravar o
 * aviso (a sessao acabou ou o estado recusou), ela fica guardada aqui e o proximo desenho a mostra.
 */
function emSegundoPlano($: EngineInterface, trabalho: Promise<unknown>, oQue: string): void {
  trabalho.catch(async erro => {
    const texto = `${oQue} parou: ${mensagem(erro)}`
    try {
      await gravarQuadro($, { ...quadro, erro: texto })
    } catch (erroDoAviso) {
      problemaSemAviso = `${texto} (o aviso também falhou: ${mensagem(erroDoAviso)})`
    }
  })
}

async function gravarQuadro($: EngineInterface, novo: PistaQuadro): Promise<void> {
  quadro = novo
  await $.state.set(QUADRO, novo)
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

/** Liga a Pista na sessao do dono: o `/pista`, o tique e a primeira leitura. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  try {
    await $.command.register({ name: 'pista', description: 'Abre a Pista de Entrega: do CHECK verde ao merge, cada passo com o botão do núcleo', immediate: true })
  } catch (erro) {
    // Sem o /pista o painel nao abre: a Pista volta a dormente e tenta de novo na espera longa.
    ativa = false
    $.clock.after(ESPERA_LONGA_DO_PAPEL_MS, () => { emSegundoPlano($, conferirPapel($, ESPERAS_DO_PAPEL_MS.length), 'a conferência do papel') })
    throw erro
  }
  quadro = (await $.state.get(QUADRO)).value ?? QUADRO_VAZIO
  foco = (await $.state.get(FOCO)).value ?? null
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DO_TIQUE_MS, () => { emSegundoPlano($, tique($), 'o tique da Pista') })
  agendar($, 1)
}

/** Confere o papel: liga no dono, desiste na fase ou sem a ponte, e tenta de novo enquanto dormente. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativar($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('pista: a ponte ork-ponte não carregou; a Pista de Entrega fica desligada nesta sessão')
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
    emSegundoPlano($, atualizar($), 'a leitura da pista')
  })
}

/** O painel da Pista esta posto e a vista do dono. */
async function painelAVista($: EngineInterface): Promise<boolean> {
  const paineis = await $.ui.panes().catch(() => [])
  return paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)
}

/**
 * Uma leitura por vez; pedido que chega no meio volta a rodar logo depois. Fora do pedido do dono (`forcar`), a
 * leitura respeita o intervalo minimo e volta a ser agendada para quando ele vencer.
 */
async function atualizar($: EngineInterface, forcar = false): Promise<void> {
  if (!ativa) return
  const agora = await $.clock.now()
  if (!forcar && agora - tentadaEm < INTERVALO_MINIMO_MS) {
    agendar($, INTERVALO_MINIMO_MS - (agora - tentadaEm))
    return
  }
  if (lendo) {
    pendente = true
    return lendo
  }
  lendo = (async () => {
    try {
      do {
        pendente = false
        await lerUmaVez($)
      } while (pendente)
    } finally {
      lendo = undefined
    }
  })()
  return lendo
}

/** A pista pelo nucleo (`ork ship pista --json`); a falha fica no quadro, com a leitura anterior. */
async function lerUmaVez($: EngineInterface): Promise<void> {
  tentadaEm = await $.clock.now()
  try {
    const r = await $.process.run(argvDaPista(), { timeoutMs: PRAZO_DA_PISTA_MS })
    await gravarQuadro($, lerPista(r, await $.clock.now()))
  } catch (erro) {
    await gravarQuadro($, { ...quadro, erro: mensagem(erro) })
  }
  await publicarFaixa($)
  await registrarMostrados($)
}

/** O tique: a assinatura do retrato (uma entrega andou), a idade da pista e o registro do que o painel mostrou. */
async function tique($: EngineInterface): Promise<void> {
  if (!ativa) return
  const agora = await $.clock.now()
  const aVista = await painelAVista($)
  let nova: string | null = null
  try {
    nova = assinaturaDoRetrato(await $.ork.retrato({ secao: 'ship' }))
  } catch {
    // O retrato nao veio: so a idade decide nesta volta.
  }
  const mudou = nova !== null && assinatura !== null && nova !== assinatura
  if (nova !== null) assinatura = nova
  const idade = quadro.lidoEm === null ? Infinity : agora - quadro.lidoEm
  if (mudou || idade >= (aVista ? IDADE_A_VISTA_MS : IDADE_ESCONDIDO_MS)) await atualizar($)
  await registrarMostrados($)
}

/** A linha da faixa pela ponte (D9), so quando o texto muda; sem nada que peca o dono, a linha sai da faixa. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(quadro)
  if (texto === ultimaFaixa) return
  try {
    if (texto === undefined) await $.ork.faixa({ mod: MOD })
    else await $.ork.faixa({ mod: MOD, texto })
    ultimaFaixa = texto
  } catch {
    // A ponte recusou ou falhou: a proxima leitura tenta de novo.
  }
}

/**
 * O que o desenho pos na janela de rolagem do painel posto e a vista vai ao registro da ponte (M5 do dono, D9), uma
 * vez por chave e texto enquanto o texto existir na pista: o Telegram nao repete o que o dono ja viu no terminal.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  const existentes = new Set(linhasDoPainel(quadro, { agora: 0, foco }).flatMap(l => (l.mostrado ? [`${l.mostrado.chave}|${l.mostrado.texto}`] : [])))
  for (const vista of [...jaMostrado]) if (!existentes.has(vista)) jaMostrado.delete(vista)
  for (const vista of [...vistosNoDesenho.keys()]) if (!existentes.has(vista)) vistosNoDesenho.delete(vista)
  if (vistosNoDesenho.size === 0) return
  // Com o painel escondido, o que foi anotado e descartado: o proximo desenho a vista anota de novo.
  if (!await painelAVista($)) { vistosNoDesenho.clear(); return }
  for (const [vista, m] of [...vistosNoDesenho]) {
    vistosNoDesenho.delete(vista)
    if (jaMostrado.has(vista)) continue
    try {
      await $.ork.mostrado({ mod: MOD, canal: 'painel', chave: m.chave, thread: m.thread, texto: m.texto })
      jaMostrado.add(vista)
    } catch {
      // A ponte recusou ou falhou: volta para a proxima vez.
      vistosNoDesenho.set(vista, m)
    }
  }
}

/** O desenho anota o que pos na janela; quem registra e o tique ou a leitura, fora do desenho. */
function anotarVistos(vistos: readonly PistaMostrado[]): void {
  for (const m of vistos) vistosNoDesenho.set(`${m.chave}|${m.texto}`, m)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // `/pista [thread]` abre o painel em qualquer largura e rele a pista agora. Com uma thread (a Torre abre a Pista
  // assim), ela fica em foco no alto do painel. O comando so existe com a Pista ligada; a conferencia do papel aqui so
  // cobre o caso raro de o comando ter sobrado de uma carga anterior.
  on('command.run', { command: 'pista' }, async ($, e) => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'A Pista de Entrega só abre na sessão do dono de um projeto do Orkastery.' }
    const pedida = typeof e.args === 'string' ? e.args.trim() : ''
    let aviso = ''
    if (pedida) {
      try {
        foco = exigirThread(pedida)
      } catch {
        aviso = ` O id ${umaLinha(pedida, 80)} não é de thread; a pista abre sem foco.`
        foco = null
      }
    } else foco = null
    await $.state.set(FOCO, foco)
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    emSegundoPlano($, atualizar($, true), 'a leitura da pista')
    return { text: (aberto.isPlaced ? 'Pista de Entrega aberta.' : `Pista de Entrega aberta, à espera de lugar: ${aberto.reason}`) + aviso }
  })

  // O ledger de uma thread mudou (commit, verify, claim, entrega): a releitura entra no proximo lote. Os caminhos
  // vigiados sao os que a ponte pede para o papel dono; a Pista nao pede outros.
  on('classic.FileChanged', async ($, e, next) => {
    if (ativa && threadDoLedger(e.file_path) !== null) agendar($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // O painel: uma pista por entrega, com as etapas e o proximo passo do nucleo. O desenho nunca escreve: so anota o
  // que pos na janela de rolagem, para o registro do mostrado (D9).
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const q = (await $.state.get(QUADRO)).value ?? QUADRO_VAZIO
    const emFoco = (await $.state.get(FOCO)).value ?? null
    const agora = await $.clock.now()
    const comProblema: PistaQuadro = problemaSemAviso ? { ...q, avisos: [...q.avisos, problemaSemAviso] } : q
    anotarVistos(mostradosVisiveis(linhasDoPainel(comProblema, { agora, foco: emFoco }), e.props.scroll))
    return desenharPista({ Box, Text, Button }, comProblema, {
      agora, foco: emFoco, atualizar: () => { emSegundoPlano($, atualizar($, true), 'a leitura da pista') },
    })
  })
}
