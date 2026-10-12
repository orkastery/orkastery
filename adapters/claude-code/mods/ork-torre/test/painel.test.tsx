import { test, expect, mock } from 'claude-code/testing'
import { iniciar, montar, PONTE_FALSA, retratoDe, textosDoPainel, torre } from './apoio'

// O painel da Torre na sessao do dono, com um retrato fixo por thread entregue pela ponte falsa.
const RETRATOS = {
  'ork-a': retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', motivo: 'human.pending',
    pedidos: [{ id: 'p1', texto: 'Autorizar o SHIP da ork-a', prazo: '12/10 14:00' }], acoes: ['thread.status', 'hitl.decide'] }),
  'ork-b': retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', motivo: 'claims.failed', acoes: ['thread.status', 'retry'] }),
  'ork-c': retratoDe({ thread: 'ork-c', fase: 'GO', modo: 'auto', conducao: 'conduzido agora por cli, sessao 1a2b3c4d, fase GO, desde 12/10 02:21',
    acoes: ['thread.status', 'thread.observe'] }),
  'ork-d': retratoDe({ thread: 'ork-d', fase: 'PLAN', modo: 'fast', acoes: [] }),
}
const ABERTAS = ['ork-d', 'ork-c', 'ork-b', 'ork-a']

test('na sessao do dono, o /torre abre o painel com o placar e uma linha por thread, no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  expect(mundo.comandos).toEqual(['torre'])
  const r = await torre($)
  expect(r.text).toBe('Torre de Controle aberta.')
  expect(mundo.abertos).toEqual(['torre'])
  expect(mundo.ler).toEqual([{ consulta: 'thread.list' }])
  expect([...mundo.maestro].sort()).toEqual(['ork-a', 'ork-b', 'ork-c', 'ork-d'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    expect(textos.slice(0, 3)).toEqual(['4 threads abertas · 1 espera você · 1 parada · 1 andando · lido há 0 s', 'rede: não lida', 'Ler a rede'])
    expect(textos.filter(t => !t.startsWith('  ')).slice(3)).toEqual([
      '!  ork-a  ●●●●◉○ SHIP  #Classic',
      'x  ork-b  ●●●◉○○ CHECK  #Auto',
      '>  ork-c  ●●◉○○○ GO  #Auto',
      '-  ork-d  ●◉○○○○ PLAN  #Fast',
    ])
    expect(textos).toContain('  espera você: Autorizar o SHIP da ork-a (prazo 12/10 14:00)')
    expect(textos).toContain('  espera você: espera a sua autorização (human.pending)')
    expect(textos).toContain('  ações: Decidir')
    expect(textos).toContain('  parada: uma claim reprovou no HEAD (claims.failed)')
    expect(textos).toContain('  ações: Retomar')
    expect(textos).toContain('  conduzido agora por cli, sessao 1a2b3c4d, fase GO, desde 12/10 02:21')
    expect(textos).toContain('  ninguém conduz agora')
  }
})

test('na sessao de fase a Torre nao registra comando, nao le o nucleo e o /torre so explica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'fase', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  await relogio.advance(120000)
  expect(mundo.comandos).toEqual([])
  const r = await torre($)
  expect(r.text).toBe('A Torre de Controle só abre na sessão do dono de um projeto do Orkastery.')
  expect(mundo.ler).toEqual([])
  expect(mundo.maestro).toEqual([])
  expect(mundo.abertos).toEqual([])
})

test('dormente no inicio, a Torre confere o papel de novo e liga quando o servidor do nucleo conecta', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const opcoes = { papel: 'dormente', abertas: ABERTAS, retratos: RETRATOS }
  const mundo = montar(on, opcoes)
  await iniciar($)
  expect(mundo.comandos).toEqual([])
  opcoes.papel = 'dono'
  await relogio.advance(3000)
  expect(mundo.comandos).toEqual(['torre'])
  await relogio.advance(10)
  expect(mundo.ler).toEqual([{ consulta: 'thread.list' }])
})

