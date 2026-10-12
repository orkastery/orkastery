// A Torre de Controle do Orkastery (RM-059, fatia F1; ficha M3 do plano dos mods). Na sessao do dono, um painel
// com a fabrica inteira: uma linha por thread aberta desta maquina, lida do nucleo pela ponte (`$.ork.retrato`
// e a lista fechada do `$.ork.ler`), nunca de `.orkastery/` por conta propria. A Torre so le: nenhum caminho
// daqui age pelo dono. A logica fica nos modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`,
// sempre escritas como `x.noun.metodo(...)`, como o validador exige.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { TorreDetalhe, TorreLeitura, TorreLinha, TorreMostrado, TorreQuadro, TorreRede } from '../types'
import {
  escolher, ESPERA_DO_LOTE_MS, IDADE_MAXIMA_ESCONDIDO_MS, IDADE_MAXIMA_MS, INTERVALO_ESCONDIDO_MS, INTERVALO_POR_THREAD_MS,
  marcaDoArquivo, PERIODO_DO_TIQUE_MS, vencidas,
} from './agenda'
import type { Dono } from './detalhe'
import {
  desenharDetalhe, donosCarregados, jsonDoMcp, leituraFalha, leituraFeita, linhasDaObservacao, linhasDasClaims, linhasDoDetalhe,
  linhasDoEstado, linhasDoGit, linhasDosEventos,
} from './detalhe'
import {
  abertasDaLista, desenharPainel, linhaDaThread, linhasDoPainel, mostradosDoQuadro, mostradosVisiveis, ordenarLinhas,
} from './painel'
import { PERIODO_DA_REDE_MS, redeComErro, redeDoPanorama, textoDaFaixa } from './rede'

const MOD = 'ork-torre'
const PAINEL = 'torre'
const TITULO = 'Torre'
const QUADRO_VAZIO: TorreQuadro = { linhas: [], omitidas: 0, lidoEm: null, erro: null }
const quadro = atom({ plugin: 'ork-torre', key: 'quadro' } as const, QUADRO_VAZIO)
const aberta = atom({ plugin: 'ork-torre', key: 'aberta' } as const, null as string | null)
const detalhes = atom({ plugin: 'ork-torre', key: 'detalhes' } as const, {} as Record<string, TorreDetalhe>)
const donos = atom({ plugin: 'ork-torre', key: 'donos' } as const, {} as Record<string, string>)
const rede = atom({ plugin: 'ork-torre', key: 'rede' } as const, null as TorreRede | null)
const fechado = atom({ plugin: 'ork-torre', key: 'fechado' } as const, false)
const DETALHE_VAZIO: TorreDetalhe = { eventos: null, claims: null, leituras: {} }
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
/** Depois delas, enquanto dormente, a cada 5 min: o servidor pode conectar tarde ou ser reconectado. */
const ESPERA_LONGA_DO_PAPEL_MS = 300000
/** Teto de cada leitura do nucleo: leitura que nao volta nao trava o laco de leitura (o retrato tem teto de 10 s). */
const PRAZO_DA_LEITURA_MS = 20000

// O que o modulo guarda entre ganchos e nao desenha. Uma recarga do modulo zera tudo, e o `session.start`
// dispara de novo nela; o estado em `$.state` (o quadro, o detalhe, o painel fechado) fica.
let ativa = false
let desistiu = false
let abriuSozinho = false
let ciclo: { cancel: () => void } | undefined
let lote: { cancel: () => void } | undefined
let lendo: Promise<void> | undefined
let pendente = false
let tudoPedido = false
let listaPedida = true
let listaLidaEm: number | null = null
const marcadas = new Set<string>()
const threadLidaEm: Record<string, number> = {}
/** O que o desenho poe na janela de rolagem e ainda nao foi ao registro da ponte (D10). */
const vistosNoDesenho = new Map<string, TorreMostrado>()
/** O que ja foi ao registro nesta sessao, por chave e texto; sai quando o item some do quadro. */
const jaMostrado = new Set<string>()
/** A ultima tentativa de ler a rede (comeca na ativacao: nunca no inicio da sessao, D11). */
let redeTentadaEm = 0
/** O ultimo texto publicado na faixa; null antes da primeira publicacao. */
let ultimaFaixa: string | undefined | null = null

