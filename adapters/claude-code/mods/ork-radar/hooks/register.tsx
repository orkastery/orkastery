// O Radar de Colisão do Orkastery (RM-059, fatia F3; ficha M10 do plano dos mods). Na sessão do dono, calcula sem
// worktree o merge de cada thread aberta contra a origin/main local e entre as threads, cruza os conflitos com os
// leases e desenha o mapa de calor num painel; a colisão nova vira uma linha na faixa pela ponte, e o que o dono
// viu entra no registro da ponte (M5 do dono). Lê o núcleo pela ponte (`$.ork`), nunca `.orkastery/` por conta
// própria; do git, só ls-remote e merge-tree com objetos temporários (D6 do dono). Só lê: nenhum caminho daqui
// age pelo dono. A lógica fica nos módulos puros ao lado; aqui só os ganchos e as chamadas ao `$`, sempre
// escritas como `x.noun.metodo(...)`, como o validador exige.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { RadarMapa, RadarThread } from '../types'
import {
  AMBIENTE_DO_GIT, ambienteDoMerge, anterioresDoMapa, argvDeApagar, argvDoLsRemoteLocal, argvDoLsRemoteRemoto, argvDoMergeTree,
  argvDoTemporario, baseDoMapa, branchCanonica, celulaDoPar, chaveDoPar, colisoesDoMapa, contar, gitdirDoArquivo, guardarNoCache, juntar,
  LEITURAS_EM_PARALELO, lerLsRemote, lerMergeTree, objetosDoComum, ORCAMENTO_DO_MERGE_MS, paginaDosLeases, paresComColisaoNova,
  paresDaRodada, PERIODO_DA_RODADA_MS, PRAZO_DO_MERGE_MS, PRAZO_DO_REMOTO_MS, PRAZO_LOCAL_MS, REF_DA_BASE, REF_REMOTA, refDoStatus,
  resumoDoMapa, rotuloDe, temporarioValido, TETO_DE_PAGINAS_DE_LEASES, threadsDaLista,
} from './colisao'
import type { LeaseDePath, Par, Resultado, ThreadDaLista } from './colisao'
import { desenharPainel, linhasDoPainel, mostradosDoMapa, mostradosVisiveis, novasDepoisDaRodada, textoDaFaixa } from './mapa'
import type { ElementosDoPainel, RadarMostrado } from './mapa'

const MOD = 'ork-radar'
const PAINEL = 'radar'
const TITULO = 'Radar'
const MAPA_VAZIO: RadarMapa = {
  threads: [], base: { ref: REF_DA_BASE, sha: null, remoto: null, situacao: 'nao-conferida', erroRemoto: null },
  celulas: [], omitidas: 0, lacunas: [], lidoEm: null, erro: null,
}
const mapa = atom({ plugin: 'ork-radar', key: 'mapa' } as const, MAPA_VAZIO)
const novas = atom({ plugin: 'ork-radar', key: 'novas' } as const, [] as string[])
/** O servidor do núcleo pode conectar depois do início da sessão: o papel é conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
/** Depois delas, enquanto dormente, a cada 5 min. */
const ESPERA_LONGA_DO_PAPEL_MS = 300000
/** Teto de cada leitura pela ponte, que já tem o próprio teto de 10 s no CLI. */
const PRAZO_DA_PONTE_MS = 20000
/** A primeira rodada sai logo depois da ativação, fora do início da sessão. */
const ESPERA_DA_PRIMEIRA_MS = 1000
/** O que o desenho anotou vai ao registro da ponte, fora do desenho, a cada minuto. */
const PERIODO_DO_REGISTRO_MS = 60000

// O que o módulo guarda entre ganchos e não desenha. Uma recarga do módulo zera tudo, e o `session.start`
// dispara de novo nela; o mapa, as colisões novas e a linha da faixa (na ponte) ficam em `$.state`.
let ativa = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let registro: { cancel: () => void } | undefined
let rodando: Promise<void> | undefined
let pendente = false
/** O resultado de cada par de SHAs já calculado nesta carga (D12): par que não andou não roda de novo. */
const cache = new Map<string, Resultado>()
/** A branch de cada thread pelo `base.branch` do `thread.status` (null: vale a `ork/<slug>`), lida uma vez por carga. */
const branchDoStatus = new Map<string, string | null>()
/** O diretório de objetos do repositório, achado uma vez por carga. */
let objetos: string | undefined
/**
 * O `lidoEm` do último mapa que uma rodada desta carga gravou. A leitura de `$.state` num despacho vê o momento em
 * que ele começou, e não a gravação que outro despacho faz no meio: quem compara a versão do mapa visto com a atual
 * usa esta variável. Undefined até a primeira rodada desta carga gravar.
 */
