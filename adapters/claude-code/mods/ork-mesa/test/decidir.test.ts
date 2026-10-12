import { test, expect, mock } from 'claude-code/testing'
import {
  A_VISTA, decisaoDaMesaPara, decisaoDe, drenar, EPOCA, iniciar, mesa, montar, montarPainel, PARADA, PEDIDO_4, PEDIDO_OBVIO, pedidoDe,
  pendentesDe, PONTE_FALSA, pulseCom, retratoHitl, textosDe, textosDoPainel,
} from './apoio'

// O Decidir, a decisao obvia e o caso negativo (T5.3). A Mesa so manda ao nucleo os dois ids do pedido (o dialogo
// nativo e do host) e, na decisao obvia, a decisao autonoma do nucleo; nenhum caminho responde o pedido.
const LISTA_FECHADA = ['ork_hitl_pending', 'ork_request_decision', 'ork_decision_record']

test('Decidir chama ork_request_decision com exatamente threadId e pedidoId e mostra o que o nucleo devolveu', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) },
    respostaDecidir: { ok: true, pedidoId: PEDIDO_4.id, estado: 'aguardando', repetida: false } })
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: `decidir:${PEDIDO_4.id}` })
  await drenar()
  expect(mundo.decidir).toEqual([{ threadId: 'ork-a', pedidoId: PEDIDO_4.id }])
  expect(Object.keys(mundo.decidir[0]).sort()).toEqual(['pedidoId', 'threadId'])
  expect(await textosDe(ui)).toContain('  respondido pelo diálogo: aguardando')
  // A Mesa nao registra decisao nenhuma por conta propria quando o dono decide.
  expect(mundo.decisoes).toEqual([])
  await ui.unmount()
})

test('Decidir sem resposta ou com erro deixa o pedido aberto e a reserva a vista', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) },
    respostaDecidir: { ok: false, pedidoId: PEDIDO_4.id, estado: 'pendente', repetida: false } })
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'desktop')
  await ui.press({ key: `decidir:${PEDIDO_4.id}` })
  await drenar()
  let textos = await textosDe(ui)
  expect(textos).toContain('  o diálogo fechou sem resposta; o pedido segue aberto')
  expect(textos).toContain('  reserva: K7Q2 c pelo Telegram')
  expect(textos).toContain('Decidir')
  mundo.erroDecidir = 'hitl.local.pedido-expirado'
  await ui.press({ key: `decidir:${PEDIDO_4.id}` })
  await drenar()
  textos = await textosDe(ui)
  expect(textos).toContain('  o Decidir falhou: hitl.local.pedido-expirado; use a reserva')
  await ui.unmount()
})

