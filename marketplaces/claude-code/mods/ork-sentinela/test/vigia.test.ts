import { test, expect } from 'claude-code/testing'
import { argvs, faixaEm, iniciar, iso, MIN, montar, passo, ponte, PONTE_FALSA, SESSAO, sentinela, status, T0 } from './apoio'

// T6.1: o papel, a presença, a leitura do status do núcleo e a faixa, pelo kit, com a ponte falsa embaixo do `$.ork`.
const BATER = `ork conducao sentinela bater --sessao ${SESSAO} --json`
const STATUS = 'ork conducao sentinela status --json'
const DESLIGAR = `ork conducao sentinela desligar --sessao ${SESSAO} --json`
const PULSE = 'ork pulse --json'
const vezes = (mundo, linha: string) => argvs(mundo).filter(a => a === linha).length

test('no papel dono a Sentinela liga: o /sentinela, a batida com o id da sessao, o status e a faixa no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([
    passo('ork-a', { conduzida: true, porque: 'conduzida agora: quem conduz segue' }),
    passo('ork-b', { acao: 'avisar', caso: 'sessao-sem-pergunta', desdeEm: iso(T0 - 42 * MIN), proximoPasso: 'ler o fim da sessão 82b49aa6 e seguir a thread' }),
  ])
  await iniciar($, relogio)
  expect(mundo.comandos).toEqual(['sentinela'])
  expect(argvs(mundo)).toEqual([BATER, STATUS, PULSE])
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await faixaEm($, surface)).toEqual(['sentinela: 1 thread andando, 1 parada há mais de 30 min'])
  }
  const mostrados = (await ponte($)).mostrados
  expect(mostrados).toEqual([{ mod: 'ork-sentinela', canal: 'faixa', texto: '1 thread andando, 1 parada há mais de 30 min' }])
  // A batida de 60 s renova a presença e relê o núcleo; com 43 min o degrau é o mesmo, e a faixa não é republicada.
  await relogio.advance(60000)
  await relogio.settle()
  expect([vezes(mundo, BATER), vezes(mundo, STATUS)]).toEqual([2, 2])
  expect((await ponte($)).mostrados.length).toBe(1)
})

test('um ledger que muda acorda a rodada depois do intervalo minimo; arquivo que nao e ledger nao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  await iniciar($, relogio)
  expect(vezes(mundo, STATUS)).toBe(1)
  await $.classic.FileChanged({ file_path: '/projeto/src/fatia.ts', event: 'change' })
  await relogio.advance(20000)
  await relogio.settle()
  expect(vezes(mundo, STATUS)).toBe(1)
  await $.classic.FileChanged({ file_path: '/projeto/.orkastery/threads/ork-a/ledger.jsonl', event: 'change' })
  await $.classic.FileChanged({ file_path: '/projeto/.orkastery/threads/ork-b/ledger.jsonl', event: 'change' })
  await relogio.advance(1000)
  await relogio.settle()
  expect(vezes(mundo, STATUS)).toBe(1)
  await relogio.advance(1000)
  await relogio.settle()
  expect(vezes(mundo, STATUS)).toBe(2)
  // A rodada pedida por arquivo não bate a presença: a batida tem a cadência dela.
  expect(vezes(mundo, BATER)).toBe(1)
})

test('no papel fase e no dormente a Sentinela nao registra comando, nao bate e nao le', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on, { papel: 'fase' })
  await iniciar($, relogio)
  await relogio.advance(5 * MIN)
  await relogio.settle()
  expect(mundo.comandos).toEqual([])
  expect(argvs(mundo)).toEqual([])
  mundo.papel = 'dormente'
  await $.classic.FileChanged({ file_path: '/projeto/.orkastery/threads/ork-a/ledger.jsonl', event: 'change' })
  await relogio.advance(5 * MIN)
  await relogio.settle()
  expect(argvs(mundo)).toEqual([])
  expect((await ponte($)).faixa).toEqual({})
})

test('dormente no inicio, a Sentinela liga quando o papel vira dono', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on, { papel: 'dormente' })
  await iniciar($, relogio)
  expect(mundo.comandos).toEqual([])
  mundo.papel = 'dono'
  await relogio.advance(3000)
  await relogio.settle()
  expect(mundo.comandos).toEqual(['sentinela'])
  await relogio.advance(1000)
  await relogio.settle()
  expect(argvs(mundo)).toEqual([BATER, STATUS, PULSE])
})

test('/sentinela mostra o passo e o diario; pausar desliga a presenca e a faixa diz pausada; retomar volta a bater', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a', { conduzida: true })])
  await iniciar($, relogio)
  const texto = await sentinela($)
  expect(texto).toContain('Sentinela conduzindo nesta máquina')
  expect(texto).toContain('ork-a: andando')
  expect(await sentinela($, 'pausar')).toContain('Sentinela pausada')
  expect(argvs(mundo)).toContain(DESLIGAR)
  expect(await faixaEm($, 'terminal')).toEqual(['sentinela: pausada; o condutor externo conduz'])
  const batidas = vezes(mundo, BATER)
  await relogio.advance(60000)
  await relogio.settle()
  expect(vezes(mundo, BATER)).toBe(batidas)
  expect(await sentinela($)).toContain('Sentinela pausada')
  expect(await sentinela($, 'retomar')).toContain('Sentinela retomada')
  expect(vezes(mundo, BATER)).toBe(batidas + 1)
  expect(await faixaEm($, 'desktop')).toEqual(['sentinela: 1 thread andando'])
  expect(await sentinela($, 'outra coisa')).toContain('Uso: /sentinela')
})

test('com outra sessao viva na maquina a batida sai 3 e a faixa diz que esta so olha', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.batida = 'outra'
  mundo.status = status([passo('ork-a', { conduzida: true })], 'outra-sessao')
  await iniciar($, relogio)
  expect(await faixaEm($, 'terminal')).toEqual(['sentinela: outra sessão conduz nesta máquina; esta só olha'])
  expect(await sentinela($)).toContain('Outra sessão conduz pela Sentinela nesta máquina')
})

test('a leitura do nucleo que falha vai a faixa e ao diario uma vez so, e a seguinte que funciona volta ao normal', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.statusFalha = true
  await iniciar($, relogio)
  await relogio.advance(60000)
  await relogio.settle()
  const [linha] = await faixaEm($, 'terminal')
  expect(linha).toContain('sentinela: sem leitura do núcleo (o status do nucleo saiu 1: falhou)')
  const diario = await sentinela($)
  expect(diario.split('erro: a leitura do núcleo falhou').length - 1).toBe(1)
  mundo.statusFalha = false
  mundo.status = status([passo('ork-a', { conduzida: true })])
  await relogio.advance(60000)
  await relogio.settle()
  expect(await faixaEm($, 'terminal')).toEqual(['sentinela: 1 thread andando'])
})

test('batida no ar quando a pausa chega: a presenca que ela refez sai de novo, e o fim da sessao tambem', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a', { conduzida: true })])
  await iniciar($, relogio)
  mundo.atrasoDaBatida = 5000
  await relogio.advance(59000)
  await relogio.settle()
  // A batida do minuto 1 esta no ar (5 s): a pausa desliga agora, e a batida que chega depois refaz a presenca.
  expect(await sentinela($, 'pausar')).toContain('Sentinela pausada')
  await relogio.advance(10000)
  await relogio.settle()
  expect(mundo.sequencia.slice(-2)).toEqual(['fim-da-batida', 'desligar'])
  expect(vezes(mundo, DESLIGAR)).toBe(2)
})
