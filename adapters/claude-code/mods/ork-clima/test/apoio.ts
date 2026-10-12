import { mock } from 'claude-code/testing'
import { formatarHora } from '../hooks/previsao'

// Apoio dos testes do kit do Clima. O kit nao carrega `dependencies` nem importa arquivo de fora da pasta do
// mod, e o plugin inline do teste roda serializado, sem as variaveis deste arquivo: a ponte falsa e
// autocontida. Ela segue o contrato do `$.ork` da `ork-ponte` (um objeto por metodo) e o comportamento da real
// no que o Clima usa: o papel vem do `env.get` (`ORK_TESTE_PAPEL`); o retrato vem do `ork_maestro` e, na falha,
// da consulta `maestro` do CLI; `ler` roda a consulta da lista fechada pelo `process.run`, com as mesmas
// mensagens de erro; a faixa corta o texto em 200 caracteres, desenha uma linha por mod (`rotulo: texto`) e, na
// sessao do dono, entra no registro do mostrado. O que ela guardou sai pelos comandos `ponte-falsa` e
// `ponte-falsa-mostrados`.
export const PONTE_FALSA = {
  name: 'ork-ponte',
  register(on) {
    const FAIXA = { plugin: 'ork-ponte', key: 'faixa' }
    const PUBLICACOES = { plugin: 'ork-ponte', key: 'publicacoes' }
    const MOSTRADOS = { plugin: 'ork-ponte', key: 'mostrados' }
    const CONSULTAS = {
      'retry.list': ['ork', 'retry', 'list', '--json'],
      'thread.list': ['ork', 'thread', 'list', '--json'],
      'accounts.esgotamentos': ['ork', 'accounts', 'esgotamentos', '--json'],
    }
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const papel = async () => (await built.env.get('ORK_TESTE_PAPEL')) ?? 'dono'
      const mostrar = async item => {
        const atual = await built.state.get(MOSTRADOS)
        await built.state.set(MOSTRADOS, [...(atual.value ?? []), item], { ifVersion: atual.version })
      }
      const cli = async argv => {
        const r = await built.process.run(argv, { timeoutMs: 10000 })
        if (r.exitCode !== 0) {
          const fim = r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)
          throw new Error(`ork-ponte: ${argv.slice(0, 3).join(' ')} saiu ${r.exitCode}${fim ? `: ${fim}` : ''}`)
        }
        return JSON.parse(r.stdout)
      }
      const ork = {
        papel: async () => papel(),
        contexto: async () => ({ papel: await papel(), thread: null, raiz: '/projeto' }),
        retrato: async () => {
          let retrato
          let fonte = 'mcp'
          try {
            const r = await built.mcp.call('orkastery', 'ork_maestro', {})
            const texto = (r.content ?? []).find(c => c.type === 'text')?.text
            if (r.isError || texto === undefined) throw new Error('ork-ponte: o ork_maestro respondeu com erro')
            retrato = JSON.parse(texto)
          } catch {
            retrato = await cli(['ork', 'maestro', '--json'])
            fonte = 'cli'
          }
          return { fonte, lidoEm: await built.clock.now(), retrato }
        },
        ler: async ({ consulta }) => {
          if (!(consulta in CONSULTAS)) throw new Error(`ork-ponte: consulta fora da lista fechada: ${consulta}`)
          return cli(CONSULTAS[consulta])
        },
        faixa: async ({ mod, texto }) => {
          const limpo = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
          const atual = await built.state.get(FAIXA)
          const linhas = { ...(atual.value ?? {}) }
          if (limpo !== '') linhas[mod] = limpo
          else delete linhas[mod]
          await built.state.set(FAIXA, linhas, { ifVersion: atual.version })
          const vezes = await built.state.get(PUBLICACOES)
          await built.state.set(PUBLICACOES, (vezes.value ?? 0) + 1, { ifVersion: vezes.version })
          const publicada = mod in linhas
          if (publicada && (await papel()) === 'dono') await mostrar({ mod, canal: 'faixa', texto: limpo })
          return { publicada }
        },
        mostrado: async pedido => mostrar(pedido),
      }
      return { ...built, ork }
    })
    on('command.run', { command: 'ponte-falsa' }, async $ => ({
      text: JSON.stringify({ faixa: (await $.state.get(FAIXA)).value ?? {}, publicacoes: (await $.state.get(PUBLICACOES)).value ?? 0 }),
    }))
    on('command.run', { command: 'ponte-falsa-mostrados' }, async $ => ({ text: JSON.stringify((await $.state.get(MOSTRADOS)).value ?? []) }))
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { value = {} } = await $.state.get(FAIXA)
      const linhas = Object.keys(value).sort().map(mod => `${mod.startsWith('ork-') ? mod.slice(4) : mod}: ${value[mod]}`)
      if (linhas.length === 0) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return h(Box, { flexDirection: 'column' }, ...linhas.map((linha, i) => h(Text, { key: `ork-faixa-${i}`, dimColor: true }, linha)))
    })
  },
}

export const MIN = 60 * 1000
export const HORA = 60 * MIN
/** 12/10/2026 17:00 UTC (14:00 em Brasilia). */
export const T0 = Date.UTC(2026, 9, 12, 17, 0)
/** O fuso que o Clima usa nesta sessao de teste (D6); o formato exato e conferido no teste do nucleo. */
export const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
export const P = { isFullscreen: false, columns: 100 }
const QUARTO = 15 * MIN

export const iso = (ms: number) => new Date(ms).toISOString()
export const hora = (ms: number, agora: number) => formatarHora(ms, FUSO, agora)
/** A hora de acabar como a faixa mostra: arredondada ao quarto de hora (D13). */
export const horaNaFaixa = (ms: number, agora: number) => formatarHora(Math.round(ms / QUARTO) * QUARTO, FUSO, agora)

