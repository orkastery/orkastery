// A Mesa do Dono do Orkastery (RM-059, fatia F5; ficha M4 do plano dos mods). Na sessao do dono, um painel com tudo
// que espera o dono, lido do nucleo pela ponte (`$.ork.retrato` e `$.ork.ler`) e por tres ferramentas MCP, nunca de
// `.orkastery/` por conta propria. O botao Decidir so pede ao nucleo o dialogo nativo do pedido
// (`ork_request_decision`, com os dois ids); a decisao obvia, pelo teste das quatro condicoes, vira decisao autonoma do
// nucleo (`ork_decision_record`). Nenhum caminho daqui responde o pedido. A logica fica nos modulos puros ao lado; aqui
// so os ganchos e as chamadas ao `$`, sempre escritas como `x.noun.metodo(...)`, como o validador exige.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { MesaDecidindo, MesaFila, MesaObvia, MesaPergunta } from '../types'
import type { MesaMostrado } from './cartoes'
import { desenharMesa, linhasDaMesa, mostradosVisiveis, paginaDoLote } from './cartoes'
import { argsDaDecisaoObvia, argsDoDecidir, jaDecidida, resultadoDoDecidir } from './decidir'
import {
  assinaturaDoRetrato, conferirNoNucleo, decisoesVistas, esperamODono, FILA_VAZIA, filaDoPulse, jsonDoMcp, ordenarPerguntas,
  pedidosNotificados, textoDaFaixa, threadsComPergunta, umaLinha,
} from './fila'
import { testeDaObvia } from './obvia'

const MOD = 'ork-mesa'
const PAINEL = 'mesa'
const TITULO = 'Mesa do Dono'
const fila = atom({ plugin: 'ork-mesa', key: 'fila' } as const, FILA_VAZIA)
const foco = atom({ plugin: 'ork-mesa', key: 'foco' } as const, null as string | null)
const pagina = atom({ plugin: 'ork-mesa', key: 'pagina' } as const, 0)
const decidindo = atom({ plugin: 'ork-mesa', key: 'decidindo' } as const, {} as Record<string, MesaDecidindo>)
const obvias = atom({ plugin: 'ork-mesa', key: 'obvias' } as const, {} as Record<string, MesaObvia>)

/** O tique: a vista, o retrato a cada um; escondido, a cada quatro (D3). */
const PERIODO_DO_TIQUE_MS = 30000
const TIQUES_ESCONDIDO = 4
/** O pulse velho e relido mesmo sem mudanca no retrato. */
const IDADE_DO_PULSE_A_VISTA_MS = 5 * 60000
const IDADE_DO_PULSE_ESCONDIDO_MS = 15 * 60000
/** Teto de cada leitura do nucleo; o Decidir espera o dialogo, que o ingresso local fecha em ate 300 s. */
const PRAZO_DA_LEITURA_MS = 20000
const PRAZO_DO_DECIDIR_MS = 310000
/** A gravacao da decisao obvia e local e rapida; passado este teto ela fica incerta, nunca recusada de cara. */
const PRAZO_DA_DECISAO_MS = 60000
/** A decisao incerta que o pulse nao mostra nesse tempo vira recusada, e a pergunta volta a esperar o dono. */
const INCERTEZA_MAXIMA_MS = 10 * 60000
/** O servidor do nucleo pode conectar depois do inicio da sessao: o papel e conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
const ESPERA_LONGA_DO_PAPEL_MS = 300000
const MAXIMO_DE_AVISOS = 5
/** O pulse que falha volta com recuo: 30 s, depois o dobro, ate 5 min (o retrato que muda nao fura o recuo). */
const RECUO_INICIAL_MS = 30000
const RECUO_MAXIMO_MS = 300000
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/

