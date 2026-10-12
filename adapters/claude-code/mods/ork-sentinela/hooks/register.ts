// A Sentinela do Condutor do Orkastery (RM-059, fatia F6; ficha M2 do plano dos mods). Na sessão do dono, mantém a
// presença dela nesta máquina pelo núcleo, para o condutor externo ceder o despacho (DD5), relê o passo do condutor
// de cada thread aberta quando um ledger muda e a cada batida, e despacha a fase seguinte das threads #Auto que o
// núcleo manda despachar, só pelo `ork phase run` e uma vez por turno (T6.2); e avisa o dono, por notificação e na
// faixa, do que só ele resolve, com o próximo passo do núcleo (T6.3), registrando pela ponte o que mostrou para o
// Telegram não repetir. Lê só pelo núcleo (o `ork` e o `$.ork` da ponte), nunca `.orkastery/` por conta própria, e
// nunca assume a condução de ninguém. A lógica fica nos módulos
// puros ao lado; aqui só os ganchos e as chamadas ao `$`, escritas como `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { SentinelaEntrada, SentinelaPasso, SentinelaPresenca, SentinelaResumo } from '../types'
import {
  AMBIENTE_DA_RETOMADA, argvDaRetomada, argvDoDespacho, argvDoRender, chaveDaRetomada, chaveDoDespacho, conducaoLivre, lerDespacho,
  lerRetomada, paraDespachar, paraRetomar, pedidoAbertoNoRetrato, PRAZO_DA_RETOMADA_MS, PRAZO_DO_DESPACHO_MS, PRAZO_DO_RENDER_MS,
  promptDoRender, retomadaAutomatica,
} from './despacho'
import type { ResultadoDoDespacho } from './despacho'
import { avisoDoDespacho, avisosDoPulse, avisosNovos, marcaDoAviso, PERIODO_DO_PULSE_MS, TITULO } from './alertas'
import type { Aviso } from './alertas'
import {
  acrescentar, argvDaBatida, argvDoDesligar, argvDoStatus, BATIDA_MS, entrada, ESPERA_DO_LEDGER_MS, guardarChave, lerBatida, lerStatus, MOD,
  PRAZO_DA_BATIDA_MS, PRAZO_DO_STATUS_MS, sessaoValida, TETO_DO_DIARIO, textoDaFaixa, textoDoDiario, threadDoLedger,
} from './vigia'

const RESUMO_VAZIO: SentinelaResumo = { lidoEm: null, presenca: 'desconhecida', passos: [], erro: null }
const REF_DIARIO = { plugin: 'ork-sentinela', key: 'diario' } as const
const REF_PAUSADA = { plugin: 'ork-sentinela', key: 'pausada' } as const
const REF_RESUMO = { plugin: 'ork-sentinela', key: 'resumo' } as const
const REF_DESPACHADOS = { plugin: 'ork-sentinela', key: 'despachados' } as const
const REF_RETOMADOS = { plugin: 'ork-sentinela', key: 'retomados' } as const
const REF_AVISADOS = { plugin: 'ork-sentinela', key: 'avisados' } as const

/**
 * O estado desta carga. Um despacho do host lê o `$.state` do momento em que começou, e a segunda gravação com
 * `ifVersion` no mesmo despacho nunca acerta (o `update` do motor ficaria em laço): a fonte da verdade é esta memória
 * do módulo, carregada do estado uma vez na ativação (depois de uma recarga, o que a carga anterior gravou), e cada
 * mudança vai ao estado por `$.state.set` sem versão. Os despachos deste módulo rodam um de cada vez no mesmo laço de
 * eventos, então a memória nunca diverge do que foi gravado por último.
 */
const memoria = {
  diario: [] as SentinelaEntrada[], pausada: false, resumo: RESUMO_VAZIO, despachados: [] as string[], retomados: [] as string[],
  avisados: [] as string[],
}
type Chave = keyof typeof memoria
/** O servidor do núcleo pode conectar depois do início da sessão: o papel é conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
/** Depois delas, enquanto dormente, a cada 5 min. */
const ESPERA_LONGA_DO_PAPEL_MS = 300000
/** A primeira rodada sai logo depois da ativação, fora do início da sessão. */
const ESPERA_DA_PRIMEIRA_MS = 1000
/** Ledgers mudam o tempo todo com sessões vivas: entre duas rodadas pedidas por arquivo, pelo menos isto. */
const INTERVALO_MINIMO_MS = 15000

