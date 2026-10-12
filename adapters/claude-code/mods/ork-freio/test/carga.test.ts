import { test, expect, mock } from 'claude-code/testing'
import { ambiente, claim, comInicio, estado, iniciar, nucleo, PLUGINS, THREAD } from './apoio'

// A carga do Freio (T2.1): no inicio da sessao de fase, o estado da thread pelo retrato da ponte e as claims e o
// plano pelas duas ferramentas de leitura do nucleo, fora do inicio (por `$.clock.after`) e sem disco.
const CLAIMS = [
  claim('C1', 'src/a.ts', 'node --test dist/a.test.js'),
  claim('C2', 'src/velho.ts', 'grep -c x src/velho.ts', 'retirada'),
  claim('C3', 'docs/b.md', 'test -s docs/b.md'),
]

test('na sessao de fase a carga le o retrato, as claims e o plano, so pelas duas ferramentas de leitura', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 5000 })
  ambiente(on)
  comInicio(on)
  const pedidos = nucleo(on, { claims: CLAIMS })
  await iniciar($)
  await relogio.settle()
  expect(pedidos).toEqual([
    { server: 'orkastery', tool: 'ork_claims_list', args: { threadId: THREAD } },
    { server: 'orkastery', tool: 'ork_artifact_read', args: { threadId: THREAD, tipo: 'plan' } },
  ])
  const carga = await estado($, 'carga')
  expect(carga.thread).toBe(THREAD)
  expect(carga.statusDaThread).toBe('aberta')
  expect(carga.claims).toEqual([
    { id: 'C1', arquivo: 'src/a.ts', comandos: ['node --test dist/a.test.js'] },
    { id: 'C3', arquivo: 'docs/b.md', comandos: ['test -s docs/b.md'] },
  ])
  expect(carga.claimsEm).toBe(5000)
  expect(carga.touchPaths).toEqual(['docs', 'src/a.ts', 'src/b/**'])
  expect(carga.planoLido).toBe(true)
  expect(carga.erros).toEqual([])
})

test('o inicio da sessao nao espera a carga: ela so roda quando o relogio anda', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 0 })
  ambiente(on)
  comInicio(on)
  const pedidos = nucleo(on, { claims: CLAIMS })
  await iniciar($)
  expect(pedidos.length).toBe(0)
  await relogio.settle()
  expect(pedidos.length).toBe(2)
})

for (const papel of ['dono', 'dormente'] as const) {
  test(`na sessao de papel ${papel} o Freio fica dormente: nada e lido nem guardado`, { plugins: PLUGINS }, async ($, on) => {
    const relogio = mock.clock(on, { now: 0 })
    ambiente(on, { papel })
    comInicio(on)
    const pedidos = nucleo(on, { claims: CLAIMS })
    await iniciar($)
    await relogio.settle()
    expect(pedidos).toEqual([])
    expect(await estado($, 'carga')).toBeNull()
  })
}

test('com o MCP fora do ar, a carga guarda o erro e o inicio da sessao segue', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 0 })
  ambiente(on)
  comInicio(on)
  nucleo(on, { erroClaims: true, erroPlano: true })
  expect(await iniciar($)).toEqual({ cwd: '/projeto/.claude/worktrees/ork-exemplo' })
  await relogio.settle()
  const carga = await estado($, 'carga')
  expect(carga.claims).toBeNull()
  expect(carga.planoLido).toBe(false)
  expect(carga.erros.length).toBe(2)
  expect(carga.erros[0]).toMatch(/^claims: ork-freio: ork_claims_list respondeu com erro/)
  expect(carga.erros[1]).toMatch(/^plano: ork-freio: ork_artifact_read respondeu com erro/)
})

test('sem o retrato, a carga das claims e do plano segue e o erro fica anotado', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 0 })
  ambiente(on, { status: 'sem-retrato' })
  comInicio(on)
  nucleo(on, { claims: CLAIMS })
  await iniciar($)
  await relogio.settle()
  const carga = await estado($, 'carga')
  expect(carga.statusDaThread).toBeNull()
  expect(carga.claims.length).toBe(2)
  expect(carga.erros).toEqual(['retrato: ork-ponte: o ork_maestro respondeu com erro'])
})

test('a thread fechada no retrato fica anotada na carga', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 0 })
  ambiente(on, { status: 'fechada' })
  comInicio(on)
  nucleo(on, { claims: CLAIMS })
  await iniciar($)
  await relogio.settle()
  expect((await estado($, 'carga')).statusDaThread).toBe('fechada')
})

test('plano ausente: a carga marca o plano como lido e sem touch_paths', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 0 })
  ambiente(on)
  comInicio(on)
  nucleo(on, { claims: CLAIMS, plano: null })
  await iniciar($)
  await relogio.settle()
  const carga = await estado($, 'carga')
  expect(carga.planoLido).toBe(true)
  expect(carga.touchPaths).toBeNull()
})

test('o inicio de novo (reload) refaz a leitura e a carga fica igual, sem duplicar', { plugins: PLUGINS }, async ($, on) => {
  const relogio = mock.clock(on, { now: 0 })
  ambiente(on)
  comInicio(on)
  const pedidos = nucleo(on, { claims: CLAIMS })
  await iniciar($)
  await relogio.settle()
  const primeira = await estado($, 'carga')
  await iniciar($)
  await relogio.settle()
  expect(pedidos.length).toBe(4)
  expect(await estado($, 'carga')).toEqual(primeira)
})