let versaoGravada: number | null | undefined
/** As colisões (par e arquivo) da rodada anterior; null até a primeira rodada desta carga ler o mapa guardado (D6). */
let anteriores: Set<string> | null = null
/**
 * A última linha publicada na faixa. `null` é "não sei": uma carga nova não sabe o que a anterior deixou na faixa
 * da ponte, então a primeira publicação sempre acontece, inclusive a que tira a linha.
 */
let ultimaFaixa: string | undefined | null = null
/**
 * O que o desenho pôs na janela de rolagem e ainda não foi ao registro da ponte, com a versão do mapa desenhado
 * (`lidoEm`): anotação de um desenho anterior à última rodada não vale, porque o texto da tela era outro.
 */
const vistosNoDesenho = new Map<string, { visto: RadarMostrado; versao: number | null }>()
/** O que já foi ao registro nesta carga, por chave e texto, com a chave do par; sai quando o conflito some do mapa. */
const jaMostrado = new Map<string, string>()

function mensagem(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).replace(/\s+/g, ' ').trim().slice(0, 200)
}

function primeiraLinha(texto: string): string {
  return String(texto ?? '').trim().split('\n')[0]?.trim().slice(0, 200) ?? ''
}

/** A leitura com teto próprio: o relógio da sessão recusa a espera que passar dele. */
function comPrazo<T>($: EngineInterface, leitura: Promise<T>, ms = PRAZO_DA_PONTE_MS): Promise<T> {
  return new Promise<T>((resolver, recusar) => {
    const prazo = $.clock.after(ms, () => recusar(new Error(`a leitura passou de ${Math.round(ms / 1000)} s`)))
    leitura.then(v => { prazo.cancel(); resolver(v) }, e => { prazo.cancel(); recusar(e) })
  })
}

/**
 * O papel pela ponte. `null` só quando o `$.ork` não existe (a ponte não carregou: a chamada nem acontece);
 * uma falha da própria ponte conta como dormente e o papel é conferido de novo depois.
 */
async function papelDaSessao($: EngineInterface): Promise<string | null> {
  try {
    return String(await $.ork.papel())
  } catch (erro) {
    return erro instanceof TypeError ? null : 'dormente'
  }
}

/** Liga o Radar na sessão do dono: o `/radar`, a rodada de 10 min, o registro do mostrado e a primeira rodada. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  await $.command.register({
    name: 'radar', description: 'Radar de Colisão: onde cada thread aberta colide com a origin/main e com as outras, antes do SHIP',
    immediate: true,
  })
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DA_RODADA_MS, () => { void pedirRodada($) })
  registro?.cancel()
  registro = $.clock.every(PERIODO_DO_REGISTRO_MS, () => { void registrarMostrados($) })
  $.clock.after(ESPERA_DA_PRIMEIRA_MS, () => { void pedirRodada($) })
}

/** Confere o papel: liga no dono, desiste na fase ou sem a ponte, e tenta de novo enquanto dormente. */
async function conferirPapel($: EngineInterface, tentativa: number): Promise<void> {
  if (ativa || desistiu) return
  const papel = await papelDaSessao($)
  if (papel === 'dono') return ativar($)
  if (papel === 'fase' || papel === null) {
    desistiu = true
    if (papel === null) $.ui.toast('radar: a ponte ork-ponte não carregou; o Radar de Colisão fica desligado nesta sessão')
    return
  }
  const espera = ESPERAS_DO_PAPEL_MS[tentativa] ?? ESPERA_LONGA_DO_PAPEL_MS
  $.clock.after(espera, () => { void conferirPapel($, tentativa + 1) })
}

/**
 * Uma rodada por vez. Com uma rodada em andamento, o pedido só marca que outra deve rodar logo depois e volta sem
 * nada para esperar: quem pediu (o `/radar`, o botão, o relógio) nunca espera a rodada de outro despacho, cuja
 * espera contaria no orçamento do gancho do host. Devolve a rodada só a quem a começou.
 */
function pedirRodada($: EngineInterface): Promise<void> | undefined {
  if (!ativa) return undefined
  if (rodando) {
    pendente = true
    return undefined
  }
  const esta = (async () => {
    try {
      do {
        pendente = false
        await rodadaUmaVez($)
      } while (pendente)
    } finally {
      rodando = undefined
    }
  })()
  rodando = esta
  return esta
}

