import { test, expect, mock } from 'claude-code/testing'
import {
  ambiente, claim, comInicio, comLote, disco, editar, estado, iniciar, ler, lote, nucleo, nucleoDeConferencia, passou, PLUGINS,
  quebrou, RAIZ, respostaDe, semVeredito,
} from './apoio'
import type { RespostaDoProcesso } from './apoio'

// A conferencia do Freio (T2.3): a claim afetada vai ao nucleo por `ork claims conferir`, em segundo plano, e o
// que voltou chega ao modelo no lote seguinte. O comando da claim nunca roda no processo do mod.
const COMANDO = 'node --test dist/x.test.js'
const CLAIMS = [claim('C1', 'src/lote.ts', COMANDO), claim('C2', 'src/b.ts', 'test -s src/b.ts')]

async function preparar($, on, respostas: RespostaDoProcesso[], claims: unknown[] = CLAIMS) {
  const relogio = mock.clock(on, { now: 1000 })
  ambiente(on)
  comInicio(on)
  const status = comLote(on)
  nucleo(on, { claims, plano: null })
  const d = disco(on)
  const pedidos = nucleoDeConferencia(on, relogio, respostas)
  await iniciar($)
  await relogio.settle()
  const mexer = (rel: string, n: number) => { d.sujos[rel] = { xy: '.M', size: n, mtimeMs: n } }
  return { relogio, d, pedidos, status, mexer }
}

test('a claim que a conferencia reprova volta no lote seguinte com o id, o comando e o fim da saida', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, pedidos, status, mexer } = await preparar($, on, [respostaDe([quebrou('C1', COMANDO, 'linha 1\nnot ok 3 - soma\nfim', 'src/lote.ts')])])
  mexer('src/lote.ts', 1)
  expect((await lote($, editar('src/lote.ts'))).additionalContext).toBeUndefined()
  await relogio.settle()
  expect(pedidos).toEqual([{ argv: ['ork', 'claims', 'conferir', 'ork-exemplo', '--claims', 'C1', '--prazo', '180', '--json'], cwd: RAIZ }])
  const r = await lote($, ler('src/lote.ts'))
  expect(r.additionalContext.length).toBe(1)
  const texto = r.additionalContext[0]
  expect(texto).toMatch(/^Freio de Lote: a conferencia do nucleo reprovou 1 claim ligada ao que voce mexeu/)
  expect(texto).toContain('- C1 (src/lote.ts): alegacao de C1')
  expect(texto).toContain(`  comando: ${COMANDO}`)
  expect(texto).toContain('  saiu com codigo 1; fim da saida:')
  expect(texto).toContain('  | not ok 3 - soma')
  expect(texto).toContain('passar no ork verify, que continua sendo quem verifica')
  expect(status[status.length - 1]).toBe('freio: 1 claim em risco (C1)')
  expect((await lote($, ler('src/lote.ts'))).additionalContext).toBeUndefined()
})