test('decisao obvia: as quatro condicoes, uma chamada de ork_decision_record, sem dialogo e sem notificar; o cartao mostra o que foi decidido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  // Depois da gravacao, o nucleo passa a servir o pulse com a decisao da Mesa: ela chega no lote seguinte.
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_OBVIO] }), pendentes: { 'ork-b': pendentesDe('ork-b', [PEDIDO_OBVIO]) },
    paineis: A_VISTA, pulseDepoisDaDecisao: pulseCom({ pedidos: [PEDIDO_OBVIO], decisoes: [decisaoDaMesaPara(PEDIDO_OBVIO)] }) })
  await iniciar($)
  await drenar()
  expect(mundo.decisoes.length).toBe(1)
  // A releitura logo depois da gravacao: dois pulses sem nenhum gesto do dono, e o cartao ja na tela.
  expect(mundo.ler.filter(l => l.consulta === 'pulse').length).toBe(2)
  expect(await textosDoPainel($, 'desktop')).toContain('  Sem te chamar: o pedido B2X9 (ob000000) da ork-b segue a recomendada a')
  const d = mundo.decisoes[0]
  expect(Object.keys(d).sort()).toEqual(['comoMudar', 'criterio', 'custoAgora', 'custoDepois', 'decidido', 'evidencia', 'porque', 'quemDecidiu', 'threadId'])
  expect(d.threadId).toBe('ork-b')
  expect(d.decidido).toBe('Sem te chamar: o pedido B2X9 (ob000000) da ork-b segue a recomendada a (Aprovar com as evidências apresentadas) no prazo 12/10 14:46 (horário de Brasília)')
  expect(d.criterio).toEqual({ tipo: 'medicao', referencia: '.orkastery/threads/ork-b/ledger.jsonl: o hitl_requested do pedido ob000000-0000-4000-8000-000000000002 declara acaoPadraoAoExpirar seguir-recomendada, sem ato irreversível' })
  expect(d.quemDecidiu).toBe('mod ork-mesa na sessão do dono, pelo teste das quatro condições')
  expect(d.comoMudar).toBe('Na Mesa, Decidir no cartão do pedido B2X9 antes do prazo ou B2X9 a pelo Telegram')
  for (const campo of ['decidido', 'porque', 'comoMudar']) expect(d[campo].length <= 200 && !/\n/.test(d[campo])).toBe(true)
  for (const campo of ['custoAgora', 'custoDepois']) expect(d[campo].length <= 140).toBe(true)
  expect(mundo.decidir).toEqual([])
  expect(mundo.notificacoes).toEqual([])
  // O pulse traz a decisao da Mesa: ela nao registra de novo, nem depois de outras leituras.
  mundo.pulse = pulseCom({ pedidos: [PEDIDO_OBVIO], decisoes: [decisaoDe({ id: 'dm000000-0000-4000-8000-000000000009', thread: 'ork-b', minutos: 0,
    decidido: d.decidido, quem: d.quemDecidiu })] })
  await mesa($)
  await relogio.advance(20 * 60000)
  expect(mundo.decisoes.length).toBe(1)
  const ui = await montarPainel($, 'terminal')
  const textos = await textosDe(ui)
  expect(textos).toContain('✓ ork-b · GO · código B2X9 · prazo 12/10 14:46 (horário de Brasília)')
  expect(textos).toContain('  decidido sem te chamar: segue a recomendada no prazo; para mudar, Decidir antes do prazo')
  expect(textos).toContain(`  ${d.decidido}`)
  expect(textos[0]).toBe('0 esperam você · 1 decidida sem te chamar (1 nova) · 0 paradas · lido há 0 s')
  await ui.unmount()
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-mesa', texto: 'mesa: 1 decidida sem te chamar' })
})

test('decisao obvia so de pedido conferido: sem o ork_hitl_pending a Mesa nao decide nem inventa a evidencia', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_OBVIO] }) })
  await iniciar($)
  await drenar()
  await relogio.advance(10 * 60000)
  expect(mundo.hitlPending.length).toBeGreaterThan(0)
  expect(mundo.decisoes).toEqual([])
  const textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain('não conferi os pedidos da ork-b no núcleo: thread sem pedidos')
  expect(textos).not.toContain('Decidir')
})

test('gravacao lenta da decisao obvia fica incerta (sem chamar o dono) e vira registrada quando o pulse a mostra', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', relogio, pulse: pulseCom({ pedidos: [PEDIDO_OBVIO] }), pendentes: { 'ork-b': pendentesDe('ork-b', [PEDIDO_OBVIO]) },
    paineis: A_VISTA, pulseDepoisDaDecisao: pulseCom({ pedidos: [PEDIDO_OBVIO], decisoes: [decisaoDaMesaPara(PEDIDO_OBVIO)] }) })
  mundo.atrasoDaDecisaoMs = 70000
  await iniciar($)
  await drenar()
  await relogio.advance(61000)
  await drenar()
  let textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain('  a Mesa pediu ao núcleo a decisão óbvia e confere na próxima leitura se ela foi gravada')
  expect(mundo.notificacoes).toEqual([])
  // A escrita chega aos 70 s; a conferencia seguinte ve a decisao no pulse.
  await relogio.advance(40000)
  await drenar()
  textos = await textosDoPainel($, 'terminal')
  expect(textos).toContain('  decidido sem te chamar: segue a recomendada no prazo; para mudar, Decidir antes do prazo')
  expect(textos.some(t => t.startsWith('  a Mesa não decidiu'))).toBe(false)
  expect(mundo.notificacoes).toEqual([])
  expect(mundo.decisoes.length).toBe(1)
})

