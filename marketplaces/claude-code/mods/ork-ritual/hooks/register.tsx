// O Ritual do MASTER do Orkastery (RM-059, fatia F8; ficha M8 do plano dos mods). Na sessao do dono, um painel com as
// entregas que esperam a nota do dono, lidas do nucleo pelo retrato da ponte (`$.ork.retrato`, secao `master`), e o
// replay da prova de cada uma, com as claims pelo `ork_claims_list`. O botao "Dar a nota" so pede ao nucleo o dialogo
// nativo (`ork_request_master_note`, com o `threadId` e nada mais), e a reserva pelo Telegram so pede o codigo
// (`ork master pedir`), no clique do dono. Nunca le `.orkastery/` por conta propria e nunca da a nota pelo dono. A
// logica fica nos modulos puros ao lado; aqui so os ganchos e as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import type { EngineInterface, Register } from 'claude-code'
import type { RitualMostrado, RitualNota, RitualProva, RitualQuadro, RitualReserva } from '../types'
import {
  argsDaNota, argvDaReserva, lerReserva, notaDoErro, PRAZO_DA_NOTA_MS, PRAZO_DA_RESERVA_MS, resultadoDaNota, soltarAbrindo,
} from './nota'
import { desenharRitual, linhasDoPainel, mostradosVisiveis } from './replay'
import {
  argsDasClaims, avisosDasLacunas, claimsDaProva, entregasDaJanela, exigirThread, jsonDoMcp, paginaDoMaster, plural, QUADRO_VAZIO,
  semNotaDada, SERVIDOR, TETO_DE_PAGINAS, textoDaFaixa, threadDoLedger, threadsSemLeitura, umaLinha,
} from './ritual'

const MOD = 'ork-ritual'
const PAINEL = 'ritual'
const TITULO = 'Ritual do MASTER'
const QUADRO = { plugin: 'ork-ritual', key: 'quadro' } as const
const FOCO = { plugin: 'ork-ritual', key: 'foco' } as const
const PASSO = { plugin: 'ork-ritual', key: 'passo' } as const
const PROVA = { plugin: 'ork-ritual', key: 'prova' } as const
const NOTAS = { plugin: 'ork-ritual', key: 'notas' } as const
const RESERVAS = { plugin: 'ork-ritual', key: 'reservas' } as const
/** O tique: idade das entregas e registro do mostrado. */
const PERIODO_DO_TIQUE_MS = 60000
/** As entregas sao relidas por idade: a cada 5 min com o painel a vista, a cada 15 min escondido. */
const IDADE_A_VISTA_MS = 5 * 60000
const IDADE_ESCONDIDO_MS = 15 * 60000
/**
 * Entre duas leituras que o dono nao pediu (ledger que mudou, idade), no minimo isto com o painel a vista; escondido, a
 * idade de 15 min. Cada leitura rele todas as paginas da secao `master` do retrato, e cada pagina le os ledgers de todas
 * as threads: a faixa nao precisa de mais que isso, e a entrega anda em minutos, nao em segundos.
 */
const INTERVALO_A_VISTA_MS = 60000
/** Os ledgers que mudam juntos entram numa leitura so. */
const ESPERA_DO_LOTE_MS = 5000
/** Teto de cada chamada ao nucleo (uma pagina do retrato ou as claims de uma thread). */
const PRAZO_DA_LEITURA_MS = 20000
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
const ESPERA_LONGA_DO_PAPEL_MS = 300000

// O que o modulo guarda entre ganchos. O estado em `$.state` (quadro, foco, passo e prova) e o que o desenho le; aqui
// ficam a copia dele, sempre gravada inteira por `$.state.set` sem versao, uma gravacao por mudanca (licao da Sentinela
// e da Pista), e o que nao se desenha. Uma recarga do modulo zera tudo, e o `session.start` dispara de novo nela.
let ativa = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let lote: { cancel: () => void } | undefined
let lendo: Promise<void> | undefined
let pendente = false
let tentadaEm = 0
let quadro: RitualQuadro = QUADRO_VAZIO
let foco: string | null = null
let passo = 0
let prova: RitualProva | null = null
/** A leitura das claims em curso e de qual thread. */
let lendoProva: Promise<void> | undefined
let lendoProvaDe: string | null = null
/** O "Dar a nota" e a reserva de cada entrega, e as threads com um dialogo ou um pedido rodando no nucleo agora. */
let notas: Record<string, RitualNota> = {}
let reservas: Record<string, RitualReserva> = {}
const emDialogo = new Set<string>()
const pedindo = new Set<string>()
/** O que o desenho pos na janela de rolagem e ainda nao foi ao registro da ponte. */
const vistosNoDesenho = new Map<string, RitualMostrado>()
/** O que ja foi ao registro nesta sessao, por chave e texto. */
const jaMostrado = new Set<string>()
/** O ultimo texto publicado na faixa; null antes da primeira publicacao. */
let ultimaFaixa: string | undefined | null = null
/** A falha de um trabalho em segundo plano que nem o quadro conseguiu guardar. */
let problemaSemAviso: string | null = null

