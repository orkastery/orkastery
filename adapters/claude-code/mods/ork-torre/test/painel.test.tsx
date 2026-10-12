import { test, expect, mock } from 'claude-code/testing'
import { A_VISTA, DISPONIVEIS, EPOCA, iniciar, montar, montarPainel, PONTE_FALSA, retratoDe, textosDe, textosDoPainel, torre } from './apoio'

// O painel da Torre na sessao do dono, com um retrato fixo por thread entregue pela ponte falsa. As acoes
// disponiveis seguem o nucleo na sessao do dono (toda ferramenta do servidor sem thread); a Torre so oferece
// a acao com efeito que o estado da thread pede (D15).
const RETRATOS = {
  'ork-a': retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', motivo: 'human.pending',
    pedidos: [{ id: 'p1', texto: 'Autorizar o SHIP da ork-a', prazo: '12/10 14:00' }], acoes: DISPONIVEIS }),
  'ork-b': retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', motivo: 'claims.failed', acoes: DISPONIVEIS }),
  'ork-c': retratoDe({ thread: 'ork-c', fase: 'GO', modo: 'auto', conducao: 'conduzido agora por cli, sessao 1a2b3c4d, fase GO, desde 12/10 02:21',
    acoes: DISPONIVEIS }),
  'ork-d': retratoDe({ thread: 'ork-d', fase: 'PLAN', modo: 'fast', acoes: DISPONIVEIS }),
}
const ABERTAS = ['ork-d', 'ork-c', 'ork-b', 'ork-a']
const DICA = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
/** Um plugin de teste que fecha o painel da Torre, como o fechamento que nao vem da propria Torre. */
const QUEM_FECHA = {
  name: 'sonda-fecha',
  register(on) {
    on('command.run', { command: 'fechar-torre' }, async $ => {
      await $.ui.close({ id: 'torre' })
      return { text: 'fechado' }
    })
  },
}

async function dicaEmTelaCheia($, isFullscreen) {
  const ui = await $.ui.mount({ plugin: 'ork-torre', surface: 'terminal', component: 'PromptHint', props: DICA,
    viewport: { columns: 200, rows: 50, isFullscreen } })
  await ui.unmount()
}

test('na sessao do dono, o /torre abre o painel com o placar e uma linha por thread, no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
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
    expect(textos).toContain('  ações: Decidir · Entregar')
    expect(textos).toContain('  parada: uma claim reprovou no HEAD (claims.failed)')
    expect(textos).toContain('  ações: Verificar')
    expect(textos).toContain('  conduzido agora por cli, sessao 1a2b3c4d, fase GO, desde 12/10 02:21')
    expect(textos).toContain('  ninguém conduz agora')
    expect(textos).toContain('  ações: Fase seguinte')
    expect(textos.filter(t => t.startsWith('  ações:')).length).toBe(3)
    expect(textos.some(t => t.includes('Commit'))).toBe(false)
  }
})

test('na sessao de fase a Torre nao registra comando, nao le o nucleo nem abre o painel sozinho', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'fase', abertas: ABERTAS, retratos: RETRATOS })
  on('ui.render', { component: 'PromptHint' }, ($2, e) => { const { Text } = $2.ui.resolve(e); return <Text>{e.props.hint}</Text> })
  await iniciar($)
  await relogio.advance(20 * 60000)
  await dicaEmTelaCheia($, true)
  expect(mundo.comandos).toEqual([])
  expect(mundo.ler).toEqual([])
  expect(mundo.maestro).toEqual([])
  expect(mundo.abertos).toEqual([])
  // O comando nao existe nesta sessao; se sobrar de uma carga anterior, o gancho so explica.
  expect((await torre($)).text).toBe('A Torre de Controle só abre na sessão do dono de um projeto do Orkastery.')
  expect(mundo.abertos).toEqual([])
})

test('fora de sessao interativa (-p ou SDK) a Torre nao confere o papel nem liga', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($, false)
  await relogio.advance(10 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.ler).toEqual([])
  expect(mundo.maestro).toEqual([])
})

test('dormente no inicio, a Torre confere o papel de novo e liga quando o servidor do nucleo conecta, mesmo tarde', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const opcoes = { papel: 'dormente', abertas: ABERTAS, retratos: RETRATOS }
  const mundo = montar(on, opcoes)
  await iniciar($)
  await relogio.advance(3000 + 10000 + 30000)
  expect(mundo.comandos).toEqual([])
  opcoes.papel = 'dono'
  await relogio.advance(299000)
  expect(mundo.comandos).toEqual([])
  await relogio.advance(1000)
  expect(mundo.comandos).toEqual(['torre'])
  await relogio.advance(10)
  expect(mundo.ler).toEqual([{ consulta: 'thread.list' }])
})

