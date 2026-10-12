import { test, expect, mock } from 'claude-code/testing'
import {
  A_VISTA, decisaoDe, drenar, EPOCA, iniciar, mesa, montar, montarPainel, PARADA, PEDIDO_4, pendentesDe, PONTE_FALSA, pulseCom,
  retratoHitl, textosDe, textosDoPainel,
} from './apoio'

// Os cartoes da Mesa na sessao do dono (T5.2), com o pulse, o retrato e os pedidos de cada thread entregues pela
// ponte falsa e pelo fundo do teste. Cada pedido e sintetico, no contrato `ork.hitl/v2`.
const DECISOES = [
  decisaoDe({ id: 'd1000000-0000-4000-8000-000000000001', thread: 'ork-a', minutos: 30 }),
  decisaoDe({ id: 'd2000000-0000-4000-8000-000000000002', thread: 'ork-c', minutos: 90, decidido: 'O merge da origin/main entrou antes do GO' }),
]

test('na sessao do dono, o /mesa abre o painel e o cartao traz a recomendada primeiro, no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) } })
  await iniciar($)
  expect(mundo.comandos).toEqual(['mesa'])
  const r = await mesa($)
  expect(r.text).toBe('Mesa do Dono aberta.')
  expect(mundo.abertos).toEqual(['mesa'])
  expect(mundo.ler.every(l => l.consulta === 'pulse')).toBe(true)
  expect(mundo.hitlPending.at(-1)).toEqual({ threadId: 'ork-a' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    const i = textos.indexOf('? ork-a · CHECK · código K7Q2 · prazo 12/10 14:46 (horário de Brasília)')
    expect(i).toBeGreaterThan(0)
    expect(textos.slice(i + 1, i + 9)).toEqual([
      '  Qual é o veredito sobre as evidências do CHECK?',
      '  Recomendada: c) Pedir o GO-FIX das claims velhas',
      '    porque: duas claims velhas reprovaram no HEAD',
      '    se escolher: consequência de c',
      '  a) Aprovar com as evidências apresentadas: consequência de a',
      '  b) Solicitar revisão: consequência de b',
      '  d) Continuar esperando: consequência de d',
      'Decidir',
    ])
    expect(textos[i + 9]).toBe('  reserva: K7Q2 c pelo Telegram')
    // Sem criterio escrito e o caso de todo gate que espera o dono: a regra nao se repete em cada cartao.
    expect(textos.some(t => t.startsWith('  pergunta:'))).toBe(false)
    expect(textos[0]).toBe('1 espera você (a mais antiga há 14 min) · 0 decididas sem te chamar · 0 paradas · lido há 0 s')
  }
})

test('sem o canal claude-code disponivel o cartao nao tem Decidir, so a reserva', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4], 'indisponivel') } })
  await iniciar($)
  await mesa($)
  const textos = await textosDoPainel($, 'terminal')
  expect(textos).not.toContain('Decidir')
  expect(textos).toContain('  reserva: K7Q2 c pelo Telegram')
})

test('sem o ork_hitl_pending o cartao fica com o pulse, sem Decidir, e o aviso diz o que faltou', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }) })
  await iniciar($)
  await mesa($)
  const textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain('? ork-a · CHECK · código K7Q2 · vence em 46 min')
  expect(textos).toContain('não conferi os pedidos da ork-a no núcleo: thread sem pedidos')
  expect(textos).toContain('  não conferido no núcleo agora: sem Decidir e sem decisão óbvia; use a reserva')
  expect(textos).not.toContain('Decidir')
})

