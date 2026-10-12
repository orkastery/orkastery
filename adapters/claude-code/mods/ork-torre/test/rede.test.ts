import { test, expect, mock } from 'claude-code/testing'
import { iniciar, montar, montarPainel, PONTE_FALSA, retratoDe, textosDe, textosDoPainel, torre } from './apoio'

// A rede (threads das outras maquinas, pelo panorama do nucleo) e a linha da faixa publicada pela ponte (T1.3).
const RETRATOS = {
  'ork-a': retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', motivo: 'human.pending', acoes: [] }),
  'ork-b': retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', motivo: 'claims.failed', acoes: [] }),
  'ork-c': retratoDe({ thread: 'ork-c', fase: 'GO', modo: 'auto', conducao: 'conduzido agora por cli, sessao 1a2b3c4d, fase GO, desde 12/10 02:21', acoes: [] }),
}
const ABERTAS = ['ork-a', 'ork-b', 'ork-c']
const PANORAMA = {
  texto: 'status do roadmap da rede',
  panorama: {
    contrato: 'ork.network-roadmap/v1', consultadoEm: '1970-01-01T00:00:00.000Z', maquina: 'maquina-a', pedido: null, limiarSemBatidaMin: 30, fuso: 'UTC',
    projetos: [{
      projeto: { nome: 'orkastery', forja: null, clone: null, base: 'main', origem: 'instalacao', fuso: 'UTC' }, roadmap: null, reservas: null,
      maquinas: [
        { maquina: 'maquina-a', estaMaquina: true, threadsLidas: true, idadeMin: 0, semBatida: false, ativas: [{ id: 'ork-a', fase: 'SHIP', modo: '#Classic', status: 'aberta', esperaVoce: true, pergunta: 'x' }] },
        { maquina: 'maquina-b', estaMaquina: false, threadsLidas: true, idadeMin: 3, semBatida: false, ativas: [
          { id: 'ork-a', fase: 'SHIP', modo: '#Classic', status: 'aberta', esperaVoce: false, pergunta: null },
          { id: 'ork-x', fase: 'CHECK', modo: '#Auto', status: 'aberta', esperaVoce: true, pergunta: 'Aprovar o merge da ork-x' },
        ] },
        { maquina: 'maquina-c', estaMaquina: false, threadsLidas: true, idadeMin: 95, semBatida: true, ativas: [{ id: 'ork-y', fase: 'GO', modo: '#Fast', status: 'aberta', esperaVoce: false, pergunta: null }] },
        { maquina: 'maquina-d', estaMaquina: false, threadsLidas: false, idadeMin: 1, semBatida: false, ativas: [] },
      ],
      fontes: [], lacunas: [{ tipo: 'forja.nao-consultada', parte: 'forja', detalhe: 'sem forja', correcao: 'configure a forja' }],
    }],
    rede: null, naoConsultado: [], lacunas: [],
  },
}
const A_VISTA = [{ id: 'torre', title: 'Torre', isShown: true, isFocused: false, isPlaced: true }]
const daRede = mundo => mundo.mcp.filter(c => c.tool === 'ork_network_roadmap')

test('sem leitura da rede, o placar diz nao lida e nada pede a rede no inicio nem com o painel escondido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, respostas: { ork_network_roadmap: PANORAMA } })
  await iniciar($)
  await torre($)
  await relogio.advance(11 * 60000)
  expect(daRede(mundo)).toEqual([])
  const textos = await textosDoPainel($, 'terminal')
  expect(textos[1]).toBe('rede: não lida')
  expect(textos.some(t => t.startsWith('~') || t.includes('@maquina'))).toBe(false)
})