/** A rodada parou antes do mapa: o mapa anterior fica, com o motivo. */
async function gravarErro($: EngineInterface, erro: string): Promise<void> {
  await update($, mapa, anterior => ({ ...anterior, erro }))
}

/** O SHA da base e de cada ref pedida, pelo `ls-remote` no próprio repositório. */
async function lerShas($: EngineInterface, raiz: string, refs: readonly string[]): Promise<Record<string, string>> {
  const r = await $.process.run(argvDoLsRemoteLocal(refs), { cwd: raiz, env: { ...AMBIENTE_DO_GIT }, timeoutMs: PRAZO_LOCAL_MS })
  if (r.exitCode !== 0) throw new Error(primeiraLinha(r.stderr) || `o ls-remote saiu ${r.exitCode}`)
  return lerLsRemote(r.stdout)
}

/** O SHA da `main` do `origin` (D4); falha vira "não conferida" e a rodada segue. */
async function lerRemoto($: EngineInterface, raiz: string): Promise<{ sha: string | null; erro: string | null }> {
  try {
    const r = await $.process.run(argvDoLsRemoteRemoto(), { cwd: raiz, env: { ...AMBIENTE_DO_GIT }, timeoutMs: PRAZO_DO_REMOTO_MS })
    if (r.exitCode !== 0) return { sha: null, erro: primeiraLinha(r.stderr) || `o ls-remote saiu ${r.exitCode}` }
    const sha = lerLsRemote(r.stdout)[REF_REMOTA] ?? null
    return { sha, erro: sha === null ? 'o remoto não listou a main' : null }
  } catch (erro) {
    return { sha: null, erro: mensagem(erro) }
  }
}

/**
 * A branch canônica de cada thread, como o núcleo a decide (`branchDaWorktree`): o `base.branch` do `thread.status`
 * quando começa com `ork/`, senão `ork/<slug>`. O status de cada thread é lido uma vez por carga, algumas por vez;
 * leitura que falha usa a `ork/<slug>` nesta rodada, vira lacuna e é tentada de novo na seguinte.
 */
async function branchesDasThreads($: EngineInterface, threads: readonly ThreadDaLista[], lacunas: string[]): Promise<Map<string, string>> {
  const faltam = threads.filter(t => !branchDoStatus.has(t.id))
  for (let i = 0; i < faltam.length; i += LEITURAS_EM_PARALELO) {
    await Promise.all(faltam.slice(i, i + LEITURAS_EM_PARALELO).map(async t => {
      try {
        branchDoStatus.set(t.id, refDoStatus(await comPrazo($, $.ork.ler({ consulta: 'thread.status', thread: t.id }))))
      } catch (erro) {
        lacunas.push(`status de ${t.id} não lido; vale a ork/${t.slug} nesta rodada (${mensagem(erro)})`)
      }
    }))
  }
  return new Map(threads.map(t => [t.id, branchCanonica(branchDoStatus.get(t.id) ?? null, t.slug)]))
}

/** Os leases `path:` ativos de todas as páginas da seção `leases` do retrato, até o teto de páginas (D1 e D10). */
async function lerLeases($: EngineInterface, lacunas: string[]): Promise<LeaseDePath[]> {
  const leases: LeaseDePath[] = []
  let offset = 0
  try {
    for (let pagina = 0; pagina < TETO_DE_PAGINAS_DE_LEASES; pagina++) {
      const p = paginaDosLeases((await comPrazo($, $.ork.retrato({ secao: 'leases', offset }))).retrato)
      leases.push(...p.leases)
      if (p.lacuna) lacunas.push(p.lacuna)
      if (p.proximo === null || p.proximo <= offset) return leases
      offset = p.proximo
    }
    lacunas.push(`leases além de ${TETO_DE_PAGINAS_DE_LEASES} páginas não lidos`)
  } catch (erro) {
    lacunas.push(`leases não lidos (${mensagem(erro)})`)
  }
  return leases
}

/** Os objetos do repositório pelo `.git` da raiz: pasta, ou arquivo de worktree vinculada com `commondir` (D2). */
async function acharObjetos($: EngineInterface, raiz: string): Promise<string> {
  if (objetos !== undefined) return objetos
  const ponto = juntar(raiz, '.git')
  const st = await $.fs.stat(ponto)
  if (st.kind === 'dir') objetos = juntar(ponto, 'objects')
  else if (st.kind === 'file') {
    const gitdir = gitdirDoArquivo(String(await $.fs.read(ponto)), raiz)
    if (gitdir === null) throw new Error('o .git da raiz não aponta um gitdir')
    const commondir = await $.fs.read(juntar(gitdir, 'commondir')).then(String, () => null)
    objetos = objetosDoComum(gitdir, commondir)
  } else throw new Error('a raiz da sessão não tem .git')
  return objetos
}