test('decisao obvia ja registrada por outra sessao (marca do pedido no pulse) nao e registrada de novo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const anterior = decisaoDe({ id: 'dm000000-0000-4000-8000-000000000008', thread: 'ork-b', minutos: 5,
    decidido: 'Sem te chamar: o pedido B2X9 (ob000000) da ork-b segue a recomendada a', quem: 'mod ork-mesa na sessão do dono, pelo teste das quatro condições' })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_OBVIO], decisoes: [anterior] }),
    pendentes: { 'ork-b': pendentesDe('ork-b', [PEDIDO_OBVIO]) } })
  await iniciar($)
  await drenar()
  await mesa($)
  expect(mundo.decisoes).toEqual([])
  expect(mundo.notificacoes).toEqual([])
})

test('a recusa do nucleo deixa a pergunta como pergunta, com o motivo, e entao ela notifica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_OBVIO] }), pendentes: { 'ork-b': pendentesDe('ork-b', [PEDIDO_OBVIO]) },
    recusarDecisao: 'decisão informada: a fase mudou enquanto ela era registrada' })
  await iniciar($)
  await drenar()
  await mesa($)
  expect(mundo.decisoes.length).toBe(1)
  const ui = await montarPainel($, 'terminal')
  const textos = await textosDe(ui)
  expect(textos).toContain('? ork-b · GO · código B2X9 · prazo 12/10 14:46 (horário de Brasília)')
  expect(textos).toContain('  a Mesa não decidiu: decisão informada: a fase mudou enquanto ela era registrada')
  expect(textos).toContain('Decidir')
  await ui.unmount()
  expect(mundo.notificacoes).toEqual([{ text: 'ork-b espera você: Qual é o veredito sobre as evidências do CHECK?', title: 'Mesa do Dono' }])
})

test('cada condicao que falha sozinha deixa o pedido como pergunta com Decidir, e nada e registrado', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const base = { thread: 'ork-b', fase: 'GO', recomendada: 'a', letras: ['a', 'b', 'c'], expirar: 'seguir-recomendada' }
  const casos = [
    pedidoDe({ ...base, id: 'f0000000-0000-4000-8000-000000000000', codigo: 'F0F0', fase: 'PLAN' }),
    pedidoDe({ ...base, id: 'f1000000-0000-4000-8000-000000000001', codigo: 'F1F1', expirar: 'esperar' }),
    pedidoDe({ ...base, id: 'f2000000-0000-4000-8000-000000000002', codigo: 'F2F2', fase: 'SHIP' }),
    pedidoDe({ ...base, id: 'f3000000-0000-4000-8000-000000000003', codigo: 'F3F3', irreversivel: true, ato: 'push-base-protegida', expirar: 'esperar' }),
    pedidoDe({ ...base, id: 'f4000000-0000-4000-8000-000000000004', codigo: 'F4F4', motivo: 'cost.violation' }),
    pedidoDe({ ...base, id: 'f5000000-0000-4000-8000-000000000005', codigo: 'F5F5', alvo: { tipo: 'session', sessionId: 's1', runtime: 'claude-bg' } }),
    pedidoDe({ ...base, id: 'f6000000-0000-4000-8000-000000000006', codigo: 'F6F6', prazoMs: -60000 }),
  ]
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: casos }), pendentes: { 'ork-b': pendentesDe('ork-b', casos) } })
  await iniciar($)
  await drenar()
  await mesa($)
  expect(mundo.decisoes).toEqual([])
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'proximas' })
  const textos = [...await textosDe(ui)]
  await ui.press({ key: 'anteriores' })
  textos.push(...await textosDe(ui))
  await ui.unmount()
  for (const motivo of ['  pergunta: é decisão de escopo ou produto (GOAL, PLAN ou política)', '  pergunta: não dá para desfazer antes da entrega',
    '  pergunta: o ato é irreversível', '  pergunta: o ato gasta dinheiro', '  pergunta: errar não sai barato, ou só o dono resolve']) {
    expect(textos).toContain(motivo)
  }
  // Sem criterio escrito (o pedido espera o dono) a regra nao se repete no cartao.
  expect(textos).not.toContain('  pergunta: não há critério escrito que a Mesa leia pelo núcleo')
  expect(textos).toContain('  sem volta: push-base-protegida')
  expect(mundo.notificacoes).toEqual([{ text: '7 pedidos esperam você: ork-b', title: 'Mesa do Dono' }])
})

