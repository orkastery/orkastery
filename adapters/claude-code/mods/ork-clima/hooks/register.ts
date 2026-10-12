// O Clima de Cota (RM-059, onda 1, F4). Le as janelas de limite da conta desta sessao a cada medicao do
// motor, guarda a serie no `$.store` do mod, preve quando cada janela acaba no ritmo atual e avisa na faixa
// da ponte antes de a fase morrer no meio, com as retomadas que nao cabem (T4.2). So na sessao do dono, so
// le e so avisa: troca de conta, runtime ou modelo fica com o nucleo (rodizio) e com o dono. O `$.ork` vem
// da `ork-ponte`; a logica fica nos modulos puros ao lado, e aqui so as chamadas ao `$`, sempre escritas
// como `$.noun.metodo(...)`.
import type { Register } from 'claude-code'
import type { ClimaDespacho, ClimaMarca } from './contas'
import {
  cruzar, linhasDoCruzamento, marcasDoRelatorio, paradasDoRetrato, resumoDoClima, retomadasDoRetrato, sufixoDaFaixa,
  textoDoDespacho,
} from './contas'
import {
  CHAVE_DA_SERIE, emAlerta, motivoDoErro, prever, registrarLeituras, textoDaFaixa, textoDoClima, textoForaDoDono,
  textoSemPonte,
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
  // guardada por outra sessao, antes da primeira medicao desta (sem o retrato, que a medicao traz).
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
  // Com janela em alerta, le o retrato e poe na faixa as retomadas que nao cabem (D7), registrando cada uma (D8).
  on('session.measure', async ($, e, next) => {
    try {
      if (await $.ork.papel() === 'dono') {
        const agora = await $.clock.now()
        const fuso = fusoDaSessao()
        let serie = await $.store.get(CHAVE_DA_SERIE)
        if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
          serie = registrarLeituras(serie, e.rateLimits, agora)
          await $.store.set(CHAVE_DA_SERIE, serie)
        }
        const previsoes = prever(serie, agora)
        let despachos: ClimaDespacho[] = []
        if (previsoes.some(emAlerta)) {
          try {
            despachos = cruzar(previsoes, retomadasDoRetrato((await $.ork.retrato()).retrato).itens, agora)
          } catch {
            despachos = []
          }
        }
        const texto = textoDaFaixa(previsoes, fuso, agora, sufixoDaFaixa(despachos))
        const anterior = await $.state.get(FAIXA)
        if ((anterior.value ?? null) !== texto) {
          await $.ork.faixa(texto === null ? { mod: MOD } : { mod: MOD, texto })
          await $.state.set(FAIXA, texto, { ifVersion: anterior.version })
          for (const d of despachos) {
            if (d.classe !== 'nao-cabe') continue
            await $.ork.mostrado({ mod: MOD, canal: 'faixa', chave: `clima:nao-cabe:${d.retomada.id}`, thread: d.retomada.thread,
              texto: textoDoDespacho(d, fuso, agora) })
          }
        }
      }
    } catch {
      // A medicao segue: o Clima so avisa, e uma falha dele nunca segura a sessao.
    }
    return next(e)
  })

  // O `/clima` le a serie guardada e nao grava ponto: `$.session.usage()` repete a ultima resposta, e um ponto
  // com a hora de agora achataria o ritmo (D2). Le sempre o retrato e o registro de contas (D3); leitura que
  // falha vira aviso no texto, e o que foi mostrado vai ao registro da ponte (D8).
  on('command.run', { command: 'clima' }, async $ => {
    const agora = await $.clock.now()
    const fuso = fusoDaSessao()
    let papel: string
    try {
      papel = await $.ork.papel()
    } catch (erro) {
      return { text: textoSemPonte(motivoDoErro(erro)) }
    }
    if (papel !== 'dono') return { text: textoForaDoDono(papel) }
    const previsoes = prever(await $.store.get(CHAVE_DA_SERIE), agora)
    let retrato: unknown = null
    let erroDoRetrato: string | null = null
    try {
      retrato = (await $.ork.retrato()).retrato
    } catch (erro) {
      erroDoRetrato = motivoDoErro(erro)
    }
    let marcas: ClimaMarca[] | null = null
    let erroDoRegistro: string | null = null
    try {
      marcas = marcasDoRelatorio(await $.ork.ler({ consulta: 'accounts.esgotamentos' }))
    } catch (erro) {
      erroDoRegistro = motivoDoErro(erro)
    }
    const retomadas = retomadasDoRetrato(retrato)
    const paradas = paradasDoRetrato(retrato)
    const despachos = erroDoRetrato === null ? cruzar(previsoes, retomadas.itens, agora) : null
    const linhas = linhasDoCruzamento({
      despachos, paradas: erroDoRetrato === null ? paradas.itens : [], parcial: retomadas.parcial || paradas.parcial,
      erroDoRetrato, marcas, erroDoRegistro,
    }, previsoes, fuso, agora)
    try {
      await $.ork.mostrado({ mod: MOD, canal: 'transcript', chave: 'clima:consulta', texto: resumoDoClima(previsoes, despachos, fuso, agora) })
      for (const d of despachos ?? []) {
        if (d.classe !== 'nao-cabe') continue
        await $.ork.mostrado({ mod: MOD, canal: 'transcript', chave: `clima:nao-cabe:${d.retomada.id}`, thread: d.retomada.thread,
          texto: textoDoDespacho(d, fuso, agora) })
      }
    } catch {
      // O registro do mostrado e melhor esforco: o texto chega ao dono de qualquer jeito.
    }
    return { text: textoDoClima(previsoes, fuso, agora, linhas) }
  })
}
