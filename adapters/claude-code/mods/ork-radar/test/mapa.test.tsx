import { test, expect, mock } from 'claude-code/testing'
import {
  A_VISTA, BASE, celulaDoRaster, chave, conflito, EPOCA, iniciar, lease, limpo, montar, montarPainel, PONTE_FALSA, radar, sha, textosDe,
} from './apoio'

// O painel do Radar (T3.2): a matriz como Raster no terminal e como tabela no desktop, a lista dos conflitos com o
// comando que resolve, a linha da faixa na colisão nova e o registro do que o dono viu, tudo pela ponte falsa e
// com saída fixa de merge-tree com conflito num arquivo.
const A = sha('a')
const B = sha('b')
const C = sha('c')
const M = sha('0')
const ABERTAS = [
  { id: 'ork-c', slug: 'ork-c-full', fase: 'GOAL', status: 'aberta' },
  { id: 'ork-a', slug: 'ork-a-full', fase: 'SHIP', status: 'aberta' },
  { id: 'ork-b', slug: 'ork-b-full', fase: 'GO', status: 'aberta' },
]
const REFS = { [BASE]: M, 'refs/heads/ork/ork-a-full': A, 'refs/heads/ork/ork-b-full': B, 'refs/heads/ork/ork-c-full': C }
const MERGES = { [chave(A, M)]: conflito('CHANGELOG.md'), [chave(A, B)]: conflito('core/src/x.ts') }
const LEASES = [lease('path:CHANGELOG.md', 'ork-c')]
const AMBAR = 0xf9a825
const VERDE = 0x2e7d32
const PADRAO = 0x01000000
const CONFLITO_COM_A_BASE = 'ork-a × origin/main: CHANGELOG.md (lease path:CHANGELOG.md de ork-c)'
const CONFLITO_ENTRE_THREADS = 'ork-a × ork-b: core/src/x.ts'

function opcoes(extra = {}) {
  return { papel: 'dono', abertas: ABERTAS, refs: REFS, merges: MERGES, leases: LEASES, ...extra }
}

test('o /radar abre o painel: no terminal a matriz e um Raster com a celula do par em conflito, no desktop uma tabela', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await radar($)
  expect(mundo.abertos).toEqual(['radar'])
  const terminal = await montarPainel($, 'terminal')
  const rasters = await terminal.findAll({ type: 'Raster' })
  expect(rasters.length).toBe(1)
  const r = rasters[0].props
  expect([r.columns, r.rows]).toEqual([12, 4])
  // Cabeçalho: m e os rótulos das threads, na cor padrão.
  expect([1, 4, 7, 10].map(c => celulaDoRaster(r, 0, c).ch)).toEqual(['m', '1', '2', '3'])
  expect(celulaDoRaster(r, 0, 1).fundo).toBe(PADRAO)
  // Linha da ork-a (1): conflito com a base e com a ork-b, diagonal, limpo com a ork-c.
  expect(celulaDoRaster(r, 1, 1)).toEqual({ ch: '1', frente: 0x000000, fundo: AMBAR })
  expect(celulaDoRaster(r, 1, 0).fundo).toBe(AMBAR)
  expect(celulaDoRaster(r, 1, 4).ch).toBe('-')
  expect(celulaDoRaster(r, 1, 7)).toEqual({ ch: '1', frente: 0x000000, fundo: AMBAR })
  expect(celulaDoRaster(r, 1, 10)).toEqual({ ch: '.', frente: 0xffffff, fundo: VERDE })
  // A matriz é simétrica: a ork-b vê o mesmo conflito com a ork-a.
  expect(celulaDoRaster(r, 2, 4)).toEqual({ ch: '1', frente: 0x000000, fundo: AMBAR })
  expect(celulaDoRaster(r, 2, 1).fundo).toBe(VERDE)
  const rotulos = (await textosDe(terminal)).map(t => t.trim()).filter(t => /^[123] ork-/.test(t))
  expect(rotulos).toEqual(['1 ork-a SHIP', '2 ork-b GO', '3 ork-c GOAL'])
  await terminal.unmount()

  const desktop = await montarPainel($, 'desktop')
  expect((await desktop.findAll({ type: 'Raster' })).length).toBe(0)
  const celulas = (await desktop.findAll({ type: 'Text' })).filter(t => t.props.backgroundColor)
  expect(celulas.filter(t => t.text === ' 1 ' && t.props.backgroundColor === '#f9a825').length).toBe(3)
  expect(celulas.filter(t => t.text === ' . ' && t.props.backgroundColor === '#2e7d32').length).toBe(6)
  const cabecalho = (await desktop.findAll({ type: 'Text' })).filter(t => !t.props.backgroundColor).map(t => t.text).filter(t => /^ [m123] $/.test(t))
  expect(cabecalho).toEqual([' m ', ' 1 ', ' 2 ', ' 3 '])
  await desktop.unmount()
})

