// O Clima de Cota (RM-059, onda 1, F4). Le as janelas de limite da conta desta sessao a cada medicao do
// motor, guarda a serie no `$.store` do mod, preve quando cada janela acaba no ritmo atual e avisa na faixa
// da ponte antes de a fase morrer no meio, com as retomadas que nao cabem (T4.2). So na sessao do dono, so
// le e so avisa: troca de conta, runtime ou modelo fica com o nucleo (rodizio) e com o dono. O `$.ork` vem
// da `ork-ponte`; a logica fica nos modulos puros ao lado, e aqui so as chamadas ao `$`, sempre escritas
// pelo nome do noun e do metodo, como o validador exige.
import type { Register } from 'claude-code'
import type { ClimaNaoCabe } from '../types'
import type { ClimaDespacho } from './contas'
import {
  cruzar, linhasDoCruzamento, marcasDoRelatorio, paradasDoRetrato, resumoDoClima, retomadasDaFila, textoDoNaoCabe,
  threadsAbertas, threadsQueNaoCabem,
} from './contas'
import {
  CHAVE_DA_SERIE, emAlerta, motivoDoErro, prever, registrarLeituras, TEXTO_SEM_PONTE, textoDaFaixa, textoDoClima,
  textoForaDoDono,
} from './previsao'

const MOD = 'ork-clima'
const FAIXA = { plugin: 'ork-clima', key: 'faixa' } as const
const NAO_CABEM = { plugin: 'ork-clima', key: 'naoCabem' } as const

