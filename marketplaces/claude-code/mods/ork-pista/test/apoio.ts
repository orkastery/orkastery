// Apoio dos testes do kit da Pista. O kit nao carrega `dependencies` nem importa arquivo de fora da pasta do mod, e o
// plugin inline do teste roda serializado, sem as variaveis deste arquivo: a ponte falsa e autocontida. Ela segue o
// contrato do `$.ork` da `ork-ponte` no que a Pista usa: o papel vem do `env.get` (`ORK_TESTE_PAPEL`), o retrato vem
// do `ork_maestro` pelo `mcp.call`, e a faixa e o mostrado vao ao servidor `ponte-falsa`, onde o teste os le. O nucleo
// embaixo responde pelo fundo `process.run`, com o mundo que o teste escolhe; nenhum `git` nem `gh` roda aqui.
export const PONTE_FALSA = {
  name: 'ork-ponte',
  register(on) {
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      const pedir = async (ferramenta, args) => {
        const r = await built.mcp.call('ponte-falsa', ferramenta, args)
        if (r.isError) throw new Error(`ork-ponte: ${ferramenta} recusado`)
        return JSON.parse(r.content[0].text)
      }
      const papel = async () => {
        const p = await built.env.get('ORK_TESTE_PAPEL')
        if (p === 'erro') throw new Error('ork-ponte: o servidor do nucleo ainda nao respondeu')
        return p ?? 'dormente'
      }
      const ork = {
        papel,
        contexto: async () => ({ papel: await papel(), thread: null, raiz: '/projeto' }),
        retrato: async pedido => {
          const r = await built.mcp.call('orkastery', 'ork_maestro', pedido?.secao ? { section: pedido.secao } : {})
          if (r.isError) throw new Error('ork-ponte: o ork_maestro respondeu com erro')
          return { fonte: 'mcp', lidoEm: await built.clock.now(), retrato: JSON.parse(r.content[0].text) }
        },
        ler: async pedido => pedir('ler', pedido),
        faixa: async pedido => pedir('faixa', pedido),
        vigiar: async pedido => pedir('vigiar', pedido),
        mostrado: async pedido => { await pedir('mostrado', pedido) },
        mostrados: async () => pedir('mostrados', {}),
      }
      return { ...built, ork }
    })
  },
}

