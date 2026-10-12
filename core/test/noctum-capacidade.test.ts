/**
 * RM-058 (N2): a capacidade de sessões. C1 e C2 são o aprendizado 2 da madrugada de 12/10 (D8 da ork-rm058n2): a
 * sessão parada com `claude stop` antes do `phase_result` prendia a vaga do despacho até a thread fechar.
 * Todos os valores deste arquivo são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { projetoTemporario } from './apoio';
import { vagaDoDespacho } from '../src/board';
import { conducaoDaThread, registrarConducaoDaSessao, tomarConducao } from '../src/conducao';
import { admitir, escolherConta, FatosDeCapacidade, fatosDeCapacidade, LeituraDeSessoes, SessaoOcupante } from '../src/noctum-capacidade';
import { Capacidade } from '../src/noctum-envelope';
import { SessaoDaConta } from '../src/sessoes-contas';
import { registrar } from '../src/ledger';
import { dirThread, novaThread } from '../src/thread';

type Projeto = ReturnType<typeof projetoTemporario>;
interface Despachada { id: string; sessionId: string; dir: string; despachoEm: string }

/** Uma thread com a sessão do último despacho conduzindo, como o `phase run` deixa: lease de sessão e `phase_dispatch`. */
function sessaoDespachada(p: Projeto, nome: string, n: number): Despachada {
  const t = novaThread(p.carregado, { nome, modo: 'auto' }).thread;
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  assert.equal(registrarConducaoDaSessao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 3600_000 },
    { sessionId, runtime: 'claude-bg', perfil: null }), true);
  const dir = dirThread(p.dir, t.id);
  const despachoEm = new Date().toISOString();
  registrar(dir, t.id, 'phase_dispatch', { fase: 'GOAL', sessionId, runtime: 'claude-bg', pausaAoFim: false });
  return { id: t.id, sessionId, dir, despachoEm };
}

/** Um evento do hook da sessão, correlacionado ao despacho como o `ork sessions event` grava. */
function doHook(s: Despachada, tipo: string, dados: Record<string, unknown>): void {
  registrar(s.dir, s.id, tipo, { fase: 'GOAL', sessionId: s.sessionId, runtime: 'claude-bg', despachoEm: s.despachoEm,
    fonte: 'ork sessions event', ...dados });
}

/** O Stop do hook: o fim do turno da sessão. */
const stopDoTurno = (s: Despachada, k: number) =>
  doHook(s, 'runtime_stop', { sensor: 'stop', sensorEventId: createHash('sha256').update(`stop-${k}`).digest('hex') });

test('C1: a sessão com o Stop e sem resultado (parada antes do phase_result) deixa a vaga do phase run', () => {
  const p = projetoTemporario('noctum-c1');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const parada = sessaoDespachada(p, 'parada', 1);
    const quemPede = novaThread(p.carregado, { nome: 'quem pede', modo: 'auto' }).thread;
    // Antes do Stop, a sessão trabalha e ocupa a única vaga.
    assert.deepEqual(vagaDoDespacho(p.carregado, quemPede.id)?.ocupam.map(o => o.thread), [parada.id]);
    // O padrão de 12/10: runtime_stop e nada depois, nem phase_result. A vaga volta para quem pede.
    stopDoTurno(parada, 1);
    assert.equal(vagaDoDespacho(p.carregado, quemPede.id), null);
    // A condução da parada continua de pé: quem a solta é a tomada da própria thread, com a prova do runtime.
    assert.equal(conducaoDaThread(p.dir, parada.id)?.sessao, parada.sessionId);
  } finally { p.limpar(); }
});

