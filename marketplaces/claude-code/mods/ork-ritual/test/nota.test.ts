import { test, expect, mock } from 'claude-code/testing'
import { abrirNota, EPOCA, esperar, iniciar, itemMaster, montar, montarPainel, PONTE_FALSA, retratoMaster, saida, textosDe, textosDoPainel } from './apoio'

// O "Dar a nota" e a reserva pelo Telegram (T8.3). O botao so pede ao nucleo o dialogo nativo, com o `threadId` e nada
// mais; quem da a nota e o porque e o dono, no dialogo do host. Sem dialogo, a reserva aparece, e o pedido pelo Telegram
// (`ork master pedir`) so roda no clique. Nenhum argv leva nota.
const PAGINAS = { 0: retratoMaster([itemMaster('ork-a', { dias: 2 }), itemMaster('ork-b', { status: 'pending', dias: 1 })]) }
const SO_A_B = { 0: retratoMaster([itemMaster('ork-b', { status: 'pending', dias: 1 })]) }
const LISTA_FECHADA = ['ork_claims_list', 'ork_request_master_note']

async function pronto($, on, extra = {}) {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS, ...extra })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  await abrirNota($)
  await esperar(() => mundo.maestro.length > 1)
  await esperar(() => false, 10)
  return { relogio, mundo }
}

test('Dar a nota chama so ork_request_master_note com exatamente o threadId; a nota registrada sai da lista e fica no alto', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.paginasDepoisDaNota = SO_A_B
  const ui = await montarPainel($, 'terminal')
  expect((await textosDe(ui)).filter(t => t === 'Dar a nota').length).toBe(2)
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => mundo.maestro.length > 2)
  await esperar(() => false, 10)
  expect(mundo.notas).toEqual([{ threadId: 'ork-a' }])
  expect(Object.keys(mundo.notas[0] as object)).toEqual(['threadId'])
  const textos = await textosDe(ui)
  expect(textos).toContain('✓ nota 4/5 da ork-a registrada pelo diálogo nativo')
  expect(textos.filter(t => t.startsWith('● '))).toEqual(['● espera sua nota · ork-b · entregue 19/10 14:20 (horário de Brasília) · merge aaaaaaaa'])
  await ui.unmount()
  // O Ritual nao roda processo nem chama outra ferramenta para dar a nota.
  expect(mundo.processos).toEqual([])
  expect(mundo.outrasMcp).toEqual([])
})

test('a nota registrada sai da lista e da faixa na hora, mesmo com a pagina velha que a ponte ainda guarda', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  // O nucleo registrou, mas a pagina guardada pela ponte (ate 60 s) ainda lista a ork-a: o Ritual a tira pela nota.
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => mundo.maestro.length > 2)
  await esperar(() => false, 10)
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-ritual', texto: '1 entrega espera a sua nota: ork-b · /nota' })
  const textos = await textosDe(ui)
  expect(textos).toContain('✓ nota 4/5 da ork-a registrada pelo diálogo nativo')
  expect(textos.filter(t => t.startsWith('● '))).toEqual(['● espera sua nota · ork-b · entregue 19/10 14:20 (horário de Brasília) · merge aaaaaaaa'])
  await ui.unmount()
})

test('a nota registrada sai da lista e da faixa pela resposta do nucleo, mesmo quando a releitura logo depois falha', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.maestroFalha = true
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => mundo.maestro.length > 2)
  await esperar(() => false, 10)
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-ritual', texto: '1 entrega espera a sua nota: ork-b · /nota' })
  const textos = await textosDe(ui)
  expect(textos.some(t => t.startsWith('a última leitura falhou: '))).toBe(true)
  expect(textos.filter(t => t.startsWith('● ')).map(t => t.split(' · ')[1])).toEqual(['ork-b'])
  await ui.unmount()
})