test('o painel traz a base, a legenda e cada conflito com os arquivos, o lease e o comando que resolve, nas duas superficies', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  montar(on, opcoes())
  await iniciar($)
  await radar($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    const textos = (await textosDe(ui)).filter(t => t.trim() !== '' && !/^ [m123.\-!?] $/.test(t) && !/^[123] ork-/.test(t))
    expect(textos).toEqual([
      'Radar de Colisão · 3 threads · 2 pares em conflito · lido há 0 s',
      'base: origin/main 0000000, igual ao remoto',
      'Atualizar',
      'm = origin/main · número = arquivos em conflito (+ = 10 ou mais) · . limpo · ! erro do git · ? não calculado · - a própria thread · vazio = sem branch local',
      CONFLITO_COM_A_BASE,
      '  resolve: ork worktree sync ork-a --dry-run',
      CONFLITO_ENTRE_THREADS,
      '  resolve: a que entregar depois roda: ork worktree sync <ork-a ou ork-b> --dry-run',
    ])
    await ui.unmount()
  }
})

test('colisao nova publica a linha da faixa pela ponte, a rodada sem novidade nao repete, e o /radar tira a linha', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await relogio.advance(1000)
  expect(mundo.faixas).toEqual([{ mod: 'ork-radar', texto: 'colisão nova entre ork-a e origin/main (1 arquivo) e mais 1; /radar abre o mapa' }])
  await relogio.advance(600000)
  expect(mundo.faixas.length).toBe(1)
  // A ork-c anda e passa a colidir com a base: a linha conta as três ainda não vistas.
  const C2 = sha('9')
  mundo.refs['refs/heads/ork/ork-c-full'] = C2
  mundo.merges[chave(C2, M)] = conflito('README.md', 'CHANGELOG.md')
  await relogio.advance(600000)
  expect(mundo.faixas[1]).toEqual({ mod: 'ork-radar', texto: 'colisão nova entre ork-a e origin/main (1 arquivo) e mais 2; /radar abre o mapa' })
  // O /radar mostra o resumo ao dono: os conflitos dele vão ao registro e a linha sai da faixa.
  await radar($)
  expect(mundo.faixas.length).toBe(3)
  expect(mundo.faixas[2]).toEqual({ mod: 'ork-radar' })
  expect(mundo.mostrados.map(m => [m.canal, m.chave])).toEqual([
    ['transcript', 'radar:@main|ork-a'], ['transcript', 'radar:@main|ork-c'], ['transcript', 'radar:ork-a|ork-b'],
  ])
  // A rodada seguinte, sem novidade, não publica de novo.
  await relogio.advance(600000)
  expect(mundo.faixas.length).toBe(3)
})

test('o registro do mostrado leva so o conflito que estava na janela do painel posto e a vista, e ele deixa de ser novo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ paineis: A_VISTA }))
  await iniciar($)
  await relogio.advance(1000)
  expect(mundo.faixas.length).toBe(1)
  // Linhas da tela: título, base, Atualizar, matriz (4 linhas), legenda, e o primeiro conflito na linha 8.
  const ui = await montarPainel($, 'terminal', { offset: 8, bodyRows: 2 })
  expect((await textosDe(ui)).filter(t => t.startsWith('nova: ')).length).toBe(2)
  await relogio.advance(60000)
  expect(mundo.mostrados).toEqual([{ mod: 'ork-radar', canal: 'painel', chave: 'radar:@main|ork-a', thread: 'ork-a', texto: CONFLITO_COM_A_BASE }])
  expect(mundo.faixas[1]).toEqual({ mod: 'ork-radar', texto: 'colisão nova entre ork-a e ork-b (1 arquivo); /radar abre o mapa' })
  await ui.unmount()
  // Com o painel escondido, o que o desenho anotou não vai ao registro.
  mundo.paineis = []
  const escondido = await montarPainel($, 'terminal', { offset: 10, bodyRows: 2 })
  await relogio.advance(60000)
  expect(mundo.mostrados.length).toBe(1)
  expect(mundo.faixas.length).toBe(2)
  await escondido.unmount()
})

