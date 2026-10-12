// Apoio dos testes do kit do Ritual do MASTER. O kit nao carrega `dependencies` nem importa arquivo de fora da pasta do
// mod, e o plugin inline do teste roda serializado, sem as variaveis deste arquivo: a ponte falsa e autocontida. Ela
// segue o contrato do `$.ork` da `ork-ponte` no que o Ritual usa: o papel vem do `env.get` (`ORK_TESTE_PAPEL`), o
// retrato vem do `ork_maestro` pelo `mcp.call` (com a secao e o offset, como a ponte real), e a faixa e o mostrado vao
// ao servidor `ponte-falsa`, onde o teste os le. As entregas e as claims sao sinteticas; nenhum processo roda aqui e
// nenhum arquivo e lido: o fundo guarda qualquer tentativa, para o caso negativo.
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
          const args = pedido && pedido.secao ? { section: pedido.secao, offset: pedido.offset ?? 0 } : {}
          const r = await built.mcp.call('orkastery', 'ork_maestro', args)
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
const DIA = 86400000
const iso = (ms: number) => new Date(ms).toISOString()
export const PANE = { title: 'Ritual do MASTER', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} }
/** O painel posto e a vista do dono, como `$.ui.panes()` o lista. */
export const A_VISTA = [{ id: 'ritual', title: 'Ritual do MASTER', isShown: true, isFocused: false, isPlaced: true }]
export const SHA = 'a'.repeat(40)

/** Um item da secao `master` do retrato, com os fatos da T8.2a do nucleo. `dias` e a idade da entrega. */
export function itemMaster(thread: string, o: { status?: string; regime?: string | null; score?: number | null; index?: number;
  indexDetail?: string; reprovals?: number; classes?: string | null; dias?: number; entregue?: boolean } = {}) {
  const dias = o.dias ?? 1
  const entregue = o.entregue ?? true
  const status = o.status ?? 'recorded'
  return {
    id: `master:${thread}`, title: status === 'pending' ? 'Score humano pendente' : 'MASTER', status, refs: [{ kind: 'thread', id: thread }],
    facts: {
      score: o.score === undefined ? (status === 'recorded' ? 4 : null) : o.score,
      regime: o.regime === undefined ? (status === 'recorded' ? 'omissao' : null) : o.regime,
      classes: o.classes === undefined ? (status === 'pending' ? null : 'processo') : o.classes,
      index: o.index ?? 4, indexDetail: o.indexDetail ?? 'go_fix_opened x2', reprovals: o.reprovals ?? 1,
      deliveredAt: entregue ? iso(EPOCA - dias * DIA) : null,
      deliveredAtLocal: entregue ? `${String(20 - dias).padStart(2, '0')}/10 14:20 (horário de Brasília)` : null,
      deliveredSha: entregue ? SHA : null,
    },
  }
}

/** Uma pagina do retrato com a secao `master`, como a ponte a devolve. */
export function retratoMaster(itens: unknown[], o: { offset?: number; proxima?: number | null; lacunas?: string[] } = {}) {
  const lacunas = o.lacunas ?? []
  return {
    schema: 'ork.maestro-snapshot/v1', observedAt: iso(EPOCA), gaps: [], conflicts: [],
    sections: { master: { state: lacunas.length ? 'unavailable' : itens.length ? 'available' : 'empty', source: 'ork.master', observedAt: iso(EPOCA),
      coverage: { total: null, offset: o.offset ?? 0, returned: itens.length, omitted: null, nextOffset: o.proxima ?? null, limit: 50 },
      items: itens, gaps: lacunas } },
  }
}

/** Um registro de claim, como o `claims.jsonl` (e o `ork_claims_list`) o guarda. */
export function claim(thread: string, id: string, estado: string, o: { arquivo?: string; alegacao?: string; verificar?: string[] } = {}) {
  return {
    id, thread, fase: 'GO', arquivo: o.arquivo ?? `core/src/${id.toLowerCase()}.ts`, alegacao: o.alegacao ?? `A ${id} sustenta a entrega da ${thread}.`,
    negativa: false, verificar: o.verificar ?? [`node --test core/dist-test/test/${id.toLowerCase()}.test.js`], criadoEm: iso(EPOCA), estado,
  }
}

