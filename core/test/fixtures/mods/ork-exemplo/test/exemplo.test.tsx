import { test, expect } from 'claude-code/testing'

test('o SessionStart atravessa o mod sem mudar a resposta', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  const r = await $.classic.SessionStart({ source: 'startup' })
  expect(r).toEqual({})
})
