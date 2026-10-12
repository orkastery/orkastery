// O Radar de Colisão do Orkastery (RM-059, fatia F3; ficha M10 do plano dos mods). Na sessão do dono, calcula sem
// worktree o merge de cada thread aberta contra a origin/main local e entre as threads, cruza os conflitos com os
// leases e guarda o mapa no estado. Lê o núcleo pela ponte (`$.ork`), nunca `.orkastery/` por conta própria; do
// git, só ls-remote e merge-tree com objetos temporários (D6 do dono). Só lê: nenhum caminho daqui age pelo dono.
// A lógica fica no módulo puro ao lado; aqui só os ganchos e as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { RadarMapa, RadarThread } from '../types'
import {
  AMBIENTE_DO_GIT, ambienteDoMerge, argvDeApagar, argvDoLsRemoteLocal, argvDoLsRemoteRemoto, argvDoMergeTree, argvDoTemporario,
  baseDoMapa, celulaDoPar, chaveDoPar, gitdirDoArquivo, guardarNoCache, juntar, leasesDoRetrato, lerLsRemote, lerMergeTree,
  objetosDoComum, ORCAMENTO_DO_MERGE_MS, paresDaRodada, PERIODO_DA_RODADA_MS, PRAZO_DO_MERGE_MS, PRAZO_DO_REMOTO_MS, PRAZO_LOCAL_MS,
  REF_DA_BASE, REF_REMOTA, refDaThread, refDoStatus, resumoDoMapa, rotuloDe, temporarioValido, threadsDaLista,
} from './colisao'
import type { LeaseDePath, Par, Resultado } from './colisao'

const MAPA_VAZIO: RadarMapa = {
  threads: [], base: { ref: REF_DA_BASE, sha: null, remoto: null, situacao: 'nao-conferida', erroRemoto: null },
  celulas: [], omitidas: 0, lacunas: [], lidoEm: null, erro: null,
}
const mapa = atom({ plugin: 'ork-radar', key: 'mapa' } as const, MAPA_VAZIO)
/** O servidor do núcleo pode conectar depois do início da sessão: o papel é conferido de novo nestas esperas. */
const ESPERAS_DO_PAPEL_MS = [3000, 10000, 30000]
/** Depois delas, enquanto dormente, a cada 5 min. */
const ESPERA_LONGA_DO_PAPEL_MS = 300000
/** Teto de cada leitura pela ponte, que já tem o próprio teto de 10 s no CLI. */
const PRAZO_DA_PONTE_MS = 20000
/** A primeira rodada sai logo depois da ativação, fora do início da sessão. */
const ESPERA_DA_PRIMEIRA_MS = 1000

// O que o módulo guarda entre ganchos e não desenha. Uma recarga do módulo zera tudo, e o `session.start`
// dispara de novo nela; o mapa em `$.state` fica.
let ativa = false
let desistiu = false
let ciclo: { cancel: () => void } | undefined
let rodando: Promise<void> | undefined
let pendente = false
/** O resultado de cada par de SHAs já calculado nesta carga (D12): par que não andou não roda de novo. */
const cache = new Map<string, Resultado>()
/** A branch que o `thread.status` deu à thread cuja `ork/<slug>` não existe, lida uma vez por carga. */
const branchDoStatus = new Map<string, string | null>()
/** O diretório de objetos do repositório, achado uma vez por carga. */
let objetos: string | undefined

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

/** Liga o Radar na sessão do dono: o `/radar`, a rodada de 10 min e a primeira rodada. */
async function ativar($: EngineInterface): Promise<void> {
  if (ativa) return
  ativa = true
  await $.command.register({
    name: 'radar', description: 'Radar de Colisão: onde cada thread aberta colide com a origin/main e com as outras, antes do SHIP',
    immediate: true,
  })
  ciclo?.cancel()
  ciclo = $.clock.every(PERIODO_DA_RODADA_MS, () => { void rodar($) })
  $.clock.after(ESPERA_DA_PRIMEIRA_MS, () => { void rodar($) })
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

/** Uma rodada por vez; pedido que chega no meio roda logo depois, e quem pediu espera as duas. */
async function rodar($: EngineInterface): Promise<void> {
  if (!ativa) return
  if (rodando) {
    pendente = true
    return rodando
  }
  rodando = (async () => {
    try {
      do {
        pendente = false
        await rodadaUmaVez($)
      } while (pendente)
    } finally {
      rodando = undefined
    }
  })()
  return rodando
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
  let leases: LeaseDePath[] = []
  try {
    leases = leasesDoRetrato((await comPrazo($, $.ork.retrato({ secao: 'leases' }))).retrato)
  } catch (erro) {
    lacunas.push(`leases não lidos (${mensagem(erro)})`)
  }
  const refs = new Map(escolha.threads.map(t => [t.id, branchDoStatus.get(t.id) ?? refDaThread(t.slug)]))
  let shas: Record<string, string>
  try {
    shas = await lerShas($, raiz, [...new Set(refs.values())])
  } catch (erro) {
    return gravarErro($, `o ls-remote do repositório falhou (${mensagem(erro)})`)
  }
  // A thread cuja branch não tem o nome do slug: o `base.branch` dela pela ponte, uma vez por carga.
  const outras: string[] = []
  for (const t of escolha.threads.filter(x => shas[refs.get(x.id) as string] === undefined && !branchDoStatus.has(x.id))) {
    let ref: string | null
    try {
      ref = refDoStatus(await comPrazo($, $.ork.ler({ consulta: 'thread.status', thread: t.id })))
    } catch (erro) {
      lacunas.push(`branch de ${t.id} não lida (${mensagem(erro)})`)
      continue
    }
    branchDoStatus.set(t.id, ref)
    if (ref !== null && ref !== refs.get(t.id)) {
      refs.set(t.id, ref)
      outras.push(ref)
    }
  }
  if (outras.length > 0) {
    try {
      Object.assign(shas, await lerShas($, raiz, outras))
    } catch (erro) {
      lacunas.push(`ls-remote das branches pelo status falhou (${mensagem(erro)})`)
    }
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
  await update($, mapa, () => novo)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if (e.isInteractive) await conferirPapel($, 0)
    return next(e)
  })

  // `/radar` roda uma rodada agora e responde o resumo. O comando só existe com o Radar ligado; a conferência do
  // papel aqui só cobre o caso raro de o comando ter sobrado de uma carga anterior.
  on('command.run', { command: 'radar' }, async $ => {
    if (!ativa && !desistiu) await conferirPapel($, ESPERAS_DO_PAPEL_MS.length)
    if (!ativa) return { text: 'O Radar de Colisão só roda na sessão do dono de um projeto do Orkastery.' }
    await rodar($)
    return { text: resumoDoMapa(await read($, mapa)) }
  })
}
