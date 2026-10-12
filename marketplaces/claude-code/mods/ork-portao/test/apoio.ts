// Apoio dos testes do kit do Portão. O kit não tem disco nem núcleo: a ponte chega por um plugin inline que
// acrescenta o `$.ork` com o mesmo contrato da ponte de verdade, e o núcleo chega pelos fundos de `mcp.call` e de
// `process.run`. O kit roda o `register` de um plugin inline num ambiente próprio, sem as variáveis do arquivo de
// teste: a ponte falsa e a sonda são autocontidas, e a ponte lê o papel e o retrato pedidos do ambiente (`mock.env`).
import { mock } from 'claude-code/testing'

export const THREAD = 'ork-exemplo'
export const RAIZ = '/projeto/.claude/worktrees/ork-exemplo'

/**
 * A ponte falsa: papel em `ORK_TESTE_PAPEL` (padrão `fase`; `explode` faz o contexto falhar), status da thread em
 * `ORK_TESTE_STATUS` (padrão `aberta`; `sem-retrato` faz o retrato falhar) e slug do bloco em `ORK_TESTE_BLOCO` (padrão
 * `full`). O `ler` da consulta `maestro` vai ao `process.run`, como a ponte de verdade faz, e o fundo do teste responde.
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
          if (p === 'explode') throw new Error('ork-ponte: contexto quebrado no teste')
          return { papel: p, thread: p === 'fase' ? 'ork-exemplo' : null, raiz: '/projeto/.claude/worktrees/ork-exemplo' }
        },
        retrato: async () => {
          const status = await built.env.get('ORK_TESTE_STATUS')
          if (status === 'sem-retrato') throw new Error('ork-ponte: o ork_maestro respondeu com erro')
          const quando = '2026-01-01T00:00:00.000Z'
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
        ler: async pedido => {
          if (pedido.consulta !== 'maestro') return {}
          const argv = ['ork', 'maestro', '--json', ...(pedido.secao ? ['--section', pedido.secao, '--offset', String(pedido.offset ?? 0)] : [])]
          const r = await built.process.run(argv, { timeoutMs: 10000 })
          if (r.exitCode !== 0) throw new Error(`ork-ponte: ork maestro --json saiu ${r.exitCode}`)
          return JSON.parse(r.stdout)
        },
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

/** O ambiente que a ponte falsa lê: papel, status e bloco da thread, e o que o teste quiser a mais (os tetos). */
export function ambiente(on, opcoes: { papel?: 'dono' | 'fase' | 'dormente' | 'explode'; status?: string; bloco?: string; extra?: Record<string, string> } = {}) {
  mock.env(on, {
    ...(opcoes.papel ? { ORK_TESTE_PAPEL: opcoes.papel } : {}),
    ...(opcoes.status ? { ORK_TESTE_STATUS: opcoes.status } : {}),
    ...(opcoes.bloco ? { ORK_TESTE_BLOCO: opcoes.bloco } : {}),
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

/**
 * O preparo comum: relógio falso, ambiente, núcleo e fundos. `nuc` é o que o núcleo falso responde: o teste pode mudar
 * o plano ou fazer a leitura falhar no meio.
 */
export function preparar(on, opcoes: Parameters<typeof ambiente>[1] & { plano?: string | null; erroPlano?: boolean } = {}) {
  const relogio = mock.clock(on, { now: 1000 })
  ambiente(on, opcoes)
  const nuc = { plano: opcoes.plano, erroPlano: opcoes.erroPlano }
  const pedidos = nucleo(on, nuc)
  const fundos = comFundos(on)
  return { relogio, pedidos, nuc, ...fundos }
}

const base = { session_id: 'sessao-de-fase', transcript_path: '/projeto/transcript.jsonl', cwd: RAIZ }

/** A criação de uma tarefa nativa, como o motor a levanta. */
export function criar($, taskId: string, assunto: string, teammate?: string) {
  return $.classic.TaskCreated({ ...base, hook_event_name: 'TaskCreated', task_id: taskId, task_subject: assunto, ...(teammate ? { teammate_name: teammate } : {}) })
}

/** A conclusão de uma tarefa nativa, como o motor a levanta (pelo modelo ou pelo teammate que fecha o turno). */
export function concluir($, taskId: string, assunto: string, teammate?: string) {
  return $.classic.TaskCompleted({ ...base, hook_event_name: 'TaskCompleted', task_id: taskId, task_subject: assunto, ...(teammate ? { teammate_name: teammate } : {}) })
}

/** A resposta do `ork claims conferir --tarefa --json` como o núcleo a dá, com a saída 0 ou 1. */
export function conferencia(tarefa: string, resultado: 'aprovada' | 'reprovada' | 'sem-veredito', opcoes: { comando?: string; fim?: string } = {}) {
  const comando = opcoes.comando ?? 'npm test'
  const cabeca = { id: tarefa, alegacao: `verify da tarefa ${tarefa} do plano`, arquivo: 'docs/plan.md' }
  const item = resultado === 'aprovada'
    ? { ...cabeca, verificado: true, motivo: null, detalhe: '1 comando(s) reexecutado(s) com sucesso',
      execucoes: [{ nome: `${tarefa}.1`, comando, ok: true, code: 0, executado: true, fim: '' }] }
    : resultado === 'reprovada'
      ? { ...cabeca, verificado: false, motivo: 'claims.failed', detalhe: 'comando saiu com codigo 1',
        execucoes: [{ nome: `${tarefa}.1`, comando, ok: false, code: 1, executado: true, fim: opcoes.fim ?? 'ok 1 - a\nnot ok 2 - soma\n# fail 1' }] }
      : { ...cabeca, verificado: false, motivo: 'verify.timeout', detalhe: 'estourou o prazo de 540 s',
        execucoes: [{ nome: `${tarefa}.1`, comando, ok: false, code: -1, executado: true, causa: 'timeout', fim: '' }] }
  const r = {
    formato: 'ork.claims-conferencia/v1', thread: THREAD, commit: 'c'.repeat(40), cwd: RAIZ, executor: 'codex-sandbox', reciboOficial: false,
    prazoTotalMs: 540000, alvo: { tipo: 'tarefa', tarefa, plano: { arquivo: 'docs/plan.md', sha256: 'x'.repeat(64) }, comando },
    itens: [item], ok: item.verificado, motivos: item.motivo ? [item.motivo] : [],
  }
  return { stdout: JSON.stringify(r, null, 2), code: r.ok ? 0 : 1 }
}

/** A recusa tipada do núcleo (saída 2 com o JSON `{ ok: false, erro }`). */
export function recusa(erro: string, code = 2) {
  return { stdout: JSON.stringify({ formato: 'ork.claims-conferencia/v1', thread: THREAD, ok: false, erro }, null, 2), code }
}

/** Uma resposta de processo do núcleo: a saída, o código, a espera no relógio falso e a falha ao abrir. */
export type RespostaDoProcesso = { stdout?: string; stderr?: string; code?: number; espera?: number; naoAbre?: string }

/** Um lease ativo (ou vencido) como o retrato do núcleo o lista. */
export type LeaseDoTeste = { nome: string; thread: string; status?: 'active' | 'expired' }

/**
 * O fundo do `process.run` do Portão. `ork claims conferir` tira a próxima resposta da lista (`espera` segura a resposta
 * até o relógio falso andar); `ork maestro --json --section leases --offset N` devolve a página N dos leases, com
 * `pagina` itens por página, `esperaDoMaestro` no relógio falso e a seção indisponível com `maestroIndisponivel`.
 * Cada chamada fica anotada; `ork lease` é anotado à parte (o Portão nunca deve pedi-lo) e qualquer outro processo
 * derruba o teste.
 */
export function processos(on, relogio, opcoes: {
  conferencias?: RespostaDoProcesso[]; leasesAtivos?: LeaseDoTeste[]; pagina?: number; esperaDoMaestro?: number; maestroIndisponivel?: boolean
  lacunas?: string[]; estado?: string
} = {}) {
  const conferencias: Array<{ argv: string[]; cwd: unknown; timeoutMs: unknown }> = []
  const maestro: string[][] = []
  const leases: string[][] = []
  const respostas = opcoes.conferencias ?? []
  on('process.run', async ($, e) => {
    const pedido = { argv: [...e.argv], cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs }
    const saida = (exitCode: number, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'ork' && e.argv[1] === 'lease') {
      leases.push([...e.argv])
      return saida(1, '', 'o Portão não pede lease')
    }
    if (e.argv[0] === 'ork' && e.argv[1] === 'maestro') {
      maestro.push([...e.argv])
      if (opcoes.esperaDoMaestro) await relogio.sleep(opcoes.esperaDoMaestro)
      const todos = opcoes.leasesAtivos ?? []
      const tamanho = opcoes.pagina ?? 50
      const i = e.argv.indexOf('--offset')
      const offset = i >= 0 ? Number(e.argv[i + 1]) : 0
      const itens = todos.slice(offset, offset + tamanho).map(l => ({
        id: l.nome, title: 'Região reservada', status: l.status ?? 'active', refs: [{ kind: 'thread', id: l.thread }], facts: {},
      }))
      const seguinte = offset + itens.length < todos.length ? offset + itens.length : null
      // Como o núcleo: a página cortada antes do fim leva `maestro.page.byte_limit` e o `nextOffset`.
      const gaps = [...(seguinte !== null ? ['maestro.page.byte_limit'] : []), ...(opcoes.lacunas ?? [])]
      const secao = opcoes.maestroIndisponivel
        ? { state: 'unavailable', gaps: ['leases.unavailable'], items: [] }
        : { state: opcoes.estado ?? (todos.length ? 'available' : 'empty'), gaps, items: itens,
          coverage: { total: todos.length, offset, returned: itens.length, omitted: todos.length - offset - itens.length, nextOffset: seguinte, limit: 50 } }
      return saida(0, JSON.stringify({ schema: 'ork.maestro-snapshot/v1', sections: { leases: secao } }))
    }
    if (e.argv[0] !== 'ork' || e.argv[1] !== 'claims' || e.argv[2] !== 'conferir') throw new Error(`processo fora do teste: ${e.argv.join(' ')}`)
    conferencias.push(pedido)
    const r: RespostaDoProcesso = respostas.shift() ?? recusa('claims.conferir.uso: sem resposta preparada no teste')
    if (r.espera) await relogio.sleep(r.espera)
    if (r.naoAbre) throw new Error(r.naoAbre)
    return saida(r.code ?? 0, r.stdout ?? '', r.stderr ?? '')
  })
  return { conferencias, maestro, leases }
}

/** Só as conferências do `ork claims conferir`, para os testes da conclusão. */
export function nucleoDeConferencia(on, relogio, respostas: RespostaDoProcesso[]) {
  return processos(on, relogio, { conferencias: respostas }).conferencias
}

/** Os tetos do piloto de agent teams no ambiente da sessão, como o núcleo os passa (D10). */
export const TETOS = { ORK_AGENT_TEAMS_TEAMMATES: '2', ORK_AGENT_TEAMS_CUSTO_USD: '10' }

/** Os fundos do time: os agentes da sessão, o custo do `/cost` e o nascimento de um agente. `quebrado` faz a lista falhar. */
export function time(on, opcoes: { agentes?: Array<{ id: string; teammateId?: string; status: string }>; custo?: number | null; quebrado?: boolean } = {}) {
  const nascidos: string[] = []
  on('agent.list', () => {
    if (opcoes.quebrado) throw new Error('agent.list quebrado no teste')
    return { value: (opcoes.agentes ?? []).map(a => ({ description: 'x', type: a.teammateId ? 'teammate' : 'general-purpose', ...a })) }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0 }, rateLimits: [], ...(opcoes.custo === null ? {} : { cost: { usd: opcoes.custo ?? 0 } }) } }))
  on('agent.spawn', ($, e) => { nascidos.push(String(e.name)); return { model: 'opus', agentId: `ag-${nascidos.length}`, ...(e.isTeammate ? { teammateId: `${e.name}@time` } : {}) } })
  return nascidos
}

/** O teammate que vai ficar ocioso, como o motor levanta o evento. */
export function ocioso($, teammate: string) {
  return $.classic.TeammateIdle({ ...base, hook_event_name: 'TeammateIdle', teammate_name: teammate, team_name: 'time' })
}

/** O nascimento de um agente pelo Agent tool: teammate (com nome no time) ou subagente comum. */
export function nascer($, nome: string, teammate = true) {
  return $.agent.spawn({ prompt: 'trabalhe na tarefa', description: 'ajudante', name: nome, ...(teammate ? { isTeammate: true } : {}) })
}