// O que o modulo guarda entre ganchos e nao desenha. Uma recarga do modulo zera tudo, e o `session.start` dispara
// de novo nela; o estado em `$.state` (a fila, o foco, o Decidir e as decisoes obvias) fica.
let ativa = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let tiques = 0
let assinatura: string | null = null
let pulseLidoEm: number | null = null
/** A ultima falha do pulse e o recuo ate a proxima tentativa automatica. */
let pulseFalhouEm: number | null = null
let recuoMs = 0
let lendo: Promise<void> | undefined
let pendente = false
/** Pedidos que esta sessao ja levou ao dono por notificacao. */
const notificados = new Set<string>()
/** Pedidos com a decisao obvia sendo registrada agora. */
const registrando = new Set<string>()
/** Pedidos com o Decidir em curso. */
const emDialogo = new Set<string>()
/** O que o desenho pos na janela de rolagem e ainda nao foi ao registro da ponte. */
const vistosNoDesenho = new Map<string, MesaMostrado>()
/** O que ja foi ao registro nesta sessao, por chave e texto. */
const jaMostrado = new Set<string>()
/** O ultimo texto publicado na faixa; null antes da primeira publicacao. */
let ultimaFaixa: string | undefined | null = null
/** A falha de um trabalho em segundo plano que nem o aviso do painel conseguiu guardar. */
let problemaSemAviso: string | null = null

function mensagem(erro: unknown): string {
  return umaLinha(erro instanceof Error ? erro.message : String(erro))
}

/** A leitura com teto proprio: o relogio da sessao recusa a espera que passar dele. */
function comPrazo<T>($: EngineInterface, leitura: Promise<T>, ms = PRAZO_DA_LEITURA_MS): Promise<T> {
  return new Promise<T>((resolver, recusar) => {
    const prazo = $.clock.after(ms, () => recusar(new Error(`a leitura passou de ${Math.round(ms / 1000)} s`)))
    leitura.then(v => { prazo.cancel(); resolver(v) }, e => { prazo.cancel(); recusar(e) })
  })
}

/** Um aviso no painel, sem repetir e com teto: o que falhou fica a vista do dono. */
async function anotarAviso($: EngineInterface, texto: string): Promise<void> {
  await update($, fila, f => (f.avisos.includes(texto) ? f : { ...f, avisos: [...f.avisos, texto].slice(-MAXIMO_DE_AVISOS) }))
}

/**
 * Trabalho em segundo plano (o tique, a primeira leitura, os gestos do painel): a falha vai ao aviso do painel; sem
 * como gravar o aviso (a sessao acabou ou o estado recusou), ela fica guardada aqui e o proximo desenho a mostra.
 */
