// Apoio dos testes do kit do Radar. O Radar lê o núcleo pelo `$.ork` da ponte, e o kit não carrega a ponte de
// verdade (teste do kit não importa arquivo fora da pasta do plugin): esta ponte falsa, inline, acrescenta o noun
// no `engine.create`. O retrato sai do `mcp.call` do fundo para `ork_maestro`, como na ponte real; a lista
// fechada, a faixa e o mostrado saem do `mcp.call` para o servidor `ponte-falsa`, onde o teste os lê. O papel vem
// da variável `PONTE_FALSA_PAPEL` do ambiente do teste. O kit não tem disco nem processo: o git, o `mktemp` e o
// `rm` respondem pelo fundo `process.run`, com saídas fixas que o teste escolhe.
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
          const r = await built.mcp.call('orkastery', 'ork_maestro', { section: pedido?.secao, offset: pedido?.offset ?? 0 })
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

export const NUL = String.fromCharCode(0)
/** Um relógio na época de hoje, para erro relativo ao zero não passar despercebido. */
export const EPOCA = 1760000000000
export const P = { isFullscreen: true, columns: 160 }
export const TEMPORARIO = '/tmp/ork-radar.Ab12Cd34'
export const BASE = 'refs/remotes/origin/main'
/** Um SHA de 40 caracteres feito de um caractere só. */
export const sha = (c: string) => c.repeat(40)
export const ARVORE = sha('e')

/** A saída do `merge-tree` para um par limpo. */
export const limpo = () => ({ exitCode: 0, stdout: ARVORE + NUL, stderr: '' })
/** A saída do `merge-tree` para um par em conflito nos arquivos dados. */
export const conflito = (...arquivos: string[]) => ({ exitCode: 1, stdout: [ARVORE, ...arquivos, ''].join(NUL), stderr: '' })
/** A chave de um par de SHAs, como o fundo a procura. */
export const chave = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

const ok = valor => ({ value: { content: [{ type: 'text', text: JSON.stringify(valor) }], isError: false } })
const falha = () => ({ value: { content: [{ type: 'text', text: '{"erro":"falhou"}' }], isError: true } })

function secao(items, extra = {}) {
  return {
    state: items.length ? 'available' : 'empty', source: 'teste', observedAt: '2026-01-01T00:00:00.000Z', fingerprint: null,
    coverage: { total: items.length, offset: 0, returned: items.length, omitted: 0, nextOffset: null, limit: 50 }, items, gaps: [], ...extra,
  }
}

/** Um lease do retrato (`ork.maestro-snapshot/v1`, seção `leases`). */
export function lease(nome: string, thread: string, status = 'active') {
  return { id: nome, title: 'Região reservada', status, refs: [{ kind: 'thread', id: thread }], facts: { expiresAt: '2026-01-01T01:00:00.000Z' } }
}

/**
 * O retrato com a seção `leases`, só com o que o Radar lê: a página que começa em `offset`, com `tamanho` itens e o
 * `nextOffset` da seguinte, como o núcleo pagina; `indisponivel` imita a seção que não pôde ser lida.
 */
export function retratoDosLeases(leases, offset = 0, tamanho = 50, indisponivel = false) {
  const pagina = indisponivel ? [] : leases.slice(offset, offset + tamanho)
  const fim = offset + pagina.length
  const extra = indisponivel
    ? { state: 'unavailable', gaps: ['leases.unavailable'] }
    : { coverage: { total: leases.length, offset, returned: pagina.length, omitted: Math.max(0, leases.length - fim), nextOffset: fim < leases.length ? fim : null, limit: tamanho } }
  return { schema: 'ork.maestro-snapshot/v1', observedAt: '2026-01-01T00:00:00.000Z', gaps: [], conflicts: [], sections: { leases: secao(pagina, extra) } }
}

