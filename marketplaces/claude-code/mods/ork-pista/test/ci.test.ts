import { test, expect, mock } from 'claude-code/testing'
import { A_VISTA, EPOCA, esperar, iniciar, montar, montarPainel, PONTE_FALSA, pista, saida, saidaDaPista, SHA_B, SHA_C, textosDe } from './apoio'

// O CI da Pista (T7.4): o evento do GitHub que cita o PR, a branch ou o head de uma pista so dispara a consulta ao
// nucleo (`ork ci status --sha <head> --json`), e a entrega segue para o modelo como chegou; sem evento, a reserva
// consulta a cada 2 min com o painel a vista e a cada 10 min escondido, so as pistas com PR aberto e CI aberto.
const PR_ABERTO = { numero: 7, url: 'https://github.com/acme/app/pull/7', estado: 'aberto', rascunho: false, head: SHA_B }
const ESPERANDO = pista('ork-c', { pr: PR_ABERTO, estados: { ci: 'pendente', entrega: 'pendente' },
  proximo: { acao: null, disponivel: false, texto: 'esperando o check ork-verify no PR #7', comando: `ork ci status --sha ${SHA_B}` } })
const VERDE = pista('ork-d', { pr: { ...PR_ABERTO, numero: 8, head: SHA_C }, estados: { entrega: 'pendente' },
  proximo: { acao: null, disponivel: false, texto: 'o PR #8 está pronto para o merge, que é do dono ou do condutor', comando: null } })
const SEM_PR = pista('ork-a', { estados: { branch: 'pendente', pr: 'pendente', ci: 'pendente', conflito: 'nao-se-aplica', entrega: 'pendente' } })
const ci = (state: string, sha = SHA_B) => ({ schema: 'ork.ci-status/v1', required: true, ok: state === 'success', provider: 'github',
  repository: 'acme/app', sha, context: 'ork-verify', state, url: 'https://github.com/acme/app/actions/runs/7', detail: 'x' })
const evento = (data: Record<string, unknown>, untrustedKeys: string[] = [], source = 'github') =>
  ({ origin: { kind: 'task-notification' }, text: 'evento do GitHub', event: { source, kind: 'check_run.completed', data, untrustedKeys } })
const consultasDoCi = mundo => mundo.processos.filter(a => a[1] === 'ci')
const leiturasDaPista = mundo => mundo.processos.filter(a => a[2] === 'pista').length
const VERMELHA = pista('ork-x', { pr: { ...PR_ABERTO, numero: 9 }, estados: { ci: 'falhou', entrega: 'pendente' },
  proximo: { acao: null, disponivel: false, texto: 'o check ork-verify está vermelho no PR #9: corrija pela sessão de GO e publique de novo', comando: null } })

async function ligada($, on, paineis: unknown[] = [], pistas: unknown[] = [ESPERANDO, VERDE, SEM_PR]) {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: saidaDaPista(pistas), paineis })
  await iniciar($)
  await relogio.advance(1)
  await esperar(() => mundo.processos.length > 0)
  await esperar(() => false, 20)
  return { relogio, mundo }
}

test('o evento do GitHub que cita o PR de uma pista relê o CI pelo nucleo no head, e a entrega segue para o modelo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligada($, on)
  mundo.respostas['ork ci status --sha'] = saida(0, ci('success'))
  mundo.processos.length = 0
  const r = await $.session.receive(evento({ pr: 'acme/app#7', outcome: 'success' }))
  expect(r.text).toBe('evento do GitHub')
  await relogio.settle()
  await esperar(() => mundo.processos.length >= 2)
  expect(mundo.processos[0]).toEqual(['ork', 'ci', 'status', '--sha', SHA_B, '--json'])
  // O CI fechou (verde): a pista inteira e relida, porque o proximo passo do nucleo muda.
  expect(mundo.processos[1]).toEqual(['ork', 'ship', 'pista', '--json'])
  await esperar(() => false, 20)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    const textos = await textosDe(ui)
    expect(textos).toContain('  CHECK ✓ · verify ✓ · bundle ✓ · branch ✓ · PR #7 ✓ · CI ✓ · conflito ✓ · entrega ·')
    await ui.unmount()
  }
})

test('evento com o PR so em campo de terceiros, de outra fonte, ou que nao cita pista nenhuma nao consulta nada', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligada($, on)
  mundo.respostas['ork ci status --sha'] = saida(0, ci('success'))
  mundo.processos.length = 0
  for (const e of [evento({ pr: 'acme/app#7', comment: 'oi' }, ['pr', 'comment']), evento({ pr: 'acme/app#7' }, [], 'artifact-room'),
    evento({ pr: 'acme/app#99' }), evento({ outcome: 'merged' })]) {
    const r = await $.session.receive(e)
    expect(r.text).toBe('evento do GitHub')
  }
  await relogio.settle()
  await esperar(() => false, 30)
  expect(consultasDoCi(mundo)).toEqual([])
  // A branch e o head asseridos tambem citam a pista.
  await $.session.receive(evento({ branch: 'ork/ork-c-full' }))
  await relogio.settle()
  await esperar(() => consultasDoCi(mundo).length > 0)
  expect(consultasDoCi(mundo)).toEqual([['ork', 'ci', 'status', '--sha', SHA_B, '--json']])
})

