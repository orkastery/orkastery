// Apoio dos testes do kit do Portão. O kit não tem disco nem núcleo: a ponte chega por um plugin inline que
// acrescenta o `$.ork` com o mesmo contrato da ponte de verdade, e o núcleo chega pelos fundos de `mcp.call` e de
// `process.run`. O kit roda o `register` de um plugin inline num ambiente próprio, sem as variáveis do arquivo de
// teste: a ponte falsa e a sonda são autocontidas, e a ponte lê o papel e o retrato pedidos do ambiente (`mock.env`).
import { mock } from 'claude-code/testing'

export const THREAD = 'ork-exemplo'
export const RAIZ = '/projeto/.claude/worktrees/ork-exemplo'

/**
 * A ponte falsa: papel em `ORK_TESTE_PAPEL` (padrão `fase`), status da thread em `ORK_TESTE_STATUS` (padrão
 * `aberta`; `sem-retrato` faz o retrato falhar), slug do bloco em `ORK_TESTE_BLOCO` (padrão `full`) e os leases da
 * seção `leases` em `ORK_TESTE_LEASES` (JSON com `nome`, `thread`, `status`).
 */
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
        retrato: async pedido => {
          const status = await built.env.get('ORK_TESTE_STATUS')
          if (status === 'sem-retrato') throw new Error('ork-ponte: o ork_maestro respondeu com erro')
          const quando = '2026-01-01T00:00:00.000Z'
          if (pedido && pedido.secao === 'leases') {
            const leases = JSON.parse((await built.env.get('ORK_TESTE_LEASES')) ?? '[]')
            return {
              fonte: 'mcp', lidoEm: 0,
              retrato: {
                schema: 'ork.maestro-snapshot/v1', observedAt: quando, gaps: [],
                sections: { leases: { state: leases.length ? 'available' : 'empty', source: 's', observedAt: quando, gaps: [],
                  items: leases.map(l => ({ id: l.nome, title: 'Região reservada', status: l.status ?? 'active',
                    refs: [{ kind: 'thread', id: l.thread }], facts: { expiresAt: '2026-01-01T00:30:00.000Z' } })) } },
              },
            }
          }
          const bloco = (await built.env.get('ORK_TESTE_BLOCO')) ?? 'full'
          return {
            fonte: 'mcp', lidoEm: 0,
            retrato: {
              schema: 'ork.maestro-snapshot/v1', observedAt: quando, gaps: [],
              sections: { threads: { state: 'available', source: 's', observedAt: quando, gaps: [],
                items: [{ id: 'ork-exemplo', title: 'exemplo', status: status ?? 'aberta', refs: [], facts: { phase: 'GOAL', block: bloco } }] } },
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

/** A sonda que lê o quadro do Portão por comando (o `$` do teste não tem `state`). */
export const SONDA = {
  name: 'ork-sonda-portao',
  register(on) {
    on('command.run', { command: 'portao-quadro' }, async $ => ({ text: JSON.stringify((await $.state.get({ plugin: 'ork-portao', key: 'quadro' })).value ?? null) }))
  },
}

export const PLUGINS = [PONTE, SONDA]

/** O quadro do Portão, lido pela sonda. */
export async function quadro($) {
  const r = await $.command.run({ command: 'portao-quadro', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  return JSON.parse(r.text)
}

/** O ambiente que a ponte falsa lê: papel, status e bloco da thread, e os leases do retrato. */
export function ambiente(on, opcoes: { papel?: 'dono' | 'fase' | 'dormente'; status?: string; bloco?: string; leases?: unknown[]; extra?: Record<string, string> } = {}) {
  mock.env(on, {
    ...(opcoes.papel ? { ORK_TESTE_PAPEL: opcoes.papel } : {}),
    ...(opcoes.status ? { ORK_TESTE_STATUS: opcoes.status } : {}),
    ...(opcoes.bloco ? { ORK_TESTE_BLOCO: opcoes.bloco } : {}),
    ...(opcoes.leases ? { ORK_TESTE_LEASES: JSON.stringify(opcoes.leases) } : {}),
    ...(opcoes.extra ?? {}),
  })
}

/**
 * Um plano com as cinco formas que importam: completa (T1 e T5), sem `touch_paths` (T2), sem verify (T3) e com
 * verify de dois comandos (T4).
 */
export const PLANO = [
  '# PLAN: exemplo',
  '',
  '## Tarefas',
  '',
  '### T1 Tarefa completa',
  '',
  '- **touch_paths:** `src/a.ts`, `docs/`',
  '- **verify:** `npm test`',
  '',
  '### T2 Sem touch_paths',
  '',
  '- **verify:** `npm test`',
  '',
  '### T3 Sem verify',
  '',
  '- **touch_paths:** `src/c.ts`',
  '',
  '### T4 Verify com dois comandos',
  '',
  '- **touch_paths:** `src/d.ts`',
  '- **verify:** `npm test` e `npm run lint`',
  '',
  '### T5 Outra completa',
  '',
  '- **touch_paths:**',
  '  - `src/e/**`',
  '- **verify:** `node --test dist/e.test.js`',
].join('\n')

/** O núcleo de baixo: responde a leitura do plano (a única ferramenta do Portão) e anota cada pedido. */
export function nucleo(on, opcoes: { plano?: string | null; erroPlano?: boolean } = {}) {
  const pedidos: Array<{ server: string; tool: string; args: unknown }> = []
  const texto = (valor: unknown, isError = false) => ({ value: { content: [{ type: 'text', text: typeof valor === 'string' ? valor : JSON.stringify(valor) }], isError } })
  on('mcp.call', ($, e) => {
    pedidos.push({ server: e.server, tool: e.tool, args: e.args })
    if (e.tool === 'ork_artifact_read') {
      if (opcoes.erroPlano) return texto('mcp.artifact.scope', true)
      const conteudo = opcoes.plano === undefined ? PLANO : opcoes.plano
      return texto({ tipo: 'plan', arquivo: 'docs/plan.md', sha256: conteudo === null ? null : 'x'.repeat(64), conteudo })
    }
    throw new Error(`ferramenta fora do núcleo de teste: ${e.server}/${e.tool}`)
  })
  return pedidos
}

/** Os fundos dos eventos do Portão (nenhum settings hook embaixo) e da linha de status e do log. */
export function comFundos(on) {
  const status: Array<string | undefined> = []
  const logs: string[] = []
  on('classic.TaskCreated', () => ({}))
  on('classic.TaskCompleted', () => ({}))
  on('classic.TeammateIdle', () => ({}))
  on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
  on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined } })
  return { status, logs }
}

/** O preparo comum: relógio falso, ambiente, núcleo e fundos. */
export function preparar(on, opcoes: Parameters<typeof ambiente>[1] & { plano?: string | null; erroPlano?: boolean } = {}) {
  const relogio = mock.clock(on, { now: 1000 })
  ambiente(on, opcoes)
  const pedidos = nucleo(on, { plano: opcoes.plano, erroPlano: opcoes.erroPlano })
  const fundos = comFundos(on)
  return { relogio, pedidos, ...fundos }
}

const base = { session_id: 'sessao-de-fase', transcript_path: '/projeto/transcript.jsonl', cwd: RAIZ }

/** A criação de uma tarefa nativa, como o motor a levanta. */
export function criar($, taskId: string, assunto: string, teammate?: string) {
  return $.classic.TaskCreated({ ...base, hook_event_name: 'TaskCreated', task_id: taskId, task_subject: assunto, ...(teammate ? { teammate_name: teammate } : {}) })
}