function mensagem(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** A leitura com teto proprio: o relogio da sessao recusa a espera que passar dele. */
function comPrazo<T>($: EngineInterface, leitura: Promise<T>, ms = PRAZO_DA_LEITURA_MS): Promise<T> {
  return new Promise<T>((resolver, recusar) => {
    const prazo = $.clock.after(ms, () => recusar(new Error(`a leitura passou de ${Math.round(ms / 1000)} s`)))
    leitura.then(v => { prazo.cancel(); resolver(v) }, e => { prazo.cancel(); recusar(e) })
  })
}

/**
 * O papel pela ponte. `null` so quando o `$.ork` nao existe (a ponte nao carregou: a chamada nem acontece);
 * uma falha da propria ponte conta como dormente e o papel e conferido de novo depois.
 */
async function papelDaSessao($: EngineInterface): Promise<string | null> {
  try {
    return String(await $.ork.papel())
  } catch (erro) {
    return erro instanceof TypeError ? null : 'dormente'
  }
}

/** Liga a Torre na sessao do dono (D12): o `/torre`, o tique e a primeira leitura. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  redeTentadaEm = await $.clock.now()
  await $.command.register({ name: 'torre', description: 'Abre a Torre de Controle: a fábrica do Orkastery num painel', immediate: true })
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DO_TIQUE_MS, () => { void tique($) })
  agendar($, 1)
}

/** Confere o papel: liga no dono, desiste na fase ou sem a ponte, e tenta de novo enquanto dormente. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativar($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('torre: a ponte ork-ponte não carregou; a Torre de Controle fica desligada nesta sessão')
    return
  }
  const espera = ESPERAS_DO_PAPEL_MS[tentativa] ?? ESPERA_LONGA_DO_PAPEL_MS
  $.clock.after(espera, () => { void conferirPapel($, tentativa + 1) })
}

/** Um lote de leitura daqui a pouco, um por vez: os eventos de arquivo se juntam nele (D7). */
function agendar($: EngineInterface, ms = ESPERA_DO_LOTE_MS): void {
  if (lote) return
  lote = $.clock.after(Math.max(1, ms), () => {
    lote = undefined
    void atualizar($)
  })
}

/** O painel da Torre esta posto e a vista do dono. */
async function painelAVista($: EngineInterface): Promise<boolean> {
  const paineis = await $.ui.panes().catch(() => [])
  return paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)
}

/** O tique do minuto: a lista das abertas, as linhas que ficaram velhas e, com o painel a vista, a rede. */
async function tique($: EngineInterface): Promise<void> {
  if (!ativa) return
  const agora = await $.clock.now()
  const aVista = await painelAVista($)
  listaPedida = true
  const idade = aVista ? IDADE_MAXIMA_MS : IDADE_MAXIMA_ESCONDIDO_MS
  for (const t of vencidas((await read($, quadro)).linhas.map(l => l.thread), threadLidaEm, agora, idade)) marcadas.add(t)
  await atualizar($)
  if (aVista && agora - redeTentadaEm >= PERIODO_DA_REDE_MS) await lerRede($)
  await registrarMostrados($)
}

