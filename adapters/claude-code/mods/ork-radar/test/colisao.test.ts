import { test, expect, mock } from 'claude-code/testing'
import { argvs, BASE, chave, conflito, EPOCA, iniciar, lease, montar, montarPainel, PONTE_FALSA, radar, sha, TEMPORARIO, textosDe } from './apoio'

// O cálculo do Radar na sessão do dono (T3.1): as threads e os leases pela ponte falsa, os SHAs e os merges pelo
// fundo `process.run`, com saída fixa de `merge-tree` com conflito num arquivo, como a ficha M10 pede. O kit não
// tem disco nem git; o comportamento real do git está no teste hermético do núcleo (core/test/ork-radar.test.ts).
const A = sha('a')
const B = sha('b')
const C = sha('c')
const M = sha('0')
const ABERTAS = [
  { id: 'ork-c', slug: 'ork-c-full', fase: 'GOAL', status: 'aberta' },
  { id: 'ork-a', slug: 'ork-a-full', fase: 'SHIP', status: 'aberta' },
  { id: 'ork-b', slug: 'ork-b-full', fase: 'GO', status: 'aberta' },
]
const REFS = {
  [BASE]: M,
  'refs/heads/ork/ork-a-full': A,
  'refs/heads/ork/ork-b-full': B,
  'refs/heads/ork/ork-c-full': C,
}
const MERGES = { [chave(A, M)]: conflito('CHANGELOG.md'), [chave(A, B)]: conflito('core/src/x.ts') }
const LEASES = [lease('path:CHANGELOG.md', 'ork-c'), lease('path:docs/**', 'ork-b', 'expired'), lease('exec:ork-a', 'ork-a')]
const AMBIENTE_DO_MERGE = {
  GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OBJECT_DIRECTORY: TEMPORARIO, GIT_ALTERNATE_OBJECT_DIRECTORIES: '/p/.git/objects',
}
const mergeTree = (a: string, b: string) => `git merge-tree --write-tree --name-only -z --no-messages ${a} ${b}`
const merges = mundo => argvs(mundo).filter(l => l.startsWith('git merge-tree'))

function opcoes(extra = {}) {
  return { papel: 'dono', abertas: ABERTAS, refs: REFS, merges: MERGES, leases: LEASES, ...extra }
}

test('na sessao do dono, o /radar calcula cada thread contra a origin/main e cada par, com objetos temporarios', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  expect(mundo.comandos).toEqual(['radar'])
  const r = await radar($)
  expect(mundo.ler[0]).toEqual({ consulta: 'thread.list' })
  expect(mundo.ler.slice(1).map(l => `${l.consulta} ${l.thread}`).sort()).toEqual(['thread.status ork-a', 'thread.status ork-b', 'thread.status ork-c'])
  expect(mundo.maestro).toEqual([{ section: 'leases', offset: 0 }])
  expect(argvs(mundo)).toEqual([
    `git ls-remote . ${BASE} refs/heads/ork/ork-a-full refs/heads/ork/ork-b-full refs/heads/ork/ork-c-full`,
    'git ls-remote origin refs/heads/main',
    'mktemp -d /tmp/ork-radar.XXXXXXXX',
    mergeTree(A, M), mergeTree(B, M), mergeTree(C, M), mergeTree(A, B), mergeTree(A, C), mergeTree(B, C),
    `rm -rf -- ${TEMPORARIO}`,
  ])
  expect(mundo.processos[0].init).toEqual({ cwd: '/p', env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 5000 })
  expect(mundo.processos[1].init).toEqual({ cwd: '/p', env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 15000 })
  expect(mundo.processos[2].init).toEqual({ timeoutMs: 5000 })
  for (const p of mundo.processos.slice(3, 9)) expect(p.init).toEqual({ cwd: '/p', env: AMBIENTE_DO_MERGE, timeoutMs: 20000 })
  expect(mundo.processos[9].init).toEqual({ timeoutMs: 5000 })
  expect(r.text.split('\n')).toEqual([
    'Radar de Colisão: 3 threads abertas; base origin/main 0000000, igual ao remoto.',
    '- ork-a × origin/main: CHANGELOG.md (lease path:CHANGELOG.md de ork-c); resolve: ork worktree sync ork-a --dry-run',
    '- ork-a × ork-b: core/src/x.ts; resolve: a que entregar depois roda: ork worktree sync <ork-a ou ork-b> --dry-run',
    '2 pares em conflito e 4 limpos.',
  ])
})

