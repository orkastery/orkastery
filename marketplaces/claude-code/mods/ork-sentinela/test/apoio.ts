import { mock } from 'claude-code/testing'

// Apoio dos testes do kit da Sentinela. O kit não carrega `dependencies` nem importa arquivo de fora da pasta do mod,
// e o plugin inline do teste roda serializado, sem as variáveis deste arquivo: a ponte falsa é autocontida. Ela segue
// o contrato do `$.ork` da `ork-ponte` no que a Sentinela usa: o papel vem do `env.get` (`ORK_TESTE_PAPEL`); o retrato
// vem do `ork_maestro` pelo `mcp.call`; `ler` roda a consulta da lista fechada pelo `process.run`; a faixa desenha uma
// linha por mod (`rotulo: texto`) e, na sessão do dono, entra no registro do mostrado. O que ela guardou sai pelo
// comando `ponte-falsa`. O núcleo embaixo responde pelo fundo `process.run`, com o mundo que o teste escolhe.
export const PONTE_FALSA = {
  name: 'ork-ponte',
  register(on) {
    const FAIXA = { plugin: 'ork-ponte', key: 'faixa' }
    const MOSTRADOS = { plugin: 'ork-ponte', key: 'mostrados' }
    const CONSULTAS = {
      'conducao.status': t => ['ork', 'conducao', 'status', t, '--json'],
      'retry.plan': t => ['ork', 'retry', 'plan', t, '--json'],
      'pulse': () => ['ork', 'pulse', '--json'],
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
        if (r.exitCode !== 0) throw new Error(`ork-ponte: ${argv.slice(0, 3).join(' ')} saiu ${r.exitCode}`)
        return JSON.parse(r.stdout)
      }
      const ork = {
        papel: async () => papel(),
        contexto: async () => ({ papel: await papel(), thread: null, raiz: '/projeto' }),
        retrato: async pedido => {
          const r = await built.mcp.call('orkastery', 'ork_maestro', pedido?.thread ? { threadId: pedido.thread } : {})
          const texto = (r.content ?? []).find(c => c.type === 'text')?.text
          if (r.isError || texto === undefined) throw new Error('ork-ponte: o ork_maestro respondeu com erro')
          return { fonte: 'mcp', lidoEm: await built.clock.now(), retrato: JSON.parse(texto) }
        },
        ler: async ({ consulta, thread }) => {
          if (!(consulta in CONSULTAS)) throw new Error(`ork-ponte: consulta fora da lista fechada: ${consulta}`)
          return cli(CONSULTAS[consulta](thread))
        },
        faixa: async ({ mod, texto }) => {
          const limpo = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
          const atual = await built.state.get(FAIXA)
          const linhas = { ...(atual.value ?? {}) }
          if (limpo !== '') linhas[mod] = limpo
          else delete linhas[mod]
          await built.state.set(FAIXA, linhas, { ifVersion: atual.version })
          const publicada = mod in linhas
          if (publicada && (await papel()) === 'dono') await mostrar({ mod, canal: 'faixa', texto: limpo })
          return { publicada }
        },
        mostrado: async pedido => mostrar(pedido),
      }
      return { ...built, ork }
    })
    on('command.run', { command: 'ponte-falsa' }, async $ => ({
      text: JSON.stringify({ faixa: (await $.state.get(FAIXA)).value ?? {}, mostrados: (await $.state.get(MOSTRADOS)).value ?? [] }),
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
/** 12/10/2026 15:00 UTC: a época de hoje, para erro relativo ao zero não passar despercebido. */
export const T0 = Date.UTC(2026, 9, 12, 15, 0)
export const SESSAO = 'sessao-do-dono-1'
export const P = { isFullscreen: false, columns: 120 }
export const iso = (ms: number) => new Date(ms).toISOString()
export const MARCA_DO_PEDIDO = '# pedido guardado na criacao da thread (sha256 0123456789ab)'

/** Um passo do contrato `ork.conducao-sentinela/v1`. */
export function passo(thread: string, extra: Record<string, unknown> = {}) {
  return {
    thread, modo: 'auto', faseAtual: 'GOAL', conduzida: false, acao: 'nada', fase: null, caso: null, proximoPasso: null,
    porque: 'nada a conduzir agora', desdeEm: null, bloqueio: null, pedidoGuardado: true, ...extra,
  }
}

/** O status do núcleo: a presença (da sessão dada, ou nenhuma) e os passos. */
export function status(passos: unknown[], presenca: string | null = SESSAO) {
  return {
    contrato: 'ork.conducao-sentinela/v1', consultadoEm: iso(T0), maquina: 'maquina-de-teste',
    presenca: presenca === null ? null : { contrato: 'ork.conducao-sentinela/v1', canal: 'claude-code', maquina: 'maquina-de-teste',
      sessao: presenca, desde: iso(T0), batidaEm: iso(T0), expiraEm: iso(T0 + 3 * MIN), ativa: true },
    threads: passos,
  }
}

/** O `ork pulse --json` (`ork.pulse/v1`) com o que precisa do dono e o que está parado no condutor. */
export function pulso(opcoes: { humanos?: unknown[]; parados?: unknown[] } = {}) {
  return { contrato: 'ork.pulse/v1', consultadoEm: iso(T0), runtime: { ok: true, detalhe: '' }, precisaDeHumanoAgora: opcoes.humanos ?? [],
    acoesAutomaticas: [], resumo: { humanos: (opcoes.humanos ?? []).length, automaticas: 0, scores: 0, fasesOrfas: 0 },
    ...(opcoes.parados ? { paradoNoCondutor: opcoes.parados } : {}) }
}

const saida = (exitCode: number, stdout: unknown, stderr = '') =>
  ({ value: { exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr, isStdoutTruncated: false, isStderrTruncated: false } })

/**
 * O fundo do teste: relógio, papel, id da sessão, registro de comando, notificação, log e o núcleo pelo `process.run`.
 * O mundo guarda o que o núcleo responde (status, batida, condução, render, despacho, retry, pulse, retrato) e o que
 * a Sentinela pediu, e o teste o muda entre rodadas.
 */
export function montar(on, opcoes: { agora?: number; papel?: string } = {}) {
  const relogio = mock.clock(on, { now: opcoes.agora ?? T0 })
  const mundo = {
    papel: opcoes.papel ?? 'dono', sessao: SESSAO, status: status([]) as unknown, statusFalha: false,
    batida: 'minha' as 'minha' | 'outra' | 'falha',
    conducao: {} as Record<string, unknown>, render: {} as Record<string, string | null>, despacho: { exitCode: 0, stdout: 'Fase despachada.', stderr: '' },
    retry: {} as Record<string, unknown>, retryRun: { exitCode: 0, stdout: 'retomada', stderr: '' }, pulse: pulso() as unknown,
    hitl: {} as Record<string, unknown[]>,
    /** O `ork phase run` responde depois disto, pelo relógio falso: um despacho lento no meio da rodada. */
    atrasoDoDespacho: 0,
    /** A batida responde depois disto, pelo relógio falso: uma batida no ar quando a pausa chega. */
    atrasoDaBatida: 0,
    /** A ordem em que a batida terminou e o desligar chegou, para o teste da batida no ar. */
    sequencia: [] as string[],
    processos: [] as Array<{ argv: string[]; env?: Record<string, string> }>, comandos: [] as string[], notificacoes: [] as Array<{ text: string; title?: string }>,
    logs: [] as string[], toasts: [] as string[], retratos: [] as unknown[],
  }
  on('env.get', ($, e) => ({ value: e.name === 'ORK_TESTE_PAPEL' ? mundo.papel : undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: mundo.sessao }))
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: undefined } })
  on('ui.notify', ($, e) => { mundo.notificacoes.push({ text: e.text, title: e.title }); return { value: { isSent: true } } })
  on('ui.log', ($, e) => { mundo.logs.push(e.text); return { value: undefined } })
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  on('classic.FileChanged', () => ({}))
  on('mcp.call', ($, e) => {
    mundo.retratos.push(e.args)
    const thread = e.args?.threadId
    const items = (thread && mundo.hitl[thread]) || []
    const retrato = { schema: 'ork.maestro-snapshot/v1', observedAt: iso(T0), gaps: [], sections: {
      hitl: { state: items.length ? 'available' : 'empty', source: 'teste', observedAt: iso(T0), items, gaps: [] } } }
    return { value: { content: [{ type: 'text', text: JSON.stringify(retrato) }], isError: false } }
  })
  on('process.run', async ($, e) => {
    const argv = e.argv as string[]
    mundo.processos.push({ argv, env: e.init?.env })
    const [, a, b, c] = argv
    if (a === 'conducao' && b === 'sentinela' && c === 'status') return mundo.statusFalha ? saida(1, '', 'falhou') : saida(0, mundo.status)
    if (a === 'conducao' && b === 'sentinela' && c === 'bater') {
      if (mundo.atrasoDaBatida > 0) await relogio.sleep(mundo.atrasoDaBatida)
      mundo.sequencia.push('fim-da-batida')
      if (mundo.batida === 'falha') return saida(1, '', 'erro: conducao.sentinela.trava')
      return mundo.batida === 'minha' ? saida(0, { ok: true, ligou: false, presenca: {} }) : saida(3, { ok: false, ligou: false, presenca: {} })
    }
    if (a === 'conducao' && b === 'sentinela' && c === 'desligar') {
      mundo.sequencia.push('desligar')
      return saida(0, { desligada: true, presenca: null })
    }
    if (a === 'conducao' && b === 'status') return saida(0, { thread: c, conducao: mundo.conducao[c as string] ?? null })
    if (a === 'prompt' && b === 'render') {
      const r = mundo.render[c as string]
      if (r === null) return saida(1, '', 'thread.pedido.divergente')
      return saida(0, r ?? `# template fase-padrao v3 (origem: embutido)\n# thread ${c}, fase ${argv[4]}, sha256 abc\n${MARCA_DO_PEDIDO}\n\nO prompt da fase ${argv[4]} de ${c}.\n`)
    }
    if (a === 'phase' && b === 'run') {
      if (mundo.atrasoDoDespacho > 0) await relogio.sleep(mundo.atrasoDoDespacho)
      return { value: { ...mundo.despacho, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (a === 'retry' && b === 'plan') return saida(0, mundo.retry[c as string] ?? { automatica: false, bloqueio: 'politica.nao-automatica' })
    if (a === 'retry' && b === 'run') return { value: { ...mundo.retryRun, isStdoutTruncated: false, isStderrTruncated: false } }
    if (a === 'pulse') return mundo.pulse === null ? saida(1, '', 'runtime.unavailable') : saida(0, mundo.pulse)
    return saida(127, '', `comando inesperado no teste: ${argv.join(' ')}`)
  })
  return { relogio, mundo }
}

/** O início de uma sessão interativa no terminal, e a primeira rodada (que sai 1 s depois da ativação). */
export async function iniciar($, relogio) {
  await $.session.start({ cwd: '/projeto', surface: 'terminal', isInteractive: true })
  await relogio.advance(1000)
  await relogio.settle()
}

/** O `/sentinela` como o dono o digita. */
export async function sentinela($, args = '') {
  return (await $.command.run({ command: 'sentinela', args, origin: { kind: 'composer' }, presentation: P })).text
}

export async function ponte($) {
  return JSON.parse((await $.command.run({ command: 'ponte-falsa', args: '', origin: { kind: 'composer' }, presentation: P })).text)
}

/** As linhas que a faixa mostra numa superfície. */
export async function faixaEm($, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({
    plugin: 'ork-ponte', surface, component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  })
  const linhas = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return linhas
}

/** Os argv que a Sentinela rodou, um por linha. */
export function argvs(mundo) {
  return mundo.processos.map(p => p.argv.join(' '))
}
