import { test, expect, mock } from 'claude-code/testing'
import { EPOCA, esperar, iniciar, abrirPista, montar, montarPainel, PONTE_FALSA, pista, saida, saidaDaPista, SHA_A, textosDe } from './apoio'

// Os botoes da Pista (T7.3): botao so com a acao que o nucleo declara disponivel; o clique relê a pista da thread e
// chama `$.process.run` com o argv do construtor do mod (`ork ship publicar` ou `ork ship registrar-pr`), nunca com
// `git` nem `gh`; fora de #Auto e #Maestro, so o comando para o dono.
const CLASSIC = pista('ork-b', { publicavel: false, estados: { branch: 'pendente', pr: 'pendente', ci: 'pendente', conflito: 'nao-se-aplica', entrega: 'pendente' },
  proximo: { acao: 'publicar', disponivel: false, texto: 'o modo #Classic da ork-b pede a sua autorização de push: publique do seu terminal',
    comando: 'o comando que o dono roda' } })
const AUTO = pista('ork-a', { estados: { branch: 'pendente', pr: 'pendente', ci: 'pendente', conflito: 'nao-se-aplica', entrega: 'pendente' } })
const MESCLADA = pista('ork-m', { pr: { numero: 5, url: null, estado: 'mesclado', rascunho: false, head: SHA_A }, estados: { ci: 'nao-se-aplica', entrega: 'pendente' },
  proximo: { acao: 'registrar', disponivel: true, texto: 'mesclado na base: registre a entrega', comando: 'ork ship registrar-pr ork-m' } })
const PUBLICOU = { contrato: 'ork.ship-publicar/v1', thread: 'ork-a', modo: 'auto', tag: '#Auto', acao: 'publicou', motivo: null, detalhe: 'x', correcao: '',
  branch: 'ork/ork-a-full', base: 'main', remoto: 'origin', head: SHA_A, remotaAntes: null, remota: SHA_A, pushVerificado: true,
  pr: { numero: 9, url: 'https://github.com/acme/app/pull/9', criado: true }, corpo: 'pr-body.md', passos: [], dryRun: false }

async function preparado(on, pistas = [AUTO, CLASSIC, MESCLADA]) {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, { papel: 'dono', pista: saidaDaPista(pistas) })
  return { relogio, mundo }
}

async function aberta($, mundo, relogio) {
  await iniciar($)
  await abrirPista($)
  await relogio.settle()
  await esperar(() => mundo.processos.length > 0)
  await esperar(() => false, 20)
}

const botoes = async ui => (await ui.findAll({})).filter(e => e.type === 'Button').map(e => e.text)
const semGitNemGh = mundo => mundo.processos.every(a => a[0] === 'ork' && !a.includes('git') && !a.includes('gh') && !a.includes('--autorizar-push'))

test('#Auto: o botao Publicar aparece com a acao declarada, e o clique chama o ork ship publicar pelo argv do mod', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on)
  mundo.respostas['ork ship publicar ork-a'] = saida(0, PUBLICOU)
  await aberta($, mundo, relogio)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    expect(await botoes(ui)).toEqual(['Atualizar', 'Publicar', 'Registrar a entrega'])
    await ui.unmount()
  }
  const ui = await montarPainel($, 'terminal')
  mundo.processos.length = 0
  await ui.press({ key: 'publicar:ork-a' })
  await relogio.settle()
  await esperar(() => mundo.processos.length >= 3)
  expect(mundo.processos.slice(0, 2)).toEqual([['ork', 'ship', 'pista', 'ork-a', '--json'], ['ork', 'ship', 'publicar', 'ork-a', '--json']])
  expect(semGitNemGh(mundo)).toBe(true)
  await esperar(() => false, 20)
  expect(await textosDe(ui)).toContain('  publicar: publicada no HEAD aaaaaaa, push provado pelo ls-remote; PR #9 aberto agora')
  await ui.unmount()
})

test('#Classic: nenhum botao de publicar, so o comando para o dono no terminal dele', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on, [CLASSIC])
  await aberta($, mundo, relogio)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await montarPainel($, surface)
    expect(await botoes(ui)).toEqual(['Atualizar'])
    const textos = await textosDe(ui)
    expect(textos).toContain('  no seu terminal: o comando que o dono roda')
    expect(textos).toContain('  próximo: o modo #Classic da ork-b pede a sua autorização de push: publique do seu terminal')
    await ui.unmount()
  }
  expect(mundo.processos.every(a => a.join(' ') === 'ork ship pista --json')).toBe(true)
})