test('C2: a sessão que volta a trabalhar depois do Stop volta a ocupar; Stop de outra sessão não solta nada', () => {
  const p = projetoTemporario('noctum-c2');
  try {
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const viva = sessaoDespachada(p, 'retomada', 2);
    const quemPede = novaThread(p.carregado, { nome: 'quem pede', modo: 'auto' }).thread;
    stopDoTurno(viva, 1);
    assert.equal(vagaDoDespacho(p.carregado, quemPede.id), null, 'turno encerrado');
    // O dono respondeu na tela e a sessão voltou a trabalhar: há atividade dela depois do Stop.
    doHook(viva, 'runtime_event', { sensor: 'pre_tool_use' });
    assert.deepEqual(vagaDoDespacho(p.carregado, quemPede.id)?.ocupam.map(o => o.thread), [viva.id], 'retomada ocupa de novo');
    // O Stop de uma sessão que não é a dona do lease não prova o fim desta.
    const outra = sessaoDespachada(p, 'outra', 3);
    p.carregado.manifesto.concurrency.max_parallel_threads = 2;
    registrar(outra.dir, outra.id, 'runtime_stop', { fase: 'GOAL', sessionId: '00000000-0000-4000-8000-000000000099', runtime: 'claude-bg',
      despachoEm: outra.despachoEm, fonte: 'ork sessions event', sensor: 'stop',
      sensorEventId: createHash('sha256').update('stop-alheio').digest('hex') });
    assert.deepEqual(vagaDoDespacho(p.carregado, quemPede.id)?.ocupam.map(o => o.thread).sort(), [viva.id, outra.id].sort());
  } finally { p.limpar(); }
});

// RM-058 (N2, D7 da ork-rm058n2): a capacidade do arco. A leitura do runtime é injetada; os leases são do disco.

const limites = (): Capacidade => ({ maquina: 3, revisao: 1,
  porConta: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }],
  porRuntime: [{ runtime: 'claude-bg', sessoes: 3 }, { runtime: 'codex', sessoes: 1 }] });

const ocupante = (x: Partial<SessaoOcupante>): SessaoOcupante =>
  ({ sessionId: `s-${Math.random()}`, thread: null, runtime: 'claude-bg', conta: 'perfil-a', revisao: false, origem: 'runtime', ...x });

const fatos = (ocupantes: SessaoOcupante[], lacunas: string[] = []): FatosDeCapacidade =>
  ({ quando: new Date().toISOString(), ocupantes, lacunas, encerradasPeloRuntime: [] });

const leitura = (sessoes: Array<Partial<SessaoDaConta> & { sessionId: string }>, opcoes: { falha?: boolean; perfis?: string[] } = {}): LeituraDeSessoes => ({
  sessoes: sessoes.map(s => ({ runtime: 'claude-bg', perfil: null, fantasma: false, viva: true, state: 'working', ...s }) as SessaoDaConta),
  fontes: [{ origem: 'claude agents --json (conta do processo)', ok: !opcoes.falha, detalhe: opcoes.falha ? 'claude agents saiu 1' : '' }],
  contas: [{ runtime: 'claude-bg', perfil: null }, ...(opcoes.perfis ?? []).map(id => ({ runtime: 'claude-bg' as const,
    perfil: { id, runtime: 'claude-bg' as const, configDir: '/nao/usado' } as never }))],
});

test('C3: cada limite do envelope recusa com o motivo dele, e o pedido que cabe é admitido', () => {
  const pedido = { runtime: 'claude-bg', conta: 'perfil-a', revisao: false };
  assert.deepEqual(admitir(pedido, limites(), fatos([]), null), { ok: true });
  const maquina = admitir({ ...pedido, revisao: true }, limites(), fatos([ocupante({ conta: 'x' }), ocupante({ conta: 'y' }), ocupante({ conta: 'z' })]), null);
  assert.equal(maquina.ok === false && maquina.motivo, 'capacidade.maquina');
  const conta = admitir(pedido, limites(), fatos([ocupante({}), ocupante({ revisao: true })]), null);
  assert.equal(conta.ok === false && conta.motivo, 'capacidade.conta');
  const runtime = admitir({ runtime: 'codex', conta: 'perfil-b', revisao: false }, limites(), fatos([ocupante({ runtime: 'codex', conta: 'perfil-a' })]), null);
  assert.equal(runtime.ok === false && runtime.motivo, 'capacidade.runtime');
  assert.match(runtime.ok === false ? runtime.detalhe : '', /1 sessão\(ões\) no codex e o limite é 1/);
});

