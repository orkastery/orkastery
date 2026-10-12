import { test, expect, mock } from 'claude-code/testing'
import { ambiente, bash, claim, comInicio, comLote, disco, editar, estado, iniciar, ler, lote, nucleo, PLUGINS } from './apoio'
import type { Sujo } from './apoio'

// O lote do Freio (T2.2): os arquivos tocados (entradas de escrita e diferenca do `git status` entre lotes),
// as claims afetadas na fila (pelo arquivo, pelo caminho no comando e pelo nome-base) e o aviso de touch_paths.
const CLAIMS = [
  claim('C1', 'src/lote.ts', 'node --test dist/x.test.js'),
  claim('C2', 'docs/b.md', 'grep -c y src/lote.ts'),
  claim('C3', 'src/outro.md', 'node dist/lote.js'),
  claim('C4', 'src/nada.ts', 'test -f src/nada.ts'),
  claim('C5', 'src/b.ts', 'test -s src/b.ts'),
]

async function preparar($, on, opcoes: { claims?: unknown[]; sujos?: Record<string, Sujo>; plano?: string | null; papel?: 'dono' | 'fase'; status?: string } = {}) {
  const relogio = mock.clock(on, { now: 1000 })
  ambiente(on, { papel: opcoes.papel, status: opcoes.status })
  comInicio(on)
  comLote(on)
  const nuc = { claims: opcoes.claims ?? CLAIMS, plano: opcoes.plano }
  const pedidos = nucleo(on, nuc)
  const d = disco(on, { sujos: opcoes.sujos })
  await iniciar($)
  await relogio.settle()
  return { relogio, pedidos, d, nuc }
}

const fila = async $ => (await estado($, 'vigia')).fila

test('edicao por Edit num arquivo citado poe as claims na fila: pelo arquivo, pelo caminho no comando e pelo nome-base', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null })
  d.sujos['src/lote.ts'] = { xy: '.M', size: 10, mtimeMs: 2000 }
  const r = await lote($, editar('src/lote.ts'))
  expect(r.additionalContext).toBeUndefined()
  expect(await fila($)).toEqual([
    { id: 'C1', forca: 3, caminhos: ['src/lote.ts'] },
    { id: 'C2', forca: 2, caminhos: ['src/lote.ts'] },
    { id: 'C3', forca: 1, caminhos: ['src/lote.ts'] },
  ])
})

test('edicao feita por Bash entra pela diferenca do git status entre a foto do inicio e a do lote', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null })
  expect(d.status).toBe(1)
  d.sujos['src/b.ts'] = { xy: '.M', size: 5, mtimeMs: 3000 }
  await lote($, bash('sed -i s/a/b/ src/b.ts'))
  expect(await fila($)).toEqual([{ id: 'C5', forca: 3, caminhos: ['src/b.ts'] }])
})

test('a segunda edicao num arquivo ja sujo entra pelo stat; o lote que nao muda nada nao enfileira', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null, sujos: { 'src/b.ts': { xy: '.M', size: 5, mtimeMs: 3000 } } })
  await lote($, bash('true'))
  expect(await fila($)).toEqual([])
  d.sujos['src/b.ts'] = { xy: '.M', size: 5, mtimeMs: 4000 }
  await lote($, bash('echo x >> src/b.ts'))
  expect(await fila($)).toEqual([{ id: 'C5', forca: 3, caminhos: ['src/b.ts'] }])
})

test('lote so de leitura nao roda o git status nem enfileira', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null })
  d.sujos['src/b.ts'] = { xy: '.M', size: 5, mtimeMs: 3000 }
  const r = await lote($, ler('src/b.ts'), { tool_name: 'Grep', tool_input: { pattern: 'x' }, tool_use_id: 'g1' })
  expect(r).toEqual({})
  expect(d.status).toBe(1)
  expect(await fila($)).toEqual([])
})

test('lote sem claim afetada passa sem texto e sem fila', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null })
  d.sujos['src/sem-claim.ts'] = { xy: '??', size: 1, mtimeMs: 1 }
  const r = await lote($, editar('src/sem-claim.ts'))
  expect(r).toEqual({})
  expect(await fila($)).toEqual([])
})

