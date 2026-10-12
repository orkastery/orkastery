import { test, expect, mock } from 'claude-code/testing'

// A faixa, os caminhos vigiados e o registro do que foi mostrado, pelo `$.ork` como outro mod o chama.
const P = { isFullscreen: false, columns: 100 }
const DONO = 'mcp__orkastery__ork_request_decision'
const FAIXA = (bodyColumns, extra) => ({
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {}, ...extra },
})

const MODS = {
  name: 'ork-sonda-faixa',
  register(on) {
    const responder = async (fazer) => {
      try {
        return { text: JSON.stringify({ valor: (await fazer()) ?? null }) }
      } catch (erro) {
        return { text: JSON.stringify({ erro: String((erro && erro.message) || erro) }) }
      }
    }
    on('command.run', { command: 'faixa' }, async ($, e) => responder(() => $.ork.faixa(JSON.parse(e.args))))
    on('command.run', { command: 'vigiar' }, async ($, e) => responder(() => $.ork.vigiar(JSON.parse(e.args))))
    on('command.run', { command: 'mostrado' }, async ($, e) => responder(() => $.ork.mostrado(JSON.parse(e.args))))
    on('command.run', { command: 'mostrados' }, async $ => responder(() => $.ork.mostrados()))
  },
}

async function ponte($, metodo, pedido) {
  const r = await $.command.run({ command: metodo, args: JSON.stringify(pedido ?? null), origin: { kind: 'composer' }, presentation: P })
  return JSON.parse(r.text)
}

function sessao(on, { papel, ledgers = {} }) {
  mock.env(on, papel === 'fase' ? { ORK_DISPATCH_ID: 'd-1', ORK_DISPATCH_THREAD: 'ork-a' } : {})
  on('session.root', () => ({ value: papel === 'dono' ? '/p' : '/p/.claude/worktrees/ork-a' }))
  on('fs.exists', ($, e) => ({ value: papel !== 'dormente' && (e.path === '/p/orkastery.yaml' || e.path === '/p/.orkastery') }))
  on('tool.list', () => ({ value: [{ name: DONO, description: '', mcp: true }] }))
  on('fs.list', () => ({ value: Object.keys(ledgers).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.stat', ($, e) => {
    const id = Object.keys(ledgers).find(t => e.path === `/p/.orkastery/threads/${t}/ledger.jsonl`)
    if (id === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: 1, mtimeMs: ledgers[id], isLink: false } }
  })
}

test('a faixa desenha uma linha por mod, em ordem de nome, cortada a largura', { plugins: [MODS] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  sessao(on, { papel: 'fase' })
  expect((await ponte($, 'faixa', { mod: 'ork-torre', texto: '3 threads andando, 1 parada' })).valor).toEqual({ publicada: true })
  await ponte($, 'faixa', { mod: 'ork-clima', texto: 'cota de 5 h em 82%' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ork-ponte', surface, ...FAIXA(25, {}) })
    const linhas = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(linhas).toEqual(['clima: cota de 5 h em 82%', 'torre: 3 threads andando…'])
    await ui.unmount()
  }
})

test('sem linha publicada, ou com pesquisa na faixa, a faixa fica com quem esta abaixo', { plugins: [MODS] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  sessao(on, { papel: 'fase' })
  on('ui.render', { component: 'AbovePrompt' }, ($2, e) => {
    const { Text } = $2.ui.resolve(e)
    return <Text>fundo</Text>
  })
  let ui = await $.ui.mount({ plugin: 'ork-ponte', surface: 'terminal', ...FAIXA(80, {}) })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['fundo'])
  await ui.unmount()
  await ponte($, 'faixa', { mod: 'ork-torre', texto: 'x' })
  ui = await $.ui.mount({ plugin: 'ork-ponte', surface: 'terminal', ...FAIXA(80, { hasSurvey: true }) })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['fundo'])
  await ui.unmount()
  await ponte($, 'faixa', { mod: 'ork-torre' })
  ui = await $.ui.mount({ plugin: 'ork-ponte', surface: 'terminal', ...FAIXA(80, {}) })
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['fundo'])
  await ui.unmount()
})

