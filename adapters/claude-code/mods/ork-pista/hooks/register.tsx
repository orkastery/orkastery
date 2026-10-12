// A Pista de Entrega do Orkastery (RM-059, fatia F7; ficha M7 do plano dos mods). Na sessao do dono, um painel com a
// pista de cada entrega: do CHECK verde ao merge, cada etapa com a prova que o nucleo deu e o proximo passo que ele
// declara. A Pista le o nucleo pela ponte (`$.ork.retrato`, que diz quando uma entrega andou) e pelo comando de
// leitura `ork ship pista --json`, nunca o estado em `.orkastery/` por conta propria (D8 da thread ork-rm059pista). A
// logica fica nos modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { PistaAcao, PistaCi, PistaLinha, PistaMostrado, PistaQuadro } from '../types'
import type { AcaoDoBotao } from './acoes'
import { argvDoPublicar, argvDoRegistro, botaoDaPista, lerPublicacao, lerRegistro, ROTULO_DO_BOTAO } from './acoes'
import {
  argvDoCi, comCi, INTERVALO_DO_CI_A_VISTA_MS, INTERVALO_DO_CI_ESCONDIDO_MS, lerCi, mudouOCi, pistasDoEvento, vencidasDoCi,
} from './ci'
import type { BotaoDaPista } from './pista'
import {
  argvDaPista, assinaturaDoRetrato, desenharPista, exigirThread, lerPista, linhasDoPainel, mostradosVisiveis, textoDaFaixa,
  threadDoLedger, umaLinha,
} from './pista'

const MOD = 'ork-pista'
const PAINEL = 'pista'
const TITULO = 'Pista de Entrega'
const QUADRO = { plugin: 'ork-pista', key: 'quadro' } as const
const FOCO = { plugin: 'ork-pista', key: 'foco' } as const
const ACOES = { plugin: 'ork-pista', key: 'acoes' } as const
const CI = { plugin: 'ork-pista', key: 'ci' } as const
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
/**
 * Teto do `ork ship pista`: o `ls-remote --heads` (ate 60 s), a leitura dos PRs (ate 60 s) e o git local; 3 min deixam
 * folga em rede lenta (S11 da revisao).
 */
const PRAZO_DA_PISTA_MS = 180000
/**
 * Teto do `ork ship publicar`: o pior caso do nucleo (ls-remote, lista de PRs, push, ls-remote, criacao e releitura do
 * PR) soma 435 s; 9 min cabem nele com folga, abaixo dos 10 min que o motor da a um processo.
 */
const PRAZO_DO_PUBLICAR_MS = 540000
/** Teto do `ork ship registrar-pr` (fetch, prova e CI). */
const PRAZO_DO_REGISTRO_MS = 180000
/** Teto do `ork ci status`: uma consulta ao GitHub. */
const PRAZO_DO_CI_MS = 60000
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
/** O ultimo botao de cada thread, como o estado o guarda; e as threads com um clique rodando no nucleo agora. */
let acoes: Record<string, PistaAcao> = {}
const emCurso = new Set<string>()
/** O CI lido de cada pista (T7.4), e as pistas com uma consulta de CI rodando agora. */
let ci: Record<string, PistaCi> = {}
const ciEmCurso = new Set<string>()
/** As leituras do CI que ja fizeram a pista ser relida (thread, head e estado): a mesma nao rele de novo. */
const relidasPeloCi = new Set<string>()
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
  // Depois de uma recarga do modulo, nenhum clique esta rodando: o que ficou "rodando" no estado vira falha.
  const guardadas = (await $.state.get(ACOES)).value ?? {}
  acoes = Object.fromEntries(Object.entries(guardadas).map(([t, a]) =>
    [t, a.estado === 'rodando' ? { ...a, estado: 'falhou' as const, texto: 'o clique anterior foi interrompido por uma recarga' } : a]))
  await $.state.set(ACOES, acoes)
  ci = (await $.state.get(CI)).value ?? {}
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
    // A leitura do CI que nao e mais do head de um PR aberto sai: o painel nao mostra CI de commit velho.
    const atuais = Object.fromEntries(Object.entries(ci).filter(([t, c]) => quadro.linhas.some(l => l.thread === t && l.pr?.head === c.sha)))
    if (Object.keys(atuais).length !== Object.keys(ci).length) {
      ci = atuais
      await $.state.set(CI, ci)
    }
  } catch (erro) {
    await gravarQuadro($, { ...quadro, erro: mensagem(erro) })
  }
  await publicarFaixa($)
  await registrarMostrados($)
}