test('o relogio, sem o /radar, roda a primeira rodada 1 s depois da ativacao e as seguintes a cada 10 min, sem recalcular par parado', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await relogio.advance(999)
  expect(mundo.processos).toEqual([])
  await relogio.advance(1)
  expect(merges(mundo).length).toBe(6)
  mundo.processos.length = 0
  await relogio.advance(599000 - 1)
  expect(mundo.processos).toEqual([])
  await relogio.advance(1)
  // Nenhum SHA andou: a rodada do relógio só lê os SHAs e o remoto, sem temporário nem merge.
  expect(argvs(mundo)).toEqual([
    `git ls-remote . ${BASE} refs/heads/ork/ork-a-full refs/heads/ork/ork-b-full refs/heads/ork/ork-c-full`,
    'git ls-remote origin refs/heads/main',
  ])
})

test('so o par em que um lado andou roda merge-tree de novo; o resto sai do cache', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await radar($)
  const B2 = sha('d')
  mundo.refs['refs/heads/ork/ork-b-full'] = B2
  mundo.merges[chave(B2, M)] = conflito('README.md', 'CHANGELOG.md')
  mundo.processos.length = 0
  const r = await radar($)
  expect(merges(mundo)).toEqual([mergeTree(B2, M), mergeTree(A, B2), mergeTree(B2, C)])
  expect(r.text).toContain('- ork-b × origin/main: CHANGELOG.md (lease path:CHANGELOG.md de ork-c), README.md; resolve: ork worktree sync ork-b --dry-run')
  expect(r.text).not.toContain('ork-a × ork-b')
})

test('a branch e a do base.branch do status quando comeca com ork/, como no nucleo, mesmo com a ork/<slug> existindo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const D = sha('f')
  const VELHA = sha('9')
  const abertas = [...ABERTAS, { id: 'ork-d', slug: 'ork-d-full', fase: 'GO', status: 'aberta' }, { id: 'ork-e', slug: 'ork-e-full', fase: 'PLAN', status: 'aberta' }]
  const mundo = montar(on, opcoes({
    abertas, refs: { ...REFS, 'refs/heads/ork/ork-d-outra': D, 'refs/heads/ork/ork-d-full': VELHA },
    status: { 'ork-d': { id: 'ork-d', base: { branch: 'ork/ork-d-outra', commit: D } }, 'ork-e': { id: 'ork-e', base: { branch: 'main', commit: M } } },
  }))
  await iniciar($)
  const r = await radar($)
  expect(argvs(mundo)[0]).toBe(`git ls-remote . ${BASE} refs/heads/ork/ork-a-full refs/heads/ork/ork-b-full refs/heads/ork/ork-d-outra refs/heads/ork/ork-e-full refs/heads/ork/ork-c-full`)
  expect(merges(mundo)).toContain(mergeTree(D, M))
  expect(merges(mundo).some(l => l.includes(VELHA))).toBe(false)
  expect(merges(mundo).length).toBe(4 + 6)
  expect(r.text).toContain('Sem branch local: ork-e.')
  // O status de cada thread é lido uma vez por carga.
  await radar($)
  expect(mundo.ler.filter(l => l.consulta === 'thread.status').length).toBe(5)
})

test('o status que falha usa a ork/<slug> nesta rodada, vira lacuna e e lido de novo na seguinte', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ statusFalha: ['ork-a'] }))
  await iniciar($)
  const r = await radar($)
  expect(merges(mundo)).toContain(mergeTree(A, M))
  expect(r.text).toContain('Lacuna: status de ork-a não lido; vale a ork/ork-a-full nesta rodada (ork-ponte: ler recusado).')
  mundo.statusFalha.clear()
  const r2 = await radar($)
  expect(mundo.ler.filter(l => l.consulta === 'thread.status' && l.thread === 'ork-a').length).toBe(2)
  expect(r2.text).not.toContain('Lacuna: status')
})

