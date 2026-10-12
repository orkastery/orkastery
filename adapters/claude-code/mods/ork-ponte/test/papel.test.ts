import { test, expect, mock } from 'claude-code/testing'

// O papel da sessao pelo `$.ork`, como outro mod do Orkastery o chama.
const P = { isFullscreen: false, columns: 100 }
const DONO = 'mcp__orkastery__ork_request_decision'

const LEITOR = {
  name: 'ork-sonda-papel',
  register(on) {
    on('command.run', { command: 'contexto' }, async $ => {
      const contexto = await $.ork.contexto()
      const papel = await $.ork.papel()
      return { text: JSON.stringify({ ...contexto, papelDireto: papel }) }
    })
  },
}

async function contexto($) {
  const r = await $.command.run({ command: 'contexto', args: '', origin: { kind: 'composer' }, presentation: P })
  return JSON.parse(r.text)
}

function raizDoProjeto(on, temManifesto, ferramentas) {
  on('session.root', () => ({ value: '/projeto' }))
  on('fs.exists', ($, e) => ({ value: temManifesto && e.path === '/projeto/orkastery.yaml' }))
  on('tool.list', () => ({ value: ferramentas.map(name => ({ name, description: '', mcp: name.startsWith('mcp__') })) }))
}

test('sessao despachada pelo nucleo e fase, com a thread do despacho', { plugins: [LEITOR] }, async ($, on) => {
  mock.env(on, { ORK_DISPATCH_ID: 'd-1', ORK_DISPATCH_THREAD: 'ork-exemplo' })
  raizDoProjeto(on, true, [DONO])
  const c = await contexto($)
  expect(c).toEqual({ papel: 'fase', thread: 'ork-exemplo', raiz: '/projeto', papelDireto: 'fase' })
})

test('sem despacho, com orkastery.yaml e o servidor sem thread, e dono', { plugins: [LEITOR] }, async ($, on) => {
  mock.env(on, {})
  raizDoProjeto(on, true, ['Bash', DONO])
  const c = await contexto($)
  expect(c.papel).toBe('dono')
  expect(c.thread).toBe(null)
})

test('servidor preso a thread (sem ork_request_decision) nao faz dono', { plugins: [LEITOR] }, async ($, on) => {
  mock.env(on, {})
  raizDoProjeto(on, true, ['Bash', 'mcp__orkastery__ork_thread_status'])
  expect((await contexto($)).papel).toBe('dormente')
})

test('fora de um projeto do Orkastery e dormente', { plugins: [LEITOR] }, async ($, on) => {
  mock.env(on, {})
  raizDoProjeto(on, false, [DONO])
  expect((await contexto($)).papel).toBe('dormente')
})

test('thread do despacho com id invalido fica nula', { plugins: [LEITOR] }, async ($, on) => {
  mock.env(on, { ORK_DISPATCH_ID: 'd-2', ORK_DISPATCH_THREAD: '../fora' })
  raizDoProjeto(on, true, [])
  const c = await contexto($)
  expect(c.papel).toBe('fase')
  expect(c.thread).toBe(null)
})