/**
 * O CI das pistas pedidas pelo nucleo (`ork ci status --sha <head> --json`, D7): pelo evento do GitHub que as cita, pelo
 * relogio de reserva ou pelo dono. Uma consulta por pista por vez. Quando a leitura diz do CI outra coisa que a pista (o
 * CI fechou, ou mudou depois de uma rodada nova), a pista inteira e relida, uma vez por leitura: o proximo passo do
 * nucleo muda com ele.
 */
async function lerCiDe($: EngineInterface, threads: readonly string[], motivo: PistaCi['motivo']): Promise<void> {
  let mudou = false
  for (const thread of threads) {
    const linha = quadro.linhas.find(l => l.thread === thread)
    if (!linha?.pr || linha.pr.estado !== 'aberto' || ciEmCurso.has(thread)) continue
    ciEmCurso.add(thread)
    try {
      const lido = lerCi(await $.process.run(argvDoCi(linha.pr.head), { timeoutMs: PRAZO_DO_CI_MS }), linha.pr.head, await $.clock.now(), motivo)
      const chave = `${thread}|${lido.sha}|${lido.estado}`
      if (mudouOCi(linha, lido) && !relidasPeloCi.has(chave)) {
        relidasPeloCi.add(chave)
        mudou = true
      }
      ci = { ...ci, [thread]: lido }
      await $.state.set(CI, ci)
    } catch (erro) {
      ci = { ...ci, [thread]: { sha: linha.pr.head, estado: 'unavailable', texto: `o CI não foi lido: ${mensagem(erro)}`, url: null,
        lidoEm: await $.clock.now(), motivo } }
      await $.state.set(CI, ci)
    } finally {
      ciEmCurso.delete(thread)
    }
  }
  await publicarFaixa($)
  if (mudou) await atualizar($, true)
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
  // A reserva do CI sem evento do GitHub (D7): so as pistas com PR aberto e CI ainda aberto.
  const vencidas = vencidasDoCi(quadro.linhas, ci, agora, aVista ? INTERVALO_DO_CI_A_VISTA_MS : INTERVALO_DO_CI_ESCONDIDO_MS)
  if (vencidas.length) await lerCiDe($, vencidas, 'consulta')
  await registrarMostrados($)
}

/** A linha da faixa pela ponte (D9), so quando o texto muda; sem nada que peca o dono, a linha sai da faixa. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(comCi(quadro, ci))
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
  const existentes = new Set(linhasDoPainel(comCi(quadro, ci), { agora: 0, foco, acoes }).flatMap(l => (l.mostrado ? [`${l.mostrado.chave}|${l.mostrado.texto}`] : [])))
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

/** Os botoes que o nucleo declara agora, um por pista (D6). */
function botoesDo(q: PistaQuadro): Record<string, BotaoDaPista> {
  const saida: Record<string, BotaoDaPista> = {}
  for (const l of q.linhas) {
    const acao = botaoDaPista(l)
    if (acao) saida[l.thread] = { acao, rotulo: ROTULO_DO_BOTAO[acao] }
  }
  return saida
}

async function gravarAcao($: EngineInterface, thread: string, a: PistaAcao): Promise<void> {
  acoes = { ...acoes, [thread]: a }
  await $.state.set(ACOES, acoes)
}