test('sem evento, a reserva consulta o CI so das pistas com PR aberto e CI aberto: 2 min a vista, 10 min escondido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligada($, on, A_VISTA)
  mundo.respostas['ork ci status --sha'] = saida(1, ci('pending'))
  await relogio.advance(60000)
  await esperar(() => false, 20)
  expect(consultasDoCi(mundo)).toEqual([['ork', 'ci', 'status', '--sha', SHA_B, '--json']], 'a primeira volta consulta a que nunca foi lida')
  await relogio.advance(60000)
  await esperar(() => false, 20)
  expect(consultasDoCi(mundo).length).toBe(1)
  await relogio.advance(60000)
  await esperar(() => consultasDoCi(mundo).length > 1)
  expect(consultasDoCi(mundo).length).toBe(2)
  // Escondido, so a cada 10 min.
  mundo.paineis = []
  await relogio.advance(5 * 60000)
  await esperar(() => false, 20)
  expect(consultasDoCi(mundo).length).toBe(2)
  await relogio.advance(5 * 60000)
  await esperar(() => consultasDoCi(mundo).length > 2)
  expect(consultasDoCi(mundo).length).toBe(3)
  expect(consultasDoCi(mundo).every(a => a[4] === SHA_B)).toBe(true)
})

test('o CI vermelho pela consulta aparece na pista e na faixa, e o CI do commit velho nao vale', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligada($, on, A_VISTA)
  mundo.respostas['ork ci status --sha'] = saida(1, ci('failure'))
  await relogio.advance(60000)
  await esperar(() => mundo.faixas.some(f => String((f as { texto?: string }).texto).includes('CI vermelho')))
  expect(mundo.faixas.at(-1)).toEqual({ mod: 'ork-pista', texto: '1 pronta para publicar · 1 com CI vermelho ou conflito · /pista' })
  const ui = await montarPainel($, 'terminal')
  const textos = await textosDe(ui)
  expect(textos).toContain('  CHECK ✓ · verify ✓ · bundle ✓ · branch ✓ · PR #7 ✓ · CI ✗ · conflito ✓ · entrega ·')
  expect(textos).toContain('    CI: check ork-verify vermelho no head bbbbbbb')
  await ui.unmount()
  // O nucleo respondeu por outro commit: a leitura nao vale; a etapa volta a ser a que o nucleo leu, com a falha ao lado.
  mundo.respostas['ork ci status --sha'] = saida(1, ci('failure', SHA_C))
  await $.session.receive(evento({ pr: 'acme/app#7' }))
  await relogio.settle()
  await esperar(() => false, 30)
  const depois = await montarPainel($, 'terminal')
  expect((await textosDe(depois)).some(t => t.startsWith('    CI: ci pendente (consulta: o CI não foi lido: o ork ci status respondeu pelo commit'))).toBe(true)
  await depois.unmount()
})

test('a consulta que falha nao apaga o CI verde que o nucleo leu, nem rele a pista', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligada($, on)
  mundo.respostas['ork ci status --sha'] = saida(1, '', 'HTTP 502: gateway')
  mundo.processos.length = 0
  await $.session.receive(evento({ pr: 'acme/app#8' }))
  await relogio.settle()
  await esperar(() => consultasDoCi(mundo).length > 0)
  await esperar(() => false, 30)
  expect(consultasDoCi(mundo)).toEqual([['ork', 'ci', 'status', '--sha', SHA_C, '--json']])
  expect(leiturasDaPista(mundo)).toBe(0)
  const ui = await montarPainel($, 'terminal')
  expect(await textosDe(ui)).toContain('  CHECK ✓ · verify ✓ · bundle ✓ · branch ✓ · PR #8 ✓ · CI ✓ · conflito ✓ · entrega ·')
  await ui.unmount()
})

test('a consulta que diz outra coisa que a pista (verde depois do vermelho) rele a pista uma vez por leitura', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await ligada($, on, [], [VERMELHA])
  mundo.respostas['ork ci status --sha'] = saida(0, ci('success'))
  mundo.processos.length = 0
  await $.session.receive(evento({ pr: 'acme/app#9' }))
  await relogio.settle()
  await esperar(() => leiturasDaPista(mundo) > 0)
  expect(mundo.processos).toEqual([['ork', 'ci', 'status', '--sha', SHA_B, '--json'], ['ork', 'ship', 'pista', '--json']])
  // O nucleo ainda le o vermelho: a mesma leitura do CI nao rele a pista de novo.
  await relogio.advance(60000)
  await $.session.receive(evento({ pr: 'acme/app#9' }))
  await relogio.settle()
  await esperar(() => consultasDoCi(mundo).length > 1)
  await esperar(() => false, 30)
  expect(consultasDoCi(mundo).length).toBe(2)
  expect(leiturasDaPista(mundo)).toBe(1)
})