/** A resposta do fundo a um argv do Radar: o git, o `mktemp` e o `rm`, pelo mundo do teste. */
function responder(mundo, argv: string[]) {
  const [programa, sub] = argv
  if (programa === 'git' && sub === 'ls-remote' && argv[2] === '.') {
    const linhas = argv.slice(3).filter(ref => mundo.refs[ref] !== undefined).map(ref => `${mundo.refs[ref]}\t${ref}`)
    return { exitCode: 0, stdout: linhas.map(l => l + '\n').join(''), stderr: '' }
  }
  if (programa === 'git' && sub === 'ls-remote' && argv[2] === 'origin') {
    if (mundo.remoto === null) return { exitCode: 128, stdout: '', stderr: 'fatal: unable to access the remote\n' }
    return { exitCode: 0, stdout: `${mundo.remoto}\trefs/heads/main\n`, stderr: '' }
  }
  if (programa === 'mktemp') return { exitCode: 0, stdout: mundo.temporario + '\n', stderr: '' }
  if (programa === 'rm') return { exitCode: 0, stdout: '', stderr: '' }
  if (programa === 'git' && sub === 'merge-tree') {
    const [a, b] = argv.slice(-2)
    return mundo.merges[chave(a, b)] ?? limpo()
  }
  return { exitCode: 127, stdout: '', stderr: `comando inesperado no teste: ${argv.join(' ')}` }
}

/**
 * Monta o fundo do teste: o papel, as threads abertas, os leases, os SHAs e as saídas do git, o registro de
 * comando e o que o Radar pede à ponte. Devolve o mundo, que o teste muda entre rodadas e confere.
 */
export function montar(on, opcoes) {
  // O status de cada thread aberta: por padrão, `base.branch` igual a `ork/<slug>`, como o núcleo cria.
  const statusPadrao = Object.fromEntries(opcoes.abertas.map(t => [t.id, { id: t.id, slug: t.slug, base: { branch: `ork/${t.slug}` } }]))
  const mundo = {
    abertas: opcoes.abertas, refs: { ...opcoes.refs }, remoto: opcoes.remoto === undefined ? opcoes.refs[BASE] : opcoes.remoto,
    merges: { ...(opcoes.merges ?? {}) }, leases: opcoes.leases ?? [], status: { ...statusPadrao, ...(opcoes.status ?? {}) },
    statusFalha: new Set(opcoes.statusFalha ?? []), tamanhoDaPagina: opcoes.tamanhoDaPagina ?? 50, leasesIndisponiveis: false,
    atrasoDoMerge: opcoes.atrasoDoMerge ?? 0,
    temporario: opcoes.temporario ?? TEMPORARIO, gitArquivo: opcoes.gitArquivo ?? null, commondir: opcoes.commondir ?? null,
    paineis: opcoes.paineis ?? [], listaFalha: false, retratoFalha: false,
    processos: [], ler: [], maestro: [], faixas: [], mostrados: [], comandos: [], abertos: [], toasts: [], lidos: [],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', ($, e) => ({ value: e.name === 'PONTE_FALSA_PAPEL' ? opcoes.papel : undefined }))
  on('mcp.call', ($, e) => {
    if (e.server === 'orkastery' && e.tool === 'ork_maestro') {
      mundo.maestro.push(e.args)
      return mundo.retratoFalha ? falha() : ok(retratoDosLeases(mundo.leases, e.args.offset ?? 0, mundo.tamanhoDaPagina, mundo.leasesIndisponiveis))
    }
    if (e.server === 'ponte-falsa') {
      if (e.tool === 'ler') {
        mundo.ler.push(e.args)
        if (e.args.consulta === 'thread.list') {
          return mundo.listaFalha ? falha() : ok({ todas: false, total: mundo.abertas.length, threads: mundo.abertas })
        }
        if (e.args.consulta === 'thread.status') {
          const s = mundo.status[e.args.thread]
          return s === undefined || mundo.statusFalha.has(e.args.thread) ? falha() : ok(s)
        }
        return falha()
      }
      if (e.tool === 'faixa') { mundo.faixas.push(e.args); return ok({ publicada: e.args.texto !== undefined }) }
      if (e.tool === 'mostrado') { mundo.mostrados.push(e.args); return ok(null) }
      return falha()
    }
    return falha()
  })
  on('command.register', ($, e) => { mundo.comandos.push(e.name); return { value: { command: e.name } } })
  on('ui.open', ($, e) => { mundo.abertos.push(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: mundo.paineis }))
  on('ui.toast', ($, e) => { mundo.toasts.push(e.text); return { value: undefined } })
  // O `merge-tree` pode responder atrasado pelo relógio falso do teste (`opcoes.relogio`), para o orçamento da rodada.
  on('process.run', async ($, e) => {
    mundo.processos.push({ argv: e.argv, init: e.init })
    if (e.argv[1] === 'merge-tree' && mundo.atrasoDoMerge > 0 && opcoes.relogio) await opcoes.relogio.sleep(mundo.atrasoDoMerge)
    return { value: responder(mundo, e.argv) }
  })
  on('fs.stat', ($, e) => {
    if (e.path !== '/p/.git') return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } }
    return { value: { kind: mundo.gitArquivo === null ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', ($, e) => {
    mundo.lidos.push(e.path)
    if (e.path === '/p/.git' && mundo.gitArquivo !== null) return { value: mundo.gitArquivo }
    if (e.path.endsWith('/commondir') && mundo.commondir !== null) return { value: mundo.commondir }
    throw new Error(`ENOENT: ${e.path}`)
  })
  return mundo
}

/** O início de uma sessão interativa no terminal; `false` é uma sessão sem pessoa (`-p` ou SDK). */
export async function iniciar($, interativa = true) {
  await $.session.start({ cwd: '/p', surface: interativa ? 'terminal' : null, isInteractive: interativa })
}

/** O `/radar` como o dono o digita. */
export async function radar($) {
  return $.command.run({ command: 'radar', args: '', origin: { kind: 'composer' }, presentation: P })
}

/** Os argv que o Radar rodou, um por linha, para comparar sem o ambiente. */
export function argvs(mundo) {
  return mundo.processos.map(p => p.argv.join(' '))
}

export const PANE = { title: 'Radar', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} }
/** O painel do Radar posto e à vista do dono, como `$.ui.panes()` o lista. */
export const A_VISTA = [{ id: 'radar', title: 'Radar', isShown: true, isFocused: false, isPlaced: true }]

