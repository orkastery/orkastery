import { test, expect } from 'claude-code/testing'
import { argvs, iniciar, iso, MARCA_DO_PEDIDO, MIN, montar, passo, PONTE_FALSA, SESSAO, sentinela, status, T0 } from './apoio'

// T6.2: o despacho da fase seguinte pelo núcleo, uma vez por turno, e a retomada só quando o retry plan é automático.
const FIM = iso(T0 - MIN)
const despachar = (thread: string, fase = 'PLAN', extra = {}) => passo(thread, { acao: 'despachar', fase, desdeEm: FIM, ...extra })
const despachos = mundo => mundo.processos.filter(p => p.argv[1] === 'phase' && p.argv[2] === 'run')
const retomadas = mundo => mundo.processos.filter(p => p.argv[1] === 'retry' && p.argv[2] === 'run')

test('fase concluida numa #Auto sem conducao: um despacho so, com o render do pedido guardado, o canal e a correlacao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a')])
  await iniciar($, relogio)
  const ordem = argvs(mundo).filter(a => !a.startsWith('ork conducao sentinela'))
  expect(ordem.slice(0, 2)).toEqual(['ork conducao status ork-a --json', 'ork prompt render ork-a PLAN'])
  expect(despachos(mundo).length).toBe(1)
  const argv = despachos(mundo)[0].argv
  expect(argv.slice(0, 5)).toEqual(['ork', 'phase', 'run', 'ork-a', 'PLAN'])
  expect(argv.slice(-4)).toEqual(['--canal', 'claude-code', '--correlacao', `sentinela:${SESSAO}`])
  expect(argv[6]).toContain(MARCA_DO_PEDIDO)
  expect(argv[6]).toContain('O prompt da fase PLAN de ork-a.')
  expect(mundo.retratos).toEqual([{ threadId: 'ork-a' }])
  // O mesmo turno na rodada seguinte, por ledger ou pela batida, nunca sai de novo.
  await $.classic.FileChanged({ file_path: '/projeto/.orkastery/threads/ork-a/ledger.jsonl', event: 'change' })
  await relogio.advance(60000)
  await relogio.settle()
  expect(despachos(mundo).length).toBe(1)
  expect(await sentinela($)).toContain('despacho ork-a: PLAN: despachada pelo núcleo')
  // Um turno novo (outro fim de turno) sai.
  mundo.status = status([despachar('ork-a', 'GO', { desdeEm: iso(T0 + 2 * MIN) })])
  await relogio.advance(60000)
  await relogio.settle()
  expect(despachos(mundo).map(p => p.argv[4])).toEqual(['PLAN', 'GO'])
})

test('outro condutor ja conduz: nada despachado; o phase run que sai 3 ou com HITL ocupado vira cedeu, sem repetir antes do adiamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a'), despachar('ork-b'), despachar('ork-c')])
  mundo.conducao['ork-a'] = { thread: 'ork-a', canal: 'hermes', fase: 'PLAN' }
  let vez = 0
  const respostas = [
    { exitCode: 3, stdout: 'Thread ork-b: conduzida agora por hermes', stderr: '' },
    { exitCode: 1, stdout: '', stderr: 'erro: HITL ocupado; exclusão do kernel não adquirida' },
  ]
  Object.defineProperty(mundo, 'despacho', { get: () => respostas[Math.min(vez++, respostas.length - 1)] })
  await iniciar($, relogio)
  expect(despachos(mundo).map(p => p.argv[3])).toEqual(['ork-b', 'ork-c'])
  const diario = await sentinela($)
  expect(diario).toContain('cedeu ork-a: PLAN: outro condutor já conduz a thread; nada despachado')
  expect(diario).toContain('cedeu ork-b: PLAN: outro condutor conduz agora; nada despachado (Thread ork-b: conduzida agora por hermes)')
  expect(diario).toContain('cedeu ork-c: PLAN: outro condutor conduz agora; nada despachado (outro despacho tomou a vez no mesmo instante)')
  await relogio.advance(60000)
  await relogio.settle()
  expect(despachos(mundo).length).toBe(2)
})

