// A ponte dos mods do Orkastery (RM-059, onda 0). Acrescenta ao `$` o noun `$.ork`, que os outros mods
// do Orkastery usam para saber em que sessao estao. A logica fica nos modulos puros ao lado; aqui so
// as chamadas ao `$`, sempre escritas como `x.noun.metodo(...)`, como o validador exige.
import type { Register } from 'claude-code'
import type { Ork, OrkContexto } from '../types'
import { decidirPapel, juntar, MANIFESTO_DO_PROJETO, threadDoDespacho } from './papel'

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

    const ork: Ork = {
      papel: async () => (await lerContexto()).papel,
      contexto: async () => lerContexto(),
    }
    return { ...built, ork }
  })
}