/** O temporário da rodada pelo `mktemp -d`; recusa o que não tiver a forma do temporário do Radar (D5). */
async function criarTemporario($: EngineInterface): Promise<string> {
  const r = await $.process.run(argvDoTemporario(), { timeoutMs: PRAZO_LOCAL_MS })
  const temporario = r.exitCode === 0 ? temporarioValido(r.stdout) : null
  if (temporario === null) throw new Error(`o mktemp devolveu ${JSON.stringify(primeiraLinha(r.stdout || r.stderr))}`)
  return temporario
}

/**
 * Os pares que o cache não tinha: um `merge-tree` por par de SHAs, com objetos novos num temporário da rodada e
 * os do repositório como alternativo (D2, D3 e D5), dentro do orçamento da rodada (D12). O temporário sai sempre.
 */
async function calcularPares($: EngineInterface, raiz: string, pares: readonly Par[], resultados: Map<string, Resultado>,
  motivos: Map<string, string>, lacunas: string[]): Promise<void> {
  const semCalculo = (motivo: string) => { for (const p of pares) motivos.set(chaveDoPar(p.shaA, p.shaB), motivo) }
  let dirDosObjetos: string
  try {
    dirDosObjetos = await acharObjetos($, raiz)
  } catch (erro) {
    lacunas.push(`objetos do repositório não achados (${mensagem(erro)})`)
    return semCalculo('não calculado: objetos do repositório não achados')
  }
  let temporario: string
  try {
    temporario = await criarTemporario($)
  } catch (erro) {
    lacunas.push(`temporário recusado (${mensagem(erro)})`)
    return semCalculo('não calculado: temporário recusado')
  }
  const inicio = await $.clock.now()
  try {
    for (const p of pares) {
      const chave = chaveDoPar(p.shaA, p.shaB)
      if (resultados.has(chave)) continue
      if ((await $.clock.now()) - inicio >= ORCAMENTO_DO_MERGE_MS) {
        motivos.set(chave, `não calculado nesta rodada (orçamento de ${ORCAMENTO_DO_MERGE_MS / 1000} s)`)
        continue
      }
      let r: Resultado
      try {
        r = lerMergeTree(await $.process.run(argvDoMergeTree(p.shaA, p.shaB),
          { cwd: raiz, env: ambienteDoMerge(temporario, dirDosObjetos), timeoutMs: PRAZO_DO_MERGE_MS }))
      } catch (erro) {
        r = { estado: 'erro', erro: mensagem(erro) }
      }
      resultados.set(chave, r)
      guardarNoCache(cache, chave, r)
    }
  } finally {
    const apagado = await $.process.run(argvDeApagar(temporario), { timeoutMs: PRAZO_LOCAL_MS }).then(r => r.exitCode === 0, () => false)
    if (!apagado) lacunas.push(`temporário ${temporario} não apagado`)
  }
}

