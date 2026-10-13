import { test, expect, mock } from 'claude-code/testing'
import {
  A_VISTA, abrirNota, claim, EPOCA, esperar, iniciar, itemMaster, montar, montarPainel, PONTE_FALSA, retratoMaster, textosDe, textosDoPainel,
} from './apoio'

// O esqueleto do Ritual (T8.2): na sessao do dono, o painel com as entregas que esperam a nota do dono, lidas so pelo
// retrato da ponte (secao `master`), e o replay da prova de cada uma, com as claims pelo `ork_claims_list`, uma por vez.
// Nenhum arquivo e lido e nenhum processo roda: o fundo guarda qualquer tentativa.
const ENTREGAS = [
  itemMaster('ork-a', { index: 3.75, indexDetail: 'go_fix_opened x2, check_reverify x1', reprovals: 2, classes: 'base-avancou, processo', dias: 2 }),
  itemMaster('ork-b', { status: 'pending', index: 5, indexDetail: '', reprovals: 0, dias: 1 }),
  itemMaster('ork-c', { regime: 'batch', score: 5, dias: 1 }),
  itemMaster('ork-d', { dias: 10 }),
  itemMaster('ork-e', { status: 'ratificacao-pendente', classes: 'sem-falha', index: 4.5, indexDetail: 'check_reverify x1', dias: 0 }),
  itemMaster('ork-f', { status: 'pending', entregue: false }),
]
const PAGINAS = { 0: retratoMaster(ENTREGAS) }
const CLAIMS_A = [claim('ork-a', 'C1', 'pendente'), claim('ork-a', 'C2', 'verificado'), claim('ork-a', 'C3', 'reprovado'), claim('ork-a', 'C10', 'pendente'),
  claim('ork-a', 'C1', 'verificado'), claim('ork-a', 'C2', 'retirada')]
const LISTA = [
  'Ritual do MASTER · 3 entregas esperam a sua nota · lido há 0 s',
  'Atualizar',
  '1 entrega sem a sua nota ficou fora da janela de 7 dias (ork master)',
  '● espera sua nota · ork-e · entregue 20/10 14:20 (horário de Brasília) · merge aaaaaaaa',
  '  proposta da fábrica esperando a sua nota',
  '  índice derivado do ledger: 4,5 de 5 (check_reverify x1) · ork master',
  '  POSTMORTEM da proposta: classes sem-falha · 1 reprovação tipada',
  'Ver a prova',
  'Dar a nota',
  '● espera sua nota · ork-b · entregue 19/10 14:20 (horário de Brasília) · merge aaaaaaaa',
  '  sem nota: sem a sua, o MASTER fecha por omissão',
  '  índice derivado do ledger: 5 de 5 (sem desconto) · ork master',
  '  POSTMORTEM: nasce no fechamento · 0 reprovações tipadas',
  'Ver a prova',
  'Dar a nota',
  '● espera sua nota · ork-a · entregue 18/10 14:20 (horário de Brasília) · merge aaaaaaaa',
  '  aceita por omissão com 4/5; a sua nota sobrescreve',
  '  índice derivado do ledger: 3,75 de 5 (go_fix_opened x2, check_reverify x1) · ork master',
  '  POSTMORTEM: classes base-avancou, processo · 2 reprovações tipadas',
  'Ver a prova',
  'Dar a nota',
]

test('na sessao do dono, o /nota abre o painel com as entregas sem nota humana da janela, a mais nova primeiro, no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS })
  await iniciar($)
  expect(mundo.comandos).toEqual(['nota'])
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  expect(mundo.maestro).toEqual([{ section: 'master', offset: 0 }])
  expect(mundo.faixas).toEqual([{ mod: 'ork-ritual', texto: '3 entregas esperam a sua nota: ork-e, ork-b, ork-a · /nota' }])
  const r = await abrirNota($)
  expect(r.text).toBe('Ritual do MASTER aberto.')
  expect(mundo.abertos).toEqual(['ritual'])
  await esperar(() => mundo.maestro.length > 1)
  await esperar(() => false, 10)
  for (const surface of ['terminal', 'desktop'] as const) expect(await textosDoPainel($, surface)).toEqual(LISTA)
  // So o retrato da ponte: nenhum arquivo lido, nenhum processo, nenhuma outra ferramenta do nucleo.
  expect(mundo.lidos).toEqual([])
  expect(mundo.processos).toEqual([])
  expect(mundo.outrasMcp).toEqual([])
  expect(mundo.claimsPedidas).toEqual([])
})