test('C4: a margem de revisão: a execução nunca usa os slots do CHECK, e o CHECK usa', () => {
  // Máquina 3, revisão 1: a execução cabe em 2.
  const duasExecucoes = fatos([ocupante({ conta: 'x' }), ocupante({ conta: 'y' })]);
  const go = admitir({ runtime: 'claude-bg', conta: 'perfil-a', revisao: false }, limites(), duasExecucoes, null);
  assert.equal(go.ok === false && go.motivo, 'capacidade.revisao');
  assert.deepEqual(admitir({ runtime: 'claude-bg', conta: 'perfil-a', revisao: true }, limites(), duasExecucoes, null), { ok: true });
  // Um CHECK rodando não come a vaga da execução.
  const umDeCada = fatos([ocupante({ conta: 'x' }), ocupante({ conta: 'y', revisao: true })]);
  assert.deepEqual(admitir({ runtime: 'claude-bg', conta: 'perfil-a', revisao: false }, limites(), umDeCada, null), { ok: true });
});

test('C5: fonte sem leitura, conta ou runtime fora do envelope e o portão do projeto não admitem', () => {
  const pedido = { runtime: 'claude-bg', conta: 'perfil-a', revisao: false };
  const lacuna = admitir(pedido, limites(), fatos([], ['claude agents (perfil a): saiu 1']), null);
  assert.equal(lacuna.ok === false && lacuna.motivo, 'capacidade.fonte-indisponivel', 'consumo desconhecido nunca é zero');
  const semRuntime = admitir({ ...pedido, runtime: 'outro' }, limites(), fatos([]), null);
  assert.equal(semRuntime.ok === false && semRuntime.motivo, 'capacidade.runtime-nao-autorizado');
  const semConta = admitir({ ...pedido, conta: 'perfil-z' }, limites(), fatos([]), null);
  assert.equal(semConta.ok === false && semConta.motivo, 'capacidade.conta-nao-autorizada');
  const projeto = admitir(pedido, limites(), fatos([]), { limite: 1, ocupam: [], detalhe: 'concurrency.limite: SIMULADO', correcao: '' });
  assert.equal(projeto.ok === false && projeto.motivo, 'capacidade.projeto');
});

test('C6: a ocupação une leases e runtime sem repetir, conta outro projeto e tira quem o runtime prova encerrado', () => {
  const p = projetoTemporario('noctum-c6');
  try {
    const viva = sessaoDespachada(p, 'viva', 11);
    const parada = sessaoDespachada(p, 'parada no runtime', 12);
    const sumida = sessaoDespachada(p, 'sumida do claude', 13);
    const codex = novaThread(p.carregado, { nome: 'codex sem lista', modo: 'auto' }).thread;
    const sessaoCodex = '00000000-0000-4000-8000-000000000014';
    assert.equal(registrarConducaoDaSessao(p.dir, codex.id, { canal: 'cli', operacao: 'phase.run', fase: 'CHECK', prazoMs: 3600_000 },
      { sessionId: sessaoCodex, runtime: 'codex', perfil: null }), true);
    const r = fatosDeCapacidade(p.carregado, { consultar: () => leitura([
      { sessionId: viva.sessionId },
      { sessionId: parada.sessionId, state: 'stopped', viva: false },
      { sessionId: '00000000-0000-4000-8000-0000000000aa', perfil: 'perfil-a' },
    ]) });
    const porSessao = new Map(r.ocupantes.map(o => [o.sessionId, o]));
    assert.equal(porSessao.get(viva.sessionId)?.origem, 'conducao', 'a viva conta uma vez, pelo lease');
    assert.equal(porSessao.has(parada.sessionId), false, 'stopped no runtime não conta, mesmo com o lease de pé');
    assert.equal(porSessao.has(sumida.sessionId), false, 'ausente do claude agents com a conta lida não conta');
    assert.equal(porSessao.get(sessaoCodex)?.revisao, true, 'o codex ausente conta (a lista dele não é completa), e o CHECK é revisão');
    assert.equal(porSessao.get('00000000-0000-4000-8000-0000000000aa')?.origem, 'runtime', 'sessão de outro projeto conta na máquina');
    assert.equal(porSessao.get('00000000-0000-4000-8000-0000000000aa')?.conta, 'perfil-a', 'e na conta dela');
    assert.deepEqual(r.encerradasPeloRuntime.sort(), [parada.sessionId, sumida.sessionId].sort());
    assert.equal(r.ocupantes.length, 3);
    // Com uma fonte sem leitura, a ausência não prova nada e a lacuna fica dita.
    const comFalha = fatosDeCapacidade(p.carregado, { consultar: () => leitura([{ sessionId: viva.sessionId }], { falha: true }) });
    assert.deepEqual(comFalha.lacunas, ['claude agents --json (conta do processo): claude agents saiu 1']);
    assert.ok(comFalha.ocupantes.some(o => o.sessionId === sumida.sessionId));
  } finally { p.limpar(); }
});