test('dois toques seguidos no Dar a nota, antes do redesenho, chamam o nucleo uma vez so', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.atrasoRealDaNotaMs = 60
  const ui = await montarPainel($, 'terminal')
  await Promise.all([ui.press({ key: 'nota:ork-a' }), ui.press({ key: 'nota:ork-a' })])
  await esperar(() => false, 80)
  expect(mundo.notas.length).toBe(1)
  await ui.unmount()
})

test('dois toques seguidos no Pelo Telegram, antes do redesenho, rodam um pedido so', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.erroNota = 'master.nota.sem-dialogo: este cliente MCP não abre formulário'
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => false, 10)
  mundo.atrasoRealDaReservaMs = 60
  await Promise.all([ui.press({ key: 'telegram:ork-a' }), ui.press({ key: 'telegram:ork-a' })])
  await esperar(() => false, 80)
  expect(mundo.processos).toEqual([['ork', 'master', 'pedir', 'ork-a', '--formato', 'json']])
  await ui.unmount()
})

test('depois de uma recarga, o dialogo e o pedido que ficaram em curso voltam a ter o botao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  // O estado que a carga anterior deixou: um dialogo aberto na ork-a e um pedido pelo Telegram rodando na ork-b.
  const deixado: Record<string, unknown> = {
    notas: { 'ork-a': { estado: 'abrindo', texto: '', em: EPOCA - 5000 } },
    reservas: { 'ork-b': { estado: 'pedindo', texto: '', codigo: null, em: EPOCA - 5000 } },
  }
  on('state.get', { plugin: 'ork-ritual' }, async ($, e, next) => {
    const chave = (e as { key: string }).key
    if (chave in deixado) {
      const value = deixado[chave]
      delete deixado[chave]
      return { value: { value, version: 1 } }
    }
    return next(e)
  })
  const { mundo } = await pronto($, on)
  expect(Object.keys(deixado)).toEqual([])
  const textos = await textosDoPainel($, 'terminal')
  expect(textos.filter(t => t === 'Dar a nota').length).toBe(2)
  expect(textos).toContain('  o diálogo ficou sem resposta (o Ritual recarregou); a entrega segue esperando')
  expect(textos).toContain('  o pedido pelo Telegram foi interrompido por uma recarga; peça de novo')
  expect(textos).not.toContain('  diálogo da nota aberto no Claude Code: responda lá')
  expect(mundo.notas).toEqual([])
})

test('dois toques no Dar a nota abrem um dialogo so, e o cartao diz que ele esta aberto', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.atrasoRealDaNotaMs = 60
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => false, 5)
  const durante = await textosDe(ui)
  expect(durante).toContain('  diálogo da nota aberto no Claude Code: responda lá')
  expect(durante.filter(t => t === 'Dar a nota').length).toBe(1)
  await esperar(() => false, 60)
  expect(mundo.notas.length).toBe(1)
  await ui.unmount()
})

test('sem dialogo nativo, o cartao mostra a reserva; so o clique em Pelo Telegram roda ork master pedir e mostra o codigo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await pronto($, on)
  mundo.erroNota = 'master.nota.sem-dialogo: este cliente MCP não abre formulário; peça a nota pelo Telegram com ork master pedir ork-a'
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => false, 10)
  let textos = await textosDe(ui)
  expect(textos).toContain('  o diálogo nativo não abriu: este cliente MCP não abre formulário; peça a nota pelo Telegram')
  expect(textos).toContain('Pelo Telegram')
  // Sem o clique, nenhum pedido sai, nem com o tempo passando.
  await relogio.advance(60000)
  expect(mundo.processos).toEqual([])
  await ui.press({ key: 'telegram:ork-a' })
  await esperar(() => mundo.processos.length > 0)
  await esperar(() => false, 10)
  expect(mundo.processos).toEqual([['ork', 'master', 'pedir', 'ork-a', '--formato', 'json']])
  textos = await textosDe(ui)
  expect(textos).toContain('  pelo Telegram, responda: K7QX <0 a 5> <porquê>')
  await ui.unmount()
  for (const argv of mundo.processos as string[][]) expect(argv.some(a => a.startsWith('--sc'))).toBe(false)
})