test('na sessao de fase o Ritual nao registra comando, nao le o nucleo nem publica na faixa', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'fase', paginas: PAGINAS })
  await iniciar($)
  await relogio.advance(20 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.maestro).toEqual([])
  expect(mundo.faixas).toEqual([])
  expect((await abrirNota($)).text).toBe('O Ritual do MASTER só abre na sessão do dono de um projeto do Orkastery.')
  expect(mundo.abertos).toEqual([])
})

test('dormente no inicio, o Ritual confere o papel de novo e liga quando a sessao vira do dono', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dormente', paginas: PAGINAS })
  await iniciar($)
  expect(mundo.comandos).toEqual([])
  mundo.papel = 'dono'
  await relogio.advance(3000)
  expect(mundo.comandos).toEqual(['nota'])
})

test('as paginas da secao master: segue o nextOffset ate o fim; o corte por bytes nao e lacuna, e a thread sem leitura vira pelo menos', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: {
    0: retratoMaster([itemMaster('ork-a', { dias: 2 })], { proxima: 1, lacunas: ['maestro.page.byte_limit'] }),
    1: retratoMaster([itemMaster('ork-b', { dias: 1 })], { offset: 1, lacunas: ['ledger.unavailable:ork-x', 'master.invalid:ork-y'] }),
  } })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  expect(mundo.maestro).toEqual([{ section: 'master', offset: 0 }, { section: 'master', offset: 1 }])
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-ritual', texto: 'pelo menos 2 entregas esperam a sua nota: ork-b, ork-a · /nota' })
  const textos = await textosDoPainel($, 'terminal')
  expect(textos[0]).toBe('Ritual do MASTER · pelo menos 2 entregas esperam a sua nota · lido há 0 s')
  expect(textos).toContain('o retrato não leu 2 threads (ork-x, ork-y): a lista pode estar incompleta; ork master lista todas')
  expect(textos.some(t => t.includes('veio incompleto'))).toBe(false)
  expect(textos.filter(t => t.startsWith('● '))).toEqual([
    '● espera sua nota · ork-b · entregue 19/10 14:20 (horário de Brasília) · merge aaaaaaaa',
    '● espera sua nota · ork-a · entregue 18/10 14:20 (horário de Brasília) · merge aaaaaaaa',
  ])
})

test('sem entrega visivel e com threads que o retrato nao leu, a faixa nao some: aponta o ork master, e o painel diz o mesmo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: {
    0: retratoMaster([itemMaster('ork-c', { regime: 'batch', score: 5, dias: 1 })], { lacunas: ['ledger.unavailable:ork-x', 'maestro.messages.omitted:4'] }),
  } })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-ritual', texto: 'o retrato não leu 5 threads: ork master lista as entregas que esperam a sua nota · /nota' })
  const textos = await textosDoPainel($, 'terminal')
  expect(textos[0]).toBe('Ritual do MASTER · o retrato não leu 5 threads · lido há 0 s')
  expect(textos).toContain('o retrato não leu 5 threads (ork-x e +4): a lista pode estar incompleta; ork master lista todas')
  expect(textos).toContain('Nenhuma das entregas que o retrato leu espera a sua nota nos últimos 7 dias; ork master lista as das threads que ele não leu.')
  expect(textos).not.toContain('Nada espera a sua nota nos últimos 7 dias.')
})

