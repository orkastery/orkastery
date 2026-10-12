// A Torre de Controle do Orkastery (RM-059, fatia F1; ficha M3 do plano dos mods). Na sessao do dono, um painel
// com a fabrica inteira: uma linha por thread aberta desta maquina, lida do nucleo pela ponte (`$.ork.retrato`
// e a lista fechada do `$.ork.ler`), nunca de `.orkastery/` por conta propria. A Torre so le: nenhum caminho
// daqui age pelo dono. A logica fica nos modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`,
// sempre escritas como `x.noun.metodo(...)`, como o validador exige.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { TorreDetalhe, TorreLeitura, TorreLinha, TorreQuadro } from '../types'
import { escolher, ESPERA_DO_LOTE_MS, marcaDoArquivo, PERIODO_DO_TIQUE_MS, vencidas } from './agenda'
import type { Dono } from './detalhe'
import {
  desenharDetalhe, donosCarregados, jsonDoMcp, leituraFalha, leituraFeita, linhasDaObservacao, linhasDasClaims, linhasDoEstado,
  linhasDoGit, linhasDosEventos,
} from './detalhe'
import { abertasDaLista, desenharPainel, linhaDaThread, mostradosDoQuadro, ordenarLinhas } from './painel'

const MOD = 'ork-torre'
const PAINEL = 'torre'
const TITULO = 'Torre'
const QUADRO_VAZIO: TorreQuadro = { linhas: [], omitidas: 0, lidoEm: null, erro: null }
const quadro = atom({ plugin: 'ork-torre', key: 'quadro' } as const, QUADRO_VAZIO)
const aberta = atom({ plugin: 'ork-torre', key: 'aberta' } as const, null as string | null)
const detalhes = atom({ plugin: 'ork-torre', key: 'detalhes' } as const, {} as Record<string, TorreDetalhe>)
const donos = atom({ plugin: 'ork-torre', key: 'donos' } as const, {} as Record<string, string>)
const DETALHE_VAZIO: TorreDetalhe = { eventos: null, claims: null, leituras: {} }
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]

// O que o modulo guarda entre ganchos e nao desenha. Uma recarga do modulo zera tudo; o `/torre` confere o
// papel de novo e recomeca.
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
const jaMostrado = new Set<string>()

