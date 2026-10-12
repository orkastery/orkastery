// A Sentinela do Condutor do Orkastery (RM-059, fatia F6; ficha M2 do plano dos mods). Na sessão do dono, mantém a
// presença dela nesta máquina pelo núcleo, para o condutor externo ceder o despacho (DD5), e relê o passo do
// condutor de cada thread aberta quando um ledger muda e a cada batida. Lê só pelo núcleo (o `ork` e o `$.ork` da
// ponte), nunca `.orkastery/` por conta própria, e nunca assume a condução de ninguém. A lógica fica nos módulos
// puros ao lado; aqui só os ganchos e as chamadas ao `$`, escritas como `x.noun.metodo(...)`, como o validador exige.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { SentinelaEntrada, SentinelaPresenca, SentinelaResumo } from '../types'
import {
  acrescentar, argvDaBatida, argvDoDesligar, argvDoStatus, BATIDA_MS, entrada, ESPERA_DO_LEDGER_MS, lerBatida, lerStatus, MOD,
  PRAZO_DA_BATIDA_MS, PRAZO_DO_STATUS_MS, sessaoValida, TETO_DO_DIARIO, textoDaFaixa, textoDoDiario, threadDoLedger,
} from './vigia'

const RESUMO_VAZIO: SentinelaResumo = { lidoEm: null, presenca: 'desconhecida', passos: [], erro: null }
const diario = atom({ plugin: 'ork-sentinela', key: 'diario' } as const, [] as SentinelaEntrada[])
const pausada = atom({ plugin: 'ork-sentinela', key: 'pausada' } as const, false)
const resumo = atom({ plugin: 'ork-sentinela', key: 'resumo' } as const, RESUMO_VAZIO)
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

function mensagem(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').trim().slice(0, 200)
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
  await update($, diario, d => {
    const ultima = d[d.length - 1]
    if (ultima && ultima.tipo === e.tipo && ultima.thread === e.thread && ultima.texto === e.texto) return d
    return acrescentar(d, e, TETO_DO_DIARIO)
  })
}

/** Liga a Sentinela na sessão do dono: o `/sentinela`, a batida de 60 s e a primeira rodada. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
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
  const pausa = await read($, pausada)
  const batida = !pausa && comBatida ? await bater($) : null
  let lido: ReturnType<typeof lerStatus>
  try {
    lido = lerStatus(await $.process.run(argvDoStatus(), { timeoutMs: PRAZO_DO_STATUS_MS }), sessao)
  } catch (erro) {
    const motivo = mensagem(erro)
    await update($, resumo, r => ({ ...r, erro: motivo }))
    await anotar($, entrada(await $.clock.now(), 'erro', null, `a leitura do núcleo falhou: ${motivo}`))
    await publicarFaixa($)
    return
  }
  const presenca: SentinelaPresenca = batida === 'outra' ? 'outra' : lido.presenca
  await update($, resumo, () => ({ lidoEm: ultimaRodadaEm, presenca, passos: lido.passos, erro: null }))
  await publicarFaixa($)
}

/** A linha da faixa pela ponte (D7 do plano dos mods), só quando o texto muda. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(await read($, resumo), await read($, pausada), await $.clock.now())
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

async function pausar($: EngineInterface): Promise<string> {
  await update($, pausada, () => true)
  await desligar($, 'pausa pelo dono')
  await anotar($, entrada(await $.clock.now(), 'pausa', null, 'pausada pelo /sentinela; o condutor externo conduz'))
  await update($, resumo, r => ({ ...r, presenca: 'nenhuma' }))
  await publicarFaixa($)
  return 'Sentinela pausada: nada é despachado por ela, e o condutor externo volta a conduzir. Para voltar: /sentinela retomar.'
}

async function retomar($: EngineInterface): Promise<string> {
  await update($, pausada, () => false)
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
    if (ativa && !(await read($, pausada))) await desligar($, `fim da sessão (${e.reason})`)
    return next(e)
  }).catch(($, e, next) => next(e))

  // `/sentinela` relê o núcleo e mostra o passo de cada thread e o diário; `pausar` e `retomar` mudam quem conduz.
  on('command.run', { command: 'sentinela' }, async ($, e) => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'A Sentinela do Condutor só roda na sessão do dono de um projeto do Orkastery.' }
    const pedido = String(e.args ?? '').trim()
    if (pedido === 'pausar') return { text: await pausar($) }
    if (pedido === 'retomar') return { text: await retomar($) }
    if (pedido !== '') return { text: 'Uso: /sentinela (o passo de cada thread e o diário), /sentinela pausar ou /sentinela retomar.' }
    const propria = pedirRodada($, false)
    if (propria) await propria
    const texto = textoDoDiario(await read($, resumo), await read($, diario), await read($, pausada), await $.clock.now())
    const andamento = propria ? '' : '\nUma rodada já estava em andamento: o próximo /sentinela mostra a leitura nova.'
    const falha = falhaSemRegistro ? `\nÚltima falha em segundo plano: ${falhaSemRegistro}` : ''
    return { text: texto + andamento + falha }
  })
}