test('o replay: Ver a prova le as claims so com o threadId, uma por vez, o ultimo registro de cada id e as retiradas fora', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS, claims: { 'ork-a': CLAIMS_A } })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  await abrirNota($)
  await esperar(() => mundo.maestro.length > 1)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'prova:ork-a' })
  await esperar(() => mundo.claimsPedidas.length > 0)
  await esperar(() => false, 10)
  expect(mundo.claimsPedidas).toEqual([{ threadId: 'ork-a' }])
  let textos = await textosDe(ui)
  expect(textos.slice(0, 3)).toEqual(['Ritual do MASTER · prova da ork-a', 'Voltar', 'Atualizar'])
  expect(textos).toContain('● espera sua nota · ork-a · entregue 18/10 14:20 (horário de Brasília) · merge aaaaaaaa')
  expect(textos.slice(-5)).toEqual([
    '  claim 1 de 3 · 1 retirada fora · ork claims list ork-a',
    '  ✓ C1 · verificada · core/src/c1.ts',
    '  A C1 sustenta a entrega da ork-a.',
    '  $ node --test core/dist-test/test/c1.test.js',
    'Próxima',
  ])
  await ui.press({ key: 'proxima' })
  await esperar(() => false, 10)
  textos = await textosDe(ui)
  expect(textos).toContain('  × C3 · reprovada · core/src/c3.ts')
  expect(textos.slice(-2)).toEqual(['Anterior', 'Próxima'])
  await ui.press({ key: 'proxima' })
  await esperar(() => false, 10)
  textos = await textosDe(ui)
  expect(textos).toContain('  claim 3 de 3 · 1 retirada fora · ork claims list ork-a')
  expect(textos).toContain('  · C10 · pendente · core/src/c10.ts')
  expect(textos.at(-1)).toBe('Anterior')
  await ui.press({ key: 'anterior' })
  await esperar(() => false, 10)
  expect(await textosDe(ui)).toContain('  × C3 · reprovada · core/src/c3.ts')
  await ui.press({ key: 'voltar' })
  await esperar(() => false, 10)
  expect((await textosDe(ui))[0]).toBe('Ritual do MASTER · 3 entregas esperam a sua nota · lido há 0 s')
  await ui.unmount()
  // A prova nao passa por disco nem por processo, e nenhum texto de saida de comando aparece (D6).
  expect(mundo.lidos).toEqual([])
  expect(mundo.processos).toEqual([])
})

test('o /nota com a thread (como a Torre chama) abre direto no replay dela; id ruim abre a lista; claims que nao vem viram aviso', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  expect((await abrirNota($, 'ork-b')).text).toBe('Ritual do MASTER aberto na prova da ork-b.')
  await esperar(() => mundo.claimsPedidas.length > 0)
  await esperar(() => false, 10)
  expect(mundo.claimsPedidas).toEqual([{ threadId: 'ork-b' }])
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    expect(textos[0]).toBe('Ritual do MASTER · prova da ork-b')
    expect(textos).toContain('  sem nota: sem a sua, o MASTER fecha por omissão')
    expect(textos).toContain('as claims não vieram: thread sem claims')
  }
  expect((await abrirNota($, '../fora')).text).toBe('Ritual do MASTER aberto. O id ../fora não é de thread; o painel abre na lista das entregas.')
  await esperar(() => false, 10)
  expect((await textosDoPainel($, 'terminal'))[0]).toBe('Ritual do MASTER · 3 entregas esperam a sua nota · lido há 0 s')
  expect(mundo.claimsPedidas.length).toBe(1)
})