/**
 * O que o motor responde embaixo dos plugins numa sessao de teste: relogio, store e ambiente em memoria,
 * o registro de comandos, o inicio da sessao e a medicao. `papel` muda o papel que a ponte falsa le.
 */
export function fundo(on, opcoes: { agora?: number; store?: Record<string, unknown>; papel?: () => string | undefined } = {}) {
  const relogio = mock.clock(on, { now: opcoes.agora ?? T0 })
  mock.store(on, opcoes.store)
  on('env.get', ($, e) => ({ value: e.name === 'ORK_TESTE_PAPEL' && opcoes.papel ? opcoes.papel() : undefined }))
  const comandos: string[] = []
  on('command.register', ($, e) => {
    comandos.push(e.name)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  return { relogio, comandos }
}

export async function iniciar($) {
  await $.session.start({ cwd: '/projeto', surface: 'terminal', isInteractive: true })
}

/** Uma medicao do motor com as janelas dadas; `changed` padrao diz que as janelas mudaram. */
export async function medir($, rateLimits, changed = ['rateLimits']) {
  await $.session.measure({ context: { contextWindow: 200000 }, rateLimits, changed })
}

export async function clima($) {
  return (await $.command.run({ command: 'clima', args: '', origin: { kind: 'composer' }, presentation: P })).text
}

export async function ponte($) {
  return JSON.parse((await $.command.run({ command: 'ponte-falsa', args: '', origin: { kind: 'composer' }, presentation: P })).text)
}

export async function mostrados($) {
  return JSON.parse((await $.command.run({ command: 'ponte-falsa-mostrados', args: '', origin: { kind: 'composer' }, presentation: P })).text)
}

/** As linhas que a faixa mostra numa superficie. */
export async function faixaEm($, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({
    plugin: 'ork-ponte', surface, component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  const linhas = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return linhas
}

/** O retrato `ork.maestro-snapshot/v1` minimo, com os bloqueios dados. */
export function retrato(opcoes: { blockers?: unknown[]; gaps?: string[]; proxima?: number | null } = {}) {
  const items = opcoes.blockers ?? []
  const blockers = {
    state: (opcoes.gaps ?? []).length ? 'unavailable' : items.length ? 'available' : 'empty', source: 'ork.blockers',
    observedAt: iso(T0), fingerprint: null, items, gaps: opcoes.gaps ?? [],
    coverage: { total: null, offset: 0, returned: items.length, omitted: null, nextOffset: opcoes.proxima ?? null, limit: 50 },
  }
  return { schema: 'ork.maestro-snapshot/v1', observedAt: iso(T0), gaps: [], conflicts: [], sections: { blockers } }
}

/** Um pedido da fila de retomada como `ork retry list --json` devolve. */
export const pedido = (id: string, thread: string, estado: string, liberaEm: number) =>
  ({ id, thread, fase: 'GO', slug: `${thread}-go`, liberaEm: iso(liberaEm), janelaEstimada: false, tentativas: 1, estado,
    criadoEm: iso(T0), atualizadoEm: iso(T0), detalhe: 'limite de uso' })

/** Um bloqueio (ultimo gate reprovado) como o retrato projeta. */
export const bloqueio = (thread: string, motivo: string) =>
  ({ id: `gate:${thread}`, title: motivo, status: 'blocked', refs: [{ kind: 'thread', id: thread }], facts: { reason: motivo } })

/** O relatorio `ork.esgotamentos/v1` com as marcas dadas. */
export const relatorio = (marcas: unknown[]) =>
  ({ contrato: 'ork.esgotamentos/v1', periodo: {}, marcas, projetos: [], despachos: [], total: 0, limite: 'x' })

/** A lista `ork thread list --json` com as threads abertas dadas. */
export const abertas = (ids: string[]) => ({ todas: false, total: ids.length, threads: ids.map(id => ({ id, status: 'aberta' })) })

/**
 * O nucleo embaixo da ponte falsa: o `ork_maestro` e a consulta `maestro` respondem o retrato, e as consultas
 * da lista fechada respondem a fila, as threads abertas e o registro. `null` faz a leitura falhar com saida 3.
 * Devolve quantas vezes cada uma foi lida.
 */
export function nucleo(on, dados: { retrato?: unknown; fila?: unknown; abertas?: unknown; relatorio?: unknown } = {}) {
  const lidos = { retrato: 0, fila: 0, abertas: 0, registro: 0 }
  const saida = (valor: unknown) => (valor === null
    ? { value: { exitCode: 3, stdout: '', stderr: 'falhou', isStdoutTruncated: false, isStderrTruncated: false } }
    : { value: { exitCode: 0, stdout: JSON.stringify(valor), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('mcp.call', () => {
    lidos.retrato++
    if (dados.retrato === null) return { value: { content: [], isError: true } }
    return { value: { content: [{ type: 'text', text: JSON.stringify(dados.retrato ?? retrato()) }], isError: false } }
  })
  on('process.run', ($, e) => {
    const consulta = e.argv.slice(1, 3).join(' ')
    if (consulta === 'maestro --json') return saida(dados.retrato === undefined ? retrato() : dados.retrato)
    if (consulta === 'retry list') { lidos.fila++; return saida(dados.fila === undefined ? [] : dados.fila) }
    if (consulta === 'thread list') { lidos.abertas++; return saida(dados.abertas === undefined ? abertas([]) : dados.abertas) }
    if (consulta === 'accounts esgotamentos') { lidos.registro++; return saida(dados.relatorio === undefined ? relatorio([]) : dados.relatorio) }
    return saida(null)
  })
  return lidos
}
