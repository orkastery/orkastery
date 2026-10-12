import { test, expect } from 'claude-code/testing'
import { concluir, conferencia, nascer, ocioso, PLUGINS, preparar, processos, quadro, RAIZ, TETOS, THREAD, time } from './apoio'

// O teammate ocioso (T10.3): com os tetos do piloto na sessão, o Portão entrega ao teammate a próxima tarefa do plano
// cuja região está livre (sem lease ativo de outra thread, sem tarefa de outro teammate) e toma os leases `path:` pelo
// `ork lease acquire`. E os tetos do piloto no nascimento de teammate (D10).

const acquire = (nome: string, teammate: string, tarefa: string) =>
  ['ork', 'lease', 'acquire', nome, '--thread', THREAD, '--motivo', `ork-portao: ${tarefa} com ${teammate}`]

test('teammate ocioso recebe a primeira tarefa livre do plano, com os leases tomados pelo ork lease acquire', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status } = preparar(on, { extra: TETOS })
  const { leases } = processos(on, relogio)
  time(on, { custo: 1 })
  const r = await ocioso($, 'ana')
  expect(r.block).toMatch(/^Portão de Tarefas: ana, pegue a tarefa T1 do plano \(Tarefa completa\)\./)
  expect(r.block).toContain('  touch_paths: src/a.ts, docs')
  expect(r.block).toContain('  verify: npm test')
  expect(r.block).toContain('confira o quadro (TaskList)')
  expect(leases).toEqual([
    { argv: acquire('path:src/a.ts', 'ana', 'T1'), cwd: RAIZ, timeoutMs: 10000 },
    { argv: acquire('path:docs', 'ana', 'T1'), cwd: RAIZ, timeoutMs: 10000 },
  ])
  const q = await quadro($)
  expect(q.atribuicoes).toEqual({ ana: 'T1' })
  expect(Object.keys(q.leases).sort()).toEqual(['path:docs', 'path:src/a.ts'])
  expect(status[status.length - 1]).toBe('portão: T1 com ana')
})

test('teammate ocioso com o lease da proxima tarefa ocupado por outra thread nao a recebe e recebe a seguinte livre', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS, leases: [{ nome: 'path:src/a.ts', thread: 'ork-outra' }] })
  const { leases } = processos(on, relogio)
  time(on)
  const r = await ocioso($, 'ana')
  expect(r.block).toMatch(/pegue a tarefa T5 do plano \(Outra completa\)/)
  expect(leases.map(l => l.argv[3])).toEqual(['path:src/e/**'])
  expect((await quadro($)).atribuicoes).toEqual({ ana: 'T5' })
})

test('sem tarefa livre o teammate fica ocioso e nenhum lease e pedido', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS, leases: [{ nome: 'path:src/**', thread: 'ork-outra' }, { nome: 'path:docs/x.md', thread: 'ork-outra' }] })
  const { leases } = processos(on, relogio)
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(leases).toEqual([])
})

test('lease expirado de outra thread nao conta, e o da propria thread nao e pedido de novo', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, {
    extra: TETOS,
    leases: [{ nome: 'path:src/a.ts', thread: 'ork-outra', status: 'expired' }, { nome: 'path:docs', thread: THREAD }],
  })
  const { leases } = processos(on, relogio)
  time(on)
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T1')
  expect(leases.map(l => l.argv[3])).toEqual(['path:src/a.ts'])
})

test('lease que outra thread toma no meio: o Portao solta o que tomou e entrega a tarefa seguinte', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  const { leases } = processos(on, relogio, { leases: { 'path:docs': 1 } })
  time(on)
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T5')
  expect(leases.map(l => `${l.argv[2]} ${l.argv[3]}`)).toEqual([
    'acquire path:src/a.ts', 'acquire path:docs', 'release path:src/a.ts', 'acquire path:src/e/**',
  ])
  expect(Object.keys((await quadro($)).leases)).toEqual(['path:src/e/**'])
})