test('falha passageira da ponte no papel nao desliga a Torre: ela tenta de novo e liga', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const opcoes = { papel: 'erro', abertas: ABERTAS, retratos: RETRATOS }
  const mundo = montar(on, opcoes)
  await iniciar($)
  expect(mundo.toasts).toEqual([])
  opcoes.papel = 'dono'
  await relogio.advance(3000)
  expect(mundo.comandos).toEqual(['torre'])
})

test('sem a ponte, a Torre avisa uma vez e fica desligada', async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  await relogio.advance(10 * 60000)
  expect(mundo.toasts).toEqual(['torre: a ponte ork-ponte não carregou; a Torre de Controle fica desligada nesta sessão'])
  expect(mundo.comandos).toEqual([])
})

test('evento de arquivo do ledger rele so aquela thread, em lote: a cada 10 s com o painel a vista, a cada 60 s escondido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, paineis: A_VISTA })
  await iniciar($)
  await torre($)
  mundo.maestro.length = 0
  mundo.retratos['ork-b'] = retratoDe({ thread: 'ork-b', fase: 'CHECK', modo: 'auto', conducao: 'conduzido agora por cli, sessao 9f9f9f9f, fase CHECK, desde 12/10 03:00' })
  const ledger = thread => ({ file_path: `/p/.orkastery/threads/${thread}/ledger.jsonl`, event: 'change' })
  await $.classic.FileChanged(ledger('ork-b'))
  await $.classic.FileChanged(ledger('ork-b'))
  await $.classic.FileChanged({ file_path: '/p/outro/arquivo.txt', event: 'change' })
  await relogio.advance(2000)
  expect(mundo.maestro).toEqual([])
  await relogio.advance(8000)
  expect(mundo.maestro).toEqual(['ork-b'])
  const textos = await textosDoPainel($, 'terminal')
  expect(textos[0]).toBe('4 threads abertas · 1 espera você · 2 andando · lido há 10 s')
  expect(textos).toContain('>  ork-b  ●●●◉○○ CHECK  #Auto')
  mundo.paineis = []
  mundo.maestro.length = 0
  await $.classic.FileChanged(ledger('ork-c'))
  await relogio.advance(12000)
  expect(mundo.maestro).toEqual([])
  await relogio.advance(48000)
  expect(mundo.maestro).toEqual(['ork-c'])
})

test('o tique nao rele threads paradas a cada minuto: so as velhas, depois de 5 min a vista ou 15 min escondido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  await iniciar($)
  await torre($)
  mundo.maestro.length = 0
  const lidas = mundo.ler.length
  await relogio.advance(4 * 60000)
  expect(mundo.maestro).toEqual([])
  expect(mundo.ler.length).toBe(lidas + 4)
  await relogio.advance(11 * 60000)
  expect(mundo.maestro).toEqual([])
  await relogio.advance(60000)
  expect([...mundo.maestro].sort()).toEqual(['ork-a', 'ork-b', 'ork-c', 'ork-d'])
  mundo.paineis = A_VISTA
  mundo.maestro.length = 0
  await relogio.advance(5 * 60000)
  expect(mundo.maestro).toEqual([])
  await relogio.advance(60000)
  expect([...mundo.maestro].sort()).toEqual(['ork-a', 'ork-b', 'ork-c', 'ork-d'])
})