test('notificacao que nao sai fica no aviso, nao entra no registro e volta na leitura seguinte; a que saiu nao repete', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) } })
  mundo.notificacaoSai = false
  await iniciar($)
  await drenar()
  expect(mundo.notificacoes.length).toBe(1)
  expect(mundo.mostrados.filter(m => m.canal === 'notificacao')).toEqual([])
  expect(await textosDoPainel($, 'terminal')).toContain(
    'não avisei o dono do pedido novo: a notificação do sistema não saiu (disabled); a faixa e o painel seguem')
  mundo.notificacaoSai = true
  await mesa($)
  expect(mundo.notificacoes.length).toBe(2)
  expect(mundo.mostrados.filter(m => m.canal === 'notificacao').length).toBe(1)
  await relogio.advance(20 * 60000)
  await mesa($)
  expect(mundo.notificacoes.length).toBe(2)
})

test('o pedido que o registro da ponte ja diz notificado (de antes de uma recarga) nao notifica de novo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) },
    registro: [{ mod: 'ork-mesa', canal: 'notificacao', chave: `hitl:${PEDIDO_4.id}`, thread: 'ork-a', texto: 'ork-a espera você' }] })
  await iniciar($)
  await drenar()
  await mesa($)
  expect(mundo.notificacoes).toEqual([])
})

test('Decidir espera o dialogo ate o teto de 310 s, sem dar erro aos 20 s', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', relogio, pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) },
    respostaDecidir: { ok: true, pedidoId: PEDIDO_4.id, estado: 'aprovado', repetida: false } })
  mundo.atrasoDoDecidirMs = 60000
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: `decidir:${PEDIDO_4.id}` })
  await drenar()
  await relogio.advance(25000)
  await drenar()
  let textos = await textosDe(ui)
  expect(textos).toContain('  diálogo pedido: responda na janela do Claude Code')
  expect(textos.some(t => t.startsWith('  o Decidir falhou'))).toBe(false)
  await relogio.advance(40000)
  await drenar()
  textos = await textosDe(ui)
  expect(textos).toContain('  respondido pelo diálogo: aprovado')
  await ui.unmount()
})

test('dois toques no Decidir ao mesmo tempo abrem um dialogo so', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', relogio, pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) } })
  mundo.atrasoDoDecidirMs = 30000
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'terminal')
  await Promise.all([ui.press({ key: `decidir:${PEDIDO_4.id}` }), ui.press({ key: `decidir:${PEDIDO_4.id}` })])
  await drenar()
  await relogio.advance(31000)
  await drenar()
  expect(mundo.decidir.length).toBe(1)
  await ui.unmount()
})

test('pergunta nova notifica uma vez e entra no registro do mostrado como notificacao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) },
    retrato: retratoHitl([PEDIDO_4.id]) })
  await iniciar($)
  await drenar()
  await relogio.advance(40 * 60000)
  await mesa($)
  expect(mundo.notificacoes).toEqual([{ text: 'ork-a espera você: Qual é o veredito sobre as evidências do CHECK?', title: 'Mesa do Dono' }])
  expect(mundo.mostrados.filter(m => m.canal === 'notificacao')).toEqual([{ mod: 'ork-mesa', canal: 'notificacao',
    chave: `hitl:${PEDIDO_4.id}`, thread: 'ork-a', texto: 'ork-a espera você: Qual é o veredito sobre as evidências do CHECK?' }])
})