test('C7: a sessão com o turno encerrado e o despacho em curso seguem a regra da vaga do phase run', () => {
  const p = projetoTemporario('noctum-c7');
  try {
    const encerrada = sessaoDespachada(p, 'turno encerrado', 21);
    stopDoTurno(encerrada, 7);
    const t = novaThread(p.carregado, { nome: 'despacho em curso', modo: 'auto' }).thread;
    const tomada = tomarConducao(p.dir, t.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 60_000 });
    assert.equal(tomada.ok, true);
    try {
      const r = fatosDeCapacidade(p.carregado, { consultar: () => leitura([{ sessionId: encerrada.sessionId, state: 'idle' }]) });
      assert.equal(r.ocupantes.some(o => o.sessionId === encerrada.sessionId), false, 'turno encerrado no ledger não ocupa');
      assert.deepEqual(r.ocupantes.filter(o => o.origem === 'despacho').map(o => o.thread), [t.id], 'o despacho em curso ocupa a máquina');
    } finally { if (tomada.ok) tomada.liberar(); }
  } finally { p.limpar(); }
});

test('C8: a conta do despacho é a do runtime com mais folga, empate pela ordem do envelope, e nenhuma sem vaga', () => {
  const l = limites();
  assert.equal(escolherConta(l, fatos([]), ['perfil-a', 'perfil-b']), 'perfil-a', 'empate: a primeira do envelope');
  assert.equal(escolherConta(l, fatos([ocupante({ conta: 'perfil-a' })]), ['perfil-a', 'perfil-b']), 'perfil-b', 'mais folga');
  assert.equal(escolherConta(l, fatos([]), ['perfil-b']), 'perfil-b', 'só as contas do runtime');
  assert.equal(escolherConta(l, fatos([ocupante({ conta: 'perfil-b' }), ocupante({ conta: 'perfil-b' })]), ['perfil-b']), null);
  assert.equal(escolherConta(l, fatos([]), ['perfil-fora']), null, 'conta fora do envelope nunca é escolhida');
});

test('C9: a ocupação é relida a cada chamada: a sessão que dá o resultado sai da conta na leitura seguinte', () => {
  const p = projetoTemporario('noctum-c9');
  try {
    const s = sessaoDespachada(p, 'termina', 31);
    const ler = () => fatosDeCapacidade(p.carregado, { consultar: () => leitura([{ sessionId: s.sessionId }]) });
    assert.deepEqual(ler().ocupantes.map(o => o.sessionId), [s.sessionId]);
    registrar(s.dir, s.id, 'phase_result', { fase: 'GOAL', sessionId: s.sessionId, classificacao: 'fase_concluida', ok: true });
    // O lease acabou pelo ledger; a sessão ainda aparece viva no runtime, e conta como sessão da máquina, não da thread.
    const depois = ler();
    assert.equal(depois.ocupantes.find(o => o.sessionId === s.sessionId)?.origem, 'runtime');
    const semRuntime = fatosDeCapacidade(p.carregado, { consultar: () => leitura([{ sessionId: s.sessionId, state: 'done', viva: false }]) });
    assert.deepEqual(semRuntime.ocupantes, [], 'concluída no ledger e done no runtime: nada ocupa');
  } finally { p.limpar(); }
});