test('os leases saem de todas as paginas da secao, e a secao indisponivel vira lacuna', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const leases = [lease('exec:ork-a', 'ork-a'), lease('main-tree', 'ork-b'), lease('path:CHANGELOG.md', 'ork-c')]
  const mundo = montar(on, opcoes({ leases, tamanhoDaPagina: 1 }))
  await iniciar($)
  const r = await radar($)
  expect(mundo.maestro.map(m => m.offset)).toEqual([0, 1, 2])
  expect(r.text).toContain('- ork-a × origin/main: CHANGELOG.md (lease path:CHANGELOG.md de ork-c); resolve: ork worktree sync ork-a --dry-run')
  mundo.leasesIndisponiveis = true
  const r2 = await radar($)
  expect(r2.text).toContain('- ork-a × origin/main: CHANGELOG.md; resolve: ork worktree sync ork-a --dry-run')
  expect(r2.text).toContain('Lacuna: a seção leases veio indisponível (leases.unavailable).')
})

test('saida 1 do merge-tree sem a arvore e erro do git, nao conflito, e volta a ser calculada na rodada seguinte', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ merges: { [chave(A, M)]: { exitCode: 1, stdout: '', stderr: 'merge-tree: aaaaaaa - not something we can merge\n' } } }))
  await iniciar($)
  const r = await radar($)
  expect(r.text).toContain('Erro em ork-a × origin/main: merge-tree: aaaaaaa - not something we can merge')
  expect(r.text).toContain('Nenhuma colisão entre os pares calculados (5 de 6).')
  mundo.processos.length = 0
  await radar($)
  expect(merges(mundo)).toEqual([mergeTree(A, M)])
})

test('temporario fora da forma do Radar: nenhum merge-tree roda, nada e apagado e nao diz que nao ha colisao', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ temporario: '/srv/projeto' }))
  await iniciar($)
  const r = await radar($)
  expect(argvs(mundo).some(l => l.startsWith('git merge-tree'))).toBe(false)
  expect(argvs(mundo).some(l => l.startsWith('rm'))).toBe(false)
  expect(r.text).toContain('Nenhum par calculado nesta rodada.')
  expect(r.text).toContain('6 pares ficaram para a próxima rodada.')
  expect(r.text).toContain('Lacuna: temporário recusado (o mktemp devolveu "/srv/projeto").')
})

test('D12: o orcamento de 60 s de merge-tree por rodada deixa o resto para a proxima', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ relogio, atrasoDoMerge: 25000 }))
  await iniciar($)
  await relogio.advance(1000)
  await relogio.advance(25000)
  await relogio.advance(25000)
  await relogio.advance(25000)
  // Cada merge-tree leva 25 s: o 3º começa aos 50 s e volta aos 75 s; os outros 3 ficam para a próxima rodada.
  expect(merges(mundo).length).toBe(3)
  const ui = await montarPainel($, 'desktop')
  expect(await textosDe(ui)).toContain('3 pares ficaram para a próxima rodada')
  await ui.unmount()
})

test('o /radar nao espera a rodada de outro despacho em andamento: responde o mapa que ha e pede outra', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ relogio, atrasoDoMerge: 25000 }))
  await iniciar($)
  await relogio.advance(1000)
  expect(merges(mundo).length).toBe(1)
  let pronto = false
  const p = radar($).then(r => { pronto = true; return r })
  await relogio.settle()
  expect(pronto).toBe(true)
  const r = await p
  expect(r.text).toContain('Uma rodada já estava em andamento: o painel mostra a conta nova quando ela terminar.')
  expect(mundo.abertos).toEqual(['radar'])
})

test('a primeira rodada da carga sempre concilia a faixa: sem colisao nova, tira a linha que uma carga anterior deixou', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ merges: {} }))
  await iniciar($)
  await relogio.advance(1000)
  expect(mundo.faixas).toEqual([{ mod: 'ork-radar' }])
  await relogio.advance(600000)
  expect(mundo.faixas.length).toBe(1)
})