const ok = valor => ({ value: { content: [{ type: 'text', text: JSON.stringify(valor) }], isError: false } })
const falha = (erro = 'falhou') => ({ value: { content: [{ type: 'text', text: JSON.stringify({ erro }) }], isError: true } })

/**
 * Monta o fundo do teste: o papel, as paginas do retrato (por offset), as claims por thread, o registro de comando, o
 * painel e o que o Ritual pede a ponte. Devolve o mundo, para o teste trocar as respostas e conferir o que foi pedido.
 */
export function montar(on, opcoes: { papel: string; paginas?: Record<number, unknown>; claims?: Record<string, unknown[]>; paineis?: unknown[] }) {
  const mundo = {
    papel: opcoes.papel,
    paginas: { ...(opcoes.paginas ?? { 0: retratoMaster([]) }) } as Record<number, unknown>,
    claims: { ...(opcoes.claims ?? {}) } as Record<string, unknown[]>,
    paineis: opcoes.paineis ?? [], maestroFalha: false,
    maestro: [] as unknown[], claimsPedidas: [] as unknown[], outrasMcp: [] as unknown[], faixas: [] as unknown[], mostrados: [] as unknown[],
    comandos: [] as string[], abertos: [] as string[], toasts: [] as string[], processos: [] as unknown[], lidos: [] as unknown[],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.FileChanged', () => ({}))
  on('env.get', ($, e) => ({ value: e.name === 'ORK_TESTE_PAPEL' ? mundo.papel : undefined }))
  on('mcp.call', ($, e) => {
    if (e.server === 'orkastery' && e.tool === 'ork_maestro') {
      mundo.maestro.push(e.args)
      const pagina = mundo.paginas[Number(e.args.offset ?? 0)]
      return mundo.maestroFalha || pagina === undefined ? falha('pagina fora do retrato') : ok(pagina)
    }
    if (e.server === 'orkastery' && e.tool === 'ork_claims_list') {
      mundo.claimsPedidas.push(e.args)
      const lista = mundo.claims[e.args.threadId]
      return lista ? ok(lista) : falha('thread sem claims')
    }
    if (e.server === 'ponte-falsa') {
      if (e.tool === 'faixa') { mundo.faixas.push(e.args); return ok({ publicada: e.args.texto !== undefined }) }
      if (e.tool === 'mostrado') { mundo.mostrados.push(e.args); return ok(null) }
    }
    mundo.outrasMcp.push({ server: e.server, tool: e.tool, args: e.args })
    return falha('ferramenta fora da lista')
  })
  on('process.run', ($, e) => { mundo.processos.push(e.argv); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('fs.read', ($, e) => { mundo.lidos.push(e.path); return { value: '' } })
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { mundo.abertos.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: mundo.paineis }))
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  return mundo
}

/** O inicio de uma sessao interativa no terminal; `false` e uma sessao sem pessoa (`-p` ou SDK). */
export async function iniciar($, interativa = true) {
  await $.session.start({ cwd: '/projeto', surface: interativa ? 'terminal' : null, isInteractive: interativa })
}

/** O `/nota` como o dono o digita; `args` e a thread que a Torre manda. */
export async function abrirNota($, args = '') {
  return $.command.run({ command: 'nota', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

/** Espera o trabalho em segundo plano do Ritual (o kit nao tem relogio no `$`): temporizador real, em passos curtos. */
export async function esperar(condicao: () => boolean, passos = 200) {
  for (let i = 0; i < passos && !condicao(); i++) await new Promise(r => setTimeout(r, 2))
}

/** O painel montado numa superficie, com a janela de rolagem que o teste escolhe. */
export async function montarPainel($, surface, janela?) {
  return $.ui.mount({ plugin: 'ork-ritual', surface, component: 'Pane', requestId: 'ritual', props: { ...PANE, ...(janela ? { scroll: janela } : {}) } })
}

/** Os textos de `Text` e `Button` de um painel montado, na ordem do desenho. */
export async function textosDe(ui) {
  return (await ui.findAll({})).filter(e => e.type === 'Text' || e.type === 'Button').map(e => e.text)
}

/** Os textos do painel montado numa superficie. */
export async function textosDoPainel($, surface) {
  const ui = await montarPainel($, surface)
  const textos = await textosDe(ui)
  await ui.unmount()
  return textos
}
