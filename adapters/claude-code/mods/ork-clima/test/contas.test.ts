import { test, expect } from 'claude-code/testing'
import {
  abertas, bloqueio, clima, faixaEm, fundo, HORA, hora, horaNaFaixa, iso, medir, MIN, mostrados, nucleo, pedido, ponte, PONTE_FALSA,
  relatorio, retrato, T0,
} from './apoio'

// O cruzamento do Clima pelo kit: a previsao contra a fila de retomada inteira (`retry.list`) e os bloqueios do
// retrato, e contra as marcas do registro de contas, lidos pela ponte falsa como a ponte real le.
const RENOVA = T0 + 3 * HORA
const cinco = (pct: number) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: iso(RENOVA) }]

/** 60% as 14:00 e 70% as 14:30: a janela de 5 h acaba as 16:00 e renova as 17:00. */
async function alerta($, relogio) {
  await medir($, cinco(60))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(70))
}

const FILA = [
  pedido('R3', 'ork-x', 'aguardando', T0 + 150 * MIN),
  pedido('R4', 'ork-y', 'aguardando', T0 + 60 * MIN),
  pedido('R5', 'ork-z', 'aguardando', T0 + 4 * HORA),
  pedido('R6', 'ork-w', 'retomado', T0 + 150 * MIN),
]

test('a retomada que cai entre o esgotamento e a renovacao nao cabe: faixa, /clima e registro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { fila: FILA })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  const resumo = `não cabe: ork-x; 5 h com 70% ou mais, acaba ~${horaNaFaixa(T0 + 2 * HORA, agora)}, renova ${hora(RENOVA, agora)}`
  for (const surface of ['terminal', 'desktop'] as const) expect(await faixaEm($, surface)).toEqual([`clima: ${resumo}`])
  await medir($, cinco(70), ['context'])
  const texto = await clima($)
  expect(texto).toContain(`- R3 da ork-x volta ${hora(T0 + 150 * MIN, agora)} e não cabe: a janela de 5 h acaba ~${hora(T0 + 2 * HORA, agora)} e renova ${hora(RENOVA, agora)}.`)
  expect(texto).toContain(`- R4 da ork-y volta ${hora(T0 + 60 * MIN, agora)}, com ~1h00 de cota no ritmo atual.`)
  expect(texto).toContain(`- R5 da ork-z volta ${hora(T0 + 4 * HORA, agora)}, depois de a janela de 5 h renovar.`)
  expect(texto).not.toContain('ork-w')
  expect(texto.indexOf('R3 da ork-x')).toBeLessThan(texto.indexOf('R4 da ork-y'))
  const registro = await mostrados($)
  const naoCabe = `R3 da ork-x não cabe na janela de 5 h, que renova ${hora(RENOVA, agora)}.`
  expect(registro.filter(m => m.chave === 'clima:nao-cabe:R3' && m.canal === 'faixa')).toEqual([
    { mod: 'ork-clima', canal: 'faixa', chave: 'clima:nao-cabe:R3', thread: 'ork-x', texto: naoCabe },
  ])
  expect(registro).toContainEqual({ mod: 'ork-clima', canal: 'transcript', chave: 'clima:consulta', texto: resumo })
  expect(registro).toContainEqual({ mod: 'ork-clima', canal: 'transcript', chave: 'clima:nao-cabe:R3', thread: 'ork-x', texto: naoCabe })
  expect(registro.filter(m => m.chave === 'clima:nao-cabe:R4')).toEqual([])
})

test('as contas do registro e as threads abertas paradas por cota, com as sugestoes do nucleo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, {
    retrato: retrato({ blockers: [bloqueio('ork-a', 'runtime.quota-exhausted'), bloqueio('ork-b', 'runtime.silencio'),
      bloqueio('ork-c', 'runtime.rate-limited'), bloqueio('ork-d', 'runtime.quota-exhausted')] }),
    abertas: abertas(['ork-a', 'ork-b', 'ork-c']),
    relatorio: relatorio([
      { conta: '1a2b3c4d5e6f', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', em: iso(T0), esgotadoAte: iso(RENOVA), projeto: 'orkastery' },
      { conta: 'abcdefabcdef', runtime: 'codex', estado: 'sem-auth', motivo: 'runtime.auth-missing', em: iso(T0), esgotadoAte: null, projeto: 'outro' },
      { conta: 'aaaaaaaaaaaa', runtime: 'claude-bg', estado: 'esgotado', motivo: 'runtime.quota-exhausted', em: iso(T0), esgotadoAte: iso(RENOVA), projeto: 'nao registrado' },
      { conta: '/caminho/de/conta', runtime: 'codex', estado: 'esgotado' },
    ]),
  })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  const texto = await clima($)
  expect(texto).toContain('- ork-a parada por runtime.quota-exhausted.')
  expect(texto).toContain('- ork-c parada por runtime.rate-limited.')
  expect(texto).not.toContain('ork-b')
  expect(texto).not.toContain('ork-d')
  expect(texto).toContain(`- conta 1a2b3c4d5e6f (claude-bg): esgotado até ${hora(RENOVA, agora)}, visto em orkastery (runtime.quota-exhausted).`)
  expect(texto).toContain('- conta abcdefabcdef (codex): sem-auth sem prazo, visto em outro (runtime.auth-missing).')
  expect(texto).toContain(`- conta aaaaaaaaaaaa (claude-bg): esgotado até ${hora(RENOVA, agora)}, visto em projeto não registrado (runtime.quota-exhausted).`)
  expect(texto).not.toContain('/caminho/de/conta')
  expect(texto).toContain('O que o núcleo já sabe fazer:')
  expect(texto).toContain('ork accounts list mostra os perfis')
  expect(texto).toContain('ork retry run <thread> segue no próximo perfil do rodízio')
  expect(texto).toContain('ork retry list mostra a fila')
  expect(texto).not.toContain('--por')
  expect(texto.endsWith('O Clima só lê e avisa: troca de conta, de runtime ou de modelo fica com o núcleo e com você.')).toBe(true)
})