// O que o módulo guarda entre ganchos. Uma recarga do módulo zera tudo, e o `session.start` dispara de novo nela; o
// diário, a pausa e a última leitura ficam em `$.state`.
let ativa = false
let desistiu = false
/** O id desta sessão do Claude Code, relido a cada batida: um `/clear` continua o processo com outro. */
let sessao: string | null = null
let ciclo: { cancel: () => void } | undefined
let acordar: { cancel: () => void } | undefined
let rodando: Promise<void> | undefined
let pendente = false
let ultimaRodadaEm = 0
/**
 * A última linha publicada na faixa. `null` é "não sei": uma carga nova não sabe o que a anterior deixou na faixa
 * da ponte, então a primeira publicação sempre acontece, inclusive a que tira a linha.
 */
let ultimaFaixa: string | undefined | null = null
/** A falha de uma rodada em segundo plano que nem o diário registrou; o `/sentinela` a mostra. */
let falhaSemRegistro: string | null = null
/** Quando o pulse foi lido pela última vez nesta carga, e quantos avisos ele trouxe (a faixa os conta). */
let ultimoPulseEm = Number.NEGATIVE_INFINITY
let avisosAtuais = 0

function mensagem(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Carrega a memória do estado: o que esta sessão (ou a carga anterior do módulo) já gravou. */
async function carregarMemoria($: EngineInterface): Promise<void> {
  memoria.diario = (await $.state.get(REF_DIARIO)).value ?? []
  memoria.pausada = (await $.state.get(REF_PAUSADA)).value ?? false
  memoria.resumo = (await $.state.get(REF_RESUMO)).value ?? RESUMO_VAZIO
  memoria.despachados = (await $.state.get(REF_DESPACHADOS)).value ?? []
  memoria.retomados = (await $.state.get(REF_RETOMADOS)).value ?? []
  memoria.avisados = (await $.state.get(REF_AVISADOS)).value ?? []
}

/** Muda uma chave da memória e a grava no estado, sem versão: a memória é a fonte desta carga. */
async function mudar<K extends Chave>($: EngineInterface, chave: K, mudanca: (atual: (typeof memoria)[K]) => (typeof memoria)[K]): Promise<void> {
  memoria[chave] = mudanca(memoria[chave])
  if (chave === 'diario') await $.state.set(REF_DIARIO, memoria.diario)
  else if (chave === 'pausada') await $.state.set(REF_PAUSADA, memoria.pausada)
  else if (chave === 'resumo') await $.state.set(REF_RESUMO, memoria.resumo)
  else if (chave === 'despachados') await $.state.set(REF_DESPACHADOS, memoria.despachados)
  else if (chave === 'retomados') await $.state.set(REF_RETOMADOS, memoria.retomados)
  else await $.state.set(REF_AVISADOS, memoria.avisados)
}

/**
 * O papel pela ponte. `null` só quando o `$.ork` não existe (a ponte não carregou: a chamada nem acontece); uma falha
 * da própria ponte conta como dormente e o papel é conferido de novo depois.
 */
async function papelDaSessao($: EngineInterface): Promise<string | null> {
  try {
    return String(await $.ork.papel())
  } catch (erro) {
    return erro instanceof TypeError ? null : 'dormente'
  }
}

/** Uma linha no diário, sem repetir a anterior igual (a mesma falha a cada batida vira uma linha só). */
async function anotar($: EngineInterface, e: SentinelaEntrada): Promise<void> {
  await mudar($, 'diario', d => {
    const ultima = d[d.length - 1]
    if (ultima && ultima.tipo === e.tipo && ultima.thread === e.thread && ultima.texto === e.texto) return d
    return acrescentar(d, e, TETO_DO_DIARIO)
  })
}

/** Liga a Sentinela na sessão do dono: o `/sentinela`, a batida de 60 s e a primeira rodada. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  await carregarMemoria($)
  await $.command.register({
    name: 'sentinela', description: 'Sentinela do Condutor: o passo de cada thread e o diário do que ela despachou, cedeu e avisou; pausar ou retomar',
    immediate: true,
  })
  ciclo?.cancel()
  ciclo = $.clock.every(BATIDA_MS, () => { void pedirRodada($, true) })
  $.clock.after(ESPERA_DA_PRIMEIRA_MS, () => { void pedirRodada($, true) })
}

/** Confere o papel: liga no dono, desiste na fase ou sem a ponte, e tenta de novo enquanto dormente. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativar($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('sentinela: a ponte ork-ponte não carregou; a Sentinela do Condutor fica desligada nesta sessão')
    return
  }
  const espera = ESPERAS_DO_PAPEL_MS[tentativa] ?? ESPERA_LONGA_DO_PAPEL_MS
  $.clock.after(espera, () => { void conferirPapel($, tentativa + 1) })
}

/**
 * Uma rodada por vez. Com uma em andamento, o pedido só marca que outra deve rodar logo depois e volta sem nada para
 * esperar: quem pediu nunca espera a rodada de outro despacho, cuja espera contaria no orçamento do gancho. A rodada
 * da batida também renova a presença. Devolve a rodada só a quem a começou.
 */
function pedirRodada($: EngineInterface, comBatida: boolean): Promise<void> | undefined {
  if (!ativa) return undefined
  if (rodando) {
    pendente = true
    return undefined
  }
  const esta = (async () => {
    try {
      let batida = comBatida
      do {
        pendente = false
        await rodadaUmaVez($, batida)
        batida = false
      } while (pendente)
    } catch (erro) {
      // O `$` pode já não responder (a sessão fechou): o motivo fica numa variável do módulo, sem depender dele.
      falhaSemRegistro = mensagem(erro)
    } finally {
      rodando = undefined
    }
  })()
  rodando = esta
  return esta
}

/** Um ledger mudou: a rodada sai depois de juntar as linhas do mesmo evento, e nunca antes do intervalo mínimo. */
function agendar($: EngineInterface, agora: number): void {
  if (acordar) return
  const espera = Math.max(ESPERA_DO_LEDGER_MS, ultimaRodadaEm + INTERVALO_MINIMO_MS - agora)
  acordar = $.clock.after(espera, () => { acordar = undefined; void pedirRodada($, false) })
}

/** A batida da presença desta sessão; falha vira linha do diário e presença desconhecida. */
async function bater($: EngineInterface): Promise<SentinelaPresenca> {
  sessao = await $.session.id().catch(() => sessao)
  if (!sessaoValida(sessao)) return 'desconhecida'
  try {
    return lerBatida(await $.process.run(argvDaBatida(sessao), { timeoutMs: PRAZO_DA_BATIDA_MS }))
  } catch (erro) {
    await anotar($, entrada(await $.clock.now(), 'erro', null, `a batida da presença falhou: ${mensagem(erro)}`))
    return 'desconhecida'
  }
}

/** A rodada: a batida (na cadência dela), o status do núcleo e a linha da faixa. */
async function rodadaUmaVez($: EngineInterface, comBatida: boolean): Promise<void> {
  ultimaRodadaEm = await $.clock.now()
  const pausa = memoria.pausada
  const batida = !pausa && comBatida ? await bater($) : null
  let lido: ReturnType<typeof lerStatus>
  try {
    lido = lerStatus(await $.process.run(argvDoStatus(), { timeoutMs: PRAZO_DO_STATUS_MS }), sessao)
  } catch (erro) {
    const motivo = mensagem(erro)
    await mudar($, 'resumo', r => ({ ...r, erro: motivo }))
    await anotar($, entrada(await $.clock.now(), 'erro', null, `a leitura do núcleo falhou: ${motivo}`))
    await publicarFaixa($)
    return
  }
  const presenca: SentinelaPresenca = batida === 'outra' ? 'outra' : lido.presenca
  await mudar($, 'resumo', () => ({ lidoEm: ultimaRodadaEm, presenca, passos: lido.passos, erro: null }))
  // Uma Sentinela por máquina: só a que tem a presença conduz e avisa, e nunca pausada (aí o condutor externo avisa).
  if (!pausa && presenca === 'minha') {
    await conduzir($, lido.passos)
    await lerAvisos($, lido.passos)
  } else avisosAtuais = 0
  await publicarFaixa($)
}

/**
 * T6.3: a cada 5 min, o pulse pela ponte vira aviso do que só o dono resolve, com o próximo passo do núcleo. Cada aviso
 * sai uma vez por texto: notificação do sistema (ou toast, se o canal não escreveu), linha no diário e o registro do
 * que foi mostrado na ponte, para o Telegram não repetir. Pulse que falha fica no diário e a rodada segue.
 */
async function lerAvisos($: EngineInterface, passos: readonly SentinelaPasso[]): Promise<void> {
  const agora = await $.clock.now()
  if (agora - ultimoPulseEm < PERIODO_DO_PULSE_MS) return
  ultimoPulseEm = agora
  let avisos: Aviso[]
  try {
    avisos = avisosDoPulse(await $.ork.ler({ consulta: 'pulse' }), passos)
  } catch (erro) {
    return anotar($, entrada(agora, 'erro', null, `os avisos do pulse ficaram indisponíveis nesta rodada (${mensagem(erro)})`))
  }
  avisosAtuais = avisos.length
  for (const a of avisosNovos(avisos, memoria.avisados)) await avisar($, a)
}

/** Um aviso ao dono, uma vez por texto. */
async function avisar($: EngineInterface, a: Aviso): Promise<void> {
  const marca = marcaDoAviso(a)
  if (memoria.avisados.includes(marca)) return
  await mudar($, 'avisados', l => guardarChave(l, marca))
  const enviado = await $.ui.notify(a.texto, { title: TITULO }).then(r => r.isSent, () => false)
  if (!enviado) $.ui.toast(`sentinela: ${a.texto}`)
  await anotar($, entrada(await $.clock.now(), 'aviso', a.thread, a.texto))
  try {
    await $.ork.mostrado({ mod: MOD, canal: enviado ? 'notificacao' : 'toast', texto: a.texto, chave: a.chave, ...(a.thread ? { thread: a.thread } : {}) })
  } catch (erro) {
    await anotar($, entrada(await $.clock.now(), 'erro', a.thread, `o aviso não entrou no registro do mostrado da ponte (${mensagem(erro)})`))
  }
}

/** T6.2: o despacho e a retomada que o núcleo manda, cada turno e cada bloqueio uma vez só. */
async function conduzir($: EngineInterface, passos: readonly SentinelaPasso[]): Promise<void> {
  if (!sessaoValida(sessao)) return
  for (const p of paraDespachar(passos, memoria.despachados)) await despachar($, p, sessao)
  for (const p of paraRetomar(passos, memoria.retomados)) await retomarThread($, p)
}

const FRASE_DO_RESULTADO: Record<ResultadoDoDespacho['resultado'], string> = {
  despachada: 'despachada pelo núcleo', repetida: 'o mesmo pedido já estava em andamento; nada novo',
  ocupada: 'outro condutor conduz agora; nada despachado', falhou: 'o despacho falhou',
}

/**
 * Um despacho: a chave do turno entra antes (uma rodada no meio, ou uma recarga, nunca pede o mesmo turno de novo);
 * a condução e o pedido aberto ao dono são relidos pelo núcleo logo antes; o prompt sai do render com o pedido
 * guardado; e o `ork phase run` decide, com o lease e a trava do kernel, se a sessão nova abre. Leitura que falha
 * devolve a chave, para a rodada seguinte tentar; o que o núcleo recusou fica no diário e não se repete.
 */
async function despachar($: EngineInterface, p: SentinelaPasso, sessaoDoDono: string): Promise<void> {
  const chave = chaveDoDespacho(p) as string
  const fase = p.fase as string
  const anotarAqui = async (tipo: SentinelaEntrada['tipo'], texto: string) => anotar($, entrada(await $.clock.now(), tipo, p.thread, texto))
  const devolver = () => mudar($, 'despachados', d => d.filter(c => c !== chave))
  await mudar($, 'despachados', d => guardarChave(d, chave))
  try {
    if (!conducaoLivre(await $.ork.ler({ consulta: 'conducao.status', thread: p.thread }))) {
      return anotarAqui('cedeu', `${fase}: outro condutor já conduz a thread; nada despachado`)
    }
    if (pedidoAbertoNoRetrato((await $.ork.retrato({ thread: p.thread })).retrato, p.thread)) {
      return anotarAqui('cedeu', `${fase}: há pedido aberto ao dono na thread; o despacho espera a resposta`)
    }
  } catch (erro) {
    await devolver()
    return anotarAqui('erro', `${fase}: a condução não foi relida (${mensagem(erro)}); a próxima rodada tenta de novo`)
  }
  let render: ReturnType<typeof promptDoRender>
  try {
    render = promptDoRender(await $.process.run(argvDoRender(p.thread, fase), { timeoutMs: PRAZO_DO_RENDER_MS }))
  } catch (erro) {
    await devolver()
    return anotarAqui('erro', `${fase}: o render do prompt falhou (${mensagem(erro)}); a próxima rodada tenta de novo`)
  }
  if ('motivo' in render) {
    await anotarAqui('erro', `${fase}: não despachada: ${render.motivo}`)
    return avisar($, avisoDoDespacho(p, render.motivo))
  }
  let r: ResultadoDoDespacho
  try {
    r = lerDespacho(await $.process.run(argvDoDespacho(p.thread, fase, render.prompt, sessaoDoDono), { timeoutMs: PRAZO_DO_DESPACHO_MS }))
  } catch (erro) {
    r = { resultado: 'falhou', detalhe: mensagem(erro) }
  }
  const tipo = r.resultado === 'despachada' ? 'despacho' : r.resultado === 'falhou' ? 'erro' : 'cedeu'
  await anotarAqui(tipo, `${fase}: ${FRASE_DO_RESULTADO[r.resultado]}${r.detalhe ? ` (${r.detalhe})` : ''}`)
  if (r.resultado === 'falhou') await avisar($, avisoDoDespacho(p, r.detalhe))
}

/** Uma retomada: o `ork retry plan` (pela ponte) decide, e o `ork retry run` só roda quando ele é automático. */
async function retomarThread($: EngineInterface, p: SentinelaPasso): Promise<void> {
  const chave = chaveDaRetomada(p) as string
  const anotarAqui = async (texto: string) => anotar($, entrada(await $.clock.now(), 'retomada', p.thread, texto))
  await mudar($, 'retomados', d => guardarChave(d, chave))
  let plano: unknown
  try {
    plano = await $.ork.ler({ consulta: 'retry.plan', thread: p.thread })
  } catch (erro) {
    await mudar($, 'retomados', d => d.filter(c => c !== chave))
    return anotarAqui(`o retry plan não foi lido (${mensagem(erro)}); a próxima rodada tenta de novo`)
  }
  if (!retomadaAutomatica(plano)) {
    const { bloqueio } = (plano ?? {}) as { bloqueio?: unknown }
    return anotarAqui(`bloqueio ${p.bloqueio?.motivo}: o retry plan não é automático (${String(bloqueio ?? 'sem plano')}); o passo é do dono`)
  }
  let r: ReturnType<typeof lerRetomada>
  try {
    r = lerRetomada(await $.process.run(argvDaRetomada(p.thread), { env: { ...AMBIENTE_DA_RETOMADA }, timeoutMs: PRAZO_DA_RETOMADA_MS }))
  } catch (erro) {
    r = { resultado: 'recusada', detalhe: mensagem(erro) }
  }
  await anotarAqui(`bloqueio ${p.bloqueio?.motivo}: ${r.resultado === 'retomada' ? 'retomado pelo núcleo' : 'o núcleo não retomou'}${r.detalhe ? ` (${r.detalhe})` : ''}`)
}

/** A linha da faixa pela ponte (D7 do plano dos mods), só quando o texto muda. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(memoria.resumo, memoria.pausada, await $.clock.now(), avisosAtuais)
  if (texto === ultimaFaixa) return
  try {
    if (texto === undefined) await $.ork.faixa({ mod: MOD })
    else await $.ork.faixa({ mod: MOD, texto })
    ultimaFaixa = texto
  } catch (erro) {
    // A linha fica como estava; o motivo vai ao diário, e a próxima rodada tenta de novo.
    await anotar($, entrada(await $.clock.now(), 'erro', null, `a linha da faixa não foi publicada: ${mensagem(erro)}`))
  }
}

/** Tira a presença desta sessão: o condutor externo volta a conduzir. */
async function desligar($: EngineInterface, motivo: string): Promise<void> {
  if (!sessaoValida(sessao)) return
  const r = await $.process.run(argvDoDesligar(sessao), { timeoutMs: PRAZO_DA_BATIDA_MS }).catch((erro: unknown) => erro)
  if (r instanceof Error || (r as { exitCode?: number }).exitCode !== 0) {
    await anotar($, entrada(await $.clock.now(), 'erro', null, `a presença não saiu (${motivo}); ela vence sozinha em 3 min`))
  }
}

async function pausarSentinela($: EngineInterface): Promise<string> {
  await mudar($, 'pausada', () => true)
  await desligar($, 'pausa pelo dono')
  await anotar($, entrada(await $.clock.now(), 'pausa', null, 'pausada pelo /sentinela; o condutor externo conduz'))
  await mudar($, 'resumo', r => ({ ...r, presenca: 'nenhuma' }))
  await publicarFaixa($)
  return 'Sentinela pausada: nada é despachado por ela, e o condutor externo volta a conduzir. Para voltar: /sentinela retomar.'
}

async function retomarSentinela($: EngineInterface): Promise<string> {
  await mudar($, 'pausada', () => false)
  await anotar($, entrada(await $.clock.now(), 'pausa', null, 'retomada pelo /sentinela'))
  const propria = pedirRodada($, true)
  if (propria) await propria
  return 'Sentinela retomada: ela volta a conduzir nesta máquina quando a presença for confirmada pelo núcleo.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // Um ledger de thread mudou (a ponte já vigia a pasta das threads e os ledgers recentes no papel dono): a rodada
  // relê o passo do condutor pelo núcleo.
  on('classic.FileChanged', async ($, e, next) => {
    if (ativa && threadDoLedger(e.file_path) !== null) agendar($, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  // A sessão acabou: a presença sai na hora, para o condutor externo não esperar o prazo. Num `/clear` o processo
  // segue com outro id, e a próxima batida toma a presença com ele.
  on('session.end', async ($, e, next) => {
    if (ativa && !memoria.pausada) await desligar($, `fim da sessão (${e.reason})`)
    return next(e)
  }).catch(($, e, next) => next(e))

  // `/sentinela` relê o núcleo e mostra o passo de cada thread e o diário; `pausar` e `retomar` mudam quem conduz.
  on('command.run', { command: 'sentinela' }, async ($, e) => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'A Sentinela do Condutor só roda na sessão do dono de um projeto do Orkastery.' }
    const pedido = String(e.args ?? '').trim()
    if (pedido === 'pausar') return { text: await pausarSentinela($) }
    if (pedido === 'retomar') return { text: await retomarSentinela($) }
    if (pedido !== '') return { text: 'Uso: /sentinela (o passo de cada thread e o diário), /sentinela pausar ou /sentinela retomar.' }
    const propria = pedirRodada($, false)
    if (propria) await propria
    const texto = textoDoDiario(memoria.resumo, memoria.diario, memoria.pausada, await $.clock.now())
    const andamento = propria ? '' : '\nUma rodada já estava em andamento: o próximo /sentinela mostra a leitura nova.'
    const falha = falhaSemRegistro ? `\nÚltima falha em segundo plano: ${falhaSemRegistro}` : ''
    return { text: texto + andamento + falha }
  })
}