/**
 * O clique num botao (D6). Primeiro relê so a pista da thread: o clique vale contra o que o nucleo declara agora, e
 * nao contra o desenho de antes. Se a acao continua disponivel, roda o comando do nucleo pelo construtor de argv deste
 * mod (nunca `git` nem `gh`, nunca texto vindo do JSON) e guarda o resultado na linha da pista. Um clique por vez por
 * thread; o painel e relido no fim.
 */
async function acionar($: EngineInterface, thread: string, acao: AcaoDoBotao): Promise<void> {
  if (emCurso.has(thread)) return
  emCurso.add(thread)
  try {
    await gravarAcao($, thread, { acao, estado: 'rodando', texto: '', em: await $.clock.now() })
    let atual: PistaLinha | undefined
    try {
      const relida = lerPista(await $.process.run(argvDaPista(thread), { timeoutMs: PRAZO_DA_PISTA_MS }), await $.clock.now())
      atual = relida.linhas.find(l => l.thread === thread)
    } catch (erro) {
      await gravarAcao($, thread, { acao, estado: 'falhou', texto: `a releitura da pista falhou: ${mensagem(erro)}`, em: await $.clock.now() })
      return
    }
    if (!atual || botaoDaPista(atual) !== acao) {
      const agora = atual ? atual.proximo.texto : 'a thread saiu da pista'
      await gravarAcao($, thread, { acao, estado: 'mudou', texto: `o núcleo não declara mais esta ação: ${agora}`, em: await $.clock.now() })
      return
    }
    try {
      const r = acao === 'publicar'
        ? lerPublicacao(await $.process.run(argvDoPublicar(thread), { timeoutMs: PRAZO_DO_PUBLICAR_MS }))
        : lerRegistro(await $.process.run(argvDoRegistro(thread), { timeoutMs: PRAZO_DO_REGISTRO_MS }), thread)
      await gravarAcao($, thread, { acao, estado: r.estado, texto: r.texto, em: await $.clock.now() })
    } catch (erro) {
      await gravarAcao($, thread, { acao, estado: 'falhou', texto: mensagem(erro), em: await $.clock.now() })
    }
  } finally {
    emCurso.delete(thread)
    await atualizar($, true)
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

  // Uma entrega do GitHub chegou a sessao (D7): o evento que cita o PR, a branch ou o head de uma pista so dispara a
  // consulta do CI pelo nucleo, em segundo plano, e o conteudo dele nunca vira estado. A entrega segue sempre para o
  // modelo, como chegou: a Pista nao consome nem reescreve nada.
  on('session.receive', async ($, e, next) => {
    if (ativa && e.event?.source === 'github') {
      const citadas = pistasDoEvento(e.event, quadro.linhas)
      if (citadas.length) emSegundoPlano($, lerCiDe($, citadas, 'evento'), 'o CI pelo evento do GitHub')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

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
    const ultimas = (await $.state.get(ACOES)).value ?? {}
    const lidos = (await $.state.get(CI)).value ?? {}
    const agora = await $.clock.now()
    const comLeitura = comCi(q, lidos)
    const comProblema: PistaQuadro = problemaSemAviso ? { ...comLeitura, avisos: [...comLeitura.avisos, problemaSemAviso] } : comLeitura
    const botoes = botoesDo(comProblema)
    anotarVistos(mostradosVisiveis(linhasDoPainel(comProblema, { agora, foco: emFoco, acoes: ultimas, botoes }), e.props.scroll, e.props.bodyColumns))
    return desenharPista({ Box, Text, Button }, comProblema, {
      agora, foco: emFoco, acoes: ultimas, botoes,
      atualizar: () => { emSegundoPlano($, atualizar($, true), 'a leitura da pista') },
      publicar: thread => { emSegundoPlano($, acionar($, thread, 'publicar'), 'o botão Publicar') },
      registrar: thread => { emSegundoPlano($, acionar($, thread, 'registrar'), 'o botão Registrar') },
    })
  })
}
