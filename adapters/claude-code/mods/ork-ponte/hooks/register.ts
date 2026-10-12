// A ponte dos mods do Orkastery (RM-059, onda 0). Acrescenta ao `$` o noun `$.ork`, que os outros mods
// do Orkastery usam para saber em que sessao estao, ler o nucleo, publicar na faixa e pedir caminhos
// vigiados. A logica fica nos modulos puros ao lado; aqui so as chamadas ao `$`, sempre escritas como
// `x.noun.metodo(...)`, como o validador exige.
import type { Register } from 'claude-code'
import type { Ork, OrkAssinatura, OrkContexto, OrkMaestro, OrkMostrado, OrkRetratoGuardado } from '../types'
import { comporFaixa, desenharFaixa, nomeDeModValido, trocarLinha } from './faixa'
import { CHAVE_NO_STORE, conferirMostrado, lerRegistro, registrarMostrado } from './mostrado'
import {
  argsDoMaestro, argvDaConsulta, cacheValido, caminhosCobertos, chaveDoPedido, conferirPedidoDeRetrato, FERRAMENTA_DO_RETRATO,
  guardar, interpretarCli, interpretarMcp, raizPeloGit, SERVIDOR, subirAteOEstado, TETO_DO_CLI_MS,
} from './nucleo'
import { decidirPapel, juntar, MANIFESTO_DO_PROJETO, threadDoDespacho } from './papel'
import { caminhosPadrao, fundirCaminhos, idsDeThread, ledgerDaThread, ledgersRecentes, pastaDasThreads, registrarPedido } from './vigia'

const RETRATOS = { plugin: 'ork-ponte', key: 'retratos' } as const
const FAIXA = { plugin: 'ork-ponte', key: 'faixa' } as const
const VIGIAS = { plugin: 'ork-ponte', key: 'vigias' } as const
const TENTATIVAS_DE_ESCRITA = 5

/** O que os ganchos da ponte usam do noun, montado no `engine.create` de cada carga. */
type Interno = {
  contexto: () => Promise<OrkContexto>
  raizDoEstado: () => Promise<string | null>
  ledgersRecentes: (raiz: string) => Promise<string[]>
}
let interno: Interno | undefined
/** O `classic.SessionStart` desta carga ja respondeu os `watchPaths`. */
let inicioRespondido = false