function mensagem(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** O papel pela ponte; `null` quando a ponte nao respondeu (o `$.ork` nao existe sem ela). */
async function papelDaSessao($: EngineInterface): Promise<string | null> {
  try {
    return String(await $.ork.papel())
  } catch {
    return null
  }
}

/** Liga a Torre na sessao do dono (D12): o `/torre`, o tique e a primeira leitura. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
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
    if (papel === null) $.ui.toast('torre: a ponte ork-ponte não respondeu; a Torre de Controle fica desligada nesta sessão')
    return
  }
  const espera = ESPERAS_DO_PAPEL_MS[tentativa]
  if (espera !== undefined) $.clock.after(espera, () => { void conferirPapel($, tentativa + 1) })
}

/** Um lote de leitura daqui a pouco, um por vez: os eventos de arquivo se juntam nele (D7). */
function agendar($: EngineInterface, ms = ESPERA_DO_LOTE_MS): void {
  if (lote) return
  lote = $.clock.after(Math.max(1, ms), () => {
    lote = undefined
    void atualizar($)
  })
}

/** O tique do minuto: a lista das abertas e as linhas que ficaram velhas. */
async function tique($: EngineInterface): Promise<void> {
  if (!ativa) return
  const agora = await $.clock.now()
  listaPedida = true
  for (const t of vencidas((await read($, quadro)).linhas.map(l => l.thread), threadLidaEm, agora)) marcadas.add(t)
  await atualizar($)
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

async function lerThread($: EngineInterface, thread: string): Promise<TorreLinha> {
  try {
    const r = await $.ork.retrato({ thread })
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
      const lista = abertasDaLista(await $.ork.ler({ consulta: 'thread.list' }))
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
  const escolha = tudo ? { ler: pedidas, adiadas: [] as string[], proximaEm: null } : escolher(pedidas, threadLidaEm, agora)
  for (const t of [...marcadas]) if (pedidas.includes(t) || !abertas.includes(t)) marcadas.delete(t)
  for (const t of escolha.adiadas) marcadas.add(t)
  const novas = new Map<string, TorreLinha>()
  for (const t of escolha.ler) {
    novas.set(t, await lerThread($, t))
    threadLidaEm[t] = agora
  }
  await update($, quadro, anterior => {
    const antigas = new Map(anterior.linhas.map(l => [l.thread, l]))
    const linhas = abertas.map(t => novas.get(t) ?? antigas.get(t) ??
      linhaDaThread(t, null, { fonte: null, lidoEm: null, erro: 'ainda não lida' }))
    return { linhas: ordenarLinhas(linhas), omitidas, lidoEm, erro }
  })
  if (escolha.proximaEm !== null) agendar($, escolha.proximaEm - agora)
  await registrarMostrados($)
}

/**
 * O que o painel mostra entra no registro da ponte (M5 do dono, D10), so com o painel posto e a vista, uma
 * vez por chave e texto: o Telegram nao repete o que o dono ja viu no terminal.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  const paineis = await $.ui.panes().catch(() => [])
  if (!paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)) return
  for (const m of mostradosDoQuadro(await read($, quadro))) {
    const vista = `${m.chave}|${m.texto}`
    if (jaMostrado.has(vista)) continue
    try {
      await $.ork.mostrado({ mod: MOD, canal: 'painel', chave: m.chave, thread: m.thread, texto: m.texto })
      jaMostrado.add(vista)
    } catch {
      // A ponte recusou ou falhou: tenta de novo na proxima leitura.
    }
  }
}

/** Grava o que o detalhe leu de uma thread; so o detalhe aberto fica guardado. */
async function gravarDetalhe($: EngineInterface, thread: string, mudar: (d: TorreDetalhe) => TorreDetalhe): Promise<void> {
  await update($, detalhes, todos => ({ [thread]: mudar(todos[thread] ?? DETALHE_VAZIO) }))
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
    eventos = leituraFeita(linhasDosEventos(jsonDoMcp(await $.mcp.call('orkastery', 'ork_phase_list', { threadId: thread })), agora), agora)
  } catch (erro) {
    eventos = leituraFalha(mensagem(erro), agora)
  }
  let claims: TorreLeitura
  try {
    claims = leituraFeita(linhasDasClaims(jsonDoMcp(await $.mcp.call('orkastery', 'ork_claims_list', { threadId: thread }))), agora)
  } catch (erro) {
    claims = leituraFalha(mensagem(erro), agora)
  }
  await gravarDetalhe($, thread, d => ({ ...d, eventos, claims }))
}

async function abrir($: EngineInterface, thread: string): Promise<void> {
  await update($, aberta, () => thread)
  await update($, detalhes, () => ({ [thread]: DETALHE_VAZIO }))
  await carregarDetalhe($, thread)
}

async function recarregar($: EngineInterface, thread: string): Promise<void> {
  await atualizar($, true)
  await carregarDetalhe($, thread)
}

/** As tres acoes de leitura do retrato (D4): o resultado vai para o detalhe, e nada mais roda. */
async function lerAcao($: EngineInterface, thread: string, operacao: string): Promise<void> {
  const agora = await $.clock.now()
  let leitura: TorreLeitura
  try {
    if (operacao === 'thread.status') {
      leitura = leituraFeita(linhasDoEstado(await $.ork.ler({ consulta: 'thread.status', thread }), agora), agora)
    } else if (operacao === 'thread.observe') {
      leitura = leituraFeita(linhasDaObservacao(jsonDoMcp(await $.mcp.call('orkastery', 'ork_observe', { threadId: thread }))), agora)
    } else if (operacao === 'git.status') {
      leitura = leituraFeita(linhasDoGit(jsonDoMcp(await $.mcp.call('orkastery', 'ork_git_status', { threadId: thread }))), agora)
    } else return
  } catch (erro) {
    leitura = leituraFalha(mensagem(erro), agora)
  }
  await gravarDetalhe($, thread, d => ({ ...d, leituras: { ...d.leituras, [operacao]: leitura } }))
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

  // `/torre` abre o painel em qualquer largura e rele tudo. Depois de uma recarga do modulo, confere o papel.
  on('command.run', { command: 'torre' }, async $ => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'A Torre de Controle só abre na sessão do dono de um projeto do Orkastery.' }
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    await atualizar($, true)
    return { text: aberto.isPlaced ? 'Torre de Controle aberta.' : `Torre de Controle aberta, à espera de lugar: ${aberto.reason}` }
  })

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

  // D8: sozinho, o painel so abre no fullscreen. A linha de dicas e desenhada em toda sessao do terminal e do
  // desktop e traz o viewport; este gancho nao desenha nada e devolve a linha intacta.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (ativa && !abriuSozinho && e.viewport?.isFullscreen === true) {
      abriuSozinho = true
      void $.ui.open({ id: PAINEL, title: TITULO }).catch(() => undefined)
    }
    return next(e)
  })

  // O painel: a lista das threads, ou o detalhe da thread aberta (T1.2). Os gestos so mudam o estado da Torre
  // e leem o nucleo; o desenho nunca escreve.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const q = await read($, quadro)
    const agora = await $.clock.now()
    const id = await read($, aberta)
    const linha = id === null ? undefined : q.linhas.find(l => l.thread === id)
    if (linha) {
      return desenharDetalhe({ Box, Text, Button }, linha, (await read($, detalhes))[linha.thread], await read($, donos), {
        agora,
        voltar: () => update($, aberta, () => null),
        atualizar: () => recarregar($, linha.thread),
        ler: operacao => lerAcao($, linha.thread, operacao),
        abrirMod: dono => abrirMod($, linha.thread, dono),
      })
    }
    return desenharPainel({ Box, Text, Button }, q, { agora, abrir: thread => abrir($, thread) })
  })
}
