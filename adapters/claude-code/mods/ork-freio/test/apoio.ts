// Apoio dos testes do kit do Freio. O kit nao tem disco nem nucleo: a ponte chega por um plugin inline que
// acrescenta o `$.ork` com o mesmo contrato da ponte de verdade, e o nucleo chega pelos fundos de `mcp.call`.
// O kit roda o `register` de um plugin inline num ambiente proprio, sem as variaveis do arquivo de teste: a
// ponte falsa e a sonda sao autocontidas, e a ponte le o papel e o retrato pedidos do ambiente (`mock.env`).
import { mock } from 'claude-code/testing'

export const THREAD = 'ork-exemplo'
export const RAIZ = '/projeto/.claude/worktrees/ork-exemplo'

/** A ponte falsa: papel em `ORK_TESTE_PAPEL` (padrao `fase`), status da thread em `ORK_TESTE_STATUS`. */
export const PONTE = {
  name: 'ork-ponte',
  register(on) {
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const papel = async () => (await built.env.get('ORK_TESTE_PAPEL')) ?? 'fase'
      const ork = {
        papel: async () => papel(),
        contexto: async () => {
          const p = await papel()
          return { papel: p, thread: p === 'fase' ? 'ork-exemplo' : null, raiz: '/projeto/.claude/worktrees/ork-exemplo' }
        },
        retrato: async () => {
          const status = await built.env.get('ORK_TESTE_STATUS')
          if (status === 'sem-retrato') throw new Error('ork-ponte: o ork_maestro respondeu com erro')
          return {
            fonte: 'mcp', lidoEm: 0,
            retrato: {
              schema: 'ork.maestro-snapshot/v1', observedAt: '2026-01-01T00:00:00.000Z', gaps: [],
              sections: { threads: { state: 'available', source: 's', observedAt: '2026-01-01T00:00:00.000Z', gaps: [],
                items: [{ id: 'ork-exemplo', title: 'exemplo', status: status ?? 'aberta', refs: [], facts: { phase: 'GO' } }] } },
            },
          }
        },
        ler: async () => ({}),
        faixa: async () => ({ publicada: false }),
        vigiar: async () => ({ caminhos: [], valeNoProximoInicio: false }),
        mostrado: async () => undefined,
        mostrados: async () => ({ formato: 'ork.mod-mostrado/v1', itens: [] }),
      }
      return { ...built, ork }
    })
  },
}

/** A sonda que le o estado do Freio por comando (o `$` do teste nao tem `state`). */
export const SONDA = {
  name: 'ork-sonda-freio',
  register(on) {
    on('command.run', { command: 'freio-carga' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'ork-freio', key: 'carga' })).value ?? null) }))
    on('command.run', { command: 'freio-vigia' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'ork-freio', key: 'vigia' })).value ?? null) }))
  },
}

export const PLUGINS = [PONTE, SONDA]

/** O estado do Freio, lido pela sonda. */
export async function estado($, chave: 'carga' | 'vigia') {
  const r = await $.command.run({ command: `freio-${chave}`, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  return JSON.parse(r.text)
}

/** O ambiente que a ponte falsa le: papel e status da thread no retrato. */
export function ambiente(on, opcoes: { papel?: 'dono' | 'fase' | 'dormente'; status?: string } = {}) {
  mock.env(on, { ...(opcoes.papel ? { ORK_TESTE_PAPEL: opcoes.papel } : {}), ...(opcoes.status ? { ORK_TESTE_STATUS: opcoes.status } : {}) })
}

/** Uma claim como o `ork_claims_list` devolve. */
export function claim(id: string, arquivo: string, comando: string, estado = 'pendente') {
  return { id, thread: THREAD, fase: 'GO', arquivo, alegacao: `alegacao de ${id}`, negativa: false, verificar: [comando], criadoEm: '', estado }
}

export const PLANO = [
  '### T1 Uma tarefa',
  '',
  '- **touch_paths:** `src/a.ts`, `docs/`',
  '- **verify:** `npm test`',
  '',
  '### T2 Outra',
  '',
  '- **touch_paths:**',
  '  - `src/b/**`',
].join('\n')

/** O nucleo de baixo: responde as duas ferramentas de leitura do Freio e anota cada pedido. */
export function nucleo(on, opcoes: { claims?: unknown[]; plano?: string | null; erroClaims?: boolean; erroPlano?: boolean } = {}) {
  const pedidos: Array<{ server: string; tool: string; args: unknown }> = []
  const texto = (valor: unknown, isError = false) => ({ value: { content: [{ type: 'text', text: typeof valor === 'string' ? valor : JSON.stringify(valor) }], isError } })
  on('mcp.call', ($, e) => {
    pedidos.push({ server: e.server, tool: e.tool, args: e.args })
    if (e.tool === 'ork_claims_list') return opcoes.erroClaims ? texto('mcp.thread.unknown', true) : texto(opcoes.claims ?? [])
    if (e.tool === 'ork_artifact_read') {
      if (opcoes.erroPlano) return texto('mcp.artifact.scope', true)
      const conteudo = opcoes.plano === undefined ? PLANO : opcoes.plano
      return texto({ tipo: 'plan', arquivo: 'docs/plan.md', sha256: conteudo === null ? null : 'x'.repeat(64), conteudo })
    }
    throw new Error(`ferramenta fora do nucleo de teste: ${e.server}/${e.tool}`)
  })
  return pedidos
}

/** O fundo do inicio da sessao; registrado antes da primeira chamada ao `$`, que carrega os plugins. */
export function comInicio(on) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

/** O inicio da sessao como o motor o levanta numa sessao de fundo. */
export function iniciar($) {
  return $.session.start({ cwd: RAIZ, surface: null, isInteractive: false })
}