function emSegundoPlano($: EngineInterface, trabalho: Promise<unknown>, oQue: string): void {
  trabalho.catch(async erro => {
    const texto = `${oQue} parou: ${mensagem(erro)}`
    try {
      await anotarAviso($, texto)
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

/** Liga a Mesa na sessao do dono: o `/mesa`, o tique e a primeira leitura. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  await $.command.register({ name: 'mesa', description: 'Abre a Mesa do Dono: o que espera você no Orkastery, com a recomendação na frente', immediate: true })
  // Depois de uma recarga do modulo, nenhum Decidir esta em curso: o que ficou "abrindo" no estado volta a ter botao.
  await update($, decidindo, d => Object.fromEntries(Object.entries(d).map(([id, v]) => [id, v.estado === 'abrindo'
    ? { estado: 'sem-resposta' as const, texto: 'o diálogo ficou sem resposta (a Mesa recarregou); o pedido segue aberto', em: v.em } : v])))
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DO_TIQUE_MS, () => { emSegundoPlano($, tique($), 'o tique da Mesa') })
  emSegundoPlano($, atualizar($), 'a primeira leitura da fila')
}

/** Confere o papel: liga no dono, desiste na fase ou sem a ponte, e tenta de novo enquanto dormente. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativar($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('mesa: a ponte ork-ponte não carregou; a Mesa do Dono fica desligada nesta sessão')
    return
  }
  const espera = ESPERAS_DO_PAPEL_MS[tentativa] ?? ESPERA_LONGA_DO_PAPEL_MS
  $.clock.after(espera, () => { emSegundoPlano($, conferirPapel($, tentativa + 1), 'a conferência do papel') })
}

/** O painel da Mesa esta posto e a vista do dono. */
async function painelAVista($: EngineInterface): Promise<boolean> {
  const paineis = await $.ui.panes().catch(() => [])
  return paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)
}

/** O tique: a conferencia do retrato (a vista, toda vez; escondido, a cada quatro) e o registro do mostrado. */
async function tique($: EngineInterface): Promise<void> {
  if (!ativa) return
  tiques++
  const aVista = await painelAVista($)
  if (aVista || tiques % TIQUES_ESCONDIDO === 0) await conferirMudanca($, aVista)
  await registrarMostrados($)
}

/** O retrato da secao `hitl` como sinal de mudanca, e o pulse quando o retrato muda ou o pulse fica velho (D3). */
async function conferirMudanca($: EngineInterface, aVista: boolean): Promise<void> {
  const agora = await $.clock.now()
  let mudou = false
  try {
    const r = await comPrazo($, $.ork.retrato({ secao: 'hitl' }))
    const nova = assinaturaDoRetrato(r.retrato)
    mudou = assinatura !== null && nova !== assinatura
    assinatura = nova
  } catch (erro) {
    await anotarAviso($, `não li o retrato do núcleo: ${mensagem(erro)}`)
  }
  const idade = pulseLidoEm === null ? Number.POSITIVE_INFINITY : agora - pulseLidoEm
  const noRecuo = pulseFalhouEm !== null && agora - pulseFalhouEm < recuoMs
  // Decisao obvia incerta: o pulse e relido a cada conferencia ate ela aparecer ou vencer a incerteza.
  const incerta = Object.values(await read($, obvias)).some(o => o.estado === 'incerta')
  if (!noRecuo && (mudou || incerta || idade >= (aVista ? IDADE_DO_PULSE_A_VISTA_MS : IDADE_DO_PULSE_ESCONDIDO_MS))) await atualizar($)
}

/** Uma leitura por vez; pedido que chega no meio volta a rodar logo depois, e quem pediu espera as duas. */
async function atualizar($: EngineInterface): Promise<void> {
  if (!ativa) return
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

/** O pulse, as decisoes ja mostradas e os pedidos de cada thread com pergunta; depois a decisao obvia e o aviso. */
async function lerUmaVez($: EngineInterface): Promise<void> {
  const agora = await $.clock.now()
  let pulse: unknown
  try {
    pulse = await comPrazo($, $.ork.ler({ consulta: 'pulse' }))
  } catch (erro) {
    const motivo = mensagem(erro)
    pulseFalhouEm = agora
    recuoMs = Math.min(recuoMs ? recuoMs * 2 : RECUO_INICIAL_MS, RECUO_MAXIMO_MS)
    await update($, fila, anterior => ({ ...anterior, erro: motivo }))
    await publicarFaixa($)
    return
  }
  pulseLidoEm = agora
  pulseFalhouEm = null
  recuoMs = 0
  const avisos: string[] = []
  let vistas = new Set<string>()
  let jaNotificados = new Set<string>()
  try {
    const registro = await comPrazo($, $.ork.mostrados())
    vistas = decisoesVistas(registro)
    jaNotificados = pedidosNotificados(registro)
  } catch (erro) {
    avisos.push(`não li o registro do que a Mesa já mostrou: ${mensagem(erro)}`)
  }
  const base = filaDoPulse(pulse, vistas, agora)
  const perguntas: MesaPergunta[] = []
  for (const thread of threadsComPergunta(base.perguntas)) {
    const daThread = base.perguntas.filter(p => p.thread === thread)
    try {
      const pendentes = jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_hitl_pending', { threadId: thread })))
      for (const p of daThread) {
        const conferida = conferirNoNucleo(p, pendentes)
        if (conferida) perguntas.push(conferida)
      }
    } catch (erro) {
      avisos.push(`não conferi os pedidos da ${thread} no núcleo: ${mensagem(erro)}`)
      perguntas.push(...daThread)
    }
  }
  const nova: MesaFila = { ...base, perguntas: ordenarPerguntas(perguntas), lidoEm: agora, erro: null, avisos }
  await update($, fila, () => nova)
  const registrou = await registrarObvias($, nova, agora)
  await notificarNovas($, nova, jaNotificados)
  await publicarFaixa($)
  await registrarMostrados($)
  // A decisao pedida agora chega no lote seguinte: o pulse e relido logo depois (e a incerta se resolve nele).
  if (registrou) pendente = true
}

/**
 * A decisao obvia (D5 e D6): para cada pergunta conferida no nucleo que passa no teste das quatro condicoes e que a
 * Mesa ainda nao decidiu (nesta sessao, nem na janela do pulse), uma chamada de `ork_decision_record`. Nunca responde
 * o pedido e nunca abre o dialogo. Chamada que falha ou passa do prazo fica `incerta`, porque a escrita pode ter
 * chegado ao nucleo: o pulse e relido ate ela aparecer (`registrada`) ou vencer a incerteza (`recusada`: a pergunta
 * volta a esperar o dono, com o motivo no cartao). Decisao que aparece no pulse depois sempre vira `registrada`.
 */
async function registrarObvias($: EngineInterface, f: MesaFila, agora: number): Promise<boolean> {
  let pediu = false
  const ja = await read($, obvias)
  for (const p of f.perguntas) {
    const anterior = ja[p.pedidoId]
    if (anterior) {
      if (anterior.estado !== 'registrada' && jaDecidida(f.decisoes, p)) {
        await update($, obvias, o => ({ ...o, [p.pedidoId]: { estado: 'registrada', texto: 'registrada no núcleo (conferida no pulse)', em: agora } }))
      } else if (anterior.estado === 'incerta' && agora - anterior.em >= INCERTEZA_MAXIMA_MS) {
        await update($, obvias, o => ({ ...o, [p.pedidoId]: { estado: 'recusada', texto: anterior.texto, em: agora } }))
      }
      continue
    }
    if (registrando.has(p.pedidoId) || !p.conferida) continue
    const teste = testeDaObvia(p, agora)
    if (!teste.obvia) continue
    if (jaDecidida(f.decisoes, p)) {
      await update($, obvias, o => ({ ...o, [p.pedidoId]: { estado: 'registrada', texto: 'já registrada pela Mesa', em: agora } }))
      continue
    }
    registrando.add(p.pedidoId)
    let obvia: MesaObvia
    try {
      const args = argsDaDecisaoObvia(p, teste.alternativa, teste.referencia, new Date(agora).toISOString())
      let resposta: unknown
      try {
        resposta = await comPrazo($, $.mcp.call('orkastery', 'ork_decision_record', args), PRAZO_DA_DECISAO_MS)
      } catch (erro) {
        // Sem resposta do nucleo (prazo ou transporte): a escrita pode ter chegado.
        resposta = undefined
        obvia = { estado: 'incerta', texto: mensagem(erro), em: agora }
      }
      if (resposta !== undefined) {
        try {
          jsonDoMcp(resposta)
          obvia = { estado: 'registrada', texto: 'registrada no núcleo', em: agora }
        } catch (erro) {
          // O nucleo respondeu com recusa: nada foi gravado.
          obvia = { estado: 'recusada', texto: mensagem(erro), em: agora }
        }
      }
    } finally {
      registrando.delete(p.pedidoId)
    }
    const final = obvia!
    await update($, obvias, o => ({ ...o, [p.pedidoId]: final }))
    pediu = true
  }
  return pediu
}

/**
 * A pergunta nova que espera o dono (nao obvia, ainda nao notificada nesta sessao nem no registro da ponte) vira uma
 * notificacao do sistema, uma so por leitura. So a que saiu de fato conta como notificada e entra no registro do
 * mostrado com o canal `notificacao` (D8 e M5): a que nao saiu fica no aviso do painel e volta na leitura seguinte.
 */
async function notificarNovas($: EngineInterface, f: MesaFila, jaNotificados: ReadonlySet<string>): Promise<void> {
  const novas = esperamODono(f, await read($, obvias)).filter(p => !notificados.has(p.pedidoId) && !jaNotificados.has(p.pedidoId))
  if (!novas.length) return
  const primeira = novas[0] as MesaPergunta
  const texto = novas.length === 1
    ? umaLinha(`${primeira.thread} espera você: ${primeira.pergunta}`)
    : umaLinha(`${novas.length} pedidos esperam você: ${[...new Set(novas.map(p => p.thread))].join(', ')}`)
  let motivo: string | null
  try {
    const enviada = await $.ui.notify(texto, { title: TITULO })
    motivo = enviada.isSent ? null : `a notificação do sistema não saiu (${String(enviada.reason)})`
  } catch (erro) {
    motivo = mensagem(erro)
  }
  if (motivo !== null) {
    await anotarAviso($, `não avisei o dono do pedido novo: ${motivo}; a faixa e o painel seguem`)
    return
  }
  for (const p of novas) notificados.add(p.pedidoId)
  try {
    for (const p of novas) await $.ork.mostrado({ mod: MOD, canal: 'notificacao', chave: `hitl:${p.pedidoId}`, thread: p.thread, texto })
  } catch (erro) {
    await anotarAviso($, `não registrei a notificação na ponte: ${mensagem(erro)}`)
  }
}

/** A linha da faixa pela ponte, so quando o texto muda; sem nada, a linha sai da faixa. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(await read($, fila), await read($, obvias))
  if (texto === ultimaFaixa) return
  try {
    if (texto === undefined) await $.ork.faixa({ mod: MOD })
    else await $.ork.faixa({ mod: MOD, texto })
    ultimaFaixa = texto
  } catch (erro) {
    await anotarAviso($, `não publiquei a linha da faixa: ${mensagem(erro)}`)
  }
}

/** O desenho anota o que pos na janela; quem registra e o laco de leitura e o tique, fora do desenho. */
function anotarVistos(vistos: readonly MesaMostrado[]): void {
  for (const m of vistos) vistosNoDesenho.set(`${m.chave}|${m.texto}`, m)
}

/**
 * O que o desenho pos na janela do painel posto e a vista vai ao registro da ponte (M5 do dono, D8), uma vez por
 * chave e texto nesta sessao. Com o painel escondido, o anotado e descartado: o proximo desenho a vista anota de novo.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  if (vistosNoDesenho.size === 0) return
  if (!await painelAVista($)) {
    vistosNoDesenho.clear()
    return
  }
  for (const [vista, m] of [...vistosNoDesenho]) {
    vistosNoDesenho.delete(vista)
    if (jaMostrado.has(vista)) continue
    try {
      const thread = m.thread && ID.test(m.thread) ? { thread: m.thread } : {}
      await $.ork.mostrado({ mod: MOD, canal: 'painel', chave: m.chave, ...thread, texto: m.texto })
      jaMostrado.add(vista)
    } catch (erro) {
      vistosNoDesenho.set(vista, m)
      await anotarAviso($, `não registrei o que o painel mostrou: ${mensagem(erro)}`)
      return
    }
  }
}

/**
 * O Decidir (D7): so com o canal `claude-code` disponivel para o pedido, um por pedido, em segundo plano. A chamada
 * leva exatamente o `threadId` e o `pedidoId`; quem responde e o dono, no dialogo nativo do host.
 */
async function decidir($: EngineInterface, pedidoId: string): Promise<void> {
  if (!ID.test(pedidoId) || emDialogo.has(pedidoId)) return
  // Marcado antes de qualquer espera: dois toques ao mesmo tempo abrem um dialogo so.
  emDialogo.add(pedidoId)
  let emCurso = false
  try {
    const p = (await read($, fila)).perguntas.find(x => x.pedidoId === pedidoId)
    if (!p || p.canalClaudeCode !== 'disponivel') return
    const pedidoEm = await $.clock.now()
    await update($, decidindo, d => ({ ...d, [pedidoId]: { estado: 'abrindo', texto: 'diálogo pedido', em: pedidoEm } }))
    emCurso = true
    pedirDialogo($, p)
  } finally {
    if (!emCurso) emDialogo.delete(pedidoId)
  }
}

/** O pedido do dialogo ao nucleo, em segundo plano; quem libera o pedido para outro Decidir e o fim desta espera. */
function pedirDialogo($: EngineInterface, p: MesaPergunta): void {
  const pedidoId = p.pedidoId
  emSegundoPlano($, (async () => {
    let r: MesaDecidindo
    try {
      const resposta = jsonDoMcp(await comPrazo($, $.mcp.call('orkastery', 'ork_request_decision', argsDoDecidir(p)), PRAZO_DO_DECIDIR_MS))
      r = resultadoDoDecidir(resposta, await $.clock.now())
    } catch (erro) {
      r = { estado: 'erro', texto: `o Decidir falhou: ${mensagem(erro)}; use a reserva`, em: await $.clock.now() }
    } finally {
      emDialogo.delete(pedidoId)
    }
    await update($, decidindo, d => ({ ...d, [pedidoId]: r }))
    await atualizar($)
  })(), `o Decidir do pedido ${pedidoId.slice(0, 8)}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // `/mesa` abre o painel e rele a fila; `/mesa <thread>` (a Torre o usa para a acao `hitl.decide`) mostra so a
  // thread pedida. O comando so existe com a Mesa ligada; a conferencia do papel aqui cobre o comando que sobrou de
  // uma carga anterior.
  on('command.run', { command: 'mesa' }, async ($, e) => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'A Mesa do Dono só abre na sessão do dono de um projeto do Orkastery.' }
    const pedida = String(e.args ?? '').trim()
    const thread = ID.test(pedida) ? pedida : null
    await update($, foco, () => thread)
    await update($, pagina, () => 0)
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO })
    await atualizar($)
    const sufixo = thread ? ` (só ${thread})` : ''
    return { text: aberto.isPlaced ? `Mesa do Dono aberta${sufixo}.` : `Mesa do Dono aberta${sufixo}, à espera de lugar: ${aberto.reason}` }
  })

  // O painel: o placar, o lote de perguntas, as decisoes por voce e as paradas. O desenho nunca escreve: so anota o
  // que pos na janela de rolagem, para o registro do mostrado. Os gestos mudam o estado da Mesa e pedem ao nucleo.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const lida = await read($, fila)
    const estado = {
      fila: problemaSemAviso ? { ...lida, avisos: [...lida.avisos, problemaSemAviso] } : lida, foco: await read($, foco),
      pagina: await read($, pagina), decidindo: await read($, decidindo), obvias: await read($, obvias),
    }
    const linhas = linhasDaMesa(estado, { agora: await $.clock.now() })
    anotarVistos(mostradosVisiveis(linhas, e.props.scroll))
    const total = estado.foco ? estado.fila.perguntas.filter(p => p.thread === estado.foco).length : estado.fila.perguntas.length
    return desenharMesa({ Box, Text, Button }, linhas, {
      decidir: pedidoId => { emSegundoPlano($, decidir($, pedidoId), 'o Decidir') },
      atualizar: () => { emSegundoPlano($, atualizar($), 'a releitura da fila') },
      verTodas: () => { emSegundoPlano($, update($, foco, () => null), 'o Ver todas') },
      // A pagina guardada pode passar do fim depois que a fila encolhe: o passo parte da pagina que esta na tela.
      anteriores: () => { emSegundoPlano($, update($, pagina, n => paginaDoLote(total, paginaDoLote(total, n).pagina - 1).pagina), 'o lote anterior') },
      proximas: () => { emSegundoPlano($, update($, pagina, n => paginaDoLote(total, paginaDoLote(total, n).pagina + 1).pagina), 'o lote seguinte') },
    })
  })
}