test('pedido repetido do nucleo e so diario; despacho que falha vai ao diario como erro e so volta depois do adiamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a')])
  mundo.despacho = { exitCode: 0, stdout: 'Pedido ja em andamento: a fase PLAN da thread ork-a roda com este mesmo prompt', stderr: '' }
  await iniciar($, relogio)
  expect(await sentinela($)).toContain('cedeu ork-a: PLAN: o mesmo pedido já estava em andamento; nada novo')
  mundo.status = status([despachar('ork-b')])
  mundo.despacho = { exitCode: 1, stdout: '', stderr: 'erro: runtime.unavailable: claude nao responde' }
  await relogio.advance(60000)
  await relogio.settle()
  expect(await sentinela($)).toContain('erro ork-b: PLAN: o despacho falhou (o despacho saiu 1: erro: runtime.unavailable: claude nao responde)')
  await relogio.advance(60000)
  await relogio.settle()
  expect(despachos(mundo).map(p => p.argv[3])).toEqual(['ork-a', 'ork-b'])
})

test('sem o pedido guardado, ou com pedido aberto ao dono no retrato, a Sentinela nao despacha', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a'), despachar('ork-b')])
  mundo.render['ork-a'] = '# template fase-padrao v3\n# thread ork-a, fase PLAN, sha256 abc\n\n<pedido do builder>\n'
  mundo.hitl['ork-b'] = [{ id: 'p1', title: 'Qual o veredito?', status: 'aberto', refs: [{ kind: 'thread', id: 'ork-b' }], facts: { target: 'gate' } }]
  await iniciar($, relogio)
  expect(despachos(mundo)).toEqual([])
  const diario = await sentinela($)
  expect(diario).toContain('erro ork-a: PLAN: não despachada: a thread não tem o pedido guardado na criação')
  expect(diario).toContain('cedeu ork-b: PLAN: há pedido aberto ao dono na thread; o despacho espera a resposta')
})

test('so a Sentinela com a presenca desta maquina despacha, e nunca pausada; passo fora do #Auto ou conduzido nao sai', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.batida = 'outra'
  mundo.status = status([despachar('ork-a')], 'outra-sessao')
  await iniciar($, relogio)
  expect(despachos(mundo)).toEqual([])
  mundo.batida = 'minha'
  mundo.status = status([despachar('ork-a', 'PLAN', { modo: 'classic' }), despachar('ork-b', 'PLAN', { conduzida: true }), despachar('ork-c')])
  await sentinela($, 'pausar')
  await relogio.advance(60000)
  await relogio.settle()
  expect(despachos(mundo)).toEqual([])
  await sentinela($, 'retomar')
  expect(despachos(mundo).map(p => p.argv[3])).toEqual(['ork-c'])
})

test('retomar: o retry plan decide; o retry run so roda automatico, sem --por e com o canal claude-code no ambiente', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  const bloqueio = (motivo: string) => ({ motivo, em: FIM })
  mundo.status = status([
    passo('ork-a', { acao: 'retomar', bloqueio: bloqueio('human.pending'), desdeEm: FIM }),
    passo('ork-b', { acao: 'retomar', bloqueio: bloqueio('runtime.quota-exhausted'), desdeEm: FIM }),
  ])
  mundo.retry['ork-a'] = { automatica: false, bloqueio: 'politica.nao-automatica' }
  mundo.retry['ork-b'] = { automatica: true, bloqueio: null }
  await iniciar($, relogio)
  expect(argvs(mundo).filter(a => a.startsWith('ork retry plan'))).toEqual(['ork retry plan ork-a --json', 'ork retry plan ork-b --json'])
  expect(retomadas(mundo).map(p => p.argv)).toEqual([['ork', 'retry', 'run', 'ork-b']])
  expect(retomadas(mundo)[0].env).toEqual({ ORK_CANAL: 'claude-code' })
  const diario = await sentinela($)
  expect(diario).toContain('retomada ork-a: bloqueio human.pending: o retry plan não é automático (politica.nao-automatica); o passo é do dono')
  expect(diario).toContain('retomada ork-b: bloqueio runtime.quota-exhausted: retomado pelo núcleo')
  await relogio.advance(60000)
  await relogio.settle()
  expect(argvs(mundo).filter(a => a.startsWith('ork retry plan')).length).toBe(2)
  expect(retomadas(mundo).length).toBe(1)
})

const pedidoAberto = (thread: string) => [{ id: 'p1', title: 'Qual o veredito?', status: 'aberto', refs: [{ kind: 'thread', id: thread }], facts: { target: 'gate' } }]
const batidas = mundo => argvs(mundo).filter(a => a.startsWith('ork conducao sentinela bater')).length

