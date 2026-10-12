import { test, expect, mock } from 'claude-code/testing'
import {
  abrirMensageiro, ENVIO, entradaDe, EPOCA, esperar, iniciar, mensagemDe, montar, PEDIDO, PONTE_FALSA, RESPOSTA, retratoHitl, SESSAO,
  textosDoPainel, THREAD,
} from './apoio'

// O lado do dono do Mensageiro (T9.2): a caixa de saida do nucleo (`ork_session_outbox`), o envio por
// `$.session.send` sem mexer no texto, a anotacao no nucleo, o reenvio da D10, a faixa e os papeis. O nucleo e o
// fundo `mcp.call`; a sessao de fase e o fundo `session.send`. Respostas SIMULADAS.
const OUTRO_PEDIDO = 'c3c3c3c3-d4d4-4e5e-8f6f-a7a7a7a7a7a7'
const OUTRO_ENVIO = 'd5d5d5d5-e6e6-4f7f-8a8a-b9b9b9b9b9b9'

async function ligado($, on, opcoes: { caixa?: unknown[]; retrato?: unknown } = {}) {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', ...opcoes })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.listar > 0)
  await esperar(() => false, 20)
  return { relogio, mundo }
}

test('a resposta da caixa vai a sessao de fase como o nucleo a compos, o envio e anotado e a faixa diz a caminho', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await ligado($, on, { caixa: [entradaDe()], retrato: retratoHitl([{ pedido: PEDIDO, incerto: true }]) })
  expect(mundo.comandos).toEqual(['mensageiro'])
  await esperar(() => mundo.anotacoes.length > 0)
  expect(mundo.envios.length).toBe(1)
  expect(mundo.envios[0].text).toBe(mensagemDe())
  expect(JSON.stringify(mundo.envios[0].to)).toContain(SESSAO)
  expect(mundo.anotacoes).toEqual([{ operacao: 'enviada', threadId: THREAD, envioId: ENVIO, entregue: true }])
  await esperar(() => mundo.faixas.length > 0)
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-mensageiro', texto: `resposta a caminho da ${THREAD}` })
  // So as duas ferramentas da entrega e o retrato: nada de processo, de texto do dono ou de linha de usuario.
  expect(mundo.outrasMcp).toEqual([])
  expect(mundo.proibidas).toEqual([])
})

test('o que o receptor reservou nao vai de novo, e o que nao entrou na fila volta so depois do recuo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligado($, on, { caixa: [
    entradaDe({ reservada: true, tentativas: 1, ultimoEnvio: { em: EPOCA - 120000, entregue: true } }),
    entradaDe({ pedido: OUTRO_PEDIDO, envio: OUTRO_ENVIO, tentativas: 1, ultimoEnvio: { em: EPOCA, entregue: false, motivo: 'sessão não está rodando' } }),
  ] })
  expect(mundo.envios).toEqual([])
  // O tique de 20 s ainda cai no recuo de 30 s; o de 40 s ja passa dele.
  await relogio.advance(20000)
  await esperar(() => false, 20)
  expect(mundo.envios).toEqual([])
  await relogio.advance(20000)
  await esperar(() => mundo.envios.length > 0)
  expect(mundo.envios.map(e => e.text)).toEqual([mensagemDe(OUTRO_PEDIDO, OUTRO_ENVIO)])
  expect(mundo.anotacoes.map(a => a.envioId)).toEqual([OUTRO_ENVIO])
})

test('o que entrou na fila e ninguem reservou volta depois de 60 s; depois de 10 envios o Mensageiro desiste e a faixa pede o attach', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligado($, on, { caixa: [entradaDe({ tentativas: 1, ultimoEnvio: { em: EPOCA, entregue: true } })],
    retrato: retratoHitl([{ pedido: PEDIDO, incerto: true }]) })
  expect(mundo.envios).toEqual([])
  await relogio.advance(40000)
  await esperar(() => false, 20)
  expect(mundo.envios).toEqual([])
  await relogio.advance(20000)
  await esperar(() => mundo.envios.length > 0)
  expect(mundo.envios.length).toBe(1)
  // Nove envios ja feitos e o ultimo sem reserva: o decimo vai, e depois dele nada mais.
  mundo.caixa[0] = { ...mundo.caixa[0], tentativas: 9 }
  await relogio.advance(60000)
  await esperar(() => mundo.envios.length > 1)
  await relogio.advance(5 * 60000)
  await esperar(() => false, 40)
  expect(mundo.envios.length).toBe(2)
  await esperar(() => mundo.faixas.some(f => /não chegou/.test(f.texto ?? '')))
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-mensageiro', texto: `a resposta para a ${THREAD} não chegou; responda pelo claude attach` })
})

