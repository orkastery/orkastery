import { test, expect } from 'claude-code/testing'
import { concluir, conferencia, criar, nascer, ocioso, PLUGINS, preparar, processos, quadro, TETOS, THREAD, time } from './apoio'

// O teammate ocioso (T10.3): com os tetos do piloto na sessão, o Portão entrega ao teammate a próxima tarefa do plano
// cuja região está livre: nenhum lease `path:` ativo de nenhuma thread a cruza (lidos de todas as threads pelo
// `ork maestro --json`, página a página) e ela não cruza as tarefas dos outros teammates. O Portão nunca pede lease: o
// `ork_git_commit` toma o lease de cada arquivo na hora do commit. E os tetos do piloto no nascimento de teammate (D10).

const MAESTRO = ['ork', 'maestro', '--json', '--section', 'leases', '--offset', '0']

test('teammate ocioso recebe a primeira tarefa livre do plano, sem pedir lease nenhum', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status } = preparar(on, { extra: TETOS })
  const { maestro, leases } = processos(on, relogio)
  time(on, { custo: 1 })
  const r = await ocioso($, 'ana')
  expect(r.block).toMatch(/^Portão de Tarefas: ana, pegue a tarefa T1 do plano \(Tarefa completa\)\./)
  expect(r.block).toContain('  touch_paths: src/a.ts, docs')
  expect(r.block).toContain('  verify: npm test')
  expect(r.block).toContain('confira o quadro (TaskList)')
  expect(r.block).toContain('nenhum lease path: ativo cruzava essa região')
  expect(maestro).toEqual([MAESTRO])
  expect(leases).toEqual([])
  expect((await quadro($)).atribuicoes).toEqual({ ana: 'T1' })
  expect(status[status.length - 1]).toBe('portão: T1 com ana')
})

test('teammate ocioso com o lease da proxima tarefa ocupado por outra thread nao a recebe e recebe a seguinte livre', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  const { leases } = processos(on, relogio, { leasesAtivos: [{ nome: 'path:src/a.ts', thread: 'ork-outra' }] })
  time(on)
  const r = await ocioso($, 'ana')
  expect(r.block).toMatch(/pegue a tarefa T5 do plano \(Outra completa\)/)
  expect(leases).toEqual([])
  expect((await quadro($)).atribuicoes).toEqual({ ana: 'T5' })
})

test('sem tarefa livre o teammate fica ocioso e nenhum lease e pedido', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  const { leases } = processos(on, relogio, {
    leasesAtivos: [{ nome: 'path:src/**', thread: 'ork-outra' }, { nome: 'path:docs/x.md', thread: 'ork-outra' }],
  })
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(leases).toEqual([])
  expect(await quadro($)).toBeNull()
})

test('lease vencido nao conta; o lease path: ativo da propria thread tambem barra a regiao, porque barra o commit', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  processos(on, relogio, {
    leasesAtivos: [
      { nome: 'path:src/a.ts', thread: 'ork-outra', status: 'expired' }, { nome: 'path:src/e/x.ts', thread: THREAD },
      { nome: `exec:${THREAD}`, thread: THREAD }, { nome: 'board:src/a.ts', thread: 'ork-outra' },
    ],
  })
  time(on)
  expect((await ocioso($, 'ana')).block).toContain('pegue a tarefa T1')
  expect((await ocioso($, 'bia'))).toEqual({})
})

test('os leases de todas as paginas do retrato contam', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  const { maestro } = processos(on, relogio, {
    pagina: 1,
    leasesAtivos: [{ nome: 'service:5173', thread: 'ork-outra' }, { nome: 'path:docs', thread: 'ork-outra' }, { nome: 'path:src/e/**', thread: 'ork-outra' }],
  })
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(maestro.map(a => a[6])).toEqual(['0', '1', '2'])
})