test('o retrato que muda faz reler o pulse antes da hora; sem mudanca, o pulse espera a idade', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({}), retrato: retratoHitl([]), paineis: A_VISTA })
  await iniciar($)
  await drenar()
  const leituras = () => mundo.ler.filter(l => l.consulta === 'pulse').length
  expect(leituras()).toBe(1)
  await relogio.advance(60000)
  expect(leituras()).toBe(1)
  mundo.retrato = retratoHitl([PEDIDO_4.id])
  mundo.pulse = pulseCom({ pedidos: [PEDIDO_4] })
  mundo.pendentes['ork-a'] = pendentesDe('ork-a', [PEDIDO_4])
  await relogio.advance(30000)
  await drenar()
  expect(leituras()).toBe(2)
  expect(mundo.notificacoes.length).toBe(1)
})

test('caso negativo: nenhum caminho do modulo responde ao pedido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const pedidos = [PEDIDO_4, PEDIDO_OBVIO, pedidoDe({ id: 'f7000000-0000-4000-8000-000000000007', thread: 'ork-a', codigo: 'F7F7',
    alvo: { tipo: 'session', sessionId: 's1', runtime: 'claude-bg' } })]
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos, outros: [PARADA], decisoes: [decisaoDe({ id: 'dn000000-0000-4000-8000-000000000001', thread: 'ork-a', minutos: 3 })] }),
    pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4, pedidos[2]]), 'ork-b': pendentesDe('ork-b', [PEDIDO_OBVIO]) }, paineis: A_VISTA })
  await iniciar($)
  await drenar()
  await mesa($)
  await mesa($, 'ork-a')
  const ui = await montarPainel($, 'terminal')
  for (const chave of ['atualizar', `decidir:${PEDIDO_4.id}`, `decidir:${pedidos[2].id}`, 'ver-todas', `decidir:${PEDIDO_OBVIO.id}`]) {
    await ui.press({ key: chave })
    await drenar()
  }
  await ui.unmount()
  await relogio.advance(30 * 60000)
  // Nada de processo, de texto como se fosse do dono nem de linha de usuario.
  expect(mundo.proibidas).toEqual([])
  // Ferramenta do nucleo so da lista fechada, e nenhuma fora do servidor `orkastery` alem da ponte falsa.
  expect(mundo.outrasMcp).toEqual([])
  // O Decidir leva so os dois ids; nenhum argumento traz opcao, letra, resposta ou texto do dono.
  expect(mundo.decidir.length).toBe(3)
  for (const args of mundo.decidir) expect(Object.keys(args).sort()).toEqual(['pedidoId', 'threadId'])
  const tudo = JSON.stringify([...mundo.decidir, ...mundo.decisoes, ...mundo.hitlPending])
  for (const campo of ['"opcao"', '"resposta"', '"answer"', '"letra"', '"escolha"']) expect(tudo.includes(campo)).toBe(false)
  // A unica escrita do nucleo alem do dialogo e a decisao obvia do pedido que passou no teste, uma vez.
  expect(mundo.decisoes.map(d => d.threadId)).toEqual(['ork-b'])
  expect(LISTA_FECHADA).toEqual(['ork_hitl_pending', 'ork_request_decision', 'ork_decision_record'])
})

test('trabalho em segundo plano que acaba depois do fim da sessao nao deixa rejeicao sem tratamento', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pulse: pulseCom({ pedidos: [PEDIDO_4] }), pendentes: { 'ork-a': pendentesDe('ork-a', [PEDIDO_4]) } })
  // O nucleo so responde o Decidir depois que o teste acabou: a Mesa ainda grava o estado e relê a fila, e o motor
  // recusa as chamadas do ambiente encerrado. Sem o tratamento do segundo plano, o arquivo inteiro reprova.
  mundo.atrasoRealDoDecidirMs = 40
  await iniciar($)
  await mesa($)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: `decidir:${PEDIDO_4.id}` })
  await ui.unmount()
  expect(mundo.decidir.length).toBe(1)
})
