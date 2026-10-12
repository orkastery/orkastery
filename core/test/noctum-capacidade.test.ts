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
import { conducaoDaThread, registrarConducaoDaSessao } from '../src/conducao';
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