export const register: Register = on => {
  on('engine.create', async ($, e, next) => {
    const built = await next(e)

    const lerContexto = async (): Promise<OrkContexto> => {
      const dispatchId = await built.env.get('ORK_DISPATCH_ID')
      const raiz = await built.session.root()
      let temManifesto = false
      let ferramentas: string[] = []
      if (dispatchId === undefined || dispatchId.trim() === '') {
        temManifesto = await built.fs.exists(juntar(raiz, MANIFESTO_DO_PROJETO))
        if (temManifesto) ferramentas = (await built.tool.list()).map(t => t.name)
      }
      const papel = decidirPapel({ dispatchId, temManifesto, ferramentas })
      const thread = threadDoDespacho(papel, await built.env.get('ORK_DISPATCH_THREAD'))
      return { papel, thread, raiz }
    }

    // A raiz do estado (a pasta com `orkastery.yaml` e `.orkastery/`), achada uma vez por carga.
    let raizDoEstado: string | null | undefined
    const acharRaizDoEstado = async (): Promise<string | null> => {
      if (raizDoEstado !== undefined) return raizDoEstado
      const raiz = await built.session.root()
      let achada = await subirAteOEstado(raiz, caminho => built.fs.exists(caminho))
      if (achada === null) {
        const git = await built.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
          { cwd: raiz, timeoutMs: 5000 }).catch(() => undefined)
        const candidata = git && git.exitCode === 0 ? raizPeloGit(git.stdout) : null
        if (candidata !== null && await built.fs.exists(juntar(candidata, '.orkastery'))) achada = candidata
      }
      raizDoEstado = achada
      return achada
    }

    const assinar = async (caminhos: readonly string[]): Promise<OrkAssinatura> => {
      const assinatura: OrkAssinatura = []
      for (const caminho of caminhos) {
        const s = await built.fs.stat(caminho).catch(() => undefined)
        assinatura.push(s ? { caminho, tamanho: s.size, mtimeMs: s.mtimeMs } : { caminho, ausente: true })
      }
      return assinatura
    }

    const lerLedgersRecentes = async (raiz: string): Promise<string[]> => {
      const entradas = await built.fs.list(pastaDasThreads(raiz)).catch(() => [])
      const ledgers: Array<{ caminho: string; mtimeMs?: number }> = []
      for (const id of idsDeThread(entradas).slice(0, 400)) {
        const caminho = ledgerDaThread(raiz, id)
        const s = await built.fs.stat(caminho).catch(() => undefined)
        ledgers.push(s ? { caminho, mtimeMs: s.mtimeMs } : { caminho })
      }
      return ledgersRecentes(ledgers)
    }

    const registrar = async (m: OrkMostrado): Promise<void> => {
      const agora = new Date(await built.clock.now()).toISOString()
      await built.store.set(CHAVE_NO_STORE, registrarMostrado(await built.store.get(CHAVE_NO_STORE), m, agora))
    }

    const ork: Ork = {
      papel: async () => (await lerContexto()).papel,
      contexto: async () => lerContexto(),
      retrato: async bruto => {
        const pedido = conferirPedidoDeRetrato(bruto)
        const chave = chaveDoPedido(pedido)
        const guardados = await built.state.get(RETRATOS)
        const anterior = guardados.value?.[chave]
        if (anterior !== undefined) {
          const agora = await built.clock.now()
          if (cacheValido(anterior, await assinar(anterior.caminhos), agora)) {
            return { fonte: 'cache', lidoEm: anterior.lidoEm, retrato: anterior.retrato as OrkMaestro }
          }
        }
        let retrato: unknown
        let fonte: 'mcp' | 'cli'
        try {
          retrato = interpretarMcp(await built.mcp.call(SERVIDOR, FERRAMENTA_DO_RETRATO, argsDoMaestro(pedido)))
          fonte = 'mcp'
        } catch {
          const argv = argvDaConsulta({ consulta: 'maestro', ...pedido })
          retrato = interpretarCli(argv, await built.process.run(argv, { timeoutMs: TETO_DO_CLI_MS }))
          fonte = 'cli'
        }
        const lidoEm = await built.clock.now()
        // O `stat` sai depois da leitura: uma mudanca no meio fica no cache ate o teto de 60 s.
        const caminhos = caminhosCobertos(await acharRaizDoEstado(), pedido, retrato)
        if (caminhos.length > 0) {
          const entrada: OrkRetratoGuardado = { fonte, lidoEm, retrato, caminhos, assinatura: await assinar(caminhos) }
          // Escrita recusada (por exemplo, dentro de um desenho) so deixa de guardar.
          await built.state.set(RETRATOS, guardar(guardados.value, chave, entrada), { ifVersion: guardados.version })
            .catch(() => undefined)
        }
        return { fonte, lidoEm, retrato: retrato as OrkMaestro }
      },
      ler: async pedido => {
        const argv = argvDaConsulta(pedido)
        return interpretarCli(argv, await built.process.run(argv, { timeoutMs: TETO_DO_CLI_MS }))
      },
      faixa: async ({ mod, texto }) => {
        if (!nomeDeModValido(mod)) throw new Error('ork-ponte: nome de mod invalido')
        if (texto !== undefined && typeof texto !== 'string') throw new Error('ork-ponte: texto da faixa precisa ser texto')
        let publicada = false
        for (let i = 0; i < TENTATIVAS_DE_ESCRITA; i++) {
          const atual = await built.state.get(FAIXA)
          const linhas = trocarLinha(atual.value, mod, texto, await built.clock.now())
          const escrita = await built.state.set(FAIXA, linhas, { ifVersion: atual.version })
          if (escrita.isSet) { publicada = linhas.some(l => l.mod === mod); break }
        }
        if (publicada && texto !== undefined && (await lerContexto()).papel === 'dono') {
          await registrar({ mod, canal: 'faixa', texto })
        }
        return { publicada }
      },
      vigiar: async ({ mod, caminhos }) => {
        for (let i = 0; i < TENTATIVAS_DE_ESCRITA; i++) {
          const atual = await built.state.get(VIGIAS)
          const pedidos = registrarPedido(atual.value, mod, caminhos)
          const escrita = await built.state.set(VIGIAS, pedidos, { ifVersion: atual.version })
          if (escrita.isSet) return { caminhos: pedidos[mod] ?? [], valeNoProximoInicio: inicioRespondido }
        }
        throw new Error('ork-ponte: o pedido de caminhos nao foi guardado')
      },
      mostrado: async pedido => registrar(conferirMostrado(pedido)),
      mostrados: async () => lerRegistro(await built.store.get(CHAVE_NO_STORE)),
    }

    interno = { contexto: lerContexto, raizDoEstado: acharRaizDoEstado, ledgersRecentes: lerLedgersRecentes }
    return { ...built, ork }
  })

  // So a ponte responde `watchPaths` entre os mods do Orkastery: o que veio de baixo, os padroes e os pedidos.
  on('classic.SessionStart', async ($, e, next) => {
    const resultado = await next(e)
    if (interno === undefined) return resultado
    const contexto = await interno.contexto()
    if (contexto.papel === 'dormente') return resultado
    const raiz = await interno.raizDoEstado()
    const recentes = contexto.papel === 'dono' && raiz !== null ? await interno.ledgersRecentes(raiz) : []
    const pedidos = (await $.state.get(VIGIAS)).value
    inicioRespondido = true
    return { ...resultado, watchPaths: fundirCaminhos(resultado.watchPaths, caminhosPadrao(contexto.papel, raiz, contexto.thread, recentes), pedidos) }
  }).catch(($, e, next) => next(e))

  // A faixa acima do prompt: uma linha por mod; sem linha, a faixa fica com quem esta abaixo.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const linhas = comporFaixa((await $.state.get(FAIXA)).value, e.props.bodyColumns, e.props.maxRows)
    if (linhas.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return desenharFaixa({ Box, Text }, linhas)
  })
}