test('tarefa com outro teammate nao e entregue de novo, nem a que cruza a regiao dela', { plugins: PLUGINS }, async ($, on) => {
  const plano = [
    '### T1 A', '- **touch_paths:** `src/a.ts`', '- **verify:** `true`',
    '### T2 Cruza A', '- **touch_paths:** `src/**`', '- **verify:** `true`',
    '### T3 Livre', '- **touch_paths:** `docs/b.md`', '- **verify:** `true`',
  ].join('\n')
  const { relogio } = preparar(on, { extra: TETOS, plano })
  processos(on, relogio)
  time(on)
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T1')
  expect((await ocioso($, 'bia')).block).toContain('pegue a tarefa T3')
  expect(await ocioso($, 'caio')).toEqual({})
  expect((await quadro($)).atribuicoes).toEqual({ ana: 'T1', bia: 'T3' })
})

test('teammate que fica ocioso sem concluir devolve a tarefa: ela sai da distribuicao e ele recebe outra', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  processos(on, relogio)
  time(on)
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T1')
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T5')
  const q = await quadro($)
  expect(q.devolvidas).toEqual(['T1'])
  expect(q.atribuicoes).toEqual({ ana: 'T5' })
})

test('tarefa concluida com a conferencia aprovada nao volta a ser entregue', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  processos(on, relogio, { conferencias: [conferencia('T1', 'aprovada')] })
  time(on)
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T1')
  expect(await concluir($, '1', 'T1 Tarefa completa', 'ana')).toEqual({})
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T5')
  expect((await quadro($)).devolvidas).toEqual([])
})

test('no teto de custo do piloto nenhuma tarefa nova vai ao time', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status } = preparar(on, { extra: TETOS })
  const { leases } = processos(on, relogio)
  time(on, { custo: 10 })
  expect(await ocioso($, 'ana')).toEqual({})
  expect(leases).toEqual([])
  expect(status[status.length - 1]).toBe('portão: teto de custo do piloto (US$ 10) atingido')
})

test('sem os tetos do nucleo no ambiente o teammate ocioso nao recebe tarefa', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  const { leases } = processos(on, relogio)
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(leases).toEqual([])
})

test('no bloco sem GO o teammate ocioso fica ocioso', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS, bloco: 'check' })
  const { leases } = processos(on, relogio)
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(leases).toEqual([])
})

test('teammate abaixo dos tetos nasce; no teto de teammates vivos e recusado; os encerrados nao contam', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { extra: TETOS })
  const nascidos = time(on, {
    custo: 1,
    agentes: [
      { id: 'a1', teammateId: 'ana@time', status: 'running' }, { id: 'a2', teammateId: 'bia@time', status: 'completed' },
      { id: 'a3', status: 'running' },
    ],
  })
  expect((await nascer($, 'caio')).agentId).toBe('ag-1')
  expect(nascidos).toEqual(['caio'])
})

test('no teto de teammates vivos, sem os tetos do nucleo ou no teto de custo, o teammate e recusado; subagente passa', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { extra: TETOS })
  const nascidos = time(on, { custo: 1, agentes: [{ id: 'a1', teammateId: 'ana@time', status: 'idle' }, { id: 'a2', teammateId: 'bia@time', status: 'running' }] })
  const r = await nascer($, 'caio')
  expect(r.deny).toBe('Portão de Tarefas: teammate recusado. A sessão já tem 2 teammate(s) vivo(s), e o teto do piloto é 2.')
  expect((await nascer($, 'explorador', false)).agentId).toBe('ag-1')
  expect(nascidos).toEqual(['explorador'])
})

test('sem os tetos do nucleo o teammate e recusado na sessao de fase', { plugins: PLUGINS }, async ($, on) => {
  preparar(on)
  time(on)
  expect((await nascer($, 'caio')).deny).toContain('agent teams só rodam no piloto do núcleo')
})

test('com o custo da sessao no teto o teammate e recusado', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { extra: TETOS })
  time(on, { custo: 12.5 })
  expect((await nascer($, 'caio')).deny).toBe('Portão de Tarefas: teammate recusado. O custo da sessão (US$ 12.50) chegou ao teto do piloto (US$ 10.00).')
})

test('na sessao de papel dono o Portao nao confere teammate', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { papel: 'dono' })
  const nascidos = time(on)
  expect((await nascer($, 'caio')).agentId).toBe('ag-1')
  expect(nascidos).toEqual(['caio'])
})
