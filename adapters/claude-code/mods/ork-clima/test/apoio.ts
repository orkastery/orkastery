import { mock } from 'claude-code/testing'
import { formatarHora } from '../hooks/previsao'

// Apoio dos testes do kit do Clima. O kit nao carrega `dependencies` nem importa arquivo de fora da pasta do
// mod, e o plugin inline do teste roda serializado, sem as variaveis deste arquivo: a ponte falsa e
// autocontida. Ela segue o contrato do `$.ork` da `ork-ponte` (um objeto por metodo) e recebe tudo de baixo,
// pelo teste: o papel por `env.get` (`ORK_TESTE_PAPEL`), o retrato por `mcp.call` no `ork_maestro` e a consulta
// da lista fechada por `process.run`, como a ponte real le. Desenha a faixa como a ponte desenha, uma linha por
// mod (`rotulo: texto`), e devolve o que guardou pelos comandos `ponte-falsa` e `ponte-falsa-mostrados`.
export const PONTE_FALSA = {
  name: 'ork-ponte',
  register(on) {
    const FAIXA = { plugin: 'ork-ponte', key: 'faixa' }
    const PUBLICACOES = { plugin: 'ork-ponte', key: 'publicacoes' }
    const MOSTRADOS = { plugin: 'ork-ponte', key: 'mostrados' }
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const papel = async () => (await built.env.get('ORK_TESTE_PAPEL')) ?? 'dono'
      const ork = {
        papel: async () => papel(),
        contexto: async () => ({ papel: await papel(), thread: null, raiz: '/projeto' }),
        faixa: async ({ mod, texto }) => {
          const atual = await built.state.get(FAIXA)
          const linhas = { ...(atual.value ?? {}) }
          if (typeof texto === 'string' && texto.trim() !== '') linhas[mod] = texto
          else delete linhas[mod]
          await built.state.set(FAIXA, linhas, { ifVersion: atual.version })
          const vezes = await built.state.get(PUBLICACOES)
          await built.state.set(PUBLICACOES, (vezes.value ?? 0) + 1, { ifVersion: vezes.version })
          return { publicada: mod in linhas }
        },
        retrato: async () => {
          const r = await built.mcp.call('orkastery', 'ork_maestro', {})
          const textoDoRetrato = (r.content ?? []).find(c => c.type === 'text')?.text
          if (r.isError || textoDoRetrato === undefined) throw new Error('ork-ponte: o ork_maestro respondeu com erro')
          return { fonte: 'mcp', lidoEm: await built.clock.now(), retrato: JSON.parse(textoDoRetrato) }
        },
        ler: async ({ consulta }) => {
          if (consulta !== 'accounts.esgotamentos') throw new Error(`ork-ponte: consulta fora da lista fechada: ${consulta}`)
          const r = await built.process.run(['ork', 'accounts', 'esgotamentos', '--json'], { timeoutMs: 10000 })
          if (r.exitCode !== 0) throw new Error(`ork-ponte: ork accounts esgotamentos saiu ${r.exitCode}`)
          return JSON.parse(r.stdout)
        },
        mostrado: async pedido => {
          const atual = await built.state.get(MOSTRADOS)
          await built.state.set(MOSTRADOS, [...(atual.value ?? []), pedido], { ifVersion: atual.version })
        },
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

export const iso = (ms: number) => new Date(ms).toISOString()
export const hora = (ms: number, agora: number) => formatarHora(ms, FUSO, agora)

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

export async function mostrados($) {
  return JSON.parse((await $.command.run({ command: 'ponte-falsa-mostrados', args: '', origin: { kind: 'composer' }, presentation: P })).text)
}

/** O retrato `ork.maestro-snapshot/v1` minimo, com a fila de retomada e os bloqueios dados. */
export function retrato(opcoes: { retries?: unknown[]; blockers?: unknown[]; estado?: string } = {}) {
  const secao = (items: unknown[] = [], estado = items.length ? 'available' : 'empty') => ({
    state: estado, source: 'ork.teste', observedAt: iso(T0), fingerprint: null, items, gaps: [],
    coverage: { total: items.length, offset: 0, returned: items.length, omitted: 0, nextOffset: null, limit: 50 },
  })
  return {
    schema: 'ork.maestro-snapshot/v1', observedAt: iso(T0), gaps: [], conflicts: [],
    sections: { retries: secao(opcoes.retries, opcoes.estado), blockers: secao(opcoes.blockers) },
  }
}

/** Uma retomada da fila como o retrato projeta. */
export const retomada = (id: string, thread: string, status: string, liberaEm: number) =>
  ({ id, title: 'Retomada', status, refs: [{ kind: 'thread', id: thread }], facts: { availableAt: iso(liberaEm), attempts: 1 } })

/** Um bloqueio (ultimo gate reprovado) como o retrato projeta. */
export const bloqueio = (thread: string, motivo: string) =>
  ({ id: `gate:${thread}`, title: motivo, status: 'blocked', refs: [{ kind: 'thread', id: thread }], facts: { reason: motivo } })

/** O relatorio `ork.esgotamentos/v1` com as marcas dadas. */
export const relatorio = (marcas: unknown[]) =>
  ({ contrato: 'ork.esgotamentos/v1', periodo: {}, marcas, projetos: [], despachos: [], total: 0, limite: 'x' })

/**
 * O nucleo embaixo da ponte falsa: o `ork_maestro` responde o retrato e a consulta do registro responde o
 * relatorio; `null` faz a leitura falhar. Devolve quantas vezes cada um foi lido.
 */
export function nucleo(on, dados: { retrato?: unknown; relatorio?: unknown }) {
  const lidos = { retrato: 0, registro: 0 }
  on('mcp.call', ($, e) => {
    lidos.retrato++
    if (dados.retrato === null) return { value: { content: [], isError: true } }
    return { value: { content: [{ type: 'text', text: JSON.stringify(dados.retrato ?? retrato()) }], isError: false } }
  })
  on('process.run', ($, e) => {
    lidos.registro++
    if (dados.relatorio === null) return { value: { exitCode: 3, stdout: '', stderr: 'falhou', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: JSON.stringify(dados.relatorio ?? relatorio([])), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return lidos
}
