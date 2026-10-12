// Apoio dos testes do kit da Mesa do Dono. A Mesa le o nucleo pelo `$.ork` da ponte, e o kit nao carrega a ponte de
// verdade (teste do kit nao importa arquivo fora da pasta do plugin): esta ponte falsa, inline e autocontida, acrescenta
// o noun no `engine.create`. O retrato sai do `mcp.call` para `ork_maestro`, como na ponte real; a lista fechada, a
// faixa e o mostrado saem do `mcp.call` para o servidor `ponte-falsa`, onde o fundo do teste os responde e guarda. O
// papel vem da variavel `PONTE_FALSA_PAPEL` do ambiente do teste. Os pedidos sao sinteticos, no contrato `ork.hitl/v2`.
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
        const p = await built.env.get('PONTE_FALSA_PAPEL')
        if (p === 'erro') throw new Error('ork-ponte: o servidor do nucleo ainda nao respondeu')
        return p ?? 'dormente'
      }
      const ork = {
        papel,
        contexto: async () => ({ papel: await papel(), thread: null, raiz: '/p' }),
        retrato: async pedido => {
          const r = await built.mcp.call('orkastery', 'ork_maestro', { section: pedido && pedido.secao ? pedido.secao : null })
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
const iso = (ms: number) => new Date(ms).toISOString()
export const PANE = { title: 'Mesa do Dono', isFocused: false, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} }
/** O painel posto e a vista do dono, como `$.ui.panes()` o lista. */
export const A_VISTA = [{ id: 'mesa', title: 'Mesa do Dono', isShown: true, isFocused: false, isPlaced: true }]
export const P = { isFullscreen: true, columns: 160 }

/** Um pedido `ork.hitl/v2` de pergunta de gate, com quatro alternativas e a recomendada na terceira (c). */
export function pedidoDe(t: { id: string; thread: string; fase?: string; codigo?: string; recomendada?: string; letras?: string[];
  expirar?: string; irreversivel?: boolean; ato?: string; motivo?: string; alvo?: unknown; prazoMs?: number; tipoDeResposta?: string }) {
  const letras = t.letras ?? ['a', 'b', 'c', 'd']
  const recomendada = t.recomendada ?? 'c'
  const textos = { a: 'Aprovar com as evidências apresentadas', b: 'Solicitar revisão', c: 'Pedir o GO-FIX das claims velhas', d: 'Continuar esperando', e: 'Fechar a thread' }
  const acoes = { a: 'aprovar', b: 'recusar', c: 'responder', d: 'esperar', e: 'responder' }
  return {
    contrato: 'ork.hitl/v2', classe: 'pergunta', id: t.id, thread: t.thread, fase: t.fase ?? 'CHECK', modo: 'classic',
    criadoEm: iso(EPOCA - 14 * 60000), profundidade: 'detalhada', alvo: t.alvo ?? { tipo: 'gate', sobre: 'evidencias' },
    motivo: t.motivo ?? 'human.pending', pergunta: 'Qual é o veredito sobre as evidências do CHECK?',
    alternativas: letras.map(l => ({
      letra: l, texto: textos[l], acao: acoes[l], consequencia: `consequência de ${l}`,
      ...(l === recomendada ? { recomendada: true, porque: 'duas claims velhas reprovaram no HEAD' } : {}),
    })),
    corpo: ['Fase CHECK, motivo human.pending'], tipoDeResposta: t.tipoDeResposta ?? 'objetiva', irreversivel: t.irreversivel ?? false,
    ...(t.ato ? { ato: t.ato } : {}), codigo: t.codigo ?? 'K7Q2', prazo: iso(EPOCA + (t.prazoMs ?? 46 * 60000)),
    acaoPadraoAoExpirar: t.expirar ?? 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
  }
}

/** A pergunta de quatro alternativas da `ork-a`, que nao e obvia (o pedido espera o dono no prazo). */
export const PEDIDO_4 = pedidoDe({ id: 'p4000000-0000-4000-8000-000000000001', thread: 'ork-a' })
/** A pergunta obvia da `ork-b`: o nucleo declara que segue a recomendada (a) no prazo, sem ato e antes da entrega. */
export const PEDIDO_OBVIO = pedidoDe({ id: 'ob000000-0000-4000-8000-000000000002', thread: 'ork-b', fase: 'GO', codigo: 'B2X9',
  recomendada: 'a', letras: ['a', 'b', 'c'], expirar: 'seguir-recomendada' })

/** Uma decisao que a fabrica tomou pelo dono, como o pulse a traz. */
export function decisaoDe(t: { id: string; thread: string; minutos: number; decidido?: string; quem?: string }) {
  return {
    id: t.id, thread: t.thread, fase: 'GO', em: iso(EPOCA - t.minutos * 60000), decidido: t.decidido ?? 'A baseline do verify foi regravada depois do npm ci',
    porque: 'a worktree nasceu sem core/node_modules', comoMudar: 'Registrar decisão que reverte esta e regravar a baseline',
    custoDeReverter: { agora: 'nenhum', depois: 'regravar a baseline' }, quemDecidiu: t.quem ?? 'sessão de fase claude-bg (GO, #Auto)',
  }
}

/** O pulse (`ork.pulse/v1`) so com o que a Mesa le. */
export function pulseCom(t: { pedidos?: unknown[]; decisoes?: unknown[]; outros?: unknown[] }) {
  const humanos = (t.pedidos ?? []).map((p: any) => ({
    id: `thread:${p.thread}:${p.fase}:human.pending:ledger`, classe: 'thread', motivo: p.motivo, thread: p.thread, fase: p.fase,
    sessionId: null, desdeEm: p.criadoEm, paradaHaMin: 14, impacto: 1, pergunta: p.pergunta, opcoes: [], recomendacao: '',
    comandoResposta: `${p.codigo} ${p.alternativas.find(a => a.recomendada).letra}`, evidencia: [], fontes: ['monitor'], contextoLogs: [],
    pedido: p,
  }))
  return {
    contrato: 'ork.pulse/v1', consultadoEm: iso(EPOCA), runtime: { ok: true, detalhe: '' },
    precisaDeHumanoAgora: [...humanos, ...(t.outros ?? [])], acoesAutomaticas: [],
    resumo: { humanos: humanos.length, automaticas: 0, scores: 0, fasesOrfas: 0 }, decisoes: t.decisoes ?? [],
  }
}

/** Uma parada sem pedido, como o pulse a traz (claims que reprovaram no CHECK). */
export const PARADA = {
  id: 'thread:ork-c:CHECK:claims.failed:ledger', classe: 'thread', motivo: 'claims.failed', thread: 'ork-c', fase: 'CHECK', sessionId: null,
  desdeEm: iso(EPOCA - 3 * 3600000), paradaHaMin: 180, impacto: 2, pergunta: 'C12 saiu com codigo 1', opcoes: [],
  recomendacao: 'corrija o artefato ou a alegacao e rode ork verify de novo', comandoResposta: 'ork verify ork-c', evidencia: [], fontes: ['monitor'], contextoLogs: [],
}

/** A resposta do `ork_hitl_pending` de uma thread: os pedidos, o estado, a oferta do canal e o prazo local. */
export function pendentesDe(thread: string, pedidos: any[], canal = 'disponivel') {
  return {
    threadId: thread,
    pendencias: pedidos.map(p => ({
      pedido: p, estado: 'aberto', prazoLocal: '12/10 14:46 (horário de Brasília)',
      canais: [{ canal: 'claude-code', transporte: 'mcp-local', estado: canal, motivo: canal === 'disponivel' ? '' : 'hitl.canal.sem-conexao' },
        { canal: 'hermes', transporte: 'telegram', estado: 'indisponivel', motivo: 'hitl.credencial: ausente' }],
    })),
  }
}

/** O retrato da secao `hitl`, com o estado de cada pedido. */
export function retratoHitl(ids: string[]) {
  return {
    schema: 'ork.maestro-snapshot/v1', observedAt: iso(EPOCA), gaps: [], conflicts: [],
    sections: { hitl: { state: ids.length ? 'available' : 'empty', source: 'teste', observedAt: iso(EPOCA), items: ids.map(id => ({ id, title: id, status: 'aberto', refs: [], facts: { target: 'gate' } })), gaps: [] } },
  }
}

const ok = valor => ({ value: { content: [{ type: 'text', text: JSON.stringify(valor) }], isError: false } })
const falha = (erro = 'falhou') => ({ value: { content: [{ type: 'text', text: JSON.stringify({ erro }) }], isError: true } })

/**
 * Monta o fundo do teste: o papel, o pulse, o retrato, os pedidos de cada thread, o registro de comando, o painel, a
 * notificacao, a faixa, o mostrado e as duas ferramentas com efeito. Guarda cada chamada, e as que a Mesa nunca deve
 * fazer (processo, texto do dono, linha de usuario), para o caso negativo.
 */
export function montar(on, opcoes) {
  const mundo = {
    pulse: opcoes.pulse, retrato: opcoes.retrato ?? retratoHitl([]), pendentes: { ...(opcoes.pendentes ?? {}) }, paineis: opcoes.paineis ?? [],
    respostaDecidir: opcoes.respostaDecidir ?? null, erroDecidir: null, recusarDecisao: opcoes.recusarDecisao ?? null,
    registro: [...(opcoes.registro ?? [])],
    ler: [], maestro: 0, hitlPending: [], decidir: [], decisoes: [], outrasMcp: [], faixas: [], mostrados: [], notificacoes: [],
    comandos: [], abertos: [], toasts: [], proibidas: [],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', ($, e) => ({ value: e.name === 'PONTE_FALSA_PAPEL' ? opcoes.papel : undefined }))
  on('mcp.call', ($, e) => {
    if (e.server === 'orkastery' && e.tool === 'ork_maestro') { mundo.maestro++; return ok(mundo.retrato) }
    if (e.server === 'ponte-falsa') {
      if (e.tool === 'ler') {
        mundo.ler.push(e.args)
        return e.args.consulta === 'pulse' && mundo.pulse ? ok(mundo.pulse) : falha('pulse fora do ar')
      }
      if (e.tool === 'faixa') { mundo.faixas.push(e.args); return ok({ publicada: e.args.texto !== undefined }) }
      if (e.tool === 'mostrado') {
        mundo.mostrados.push(e.args)
        mundo.registro.push({ mod: e.args.mod, canal: e.args.canal, chave: e.args.chave ?? null, thread: e.args.thread ?? null, texto: e.args.texto })
        return ok(null)
      }
      if (e.tool === 'mostrados') return ok({ formato: 'ork.mod-mostrado/v1', itens: mundo.registro })
      return falha()
    }
    if (e.server === 'orkastery' && e.tool === 'ork_hitl_pending') {
      mundo.hitlPending.push(e.args)
      const r = mundo.pendentes[e.args.threadId]
      return r ? ok(r) : falha('thread sem pedidos')
    }
    if (e.server === 'orkastery' && e.tool === 'ork_request_decision') {
      mundo.decidir.push(e.args)
      if (mundo.erroDecidir) return falha(mundo.erroDecidir)
      return ok(mundo.respostaDecidir ?? { ok: true, pedidoId: e.args.pedidoId, estado: 'aguardando', repetida: false })
    }
    if (e.server === 'orkastery' && e.tool === 'ork_decision_record') {
      mundo.decisoes.push(e.args)
      return mundo.recusarDecisao ? falha(mundo.recusarDecisao) : ok({ ok: true, pedidoId: 'decisao-1', eventId: 'evento-1', fase: 'GO', reciboOficial: false })
    }
    mundo.outrasMcp.push({ server: e.server, tool: e.tool, args: e.args })
    return falha('ferramenta fora da lista')
  })
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { mundo.abertos.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: mundo.paineis }))
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  on('ui.notify', ($, e) => { mundo.notificacoes.push({ text: e.text, title: e.title }); return { value: { isSent: true, channel: 'iterm2' } } })
  on('process.run', ($, e) => { mundo.proibidas.push({ evento: 'process.run', argv: e.argv }); return { value: { exitCode: 1, stdout: '', stderr: '' } } })
  on('prompt.submit', ($, e) => { mundo.proibidas.push({ evento: 'prompt.submit' }); return { drop: 'teste' } })
  on('session.append', ($, e) => { mundo.proibidas.push({ evento: 'session.append' }); return { deny: 'teste' } })
  return mundo
}

/** O inicio de uma sessao interativa no terminal; `false` e uma sessao sem pessoa (`-p` ou SDK). */
export async function iniciar($, interativa = true) {
  await $.session.start({ cwd: '/p', surface: interativa ? 'terminal' : null, isInteractive: interativa })
}

/** O `/mesa` como o dono o digita; `args` e a thread que a Torre manda. */
export async function mesa($, args = '') {
  return $.command.run({ command: 'mesa', args, origin: { kind: 'composer' }, presentation: P })
}

/** Deixa o trabalho em segundo plano da Mesa (a primeira leitura, o Decidir, a releitura) terminar. */
export async function drenar(vezes = 25) {
  for (let i = 0; i < vezes; i++) await new Promise(r => setTimeout(r, 2))
}

/** O painel montado numa superficie, para o teste ler e apertar os botoes; `janela` troca a janela de rolagem. */
export async function montarPainel($, surface, janela?) {
  return $.ui.mount({ plugin: 'ork-mesa', surface, component: 'Pane', requestId: 'mesa', props: janela ? { ...PANE, scroll: janela } : PANE })
}

/** Os textos de `Text` e `Button` de um painel ja montado, na ordem do desenho. */
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
