import { test, expect } from 'claude-code/testing'
import { clima, faixaEm, fundo, HORA, hora, iniciar, iso, medir, MIN, ponte, PONTE_FALSA, T0 } from './apoio'

// A serie, a previsao e a faixa do Clima pelo kit, com a ponte falsa embaixo do `$.ork`. A hora exata em
// cada fuso e conferida no teste do nucleo; aqui, o caminho da medicao ate a faixa e o `/clima`.
const RENOVA = T0 + 3 * HORA
const cinco = (pct: number, renova = RENOVA) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: iso(renova) }]

test('a serie sintetica vira a hora do esgotamento na faixa, no terminal e no desktop', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  await medir($, cinco(60))
  expect((await ponte($)).faixa).toEqual({})
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(70))
  const agora = T0 + 30 * MIN
  const linha = `clima: 5 h em 70%, acaba ~${hora(T0 + 2 * HORA, agora)}, renova ${hora(RENOVA, agora)}`
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(await faixaEm($, surface)).toEqual([linha])
  }
})

test('sem alerta a faixa sai, e leitura igual nao republica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  await medir($, cinco(20))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(25))
  expect(await ponte($)).toEqual({ faixa: {}, publicacoes: 0 })
  await relogio.set(T0 + 60 * MIN)
  await medir($, cinco(50))
  const agora = T0 + 60 * MIN
  expect((await ponte($)).faixa).toEqual({ 'ork-clima': `5 h em 50%, acaba ~${hora(T0 + 160 * MIN, agora)}, renova ${hora(RENOVA, agora)}` })
  await relogio.set(T0 + 61 * MIN)
  await medir($, cinco(50), ['context'])
  expect((await ponte($)).publicacoes).toBe(1)
  await relogio.set(RENOVA + 5 * MIN)
  await medir($, cinco(5, T0 + 8 * HORA))
  expect(await ponte($)).toEqual({ faixa: {}, publicacoes: 2 })
})

test('no papel fase o Clima nao registra o comando, nao grava e nao publica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  let papel = 'fase'
  const { relogio, comandos } = fundo(on, { papel: () => papel })
  await iniciar($)
  expect(comandos).toEqual([])
  await medir($, cinco(60))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(95))
  expect(await ponte($)).toEqual({ faixa: {}, publicacoes: 0 })
  expect(await clima($)).toMatch(/só roda na sessão do dono de um projeto do Orkastery; o papel desta sessão é fase/)
  papel = 'dono'
  expect(await clima($)).toMatch(/Sem leitura de cota ainda/)
})

test('no papel dormente o comando existe, mas nada e gravado nem publicado', { plugins: [PONTE_FALSA] }, async ($, on) => {
  let papel = 'dormente'
  const { relogio, comandos } = fundo(on, { papel: () => papel })
  await iniciar($)
  expect(comandos).toEqual(['clima'])
  await medir($, cinco(60))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(95))
  expect(await ponte($)).toEqual({ faixa: {}, publicacoes: 0 })
  expect(await clima($)).toMatch(/o papel desta sessão é dormente/)
  papel = 'dono'
  expect(await clima($)).toMatch(/Sem leitura de cota ainda/)
})

test('o /clima mostra cada janela com ritmo, previsao, renovacao e a hora da leitura', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, comandos } = fundo(on)
  await iniciar($)
  expect(comandos).toEqual(['clima'])
  const sete = T0 + 4 * 24 * HORA
  await medir($, [...cinco(60), { kind: 'seven_day', percentUsed: 40, resetsAt: iso(sete) }])
  await relogio.set(T0 + 30 * MIN)
  await medir($, [...cinco(70), { kind: 'seven_day', percentUsed: 40, resetsAt: iso(sete) }])
  await relogio.set(T0 + 40 * MIN)
  const agora = T0 + 40 * MIN
  const texto = await clima($)
  expect(texto).toContain('Clima de cota da conta desta sessão')
  expect(texto).toContain(`- 5 h: 70%, ritmo de 20 pontos por hora, acaba ~${hora(T0 + 2 * HORA, agora)} (em 1h20), antes de renovar, renova ${hora(RENOVA, agora)} (em 2h20). Lida às ${hora(T0 + 30 * MIN, agora)}.`)
  expect(texto).toContain(`- 7 d: 40%, ritmo de 0 pontos por hora, folga no ritmo atual, renova ${hora(sete, agora)} (em 3d 23h).`)
  expect(texto).toContain('O Clima só lê e avisa')
  expect(texto.indexOf('- 5 h:')).toBeLessThan(texto.indexOf('- 7 d:'))
})

test('o /clima sem leitura diz por que', { plugins: [PONTE_FALSA] }, async ($, on) => {
  fundo(on)
  await iniciar($)
  const texto = await clima($)
  expect(texto).toContain('Sem leitura de cota ainda')
  expect(texto).toContain('só existe em conta de assinatura')
})

test('a serie guardada por outra sessao vale nesta: a faixa sai no inicio, antes da primeira medicao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const serie = {
    formato: 'ork.clima-serie/v1',
    janelas: [{ kind: 'five_hour', renovaEm: RENOVA, pontos: [{ em: T0, pct: 60 }, { em: T0 + 30 * MIN, pct: 70 }] }],
  }
  const agora = T0 + 40 * MIN
  fundo(on, { agora, store: { serie } })
  await iniciar($)
  const linha = `clima: 5 h em 70%, acaba ~${hora(T0 + 2 * HORA, agora)}, renova ${hora(RENOVA, agora)}`
  for (const surface of ['terminal', 'desktop'] as const) expect(await faixaEm($, surface)).toEqual([linha])
  expect(await clima($)).toContain('- 5 h: 70%, ritmo de 20 pontos por hora')
})

test('a janela que renova comeca uma serie nova', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  await medir($, cinco(70))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(75))
  await relogio.set(RENOVA + 5 * MIN)
  await medir($, cinco(5, T0 + 8 * HORA))
  const texto = await clima($)
  expect(texto).toContain('- 5 h: 5%, ritmo ainda sem leituras suficientes, sem previsão ainda')
  expect(texto).not.toContain('75%')
})

test('leitura esparsa ainda da ritmo: o dono parado por 90 min enquanto a janela andou 15 pontos', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const renova = T0 + 4 * HORA
  const { relogio } = fundo(on)
  await medir($, cinco(70, renova))
  await relogio.set(T0 + 90 * MIN)
  await medir($, cinco(85, renova))
  const agora = T0 + 90 * MIN
  expect((await ponte($)).faixa).toEqual({ 'ork-clima': `5 h em 85%, acaba ~${hora(T0 + 3 * HORA, agora)}, renova ${hora(renova, agora)}` })
  expect(await clima($)).toContain('- 5 h: 85%, ritmo de 10 pontos por hora')
})

test('o limiar de atencao avisa mesmo sem ritmo, e a janela esgotada aparece primeiro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  fundo(on)
  await medir($, [...cinco(92), { kind: 'seven_day', percentUsed: 100, resetsAt: iso(T0 + 2 * 24 * HORA) }])
  const linha = `clima: 7 d esgotada, renova ${hora(T0 + 2 * 24 * HORA, T0)} · 5 h em 92%, renova ${hora(RENOVA, T0)}`
  expect(await faixaEm($, 'terminal')).toEqual([linha])
})