/** O painel montado numa superfície; `janela` troca a janela de rolagem. */
export async function montarPainel($, surface, janela?) {
  return $.ui.mount({ plugin: 'ork-radar', surface, component: 'Pane', requestId: 'radar', props: janela ? { ...PANE, scroll: janela } : PANE })
}

/** Os textos de `Text` e `Button` de um painel já montado, na ordem do desenho. */
export async function textosDe(ui) {
  return (await ui.findAll({})).filter(e => e.type === 'Text' || e.type === 'Button').map(e => e.text)
}

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 padrão para bytes, sem depender do ambiente do kit (que não tem `Buffer`). */
export function deBase64(texto: string): number[] {
  const bytes: number[] = []
  const limpo = texto.replace(/=+$/, '')
  for (let i = 0; i < limpo.length; i += 4) {
    const n = [0, 1, 2, 3].map(k => (i + k < limpo.length ? ALFABETO.indexOf(limpo[i + k] as string) : 0))
    const v = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3]
    bytes.push((v >> 16) & 255)
    if (i + 2 < limpo.length) bytes.push((v >> 8) & 255)
    if (i + 3 < limpo.length) bytes.push(v & 255)
  }
  return bytes
}

/** Uma célula do `Raster`: o caractere, a frente e o fundo, pela linha e pela coluna de terminal. */
export function celulaDoRaster(props, linha: number, coluna: number) {
  const bytes = deBase64(props.cells)
  const u32 = (j: number) => ((bytes[j] as number) | ((bytes[j + 1] as number) << 8) | ((bytes[j + 2] as number) << 16) | ((bytes[j + 3] as number) << 24)) >>> 0
  const i = (linha * props.columns + coluna) * 12
  return { ch: String.fromCodePoint(u32(i)), frente: u32(i + 4), fundo: u32(i + 8) }
}