test('so o que esta na janela de rolagem do painel a vista vai ao registro da ponte, uma vez', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS, paineis: A_VISTA })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  // Janela de seis linhas: o placar, o aviso e o cartao da ork-e ate o indice.
  const ui = await montarPainel($, 'terminal', { offset: 0, bodyRows: 6 })
  await ui.unmount()
  await relogio.advance(60000)
  await esperar(() => mundo.mostrados.length > 0)
  expect(mundo.mostrados).toEqual([{ mod: 'ork-ritual', canal: 'painel', chave: 'nota:ork-e', thread: 'ork-e', texto: 'ork-e: entregue, espera sua nota (índice 4,5 de 5)' }])
  const inteira = await montarPainel($, 'terminal')
  await inteira.unmount()
  await relogio.advance(60000)
  await esperar(() => mundo.mostrados.length > 2)
  expect(mundo.mostrados.map(m => (m as { chave: string }).chave)).toEqual(['nota:ork-e', 'nota:ork-b', 'nota:ork-a'])
  // Com o painel escondido, nada novo entra no registro.
  mundo.paineis = []
  const escondida = await montarPainel($, 'terminal')
  await escondida.unmount()
  await relogio.advance(60000)
  await esperar(() => false, 20)
  expect(mundo.mostrados.length).toBe(3)
})

test('o desenho com o painel escondido desde o inicio nao vai ao registro do mostrado, nem depois do tique', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS, paineis: [] })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  const ui = await montarPainel($, 'terminal')
  expect((await textosDe(ui)).filter(t => t.startsWith('● ')).length).toBe(3)
  await ui.unmount()
  await relogio.advance(60000)
  await esperar(() => false, 30)
  expect(mundo.mostrados).toEqual([])
  // O mesmo desenho com o painel a vista vai ao registro: a guarda e a do painel escondido, nao a do desenho.
  mundo.paineis = A_VISTA
  const aVista = await montarPainel($, 'terminal')
  await aVista.unmount()
  await relogio.advance(60000)
  await esperar(() => mundo.mostrados.length > 2)
  expect(mundo.mostrados.map(m => (m as { chave: string }).chave)).toEqual(['nota:ork-e', 'nota:ork-b', 'nota:ork-a'])
})

test('a leitura que falha fica no painel com o motivo e a anterior continua; sem entrega, a faixa sai e o painel diz que nada espera', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  mundo.maestroFalha = true
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'atualizar' })
  await esperar(() => mundo.maestro.length > 1)
  await esperar(() => false, 10)
  let textos = await textosDe(ui)
  expect(textos).toContain('a última leitura falhou: ork-ponte: o ork_maestro respondeu com erro')
  expect(textos.filter(t => t.startsWith('● ')).length).toBe(3)
  mundo.maestroFalha = false
  mundo.paginas = { 0: retratoMaster([itemMaster('ork-c', { regime: 'batch', score: 5 })]) }
  await ui.press({ key: 'atualizar' })
  await esperar(() => mundo.maestro.length > 2)
  await esperar(() => false, 10)
  textos = await textosDe(ui)
  expect(textos).toContain('Nada espera a sua nota nos últimos 7 dias.')
  expect(textos[0]).toBe('Ritual do MASTER · 0 entregas esperam a sua nota · lido há 0 s')
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-ritual' })
  await ui.unmount()
})

test('o ledger que muda rele as entregas em lote no intervalo de 1 min com o painel a vista; escondido, so a idade de 15 min rele', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', paginas: PAGINAS, paineis: A_VISTA })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  const leituras = () => mundo.maestro.length
  expect(leituras()).toBe(1)
  const ledger = (thread: string) => ({ file_path: `/projeto/.orkastery/threads/${thread}/ledger.jsonl`, event: 'change' })
  await $.classic.FileChanged(ledger('ork-a'))
  await $.classic.FileChanged(ledger('ork-b'))
  await $.classic.FileChanged({ file_path: '/projeto/outro/arquivo.txt', event: 'change' })
  await relogio.advance(5000)
  await esperar(() => false, 10)
  expect(leituras()).toBe(1)
  await relogio.advance(55000)
  await esperar(() => leituras() > 1)
  expect(leituras()).toBe(2)
  // Escondido: o ledger que muda nao rele antes da idade de 15 min; o tique da idade rele.
  mundo.paineis = []
  await $.classic.FileChanged(ledger('ork-a'))
  await relogio.advance(10 * 60000)
  await esperar(() => false, 10)
  expect(leituras()).toBe(2)
  await relogio.advance(6 * 60000)
  await esperar(() => leituras() > 2)
  expect(leituras()).toBe(3)
})
