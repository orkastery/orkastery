import { test, expect } from 'claude-code/testing'
import { criar, PLUGINS, preparar, quadro, THREAD } from './apoio'

// O portão da criação (T10.1): na sessão de fase do GO, a tarefa nativa só entra no quadro apontando uma tarefa do
// plano com touch_paths e verify que o núcleo confere. A recusa volta ao modelo pelo `block`.

test('criacao sem touch_paths no plano devolve block com o motivo e as tarefas que servem', { plugins: PLUGINS }, async ($, on) => {
  const { pedidos } = preparar(on)
  const r = await criar($, '1', 'T2 Sem touch_paths')
  expect(r.block).toMatch(/^Portão de Tarefas: a tarefa "T2 Sem touch_paths" não entrou no quadro: a tarefa T2 do plano não tem touch_paths/)
  expect(r.block).toContain('Tarefas do plano que servem: T1 (Tarefa completa); T5 (Outra completa).')
  expect(r.block).toContain('ork claims conferir --tarefa')
  expect(pedidos).toEqual([{ server: 'orkastery', tool: 'ork_artifact_read', args: { threadId: THREAD, tipo: 'plan' } }])
  expect((await quadro($))).toBeNull()
})

test('criacao sem verify conferivel devolve block: sem linha de verify e verify com dois comandos', { plugins: PLUGINS }, async ($, on) => {
  preparar(on)
  const semVerify = await criar($, '1', 'T3 Sem verify')
  expect(semVerify.block).toContain('a tarefa T3 do plano não tem um verify que o núcleo confira (não há linha de verify)')
  const doisComandos = await criar($, '2', 'T4 dois comandos')
  expect(doisComandos.block).toContain('a tarefa T4 do plano não tem um verify que o núcleo confira (o verify tem mais de uma linha, mais de um comando ou texto além do comando)')
})

test('criacao de tarefa do plano completa passa e guarda o id nativo com a tarefa do plano', { plugins: PLUGINS }, async ($, on) => {
  preparar(on)
  expect(await criar($, '7', 'T1 Tarefa completa')).toEqual({})
  expect(await criar($, '8', '[T5] outra')).toEqual({})
  const q = await quadro($)
  expect(q.thread).toBe(THREAD)
  expect(q.tarefas).toEqual({ 7: 'T1', 8: 'T5' })
})

test('assunto sem id, com dois ids ou com tarefa fora do plano recusa', { plugins: PLUGINS }, async ($, on) => {
  preparar(on)
  expect((await criar($, '1', 'Rodar os testes')).block).toContain('o assunto não traz o id de uma tarefa do plano')
  expect((await criar($, '2', 'T1 e T5 juntas')).block).toContain('o assunto cita mais de uma tarefa do plano (T1, T5)')
  expect((await criar($, '3', 'T9 nova')).block).toContain('o plano não tem a tarefa T9')
})

test('o plano e lido uma vez e reaproveitado pela idade, e relido depois dela', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, pedidos } = preparar(on)
  await criar($, '1', 'T1 a')
  await criar($, '2', 'T5 b')
  expect(pedidos.length).toBe(1)
  await relogio.advance(60000)
  await criar($, '3', 'T1 c')
  expect(pedidos.length).toBe(2)
})

for (const papel of ['dono', 'dormente'] as const) {
  test(`na sessao de papel ${papel} o Portao fica dormente: a criacao passa sem leitura`, { plugins: PLUGINS }, async ($, on) => {
    const { pedidos } = preparar(on, { papel })
    expect(await criar($, '1', 'Qualquer coisa')).toEqual({})
    expect(pedidos).toEqual([])
  })
}

test('bloco sem o GO (so CHECK) deixa a criacao passar sem ler o plano', { plugins: PLUGINS }, async ($, on) => {
  const { pedidos } = preparar(on, { bloco: 'check' })
  expect(await criar($, '1', 'Revisar o diff')).toEqual({})
  expect(pedidos).toEqual([])
})

test('bloco com GO pelo slug de digitos (f345) mantem o portao', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { bloco: 'f345' })
  expect((await criar($, '1', 'Revisar o diff')).block).toContain('o assunto não traz o id de uma tarefa do plano')
})

test('thread fechada deixa a criacao passar', { plugins: PLUGINS }, async ($, on) => {
  const { pedidos } = preparar(on, { status: 'fechada' })
  expect(await criar($, '1', 'Qualquer coisa')).toEqual({})
  expect(pedidos).toEqual([])
})

test('sem plano (GOAL ainda) ou com plano sem tarefas T, a criacao passa', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { plano: null })
  expect(await criar($, '1', 'GOAL: explorar o repositorio')).toEqual({})
})

test('plano sem nenhuma tarefa T deixa a criacao passar', { plugins: PLUGINS }, async ($, on) => {
  preparar(on, { plano: '# PLAN\n\nSem tarefas numeradas.' })
  expect(await criar($, '1', 'Qualquer coisa')).toEqual({})
})

test('retrato indisponivel conta como bloco com GO: o portao confere e diz na linha de status', { plugins: PLUGINS }, async ($, on) => {
  const { status } = preparar(on, { status: 'sem-retrato' })
  expect((await criar($, '1', 'Sem id')).block).toContain('o assunto não traz o id')
  expect(status).toContain('portão: retrato indisponível; o Portão confere mesmo assim')
})

test('plano que o nucleo nao entrega vira falha anotada uma vez, e a criacao passa', { plugins: PLUGINS }, async ($, on) => {
  const { status, logs } = preparar(on, { erroPlano: true })
  expect(await criar($, '1', 'Qualquer coisa')).toEqual({})
  expect(await criar($, '2', 'Outra coisa')).toEqual({})
  expect(status[status.length - 1]).toBe('portão: falhou em leitura do plano')
  expect(logs.filter(l => l.startsWith('Portão de Tarefas: falhou em leitura do plano: ork-portao: ork_artifact_read respondeu com erro')).length).toBe(1)
})