test('recusa que passa nao queima o turno: pedido aberto respondido e projeto sem vaga despacham depois do adiamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a'), despachar('ork-b')])
  mundo.hitl['ork-a'] = pedidoAberto('ork-a')
  let vez = 0
  Object.defineProperty(mundo, 'despacho', {
    get: () => (vez++ === 0 ? { exitCode: 3, stdout: 'Projeto sem vaga: 3 de 3 sessoes ocupadas', stderr: '' } : { exitCode: 0, stdout: 'Fase despachada.', stderr: '' }),
  })
  await iniciar($, relogio)
  expect(despachos(mundo).map(p => p.argv[3])).toEqual(['ork-b'])
  mundo.hitl['ork-a'] = []
  await relogio.advance(2 * MIN)
  await relogio.settle()
  expect(despachos(mundo).length).toBe(1)
  await relogio.advance(2 * MIN)
  await relogio.settle()
  expect(despachos(mundo).map(p => p.argv[3])).toEqual(['ork-b', 'ork-a', 'ork-b'])
  const diario = await sentinela($)
  expect(diario).toContain('despacho ork-a: PLAN: despachada pelo núcleo')
  expect(diario).toContain('despacho ork-b: PLAN: despachada pelo núcleo')
  // Feito, o turno não sai mais.
  await relogio.advance(5 * MIN)
  await relogio.settle()
  expect(despachos(mundo).length).toBe(3)
})

test('um despacho lento nao deixa a presenca vencer: a batida segue no relogio dela, e o turno sai uma vez', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a')])
  mundo.atrasoDoDespacho = 4 * MIN
  await iniciar($, relogio)
  const antes = batidas(mundo)
  await relogio.advance(3 * MIN)
  await relogio.settle()
  expect(batidas(mundo)).toBe(antes + 3)
  await relogio.advance(2 * MIN)
  await relogio.settle()
  expect(despachos(mundo).length).toBe(1)
  expect(await sentinela($)).toContain('despacho ork-a: PLAN: despachada pelo núcleo')
})

test('retomar espera o pedido aberto ao dono e a conducao de outro: o retry run so sai depois, e uma vez', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([passo('ork-a', { acao: 'retomar', bloqueio: { motivo: 'runtime.quota-exhausted', em: FIM }, desdeEm: FIM })])
  mundo.retry['ork-a'] = { automatica: true, bloqueio: null }
  mundo.hitl['ork-a'] = pedidoAberto('ork-a')
  await iniciar($, relogio)
  expect(retomadas(mundo)).toEqual([])
  expect(argvs(mundo).filter(a => a.startsWith('ork retry plan'))).toEqual([])
  expect(await sentinela($)).toContain('há pedido aberto ao dono na thread; a retomada espera a resposta')
  mundo.hitl['ork-a'] = []
  mundo.conducao['ork-a'] = { thread: 'ork-a', canal: 'hermes' }
  await relogio.advance(4 * MIN)
  await relogio.settle()
  expect(retomadas(mundo)).toEqual([])
  mundo.conducao['ork-a'] = null
  // A segunda recusa seguida dobrou o adiamento (6 min): a retomada sai na rodada depois dele.
  await relogio.advance(7 * MIN)
  await relogio.settle()
  expect(retomadas(mundo).length).toBe(1)
  await relogio.advance(5 * MIN)
  await relogio.settle()
  expect(retomadas(mundo).length).toBe(1)
})

test('a mesma recusa seguida dobra o adiamento ate o teto: falha que nao passa nao vira despacho a cada 3 min', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = montar(on)
  mundo.status = status([despachar('ork-a')])
  mundo.despacho = { exitCode: 1, stdout: '', stderr: 'erro: runtime.unavailable: sem runtime' }
  await iniciar($, relogio)
  await relogio.advance(30 * MIN)
  await relogio.settle()
  // Tentativas em 0, 3, 9, 21 min (3, 6 e 12 min de espera): 4 em 30 min, contra 10 com a espera fixa.
  expect(despachos(mundo).length).toBe(4)
  expect(mundo.notificacoes.length).toBe(1)
  expect(await sentinela($)).toContain('tenta de novo em 24 min')
})
