// O Clima de Cota (RM-059, onda 1, F4). Le as janelas de limite da conta desta sessao a cada medicao do
// motor, guarda a serie no `$.store` do mod, preve quando cada janela acaba no ritmo atual e avisa na faixa
// da ponte antes de a fase morrer no meio. So na sessao do dono, so le e so avisa: troca de conta, runtime
// ou modelo fica com o nucleo (rodizio) e com o dono. O `$.ork` vem da `ork-ponte`; a logica fica nos
// modulos puros ao lado, e aqui so as chamadas ao `$`, sempre escritas como `$.noun.metodo(...)`.
import type { Register } from 'claude-code'
import {
  CHAVE_DA_SERIE, motivoDoErro, prever, registrarLeituras, textoDaFaixa, textoDoClima, textoForaDoDono, textoSemPonte,
} from './previsao'

const MOD = 'ork-clima'
const FAIXA = { plugin: 'ork-clima', key: 'faixa' } as const

/** O fuso da sessao (D6): a ponte nao entrega o `owner.timezone`. */
function fusoDaSessao(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const register: Register = on => {
  // O `/clima` fica disponivel fora da sessao de fase (D3); na sessao do dono, a faixa ja sai da serie
  // guardada por outra sessao, antes da primeira medicao desta.
  on('session.start', async ($, e, next) => {
    try {
      const papel = await $.ork.papel()
      if (papel !== 'fase') {
        await $.command.register({ name: 'clima', description: 'Previsão da cota da conta desta sessão: quando cada janela acaba no ritmo atual' })
      }
      if (papel === 'dono') {
        const agora = await $.clock.now()
        const texto = textoDaFaixa(prever(await $.store.get(CHAVE_DA_SERIE), agora), fusoDaSessao(), agora)
        const anterior = await $.state.get(FAIXA)
        if ((anterior.value ?? null) !== texto) {
          await $.ork.faixa(texto === null ? { mod: MOD } : { mod: MOD, texto })
          await $.state.set(FAIXA, texto, { ifVersion: anterior.version })
        }
      }
    } catch {
      // Sem a ponte, o Clima fica quieto: o `/clima` diz o motivo.
    }
    return next(e)
  })

  // Cada medicao: grava a leitura quando uma janela mudou e republica a faixa so quando o texto muda (D2, D5).
  on('session.measure', async ($, e, next) => {
    try {
      if (await $.ork.papel() === 'dono') {
        const agora = await $.clock.now()
        let serie = await $.store.get(CHAVE_DA_SERIE)
        if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
          serie = registrarLeituras(serie, e.rateLimits, agora)
          await $.store.set(CHAVE_DA_SERIE, serie)
        }
        const texto = textoDaFaixa(prever(serie, agora), fusoDaSessao(), agora)
        const anterior = await $.state.get(FAIXA)
        if ((anterior.value ?? null) !== texto) {
          await $.ork.faixa(texto === null ? { mod: MOD } : { mod: MOD, texto })
          await $.state.set(FAIXA, texto, { ifVersion: anterior.version })
        }
      }
    } catch {
      // A medicao segue: o Clima so avisa, e uma falha dele nunca segura a sessao.
    }
    return next(e)
  })

  // O `/clima` le a serie guardada e nao grava ponto: `$.session.usage()` repete a ultima resposta, e um
  // ponto com a hora de agora achataria o ritmo (D2).
  on('command.run', { command: 'clima' }, async $ => {
    const agora = await $.clock.now()
    let papel: string
    try {
      papel = await $.ork.papel()
    } catch (erro) {
      return { text: textoSemPonte(motivoDoErro(erro)) }
    }
    if (papel !== 'dono') return { text: textoForaDoDono(papel) }
    return { text: textoDoClima(prever(await $.store.get(CHAVE_DA_SERIE), agora), fusoDaSessao(), agora) }
  })
}
