import { test, expect, mock } from 'claude-code/testing'
import { iniciar, montar, montarPainel, PONTE_FALSA, retratoDe, textosDe, torre } from './apoio'

// O detalhe da thread, os botoes de leitura e o encaminhamento da acao com efeito ao mod dono (D4).
const LEITURAS_DO_NUCLEO = ['ork_phase_list', 'ork_claims_list', 'ork_observe', 'ork_git_status']
const RETRATOS = {
  'ork-a': retratoDe({ thread: 'ork-a', fase: 'SHIP', modo: 'classic', motivo: 'human.pending',
    pedidos: [{ id: 'p1', texto: 'Autorizar o SHIP da ork-a', prazo: '12/10 14:00', recomendacao: 'Aprovar' }], acoes: ['hitl.decide', 'ship', 'verify', 'git.commit'] }),
  'ork-c': retratoDe({ thread: 'ork-c', fase: 'GO', modo: 'auto', conducao: 'conduzido agora por cli, sessao 1a2b3c4d, fase GO, desde 12/10 02:21',
    acoes: ['thread.status', 'thread.observe', 'git.status'] }),
}
const RESPOSTAS = {
  'ork_phase_list': { threadId: 'x', phases: { limite: 20, omitidos: 0, eventos: [
    { tipo: 'phase_dispatch', ts: '1970-01-01T00:00:00.000Z', fase: 'GO' },
    { tipo: 'phase_result', ts: '1970-01-01T00:01:00.000Z', fase: 'GO', classificacao: 'fase_concluida' },
    { tipo: 'gate_blocked', ts: '1970-01-01T00:05:00.000Z', fase: 'SHIP' },
  ] } },
  'ork_claims_list': [
    { id: 'C1', estado: 'verificado', alegacao: 'manifesto' },
    { id: 'C2', estado: 'pendente', alegacao: 'teste do kit da Torre' },
    { id: 'C3', estado: 'reprovado', alegacao: 'guarda estática' },
  ],
  'thread.status': { id: 'ork-c', status: 'aberta', faseAtual: 'GO', sessoes: [{}], claims: ['C1', 'C2'], atualizadaEm: '1970-01-01T00:05:00.000Z',
    baseline: { commit: '84114aa66e91e3c6', comandos: [{ nome: 'build', ok: true }, { nome: 'test', ok: true }] } },
  'ork_observe': { thread: {}, phases: {}, pendencias: [], nativas: [{ sessionId: '1a2b3c4d-0000-4000-8000-000000000000', runtime: 'claude-bg', disponivel: true,
    sessao: { estado: 'working' }, turno: { conclusaoDeFase: 'nao-inferida' } }] },
  'ork_git_status': { threadId: 'ork-c', source: { branch: 'ork/ork-c-full', head: 'aaaaaaaa1111' }, destination: { branch: 'main', head: 'bbbbbbbb2222' }, scope: 'local-only' },
}
const MOD = (name, plugin) => ({ name, description: '', source: 'plugin', plugin })

async function preparado(on, extra = {}) {
  mock.clock(on, { now: 600000 })
  return montar(on, { papel: 'dono', abertas: ['ork-a', 'ork-c'], retratos: RETRATOS, respostas: RESPOSTAS, ...extra })
}

test('apertar a linha abre o detalhe com sessoes, bloqueio, pedidos, ultimos eventos e claims, e Voltar volta a lista', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const mundo = await preparado(on)
  await iniciar($)
  await torre($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    await ui.press({ key: 'abrir:ork-a' })
    const textos = await textosDe(ui)
    expect(textos.slice(0, 5)).toEqual(['Voltar', 'Atualizar', '!  ork-a  ●●●●◉○ SHIP  #Classic', 'ninguém conduz agora',
      'bloqueio: espera a sua autorização (human.pending)'])
    expect(textos).toContain('pedido p1: Autorizar o SHIP da ork-a')
    expect(textos).toContain('  prazo 12/10 14:00 · recomendação: Aprovar')
    expect(textos).toContain('sessão sessao-1 claude-bg · SHIP: unknown · não confirmada')
    expect(textos).toContain('  gate_blocked · SHIP · há 5 min')
    expect(textos).toContain('  phase_result · GO · fase_concluida · há 9 min')
    expect(textos).toContain('  3 claims: 1 pendente, 1 reprovado, 1 verificado')
    expect(textos).toContain('  C3 reprovado: guarda estática')
    await ui.press({ key: 'voltar' })
    expect((await textosDe(ui))[0]).toBe('2 threads abertas · 1 espera você · 1 andando · lido há 0 s')
    await ui.unmount()
  }
  expect(mundo.mcp.map(c => [c.tool, c.args.threadId])).toEqual([
    ['ork_phase_list', 'ork-a'], ['ork_claims_list', 'ork-a'], ['ork_phase_list', 'ork-a'], ['ork_claims_list', 'ork-a'],
  ])
})