test('entregue: a entrega sai da caixa e o pedido sai do retrato; a faixa diz entregue e depois sai', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligado($, on, { caixa: [entradaDe()], retrato: retratoHitl([{ pedido: PEDIDO, incerto: true }]) })
  await esperar(() => mundo.anotacoes.length > 0)
  // O receptor confirmou: o nucleo tira a entrega da caixa e o pedido sai da secao hitl do retrato.
  mundo.caixa.length = 0
  mundo.retrato = retratoHitl([])
  await relogio.advance(20000)
  await esperar(() => mundo.faixas.some(f => /entregue/.test(f.texto ?? '')))
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-mensageiro', texto: `resposta entregue à ${THREAD}` })
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    expect(textos).toContain(`✓ ${THREAD} · pedido ${PEDIDO.slice(0, 8)} · entregue, com o recibo da sessão · agora`)
  }
  // Passados 10 min, a linha sai da faixa.
  await relogio.advance(11 * 60000)
  await esperar(() => mundo.faixas.at(-1)?.texto === undefined)
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-mensageiro' })
})

test('o envio que nao entra na fila fica com o motivo, e o que sai da caixa com o pedido aberto pede o attach', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligado($, on, { caixa: [entradaDe()], retrato: retratoHitl([{ pedido: PEDIDO, incerto: true }]) })
  await esperar(() => mundo.anotacoes.length > 0)
  expect(mundo.anotacoes[0].entregue).toBe(true)
  mundo.respostaDoEnvio = { isDelivered: false, reason: 'no session by that id is running' }
  mundo.caixa[0] = { ...mundo.caixa[0], tentativas: 1, ultimoEnvio: { em: new Date(EPOCA - 70000).toISOString(), entregue: true, motivo: null } }
  await relogio.advance(20000)
  await esperar(() => mundo.anotacoes.length > 1)
  expect(mundo.anotacoes[1]).toEqual({ operacao: 'enviada', threadId: THREAD, envioId: ENVIO, entregue: false, motivo: 'no session by that id is running' })
  // A caixa soltou a entrega (o servidor do dono reiniciou) com o pedido ainda aberto no retrato.
  mundo.caixa.length = 0
  await relogio.advance(20000)
  await esperar(() => mundo.faixas.some(f => /não chegou/.test(f.texto ?? '')))
  const textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain(`? ${THREAD} · pedido ${PEDIDO.slice(0, 8)} · saiu da caixa sem recibo: responda pelo claude attach · 2 envios · agora`)
  // O pedido que esta sessao conhece nao aparece como se seguisse noutra sessao do dono.
  expect(textos).not.toContain('Noutra sessão do dono')
})

test('sem a caixa de saida lida, nada e enviado e o painel diz por que', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', caixa: [entradaDe()] })
  mundo.caixaFalha = 'mcp.tool.unknown'
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.listar > 0)
  await esperar(() => false, 20)
  expect(mundo.envios).toEqual([])
  const textos = await textosDoPainel($, 'desktop')
  expect(textos.some(t => t.startsWith('× a caixa de saída não foi lida: ork_session_outbox recusou: mcp.tool.unknown'))).toBe(true)
})

test('na sessao de fase e na dormente o lado do dono nao liga: nem /mensageiro, nem caixa, nem envio', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'fase', caixa: [entradaDe()] })
  await iniciar($, false)
  await relogio.advance(5 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.listar).toBe(0)
  expect(mundo.envios).toEqual([])
  expect(mundo.faixas).toEqual([])
  expect((await abrirMensageiro($)).text).toBe('O Mensageiro de Sessões só abre na sessão do dono de um projeto do Orkastery.')
})

test('dormente no inicio, o Mensageiro confere o papel de novo e liga quando a sessao vira do dono', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dormente', caixa: [entradaDe()] })
  await iniciar($)
  expect(mundo.comandos).toEqual([])
  mundo.papel = 'dono'
  await relogio.advance(3000)
  expect(mundo.comandos).toEqual(['mensageiro'])
  await relogio.advance(1)
  await esperar(() => mundo.envios.length > 0)
  expect(mundo.envios[0].text).toBe(mensagemDe())
})

test('o texto da resposta nao aparece no painel nem na faixa, so a thread, o pedido e o estado', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await ligado($, on, { caixa: [entradaDe()], retrato: retratoHitl([{ pedido: PEDIDO, incerto: true }]) })
  await esperar(() => mundo.faixas.length > 0)
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    expect(textos.some(t => t.includes(RESPOSTA))).toBe(false)
    expect(textos.some(t => t.includes(`${THREAD} · pedido ${PEDIDO.slice(0, 8)}`))).toBe(true)
  }
  expect(JSON.stringify(mundo.faixas).includes(RESPOSTA)).toBe(false)
  expect(JSON.stringify(mundo.mostrados).includes(RESPOSTA)).toBe(false)
})
