// O Clima de Cota (RM-059, onda 1, F4). Le as janelas de limite da conta desta sessao a cada medicao do
// motor, guarda a serie no `$.store` do mod, preve quando cada janela acaba no ritmo atual e avisa na faixa
// da ponte antes de a fase morrer no meio, com as retomadas que nao cabem (T4.2). So na sessao do dono, so
// le e so avisa: troca de conta, runtime ou modelo fica com o nucleo (rodizio) e com o dono. O `$.ork` vem
// da `ork-ponte`; a logica fica nos modulos puros ao lado, e aqui so as chamadas ao `$`, sempre escritas
// pelo nome do noun e do metodo, como o validador exige.
import type { Register } from 'claude-code'
import type { ClimaNaoCabe, ClimaProblema } from '../types'
import {
  cruzar, linhasDoCruzamento, marcasDoRelatorio, naoCabemGuardados, paradasDoRetrato, resumoDoClima, retomadasDaFila,
  textoDoNaoCabe, threadsAbertas, threadsQueNaoCabem,
} from './contas'
import {
  CHAVE_DA_SERIE, emAlerta, MOTIVO_SEM_PONTE, motivoDoErro, prever, problemaDaLeitura, registrarLeituras, TEXTO_SEM_PONTE,
  textoDaFaixa, textoDoClima, textoForaDoDono,
} from './previsao'

