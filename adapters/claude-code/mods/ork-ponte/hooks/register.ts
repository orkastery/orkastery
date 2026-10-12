// A ponte dos mods do Orkastery (RM-059, onda 0). Acrescenta ao `$` o noun `$.ork`, que os outros mods
// do Orkastery usam para saber em que sessao estao e para ler o nucleo. A logica fica nos modulos puros
// ao lado; aqui so as chamadas ao `$`, sempre escritas como `x.noun.metodo(...)`, como o validador exige.
import type { Register } from 'claude-code'
import type { Ork, OrkAssinatura, OrkContexto, OrkMaestro, OrkRetratoGuardado } from '../types'
import {
  argsDoMaestro, argvDaConsulta, cacheValido, caminhosCobertos, chaveDoPedido, conferirPedidoDeRetrato, FERRAMENTA_DO_RETRATO,
  guardar, interpretarCli, interpretarMcp, raizPeloGit, SERVIDOR, subirAteOEstado, TETO_DO_CLI_MS,
} from './nucleo'
import { decidirPapel, juntar, MANIFESTO_DO_PROJETO, threadDoDespacho } from './papel'

const RETRATOS = { plugin: 'ork-ponte', key: 'retratos' } as const

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
    }
    return { ...built, ork }
  })
}
