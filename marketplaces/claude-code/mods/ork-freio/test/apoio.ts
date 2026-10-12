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

/** Um caminho sujo da worktree falsa; sem `size`, o arquivo foi apagado. */
export type Sujo = { xy: string; size?: number; mtimeMs?: number }

/**
 * A worktree falsa: o `git status --porcelain=v2 --branch -z` e o `fs.stat` saem de `estado`, que o teste muda
 * entre os lotes como uma edicao (ou um commit) mudaria o disco. Conta as chamadas de cada um.
 */
export function disco(on, inicial: { head?: string; sujos?: Record<string, Sujo> } = {}) {
  const estado = { head: inicial.head ?? 'a'.repeat(40), sujos: { ...(inicial.sujos ?? {}) } as Record<string, Sujo>, status: 0, stats: 0, argv: [] as string[][] }
  on('process.run', ($, e) => {
    estado.argv.push([...e.argv])
    if (e.argv[0] !== 'git' || e.argv[1] !== 'status') throw new Error(`processo fora do teste: ${e.argv.join(' ')}`)
    estado.status++
    const registros = [`# branch.oid ${estado.head}`, '# branch.head ork/ork-exemplo-full']
    for (const [caminho, s] of Object.entries(estado.sujos)) {
      registros.push(s.xy === '??' ? `? ${caminho}` : `1 ${s.xy} N... 100644 100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} ${caminho}`)
    }
    return { value: { exitCode: 0, stdout: registros.join('\0') + '\0', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.stat', ($, e) => {
    estado.stats++
    const rel = String(e.path).slice(RAIZ.length + 1)
    const s = estado.sujos[rel]
    if (!s || s.size === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file', size: s.size, mtimeMs: s.mtimeMs ?? 0, isLink: false } }
  })
  return estado
}

/** O fundo do lote (nenhum settings hook embaixo) e da linha de status, com cada status anotado. */
export function comLote(on) {
  const status: Array<string | undefined> = []
  on('classic.PostToolBatch', () => ({}))
  on('ui.status', ($, e) => { status.push(e.text); return { value: undefined } })
  return status
}

/** Uma claim que a conferencia aprovou, como o `ork claims conferir --json` devolve. */
export const passou = (id: string) => ({ id, alegacao: `alegacao de ${id}`, arquivo: null, verificado: true, motivo: null,
  detalhe: '1 comando(s) reexecutado(s) com sucesso', execucoes: [{ nome: `${id}.1`, comando: 'true', ok: true, code: 0, executado: true, fim: '' }] })

/** Uma claim que a conferencia reprovou (`claims.failed`), com o comando e o fim da saida. */
export const quebrou = (id: string, comando: string, fim: string, arquivo: string | null = null) => ({ id, alegacao: `alegacao de ${id}`, arquivo,
  verificado: false, motivo: 'claims.failed', detalhe: `comando saiu com codigo 1`, execucoes: [{ nome: `${id}.1`, comando, ok: false, code: 1, executado: true, fim }] })

/** Uma claim que terminou sem veredito no nucleo (prazo do comando). */
export const semVeredito = (id: string, motivo = 'verify.timeout') => ({ id, alegacao: `alegacao de ${id}`, arquivo: null, verificado: false, motivo,
  detalhe: 'estourou o prazo', execucoes: [{ nome: `${id}.1`, comando: 'sleep 999', ok: false, code: -1, executado: true, causa: 'timeout', fim: '' }] })

/** A resposta do nucleo com estes itens, com a saida 0 ou 1 como o `ork claims conferir` da. */
export function respostaDe(itens: Array<{ id: string; verificado: boolean; motivo: string | null }>) {
  const resultado = {
    formato: 'ork.claims-conferencia/v1', thread: THREAD, commit: 'c'.repeat(40), cwd: RAIZ, executor: 'codex-sandbox',
    reciboOficial: false, prazoTotalMs: 180000, alvo: { tipo: 'claims', ids: itens.map(i => i.id) }, itens,
    ok: itens.every(i => i.verificado), motivos: [...new Set(itens.map(i => i.motivo).filter(m => m !== null))],
  }
  return { stdout: JSON.stringify(resultado, null, 2), code: resultado.ok ? 0 : 1 }
}

/** Uma resposta do processo do nucleo: a saida, o codigo, a espera no relogio falso e a falha ao abrir. */
export type RespostaDoProcesso = { stdout?: string; stderr?: string; code?: number; espera?: number; naoAbre?: string }

/**
 * O fundo do `process.spawn`: cada conferencia pedida tira a proxima resposta da lista (sem resposta, tudo
 * passou) e fica anotada com o argv e o cwd. `espera` segura a resposta ate o relogio falso andar.
 */
export function nucleoDeConferencia(on, relogio, respostas: RespostaDoProcesso[]) {
  const pedidos: Array<{ argv: string[]; cwd: unknown }> = []
  on('process.spawn', async function* ($, e) {
    pedidos.push({ argv: [...e.argv], cwd: e.cwd })
    const r = respostas.shift() ?? respostaDe([])
    if (r.naoAbre) throw new Error(r.naoAbre)
    if (r.espera) await relogio.sleep(r.espera)
    if (r.stdout) yield { stream: 'stdout', text: r.stdout }
    if (r.stderr) yield { stream: 'stderr', text: r.stderr }
    return { value: { code: r.code ?? 0, signal: null } }
  })
  return pedidos
}

/** Um lote de ferramentas como o motor o levanta depois de todas resolverem. */
export function lote($, ...chamadas: unknown[]) {
  return $.classic.PostToolBatch({ tool_calls: chamadas })
}

let sequencia = 0
const id = () => `toolu_${++sequencia}`
export const editar = (rel: string) => ({ tool_name: 'Edit', tool_input: { file_path: `${RAIZ}/${rel}`, old_string: 'a', new_string: 'b' }, tool_use_id: id() })
export const escrever = (rel: string) => ({ tool_name: 'Write', tool_input: { file_path: `${RAIZ}/${rel}`, content: 'x' }, tool_use_id: id() })
export const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command }, tool_use_id: id() })
export const ler = (rel: string) => ({ tool_name: 'Read', tool_input: { file_path: `${RAIZ}/${rel}` }, tool_use_id: id() })

/** O fundo do inicio da sessao; registrado antes da primeira chamada ao `$`, que carrega os plugins. */
export function comInicio(on) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
}

/** O inicio da sessao como o motor o levanta numa sessao de fundo. */
export function iniciar($) {
  return $.session.start({ cwd: RAIZ, surface: null, isInteractive: false })
}