test('decididas por voce: o que, o porque, como mudar e o custo, a nova primeiro; o resto vira contagem', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const muitas = Array.from({ length: 7 }, (_, n) => decisaoDe({ id: `d900000${n}-0000-4000-8000-00000000000${n}`, thread: 'ork-d', minutos: 2000 + n }))
  montar(on, {
    papel: 'dono', pulse: pulseCom({ decisoes: [...DECISOES, ...muitas] }),
    registro: [{ mod: 'ork-mesa', canal: 'painel', chave: 'decisao:d1000000-0000-4000-8000-000000000001', thread: 'ork-a', texto: 'visto' }],
  })
  await iniciar($)
  await mesa($)
  const textos = await textosDoPainel($, 'desktop')
  expect(textos[0]).toBe('0 esperam você · 9 decididas sem te chamar (1 nova) · 0 paradas · lido há 0 s')
  const i = textos.indexOf('✓ ork-c · GO · há 1 h · nova')
  expect(i).toBeGreaterThan(0)
  expect(textos.slice(i + 1, i + 6)).toEqual([
    '  O merge da origin/main entrou antes do GO',
    '  porque: a worktree nasceu sem core/node_modules',
    '  como mudar: Registrar decisão que reverte esta e regravar a baseline',
    '  reverter: agora, nenhum; depois, regravar a baseline',
    '  quem decidiu: sessão de fase claude-bg (GO, #Auto)',
  ])
  expect(textos[i + 6]).toBe('✓ ork-a · GO · há 30 min')
  expect(textos).toContain('  e mais 4 na janela do pulse (7 dias)')
  expect(textos.some(t => t === 'Decidir')).toBe(false)
})

test('paradas e impedimentos so leitura, com a recomendacao e o comando, sem botao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  montar(on, { papel: 'dono', pulse: pulseCom({ outros: [PARADA] }) })
  await iniciar($)
  await mesa($)
  const textos = await textosDoPainel($, 'terminal')
  const i = textos.indexOf('! ork-c · CHECK · claims.failed · há 3 h')
  expect(i).toBeGreaterThan(0)
  expect(textos.slice(i + 1, i + 4)).toEqual([
    '  C12 saiu com codigo 1', '  recomendação: corrija o artefato ou a alegacao e rode ork verify de novo', '  comando: ork verify ork-c',
  ])
  expect(textos.filter(t => ['Decidir', 'Anteriores', 'Próximas'].includes(t))).toEqual([])
})

test('a faixa sai pela ponte so quando o texto muda, e a linha sai quando nada espera o dono', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4], outros: [PARADA], decisoes: DECISOES }),
    pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) } })
  await iniciar($)
  await drenar()
  expect(mundo.faixas).toEqual([{ mod: 'ork-mesa', texto: 'mesa: 1 espera você (ork-a) · 1 parada · 2 decididas sem te chamar' }])
  await mesa($)
  expect(mundo.faixas.length).toBe(1)
  mundo.pulse = pulseCom({})
  await mesa($)
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-mesa' })
  await relogio.advance(20 * 60000)
  expect(mundo.faixas.length).toBe(2)
})

test('o /mesa da Torre mostra so a thread pedida, e Ver todas volta a fila inteira', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const outro = { ...PEDIDO_4, id: 'p5000000-0000-4000-8000-000000000005', thread: 'ork-e', codigo: 'E5E5' }
  montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4, outro] }),
    pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]), 'ork-e': pendentesDe('ork-e', [outro]) } })
  await iniciar($)
  expect((await mesa($, 'ork-e')).text).toBe('Mesa do Dono aberta (só ork-e).')
  const ui = await montarPainel($, 'terminal')
  let textos = await textosDe(ui)
  expect(textos).toContain('só ork-e')
  expect(textos.filter(t => t.startsWith('? '))).toEqual(['? ork-e · CHECK · código E5E5 · prazo 12/10 14:46 (horário de Brasília)'])
  await ui.press({ key: 'ver-todas' })
  textos = await textosDe(ui)
  expect(textos.filter(t => t.startsWith('? ')).length).toBe(2)
  await ui.unmount()
})