test('o botao Ler a rede traz as threads das outras maquinas com a idade, sem repetir a thread local', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, respostas: { ork_network_roadmap: PANORAMA } })
  await iniciar($)
  await torre($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    await ui.press({ key: 'ler-rede' })
    const textos = await textosDe(ui)
    expect(textos[1]).toBe('rede: 2 threads em 2 outras máquinas, lida há 0 s · 1 lacuna')
    expect(textos.slice(-3)).toEqual([
      '!  ork-x  ●●●◉○○ CHECK  #Auto  @maquina-b, batida há 3 min',
      '  espera você: Aprovar o merge da ork-x',
      '~  ork-y  ●●◉○○○ GO  #Fast  @maquina-c, sem batida',
    ])
    expect(textos.filter(t => t.includes('ork-a')).length).toBe(1)
    await ui.unmount()
  }
  expect(daRede(mundo).map(c => [c.server, c.args])).toEqual([['orkastery', {}], ['orkastery', {}]])
})

test('a faixa sai pela ponte com o texto certo e so e republicada quando o texto muda', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, respostas: { ork_network_roadmap: PANORAMA } })
  await iniciar($)
  await torre($)
  expect(mundo.faixas).toEqual([{ mod: 'ork-torre', texto: '3 threads abertas · 1 espera você (ork-a) · 1 parada (ork-b: uma claim reprovou no HEAD)' }])
  await torre($)
  expect(mundo.faixas.length).toBe(1)
  mundo.retratos['ork-b'] = retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', conducao: 'conduzido agora por cli, sessao 9f9f9f9f, fase CHECK, desde 12/10 03:00' })
  await torre($)
  expect(mundo.faixas[1]).toEqual({ mod: 'ork-torre', texto: '3 threads abertas · 1 espera você (ork-a)' })
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'ler-rede' })
  await ui.unmount()
  expect(mundo.faixas[2]).toEqual({ mod: 'ork-torre', texto: '3 threads abertas · 1 espera você (ork-a) · rede: 2 em outras máquinas, 1 espera você' })
  expect(mundo.faixas.length).toBe(3)
})

test('com o painel a vista, a rede e relida pelo tique no maximo a cada 10 min', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, respostas: { ork_network_roadmap: PANORAMA }, paineis: A_VISTA })
  await iniciar($)
  await relogio.advance(9 * 60000)
  expect(daRede(mundo).length).toBe(0)
  await relogio.advance(60000)
  expect(daRede(mundo).length).toBe(1)
  await relogio.advance(5 * 60000)
  expect(daRede(mundo).length).toBe(1)
  await relogio.advance(5 * 60000)
  expect(daRede(mundo).length).toBe(2)
})

test('leitura da rede que falha guarda o que havia e diz o erro; sem leitura anterior, diz nao lida e o motivo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, respostas: {} })
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: 'ler-rede' })
  expect((await textosDe(ui))[1]).toBe('rede: não lida (o núcleo respondeu com erro)')
  mundo.respostas.ork_network_roadmap = PANORAMA
  await ui.press({ key: 'ler-rede' })
  delete mundo.respostas.ork_network_roadmap
  await ui.press({ key: 'ler-rede' })
  const textos = await textosDe(ui)
  expect(textos[1]).toBe('rede: 2 threads em 2 outras máquinas, lida há 0 s · 1 lacuna · a última leitura falhou: o núcleo respondeu com erro')
  expect(textos).toContain('~  ork-y  ●●◉○○○ GO  #Fast  @maquina-c, sem batida')
  await ui.unmount()
})

test('sem quadro lido a linha sai da faixa, e lista que deixa de ser relida aparece na faixa', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, listaFalha: true })
  await iniciar($)
  await torre($)
  expect(mundo.faixas).toEqual([{ mod: 'ork-torre' }])
  mundo.listaFalha = false
  await torre($)
  expect(mundo.faixas[1]).toEqual({ mod: 'ork-torre', texto: '3 threads abertas · 1 espera você (ork-a) · 1 parada (ork-b: uma claim reprovou no HEAD)' })
  mundo.listaFalha = true
  await torre($)
  expect(mundo.faixas[2]).toEqual({ mod: 'ork-torre', texto: '3 threads abertas · 1 espera você (ork-a) · 1 parada (ork-b: uma claim reprovou no HEAD) · lista não relida' })
})