test('o painel abre sozinho so no fullscreen, uma vez por sessao, e nunca depois que o dono o fecha', { plugins: [PONTE_FALSA, QUEM_FECHA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS })
  on('ui.render', { component: 'PromptHint' }, ($2, e) => { const { Text } = $2.ui.resolve(e); return <Text>{e.props.hint}</Text> })
  await iniciar($)
  await $.command.run({ command: 'fechar-torre', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await dicaEmTelaCheia($, true)
  expect(mundo.abertos).toEqual([])
  await torre($)
  expect(mundo.abertos).toEqual(['torre'])
  await dicaEmTelaCheia($, false)
  expect(mundo.abertos).toEqual(['torre'])
  await dicaEmTelaCheia($, true)
  await dicaEmTelaCheia($, true)
  expect(mundo.abertos).toEqual(['torre', 'torre'])
})

test('o registro do mostrado leva so o que o desenho pos na janela do painel posto e a vista, sem repetir', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, paineis: A_VISTA })
  await iniciar($)
  await torre($)
  expect(mundo.mostrados).toEqual([])
  // Janela de 4 linhas: o placar, a rede, a linha da ork-a e o pedido p1; o bloqueio dela fica de fora.
  let ui = await montarPainel($, 'terminal', { offset: 0, bodyRows: 4 })
  await ui.unmount()
  await torre($)
  expect(mundo.mostrados).toEqual([
    { mod: 'ork-torre', canal: 'painel', chave: 'hitl:p1', thread: 'ork-a', texto: 'ork-a: espera você: Autorizar o SHIP da ork-a' },
  ])
  ui = await montarPainel($, 'terminal')
  await ui.unmount()
  await torre($)
  expect(mundo.mostrados.slice(1)).toEqual([
    { mod: 'ork-torre', canal: 'painel', chave: 'bloqueio:ork-a:human.pending', thread: 'ork-a', texto: 'ork-a: espera a sua autorização' },
    { mod: 'ork-torre', canal: 'painel', chave: 'bloqueio:ork-b:claims.failed', thread: 'ork-b', texto: 'ork-b: uma claim reprovou no HEAD' },
  ])
  ui = await montarPainel($, 'desktop')
  await ui.unmount()
  await torre($)
  expect(mundo.mostrados.length).toBe(3)
})

test('com o painel escondido ou ainda sem lugar, nada desenhado vai ao registro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ABERTAS, retratos: RETRATOS, paineis: [{ ...A_VISTA[0], isShown: false }] })
  await iniciar($)
  await torre($)
  let ui = await montarPainel($, 'terminal')
  await ui.unmount()
  await torre($)
  expect(mundo.mostrados).toEqual([])
  mundo.paineis = [{ ...A_VISTA[0], isPlaced: false }]
  ui = await montarPainel($, 'terminal')
  await ui.unmount()
  await torre($)
  expect(mundo.mostrados).toEqual([])
})

test('com o detalhe de uma thread aberto, o bloqueio novo de outra thread nao vai ao registro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ['ork-a', 'ork-b'], paineis: A_VISTA,
    respostas: { ork_phase_list: { phases: { eventos: [] } }, ork_claims_list: [] }, retratos: {
      'ork-a': retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', acoes: [] }),
      'ork-b': retratoDe({ thread: 'ork-b', fase: 'GO', modo: 'auto', acoes: [] }),
    } })
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'abrir:ork-a' })
  mundo.retratos['ork-b'] = retratoDe({ thread: 'ork-b', fase: 'GO', modo: 'auto', motivo: 'lease.busy', acoes: [] })
  await $.classic.FileChanged({ file_path: '/p/.orkastery/threads/ork-b/ledger.jsonl', event: 'change' })
  await relogio.advance(12000)
  expect((await textosDe(ui)).some(t => t.includes('ork-b'))).toBe(false)
  await relogio.advance(60000)
  expect(mundo.mostrados).toEqual([])
  await ui.press({ key: 'voltar' })
  await torre($)
  expect(mundo.mostrados).toEqual([
    { mod: 'ork-torre', canal: 'painel', chave: 'bloqueio:ork-b:lease.busy', thread: 'ork-b', texto: 'ork-b: outra thread segura a região' },
  ])
  await ui.unmount()
})

test('retrato que falha vira linha sem leitura com o motivo, sem inventar fase, condutor nem acao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', abertas: ['ork-c', 'ork-x'], retratos: RETRATOS,
    respostas: { ork_phase_list: { phases: { eventos: [] } }, ork_claims_list: [] } })
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'desktop')
  const lista = await textosDe(ui)
  expect(lista[0]).toBe('2 threads abertas · 1 andando · 1 sem leitura · lido há 0 s')
  expect(lista).toContain('?  ork-x  ······ ?')
  expect(lista).toContain('  lacuna: ork-ponte: o ork_maestro respondeu com erro')
  expect(lista).not.toContain('  ninguém conduz agora')
  await ui.press({ key: 'abrir:ork-x' })
  const detalhe = await textosDe(ui)
  expect(detalhe.slice(2, 4)).toEqual(['?  ork-x  ······ ?', 'não li o retrato: ork-ponte: o ork_maestro respondeu com erro'])
  expect(detalhe).not.toContain('ninguém conduz agora')
  expect(detalhe.some(t => t.includes('ação'))).toBe(false)
  await ui.unmount()
  expect(mundo.mcp.every(c => c.tool === 'ork_phase_list' || c.tool === 'ork_claims_list')).toBe(true)
})