/** A rede pelo panorama do nucleo (D11): pelo botao, ou no tique com o painel a vista, no maximo a cada 10 min. */
async function lerRede($: EngineInterface): Promise<void> {
  const agora = await $.clock.now()
  redeTentadaEm = agora
  const locais = (await read($, quadro)).linhas.map(l => l.thread)
  try {
    const nova = redeDoPanorama(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_network_roadmap', {}))), locais, agora)
    await update($, rede, () => nova)
  } catch (erro) {
    const motivo = mensagem(erro)
    await update($, rede, anterior => redeComErro(anterior, motivo))
  }
  await publicarFaixa($)
}

/** A linha da faixa pela ponte (D9), so quando o texto muda; sem quadro lido, a linha sai da faixa. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(await read($, quadro), await read($, rede))
  if (texto === ultimaFaixa) return
  try {
    if (texto === undefined) await $.ork.faixa({ mod: MOD })
    else await $.ork.faixa({ mod: MOD, texto })
    ultimaFaixa = texto
  } catch {
    // A ponte recusou ou falhou: a proxima leitura tenta de novo.
  }
}

/** Uma leitura por vez; pedido que chega no meio volta a rodar logo depois, e quem pediu espera as duas. */
async function atualizar($: EngineInterface, tudo = false): Promise<void> {
  if (!ativa) return
  if (tudo) { tudoPedido = true; listaPedida = true }
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

/** O retrato de uma thread pela ponte; a linha so conta como lida quando o retrato veio (S2 da revisao). */
async function lerThread($: EngineInterface, thread: string, agora: number): Promise<TorreLinha> {
  try {
    const r = await comPrazo($, $.ork.retrato({ thread }))
    threadLidaEm[thread] = agora
    return linhaDaThread(thread, r.retrato, { fonte: r.fonte, lidoEm: r.lidoEm })
  } catch (erro) {
    return linhaDaThread(thread, null, { fonte: null, lidoEm: null, erro: mensagem(erro) })
  }
}

async function lerUmaVez($: EngineInterface): Promise<void> {
  const tudo = tudoPedido
  tudoPedido = false
  const agora = await $.clock.now()
  const atual = await read($, quadro)
  let abertas = atual.linhas.map(l => l.thread)
  let omitidas = atual.omitidas
  let lidoEm = atual.lidoEm
  let erro = atual.erro
  if (listaPedida || listaLidaEm === null || agora - listaLidaEm >= PERIODO_DO_TIQUE_MS) {
    listaPedida = false
    try {
      const lista = abertasDaLista(await comPrazo($, $.ork.ler({ consulta: 'thread.list' })))
      abertas = lista.ids
      omitidas = lista.omitidas
      listaLidaEm = agora
      lidoEm = agora
      erro = null
    } catch (e) {
      erro = mensagem(e)
    }
  }
  const conhecidas = new Set(atual.linhas.map(l => l.thread))
  const pedidas = tudo ? abertas : abertas.filter(t => marcadas.has(t) || !conhecidas.has(t))
  const intervalo = (await painelAVista($)) ? INTERVALO_POR_THREAD_MS : INTERVALO_ESCONDIDO_MS
  const escolha = tudo ? { ler: pedidas, adiadas: [] as string[], proximaEm: null } : escolher(pedidas, threadLidaEm, agora, intervalo)
  for (const t of [...marcadas]) if (pedidas.includes(t) || !abertas.includes(t)) marcadas.delete(t)
  for (const t of escolha.adiadas) marcadas.add(t)
  const novas = new Map<string, TorreLinha>()
  for (const t of escolha.ler) novas.set(t, await lerThread($, t, agora))
  await update($, quadro, anterior => {
    const antigas = new Map(anterior.linhas.map(l => [l.thread, l]))
    const linhas = abertas.map(t => novas.get(t) ?? antigas.get(t) ??
      linhaDaThread(t, null, { fonte: null, lidoEm: null, erro: 'ainda não lida' }))
    return { linhas: ordenarLinhas(linhas), omitidas, lidoEm, erro }
  })
  if (escolha.proximaEm !== null) agendar($, escolha.proximaEm - agora)
  await publicarFaixa($)
  await registrarMostrados($)
}

/** So a thread do detalhe, pelo Atualizar dele: o resto do quadro fica como esta (D16). */
async function releerThread($: EngineInterface, thread: string): Promise<void> {
  const linha = await lerThread($, thread, await $.clock.now())
  await update($, quadro, anterior => (anterior.linhas.some(l => l.thread === thread)
    ? { ...anterior, linhas: ordenarLinhas(anterior.linhas.map(l => (l.thread === thread ? linha : l))) }
    : anterior))
  await publicarFaixa($)
}

/**
 * O que o desenho pos na janela de rolagem do painel posto e a vista vai ao registro da ponte (M5 do dono,
 * D10), uma vez por chave e texto enquanto o item existir no quadro: o Telegram nao repete o que o dono ja viu
 * no terminal, e nada que nao estava na tela entra.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  const existentes = new Set(mostradosDoQuadro(await read($, quadro)).map(m => `${m.chave}|${m.texto}`))
  for (const vista of [...jaMostrado]) if (!existentes.has(vista)) jaMostrado.delete(vista)
  if (vistosNoDesenho.size === 0 || !await painelAVista($)) return
  for (const [vista, m] of [...vistosNoDesenho]) {
    vistosNoDesenho.delete(vista)
    if (jaMostrado.has(vista) || !existentes.has(vista)) continue
    try {
      await $.ork.mostrado({ mod: MOD, canal: 'painel', chave: m.chave, thread: m.thread, texto: m.texto })
      jaMostrado.add(vista)
    } catch {
      // A ponte recusou ou falhou: volta para a proxima vez.
      vistosNoDesenho.set(vista, m)
    }
  }
}

/** O desenho anota o que pos na janela; quem registra e o laco de leitura, fora do desenho. */
function anotarVistos(vistos: readonly TorreMostrado[]): void {
  for (const m of vistos) vistosNoDesenho.set(`${m.chave}|${m.texto}`, m)
}

/** Grava o que o detalhe leu de uma thread, so se ela ainda e a aberta: leitura atrasada nao apaga a de outra. */
async function gravarDetalhe($: EngineInterface, thread: string, mudar: (d: TorreDetalhe) => TorreDetalhe): Promise<void> {
  if ((await read($, aberta)) !== thread) return
  await update($, detalhes, todos => ({ ...todos, [thread]: mudar(todos[thread] ?? DETALHE_VAZIO) }))
}

/** Os comandos dos mods donos carregados agora, pelo plugin que registrou cada um (D4). */
async function lerDonos($: EngineInterface): Promise<Record<string, string>> {
  const carregados = donosCarregados(await $.command.list().catch(() => []))
  await update($, donos, () => carregados)
  return carregados
}

/** Ao abrir o detalhe: os donos das acoes, os ultimos eventos e as claims com estado da thread. */
async function carregarDetalhe($: EngineInterface, thread: string): Promise<void> {
  await lerDonos($)
  const agora = await $.clock.now()
  let eventos: TorreLeitura
  try {
    eventos = leituraFeita(linhasDosEventos(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_phase_list', { threadId: thread }))), agora), agora)
  } catch (erro) {
    eventos = leituraFalha(mensagem(erro), agora)
  }
  let claims: TorreLeitura
  try {
    claims = leituraFeita(linhasDasClaims(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_claims_list', { threadId: thread })))), agora)
  } catch (erro) {
    claims = leituraFalha(mensagem(erro), agora)
  }
  await gravarDetalhe($, thread, d => ({ ...d, eventos, claims }))
}

async function abrir($: EngineInterface, thread: string): Promise<void> {
  await update($, aberta, () => thread)
  await update($, detalhes, todos => ({ ...todos, [thread]: DETALHE_VAZIO }))
  await carregarDetalhe($, thread)
  await registrarMostrados($)
}

async function recarregar($: EngineInterface, thread: string): Promise<void> {
  await releerThread($, thread)
  await carregarDetalhe($, thread)
  await registrarMostrados($)
}

/** As tres acoes de leitura do retrato (D4): o resultado vai para o detalhe, e nada mais roda. */
async function lerAcao($: EngineInterface, thread: string, operacao: string): Promise<void> {
  const agora = await $.clock.now()
  let leitura: TorreLeitura
  try {
    if (operacao === 'thread.status') {
      leitura = leituraFeita(linhasDoEstado(await comPrazo($, $.ork.ler({ consulta: 'thread.status', thread })), agora), agora)
    } else if (operacao === 'thread.observe') {
      leitura = leituraFeita(linhasDaObservacao(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_observe', { threadId: thread })))), agora)
    } else if (operacao === 'git.status') {
      leitura = leituraFeita(linhasDoGit(jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_git_status', { threadId: thread })))), agora)
    } else return
  } catch (erro) {
    leitura = leituraFalha(mensagem(erro), agora)
  }
  await gravarDetalhe($, thread, d => ({ ...d, leituras: { ...d.leituras, [operacao]: leitura } }))
  await registrarMostrados($)
}

/**
 * A acao com efeito vai ao mod dono dela (D4): o comando dele roda como se o dono o digitasse, com o id da
 * thread, so se a lista de comandos agora o mostra registrado pelo plugin esperado. Senao, o detalhe redesenha
 * com o comando do `ork` em texto, e nada roda.
 */
async function abrirMod($: EngineInterface, thread: string, dono: Dono): Promise<void> {
  const carregados = await lerDonos($)
  if (carregados[dono.comando] !== dono.plugin) return
  await $.command.run({ command: dono.comando, args: thread }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // `/torre` abre o painel em qualquer largura e rele tudo; o dono pediu, entao o painel volta a poder abrir
  // sozinho. O comando so existe com a Torre ligada; a conferencia do papel aqui so cobre o caso raro de o
  // comando ter sobrado de uma carga anterior.
  on('command.run', { command: 'torre' }, async $ => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'A Torre de Controle só abre na sessão do dono de um projeto do Orkastery.' }
    await update($, fechado, () => false)
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    await atualizar($, true)
    return { text: aberto.isPlaced ? 'Torre de Controle aberta.' : `Torre de Controle aberta, à espera de lugar: ${aberto.reason}` }
  })

  // O dono fechou o painel (a Torre nunca fecha o proprio): ele nao abre mais sozinho nesta sessao, nem depois
  // de uma recarga do modulo. O fechamento segue sempre.
  on('ui.close', { id: PAINEL }, async ($, e, next) => {
    if (e.origin.kind !== 'unload') await update($, fechado, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  // O ledger de uma thread ou a pasta das threads mudou: a releitura entra no proximo lote (D7). Os caminhos
  // vigiados sao os que a ponte pede para o papel dono; a Torre nao pede outros.
  on('classic.FileChanged', async ($, e, next) => {
    if (ativa) {
      const marca = marcaDoArquivo(e.file_path)
      if (marca?.tipo === 'thread') marcadas.add(marca.thread)
      if (marca?.tipo === 'lista') listaPedida = true
      if (marca) agendar($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // D8: sozinho, o painel so abre no fullscreen, uma vez, e nunca depois que o dono o fechou. A linha de dicas
  // e desenhada em toda sessao do terminal e do desktop e traz o viewport; este gancho nao desenha nada e
  // devolve a linha intacta.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (ativa && !abriuSozinho && e.viewport?.isFullscreen === true && !(await read($, fechado))) {
      abriuSozinho = true
      void $.ui.open({ id: PAINEL, title: TITULO }).catch(() => undefined)
    }
    return next(e)
  })

  // O painel: a lista das threads, ou o detalhe da thread aberta (T1.2). O desenho nunca escreve: so anota o
  // que pos na janela de rolagem, para o registro do mostrado (D10). Os gestos mudam o estado da Torre e leem o
  // nucleo.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const q = await read($, quadro)
    const agora = await $.clock.now()
    const id = await read($, aberta)
    const linha = id === null ? undefined : q.linhas.find(l => l.thread === id)
    if (linha) {
      const detalhe = (await read($, detalhes))[linha.thread]
      anotarVistos(mostradosVisiveis(linhasDoDetalhe(linha, detalhe, agora), 1, e.props.scroll))
      return desenharDetalhe({ Box, Text, Button }, linha, detalhe, await read($, donos), {
        agora,
        voltar: () => update($, aberta, () => null),
        atualizar: () => recarregar($, linha.thread),
        ler: operacao => lerAcao($, linha.thread, operacao),
        abrirMod: dono => abrirMod($, linha.thread, dono),
      })
    }
    const daRede = await read($, rede)
    anotarVistos(mostradosVisiveis(linhasDoPainel(q, { agora, rede: daRede }), 0, e.props.scroll))
    return desenharPainel({ Box, Text, Button }, q, {
      agora, largura: e.props.bodyColumns, abrir: thread => abrir($, thread), rede: daRede, lerRede: () => lerRede($),
    })
  })
}
