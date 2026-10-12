// Apoio dos testes do kit da Torre. A Torre le o nucleo pelo `$.ork` da ponte, e o kit nao carrega a ponte de
// verdade (teste do kit nao importa arquivo fora da pasta do plugin): esta ponte falsa, inline, acrescenta o
// noun no `engine.create`. O retrato sai do `mcp.call` do fundo para `ork_maestro`, como na ponte real; a
// lista fechada, a faixa e o mostrado saem do `mcp.call` para o servidor `ponte-falsa`, onde o teste os le.
// O papel vem da variavel `PONTE_FALSA_PAPEL` do ambiente do teste.
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
      const papel = async () => (await built.env.get('PONTE_FALSA_PAPEL')) ?? 'dormente'
      const ork = {
        papel,
        contexto: async () => ({ papel: await papel(), thread: null, raiz: '/p' }),
        retrato: async pedido => {
          const r = await built.mcp.call('orkastery', 'ork_maestro', { threadId: pedido.thread })
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

export const PANE = { title: 'Torre', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
export const P = { isFullscreen: true, columns: 160 }

const ok = valor => ({ value: { content: [{ type: 'text', text: JSON.stringify(valor) }], isError: false } })
const falha = () => ({ value: { content: [{ type: 'text', text: '{"erro":"falhou"}' }], isError: true } })

function secao(items) {
  return {
    state: items.length ? 'available' : 'empty', source: 'teste', observedAt: '2026-01-01T00:00:00.000Z', fingerprint: null,
    coverage: { total: items.length, offset: 0, returned: items.length, omitted: 0, nextOffset: null, limit: 50 }, items, gaps: [],
  }
}

/**
 * O retrato de uma thread (`ork.maestro-snapshot/v1`), so com o que a Torre le. `acoes` lista as operacoes
 * com `available: true`; as outras do enum do nucleo vem indisponiveis.
 */
export function retratoDe(t) {
  const refs = [{ kind: 'thread', id: t.thread }]
  const operacoes = ['thread.status', 'thread.observe', 'git.status', 'git.commit', 'verify', 'ship', 'hitl.decide', 'retry', 'master', 'phase']
  return {
    schema: 'ork.maestro-snapshot/v1', observedAt: '2026-01-01T00:00:00.000Z', gaps: [], conflicts: [],
    sections: {
      threads: secao([{ id: t.thread, title: t.thread, status: 'aberta', refs: [], facts: { phase: t.fase, mode: t.modo, sessionCount: 1, block: 'full' } }]),
      sessions: secao([
        { id: 'sessao-1', title: `claude-bg · ${t.fase}`, status: t.conducao ? 'working' : 'unknown', refs,
          facts: { runtime: 'claude-bg', phase: t.fase, nativeConfirmed: !!t.conducao, phaseResult: false,
            ...(t.conducao ? { conduction: t.conducao } : {}), reason: '' } },
      ]),
      blockers: secao(t.motivo ? [{ id: `gate:${t.thread}`, title: t.motivo, status: 'blocked', refs, facts: { reason: t.motivo } }] : []),
      hitl: secao((t.pedidos ?? []).map(p => ({ id: p.id, title: p.texto, status: p.status ?? 'open', refs,
        facts: { deadline: '', deadlineLocal: p.prazo ?? '', target: 'gate', recommendation: p.recomendacao ?? '', deliveryUncertain: false, reason: '' } }))),
      leases: secao([]), retries: secao([]), ship: secao([]), master: secao([]), portfolio: secao([]), demands: secao([]),
      nextActions: secao(operacoes.map(op => ({ id: `${op}:${t.thread}`, title: op, status: (t.acoes ?? []).includes(op) ? 'proposed' : 'unavailable', refs, facts: {},
        action: { operation: op, available: (t.acoes ?? []).includes(op), reason: '', preconditions: [], readback: 'ork_thread_status' } }))),
    },
  }
}

/**
 * Monta o fundo do teste: o papel, as threads abertas e os retratos, o registro de comando, o painel e o que
 * a Torre pede a ponte e ao MCP. Devolve o que foi pedido, para o teste conferir.
 */
export function montar(on, opcoes) {
  const mundo = { abertas: opcoes.abertas, retratos: { ...opcoes.retratos }, paineis: opcoes.paineis ?? [],
    maestro: [], ler: [], mcp: [], faixas: [], mostrados: [], comandos: [], abertos: [], toasts: [], rodados: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.FileChanged', () => ({}))
  on('env.get', ($, e) => ({ value: e.name === 'PONTE_FALSA_PAPEL' ? opcoes.papel : undefined }))
  on('mcp.call', ($, e) => {
    if (e.server === 'orkastery' && e.tool === 'ork_maestro') {
      mundo.maestro.push(e.args.threadId)
      const r = mundo.retratos[e.args.threadId]
      return r ? ok(r) : falha()
    }
    if (e.server === 'ponte-falsa') {
      if (e.tool === 'ler') {
        mundo.ler.push(e.args)
        if (e.args.consulta === 'thread.list') return ok({ todas: false, total: mundo.abertas.length, threads: mundo.abertas.map(id => ({ id, status: 'aberta' })) })
        return falha()
      }
      if (e.tool === 'faixa') { mundo.faixas.push(e.args); return ok({ publicada: e.args.texto !== undefined }) }
      if (e.tool === 'mostrado') { mundo.mostrados.push(e.args); return ok(null) }
      return falha()
    }
    mundo.mcp.push(e)
    return falha()
  })
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { mundo.abertos.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: mundo.paineis }))
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  on('command.run', ($, e) => { mundo.rodados.push({ command: e.command, args: e.args }); return { text: 'ok' } })
  return mundo
}

/** O inicio de uma sessao interativa do dono no terminal. */
export async function iniciar($) {
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
}

/** O `/torre` como o dono o digita. */
export async function torre($) {
  return $.command.run({ command: 'torre', args: '', origin: { kind: 'composer' }, presentation: P })
}

/** Os textos do painel montado numa superficie. */
export async function textosDoPainel($, surface) {
  const ui = await $.ui.mount({ plugin: 'ork-torre', surface, component: 'Pane', requestId: 'torre', props: PANE })
  const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return textos
}