/** O fuso da sessao (D6): a ponte nao entrega o `owner.timezone`. */
function fusoDaSessao(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const register: Register = on => {
  // O `/clima` fica disponivel fora da sessao de fase (D3), e tambem sem a ponte, para dizer o motivo. A faixa
  // so sai na primeira medicao: antes de o servidor `orkastery` conectar, a ponte ainda responde `dormente`.
  on('session.start', async ($, e, next) => {
    let papel: string | null = null
    try {
      papel = await $.ork.papel()
    } catch {
      papel = null
    }
    if (papel !== 'fase') {
      await $.command.register({ name: 'clima', description: 'Previsão da cota da conta desta sessão: quando cada janela acaba no ritmo atual' })
        .catch(() => undefined)
    }
    return next(e)
  })

  // Cada medicao: grava a leitura quando as janelas mudaram (D2) e republica a faixa so quando o texto muda (D5).
  // Com janela em alerta e leitura nova, le a fila inteira de retomada e guarda as que nao cabem (D7, D13); a
  // medicao sem leitura nova usa o que ficou guardado. Fora do papel `dono`, a linha publicada sai (D13).
  on('session.measure', async ($, e, next) => {
    try {
      const papel = await $.ork.papel()
      const anterior = await $.state.get(FAIXA)
      if (papel !== 'dono') {
        if ((anterior.value ?? null) !== null) {
          await $.ork.faixa({ mod: MOD })
          await $.state.set(FAIXA, null, { ifVersion: anterior.version })
        }
      } else {
        const agora = await $.clock.now()
        const fuso = fusoDaSessao()
        const leu = e.changed.includes('rateLimits')
        let serie = await $.store.get(CHAVE_DA_SERIE)
        if (leu) {
          serie = registrarLeituras(serie, e.rateLimits, agora)
          await $.store.set(CHAVE_DA_SERIE, serie)
        }
        const previsoes = prever(serie, agora)
        const alerta = previsoes.some(emAlerta)
        const guardados = await $.state.get(NAO_CABEM)
        let naoCabem: ClimaNaoCabe[] = alerta ? (guardados.value ?? []) : []
        let novos: ClimaDespacho[] = []
        if (alerta && leu) {
          try {
            const fila = retomadasDaFila(await $.ork.ler({ consulta: 'retry.list' }))
            if (fila !== null) {
              const despachos = cruzar(previsoes, fila, agora).filter(d => d.classe === 'nao-cabe')
              novos = despachos.filter(d => !naoCabem.some(n => n.id === d.retomada.id))
              naoCabem = despachos.map(d => ({ id: d.retomada.id, thread: d.retomada.thread }))
            }
          } catch {
            // Fila indisponivel: vale o que a ultima leitura deixou.
          }
        }
        if (JSON.stringify(naoCabem) !== JSON.stringify(guardados.value ?? [])) {
          await $.state.set(NAO_CABEM, naoCabem, { ifVersion: guardados.version })
        }
        const threads = naoCabem.map(n => n.thread).filter((t, i, todas) => todas.indexOf(t) === i)
        const texto = textoDaFaixa(previsoes, fuso, agora, threads)
        if ((anterior.value ?? null) !== texto) {
          const r = await $.ork.faixa(texto === null ? { mod: MOD } : { mod: MOD, texto })
          if (texto === null || r.publicada) await $.state.set(FAIXA, texto, { ifVersion: anterior.version })
        }
        for (const d of novos) {
          await $.ork.mostrado({ mod: MOD, canal: 'faixa', chave: `clima:nao-cabe:${d.retomada.id}`, thread: d.retomada.thread,
            texto: textoDoNaoCabe(d, fuso, agora) })
        }
      }
    } catch {
      // A medicao segue: o Clima so avisa, e uma falha dele nunca segura a sessao.
    }
    return next(e)
  })

  // O `/clima` le a serie guardada e nao grava ponto: `$.session.usage()` repete a ultima resposta, e um ponto
  // com a hora de agora achataria o ritmo (D2). Le a fila, o retrato, as threads abertas e o registro de contas
  // ao mesmo tempo (D3, D13); leitura que falha vira aviso no texto, e o que foi mostrado vai ao registro da ponte (D8).
  on('command.run', { command: 'clima' }, async $ => {
    const agora = await $.clock.now()
    const fuso = fusoDaSessao()
    let papel: string
    try {
      papel = await $.ork.papel()
    } catch {
      return { text: TEXTO_SEM_PONTE }
    }
    if (papel !== 'dono') return { text: textoForaDoDono(papel) }
    const previsoes = prever(await $.store.get(CHAVE_DA_SERIE), agora)
    const ler = (p: Promise<unknown>) => p.then(valor => ({ ok: true as const, valor }), erro => ({ ok: false as const, erro: motivoDoErro(erro) }))
    const [fila, retrato, abertas, registro] = await Promise.all([
      ler($.ork.ler({ consulta: 'retry.list' })),
      ler($.ork.retrato().then(r => r.retrato)),
      ler($.ork.ler({ consulta: 'thread.list' })),
      ler($.ork.ler({ consulta: 'accounts.esgotamentos' })),
    ])
    const retomadas = fila.ok ? retomadasDaFila(fila.valor) : null
    const despachos = retomadas === null ? null : cruzar(previsoes, retomadas, agora)
    // Sem a lista de threads abertas, as paradas nao sao conferidas: o retrato tambem traz thread fechada (D14).
    const listaDeAbertas = abertas.ok ? threadsAbertas(abertas.valor) : null
    const linhas = linhasDoCruzamento({
      despachos, erroDaFila: fila.ok ? null : fila.erro,
      paradas: retrato.ok && listaDeAbertas !== null ? paradasDoRetrato(retrato.valor, listaDeAbertas) : null,
      erroDoRetrato: !retrato.ok ? retrato.erro
        : listaDeAbertas === null ? `sem a lista de threads abertas: ${abertas.ok ? 'fora do formato' : abertas.erro}` : null,
      marcas: registro.ok ? marcasDoRelatorio(registro.valor) : null, erroDoRegistro: registro.ok ? null : registro.erro,
    }, previsoes, fuso, agora)
    const naoCabem = (despachos ?? []).filter(d => d.classe === 'nao-cabe')
    try {
      await $.ork.mostrado({ mod: MOD, canal: 'transcript', chave: 'clima:consulta', texto: resumoDoClima(previsoes, threadsQueNaoCabem(naoCabem), fuso, agora) })
      for (const d of naoCabem) {
        await $.ork.mostrado({ mod: MOD, canal: 'transcript', chave: `clima:nao-cabe:${d.retomada.id}`, thread: d.retomada.thread,
          texto: textoDoNaoCabe(d, fuso, agora) })
      }
    } catch {
      // O registro do mostrado e melhor esforco: o texto chega ao dono de qualquer jeito.
    }
    return { text: textoDoClima(previsoes, fuso, agora, linhas) }
  })
}