test('o botao Atualizar do painel roda uma rodada agora e o painel mostra a conta nova', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await radar($)
  const ui = await montarPainel($, 'terminal')
  expect(await textosDe(ui)).toContain(CONFLITO_ENTRE_THREADS)
  // A ork-b anda e deixa de colidir com a ork-a.
  const B2 = sha('d')
  mundo.refs['refs/heads/ork/ork-b-full'] = B2
  mundo.merges[chave(A, B2)] = limpo()
  mundo.processos.length = 0
  await ui.press({ key: 'atualizar' })
  await relogio.settle()
  expect(mundo.processos.map(p => p.argv.slice(0, 3).join(' '))).toContain('git ls-remote .')
  await ui.unmount()
  const depois = await montarPainel($, 'terminal')
  expect(await textosDe(depois)).not.toContain(CONFLITO_ENTRE_THREADS)
  expect(await textosDe(depois)).toContain(CONFLITO_COM_A_BASE)
  await depois.unmount()
})

test('cada conflito vai ao registro uma vez por chave e texto, mesmo desenhado de novo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ paineis: A_VISTA }))
  await iniciar($)
  await relogio.advance(1000)
  const ui = await montarPainel($, 'terminal')
  await relogio.advance(60000)
  expect(mundo.mostrados.map(m => m.chave)).toEqual(['radar:@main|ork-a', 'radar:ork-a|ork-b'])
  await ui.unmount()
  const outra = await montarPainel($, 'terminal')
  await relogio.advance(60000)
  expect(mundo.mostrados.length).toBe(2)
  await outra.unmount()
})

test('painel posto mas escondido nao conta como visto, e conflito que some do mapa antes do registro nao entra', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ paineis: [{ id: 'radar', title: 'Radar', isShown: false, isFocused: false, isPlaced: true }] }))
  await iniciar($)
  await relogio.advance(1000)
  const escondido = await montarPainel($, 'terminal')
  await relogio.advance(60000)
  expect(mundo.mostrados).toEqual([])
  await escondido.unmount()
  // À vista, o desenho anota os dois conflitos; antes do registro, a rodada do botão os tira do mapa.
  mundo.paineis = A_VISTA
  const ui = await montarPainel($, 'terminal')
  mundo.refs['refs/heads/ork/ork-a-full'] = sha('7')
  await ui.press({ key: 'atualizar' })
  await relogio.settle()
  await relogio.advance(60000)
  expect(mundo.mostrados).toEqual([])
  await ui.unmount()
})

test('no painel estreito, o registro leva so o pedaco do conflito que coube na largura', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ paineis: A_VISTA }))
  await iniciar($)
  await relogio.advance(1000)
  const ui = await $.ui.mount({ plugin: 'ork-radar', surface: 'terminal', component: 'Pane', requestId: 'radar',
    props: { title: 'Radar', isFocused: false, bodyColumns: 30, placement: 'dock', scroll: { offset: 8, bodyRows: 1 }, view: {} } })
  await relogio.advance(60000)
  // A linha 8 é o primeiro conflito, com o prefixo da colisão nova: cabem 30 colunas, com a reticência na última.
  expect(mundo.mostrados.map(m => m.texto)).toEqual([CONFLITO_COM_A_BASE.slice(0, 30 - 1 - 'nova: '.length)])
  await ui.unmount()
})

test('antes da primeira rodada o painel diz que ainda nao leu, e sem thread aberta nao ha matriz', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ abertas: [] }))
  await iniciar($)
  const antes = await montarPainel($, 'terminal')
  expect(await textosDe(antes)).toEqual(['Radar de Colisão · ainda sem rodada', 'Atualizar'])
  await antes.unmount()
  await radar($)
  expect(mundo.processos.map(p => p.argv[0] + ' ' + p.argv[1])).toEqual(['git ls-remote', 'git ls-remote'])
  const depois = await montarPainel($, 'terminal')
  expect((await depois.findAll({ type: 'Raster' })).length).toBe(0)
  expect(await textosDe(depois)).toContain('nenhuma thread aberta para cruzar')
  await depois.unmount()
})

test('o cabecalho mostra a base diferente do remoto e a rodada que parou, com o mapa da rodada anterior', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ remoto: sha('1') }))
  await iniciar($)
  await radar($)
  mundo.listaFalha = true
  await radar($)
  const ui = await montarPainel($, 'desktop')
  const textos = await textosDe(ui)
  expect(textos[1]).toBe('base: origin/main 0000000, diferente do remoto (1111111): a conta vale até o fetch do núcleo')
  expect(textos[2]).toBe('a última rodada parou: a lista das threads abertas falhou (ork-ponte: ler recusado); o mapa é o da rodada anterior')
  expect(textos).toContain(CONFLITO_COM_A_BASE)
  await ui.unmount()
})