/** Um relogio na epoca de hoje, para erro relativo ao zero nao passar despercebido. */
export const EPOCA = 1760000000000
export const PANE = { title: 'Pista de Entrega', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
/** O painel posto e a vista do dono, como `$.ui.panes()` o lista. */
export const A_VISTA = [{ id: 'pista', title: 'Pista de Entrega', isShown: true, isFocused: false, isPlaced: true }]
export const SHA_A = 'a'.repeat(40)
export const SHA_B = 'b'.repeat(40)
export const SHA_C = 'c'.repeat(40)

const ok = valor => ({ value: { content: [{ type: 'text', text: JSON.stringify(valor) }], isError: false } })
const falha = () => ({ value: { content: [{ type: 'text', text: '{"erro":"falhou"}' }], isError: true } })
export const saida = (exitCode: number, stdout: unknown, stderr = '') =>
  ({ value: { exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr, isStdoutTruncated: false, isStderrTruncated: false } })

const IDS = ['check', 'verify', 'bundle', 'branch', 'pr', 'ci', 'conflito', 'entrega']

/** As oito etapas, todas feitas, menos as que o teste troca (`{ ci: 'falhou' }`). */
export function etapas(estados: Record<string, string> = {}) {
  return IDS.map(id => ({ id, estado: estados[id] ?? 'feita', texto: `${id} ${estados[id] ?? 'feita'}` }))
}

/** Uma pista do contrato `ork.ship-pista/v1`, com o que o teste escolhe. */
export function pista(thread: string, o: { tag?: string; publicavel?: boolean; conduzida?: boolean; head?: string | null;
  pr?: unknown; estados?: Record<string, string>; proximo?: unknown } = {}) {
  return {
    thread, nome: thread, modo: o.publicavel === false ? 'classic' : 'auto', tag: o.tag ?? (o.publicavel === false ? '#Classic' : '#Auto'),
    publicavel: o.publicavel ?? true, conduzida: o.conduzida ?? false, branch: `ork/${thread}-full`, head: o.head === undefined ? SHA_A : o.head,
    remota: null, pr: o.pr ?? null, etapas: etapas(o.estados),
    proximo: o.proximo ?? { acao: 'publicar', disponivel: true, texto: 'publique a branch e abra o PR', comando: `ork ship publicar ${thread}` },
  }
}

/** A saida inteira do `ork ship pista --json`. */
export function saidaDaPista(pistas: unknown[], extra: Record<string, unknown> = {}) {
  return { contrato: 'ork.ship-pista/v1', lidoEm: '2025-10-09T10:00:00.000Z', base: 'main', remoto: 'origin', remotoLido: true, prsLidos: true,
    prsNaoLidos: null, ciExigido: true, contextoDoCi: 'ork-verify', pistas, ...extra }
}

function secao(items) {
  return { state: items.length ? 'available' : 'empty', source: 'teste', observedAt: '2025-10-09T10:00:00.000Z', items, gaps: [] }
}

/** O retrato com a secao `ship`, como a ponte o devolve: um item por entrega que andou. */
export function retratoDoShip(itens: Array<{ thread: string; status: string; em: string }>) {
  return { schema: 'ork.maestro-snapshot/v1', observedAt: '2025-10-09T10:00:00.000Z', gaps: [],
    sections: { ship: secao(itens.map(i => ({ id: `ship:${i.thread}`, title: 'Entrega', status: i.status, refs: [{ kind: 'thread', id: i.thread }],
      facts: { pushVerified: i.status === 'delivered', receiptAt: i.em } }))) } }
}

/**
 * Monta o fundo do teste: o papel, o retrato, o nucleo pelo `process.run`, o registro de comando, o painel e o que a
 * Pista pede a ponte. Devolve o mundo, para o teste trocar as respostas e conferir o que foi pedido.
 */
export function montar(on, opcoes: { papel: string; pista?: unknown; paineis?: unknown[]; retrato?: unknown }) {
  const mundo = {
    papel: opcoes.papel,
    pista: opcoes.pista ?? saidaDaPista([]) as unknown, retrato: opcoes.retrato ?? retratoDoShip([]) as unknown,
    paineis: opcoes.paineis ?? [], pistaSaida: null as null | { exitCode: number; stdout: string; stderr: string },
    processos: [] as string[][], faixas: [] as unknown[], mostrados: [] as unknown[], comandos: [] as string[], abertos: [] as string[],
    toasts: [] as string[], maestro: 0, respostas: {} as Record<string, unknown>,
    /** Uma espera antes de responder o comando (as quatro primeiras palavras do argv), para o teste segurar o nucleo. */
    atrasos: {} as Record<string, () => Promise<void>>,
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.FileChanged', () => ({}))
  on('env.get', ($, e) => ({ value: e.name === 'ORK_TESTE_PAPEL' ? mundo.papel : undefined }))
  on('mcp.call', ($, e) => {
    if (e.server === 'orkastery' && e.tool === 'ork_maestro') { mundo.maestro++; return ok(mundo.retrato) }
    if (e.server === 'ponte-falsa') {
      if (e.tool === 'faixa') { mundo.faixas.push(e.args); return ok({ publicada: e.args.texto !== undefined }) }
      if (e.tool === 'mostrado') { mundo.mostrados.push(e.args); return ok(null) }
    }
    return falha()
  })
  on('process.run', async ($, e) => {
    const argv = e.argv as string[]
    mundo.processos.push(argv)
    const atraso = mundo.atrasos[argv.slice(0, 4).join(' ')]
    if (atraso) await atraso()
    if (argv[0] === 'ork' && argv[1] === 'ship' && argv[2] === 'pista') {
      if (mundo.pistaSaida) return { value: { ...mundo.pistaSaida, isStdoutTruncated: false, isStderrTruncated: false } }
      const p = mundo.pista as { pistas: Array<{ thread: string }> }
      const so = argv.length === 5 ? argv[3] : null
      return saida(0, so ? { ...p, pistas: p.pistas.filter(x => x.thread === so) } : p)
    }
    const chave = argv.slice(0, 4).join(' ')
    const resposta = mundo.respostas[chave]
    if (resposta !== undefined) return resposta
    return saida(2, '', `subcomando desconhecido: ${argv.slice(1, 3).join(' ')}`)
  })
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { mundo.abertos.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: mundo.paineis }))
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  return mundo
}

/** O inicio de uma sessao interativa no terminal; `false` e uma sessao sem pessoa (`-p` ou SDK). */
export async function iniciar($, interativa = true) {
  await $.session.start({ cwd: '/projeto', surface: interativa ? 'terminal' : null, isInteractive: interativa })
}

/** O `/pista` como o dono o digita, com a thread em foco quando vem. */
export async function abrirPista($, args = '') {
  return $.command.run({ command: 'pista', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

/** Espera o trabalho em segundo plano da Pista (o kit nao tem relogio no `$`): temporizador real, em passos curtos. */
export async function esperar(condicao: () => boolean, passos = 200) {
  for (let i = 0; i < passos && !condicao(); i++) await new Promise(r => setTimeout(r, 2))
}

/** O painel montado numa superficie. */
export async function montarPainel($, surface, janela?) {
  return $.ui.mount({ plugin: 'ork-pista', surface, component: 'Pane', requestId: 'pista', props: janela ? { ...PANE, scroll: janela } : PANE })
}

/** Os textos de `Text` e `Button` de um painel montado. */
export async function textosDe(ui) {
  return (await ui.findAll({})).filter(e => e.type === 'Text' || e.type === 'Button').map(e => e.text)
}

/** Os textos do painel montado numa superficie, de `Text` e de `Button`, na ordem do desenho. */
export async function textosDoPainel($, surface) {
  const ui = await montarPainel($, surface)
  const textos = await textosDe(ui)
  await ui.unmount()
  return textos
}