test('o nucleo sem a ferramenta da nota tambem leva a reserva; a reserva que falha mostra o motivo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.erroNota = 'mcp.tool.unknown'
  mundo.reserva = { exitCode: 1, stdout: '', stderr: 'MASTER exige entrega: ship_done ou artefato' }
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: 'nota:ork-b' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => false, 10)
  expect(await textosDe(ui)).toContain('  o núcleo desta sessão não tem a ferramenta da nota; atualize o Orkastery ou peça a nota pelo Telegram')
  await ui.press({ key: 'telegram:ork-b' })
  await esperar(() => mundo.processos.length > 0)
  await esperar(() => false, 10)
  expect(await textosDe(ui)).toContain('  o pedido pelo Telegram falhou: MASTER exige entrega: ship_done ou artefato')
  mundo.reserva = saida(0, '{"contrato":"outro"}').value
  await ui.press({ key: 'telegram:ork-b' })
  await esperar(() => mundo.processos.length > 1)
  await esperar(() => false, 10)
  expect(await textosDe(ui)).toContain('  o pedido pelo Telegram não devolveu o contrato ork.master-nota/v1')
  await ui.unmount()
})

test('dialogo fechado sem nota deixa a entrega esperando com o botao; nota que ja existia vira repetida; erro do nucleo leva a reserva', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on)
  mundo.respostaNota = { ok: false, threadId: 'ork-a', estado: 'pendente', repetida: false }
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await esperar(() => false, 10)
  let textos = await textosDe(ui)
  expect(textos).toContain('  o diálogo fechou sem nota; a entrega segue esperando')
  expect(textos.filter(t => t === 'Dar a nota').length).toBe(2)
  expect(textos).not.toContain('Pelo Telegram')
  mundo.respostaNota = { ok: true, threadId: 'ork-b', estado: 'registrada', repetida: true, score: 5 }
  await ui.press({ key: 'nota:ork-b' })
  await esperar(() => mundo.notas.length > 1)
  await esperar(() => false, 10)
  // A nota que ja existia tira a entrega da lista na hora, como a registrada, e fica no alto.
  expect(await textosDe(ui)).toContain('✓ a ork-b já tinha nota humana 5/5 no núcleo')
  mundo.respostaNota = null
  mundo.erroNota = 'hitl.local.chave-invalida'
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 2)
  await esperar(() => false, 10)
  textos = await textosDe(ui)
  expect(textos).toContain('  o Dar a nota falhou: hitl.local.chave-invalida; peça a nota pelo Telegram')
  expect(textos).toContain('Pelo Telegram')
  await ui.unmount()
})

test('no replay o Dar a nota tambem aparece, e o painel com os botoes vale no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { mundo } = await pronto($, on, { claims: { 'ork-a': [] } })
  await abrirNota($, 'ork-a')
  await esperar(() => mundo.claimsPedidas.length > 0)
  await esperar(() => false, 10)
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    expect(textos.slice(0, 3)).toEqual(['Ritual do MASTER · prova da ork-a', 'Voltar', 'Atualizar'])
    expect(textos).toContain('Dar a nota')
    expect(textos).not.toContain('Ver a prova')
    expect(textos).toContain('Nenhuma claim ativa registrada na ork-a.')
  }
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'nota:ork-a' })
  await esperar(() => mundo.notas.length > 0)
  await ui.unmount()
  expect(mundo.notas).toEqual([{ threadId: 'ork-a' }])
  // So as duas ferramentas da lista fechada chegaram ao nucleo.
  expect(mundo.outrasMcp).toEqual([])
  for (const ferramenta of ['ork_claims_list', 'ork_request_master_note']) expect(LISTA_FECHADA).toContain(ferramenta)
})