function mensagem(erro: unknown): string {
  return umaLinha(erro, 200)
}

/** A leitura com teto proprio: o relogio da sessao recusa a espera que passar dele. */
function comPrazo<T>($: EngineInterface, leitura: Promise<T>, ms = PRAZO_DA_LEITURA_MS): Promise<T> {
  return new Promise<T>((resolver, recusar) => {
    const prazo = $.clock.after(ms, () => recusar(new Error(`a leitura passou de ${Math.round(ms / 1000)} s`)))
    leitura.then(v => { prazo.cancel(); resolver(v) }, e => { prazo.cancel(); recusar(e) })
  })
}

/**
 * Trabalho em segundo plano (o tique, o lote, os gestos do painel): a falha vai ao quadro; sem como gravar (a sessao
 * acabou ou o estado recusou), ela fica guardada aqui e o proximo desenho a mostra. O `.catch` nao depende do `$`.
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

async function gravarQuadro($: EngineInterface, novo: RitualQuadro): Promise<void> {
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

/** Liga o Ritual na sessao do dono: o `/nota`, o tique e a primeira leitura. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  try {
    await $.command.register({ name: 'nota', description: 'Abre o Ritual do MASTER: as entregas que esperam a sua nota, com a prova de cada uma', immediate: true })
  } catch (erro) {
    // Sem o /nota o painel nao abre: o Ritual volta a dormente e tenta de novo na espera longa.
    ativa = false
    $.clock.after(ESPERA_LONGA_DO_PAPEL_MS, () => { emSegundoPlano($, conferirPapel($, ESPERAS_DO_PAPEL_MS.length), 'a conferência do papel') })
    throw erro
  }
  quadro = (await $.state.get(QUADRO)).value ?? QUADRO_VAZIO
  foco = (await $.state.get(FOCO)).value ?? null
  passo = (await $.state.get(PASSO)).value ?? 0
  prova = (await $.state.get(PROVA)).value ?? null
  // Depois de uma recarga do modulo, nenhum dialogo nem pedido esta rodando: o que ficou em curso volta a ter o botao.
  notas = soltarAbrindo((await $.state.get(NOTAS)).value ?? {})
  await $.state.set(NOTAS, notas)
  const guardadas = (await $.state.get(RESERVAS)).value ?? {}
  reservas = Object.fromEntries(Object.entries(guardadas).map(([t, r]) => [t, r.estado === 'pedindo'
    ? { ...r, estado: 'erro' as const, texto: 'o pedido pelo Telegram foi interrompido por uma recarga; peça de novo' } : r]))
  await $.state.set(RESERVAS, reservas)
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DO_TIQUE_MS, () => { emSegundoPlano($, tique($), 'o tique do Ritual') })
  agendar($, 1)
}

/** Confere o papel: liga no dono, desiste na fase ou sem a ponte, e tenta de novo enquanto dormente. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativar($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('ritual: a ponte ork-ponte não carregou; o Ritual do MASTER fica desligado nesta sessão')
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
    emSegundoPlano($, atualizar($), 'a leitura das entregas')
  })
}

/** O painel do Ritual esta posto e a vista do dono. */
async function painelAVista($: EngineInterface): Promise<boolean> {
  const paineis = await $.ui.panes().catch(() => [])
  return paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)
}

/**
 * Uma leitura por vez; pedido que chega no meio volta a rodar logo depois. Fora do pedido do dono (`forcar`), a leitura
 * respeita o intervalo: com o painel a vista, volta a ser agendada para quando ele vencer; escondido, espera o tique da
 * idade.
 */