test('sem alerta nada do nucleo e lido a cada turno, e o /clima le a fila, o retrato, as threads e o registro', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  const lidos = nucleo(on, { fila: FILA })
  await medir($, cinco(20))
  await relogio.set(T0 + 30 * MIN)
  await medir($, cinco(25))
  expect(lidos).toEqual({ retrato: 0, fila: 0, abertas: 0, registro: 0 })
  const texto = await clima($)
  expect(lidos).toEqual({ retrato: 1, fila: 1, abertas: 1, registro: 1 })
  expect(texto).toContain(`- R4 da ork-y volta ${hora(T0 + 60 * MIN, T0 + 30 * MIN)}.`)
  expect(texto).toContain('- Nenhuma.')
  expect(texto).not.toContain('O que o núcleo já sabe fazer')
  expect(texto).toContain('- Nenhuma conta marcada no registro.')
  expect((await ponte($)).faixa).toEqual({})
})

test('com alerta, a fila so e lida quando chega leitura nova, e a faixa guarda o que nao cabe', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  const lidos = nucleo(on, { fila: FILA })
  await alerta($, relogio)
  expect(lidos.fila).toBe(1)
  for (let i = 1; i <= 3; i++) {
    await relogio.set(T0 + (30 + i) * MIN)
    await medir($, cinco(70), ['context'])
  }
  expect(lidos).toEqual({ retrato: 0, fila: 1, abertas: 0, registro: 0 })
  expect((await ponte($)).faixa['ork-clima']).toMatch(/^não cabe: ork-x; 5 h com 70% ou mais/)
  expect((await ponte($)).publicacoes).toBe(1)
  // Leitura nova no mesmo ritmo: a fila e lida de novo, mas a retomada que ja nao cabia nao volta ao registro.
  await relogio.set(T0 + 34.5 * MIN)
  await medir($, cinco(71.5))
  expect(lidos.fila).toBe(2)
  expect((await ponte($)).publicacoes).toBe(1)
  expect((await mostrados($)).filter(m => m.chave === 'clima:nao-cabe:R3')).toHaveLength(1)
})

test('leituras indisponiveis viram aviso com a mensagem da ponte, e a faixa segue sem o cruzamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { retrato: null, fila: null, abertas: null, relatorio: null })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  expect((await ponte($)).faixa).toEqual({ 'ork-clima': `5 h com 70% ou mais, acaba ~${horaNaFaixa(T0 + 2 * HORA, agora)}, renova ${hora(RENOVA, agora)}` })
  const texto = await clima($)
  expect(texto).toContain('- Fila de retomada indisponível (ork-ponte: ork retry list saiu 3: falhou).')
  expect(texto).toContain('- Não deu para conferir as paradas (ork-ponte: ork maestro --json saiu 3: falhou).')
  expect(texto).toContain('- Registro de contas indisponível (ork-ponte: ork accounts esgotamentos saiu 3: falhou).')
  expect(texto).toContain('- 5 h: 70%')
})

test('pagina cortada e lacuna de ledger sao ditas a parte, e a retomada que ja liberou volta agora', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, {
    retrato: retrato({ gaps: ['ledger.unavailable:ork-q', 'ledger.unavailable:ork-r', 'outra.lacuna'], proxima: 50 }),
    fila: [pedido('R8', 'ork-v', 'aguardando', T0 - 10 * MIN)],
  })
  await alerta($, relogio)
  const texto = await clima($)
  expect(texto).toContain('- R8 da ork-v volta agora, com ~1h30 de cota no ritmo atual.')
  expect(texto).toContain('- Os bloqueios vieram em mais de uma página; o Clima leu a primeira.')
  expect(texto).toContain('- O retrato não leu o ledger de 2 thread(s).')
})

