import { test, expect } from 'claude-code/testing'
import {
  bloqueio, clima, faixaEm, fundo, HORA, hora, iso, medir, MIN, mostrados, nucleo, ponte, PONTE_FALSA, relatorio, retomada, retrato, T0,
} from './apoio'

// O cruzamento do Clima pelo kit: a previsao contra a fila de retomada e os bloqueios do retrato, e contra as
// marcas do registro de contas, lidos pela ponte falsa (o retrato por `mcp.call`, o registro por `process.run`).
const RENOVA = T0 + 3 * HORA
const cinco = (pct: number) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: iso(RENOVA) }]

/** 60% as 14:00 e 70% as 14:30: a janela de 5 h acaba as 16:00 e renova as 17:00. */
async function alerta($, relogio) {
  await medir($, cinco(60))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(70))
}

const FILA = [
  retomada('R3', 'ork-x', 'aguardando', T0 + 150 * MIN),
  retomada('R4', 'ork-y', 'aguardando', T0 + 60 * MIN),
  retomada('R5', 'ork-z', 'aguardando', T0 + 4 * HORA),
  retomada('R6', 'ork-w', 'retomado', T0 + 150 * MIN),
]

test('a retomada que cai entre o esgotamento e a renovacao nao cabe: faixa, /clima e registro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { retrato: retrato({ retries: FILA }) })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  const linha = `clima: 5 h em 70%, acaba ~${hora(T0 + 2 * HORA, agora)}, renova ${hora(RENOVA, agora)}; não cabe: ork-x`
  for (const surface of ['terminal', 'desktop'] as const) expect(await faixaEm($, surface)).toEqual([linha])
  const texto = await clima($)
  expect(texto).toContain(`- R3 da ork-x volta ${hora(T0 + 150 * MIN, agora)} e não cabe: a janela de 5 h acaba ~${hora(T0 + 2 * HORA, agora)} e renova ${hora(RENOVA, agora)}.`)
  expect(texto).toContain(`- R4 da ork-y volta ${hora(T0 + 60 * MIN, agora)}, com ~1h00 de cota no ritmo atual.`)
  expect(texto).toContain(`- R5 da ork-z volta ${hora(T0 + 4 * HORA, agora)}, depois de a janela de 5 h renovar.`)
  expect(texto).not.toContain('ork-w')
  expect(texto.indexOf('R3 da ork-x')).toBeLessThan(texto.indexOf('R4 da ork-y'))
  const registro = await mostrados($)
  expect(registro).toContainEqual(expect.objectContaining({ mod: 'ork-clima', canal: 'faixa', chave: 'clima:nao-cabe:R3', thread: 'ork-x' }))
  expect(registro).toContainEqual(expect.objectContaining({ mod: 'ork-clima', canal: 'transcript', chave: 'clima:consulta', texto: linha.slice('clima: '.length) }))
  expect(registro).toContainEqual(expect.objectContaining({ mod: 'ork-clima', canal: 'transcript', chave: 'clima:nao-cabe:R3', thread: 'ork-x' }))
  expect(registro.filter(m => m.chave === 'clima:nao-cabe:R4')).toEqual([])
})

test('as contas do registro e as threads paradas por cota, com as sugestoes do nucleo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, {
    retrato: retrato({ blockers: [bloqueio('ork-a', 'runtime.quota-exhausted'), bloqueio('ork-b', 'runtime.silencio'), bloqueio('ork-c', 'runtime.rate-limited')] }),
    relatorio: relatorio([
      { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', em: iso(T0), esgotadoAte: iso(RENOVA), projeto: 'orkastery' },
      { conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', motivo: 'runtime.auth-missing', em: iso(T0), esgotadoAte: null, projeto: 'outro' },
      { conta: '/caminho/de/conta', runtime: 'codex', estado: 'esgotado' },
    ]),
  })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  const texto = await clima($)
  expect(texto).toContain('- ork-a parada por runtime.quota-exhausted.')
  expect(texto).toContain('- ork-c parada por runtime.rate-limited.')
  expect(texto).not.toContain('ork-b')
  expect(texto).toContain(`- conta 1a2b3c4d5e6f (claude-bg): esgotado até ${hora(RENOVA, agora)}, visto em orkastery (runtime.quota-exhausted).`)
  expect(texto).toContain('- conta abcdefabcdef (codex): sem-auth sem prazo, visto em outro (runtime.auth-missing).')
  expect(texto).not.toContain('/caminho/de/conta')
  expect(texto).toContain('O que o núcleo já sabe fazer:')
  expect(texto).toContain('ork accounts list mostra os perfis')
  expect(texto).toContain('ork retry run <thread> segue no próximo perfil do rodízio')
  expect(texto).toContain('ork retry list mostra a fila')
  expect(texto).not.toContain('--por')
  expect(texto.endsWith('O Clima só lê e avisa: troca de conta, de runtime ou de modelo fica com o núcleo e com você.')).toBe(true)
})

test('sem alerta o retrato nao e lido a cada turno, e o /clima le o retrato e o registro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  const lidos = nucleo(on, { retrato: retrato({ retries: FILA }) })
  await medir($, cinco(20))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(25))
  expect(lidos).toEqual({ retrato: 0, registro: 0 })
  const texto = await clima($)
  expect(lidos).toEqual({ retrato: 1, registro: 1 })
  expect(texto).toContain(`- R4 da ork-y volta ${hora(T0 + 60 * MIN, T0 + 30 * MIN)}.`)
  expect(texto).not.toContain('O que o núcleo já sabe fazer')
  expect(texto).toContain('- Nenhuma conta marcada no registro.')
  expect((await ponte($)).faixa).toEqual({})
})

test('retrato e registro indisponiveis viram aviso, e a faixa segue sem o cruzamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { retrato: null, relatorio: null })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  expect((await ponte($)).faixa).toEqual({ 'ork-clima': `5 h em 70%, acaba ~${hora(T0 + 2 * HORA, agora)}, renova ${hora(RENOVA, agora)}` })
  const texto = await clima($)
  expect(texto).toContain('- Retrato do núcleo indisponível (ork-ponte: o ork_maestro respondeu com erro).')
  expect(texto).toContain('- Registro de contas indisponível (ork-ponte: ork accounts esgotamentos saiu 3).')
  expect(texto).toContain('- 5 h: 70%')
})

test('retrato parcial e dito, e a retomada que ja liberou volta agora', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { retrato: retrato({ retries: [retomada('R8', 'ork-v', 'due', T0 - 10 * MIN)], estado: 'unavailable' }) })
  await alerta($, relogio)
  const texto = await clima($)
  expect(texto).toContain('- R8 da ork-v volta agora, com ~1h30 de cota no ritmo atual.')
  expect(texto).toContain('- Retrato parcial: a fila de retomada ou os bloqueios vieram incompletos.')
})