async function atualizar($: EngineInterface, forcar = false): Promise<void> {
  if (!ativa) return
  const agora = await $.clock.now()
  if (!forcar && tentadaEm > 0) {
    const aVista = await painelAVista($)
    const espera = (aVista ? INTERVALO_A_VISTA_MS : IDADE_ESCONDIDO_MS) - (agora - tentadaEm)
    if (espera > 0) {
      if (aVista) agendar($, espera)
      return
    }
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

/**
 * As entregas pelo retrato da ponte, pagina a pagina da secao `master` (D2): a que espera a nota do dono, na janela de
 * dias, sem a que teve a nota registrada nesta sessao (a pagina guardada pela ponte pode ainda lista-la). A falha fica
 * no quadro, com a leitura anterior.
 */
async function lerUmaVez($: EngineInterface): Promise<void> {
  tentadaEm = await $.clock.now()
  const itens: unknown[] = []
  const lacunas: string[] = []
  const avisos: string[] = []
  let offset = 0
  try {
    for (let pagina = 0; ; pagina++) {
      if (pagina >= TETO_DE_PAGINAS) {
        avisos.push(`a seção master passou de ${TETO_DE_PAGINAS} páginas; o resto ficou de fora`)
        break
      }
      const p = paginaDoMaster(await comPrazo($, $.ork.retrato({ secao: 'master', offset })))
      itens.push(...p.itens)
      lacunas.push(...p.lacunas)
      if (p.proxima === null || p.proxima <= offset) break
      offset = p.proxima
    }
  } catch (erro) {
    await gravarQuadro($, { ...quadro, erro: mensagem(erro) })
    await publicarFaixa($)
    return
  }
  const agora = await $.clock.now()
  const { entregas, fora, alemDoTeto } = entregasDaJanela(itens, agora)
  avisos.unshift(...avisosDasLacunas(lacunas))
  if (alemDoTeto) avisos.push(`${plural(alemDoTeto, 'entrega além do teto do painel ficou', 'entregas além do teto do painel ficaram')} de fora (ork master)`)
  await gravarQuadro($, { entregas: semNotaDada(entregas, notas), lidoEm: agora, erro: null, avisos, foraDaJanela: fora,
    semLeitura: threadsSemLeitura(lacunas) })
  await publicarFaixa($)
  await registrarMostrados($)
}

/** As claims da thread em foco pelo `ork_claims_list`, uma leitura por vez; a da thread que saiu do foco e descartada. */
async function lerProva($: EngineInterface, thread: string): Promise<void> {
  if (lendoProva) {
    if (lendoProvaDe === thread) return lendoProva
    await lendoProva.catch(() => undefined)
  }
  lendoProvaDe = thread
  lendoProva = (async () => {
    let nova: RitualProva
    try {
      const { claims, retiradas } = claimsDaProva(jsonDoMcp(await comPrazo($, $.mcp.call(SERVIDOR, 'ork_claims_list', argsDasClaims(thread)))))
      nova = { thread, claims, retiradas, lidoEm: await $.clock.now(), erro: null }
    } catch (erro) {
      const anterior = prova?.thread === thread ? prova : null
      nova = { thread, claims: anterior?.claims ?? [], retiradas: anterior?.retiradas ?? 0, lidoEm: await $.clock.now(), erro: mensagem(erro) }
    }
    if (foco !== thread) return
    prova = nova
    passo = Math.min(passo, Math.max(0, nova.claims.length - 1))
    await $.state.set(PROVA, prova)
    await $.state.set(PASSO, passo)
  })()
  try {
    await lendoProva
  } finally {
    lendoProva = undefined
    lendoProvaDe = null
  }
}

/** Abre o replay de uma thread: o foco e o passo agora; as claims, em segundo plano. */
async function focar($: EngineInterface, thread: string): Promise<void> {
  if (foco !== thread || prova?.thread !== thread) {
    foco = thread
    passo = 0
    prova = null
    await $.state.set(FOCO, foco)
    await $.state.set(PASSO, passo)
    await $.state.set(PROVA, prova)
  }
  emSegundoPlano($, lerProva($, thread), 'a leitura das claims')
}

/** Fecha o replay: volta a lista das entregas. */
async function soltarFoco($: EngineInterface): Promise<void> {
  if (foco === null) return
  foco = null
  passo = 0
  prova = null
  await $.state.set(FOCO, foco)
  await $.state.set(PASSO, passo)
  await $.state.set(PROVA, prova)
}

/** Anda uma claim para tras ou para frente no replay, dentro da lista lida. */
async function andar($: EngineInterface, delta: number): Promise<void> {
  if (!prova || prova.thread !== foco || !prova.claims.length) return
  const novo = Math.min(Math.max(0, passo + delta), prova.claims.length - 1)
  if (novo === passo) return
  passo = novo
  await $.state.set(PASSO, passo)
}

async function gravarNota($: EngineInterface, thread: string, n: RitualNota): Promise<void> {
  notas = { ...notas, [thread]: n }
  await $.state.set(NOTAS, notas)
}

async function gravarReserva($: EngineInterface, thread: string, r: RitualReserva): Promise<void> {
  reservas = { ...reservas, [thread]: r }
  await $.state.set(RESERVAS, reservas)
}

/**
 * O "Dar a nota" (T8.3, DD2): um dialogo por thread, em segundo plano. A chamada leva exatamente o `threadId`; quem da a
 * nota e o porque e o dono, no dialogo nativo do host, e quem grava e o nucleo. A entrega anotada sai da lista e da
 * faixa assim que o nucleo responde, e a releitura logo depois confirma.
 */
async function darNota($: EngineInterface, thread: string): Promise<void> {
  if (emDialogo.has(thread)) return
  // Marcado antes de qualquer espera: dois toques ao mesmo tempo abrem um dialogo so.
  emDialogo.add(thread)
  try {
    exigirThread(thread)
    await gravarNota($, thread, { estado: 'abrindo', texto: '', em: await $.clock.now() })
    let n: RitualNota
    try {
      n = resultadoDaNota(jsonDoMcp(await comPrazo($, $.mcp.call(SERVIDOR, 'ork_request_master_note', argsDaNota(thread)), PRAZO_DA_NOTA_MS)),
        thread, await $.clock.now())
    } catch (erro) {
      n = notaDoErro(erro, await $.clock.now())
    }
    await gravarNota($, thread, n)
    if (n.estado === 'registrada' || n.estado === 'repetida') {
      await gravarQuadro($, { ...quadro, entregas: semNotaDada(quadro.entregas, notas) })
      await publicarFaixa($)
    }
  } finally {
    emDialogo.delete(thread)
  }
  await atualizar($, true)
}

/**
 * A reserva pelo Telegram (T8.3, D7): so no clique do dono, o pedido de nota do nucleo (`ork master pedir`), que guarda
 * o pedido e devolve o codigo. O mod nunca roda `ork master` com nota no argv.
 */
async function pedirTelegram($: EngineInterface, thread: string): Promise<void> {
  if (pedindo.has(thread)) return
  pedindo.add(thread)
  try {
    exigirThread(thread)
    await gravarReserva($, thread, { estado: 'pedindo', texto: '', codigo: null, em: await $.clock.now() })
    let r: RitualReserva
    try {
      r = lerReserva(await $.process.run(argvDaReserva(thread), { timeoutMs: PRAZO_DA_RESERVA_MS }), thread, await $.clock.now())
    } catch (erro) {
      r = { estado: 'erro', texto: `o pedido pelo Telegram falhou: ${mensagem(erro)}`, codigo: null, em: await $.clock.now() }
    }
    await gravarReserva($, thread, r)
  } finally {
    pedindo.delete(thread)
  }
  await registrarMostrados($)
}

/** O tique: a idade das entregas e o registro do que o painel mostrou. */
async function tique($: EngineInterface): Promise<void> {
  if (!ativa) return
  const agora = await $.clock.now()
  const aVista = await painelAVista($)
  const idade = quadro.lidoEm === null ? Number.POSITIVE_INFINITY : agora - quadro.lidoEm
  if (idade >= (aVista ? IDADE_A_VISTA_MS : IDADE_ESCONDIDO_MS)) await atualizar($)
  await registrarMostrados($)
}

/** A linha da faixa pela ponte, so quando o texto muda; sem entrega que espere a nota, a linha sai. */
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

/** O desenho anota o que pos na janela; quem registra e o tique ou a leitura, fora do desenho. */
function anotarVistos(vistos: readonly RitualMostrado[]): void {
  for (const m of vistos) vistosNoDesenho.set(`${m.chave}|${m.texto}`, m)
}

/**
 * O que o desenho pos na janela de rolagem do painel posto e a vista vai ao registro da ponte (M5 do dono), uma vez por
 * chave e texto enquanto o texto existir no painel: o Telegram nao repete o que o dono ja viu no terminal.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  const existentes = new Set(linhasDoPainel(quadro, { agora: 0, foco, prova, passo, notas, reservas })
    .flatMap(l => (l.mostrado ? [`${l.mostrado.chave}|${l.mostrado.texto}`] : [])))
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // `/nota [thread]` abre o painel em qualquer largura e rele as entregas agora. Com uma thread (a Torre abre o Ritual
  // assim), o painel abre no replay da prova dela. O comando so existe com o Ritual ligado; a conferencia do papel
  // aqui so cobre o caso raro de o comando ter sobrado de uma carga anterior.
  on('command.run', { command: 'nota' }, async ($, e) => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'O Ritual do MASTER só abre na sessão do dono de um projeto do Orkastery.' }
    const pedida = typeof e.args === 'string' ? e.args.trim() : ''
    let thread: string | null = null
    let aviso = ''
    if (pedida) {
      try {
        thread = exigirThread(pedida)
      } catch {
        aviso = ` O id ${umaLinha(pedida, 80)} não é de thread; o painel abre na lista das entregas.`
      }
    }
    if (thread) await focar($, thread)
    else await soltarFoco($)
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    emSegundoPlano($, atualizar($, true), 'a leitura das entregas')
    const onde = thread ? ` na prova da ${thread}` : ''
    return { text: (aberto.isPlaced ? `Ritual do MASTER aberto${onde}.` : `Ritual do MASTER aberto${onde}, à espera de lugar: ${aberto.reason}`) + aviso }
  })

  // O ledger de uma thread mudou (entrega, MASTER, nota): a releitura entra no proximo lote. Os caminhos vigiados sao
  // os que a ponte pede para o papel dono; o Ritual nao pede outros.
  on('classic.FileChanged', async ($, e, next) => {
    if (ativa && threadDoLedger(e.file_path) !== null) agendar($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // O painel: a lista das entregas ou o replay da prova. O desenho nunca escreve: so anota o que pos na janela de
  // rolagem, para o registro do mostrado.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const q = (await $.state.get(QUADRO)).value ?? QUADRO_VAZIO
    const emFoco = (await $.state.get(FOCO)).value ?? null
    const p = (await $.state.get(PASSO)).value ?? 0
    const pr = (await $.state.get(PROVA)).value ?? null
    const ns = (await $.state.get(NOTAS)).value ?? {}
    const rs = (await $.state.get(RESERVAS)).value ?? {}
    const agora = await $.clock.now()
    const comProblema: RitualQuadro = problemaSemAviso ? { ...q, avisos: [...q.avisos, problemaSemAviso] } : q
    const linhas = linhasDoPainel(comProblema, { agora, foco: emFoco, prova: pr, passo: p, notas: ns, reservas: rs })
    anotarVistos(mostradosVisiveis(linhas, e.props.scroll, e.props.bodyColumns))
    return desenharRitual({ Box, Text, Button }, linhas, {
      foco: emFoco,
      atualizar: () => {
        emSegundoPlano($, atualizar($, true), 'a releitura das entregas')
        if (emFoco) emSegundoPlano($, lerProva($, emFoco), 'a releitura das claims')
      },
      verProva: thread => { emSegundoPlano($, focar($, thread), 'o Ver a prova') },
      voltar: () => { emSegundoPlano($, soltarFoco($), 'o Voltar') },
      anterior: () => { emSegundoPlano($, andar($, -1), 'o Anterior') },
      proxima: () => { emSegundoPlano($, andar($, 1), 'o Próxima') },
      darNota: thread => { emSegundoPlano($, darNota($, thread), 'o Dar a nota') },
      telegram: thread => { emSegundoPlano($, pedirTelegram($, thread), 'o pedido pelo Telegram') },
    })
  })
}
