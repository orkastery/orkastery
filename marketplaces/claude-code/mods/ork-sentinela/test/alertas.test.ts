import { test, expect } from 'claude-code/testing'
import { faixaEm, iniciar, iso, MIN, montar, passo, ponte, PONTE_FALSA, pulso, sentinela, status, T0 } from './apoio'

// T6.3: os avisos com o próximo passo do núcleo, pelo pulse, uma vez por texto, com o registro do mostrado na ponte.
const humano = (thread: string, motivo: string, comandoResposta: string) =>
  ({ id: `${thread}-${motivo}`, classe: 'thread', motivo, thread, fase: 'GO', comandoResposta, recomendacao: 'veja a thread', pergunta: '' })
const parado = (thread: string, caso: string, proximoPasso: string) =>
  ({ thread, caso, desdeEm: iso(T0 - 40 * MIN), paradoHaMin: 40, proximoPasso, evidencia: [], branch: null, pr: null, sessionId: null, prLidoEm: null })
const notificacoes = mundo => mundo.notificacoes.map(n => n.text)

test('o que so o dono resolve vira notificacao e diario uma vez por texto, com o registro na ponte e a conta na faixa', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a'), passo('ork-b', { conduzida: true })])
  mundo.pulse = pulso({ humanos: [humano('ork-a', 'claims.failed', 'corrija o artefato ou a alegacao e rode ork verify de novo')] })
  await iniciar($, relogio)
  const texto = 'ork-a (claims.failed): corrija o artefato ou a alegacao e rode ork verify de novo'
  expect(mundo.notificacoes).toEqual([{ text: texto, title: 'Sentinela' }])
  const mostrados = (await ponte($)).mostrados.filter(m => m.canal === 'notificacao')
  expect(mostrados).toEqual([{ mod: 'ork-sentinela', canal: 'notificacao', texto, chave: 'dono:ork-a:claims.failed', thread: 'ork-a' }])
  expect(await faixaEm($, 'terminal')).toEqual(['sentinela: 1 thread andando, 1 aviso para você'])
  expect(await sentinela($)).toContain(`aviso ork-a: ${texto}`)
  // O pulse seguinte (5 min) com o mesmo texto não repete; texto novo é aviso novo.
  await relogio.advance(5 * MIN)
  await relogio.settle()
  expect(notificacoes(mundo)).toEqual([texto])
  mundo.pulse = pulso({ humanos: [humano('ork-a', 'claims.failed', 'rode ork verify ork-a de novo')] })
  await relogio.advance(5 * MIN)
  await relogio.settle()
  expect(notificacoes(mundo)).toEqual([texto, 'ork-a (claims.failed): rode ork verify ork-a de novo'])
})

test('parado no condutor: avisa so o que ninguem faz sozinho; thread conduzida e verify.timeout nao viram aviso', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a'), passo('ork-c', { conduzida: true })])
  mundo.pulse = pulso({
    humanos: [humano('ork-c', 'human.pending', 'responda no terminal'), humano('ork-a', 'verify.timeout', 'ork retry run ork-a')],
    parados: [
      parado('ork-a', 'sessao-sem-pergunta', 'ler o fim da sessão 82b49aa6 (ork sessions logs 82b49aa6) e seguir a thread'),
      parado('ork-d', 'sem-push', 'publicar a branch ork/ork-d-full e abrir o PR'), parado('ork-e', 'pr-verde', 'mergear o PR #9'),
      parado('ork-f', 'fase-seguinte', 'despachar a fase PLAN'), parado('ork-g', 'check-sem-veredito', 'redespachar o CHECK'),
      parado('ork-c', 'sem-registro', 'registrar a entrega'),
    ],
  })
  await iniciar($, relogio)
  expect(notificacoes(mundo)).toEqual([
    'ork-a parado no condutor (sessao-sem-pergunta): ler o fim da sessão 82b49aa6 (ork sessions logs 82b49aa6) e seguir a thread',
  ])
})

test('em #Auto o aviso nunca manda pedir gate: o comando sai e o aviso diz por que; fora do #Auto ele fica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a'), passo('ork-b', { modo: 'classic' })])
  mundo.pulse = pulso({ humanos: [humano('ork-a', 'human.pending', 'ork gate request ork-a'), humano('ork-b', 'human.pending', 'ork gate request ork-b')] })
  await iniciar($, relogio)
  const [auto, classico] = notificacoes(mundo)
  expect(auto).toBe('ork-a (human.pending): (em #Auto o núcleo não abre gate; resolva pela ação da thread)')
  expect(auto).not.toContain('gate request')
  expect(classico).toBe('ork-b (human.pending): ork gate request ork-b')
})

test('despacho que a Sentinela nao conseguiu fazer vira aviso uma vez; pulse que falha so vai ao diario', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a', { acao: 'despachar', fase: 'PLAN', desdeEm: iso(T0 - MIN) })])
  mundo.render['ork-a'] = '# template fase-padrao v3\n\n<pedido do builder>\n'
  mundo.pulse = null
  await iniciar($, relogio)
  expect(notificacoes(mundo)).toEqual([
    'ork-a: a Sentinela não despachou o PLAN (a thread não tem o pedido guardado na criação (ork thread new --pedido): o render cairia no texto de exemplo)',
  ])
  expect(await sentinela($)).toContain('os avisos do pulse ficaram indisponíveis nesta rodada')
  await relogio.advance(60000)
  await relogio.settle()
  expect(notificacoes(mundo).length).toBe(1)
})

test('pausada ou com outra sessao conduzindo, a Sentinela nao avisa: o condutor externo segue avisando', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.batida = 'outra'
  mundo.status = status([passo('ork-a')], 'outra-sessao')
  mundo.pulse = pulso({ humanos: [humano('ork-a', 'claims.failed', 'rode ork verify')] })
  await iniciar($, relogio)
  expect(mundo.notificacoes).toEqual([])
  mundo.batida = 'minha'
  mundo.status = status([passo('ork-a')])
  await sentinela($, 'pausar')
  await relogio.advance(10 * MIN)
  await relogio.settle()
  expect(mundo.notificacoes).toEqual([])
  expect(await faixaEm($, 'desktop')).toEqual(['sentinela: pausada; o condutor externo conduz'])
})