const MOD = 'ork-clima'
const FAIXA = { plugin: 'ork-clima', key: 'faixa' } as const
const NAO_CABEM = { plugin: 'ork-clima', key: 'naoCabem' } as const
const PROBLEMA = { plugin: 'ork-clima', key: 'problema' } as const

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
  // O registro recusado nao segura o inicio da sessao, mas o motivo vai ao transcript (D15).
  on('session.start', async ($, e, next) => {
    let papel: string | null = null
    try {
      papel = await $.ork.papel()
    } catch {
      papel = null
    }
    if (papel !== 'fase') {
      await $.command.register({ name: 'clima', description: 'Previsão da cota da conta desta sessão: quando cada janela acaba no ritmo atual' })
        .catch(erro => $.ui.log(`Clima de Cota: o /clima não foi registrado (${motivoDoErro(erro)}).`))
    }
    return next(e)
  })

  // Cada medicao: grava a leitura quando as janelas mudaram (D2) e republica a faixa so quando o texto muda (D5).
  // Com janela em alerta e leitura nova, le a fila inteira de retomada e guarda as que nao cabem (D7, D13); a
  // medicao sem leitura nova usa o que ficou guardado. So vai ao registro do mostrado o que a faixa mostrou, e o
  // registro que falhar fica pendente para a medicao seguinte (D15). Fora do papel `dono`, a linha sai (D13).
  // Uma falha nunca segura a medicao: o motivo novo vai uma vez ao transcript e fica no estado para o `/clima`,
  // ate uma medicao boa limpa-lo (D15).
  on('session.measure', async ($, e, next) => {
    let agora: number | null = null
    let problema: ClimaProblema | null = null
    let semLeituraNova = false
    try {
      agora = await $.clock.now()
      let papel: string | null = null
      try {
        papel = await $.ork.papel()
      } catch {
        papel = null
      }
      const anterior = await $.state.get(FAIXA)
      if (papel === null) {
        problema = { motivo: MOTIVO_SEM_PONTE, em: agora, daLeitura: false }
      } else if (papel !== 'dono') {
        if ((anterior.value ?? null) !== null) {
          await $.ork.faixa({ mod: MOD })
          await $.state.set(FAIXA, null, { ifVersion: anterior.version })
        }
      } else {
        const fuso = fusoDaSessao()
        const leu = e.changed.includes('rateLimits')
        semLeituraNova = !leu
        let serie = await $.store.get(CHAVE_DA_SERIE)
        if (leu) {
          const motivo = problemaDaLeitura(e.rateLimits)
          if (motivo !== null) problema = { motivo, em: agora, daLeitura: true }
          // A medicao sem a lista de janelas nao apaga a serie guardada (D15).
          if (Array.isArray(e.rateLimits)) {
            serie = registrarLeituras(serie, e.rateLimits, agora)
            await $.store.set(CHAVE_DA_SERIE, serie)
          }
        }
        const previsoes = prever(serie, agora)
        const alerta = previsoes.some(emAlerta)
        const guardados = await $.state.get(NAO_CABEM)
        let naoCabem: ClimaNaoCabe[] = alerta ? naoCabemGuardados(guardados.value) : []
        if (alerta && leu) {
          try {
            const fila = retomadasDaFila(await $.ork.ler({ consulta: 'retry.list' }))
            if (fila !== null) {
              const antes = naoCabem
              const lidaEm = agora
              naoCabem = cruzar(previsoes, fila, lidaEm).filter(d => d.classe === 'nao-cabe').map(d =>
                antes.find(n => n.id === d.retomada.id)
                  ?? { id: d.retomada.id, thread: d.retomada.thread, texto: textoDoNaoCabe(d, fuso, lidaEm), registrada: false })
            }
          } catch {
            // Fila indisponivel: vale o que a ultima leitura deixou, e o `/clima` diz o motivo quando le a fila.
          }
        }
        let versao = guardados.version
        if (JSON.stringify(naoCabem) !== JSON.stringify(guardados.value ?? [])) {
          versao = (await $.state.set(NAO_CABEM, naoCabem, { ifVersion: guardados.version })).version
        }
        const threads = naoCabem.map(n => n.thread).filter((t, i, todas) => todas.indexOf(t) === i)
        const texto = textoDaFaixa(previsoes, fuso, agora, threads)
        let mostrada = (anterior.value ?? null) === texto
        if (!mostrada) {
          const r = await $.ork.faixa(texto === null ? { mod: MOD } : { mod: MOD, texto })
          if (texto === null || r.publicada) {
            await $.state.set(FAIXA, texto, { ifVersion: anterior.version })
            mostrada = true
          }
        }
        if (mostrada && texto !== null && naoCabem.some(n => !n.registrada)) {
          const registradas: ClimaNaoCabe[] = []
          for (const n of naoCabem) {
            if (n.registrada) {
              registradas.push(n)
              continue
            }
            try {
              await $.ork.mostrado({ mod: MOD, canal: 'faixa', chave: `clima:nao-cabe:${n.id}`, thread: n.thread, texto: n.texto })
              registradas.push({ ...n, registrada: true })
            } catch (erro) {
              registradas.push(n)
              if (problema === null) problema = { motivo: `o registro do mostrado na ponte falhou (${motivoDoErro(erro)})`, em: agora, daLeitura: false }
            }
          }
          naoCabem = registradas
          await $.state.set(NAO_CABEM, naoCabem, { ifVersion: versao })
        }
      }
    } catch (erro) {
      problema = { motivo: `a medição falhou (${motivoDoErro(erro)})`, em: agora, daLeitura: false }
    }
    try {
      const guardado = await $.state.get(PROBLEMA)
      const antes = guardado.value ?? null
      const depois = problema ?? (semLeituraNova && antes !== null && antes.daLeitura ? antes : null)
      if (JSON.stringify(depois) !== JSON.stringify(antes)) {
        await $.state.set(PROBLEMA, depois, { ifVersion: guardado.version })
        // So o motivo novo vai ao transcript: a falha que se repete a cada medicao nao enche a tela.
        if (depois !== null && depois.motivo !== antes?.motivo) $.ui.log(`Clima de Cota: ${depois.motivo}. O /clima mostra o que ficou guardado.`)
      }
    } catch (erro) {
      $.ui.log(`Clima de Cota: o problema da medição não foi guardado (${motivoDoErro(erro)}).`, { to: 'debug' })
    }
    return next(e)
  })

  // O `/clima` le a serie guardada e nao grava ponto: o uso pedido na hora repete a ultima resposta, e um ponto
  // com a hora de agora achataria o ritmo (D2). Le a fila, o retrato, as threads abertas e o registro de contas
  // ao mesmo tempo (D3, D13); leitura que falha vira aviso no texto, o problema da ultima medicao aparece (D15), e
  // o que foi mostrado vai ao registro da ponte (D8).
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
    const problema = (await $.state.get(PROBLEMA)).value ?? null
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
      // O registro do mostrado e melhor esforco: o texto chega ao dono de qualquer jeito, e cada `/clima` registra de novo.
    }
    return { text: textoDoClima(previsoes, fuso, agora, linhas, problema) }
  })
}