test('sem a ponte, a Torre avisa uma vez e fica desligada', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  expect(mundo.toasts).toEqual(['torre: a ponte ork-ponte não respondeu; a Torre de Controle fica desligada nesta sessão'])
  expect(mundo.comandos).toEqual([])
  expect((await torre($)).text).toBe('A Torre de Controle só abre na sessão do dono de um projeto do Orkastery.')
})

test('evento de arquivo do ledger rele so aquela thread, em lote e no maximo a cada 10 s', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  await torre($)
  mundo.maestro.length = 0
  mundo.retratos['ork-b'] = retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', conducao: 'conduzido agora por cli, sessao 9f9f9f9f, fase CHECK, desde 12/10 03:00' })
  await $.classic.FileChanged({ file_path: '/p/.orkastery/threads/ork-b/ledger.jsonl', event: 'change' })
  await $.classic.FileChanged({ file_path: '/p/.orkastery/threads/ork-b/ledger.jsonl', event: 'change' })
  await $.classic.FileChanged({ file_path: '/p/outro/arquivo.txt', event: 'change' })
  await relogio.advance(2000)
  expect(mundo.maestro).toEqual([])
  await relogio.advance(8000)
  expect(mundo.maestro).toEqual(['ork-b'])
  const textos = await textosDoPainel($, 'terminal')
  expect(textos[0]).toBe('4 threads abertas · 1 espera você · 2 andando · lido há 10 s')
  expect(textos).toContain('>  ork-b  ●●●◉○○ CHECK  #Auto')
})

test('o painel abre sozinho so no fullscreen, uma vez por sessao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  on('ui.render', { component: 'PromptHint' }, ($2, e) => {
    const { Text } = $2.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  await iniciar($)
  const dica = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
  let ui = await $.ui.mount({ plugin: 'ork-torre', surface: 'terminal', component: 'PromptHint', props: dica,
    viewport: { columns: 200, rows: 50, isFullscreen: false } })
  await ui.unmount()
  expect(mundo.abertos).toEqual([])
  ui = await $.ui.mount({ plugin: 'ork-torre', surface: 'terminal', component: 'PromptHint', props: dica,
    viewport: { columns: 200, rows: 50, isFullscreen: true } })
  await ui.unmount()
  ui = await $.ui.mount({ plugin: 'ork-torre', surface: 'terminal', component: 'PromptHint', props: dica,
    viewport: { columns: 200, rows: 50, isFullscreen: true } })
  await ui.unmount()
  expect(mundo.abertos).toEqual(['torre'])
})

test('o que o painel mostra entra no registro da ponte so com o painel posto e a vista, sem repetir', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  await torre($)
  expect(mundo.mostrados).toEqual([])
  mundo.paineis = [{ id: 'torre', title: 'Torre', isShown: true, isFocused: false, isPlaced: true }]
  await torre($)
  expect(mundo.mostrados).toEqual([
    { mod: 'ork-torre', canal: 'painel', chave: 'bloqueio:ork-a:human.pending', thread: 'ork-a', texto: 'ork-a: espera a sua autorização' },
    { mod: 'ork-torre', canal: 'painel', chave: 'hitl:p1', thread: 'ork-a', texto: 'ork-a: espera você: Autorizar o SHIP da ork-a' },
    { mod: 'ork-torre', canal: 'painel', chave: 'bloqueio:ork-b:claims.failed', thread: 'ork-b', texto: 'ork-b: uma claim reprovou no HEAD' },
  ])
  await torre($)
  expect(mundo.mostrados.length).toBe(3)
})

test('retrato que falha vira linha sem leitura com o motivo, sem inventar fase', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  const mundo = montar(on, { papel: 'dono', abertas: ['ork-c', 'ork-x'], retratos: RETRATOS })
  await iniciar($)
  await torre($)
  const textos = await textosDoPainel($, 'desktop')
  expect(textos[0]).toBe('2 threads abertas · 1 andando · 1 sem leitura · lido há 0 s')
  expect(textos).toContain('?  ork-x  ······ ?')
  expect(textos).toContain('  lacuna: ork-ponte: o ork_maestro respondeu com erro')
  expect(mundo.mcp).toEqual([])
})
