import { mock } from 'claude-code/testing'
import { formatarHora } from '../hooks/previsao'

// Apoio dos testes do kit do Clima. O kit nao carrega `dependencies` nem importa arquivo de fora da pasta do
// mod, e o plugin inline do teste roda serializado, sem as variaveis deste arquivo: a ponte falsa e
// autocontida. Ela segue o contrato do `$.ork` da `ork-ponte` (um objeto por metodo) e recebe o papel de
// baixo, pelo teste (`ORK_TESTE_PAPEL` no `env.get`). Desenha a faixa como a ponte desenha, uma linha por mod
// (`rotulo: texto`), e devolve o que guardou pelo comando `ponte-falsa`.
export const PONTE_FALSA = {
  name: 'ork-ponte',
  register(on) {
    const FAIXA = { plugin: 'ork-ponte', key: 'faixa' }
    const PUBLICACOES = { plugin: 'ork-ponte', key: 'publicacoes' }
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
      }
      return { ...built, ork }
    })
    on('command.run', { command: 'ponte-falsa' }, async $ => ({
      text: JSON.stringify({ faixa: (await $.state.get(FAIXA)).value ?? {}, publicacoes: (await $.state.get(PUBLICACOES)).value ?? 0 }),
    }))
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
