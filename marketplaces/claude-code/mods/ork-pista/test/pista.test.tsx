import { test, expect, mock } from 'claude-code/testing'
import {
  A_VISTA, abrirPista, EPOCA, esperar, iniciar, montar, montarPainel, PONTE_FALSA, pista, retratoDoShip, saida, saidaDaPista, SHA_B, textosDe,
  textosDoPainel,
} from './apoio'

// O esqueleto da Pista (T7.2): na sessao do dono, o painel com uma pista por entrega, lida do nucleo pelo
// `ork ship pista --json` fora do desenho, a linha da faixa pela ponte e o registro do que o painel a vista mostrou.
// O nucleo e o fundo `process.run`; as etapas e o proximo passo vem prontos dele.
/** So as leituras da pista: a reserva do CI (T7.4) tambem chama o nucleo pelo `process.run`. */
const leituras = mundo => mundo.processos.filter(a => a[2] === 'pista').length
const PR_ABERTO = { numero: 7, url: 'https://github.com/acme/app/pull/7', estado: 'aberto', rascunho: false, head: SHA_B }
const PISTAS = saidaDaPista([
  pista('ork-c', { pr: PR_ABERTO, estados: { ci: 'pendente', entrega: 'pendente' },
    proximo: { acao: null, disponivel: false, texto: 'esperando o check ork-verify no PR #7', comando: `ork ci status --sha ${SHA_B}` } }),
  pista('ork-b', { publicavel: false, estados: { branch: 'pendente', pr: 'pendente', ci: 'pendente', conflito: 'nao-se-aplica', entrega: 'pendente' },
    proximo: { acao: 'publicar', disponivel: false, texto: 'o modo #Classic da ork-b pede a sua autorização de push: publique do seu terminal',
      comando: 'publique a branch ork/ork-b-full e abra o PR pelo seu terminal' } }),
  pista('ork-a', { estados: { branch: 'pendente', pr: 'pendente', ci: 'pendente', conflito: 'nao-se-aplica', entrega: 'pendente' } }),
])

test('na sessao do dono, o /pista abre o painel com uma pista por entrega, no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS })
  await iniciar($)
  expect(mundo.comandos).toEqual(['pista'])
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  expect(mundo.processos).toEqual([['ork', 'ship', 'pista', '--json']])
  expect(mundo.faixas).toEqual([{ mod: 'ork-pista', texto: '1 pronta para publicar · 1 pede o seu push · /pista' }])
  const r = await abrirPista($)
  expect(r.text).toBe('Pista de Entrega aberta.')
  expect(mundo.abertos).toEqual(['pista'])
  await relogio.settle()
  await esperar(() => mundo.processos.length > 1)
  expect(mundo.processos).toEqual([['ork', 'ship', 'pista', '--json'], ['ork', 'ship', 'pista', '--json']])
  for (const surface of ['terminal', 'desktop'] as const) {
    const textos = await textosDoPainel($, surface)
    expect(textos.slice(0, 2)).toEqual(['Pista de Entrega · 3 entregas · 1 com botão · lida há 0 s', 'Atualizar'])
    expect(textos.filter(t => /^[!?x>-]  /.test(t))).toEqual([
      '!  ork-a  #Auto  ork/ork-a-full',
      '?  ork-b  #Classic  ork/ork-b-full',
      '>  ork-c  #Auto  ork/ork-c-full',
    ])
    expect(textos).toContain('  CHECK ✓ · verify ✓ · bundle ✓ · branch · · PR · · CI · · conflito - · entrega ·')
    expect(textos).toContain('  CHECK ✓ · verify ✓ · bundle ✓ · branch ✓ · PR #7 ✓ · CI · · conflito ✓ · entrega ·')
    expect(textos).toContain('  próximo: publique a branch e abra o PR')
    expect(textos).toContain('  próximo: o modo #Classic da ork-b pede a sua autorização de push: publique do seu terminal')
    expect(textos).toContain('  no seu terminal: publique a branch ork/ork-b-full e abra o PR pelo seu terminal')
    expect(textos).toContain('  próximo: esperando o check ork-verify no PR #7')
    expect(textos).toContain('    CI: ci pendente')
  }
  // So leitura do nucleo: nenhum argv de git, de gh nem de publicacao nesta fatia.
  expect(mundo.processos.every(a => a.join(' ') === 'ork ship pista --json')).toBe(true)
})

test('na sessao de fase a Pista nao registra comando, nao le o nucleo nem publica na faixa', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'fase', pista: PISTAS })
  await iniciar($)
  await relogio.advance(20 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.processos).toEqual([])
  expect(mundo.faixas).toEqual([])
  expect(mundo.maestro).toBe(0)
  expect((await abrirPista($)).text).toBe('A Pista de Entrega só abre na sessão do dono de um projeto do Orkastery.')
  expect(mundo.abertos).toEqual([])
})

test('dormente no inicio, a Pista confere o papel de novo e liga quando a sessao vira do dono', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dormente', pista: PISTAS })
  await iniciar($)
  expect(mundo.comandos).toEqual([])
  mundo.papel = 'dono'
  await relogio.advance(3000)
  expect(mundo.comandos).toEqual(['pista'])
  // Sessao sem pessoa (`-p` ou SDK) nem confere o papel.
})