test('botao so nas acoes disponiveis; cada leitura mostra o resultado no detalhe e nada mais roda', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const mundo = await preparado(on)
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'abrir:ork-c' })
  for (const op of ['thread.status', 'thread.observe', 'git.status']) expect((await ui.find({ key: `acao:${op}` }))?.type).toBe('Button')
  for (const op of ['ship', 'verify', 'hitl.decide', 'git.commit', 'retry', 'master', 'phase']) expect(await ui.find({ key: `acao:${op}` })).toBe(undefined)
  await ui.press({ key: 'acao:thread.status' })
  await ui.press({ key: 'acao:thread.observe' })
  await ui.press({ key: 'acao:git.status' })
  const textos = await textosDe(ui)
  expect(textos).toContain('  status aberta · fase GO · 1 sessões · 2 claims · atualizada há 5 min')
  expect(textos).toContain('  baseline em 84114aa6: build passava, test passava')
  expect(textos).toContain('  nenhum pedido pendente')
  expect(textos).toContain('  sessão 1a2b3c4d claude-bg: working · nao-inferida')
  expect(textos).toContain('  ork/ork-c-full @ aaaaaaaa')
  expect(textos).toContain('  destino main @ bbbbbbbb')
  await ui.unmount()
  expect(mundo.ler).toEqual([{ consulta: 'thread.list' }, { consulta: 'thread.status', thread: 'ork-c' }])
  expect(mundo.mcp.every(c => c.server === 'orkastery' && LEITURAS_DO_NUCLEO.includes(c.tool) && c.args.threadId === 'ork-c')).toBe(true)
  expect(mundo.mcp.map(c => c.tool)).toEqual(['ork_phase_list', 'ork_claims_list', 'ork_observe', 'ork_git_status'])
  expect(mundo.rodados).toEqual([])
})

test('acao com efeito abre o mod dono pelo comando dele, com o id da thread, quando o plugin esperado o registrou', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const mundo = await preparado(on, { carregados: [MOD('mesa', 'ork-mesa'), MOD('pista', 'ork-pista')] })
  await iniciar($)
  await torre($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    await ui.press({ key: 'abrir:ork-a' })
    expect((await ui.find({ key: 'acao:hitl.decide' }))?.text).toBe('Decidir: abrir a Mesa do Dono')
    expect((await ui.find({ key: 'acao:ship' }))?.text).toBe('Entregar: abrir a Pista de Entrega')
    await ui.press({ key: 'acao:hitl.decide' })
    await ui.press({ key: 'voltar' })
    await ui.unmount()
  }
  expect(mundo.rodados).toEqual([{ command: 'mesa', args: 'ork-a' }, { command: 'mesa', args: 'ork-a' }])
  expect(mundo.mcp.every(c => LEITURAS_DO_NUCLEO.includes(c.tool))).toBe(true)
})

test('sem o mod dono, ou com o comando registrado por outro plugin, aparece o comando do ork e nada roda', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const mundo = await preparado(on, { carregados: [MOD('mesa', 'outro-plugin')] })
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: 'abrir:ork-a' })
  expect(await ui.find({ key: 'acao:hitl.decide', type: 'Button' })).toBe(undefined)
  const textos = await textosDe(ui)
  expect(textos).toContain('Decidir: rode ork sessions hitl; a resposta vai pelo Telegram ou pelo diálogo nativo')
  expect(textos).toContain('Entregar: rode ork ship ork-a --para <base>')
  expect(textos).toContain('Verificar: rode ork verify ork-a')
  expect(textos).toContain('Commit: o commit é da sessão de GO, pelo ork_git_commit')
  await ui.unmount()
  expect(mundo.rodados).toEqual([])
})

test('o mod dono que some entre o desenho e o aperto nao roda, e o detalhe passa a mostrar o comando', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const mundo = await preparado(on, { carregados: [MOD('mesa', 'ork-mesa')] })
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'abrir:ork-a' })
  expect((await ui.find({ key: 'acao:hitl.decide' }))?.type).toBe('Button')
  mundo.carregados = []
  await ui.press({ key: 'acao:hitl.decide' })
  expect(mundo.rodados).toEqual([])
  expect(await ui.find({ key: 'acao:hitl.decide', type: 'Button' })).toBe(undefined)
  expect(await textosDe(ui)).toContain('Decidir: rode ork sessions hitl; a resposta vai pelo Telegram ou pelo diálogo nativo')
  await ui.unmount()
})

test('leitura que falha mostra o motivo no detalhe, sem derrubar o painel', { plugins: [PONTE_FALSA] }, async ($, on) => {
  await preparado(on, { respostas: {} })
  await iniciar($)
  await torre($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'abrir:ork-c' })
  await ui.press({ key: 'acao:git.status' })
  const textos = await textosDe(ui)
  expect(textos).toContain('  não leu: o núcleo respondeu com erro')
  expect(textos.filter(t => t === '  não leu: o núcleo respondeu com erro').length).toBe(3)
  await ui.unmount()
})