test('a base diferente do remoto aparece com os dois SHAs, e o remoto que falha fica nao conferido', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ remoto: sha('1') }))
  await iniciar($)
  expect((await radar($)).text.split('\n')[0]).toBe(
    'Radar de Colisão: 3 threads abertas; base origin/main 0000000, diferente do remoto (1111111): a conta vale até o fetch do núcleo.')
  mundo.remoto = null
  expect((await radar($)).text.split('\n')[0]).toBe(
    'Radar de Colisão: 3 threads abertas; base origin/main 0000000, remoto não conferido (fatal: unable to access the remote).')
})

test('na worktree vinculada, os objetos saem do commondir do gitdir', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ gitArquivo: 'gitdir: /repo/.git/worktrees/w\n', commondir: '../..\n' }))
  await iniciar($)
  await radar($)
  expect(mundo.lidos).toEqual(['/p/.git', '/repo/.git/worktrees/w/commondir'])
  const merge = mundo.processos.find(p => p.argv[1] === 'merge-tree')
  expect(merge.init.env.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBe('/repo/.git/objects')
})

test('teto de 12 threads por rodada, na ordem das fases, com a fase MASTER fora', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const abertas = Array.from({ length: 14 }, (_, i) => ({ id: `ork-t${String(i).padStart(2, '0')}`, slug: `ork-t${i}-full`, fase: i === 0 ? 'MASTER' : i < 4 ? 'GOAL' : 'GO', status: 'aberta' }))
  const mundo = montar(on, opcoes({ abertas, refs: { [BASE]: M } }))
  await iniciar($)
  const r = await radar($)
  expect(r.text.split('\n')[0]).toBe('Radar de Colisão: 12 threads abertas (mais 1 fora do teto); base origin/main 0000000, igual ao remoto.')
  expect(argvs(mundo)[0]).toBe(`git ls-remote . ${BASE} ${['04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '01', '02'].map(n => `refs/heads/ork/ork-t${Number(n)}-full`).join(' ')}`)
  expect(r.text).toContain('Nenhum par para calcular.')
})

test('na sessao de fase o Radar nao registra comando, nao roda processo e o /radar so explica', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes({ papel: 'fase' }))
  await iniciar($)
  await relogio.advance(20 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.processos).toEqual([])
  expect(mundo.ler).toEqual([])
  expect((await radar($)).text).toBe('O Radar de Colisão só roda na sessão do dono de um projeto do Orkastery.')
  expect(mundo.processos).toEqual([])
})

test('dormente no inicio, o Radar confere o papel de novo e liga quando o servidor do nucleo conecta', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const o = opcoes({ papel: 'dormente' })
  const mundo = montar(on, o)
  await iniciar($)
  await relogio.advance(3000 + 10000 + 30000)
  expect(mundo.comandos).toEqual([])
  o.papel = 'dono'
  await relogio.advance(299000)
  expect(mundo.comandos).toEqual([])
  await relogio.advance(1000)
  expect(mundo.comandos).toEqual(['radar'])
})

test('sem a ponte, o Radar avisa uma vez e fica desligado', async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await relogio.advance(60000)
  expect(mundo.toasts).toEqual(['radar: a ponte ork-ponte não carregou; o Radar de Colisão fica desligado nesta sessão'])
  expect(mundo.comandos).toEqual([])
  expect(mundo.processos).toEqual([])
})

test('fora de sessao interativa o Radar nao confere o papel nem liga', { plugins: [PONTE_FALSA] }, async ($, on) => {
  const relogio = mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($, false)
  await relogio.advance(20 * 60000)
  expect(mundo.comandos).toEqual([])
  expect(mundo.processos).toEqual([])
})

test('a lista das threads que falha deixa o mapa anterior e diz o motivo', { plugins: [PONTE_FALSA] }, async ($, on) => {
  mock.clock(on, { now: EPOCA })
  const mundo = montar(on, opcoes())
  await iniciar($)
  await radar($)
  mundo.listaFalha = true
  mundo.processos.length = 0
  const r = await radar($)
  expect(mundo.processos).toEqual([])
  expect(r.text).toContain('A rodada parou: a lista das threads abertas falhou (ork-ponte: ler recusado).')
})
