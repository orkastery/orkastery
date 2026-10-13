// Apoio dos testes do kit do Mensageiro de Sessoes. O kit nao carrega `dependencies` nem importa arquivo de fora da
// pasta do mod, e o plugin inline do teste roda serializado, sem as variaveis deste arquivo: a ponte falsa e
// autocontida. Ela segue o contrato do `$.ork` da `ork-ponte` no que o Mensageiro usa: o papel e a thread vem do
// `env.get` (`ORK_TESTE_PAPEL`, `ORK_TESTE_THREAD`), o retrato vem do `ork_maestro` pelo `mcp.call`, e a faixa e o
// mostrado vao ao servidor `ponte-falsa`, onde o teste os le. O nucleo embaixo responde as duas ferramentas da
// entrega pelo fundo `mcp.call`, com o mundo que o teste escolhe; a fila do modelo da sessao de fase e o fundo
// `session.receive`, e a linha da mensagem e o fundo `ui.render` do `UserMessage`. Respostas e mensagens SIMULADAS.
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
        contexto: async () => {
          const p = await papel()
          const thread = await built.env.get('ORK_TESTE_THREAD')
          return { papel: p, thread: p === 'fase' && thread ? thread : null, raiz: '/projeto' }
        },
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
export const PANE = { title: 'Mensageiro de Sessões', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
/** O painel posto e a vista do dono, como `$.ui.panes()` o lista. */
export const A_VISTA = [{ id: 'mensageiro', title: 'Mensageiro de Sessões', isShown: true, isFocused: false, isPlaced: true }]
export const THREAD = 'ork-a'
export const SESSAO = '11111111-2222-4333-8444-555555555555'
export const PEDIDO = 'a1a1a1a1-b2b2-4c3c-8d4d-e5e5e5e5e5e5'
export const ENVIO = 'f0f0f0f0-e1e1-4d2d-8c3c-b4b4b4b4b4b4'
export const RESPOSTA = 'RESPOSTA-SIMULADA: pode apagar a pasta de cache'
export const MARCA = 'ork.session-delivery/v1'

/** A mensagem que o nucleo compoe para a entrega (o mesmo cabecalho de `core/src/entrega-por-mod.ts`). */
export function mensagemDe(pedido = PEDIDO, envio = ENVIO, resposta = RESPOSTA) {
  return `[${MARCA} pedido=${pedido} entrega=${envio}] Resposta do dono à pergunta deste turno, conferida pelo núcleo do Orkastery:\n${resposta}`
}

/** Uma entrega da caixa de saida como o `listar` a da. */
export function entradaDe(o: { thread?: string; pedido?: string; envio?: string; sessao?: string; tentativas?: number;
  ultimoEnvio?: { em: number; entregue: boolean; motivo?: string | null } | null; reservada?: boolean } = {}) {
  const pedido = o.pedido ?? PEDIDO, envio = o.envio ?? ENVIO
  return { thread: o.thread ?? THREAD, pedidoId: pedido, envioId: envio, fase: 'GO', sessionId: o.sessao ?? SESSAO,
    mensagem: mensagemDe(pedido, envio), criadaEm: new Date(EPOCA - 1000).toISOString(), tentativas: o.tentativas ?? 0,
    ultimoEnvio: o.ultimoEnvio ? { em: new Date(o.ultimoEnvio.em).toISOString(), entregue: o.ultimoEnvio.entregue, motivo: o.ultimoEnvio.motivo ?? null } : null,
    reservada: o.reservada ?? false }
}

function secao(items) {
  return { state: items.length ? 'available' : 'empty', source: 'teste', observedAt: new Date(EPOCA).toISOString(), items, gaps: [] }
}

/** O retrato com a secao `hitl`: um item por pedido aberto, e `incerto` para a entrega em curso. */
export function retratoHitl(itens: Array<{ pedido: string; thread?: string; incerto?: boolean; alvo?: string }>) {
  return { schema: 'ork.maestro-snapshot/v1', observedAt: new Date(EPOCA).toISOString(), gaps: [],
    sections: { hitl: secao(itens.map(i => ({ id: i.pedido, title: 'pedido', status: i.incerto ? 'delivery.uncertain' : 'aberto',
      refs: [{ kind: 'thread', id: i.thread ?? THREAD }], facts: { target: i.alvo ?? 'session', deliveryUncertain: !!i.incerto } }))) } }
}

const ok = valor => ({ value: { content: [{ type: 'text', text: JSON.stringify(valor) }], isError: false } })
const falha = (erro = 'falhou') => ({ value: { content: [{ type: 'text', text: JSON.stringify({ erro }) }], isError: true } })

/**
 * Monta o fundo do teste: o papel, o retrato, a caixa de saida e a conferencia do nucleo, o envio entre sessoes, o
 * registro de comando, o painel e o que o Mensageiro pede a ponte. Guarda cada chamada, e as que o Mensageiro nunca
 * deve fazer (processo, texto do dono, linha de usuario), para o caso negativo.
 */
export function montar(on, opcoes: { papel: string; thread?: string; caixa?: unknown[]; retrato?: unknown; paineis?: unknown[] }) {
  const mundo = {
    papel: opcoes.papel, thread: opcoes.thread ?? THREAD,
    caixa: [...(opcoes.caixa ?? [])] as any[], retrato: opcoes.retrato ?? retratoHitl([]) as unknown, paineis: opcoes.paineis ?? [],
    caixaFalha: null as string | null, anotacaoFalha: null as string | null,
    /** O que o `$.session.send` responde; o padrao e entrar na fila. */
    respostaDoEnvio: { isDelivered: true } as unknown,
    envioLanca: null as string | null,
    /** A conferencia do nucleo no receptor: o que `conferir` e `confirmar` respondem, ou `null` para recusa da ferramenta. */
    conferencia: { confirmada: false, motivo: 'entrega.formato' } as unknown, confirmacao: { ok: true, estado: 'entregue' } as unknown,
    atrasoDaConferencia: null as null | (() => Promise<void>),
    /** O que a fila do modelo responde: `null` enfileira; um texto e um plugin abaixo que consome. */
    consumoAbaixo: null as string | null,
    listar: 0, anotacoes: [] as any[], envios: [] as any[], conferencias: [] as any[], confirmacoes: [] as any[],
    filas: [] as any[], faixas: [] as any[], mostrados: [] as any[], comandos: [] as string[], abertos: [] as string[], toasts: [] as string[],
    logs: [] as any[], maestro: 0, outrasMcp: [] as any[], proibidas: [] as any[],
    /** A ordem do que aconteceu na sessao de fase: a conferencia, a fila do modelo e a confirmacao. */
    ordem: [] as string[],
    /** O texto que cada linha de mensagem recebeu para desenhar. */
    linhas: [] as string[],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.FileChanged', () => ({}))
  on('env.get', ($, e) => ({ value: e.name === 'ORK_TESTE_PAPEL' ? mundo.papel : e.name === 'ORK_TESTE_THREAD' ? mundo.thread : undefined }))
  on('mcp.call', async ($, e) => {
    if (e.server === 'orkastery' && e.tool === 'ork_maestro') { mundo.maestro++; return ok(mundo.retrato) }
    if (e.server === 'ponte-falsa') {
      if (e.tool === 'faixa') { mundo.faixas.push(e.args); return ok({ publicada: e.args.texto !== undefined }) }
      if (e.tool === 'mostrado') { mundo.mostrados.push(e.args); return ok(null) }
      return falha()
    }
    if (e.server === 'orkastery' && e.tool === 'ork_session_outbox') {
      if (e.args.operacao === 'listar') {
        mundo.listar++
        if (mundo.caixaFalha) return falha(mundo.caixaFalha)
        return ok({ contrato: 'ork.session-delivery/v1', entregas: mundo.caixa })
      }
      mundo.anotacoes.push(e.args)
      if (mundo.anotacaoFalha) return falha(mundo.anotacaoFalha)
      const i = mundo.caixa.findIndex(x => x.envioId === e.args.envioId)
      if (i < 0) return falha('entrega.desconhecida')
      const agora = await $.clock.now().catch(() => EPOCA)
      mundo.caixa[i] = { ...mundo.caixa[i], tentativas: mundo.caixa[i].tentativas + 1,
        ultimoEnvio: { em: new Date(agora).toISOString(), entregue: e.args.entregue, motivo: e.args.motivo ?? null } }
      const { reservada: _r, ...entrega } = mundo.caixa[i]
      return ok({ contrato: 'ork.session-delivery/v1', entrega })
    }
    if (e.server === 'orkastery' && e.tool === 'ork_session_inbox') {
      if (e.args.operacao === 'conferir') {
        mundo.conferencias.push(e.args)
        mundo.ordem.push('conferir')
        if (mundo.atrasoDaConferencia) await mundo.atrasoDaConferencia()
        return mundo.conferencia === null ? falha('o servidor do núcleo caiu') : ok(mundo.conferencia)
      }
      mundo.confirmacoes.push(e.args)
      mundo.ordem.push('confirmar')
      return mundo.confirmacao === null ? falha('o servidor do núcleo caiu') : ok(mundo.confirmacao)
    }
    mundo.outrasMcp.push({ server: e.server, tool: e.tool, args: e.args })
    return falha('ferramenta fora da lista')
  })
  on('session.send', ($, e) => {
    mundo.envios.push({ to: e.to, text: e.text, origin: e.origin })
    if (mundo.envioLanca) throw new Error(mundo.envioLanca)
    return mundo.respostaDoEnvio
  })
  // A fila do modelo, embaixo do receptor: o que chega aqui entrou na conversa da sessao de fase.
  on('session.receive', ($, e) => {
    mundo.ordem.push('fila')
    if (mundo.consumoAbaixo) return { consumed: mundo.consumoAbaixo }
    mundo.filas.push({ text: e.text, origin: e.origin, agentId: e.agentId })
    return { text: e.text }
  })
  // A linha da mensagem como o Claude Code a desenharia: o texto que chegou ate aqui.
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    mundo.linhas.push(e.props.text)
    return { type: 'Text', children: [e.props.text] }
  })
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { mundo.abertos.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: mundo.paineis }))
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($, e) => { mundo.logs.push({ text: e.text, to: e.to }); return { value: undefined } })
  on('process.run', ($, e) => { mundo.proibidas.push({ evento: 'process.run', argv: e.argv }); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('prompt.submit', () => { mundo.proibidas.push({ evento: 'prompt.submit' }); return { drop: 'teste' } })
  on('session.append', () => { mundo.proibidas.push({ evento: 'session.append' }); return { deny: 'teste' } })
  return mundo
}

/** O inicio da sessao: a do dono e interativa no terminal; a de fase (`claude --bg`) nao tem pessoa no prompt. */
export async function iniciar($, interativa = true) {
  await $.session.start({ cwd: '/projeto', surface: interativa ? 'terminal' : null, isInteractive: interativa })
}

/** Uma entrega que chega a sessao, como o Claude Code a levanta. */
export async function receber($, origin, text, agentId?: string) {
  return $.session.receive({ origin, text, ...(agentId ? { agentId } : {}) })
}

/** A linha de mensagem desenhada numa superficie, com o texto que a sessao guardou. */
export async function montarMensagem($, surface, text, requestId = 'mensagem-1', origin: Record<string, unknown> = { kind: 'peer' }) {
  return $.ui.mount({ plugin: 'ork-mensageiro', surface, component: 'UserMessage', requestId,
    props: { text, origin, isExpanded: true, from: { name: 'sessão do dono' } } })
}

/** O `/mensageiro` como o dono o digita. */
export async function abrirMensageiro($) {
  return $.command.run({ command: 'mensageiro', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

/** Espera o trabalho em segundo plano do Mensageiro (o kit nao tem relogio no `$`): temporizador real, em passos curtos. */
export async function esperar(condicao: () => boolean, passos = 200) {
  for (let i = 0; i < passos && !condicao(); i++) await new Promise(r => setTimeout(r, 2))
}

/** O painel montado numa superficie, com a janela de rolagem que o teste escolhe. */
export async function montarPainel($, surface, janela?) {
  return $.ui.mount({ plugin: 'ork-mensageiro', surface, component: 'Pane', requestId: 'mensageiro',
    props: { ...PANE, ...(janela ? { scroll: janela } : {}) } })
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