test('na fase, o watchPaths junta o de baixo, o ledger da thread e os pedidos, e o pedido tardio vale no proximo inicio', { plugins: [MODS] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  sessao(on, { papel: 'fase' })
  on('classic.SessionStart', () => ({ watchPaths: ['/outro/a', '/p/.orkastery/threads/ork-a/ledger.jsonl'] }))
  expect((await ponte($, 'vigiar', { mod: 'ork-freio', caminhos: ['/p/plano.json', '/p/plano.json'] })).valor)
    .toEqual({ caminhos: ['/p/plano.json'], valeNoProximoInicio: false })
  const r = await $.classic.SessionStart({ source: 'startup' })
  expect(r.watchPaths).toEqual(['/outro/a', '/p/.orkastery/threads/ork-a/ledger.jsonl', '/p/plano.json'])
  expect((await ponte($, 'vigiar', { mod: 'ork-freio', caminhos: ['/p/b.json'] })).valor.valeNoProximoInicio).toBe(true)
})

test('no dono, o watchPaths leva a pasta das threads e os ledgers mais recentes', { plugins: [MODS] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  sessao(on, { papel: 'dono', ledgers: { 'ork-velha': 10, 'ork-nova': 30, 'ork-meio': 20 } })
  on('classic.SessionStart', () => ({}))
  const r = await $.classic.SessionStart({ source: 'startup' })
  expect(r.watchPaths).toEqual(['/p/.orkastery/threads', '/p/.orkastery/threads/ork-nova/ledger.jsonl',
    '/p/.orkastery/threads/ork-meio/ledger.jsonl', '/p/.orkastery/threads/ork-velha/ledger.jsonl'])
})

test('fora do Orkastery a ponte nao mexe no watchPaths', { plugins: [MODS] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  sessao(on, { papel: 'dormente' })
  on('classic.SessionStart', () => ({ watchPaths: ['/outro/a'] }))
  await ponte($, 'vigiar', { mod: 'ork-freio', caminhos: ['/p/plano.json'] })
  expect((await $.classic.SessionStart({ source: 'startup' })).watchPaths).toEqual(['/outro/a'])
})

test('pedido de caminho relativo, com .. ou de mod sem nome valido e recusado', { plugins: [MODS] }, async ($, on) => {
  mock.store(on)
  expect((await ponte($, 'vigiar', { mod: 'ork-freio', caminhos: ['plano.json'] })).erro).toMatch(/absoluto/)
  expect((await ponte($, 'vigiar', { mod: 'ork-freio', caminhos: ['/p/../etc'] })).erro).toMatch(/absoluto/)
  expect((await ponte($, 'vigiar', { mod: 'Ork Freio', caminhos: [] })).erro).toMatch(/nome de mod invalido/)
  expect((await ponte($, 'faixa', { mod: '../x', texto: 'oi' })).erro).toMatch(/nome de mod invalido/)
})

test('na sessao do dono, o que a faixa publica e o que o mod declara entram no registro do mostrado', { plugins: [MODS] }, async ($, on) => {
  const relogio = mock.clock(on, { now: Date.UTC(2026, 0, 1) })
  mock.store(on)
  sessao(on, { papel: 'dono' })
  await ponte($, 'faixa', { mod: 'ork-mesa', texto: '2 decisoes esperam voce' })
  await relogio.advance(60000)
  await ponte($, 'faixa', { mod: 'ork-mesa', texto: '2 decisoes esperam voce' })
  await ponte($, 'mostrado', { mod: 'ork-mesa', canal: 'painel', chave: 'hitl:p1', thread: 'ork-a', texto: 'gate do SHIP' })
  expect((await ponte($, 'mostrado', { mod: 'ork-mesa', canal: 'telegram', texto: 'x' })).erro).toMatch(/canal desconhecido/)
  const { valor } = await ponte($, 'mostrados', undefined)
  expect(valor.formato).toBe('ork.mod-mostrado/v1')
  expect(valor.itens.length).toBe(2)
  expect(valor.itens[0]).toEqual({ mod: 'ork-mesa', canal: 'faixa', chave: null, thread: null, texto: '2 decisoes esperam voce',
    primeiraVez: '2026-01-01T00:00:00.000Z', ultimaVez: '2026-01-01T00:01:00.000Z', vezes: 2 })
  expect(valor.itens[1].chave).toBe('hitl:p1')
})

test('na sessao de fase, a faixa nao entra no registro do mostrado', { plugins: [MODS] }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  sessao(on, { papel: 'fase' })
  await ponte($, 'faixa', { mod: 'ork-freio', texto: 'freio: 2 claims em risco' })
  expect((await ponte($, 'mostrados', undefined)).valor.itens).toEqual([])
})