test('o clique que acha a acao fora do nucleo na releitura nao roda nada e diz o que mudou', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on)
  await aberta($, mundo, relogio)
  const ui = await montarPainel($, 'terminal')
  // Entre o desenho e o clique, outra sessao passou a conduzir a thread: o nucleo nao declara mais o publicar.
  mundo.pista = saidaDaPista([{ ...AUTO, conduzida: true, proximo: { acao: null, disponivel: false,
    texto: 'a sessão 1a2b3c4d conduz a thread agora; a entrega espera o fim do turno', comando: 'ork conducao status ork-a' } }, CLASSIC, MESCLADA])
  mundo.processos.length = 0
  await ui.press({ key: 'publicar:ork-a' })
  await relogio.settle()
  await esperar(() => mundo.processos.length >= 2)
  await esperar(() => false, 20)
  expect(mundo.processos.some(a => a[2] === 'publicar')).toBe(false)
  const textos = await textosDe(ui)
  expect(textos).toContain('  publicar: o núcleo não declara mais esta ação: a sessão 1a2b3c4d conduz a thread agora; a entrega espera o fim do turno')
  expect(await botoes(ui)).toEqual(['Atualizar', 'Registrar a entrega'])
  await ui.unmount()
})

test('a recusa do nucleo vira a linha da pista com o motivo tipado e a correcao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on)
  mundo.respostas['ork ship publicar ork-a'] = saida(1, { ...PUBLICOU, acao: 'recusada', motivo: 'verify.failed', pushVerificado: false, pr: null,
    detalhe: 'o último ork verify reprovou no commit aaaaaaa (claims.failed)', correcao: 'rode ork verify ork-a no HEAD e corrija antes de publicar' })
  await aberta($, mundo, relogio)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'publicar:ork-a' })
  await relogio.settle()
  await esperar(() => mundo.processos.some(a => a[2] === 'publicar'))
  await esperar(() => false, 20)
  expect(await textosDe(ui)).toContain('  publicar: recusada (verify.failed): o último ork verify reprovou no commit aaaaaaa (claims.failed); ' +
    'rode ork verify ork-a no HEAD e corrija antes de publicar')
  await ui.unmount()
})

test('registrar: o botao chama o ork ship registrar-pr da thread, e o resultado fica na pista', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on)
  mundo.respostas['ork ship registrar-pr ork-m'] = saida(0, [{ thread: 'ork-m', acao: 'registrou', mergeSha: 'b'.repeat(40), headSha: SHA_A,
    ci: null, motivo: 'ship_done pelo merge bbbbbbb do PR', docsPendentes: [] }])
  await aberta($, mundo, relogio)
  const ui = await montarPainel($, 'desktop')
  mundo.processos.length = 0
  await ui.press({ key: 'registrar:ork-m' })
  await relogio.settle()
  await esperar(() => mundo.processos.length >= 3)
  expect(mundo.processos.slice(0, 2)).toEqual([['ork', 'ship', 'pista', 'ork-m', '--json'], ['ork', 'ship', 'registrar-pr', 'ork-m', '--json']])
  await esperar(() => false, 20)
  expect(await textosDe(ui)).toContain('  registrar: ship_done registrado: ship_done pelo merge bbbbbbb do PR')
  await ui.unmount()
})

test('dois cliques seguidos na mesma pista rodam um publicar so', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on)
  // O publicar demora 5 s no nucleo: o segundo clique chega com o primeiro rodando.
  mundo.respostas['ork ship publicar ork-a'] = saida(0, PUBLICOU)
  mundo.atrasos['ork ship publicar ork-a'] = () => relogio.sleep(5000)
  await aberta($, mundo, relogio)
  const ui = await montarPainel($, 'terminal')
  await Promise.all([ui.press({ key: 'publicar:ork-a' }), ui.press({ key: 'publicar:ork-a' }).catch(() => undefined)])
  await esperar(() => mundo.processos.some(a => a[2] === 'publicar'))
  await esperar(() => false, 20)
  expect(await botoes(ui)).toEqual(['Atualizar', 'Registrar a entrega'])
  expect(await textosDe(ui)).toContain('  publicar: rodando no núcleo...')
  await relogio.advance(5000)
  await esperar(() => false, 30)
  expect(mundo.processos.filter(a => a[2] === 'publicar').length).toBe(1)
  expect(await textosDe(ui)).toContain('  publicar: publicada no HEAD aaaaaaa, push provado pelo ls-remote; PR #9 aberto agora')
  await ui.unmount()
})

test('o CLI sem o publicar e a recusa da ponte viram falha na linha, sem derrubar o painel', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const { relogio, mundo } = await preparado(on)
  await aberta($, mundo, relogio)
  const ui = await montarPainel($, 'terminal')
  await ui.press({ key: 'publicar:ork-a' })
  await relogio.settle()
  await esperar(() => mundo.processos.some(a => a[2] === 'publicar'))
  await esperar(() => false, 20)
  expect(await textosDe(ui)).toContain('  publicar: o ork deste PATH não tem ork ship publicar: atualize o CLI do Orkastery')
  mundo.respostas['ork ship registrar-pr ork-m'] = { deny: 'ork-ponte: argv recusado' }
  await ui.press({ key: 'registrar:ork-m' })
  await relogio.settle()
  await esperar(() => false, 40)
  const textos = await textosDe(ui)
  expect(textos.some(t => t.startsWith('  registrar: ') && t.includes('recusado'))).toBe(true)
  expect(textos[0]).toBe('Pista de Entrega · 3 entregas · 2 com botão · lida há 0 s')
  await ui.unmount()
})