/** Uma rodada inteira: threads e leases pela ponte, SHAs pelo `ls-remote`, pares pelo `merge-tree`, mapa no estado. */
async function rodadaUmaVez($: EngineInterface): Promise<void> {
  let raiz: string
  try {
    const contexto = await comPrazo($, $.ork.contexto())
    if (contexto.papel !== 'dono') return
    raiz = contexto.raiz
  } catch (erro) {
    return gravarErro($, `o contexto da ponte falhou (${mensagem(erro)})`)
  }
  const lacunas: string[] = []
  let escolha: ReturnType<typeof threadsDaLista>
  try {
    escolha = threadsDaLista(await comPrazo($, $.ork.ler({ consulta: 'thread.list' })))
  } catch (erro) {
    return gravarErro($, `a lista das threads abertas falhou (${mensagem(erro)})`)
  }
  const leases = await lerLeases($, lacunas)
  const refs = await branchesDasThreads($, escolha.threads, lacunas)
  let shas: Record<string, string>
  try {
    shas = await lerShas($, raiz, [...new Set(refs.values())])
  } catch (erro) {
    return gravarErro($, `o ls-remote do repositório falhou (${mensagem(erro)})`)
  }
  const threads: RadarThread[] = escolha.threads.map((t, i) => {
    const branch = refs.get(t.id) as string
    const sha = shas[branch] ?? null
    return { id: t.id, fase: t.fase, rotulo: rotuloDe(i), branch, sha, motivo: sha === null ? 'sem branch local' : null }
  })
  const shaDaBase = shas[REF_DA_BASE] ?? null
  if (shaDaBase === null) lacunas.push(`sem ${REF_DA_BASE} local: os pares com a base ficaram de fora`)
  const remoto = await lerRemoto($, raiz)
  const pares = paresDaRodada(threads, shaDaBase)
  const resultados = new Map<string, Resultado>()
  const motivos = new Map<string, string>()
  const calcular: Par[] = []
  for (const p of pares) {
    const chave = chaveDoPar(p.shaA, p.shaB)
    const guardado = cache.get(chave)
    if (p.shaA === p.shaB) resultados.set(chave, { estado: 'limpa' })
    else if (guardado !== undefined) resultados.set(chave, guardado)
    else calcular.push(p)
  }
  if (calcular.length > 0) await calcularPares($, raiz, calcular, resultados, motivos, lacunas)
  const celulas = pares.map(p => {
    const chave = chaveDoPar(p.shaA, p.shaB)
    return celulaDoPar(p, resultados.get(chave) ?? null, leases, motivos.get(chave))
  })
  const novo: RadarMapa = {
    threads, base: baseDoMapa(shaDaBase, remoto), celulas, omitidas: escolha.omitidas, lacunas, lidoEm: await $.clock.now(), erro: null,
  }
  // D6: nova é a colisão que não estava na rodada anterior desta sessão. Depois de uma recarga do módulo, a rodada
  // anterior é a do mapa guardado em `$.state`, lido antes de o mapa novo ir por cima dele.
  if (anteriores === null) anteriores = anterioresDoMapa(await read($, mapa))
  await update($, mapa, () => novo)
  versaoGravada = novo.lidoEm
  const novosPares = paresComColisaoNova(anteriores, novo)
  anteriores = new Set(colisoesDoMapa(novo))
  await update($, novas, antigas => novasDepoisDaRodada(antigas, novosPares, novo))
  await publicarFaixa($)
  await registrarMostrados($)
}

/** O painel do Radar está posto e à vista do dono. */
async function painelAVista($: EngineInterface): Promise<boolean> {
  const paineis = await $.ui.panes().catch(() => [])
  return paineis.some(p => p.id === PAINEL && p.isPlaced && p.isShown)
}

/** Uma falha que o dono precisa ver: entra nas lacunas do mapa, que o painel e o `/radar` mostram, uma vez só. */
async function anotarLacuna($: EngineInterface, lacuna: string): Promise<void> {
  await update($, mapa, m => (m.lacunas.includes(lacuna) ? m : { ...m, lacunas: [...m.lacunas, lacuna] }))
}

/** A linha da faixa pela ponte (D6 e D7), só quando o texto muda; sem colisão nova não vista, a linha sai. */
async function publicarFaixa($: EngineInterface): Promise<void> {
  const texto = textoDaFaixa(await read($, mapa), await read($, novas))
  if (texto === ultimaFaixa) return
  try {
    if (texto === undefined) await $.ork.faixa({ mod: MOD })
    else await $.ork.faixa({ mod: MOD, texto })
    ultimaFaixa = texto
  } catch (erro) {
    // A linha fica como estava; o motivo vai às lacunas, e a próxima rodada tenta de novo.
    await anotarLacuna($, `linha da faixa não publicada (${mensagem(erro)})`)
  }
}

/**
 * O que o dono viu (conflito por conflito) deixa de ser novo, e a linha da faixa acompanha. Só vale para a versão
 * do mapa que ele viu: se uma rodada gravou outra no meio, a colisão nova dela continua nova.
 */
async function marcarVistos($: EngineInterface, vistos: readonly RadarMostrado[], versao: number | null): Promise<void> {
  if (versaoGravada === undefined || versao !== versaoGravada) return
  const pares = new Set(vistos.map(v => v.chave.slice('radar:'.length)))
  if (!(await read($, novas)).some(p => pares.has(p))) return
  await update($, novas, atuais => atuais.filter(p => !pares.has(p)))
  await publicarFaixa($)
}