test('lote fora dos touch_paths do plano avisa uma vez por caminho; dentro deles, nada', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on)
  d.sujos['src/fora.ts'] = { xy: '??', size: 1, mtimeMs: 1 }
  const r1 = await lote($, editar('src/fora.ts'))
  expect(r1.additionalContext).toEqual(['Freio de Lote: o lote mexeu fora dos touch_paths do plano: src/fora.ts.'])
  d.sujos['src/fora.ts'] = { xy: '??', size: 2, mtimeMs: 2 }
  expect((await lote($, editar('src/fora.ts'))).additionalContext).toBeUndefined()
  for (const dentro of ['src/a.ts', 'src/b/c/d.ts', 'docs/x.md']) {
    d.sujos[dentro] = { xy: '??', size: 1, mtimeMs: 1 }
    expect((await lote($, editar(dentro))).additionalContext).toBeUndefined()
  }
})

test('caminho que sai da lista com HEAD novo foi commitado e nao conta', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null, sujos: { 'src/lote.ts': { xy: '.M', size: 1, mtimeMs: 1 } } })
  d.head = 'b'.repeat(40)
  d.sujos = {}
  const r = await lote($, { tool_name: 'mcp__orkastery__ork_git_commit', tool_input: { threadId: 'ork-exemplo' }, tool_use_id: 'c1' })
  expect(r).toEqual({})
  expect(await fila($)).toEqual([])
})

test('caminho que sai da lista com o HEAD parado foi revertido e conta como tocado', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null, sujos: { 'src/lote.ts': { xy: '.M', size: 1, mtimeMs: 1 } } })
  d.sujos = {}
  await lote($, bash('git checkout -- src/lote.ts'))
  expect((await fila($)).map(p => p.id)).toEqual(['C1', 'C2', 'C3'])
})

test('o lote que registra claim rele as claims antes de casar; sem isso, a lista guardada vale ate a idade', { plugins: PLUGINS }, async ($, on) => {
  const { d, nuc, pedidos } = await preparar($, on, { plano: null, claims: [] })
  nuc.claims = [claim('C7', 'src/novo.ts', 'test -f src/novo.ts')]
  d.sujos['src/novo.ts'] = { xy: '??', size: 1, mtimeMs: 1 }
  await lote($, editar('src/novo.ts'))
  expect(await fila($)).toEqual([])
  d.sujos['src/novo.ts'] = { xy: '??', size: 2, mtimeMs: 2 }
  await lote($, { tool_name: 'mcp__orkastery__ork_claim_add', tool_input: { threadId: 'ork-exemplo' }, tool_use_id: 'a1' }, editar('src/novo.ts'))
  expect(await fila($)).toEqual([{ id: 'C7', forca: 3, caminhos: ['src/novo.ts'] }])
  expect(pedidos.filter(p => p.tool === 'ork_claims_list').length).toBe(2)
})

test('claims velhas so sao relidas quando ha caminho tocado para casar', { plugins: PLUGINS }, async ($, on) => {
  const { d, relogio, pedidos } = await preparar($, on, { plano: null })
  await relogio.advance(61000)
  await lote($, bash('true'))
  expect(pedidos.filter(p => p.tool === 'ork_claims_list').length).toBe(1)
  d.sujos['src/b.ts'] = { xy: '.M', size: 5, mtimeMs: 3000 }
  await lote($, bash('touch src/b.ts'))
  expect(pedidos.filter(p => p.tool === 'ork_claims_list').length).toBe(2)
})

test('com a thread fechada no retrato, o lote passa sem git status e sem fila', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null, status: 'fechada' })
  const antes = d.status
  d.sujos['src/lote.ts'] = { xy: '.M', size: 1, mtimeMs: 1 }
  expect(await lote($, editar('src/lote.ts'))).toEqual({})
  expect(d.status).toBe(antes)
  expect((await estado($, 'vigia')).fila).toEqual([])
})

test('fora da sessao de fase o lote passa intocado, sem git status', { plugins: PLUGINS }, async ($, on) => {
  const { d } = await preparar($, on, { plano: null, papel: 'dono' })
  d.sujos['src/lote.ts'] = { xy: '.M', size: 1, mtimeMs: 1 }
  expect(await lote($, editar('src/lote.ts'))).toEqual({})
  expect(d.status).toBe(0)
  expect(await estado($, 'vigia')).toBeNull()
})