test('mais de cinco perguntas viram lotes de cinco, com Proximas e Anteriores', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const pedidos = Array.from({ length: 7 }, (_, n) => ({ ...PEDIDO_4, id: `p600000${n}-0000-4000-8000-00000000000${n}`, codigo: `Q${n}Q${n}`,
    prazo: new Date(EPOCA + (10 + n) * 60000).toISOString() }))
  montar(on, { papel: 'dono', pulse: pulseCom({ pedidos }), pendentes: { 'ork-a': pendentesDe('ork-a', pedidos) } })
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'desktop')
  let textos = await textosDe(ui)
  expect(textos.filter(t => t.startsWith('? ')).length).toBe(5)
  expect(textos).toContain('lote 1 de 2')
  await ui.press({ key: 'proximas' })
  textos = await textosDe(ui)
  expect(textos.filter(t => t.startsWith('? ')).length).toBe(2)
  expect(textos).toContain('lote 2 de 2')
  await ui.press({ key: 'anteriores' })
  expect(await textosDe(ui)).toContain('lote 1 de 2')
  await ui.unmount()
})

test('o registro do mostrado leva so o que estava na janela do painel a vista, uma vez por chave e texto', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4], decisoes: DECISOES }),
    pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) }, paineis: A_VISTA })
  await iniciar($)
  await mesa($)
  const doPainel = () => mundo.mostrados.filter(m => m.canal === 'painel')
  // Janela de 3 linhas: so o placar, a secao e o cabecalho da pergunta.
  let ui = await montarPainel($, 'terminal', { offset: 0, bodyRows: 3 })
  await ui.unmount()
  await relogio.advance(30000)
  expect(doPainel().map(m => m.chave)).toEqual(['hitl:p4000000-0000-4000-8000-000000000001'])
  expect(doPainel()[0]).toEqual({ mod: 'ork-mesa', canal: 'painel', chave: 'hitl:p4000000-0000-4000-8000-000000000001', thread: 'ork-a',
    texto: 'ork-a: espera você: Qual é o veredito sobre as evidências do CHECK?' })
  ui = await montarPainel($, 'terminal')
  await ui.unmount()
  await relogio.advance(30000)
  expect(doPainel().map(m => m.chave)).toEqual([
    'hitl:p4000000-0000-4000-8000-000000000001',
    'decisao:d1000000-0000-4000-8000-000000000001',
    'decisao:d2000000-0000-4000-8000-000000000002',
  ])
  // Com o painel escondido, o desenho anotado e descartado: a decisao nova desenhada ali nao entra no registro.
  mundo.paineis = []
  mundo.pulse = pulseCom({ pedidos: [PEDIDO_4], decisoes: [...DECISOES, decisaoDe({ id: 'd3000000-0000-4000-8000-000000000003', thread: 'ork-a', minutos: 5 })] })
  await mesa($)
  ui = await montarPainel($, 'terminal')
  expect(await textosDe(ui)).toContain('✓ ork-a · GO · há 6 min · nova')
  await ui.unmount()
  await relogio.advance(120000)
  expect(doPainel().length).toBe(3)
  // De novo a vista, o proximo desenho anota e registra.
  mundo.paineis = A_VISTA
  ui = await montarPainel($, 'terminal')
  await ui.unmount()
  await relogio.advance(30000)
  expect(doPainel().map(m => m.chave)).toContain('decisao:d3000000-0000-4000-8000-000000000003')
})

test('escondido, o retrato sai a cada 2 min e o pulse so passados 15 min sem mudanca; a vista, a cada tique e 5 min', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({}), retrato: retratoHitl([]) })
  await iniciar($)
  await drenar()
  const pulses = () => mundo.ler.filter(l => l.consulta === 'pulse').length
  expect(pulses()).toBe(1)
  await relogio.advance(90000)
  expect(mundo.maestro).toBe(0)
  await relogio.advance(30000)
  expect(mundo.maestro).toBe(1)
  await relogio.advance(12 * 60000)
  expect(pulses()).toBe(1)
  await relogio.advance(3 * 60000)
  await drenar()
  expect(pulses()).toBe(2)
  const antes = mundo.maestro
  mundo.paineis = A_VISTA
  await relogio.advance(60000)
  expect(mundo.maestro - antes).toBe(2)
})