/** Registra pela ponte o que o dono viu, uma vez por chave e texto enquanto o conflito existir no mapa. */
async function registrar($: EngineInterface, canal: 'painel' | 'transcript', vistos: readonly RadarMostrado[]): Promise<RadarMostrado[]> {
  const falharam: RadarMostrado[] = []
  for (const v of vistos) {
    const chave = `${v.chave}|${v.texto}`
    if (jaMostrado.has(chave)) continue
    try {
      await $.ork.mostrado({ mod: MOD, canal, chave: v.chave, thread: v.thread, texto: v.texto })
      jaMostrado.set(chave, v.chave)
    } catch {
      falharam.push(v)
    }
  }
  return falharam
}

/**
 * O que o desenho pôs na janela de rolagem do painel posto e à vista vai ao registro da ponte (M5 do dono), fora
 * do desenho: o Telegram não repete o que o dono já viu no terminal, e nada que não estava na tela entra.
 */
async function registrarMostrados($: EngineInterface): Promise<void> {
  const m = await read($, mapa)
  // O registro já feito sai quando o par deixa de estar em conflito (a chave do par, porque o texto pode ser o
  // pedaço que coube na largura); a anotação de outra versão do mapa sai sempre, e o próximo desenho anota de novo.
  const emConflito = new Set(mostradosDoMapa(m).map(v => v.chave))
  for (const [chave, par] of [...jaMostrado]) if (!emConflito.has(par)) jaMostrado.delete(chave)
  const versao = versaoGravada
  for (const [chave, a] of [...vistosNoDesenho]) if (versao === undefined || a.versao !== versao) vistosNoDesenho.delete(chave)
  if (vistosNoDesenho.size === 0 || versao === undefined) return
  // Com o painel escondido, o que foi anotado é descartado: o próximo desenho à vista anota de novo.
  if (!await painelAVista($)) { vistosNoDesenho.clear(); return }
  const vistos = [...vistosNoDesenho.values()].map(a => a.visto)
  vistosNoDesenho.clear()
  for (const v of await registrar($, 'painel', vistos)) vistosNoDesenho.set(`${v.chave}|${v.texto}`, { visto: v, versao })
  await marcarVistos($, vistos, versao)
}

/** O desenho anota o que pôs na janela, com a versão do mapa desenhado; quem registra é o laço, fora do desenho. */
function anotarVistos(vistos: readonly RadarMostrado[], versao: number | null): void {
  for (const v of vistos) vistosNoDesenho.set(`${v.chave}|${v.texto}`, { visto: v, versao })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // `/radar` abre o painel, roda uma rodada agora e responde o resumo, que o dono lê ali mesmo: os conflitos do
  // resumo entram no registro da ponte e deixam de ser novos. Com uma rodada de outro despacho em andamento, não a
  // espera: responde o mapa que há e a rodada pedida roda logo depois. O painel não abre sozinho (D6). O comando só
  // existe com o Radar ligado; a conferência do papel aqui só cobre o caso raro de o comando ter sobrado de outra carga.
  on('command.run', { command: 'radar' }, async $ => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'O Radar de Colisão só roda na sessão do dono de um projeto do Orkastery.' }
    const aberto = await $.ui.open({ id: PAINEL, title: TITULO }).catch(() => null)
    const propria = pedirRodada($)
    if (propria) await propria
    const m = await read($, mapa)
    const vistos = mostradosDoMapa(m)
    const falharam = await registrar($, 'transcript', vistos)
    if (falharam.length > 0) {
      await anotarLacuna($, `${contar(falharam.length, 'conflito não foi', 'conflitos não foram')} ao registro do mostrado da ponte`)
    }
    await marcarVistos($, vistos, m.lidoEm)
    const andamento = propria ? '' : '\nUma rodada já estava em andamento: o painel mostra a conta nova quando ela terminar.'
    const espera = aberto && !aberto.isPlaced ? `\nO painel espera lugar: ${aberto.reason}` : ''
    return { text: resumoDoMapa(m) + andamento + espera }
  })

  // O painel: a matriz (Raster no terminal, tabela fora dele), a lista de conflitos e o botão Atualizar. O desenho
  // nunca escreve: só anota o que pôs na janela de rolagem, cortado na largura do painel, para o registro do mostrado.
  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const el = $.ui.resolve(e) as unknown as ElementosDoPainel
    const m = await read($, mapa)
    const linhas = linhasDoPainel(m, await read($, novas), await $.clock.now())
    anotarVistos(mostradosVisiveis(linhas, e.props.scroll, e.props.bodyColumns), m.lidoEm)
    return desenharPainel(el, m, linhas, { terminal: e.surface === 'terminal', atualizar: () => { void pedirRodada($) } })
  })
}
