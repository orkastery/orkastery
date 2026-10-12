import { test, expect } from 'claude-code/testing'
import { concluir, conferencia, criar, nucleoDeConferencia, PLUGINS, preparar, quadro, RAIZ, recusa, THREAD } from './apoio'

// O portão da conclusão (T10.2): a tarefa do plano só fecha com a conferência do verify dela aprovada pelo núcleo
// (`ork claims conferir --tarefa`, no sandbox do verify). O Portão nunca roda o verify: o único processo é o do núcleo.

test('conclusao com a conferencia aprovada passa e a tarefa fica concluida no quadro', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status } = preparar(on)
  const pedidos = nucleoDeConferencia(on, relogio, [conferencia('T1', 'aprovada')])
  expect(await concluir($, '1', 'T1 Tarefa completa')).toEqual({})
  expect(pedidos).toEqual([{ argv: ['ork', 'claims', 'conferir', THREAD, '--tarefa', 'T1', '--prazo', '540', '--json'], cwd: RAIZ, timeoutMs: 600000 }])
  expect((await quadro($)).concluidas).toEqual(['T1'])
  expect(status).toContain('portão: conferindo T1 no núcleo')
  expect(status[status.length - 1]).toBeUndefined()
})

test('conclusao com a conferencia reprovada devolve block com o comando e o fim da saida', { plugins: PLUGINS }, async ($, on) => {
  const { relogio, status } = preparar(on)
  nucleoDeConferencia(on, relogio, [conferencia('T5', 'reprovada', { comando: 'node --test dist/e.test.js' })])
  const r = await concluir($, '9', 'T5 Outra completa')
  expect(r.block).toMatch(/^Portão de Tarefas: a tarefa T5 não fecha: o verify do plano reprovou na conferência do núcleo/)
  expect(r.block).toContain('  comando: node --test dist/e.test.js')
  expect(r.block).toContain('  saiu com código 1; fim da saída:')
  expect(r.block).toContain('  | not ok 2 - soma')
  expect(r.block).toContain('devolva a tarefa para pending (TaskUpdate) e siga')
  expect(status[status.length - 1]).toBe('portão: T5 não fechou (reprovou)')
  const q = await quadro($)
  expect(q.concluidas).toEqual([])
  expect(q.repeticoes.T5.vezes).toBe(1)
})

test('sem veredito, recusa tipada, conducao alheia, ork antigo e processo que nao abre bloqueiam com o motivo', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  nucleoDeConferencia(on, relogio, [
    conferencia('T1', 'sem-veredito'),
    recusa('claims.conferir.sandbox-indisponivel: codex ausente; a conferencia so roda confinada, sem fallback'),
    { stdout: '', stderr: 'erro: conducao em andamento por outra sessao\n', code: 3 },
    { stdout: '', stderr: 'uso: ork <comando>\ncomando desconhecido: claims conferir\n', code: 2 },
    { naoAbre: 'spawn ork ENOENT' },
  ])
  expect((await concluir($, '1', 'T1 a')).block).toContain('a conferência do núcleo terminou sem veredito (verify.timeout: estourou o prazo de 540 s)')
  expect((await concluir($, '1', 'T1 a')).block).toContain('o núcleo recusou a conferência (claims.conferir.sandbox-indisponivel: codex ausente')
  expect((await concluir($, '1', 'T1 a')).block).toContain('não fecha agora: outra condução segura a thread (erro: conducao em andamento por outra sessao)')
  expect((await concluir($, '1', 'T1 a')).block).toContain('a conferência do núcleo não deu resultado (ork claims conferir sem resultado: comando desconhecido: claims conferir)')
  const ultima = (await concluir($, '1', 'T1 a')).block
  expect(ultima).toContain('a conferência do núcleo não deu resultado (ork claims conferir não rodou: ')
  expect(ultima).toContain('devolva a tarefa para pending')
  expect((await quadro($)).concluidas).toEqual([])
})

test('tarefa que nao e do plano (sem id do plano e sem registro) conclui sem conferencia', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  const pedidos = nucleoDeConferencia(on, relogio, [])
  expect(await concluir($, '1', 'Anotar o progresso')).toEqual({})
  expect(await concluir($, '2', 'T9 fora do plano')).toEqual({})
  expect(pedidos).toEqual([])
})

test('a tarefa registrada na criacao e conferida mesmo depois de renomeada', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  const pedidos = nucleoDeConferencia(on, relogio, [conferencia('T1', 'reprovada')])
  expect(await criar($, '42', 'T1 Tarefa completa')).toEqual({})
  expect((await concluir($, '42', 'agora sem o id')).block).toContain('a tarefa T1 não fecha')
  expect(pedidos.map(p => p.argv[5])).toEqual(['T1'])
})

test('conclusao que chega no meio de outra conferencia e recusada na hora, sem segundo processo', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  const pedidos = nucleoDeConferencia(on, relogio, [{ ...conferencia('T1', 'aprovada'), espera: 5000 }])
  const primeira = concluir($, '1', 'T1 a')
  await relogio.settle()
  const segunda = await concluir($, '2', 'T5 b')
  expect(segunda.block).toContain('a tarefa T5 não fecha agora: o Portão está conferindo a tarefa T1 no núcleo, uma conferência por vez')
  expect(pedidos.length).toBe(1)
  await relogio.advance(5000)
  expect(await primeira).toEqual({})
  expect((await quadro($)).concluidas).toEqual(['T1'])
})

test('da terceira reprovacao igual em diante o texto manda deixar a tarefa aberta; resultado novo recomeca a conta', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  nucleoDeConferencia(on, relogio, [
    conferencia('T1', 'reprovada'), conferencia('T1', 'reprovada'), conferencia('T1', 'reprovada'),
    conferencia('T1', 'reprovada', { fim: 'outro erro' }),
  ])
  expect((await concluir($, '1', 'T1 a')).block).not.toContain('vez seguida')
  expect((await concluir($, '1', 'T1 a')).block).not.toContain('vez seguida')
  expect((await concluir($, '1', 'T1 a')).block).toContain('É a 3ª vez seguida com o mesmo resultado: deixe a tarefa aberta (pending) e siga para a próxima')
  expect((await concluir($, '1', 'T1 a')).block).not.toContain('vez seguida')
  expect((await quadro($)).repeticoes.T1.vezes).toBe(1)
})

test('o teammate que fecha o turno com a tarefa em andamento passa pelo mesmo portao', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on)
  nucleoDeConferencia(on, relogio, [conferencia('T5', 'reprovada')])
  expect((await concluir($, '3', 'T5 b', 'ana')).block).toContain('a tarefa T5 não fecha')
})

for (const papel of ['dono', 'dormente'] as const) {
  test(`na sessao de papel ${papel} a conclusao passa sem conferencia`, { plugins: PLUGINS }, async ($, on) => {
    const { relogio } = preparar(on, { papel })
    const pedidos = nucleoDeConferencia(on, relogio, [])
    expect(await concluir($, '1', 'T1 a')).toEqual({})
    expect(pedidos).toEqual([])
  })
}

test('no bloco sem GO a conclusao passa sem conferencia', { plugins: PLUGINS }, async ($, on) => {
  const { relogio } = preparar(on, { bloco: 'f456' })
  const pedidos = nucleoDeConferencia(on, relogio, [])
  expect(await concluir($, '1', 'T1 a')).toEqual({})
  expect(pedidos).toEqual([])
})