test('a leitura que falha fica no painel com o motivo, e o CLI sem o subcomando pede a atualizacao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.processos.length > 0)
  mundo.pistaSaida = { exitCode: 2, stdout: '', stderr: 'subcomando desconhecido: ship pista' }
  await abrirPista($)
  await relogio.settle()
  await esperar(() => mundo.processos.length > 1)
  await esperar(() => false, 20)
  const textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain('a última leitura falhou: o ork deste PATH não tem ork ship pista: atualize o CLI do Orkastery')
  expect(textos).toContain('!  ork-a  #Auto  ork/ork-a-full')
  mundo.pistaSaida = { exitCode: 0, stdout: '{"contrato":"outro"}', stderr: '' }
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'atualizar' })
  await relogio.settle()
  await esperar(() => mundo.processos.length > 2)
  await esperar(() => false, 20)
  expect(await textosDe(ui)).toContain('a última leitura falhou: a saída do ork ship pista não é o contrato ork.ship-pista/v1')
  await ui.unmount()
})

test('so o que esta na janela de rolagem do painel a vista vai ao registro da ponte, uma vez', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS, paineis: A_VISTA })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  // Janela de oito linhas: o placar e as da ork-a (cabecalho, etapas, as quatro pendentes e o proximo passo).
  const ui = await montarPainel($, 'terminal', { offset: 0, bodyRows: 8 })
  await ui.unmount()
  await relogio.advance(60000)
  await esperar(() => mundo.mostrados.length > 0)
  expect(mundo.mostrados).toEqual([{ mod: 'ork-pista', canal: 'painel', chave: 'pista:ork-a', thread: 'ork-a', texto: 'ork-a: publique a branch e abra o PR' }])
  // A janela inteira: as outras duas entram; a da ork-a nao repete.
  const inteira = await montarPainel($, 'terminal')
  await inteira.unmount()
  await relogio.advance(60000)
  await esperar(() => mundo.mostrados.length > 2)
  expect(mundo.mostrados.map(m => (m as { chave: string }).chave)).toEqual(['pista:ork-a', 'pista:ork-b', 'pista:ork-c'])
  // Com o painel escondido, nada vai ao registro.
  mundo.paineis = []
  mundo.pista = saidaDaPista([pista('ork-d')])
  await abrirPista($)
  await relogio.settle()
  await esperar(() => mundo.processos.filter(a => a.length === 4).length > 1)
  const escondido = await montarPainel($, 'terminal')
  await escondido.unmount()
  await relogio.advance(60000)
  await esperar(() => false, 30)
  expect(mundo.mostrados.length).toBe(3)
})

test('a linha do proximo passo que quebra na largura do painel so conta como mostrada quando cabe inteira na janela', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS, paineis: A_VISTA })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.faixas.length > 0)
  // Em 30 colunas, o proximo passo da ork-a (40 caracteres) ocupa duas linhas da tela: a janela de oito so mostra a
  // primeira, e nada vai ao registro.
  const estreita = await montarPainel($, 'terminal', { offset: 0, bodyRows: 8 }, 30)
  await estreita.unmount()
  await relogio.advance(60000)
  await esperar(() => false, 30)
  expect(mundo.mostrados).toEqual([])
  // Com nove linhas, ele cabe inteiro.
  const inteira = await montarPainel($, 'terminal', { offset: 0, bodyRows: 9 }, 30)
  await inteira.unmount()
  await relogio.advance(60000)
  await esperar(() => mundo.mostrados.length > 0)
  expect(mundo.mostrados.map(m => (m as { chave: string }).chave)).toEqual(['pista:ork-a'])
})

test('/pista com uma thread a poe em foco no alto, e id que nao e de thread abre sem foco', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS })
  await iniciar($)
  await abrirPista($, 'ork-c')
  await relogio.settle()
  await esperar(() => mundo.processos.length > 0)
  await esperar(() => false, 20)
  const textos = await textosDoPainel($, 'desktop')
  expect(textos.filter(t => /^[!?x>-]  /.test(t))[0]).toBe('>  ork-c  #Auto  ork/ork-c-full  (em foco)')
  const r = await abrirPista($, '../fora')
  expect(r.text).toBe('Pista de Entrega aberta. O id ../fora não é de thread; a pista abre sem foco.')
  expect((await textosDoPainel($, 'terminal')).some(t => t.includes('(em foco)'))).toBe(false)
})

test('ledger de thread que muda rele a pista em lote, sem passar do intervalo minimo entre leituras', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => leituras(mundo) > 0)
  const ledger = thread => ({ file_path: `/projeto/.orkastery/threads/${thread}/ledger.jsonl`, event: 'change' })
  await $.classic.FileChanged(ledger('ork-a'))
  await $.classic.FileChanged(ledger('ork-b'))
  await $.classic.FileChanged({ file_path: '/projeto/outro/arquivo.txt', event: 'change' })
  await relogio.advance(5000)
  expect(leituras(mundo)).toBe(1)
  await relogio.advance(25000)
  await esperar(() => leituras(mundo) > 1)
  expect(leituras(mundo)).toBe(2)
  await relogio.advance(60000)
  expect(leituras(mundo)).toBe(2)
})

test('a entrega que anda no retrato da ponte rele a pista antes da idade; sem mudanca, so a idade rele', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: PISTAS, retrato: retratoDoShip([]) })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => leituras(mundo) > 0)
  await relogio.advance(60000)
  await relogio.advance(60000)
  expect(leituras(mundo)).toBe(1)
  expect(mundo.maestro).toBeGreaterThan(0)
  mundo.retrato = retratoDoShip([{ thread: 'ork-c', status: 'delivered', em: '2025-10-09T10:05:00.000Z' }])
  await relogio.advance(60000)
  await esperar(() => leituras(mundo) > 1)
  expect(leituras(mundo)).toBe(2)
  // Escondido, a idade de 15 min rele.
  await relogio.advance(15 * 60000)
  await esperar(() => leituras(mundo) > 2)
  expect(leituras(mundo)).toBe(3)
  expect(saida(0, '').value.exitCode).toBe(0)
})