test('a claim que passa na conferencia nao gera texto e a linha de status fica vazia', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, pedidos, status, mexer } = await preparar($, on, [respostaDe([passou('C1')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect(pedidos.length).toBe(1)
  expect(await lote($, ler('src/lote.ts'))).toEqual({})
  expect(status[status.length - 1]).toBeUndefined()
})

test('a claim em risco que volta a passar e devolvida como recuperada', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, mexer } = await preparar($, on, [respostaDe([quebrou('C1', COMANDO, 'x')]), respostaDe([passou('C1')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect((await lote($, ler('src/lote.ts'))).additionalContext[0]).toMatch(/reprovou 1 claim/)
  mexer('src/lote.ts', 2)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect((await lote($, ler('src/lote.ts'))).additionalContext).toEqual(['Freio de Lote: C1 voltou a passar na conferencia do nucleo.'])
  expect((await estado($, 'vigia')).emRisco).toEqual([])
})

test('resultado velho nao e entregue: a claim tocada de novo durante a rodada volta para a fila e roda outra vez', { plugins: PLUGINS }, async ($, on) => {
  const lenta = { ...respostaDe([quebrou('C1', COMANDO, 'estado velho')]), espera: 5000 }
  const { relogio, pedidos, mexer } = await preparar($, on, [lenta, respostaDe([passou('C1')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect(pedidos.length).toBe(1)
  mexer('src/lote.ts', 2)
  await lote($, editar('src/lote.ts'))
  expect(pedidos.length).toBe(1)
  await relogio.advance(5000)
  expect(pedidos.length).toBe(2)
  expect(await lote($, ler('src/lote.ts'))).toEqual({})
  expect((await estado($, 'vigia')).emRisco).toEqual([])
})

test('conferencia indisponivel (saida 2 com erro) avisa uma vez, aparece na linha de status e pausa 10 min', { plugins: PLUGINS }, async ($, on) => {
  const erro = 'claims.conferir.sandbox-indisponivel: codex ausente; a conferencia so roda confinada, sem fallback'
  const indisponivel = { stdout: JSON.stringify({ formato: 'ork.claims-conferencia/v1', thread: 'ork-exemplo', ok: false, erro }), code: 2 }
  const { relogio, pedidos, status, mexer } = await preparar($, on, [indisponivel, respostaDe([passou('C1')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  const r = await lote($, ler('src/lote.ts'))
  expect(r.additionalContext).toEqual([`Freio de Lote: a conferencia das claims esta indisponivel nesta sessao (${erro}). O Freio segue sem conferir; o ork verify continua valendo.`])
  expect(status[status.length - 1]).toBe('freio: conferencia indisponivel')
  mexer('src/lote.ts', 2)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect(pedidos.length).toBe(1)
  expect(await lote($, ler('src/lote.ts'))).toEqual({})
  await relogio.advance(600000)
  mexer('src/lote.ts', 3)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect(pedidos.length).toBe(2)
  expect(await lote($, ler('src/lote.ts'))).toEqual({})
  expect(status[status.length - 1]).toBeUndefined()
})

test('ork antigo sem claims conferir: a saida sem o JSON vira indisponivel com a ultima linha do erro', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, mexer } = await preparar($, on, [{ stdout: '', stderr: 'uso: ork <comando>\ncomando desconhecido: claims conferir\n', code: 2 }])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  const texto = (await lote($, ler('src/lote.ts'))).additionalContext[0]
  expect(texto).toContain('indisponivel nesta sessao (ork claims conferir sem resultado: comando desconhecido: claims conferir)')
})

test('processo que nao abre vira conferencia indisponivel, sem derrubar o lote', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, mexer } = await preparar($, on, [{ naoAbre: 'spawn ork ENOENT' }])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  const texto = (await lote($, ler('src/lote.ts'))).additionalContext[0]
  expect(texto).toContain('indisponivel nesta sessao (ork claims conferir nao rodou: ')
  expect((await estado($, 'vigia')).fila).toEqual([])
})

test('sem veredito no nucleo vira uma linha so, sem fim da saida', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, mexer } = await preparar($, on, [respostaDe([semVeredito('C1')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect((await lote($, ler('src/lote.ts'))).additionalContext).toEqual(['Freio de Lote: a conferencia de C1 terminou sem veredito (verify.timeout); o ork verify decide.'])
})

test('o vigia de 240 s encerra a conferencia presa: as claims ficam sem veredito e o laco segue', { plugins: PLUGINS }, async ($, on) => {
  const presa = { ...respostaDe([quebrou('C1', COMANDO, 'x')]), espera: 1000000000 }
  const { relogio, pedidos, mexer } = await preparar($, on, [presa, respostaDe([passou('C1')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  await relogio.advance(240000)
  expect((await lote($, ler('src/lote.ts'))).additionalContext).toEqual(['Freio de Lote: a conferencia de C1 terminou sem veredito (prazo do Freio); o ork verify decide.'])
  mexer('src/lote.ts', 2)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect(pedidos.length).toBe(2)
})

test('uma conferencia por vez, com no maximo 6 claims por rodada, as mais novas primeiro', { plugins: PLUGINS }, async ($, on) => {
  const oito = [1, 2, 3, 4, 5, 6, 7, 8].map(n => claim(`C${n}`, 'src/lote.ts', 'true'))
  const primeira = { ...respostaDe(['C8', 'C7', 'C6', 'C5', 'C4', 'C3'].map(passou)), espera: 1000 }
  const { relogio, pedidos, mexer } = await preparar($, on, [primeira, respostaDe(['C2', 'C1'].map(passou))], oito)
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  expect(pedidos.map(p => p.argv[5])).toEqual(['C8,C7,C6,C5,C4,C3'])
  await relogio.advance(1000)
  expect(pedidos.map(p => p.argv[5])).toEqual(['C8,C7,C6,C5,C4,C3', 'C2,C1'])
})

test('o comando da claim nunca roda no processo do mod: so o git status e o ork claims conferir', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, d, pedidos, mexer } = await preparar($, on, [respostaDe([quebrou('C1', COMANDO, 'x')])])
  mexer('src/lote.ts', 1)
  await lote($, editar('src/lote.ts'))
  await relogio.settle()
  await lote($, ler('src/lote.ts'))
  expect(d.argv.every(a => a[0] === 'git' && a[1] === 'status')).toBe(true)
  expect(pedidos.every(p => p.argv.slice(0, 3).join(' ') === 'ork claims conferir')).toBe(true)
  const tudo = [...d.argv, ...pedidos.map(p => p.argv)].map(a => a.join(' ')).join('\n')
  expect(tudo).not.toContain(COMANDO)
  expect(tudo).not.toContain('node')
})