test('o pulse que falha volta com recuo, e o aviso diz o que faltou; volta ao normal quando le de novo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) },
    paineis: A_VISTA })
  await iniciar($)
  await drenar()
  const pulses = () => mundo.ler.filter(l => l.consulta === 'pulse').length
  mundo.pulseFalha = true
  await relogio.advance(5 * 60000)
  await drenar()
  const depoisDaFalha = pulses()
  // Dez tiques a vista com o pulse fora do ar: o recuo (30 s, 60 s, 120 s, ...) segura as tentativas.
  await relogio.advance(5 * 60000)
  await drenar()
  expect(pulses() - depoisDaFalha).toBeLessThanOrEqual(3)
  const textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain('não reli a fila: ork-ponte: ler recusado')
  mundo.pulseFalha = false
  await mesa($)
  expect((await textosDoPainel($, 'terminal')).some(t => t.startsWith('não reli a fila'))).toBe(false)
})

test('a fila que encolhe com o lote 2 aberto: Anteriores volta ao lote que existe', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const pedidos = Array.from({ length: 11 }, (_, n) => ({ ...PEDIDO_4, id: `p70000${String(n).padStart(2, '0')}-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    codigo: `R${n}R${n}`, prazo: new Date(EPOCA + (10 + n) * 60000).toISOString() }))
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos }), pendentes: { 'ork-a': pendentesDe('ork-a', pedidos) } })
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: 'proximas' })
  await ui.press({ key: 'proximas' })
  expect(await textosDe(ui)).toContain('lote 3 de 3')
  const poucos = pedidos.slice(0, 7)
  mundo.pulse = pulseCom({ pedidos: poucos })
  mundo.pendentes['ork-a'] = pendentesDe('ork-a', poucos)
  await ui.press({ key: 'atualizar' })
  await drenar()
  expect(await textosDe(ui)).toContain('lote 2 de 2')
  await ui.press({ key: 'anteriores' })
  expect(await textosDe(ui)).toContain('lote 1 de 2')
  await ui.unmount()
})

test('na sessao de fase a Mesa nao registra comando, nao le o nucleo nem notifica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'fase', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) } })
  await iniciar($)
  await relogio.advance(20 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.ler).toEqual([])
  expect(mundo.maestro).toBe(0)
  expect(mundo.notificacoes).toEqual([])
  expect((await mesa($)).text).toBe('A Mesa do Dono só abre na sessão do dono de um projeto do Orkastery.')
  expect(mundo.abertos).toEqual([])
})

test('dormente, a Mesa confere o papel de novo e liga quando o servidor do nucleo conecta', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const opcoes = { papel: 'dormente', pulse: pulseCom({}), retrato: retratoHitl([]) }
  const mundo = montar(on, opcoes)
  await iniciar($)
  expect(mundo.comandos).toEqual([])
  opcoes.papel = 'dono'
  await relogio.advance(3000)
  expect(mundo.comandos).toEqual(['mesa'])
})

test('falha em segundo plano vira aviso no painel, e nunca rejeicao sem tratamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const opcoes = { papel: 'dormente', pulse: pulseCom({}) }
  const mundo = montar(on, opcoes)
  mundo.registroFalha = true
  await iniciar($)
  // A conferencia atrasada do papel liga a Mesa, e o registro do /mesa falha no meio dela.
  opcoes.papel = 'dono'
  await relogio.advance(3000)
  await drenar()
  const textos = await textosDoPainel($, 'terminal')
  expect(textos.some(t => t.startsWith('a conferência do papel parou: '))).toBe(true)
  // Sem o /mesa o painel nao abre: a Mesa tenta de novo na espera longa e liga quando o registro passa.
  expect(mundo.comandos).toEqual([])
  mundo.registroFalha = false
  await relogio.advance(5 * 60000)
  await drenar()
  expect(mundo.comandos).toEqual(['mesa'])
})

test('fora de sessao interativa (-p ou SDK) a Mesa nao confere o papel nem liga', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }) })
  await iniciar($, false)
  await relogio.advance(10 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.ler).toEqual([])
})
