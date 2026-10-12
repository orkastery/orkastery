import { test, expect, mock } from 'claude-code/testing'
import { comDisco } from './apoio'

// A leitura do nucleo pela ponte, como outro mod do Orkastery a chama: retrato pelo `ork_maestro`,
// cache enquanto o `stat` dos ledgers nao muda, reserva pelo CLI e a lista fechada de consultas.
const P = { isFullscreen: false, columns: 100 }
const RAIZ = '/projeto'
const LEDGER = '/projeto/.orkastery/threads/ork-a/ledger.jsonl'
const SNAPSHOT = {
  schema: 'ork.maestro-snapshot/v1', observedAt: '2026-01-01T00:00:00.000Z', gaps: [],
  sections: { threads: { state: 'available', source: 's', observedAt: '2026-01-01T00:00:00.000Z', gaps: [],
    items: [{ id: 'ork-a', title: 'A', status: 'GO', refs: [], facts: {} }] } },
}

const LEITOR = {
  name: 'ork-sonda-nucleo',
  register(on) {
    on('command.run', { command: 'retrato' }, async ($, e) => {
      try {
        const r = await $.ork.retrato(e.args ? JSON.parse(e.args) : undefined)
        return { text: JSON.stringify({ fonte: r.fonte, schema: r.retrato.schema }) }
      } catch (erro) {
        return { text: JSON.stringify({ erro: String((erro && erro.message) || erro) }) }
      }
    })
    on('command.run', { command: 'ler' }, async ($, e) => {
      try {
        return { text: JSON.stringify({ valor: await $.ork.ler(JSON.parse(e.args)) }) }
      } catch (erro) {
        return { text: JSON.stringify({ erro: String((erro && erro.message) || erro) }) }
      }
    })
  },
}

async function rodar($, command, args) {
  const r = await $.command.run({ command, args: args === undefined ? '' : JSON.stringify(args), origin: { kind: 'composer' }, presentation: P })
  return JSON.parse(r.text)
}

function projeto(on, stat) {
  on('session.root', () => ({ value: RAIZ + '/.claude/worktrees/ork-a' }))
  on('fs.exists', ($, e) => ({ value: e.path === RAIZ + '/orkastery.yaml' || e.path === RAIZ + '/.orkastery' }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: stat.tamanho, mtimeMs: stat.mtimeMs, isLink: false } }))
}

test('retrato pelo MCP, do cache enquanto o ledger nao muda, e de novo quando muda', { plugins: [LEITOR] }, async ($, on) => {
  comDisco(on)
  const relogio = mock.clock(on, { now: 1000 })
  const stat = { tamanho: 10, mtimeMs: 5 }
  projeto(on, stat)
  const pedidos = []
  on('mcp.call', ($2, e) => {
    pedidos.push(e)
    return { value: { content: [{ type: 'text', text: JSON.stringify(SNAPSHOT) }], isError: false } }
  })
  expect(await rodar($, 'retrato', { secao: 'threads' })).toEqual({ fonte: 'mcp', schema: 'ork.maestro-snapshot/v1' })
  expect(pedidos[0]).toEqual({ server: 'orkastery', tool: 'ork_maestro', args: { section: 'threads', offset: 0 } })
  await relogio.advance(1000)
  expect((await rodar($, 'retrato', { secao: 'threads' })).fonte).toBe('cache')
  stat.mtimeMs = 6
  expect((await rodar($, 'retrato', { secao: 'threads' })).fonte).toBe('mcp')
  expect(pedidos.length).toBe(2)
})

test('o cache vence pelo teto de 60 s mesmo sem mudanca no ledger', { plugins: [LEITOR] }, async ($, on) => {
  comDisco(on)
  const relogio = mock.clock(on, { now: 1000 })
  projeto(on, { tamanho: 1, mtimeMs: 1 })
  let chamadas = 0
  on('mcp.call', () => { chamadas++; return { value: { content: [{ type: 'text', text: JSON.stringify(SNAPSHOT) }], isError: false } } })
  await rodar($, 'retrato', { thread: 'ork-a' })
  await relogio.advance(61000)
  expect((await rodar($, 'retrato', { thread: 'ork-a' })).fonte).toBe('mcp')
  expect(chamadas).toBe(2)
})

test('sem o MCP, o retrato cai na consulta maestro do CLI com teto de 10 s', { plugins: [LEITOR] }, async ($, on) => {
  comDisco(on)
  mock.clock(on, { now: 1000 })
  projeto(on, { tamanho: 1, mtimeMs: 1 })
  on('mcp.call', () => ({ value: { content: [], isError: true } }))
  const rodados = []
  on('process.run', ($2, e) => {
    rodados.push(e)
    return { value: { exitCode: 0, stdout: JSON.stringify(SNAPSHOT), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  expect(await rodar($, 'retrato', { secao: 'hitl', thread: 'ork-a' })).toEqual({ fonte: 'cli', schema: 'ork.maestro-snapshot/v1' })
  const maestro = rodados.find(r => r.argv[1] === 'maestro')
  expect(maestro.argv).toEqual(['ork', 'maestro', '--json', '--thread', 'ork-a', '--section', 'hitl', '--offset', '0'])
  expect(maestro.init.timeoutMs).toBe(10000)
})

test('pedido de retrato invalido e recusado antes de qualquer leitura', { plugins: [LEITOR] }, async ($, on) => {
  comDisco(on)
  let leu = false
  on('mcp.call', () => { leu = true; return { value: { content: [], isError: true } } })
  expect((await rodar($, 'retrato', { secao: 'tudo' })).erro).toMatch(/secao desconhecida/)
  expect((await rodar($, 'retrato', { offset: 3 })).erro).toMatch(/offset so vale com secao/)
  expect((await rodar($, 'retrato', { thread: '../x' })).erro).toMatch(/id de thread invalido/)
  expect(leu).toBe(false)
})

test('ler roda so a lista fechada, com a thread no lugar certo', { plugins: [LEITOR] }, async ($, on) => {
  comDisco(on)
  const rodados = []
  on('process.run', ($2, e) => {
    rodados.push(e.argv)
    return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  expect(await rodar($, 'ler', { consulta: 'thread.status', thread: 'ork-a' })).toEqual({ valor: { ok: true } })
  expect(rodados[0]).toEqual(['ork', 'thread', 'status', 'ork-a', '--json'])
  expect((await rodar($, 'ler', { consulta: 'gate.answer' })).erro).toMatch(/fora da lista fechada/)
  expect((await rodar($, 'ler', { consulta: 'constructor' })).erro).toMatch(/fora da lista fechada/)
  expect((await rodar($, 'ler', { consulta: 'retry.plan' })).erro).toMatch(/exige thread/)
  expect(rodados.length).toBe(1)
})

test('consulta que sai diferente de zero vira erro com o fim do stderr', { plugins: [LEITOR] }, async ($, on) => {
  comDisco(on)
  on('process.run', () => ({ value: { exitCode: 3, stdout: '', stderr: 'linha 1\nconducao.em-andamento', isStdoutTruncated: false, isStderrTruncated: false } }))
  expect((await rodar($, 'ler', { consulta: 'pulse' })).erro).toMatch(/ork pulse --json saiu 3: linha 1 conducao.em-andamento/)
})