test('quando o alerta passa, o que nao cabia sai da faixa, mesmo com a janela acima de 90%', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { fila: FILA })
  await alerta($, relogio)
  expect((await ponte($)).faixa['ork-clima']).toMatch(/^não cabe: ork-x; /)
  // 92% as 16:30: no ritmo da ultima hora (11 por hora) so acabaria depois de renovar, mas passa do limiar.
  await relogio.set(T0 + 150 * MIN)
  await medir($, cinco(92))
  expect((await ponte($)).faixa).toEqual({ 'ork-clima': `5 h com 90% ou mais, renova ${hora(RENOVA, T0 + 150 * MIN)}` })
})

test('sem a lista de threads abertas, as paradas nao sao conferidas nem listadas', { plugins: [PONTE_FALSA] }, async ($, on) => {
  fundo(on)
  nucleo(on, { retrato: retrato({ blockers: [bloqueio('ork-d', 'runtime.quota-exhausted')] }), abertas: null })
  const texto = await clima($)
  expect(texto).toContain('- Não deu para conferir as paradas (sem a lista de threads abertas: ork-ponte: ork thread list saiu 3: falhou).')
  expect(texto).not.toContain('ork-d')
  expect(texto).not.toContain('O que o núcleo já sabe fazer')
})

test('a fila inteira conta, e a ultima gravacao de cada retomada vence', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  nucleo(on, { fila: [
    pedido('R3', 'ork-x', 'aguardando', T0 + 150 * MIN),
    pedido('R70', 'ork-k', 'aguardando', T0 + 150 * MIN),
    pedido('R3', 'ork-x', 'cancelado', T0 + 150 * MIN),
  ] })
  await alerta($, relogio)
  expect((await ponte($)).faixa['ork-clima']).toMatch(/^não cabe: ork-k; /)
  const texto = await clima($)
  expect(texto).toContain('- R70 da ork-k volta')
  expect(texto).not.toContain('R3 da ork-x')
})

test('o registro do mostrado que falha fica pendente e vai na medicao seguinte, sem tirar o que nao cabe da faixa', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, logs } = fundo(on, { env: { ORK_TESTE_MOSTRADO_FALHAS: '1' } })
  nucleo(on, { fila: FILA })
  await alerta($, relogio)
  const agora = T0 + 30 * MIN
  const naFaixa = async () => (await mostrados($)).filter(m => m.chave === 'clima:nao-cabe:R3' && m.canal === 'faixa')
  expect(await naFaixa()).toEqual([])
  expect(await clima($)).toContain(`O registro do mostrado na ponte falhou (ork-ponte: o registro do mostrado falhou) às ${hora(agora, agora)}.`)
  // A medicao seguinte, mesmo sem leitura nova, registra a pendente; a faixa nao perde o que nao cabe.
  await relogio.set(T0 + 31 * MIN)
  await medir($, cinco(70), ['context'])
  expect((await ponte($)).faixa['ork-clima']).toMatch(/^não cabe: ork-x; 5 h com 70% ou mais/)
  expect(await naFaixa()).toEqual([
    { mod: 'ork-clima', canal: 'faixa', chave: 'clima:nao-cabe:R3', thread: 'ork-x', texto: `R3 da ork-x não cabe na janela de 5 h, que renova ${hora(RENOVA, agora)}.` },
  ])
  expect(await clima($)).not.toContain('O registro do mostrado na ponte falhou')
  await medir($, cinco(70), ['context'])
  expect(await naFaixa()).toHaveLength(1)
  expect(logs).toEqual([{ text: 'Clima de Cota: o registro do mostrado na ponte falhou (ork-ponte: o registro do mostrado falhou). O /clima mostra o que ficou guardado.', to: 'transcript' }])
})

test('o que nao cabe so vai ao registro quando a faixa o mostrou', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on, { env: { ORK_TESTE_RECUSAR_FAIXA: '1' } })
  nucleo(on, { fila: FILA })
  await alerta($, relogio)
  const naFaixa = async () => (await mostrados($)).filter(m => m.chave === 'clima:nao-cabe:R3' && m.canal === 'faixa')
  expect((await ponte($)).faixa).toEqual({})
  expect(await naFaixa()).toEqual([])
  await medir($, cinco(70), ['context'])
  expect((await ponte($)).faixa['ork-clima']).toMatch(/^não cabe: ork-x; /)
  expect(await naFaixa()).toHaveLength(1)
})

test('a retomada nova que nao cabe vai ao registro sem repetir a que ja tinha ido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio } = fundo(on)
  const dados = { fila: [pedido('R3', 'ork-x', 'aguardando', T0 + 150 * MIN)] }
  nucleo(on, dados)
  await alerta($, relogio)
  dados.fila = [...dados.fila, pedido('R7', 'ork-k', 'aguardando', T0 + 160 * MIN)]
  await relogio.set(T0 + 34.5 * MIN)
  await medir($, cinco(71.5))
  expect((await ponte($)).faixa['ork-clima']).toMatch(/^não cabe: ork-x, ork-k; /)
  const chaves = (await mostrados($)).filter(m => m.canal === 'faixa' && typeof m.chave === 'string').map(m => m.chave)
  expect(chaves).toEqual(['clima:nao-cabe:R3', 'clima:nao-cabe:R7'])
})