test('retrato dos leases indisponivel: o teammate fica ocioso e a falha e anotada', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status, logs } = preparar(on, { extra: TETOS })
  processos(on, relogio, { maestroIndisponivel: true })
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(status[status.length - 1]).toBe('portão: falhou em leitura dos leases')
  expect(logs.some(l => l.includes('a seção leases veio indisponível'))).toBe(true)
  expect((await quadro($)).ultimaFalha.onde).toBe('leitura dos leases')
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

test('dois teammates ociosos ao mesmo tempo nao recebem regioes que se cruzam', { plugins: PLUGINS }, async ($, on) => {
  const plano = [
    '### T1 A', '- **touch_paths:** `src/a.ts`', '- **verify:** `true`',
    '### T2 Cruza A', '- **touch_paths:** `src/**`', '- **verify:** `true`',
    '### T3 Livre', '- **touch_paths:** `docs/b.md`', '- **verify:** `true`',
  ].join('\n')
  const { relogio } = preparar(on, { extra: TETOS, plano })
  processos(on, relogio, { esperaDoMaestro: 2000 })
  time(on, { custo: 1 })
  const a = ocioso($, 'ana')
  await relogio.settle()
  await relogio.advance(100)
  const b = ocioso($, 'bia')
  await relogio.settle()
  await relogio.advance(5000)
  const entregues = [(await a).block, (await b).block].map(t => /pegue a tarefa (T\d)/.exec(t)?.[1]).sort()
  expect(entregues).toEqual(['T1', 'T3'])
  expect(Object.values((await quadro($)).atribuicoes).sort()).toEqual(['T1', 'T3'])
})

test('conclusao aprovada e criacao registrada no meio do teammate ocioso nao se perdem do quadro', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS })
  processos(on, relogio, { conferencias: [conferencia('T5', 'aprovada')], esperaDoMaestro: 2000 })
  time(on, { custo: 1 })
  const idle = ocioso($, 'ana')
  await relogio.settle()
  expect(await criar($, '42', 'T5 Outra completa')).toEqual({})
  expect(await concluir($, '42', 'T5 Outra completa')).toEqual({})
  await relogio.advance(5000)
  expect((await idle).block).toContain('pegue a tarefa T1')
  const q = await quadro($)
  expect(q.tarefas).toEqual({ 42: 'T5' })
  expect(q.concluidas).toEqual(['T5'])
  expect(q.atribuicoes).toEqual({ ana: 'T1' })
})

test('no teto de custo do piloto nenhuma tarefa nova vai ao time', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status } = preparar(on, { extra: TETOS })
  const { maestro } = processos(on, relogio)
  time(on, { custo: 10 })
  expect(await ocioso($, 'ana')).toEqual({})
  expect(maestro).toEqual([])
  expect(status[status.length - 1]).toBe('portão: teto de custo do piloto (US$ 10) atingido')
})

test('sem os tetos do nucleo no ambiente o teammate ocioso nao recebe tarefa', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  const { maestro } = processos(on, relogio)
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(maestro).toEqual([])
})

test('no bloco sem GO o teammate ocioso fica ocioso', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { extra: TETOS, bloco: 'check' })
  const { maestro } = processos(on, relogio)
  time(on)
  expect(await ocioso($, 'ana')).toEqual({})
  expect(maestro).toEqual([])
})

test('teammate abaixo dos tetos nasce; os encerrados nao contam no teto', { plugins: PLUGINS }, async ($, on) => {
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

test('no teto de teammates vivos o teammate e recusado; subagente passa', { plugins: PLUGINS }, async ($, on) => {
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

test('quando o Portao nao consegue contar os teammates, o teammate e recusado', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { extra: TETOS })
  const nascidos = time(on, { custo: 1, quebrado: true })
  expect((await nascer($, 'caio')).deny).toMatch(/^Portão de Tarefas: teammate recusado\. O Portão não conseguiu conferir os tetos do piloto/)
  expect(nascidos).toEqual([])
})

test('na sessao de papel dono o Portao nao confere teammate', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { papel: 'dono' })
  const nascidos = time(on)
  expect((await nascer($, 'caio')).agentId).toBe('ag-1')
  expect(nascidos).toEqual(['caio'])
})
