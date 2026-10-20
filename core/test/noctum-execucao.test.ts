/**
 * RM-058 (N2, D11 da ork-rm058n2): o passo do arco despacha só pelo núcleo, com o envelope conferido imediatamente antes.
 * O X1 vai de ponta a ponta pelo `rodarFase` real e o runtime simulado; o X4 é a disputa entre dois processos de verdade.
 * Todos os itens, pedidos, contas, sessões e provas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirTemporario, projetoTemporario, runtimePorConta } from './apoio';
import { abrirArco, abrirComBaseline, baselineSimulada, concluirFase, despachar as despacharNaThread, entregar, gravarArtefato,
  prepararIngressoSimulado, revogarArco, stopSemResultado, TrabalhoSimulado } from './noctum-apoio';
import { passoDoArco, OpcoesDoPasso, ResultadoDoPasso } from '../src/noctum-execucao';
import { lerArco, reservarDespacho } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import { registrarConducaoDaSessao } from '../src/conducao';
import { ErroDaFilaPesada, kernelDisponivel, tentarTravaExclusiva } from '../src/fila-pesada';
import { lerLedger, registrar } from '../src/ledger';
import { OpcoesRun, ResultadoRun } from '../src/phase';
import { caminhoThread, dirThread, lerThread, listarIds, novaThread } from '../src/thread';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

type Projeto = ReturnType<typeof projetoTemporario>;
const MAQUINA = 'maquina-simulada';
const PEDIDO = { a: 'Fatia A SIMULADA do arco.', b: 'Fatia B SIMULADA do arco, depois da A.', c: 'Fatia C SIMULADA, independente.' };
const AB: TrabalhoSimulado[] = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: PEDIDO.b },
];
const AC: TrabalhoSimulado[] = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: PEDIDO.a },
  { id: 'c', item: 'RM-903', prioridade: 2, dependeDe: [], pedido: PEDIDO.c },
];

const reservadas = (itens: string[]) => () => ({ leitura: 'copia-local' as const, reservas: itens.map(item => ({ item, maquina: MAQUINA, thread: null })) });
const semSessoes = () => ({ sessoes: [], fontes: [{ origem: 'claude agents --json (conta do processo)', ok: true, detalhe: '' }],
  contas: [{ runtime: 'claude-bg' as const, perfil: null }] });

let sessoes = 0;
/** O despacho simulado: o que o `phase run` deixa no disco quando abre a sessão (a condução de sessão e o phase_dispatch). */
function despachoSimulado(registro: string[] = []): NonNullable<OpcoesDoPasso['despachar']> {
  return (carregado, threadId, o) => {
    sessoes += 1;
    const sessionId = `00000000-0000-4000-8000-${String(sessoes).padStart(12, '0')}`;
    registrarConducaoDaSessao(carregado.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: o.perfil ?? null });
    registrar(dirThread(carregado.raiz, threadId), threadId, 'phase_dispatch', { fase: o.fase, sessionId, runtime: 'claude-bg', pausaAoFim: false });
    registro.push(`${threadId}:${o.fase}:${o.perfil}`);
    return { sessionId, verificada: true, bloqueado: false, motivo: null } as unknown as ResultadoRun;
  };
}

// RM-058, integração (D6): a thread que o arco abre aqui já tem a baseline SIMULADA do condutor; o X1 e a BL provam o caminho dela.
const semWorktree: NonNullable<OpcoesDoPasso['abrirThread']> = abrirComBaseline;

function passo(p: Projeto, arco: string, x: OpcoesDoPasso & { itens?: string[] } = {}): ResultadoDoPasso {
  return passoDoArco(p.carregado, arco, { maquina: MAQUINA, lerReservas: reservadas(x.itens ?? ['RM-901', 'RM-902', 'RM-903']),
    consultarSessoes: semSessoes, perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }], despachar: despachoSimulado(),
    abrirThread: semWorktree, ...x });
}

const threadsDoItem = (p: Projeto, item: string) => listarIds(p.dir).map(id => lerThread(p.dir, id)).filter(t => t.roadmap === item);

test('X1: de ponta a ponta pelo phase run real: abre e despacha na ordem, espera a dependência e encerra com a fila vazia', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x1');
  const claude = runtimePorConta('noctum-x1');
  const codex = dirTemporario('noctum-x1-codex');
  const codexAntes = process.env.CODEX_HOME;
  try {
    fs.mkdirSync(path.join(codex, 'sessions'));
    process.env.CODEX_HOME = codex;
    claude.conta(p.dir, 'perfil-a');
    abrirArco(p.dir, 'arco-x1', { trabalhos: AB, maquina: 2, contas: [{ conta: 'perfil-a', sessoes: 2 }] });
    // Sem despachante injetado: rodarFase, novaThread com worktree e a leitura real das sessões e do store de perfis.
    const real = (x: OpcoesDoPasso = {}) => passoDoArco(p.carregado, 'arco-x1', { maquina: MAQUINA, lerReservas: reservadas(['RM-901', 'RM-902']), ...x });
    // RM-058, integração (D6): o bloco com GO pede a baseline também no claude-bg; o núcleo a grava fora da trava, e o passo
    // seguinte confere o envelope de novo e despacha.
    const r0 = real();
    assert.ok(r0.acao === 'aguardar' && r0.motivo === 'baseline-gravada', JSON.stringify(r0));
    const r1 = real();
    assert.equal(r1.acao, 'despachou', JSON.stringify(r1.acao === 'aguardar' || r1.acao === 'recusado' ? r1 : r1.acao));
    assert.ok(r1.acao === 'despachou');
    assert.equal(r1.trabalho, 'a');
    assert.equal(r1.conta, 'perfil-a');
    assert.match(String(r1.sessionId), /^99999999-0000-4000-8000-/, 'a sessão veio do runtime pelo phase run');
    const ta = lerThread(p.dir, r1.thread);
    assert.equal(ta.roadmap, 'RM-901');
    assert.ok(ta.worktree, 'a thread aberta pelo arco tem worktree');
    assert.equal(lerLedger(dirThread(p.dir, ta.id)).filter(e => e.tipo === 'baseline_recorded').length, 1, 'a baseline real, uma vez');
    const estado = lerArco(p.dir, 'arco-x1')!;
    assert.deepEqual(estado.despachos.map(d => `${d.desfecho}:${d.motivo ?? ''}`), ['recusado:baseline.pendente', 'concluido:']);
    assert.equal(estado.consumo.arco, 1);
    // A segue em curso e B depende dela: nada a despachar, o passo espera a cadência.
    const r2 = real();
    assert.equal(r2.acao, 'aguardar');
    assert.ok(r2.acao === 'aguardar' && r2.motivo === 'em-curso');
    // A sessão de A faz o bloco e A é entregue: B entra.
    gravarArtefato(p.dir, ta.id, 'check.md');
    concluirFase(p.dir, ta.id, 'GOAL', String(r1.sessionId));
    entregar(p.dir, ta.id);
    const r3b = real();
    assert.ok(r3b.acao === 'aguardar' && r3b.motivo === 'baseline-gravada', JSON.stringify(r3b));
    const r3 = real();
    assert.ok(r3.acao === 'despachou' && r3.trabalho === 'b', JSON.stringify(r3.acao));
    entregar(p.dir, r3.acao === 'despachou' ? r3.thread : '');
    const r4 = real();
    assert.deepEqual([r4.acao, r4.acao === 'encerrar' ? r4.motivo : ''], ['encerrar', 'fila-vazia']);
    assert.equal(lerArco(p.dir, 'arco-x1')!.consumo.arco, 2, 'duas sessões, duas reservas');
  } finally {
    if (codexAntes === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexAntes;
    p.limpar(); claude.restaurar(); fs.rmSync(codex, { recursive: true, force: true });
  }
});

test('X2: arco revogado, expirado ou ainda agendado não despacha, e nada se reserva', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x2');
  try {
    abrirArco(p.dir, 'arco-revogado', { trabalhos: AC });
    revogarArco(p.dir, 'arco-revogado');
    const revogado = passo(p, 'arco-revogado');
    assert.deepEqual([revogado.acao, revogado.acao === 'encerrar' ? revogado.motivo : ''], ['encerrar', 'arco-encerrado']);
    abrirArco(p.dir, 'arco-expira', { trabalhos: AC });
    const depoisDoFim = new Date(Date.now() + 8 * 3600_000).toISOString();
    const expirado = passo(p, 'arco-expira', { quando: depoisDoFim });
    assert.deepEqual([expirado.acao, expirado.acao === 'encerrar' ? expirado.motivo : ''], ['encerrar', 'arco-encerrado']);
    abrirArco(p.dir, 'arco-agendado', { trabalhos: AC, deslocamentoH: 3 });
    const agendado = passo(p, 'arco-agendado');
    assert.ok(agendado.acao === 'aguardar' && agendado.motivo === 'agendado');
    for (const arco of ['arco-revogado', 'arco-expira', 'arco-agendado']) assert.equal(lerArco(p.dir, arco)!.despachos.length, 0, arco);
    assert.equal(listarIds(p.dir).length, 0, 'nenhuma thread aberta');
  } finally { p.limpar(); }
});

test('X3: o orçamento esgotado recusa o despacho com o motivo tipado, sem abrir a thread', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x3');
  try {
    abrirArco(p.dir, 'arco-x3', { trabalhos: AC, tetoDoArco: 1 });
    const r1 = passo(p, 'arco-x3');
    assert.equal(r1.acao, 'despachou');
    const r2 = passo(p, 'arco-x3');
    assert.ok(r2.acao === 'recusado' && r2.motivo === 'noctum.orcamento.esgotado', JSON.stringify(r2.acao));
    assert.equal(threadsDoItem(p, 'RM-903').length, 0, 'o trabalho C não abriu thread');
  } finally { p.limpar(); }
});

test('X4: dois processos concorrentes com capacidade 1 despacham uma vez só', { skip: semKernel }, async () => {
  const p = projetoTemporario('noctum-x4');
  try {
    abrirArco(p.dir, 'arco-x4', { trabalhos: AC, maquina: 1, contas: [{ conta: 'perfil-a', sessoes: 1 }], runtimes: [{ runtime: 'claude-bg', sessoes: 1 }] });
    const dist = path.resolve(__dirname, '..');
    const script = `
      const path = require('node:path');
      const { passoDoArco } = require(path.join(${JSON.stringify(dist)}, 'src/noctum-execucao'));
      const { exigirManifesto } = require(path.join(${JSON.stringify(dist)}, 'src/manifest'));
      const { registrarConducaoDaSessao } = require(path.join(${JSON.stringify(dist)}, 'src/conducao'));
      const { registrar } = require(path.join(${JSON.stringify(dist)}, 'src/ledger'));
      const { dirThread, novaThread } = require(path.join(${JSON.stringify(dist)}, 'src/thread'));
      const carregado = exigirManifesto(${JSON.stringify(p.dir)});
      const r = passoDoArco(carregado, 'arco-x4', {
        maquina: ${JSON.stringify(MAQUINA)}, esperarVezMs: 20000,
        lerReservas: () => ({ leitura: 'copia-local', reservas: ['RM-901', 'RM-903'].map(item => ({ item, maquina: ${JSON.stringify(MAQUINA)}, thread: null })) }),
        consultarSessoes: () => ({ sessoes: [], fontes: [{ origem: 'simulada', ok: true, detalhe: '' }], contas: [{ runtime: 'claude-bg', perfil: null }] }),
        perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }],
        abrirThread: (k, o) => {
          const t = novaThread(k, { ...o, criarWorktree: false }).thread;
          registrar(dirThread(k.raiz, t.id), t.id, 'baseline_recorded', { commit: 'SIMULADO', comandos: [], simulado: true });
          return t;
        },
        despachar: (k, threadId, o) => {
          // Como o phase run real, a sessão só existe depois de um tempo: sem a trava de despacho, o outro processo lê os
          // fatos nessa janela, não vê sessão nenhuma e despacha junto.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
          const sessionId = '00000000-0000-4000-8000-' + String(process.pid).padStart(12, '0');
          registrarConducaoDaSessao(k.raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase: o.fase, prazoMs: 3600000 },
            { sessionId, runtime: 'claude-bg', perfil: o.perfil });
          registrar(dirThread(k.raiz, threadId), threadId, 'phase_dispatch', { fase: o.fase, sessionId, runtime: 'claude-bg', pausaAoFim: false });
          return { sessionId, verificada: true, bloqueado: false, motivo: null };
        },
      });
      process.stdout.write(JSON.stringify({ acao: r.acao, motivo: r.motivo ?? null }));
    `;
    const rodar = () => new Promise<{ acao: string; motivo: string | null }>((resolve, reject) => {
      const filho = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let saida = '', erro = '';
      filho.stdout.on('data', (d) => { saida += String(d); });
      filho.stderr.on('data', (d) => { erro += String(d); });
      filho.once('exit', (codigo) => codigo === 0 ? resolve(JSON.parse(saida)) : reject(new Error(`filho saiu ${codigo}: ${erro}`)));
    });
    const resultados = await Promise.all([rodar(), rodar()]);
    assert.deepEqual(resultados.map(r => r.acao).sort(), ['aguardar', 'despachou'], JSON.stringify(resultados));
    assert.equal(resultados.find(r => r.acao === 'aguardar')!.motivo, 'capacidade.maquina', 'o segundo viu a sessão do primeiro');
    const estado = lerArco(p.dir, 'arco-x4')!;
    assert.equal(estado.despachos.length, 1, 'uma reserva só');
    assert.equal(listarIds(p.dir).length, 1, 'uma thread só');
  } finally { p.limpar(); }
});

test('X5: sem sessão no resultado do núcleo, só a recusa de antes do lançamento devolve a sessão ao orçamento', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x5');
  try {
    // Cada caso num arco e num item próprios: a reserva pendente segura o trabalho na retomada, e o caso seguinte não a veria.
    const comId = (motivo: string): NonNullable<OpcoesDoPasso['despachar']> => (_k, threadId, o) => {
      registrar(dirThread(p.dir, threadId), threadId, 'phase_dispatch_failed', { fase: o.fase, erro: `${motivo} SIMULADO depois do id`,
        sessionId: '99999999-0000-4000-8000-0000000000aa' });
      return { sessionId: null, bloqueado: false, motivo, erro: `${motivo}: SIMULADO` } as unknown as ResultadoRun;
    };
    const sem = (r: Record<string, unknown>): NonNullable<OpcoesDoPasso['despachar']> => () => ({ sessionId: null, ...r }) as unknown as ResultadoRun;
    const casos: Array<[string, NonNullable<OpcoesDoPasso['despachar']>, string, 'recusado' | 'pendente']> = [
      ['o portão do núcleo recusa antes de chamar o runtime', sem({ bloqueado: true, motivo: 'concurrency.limite', erro: 'SIMULADO' }),
        'concurrency.limite', 'recusado'],
      ['o limite de uso sem id de sessão: nada rodou', sem({ bloqueado: false, motivo: 'runtime.rate-limited', erro: 'SIMULADO' }),
        'runtime.rate-limited', 'recusado'],
      ['o núcleo mudo, sem sessão nem recusa', sem({ bloqueado: false, motivo: null }), 'despacho.sem-sessao', 'pendente'],
      ['a falha seca do runtime, sem id (o prazo estourou antes)', sem({ bloqueado: false, motivo: 'runtime.unavailable', erro: 'SIMULADO' }),
        'runtime.unavailable', 'pendente'],
      ['o limite de uso com o id dito na falha', comId('runtime.rate-limited'), 'runtime.rate-limited', 'pendente'],
    ];
    casos.forEach(([nome, despachar, motivo, desfecho], i) => {
      const arco = `arco-x5-${i}`, item = `RM-${910 + i}`;
      abrirArco(p.dir, arco, { trabalhos: [{ id: 'a', item, prioridade: 1, dependeDe: [], pedido: `Fatia SIMULADA do caso ${i}.` }] });
      const r = passo(p, arco, { itens: [item], despachar });
      assert.ok(r.acao === 'recusado' && r.motivo === motivo && r.reserva !== null, `${nome}: ${JSON.stringify(r.acao)}`);
      const estado = lerArco(p.dir, arco)!;
      assert.deepEqual(estado.despachos.map(d => d.desfecho), [desfecho], nome);
      assert.equal(estado.consumo.arco, desfecho === 'pendente' ? 1 : 0, nome);
      if (desfecho === 'pendente') assert.match(r.acao === 'recusado' ? r.detalhe : '', /a sessão pode ter aberto/, nome);
    });
  } finally { p.limpar(); }
});

test('X6: a queda dentro do núcleo sobe e deixa a reserva pendente; o passo seguinte não despacha o mesmo trabalho de novo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x6');
  try {
    abrirArco(p.dir, 'arco-x6', { trabalhos: AC });
    assert.throws(() => passo(p, 'arco-x6', { despachar: () => { throw new Error('queda SIMULADA do processo'); } }), /queda SIMULADA/);
    assert.equal(threadsDoItem(p, 'RM-901').length, 1);
    // A sessão pode ter aberto antes da queda: a reserva fica pendente e conta no orçamento até a N4 reconciliar.
    assert.deepEqual(lerArco(p.dir, 'arco-x6')!.despachos.map(d => d.desfecho), ['pendente']);
    assert.equal(lerArco(p.dir, 'arco-x6')!.consumo.arco, 1);
    // A1 da rodada 3: o trabalho com a reserva pendente vai para a retomada, e o passo segue para o outro.
    const registro: string[] = [];
    const r = passo(p, 'arco-x6', { despachar: despachoSimulado(registro) });
    assert.ok(r.acao === 'despachou' && r.trabalho === 'c', JSON.stringify(r.acao));
    assert.equal(r.acao === 'despachou' && r.fila.trabalhos.find(t => t.id === 'a')?.motivo, 'retomada');
    assert.equal(threadsDoItem(p, 'RM-901').length, 1, 'nenhuma segunda thread de A');
    assert.equal(registro.length, 1);
    const estado = lerArco(p.dir, 'arco-x6')!;
    assert.deepEqual(estado.despachos.map(d => `${d.trabalho}:${d.desfecho}`), ['a:pendente', 'c:concluido']);
    assert.equal(estado.consumo.arco, 2);
  } finally { p.limpar(); }
});

test('X7: a thread em curso não é despachada de novo, e a capacidade cheia por outro projeto espera sem reservar', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x7');
  try {
    abrirArco(p.dir, 'arco-x7', { trabalhos: [AC[0]], maquina: 2, contas: [{ conta: 'perfil-a', sessoes: 2 }] });
    const registro: string[] = [];
    assert.equal(passo(p, 'arco-x7', { despachar: despachoSimulado(registro) }).acao, 'despachou');
    const deNovo = passo(p, 'arco-x7', { despachar: despachoSimulado(registro) });
    assert.ok(deNovo.acao === 'aguardar' && deNovo.motivo === 'em-curso');
    assert.equal(registro.length, 1, 'nenhum segundo despacho da mesma thread');
    // Outro arco, com a máquina cheia de sessões de outro projeto na mesma conta: espera, sem reserva.
    abrirArco(p.dir, 'arco-cheio', { trabalhos: [AC[1]], maquina: 1, contas: [{ conta: 'perfil-a', sessoes: 1 }] });
    const cheio = passo(p, 'arco-cheio', { consultarSessoes: () => ({ ...semSessoes(),
      sessoes: [{ sessionId: '00000000-0000-4000-8000-0000000000ff', runtime: 'claude-bg', perfil: 'perfil-a', fantasma: false, viva: true,
        state: 'working' }] }) as never });
    assert.ok(cheio.acao === 'aguardar' && cheio.motivo === 'capacidade.maquina', JSON.stringify(cheio.acao === 'aguardar' ? cheio.motivo : cheio.acao));
    assert.equal(lerArco(p.dir, 'arco-cheio')!.despachos.length, 0);
  } finally { p.limpar(); }
});

test('X8: sem conta do envelope no runtime, ou com a fonte de sessões falhando, o passo espera em vez de chutar', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x8');
  try {
    abrirArco(p.dir, 'arco-x8', { trabalhos: AC });
    const semPerfil = passo(p, 'arco-x8', { perfis: () => [{ id: 'perfil-fora', runtime: 'claude-bg' }] });
    assert.ok(semPerfil.acao === 'aguardar' && semPerfil.motivo === 'capacidade.conta-nao-autorizada');
    const falha = passo(p, 'arco-x8', { consultarSessoes: () => ({ ...semSessoes(),
      fontes: [{ origem: 'claude agents --json (perfil perfil-a)', ok: false, detalhe: 'saiu 1' }] }) });
    assert.ok(falha.acao === 'aguardar' && falha.motivo === 'capacidade.fonte-indisponivel');
    assert.equal(lerArco(p.dir, 'arco-x8')!.despachos.length, 0);
  } finally { p.limpar(); }
});

test('X9: a vaga do projeto cheia (o portão do phase run) espera sem reservar, com a máquina e a conta livres', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x9');
  try {
    abrirArco(p.dir, 'arco-x9', { trabalhos: [AC[0]], maquina: 3 });
    p.carregado.manifesto.concurrency.max_parallel_threads = 1;
    const outra = novaThread(p.carregado, { nome: 'outra do projeto', modo: 'auto' }).thread;
    const sessionId = '00000000-0000-4000-8000-0000000000e1';
    registrarConducaoDaSessao(p.dir, outra.id, { canal: 'cli', operacao: 'phase.run', fase: 'GOAL', prazoMs: 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: null });
    registrar(dirThread(p.dir, outra.id), outra.id, 'phase_dispatch', { fase: 'GOAL', sessionId, runtime: 'claude-bg', pausaAoFim: false });
    const r = passo(p, 'arco-x9');
    assert.ok(r.acao === 'aguardar' && r.motivo === 'capacidade.projeto', JSON.stringify(r.acao === 'aguardar' ? r.motivo : r.acao));
    assert.equal(lerArco(p.dir, 'arco-x9')!.despachos.length, 0);
    assert.equal(threadsDoItem(p, 'RM-901').length, 0);
  } finally { p.limpar(); }
});

test('X10: a baseline que o despacho pede roda fora da trava de despacho, e o passo seguinte confere de novo e despacha', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x10');
  try {
    abrirArco(p.dir, 'arco-x10', { trabalhos: [AC[0]] });
    const pedidos: OpcoesRun[] = [];
    let baselineGravada = false;
    const simulado = despachoSimulado();
    const despachar: NonNullable<OpcoesDoPasso['despachar']> = (k, threadId, o) => {
      pedidos.push(o);
      if (!baselineGravada) return { sessionId: null, bloqueado: true, motivo: 'baseline.pendente', erro: 'baseline.pendente: SIMULADO' } as unknown as ResultadoRun;
      return simulado(k, threadId, o);
    };
    // Sem a vez da fila pesada, o passo espera a cadência e nada despacha.
    const recusa = { contrato: 'ork.fila-pesada-recusa/v1' as const, motivo: 'fila-pesada.ocupada' as const, operacao: 'baseline', thread: null,
      slots: 1, esperouMs: 0, ocupantes: [], texto: 'fila SIMULADA ocupada' };
    const semVez = passo(p, 'arco-x10', { despachar, gravarBaseline: () => { throw new ErroDaFilaPesada(recusa); } });
    assert.ok(semVez.acao === 'aguardar' && semVez.motivo === 'baseline-pendente', JSON.stringify(semVez.acao));
    let travaLivre: boolean | null = null;
    const r1 = passo(p, 'arco-x10', { despachar, gravarBaseline: (_k, _t, conducao) => {
      // Outro arco pode despachar enquanto a suíte roda: a trava de despacho já foi solta.
      const fd = tentarTravaExclusiva(path.join(p.dir, '.orkastery', 'noctum', 'despacho.lock'));
      travaLivre = fd !== null;
      if (fd !== null) fs.closeSync(fd);
      assert.equal(conducao.correlacao, 'noctum:arco-x10');
      baselineGravada = true;
    } });
    assert.ok(r1.acao === 'aguardar' && r1.motivo === 'baseline-gravada', JSON.stringify(r1.acao));
    assert.equal(travaLivre, true, 'a baseline rodou fora da trava de despacho');
    assert.ok(pedidos.length >= 2 && pedidos.every(o => o.baselinePeloDespacho === false), 'o arco nunca roda a suíte entre a reserva e o lançamento');
    let estado = lerArco(p.dir, 'arco-x10')!;
    assert.deepEqual(estado.despachos.map(d => `${d.desfecho}:${d.motivo}`), ['recusado:baseline.pendente', 'recusado:baseline.pendente']);
    assert.equal(estado.consumo.arco, 0, 'as reservas voltaram');
    const r2 = passo(p, 'arco-x10', { despachar });
    assert.ok(r2.acao === 'despachou' && r2.trabalho === 'a', JSON.stringify(r2.acao));
    estado = lerArco(p.dir, 'arco-x10')!;
    assert.deepEqual(estado.despachos.map(d => d.desfecho), ['recusado', 'recusado', 'concluido']);
    assert.equal(threadsDoItem(p, 'RM-901').length, 1, 'a thread aberta no primeiro passo é a que despacha');
  } finally { p.limpar(); }
});

test('X11: a falha de um candidato antes de lançar devolve a reserva e o mesmo passo despacha o próximo; três seguidas o bloqueiam', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x11');
  try {
    abrirArco(p.dir, 'arco-x11', { trabalhos: AC });
    const abrirThread: NonNullable<OpcoesDoPasso['abrirThread']> = (k, o) => {
      if (o.roadmap === 'RM-901') throw new Error('worktree SIMULADA não pôde ser criada');
      return abrirComBaseline(k, o);
    };
    const r1 = passo(p, 'arco-x11', { abrirThread });
    assert.ok(r1.acao === 'despachou' && r1.trabalho === 'c', JSON.stringify(r1.acao));
    // Só a falha de candidato, sem vaga recusada: o passo diz o erro, em vez de esperar.
    const r2 = passo(p, 'arco-x11', { abrirThread });
    assert.ok(r2.acao === 'recusado' && r2.trabalho === 'a' && r2.motivo === 'noctum.despacho.erro', JSON.stringify(r2.acao));
    assert.match(r2.acao === 'recusado' ? r2.detalhe : '', /worktree SIMULADA/);
    passo(p, 'arco-x11', { abrirThread });
    const estado = lerArco(p.dir, 'arco-x11')!;
    assert.deepEqual(estado.despachos.map(d => `${d.trabalho}:${d.desfecho}`), ['a:recusado', 'c:concluido', 'a:recusado', 'a:recusado']);
    assert.equal(estado.consumo.arco, 1, 'as falhas devolveram as sessões');
    const r4 = passo(p, 'arco-x11', { abrirThread });
    assert.ok(r4.acao === 'aguardar' && r4.motivo === 'em-curso', JSON.stringify(r4.acao));
    assert.equal(r4.acao === 'aguardar' && r4.fila?.trabalhos.find(t => t.id === 'a')?.motivo, 'erro-repetido');
    assert.equal(lerArco(p.dir, 'arco-x11')!.despachos.length, 4, 'o trabalho bloqueado não ganha reserva nova');
  } finally { p.limpar(); }
});

test('X12: o log do arco adulterado volta como recusa tipada do passo, sem exceção e sem despacho', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x12');
  try {
    abrirArco(p.dir, 'arco-x12', { trabalhos: AC });
    fs.appendFileSync(path.join(p.dir, '.orkastery', 'noctum', 'arcos', 'arco-x12', 'arco.jsonl'),
      JSON.stringify({ tipo: 'despacho_concluido', reserva: 1 }) + '\n');
    const r = passo(p, 'arco-x12');
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.estado.adulterado', JSON.stringify(r.acao === 'aguardar' ? r.motivo : r.acao));
    assert.equal(listarIds(p.dir).length, 0);
  } finally { p.limpar(); }
});

test('X13: o claude --bg que diz o id e sai com erro deixa a reserva pendente e contada, e o passo seguinte não abre outra sessão', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x13');
  const claude = runtimePorConta('noctum-x13');
  const codex = dirTemporario('noctum-x13-codex');
  const codexAntes = process.env.CODEX_HOME;
  try {
    fs.mkdirSync(path.join(codex, 'sessions'));
    process.env.CODEX_HOME = codex;
    // O stub dos testes, com uma diferença: no despacho, diz o id da sessão e sai com 1 (a falha que o RM-063 descreve).
    const stub = path.join(claude.dir, 'claude');
    const original = fs.readFileSync(stub, 'utf8');
    const alterado = original.replace('echo "Background agent started: $SESSAO"\nexit 0',
      'echo "Background agent started: $SESSAO"\necho "erro SIMULADO depois do id" >&2\nexit 1');
    assert.notEqual(alterado, original);
    fs.writeFileSync(stub, alterado, { mode: 0o755 });
    claude.conta(p.dir, 'perfil-a');
    abrirArco(p.dir, 'arco-x13', { trabalhos: [AC[0]], maquina: 3, contas: [{ conta: 'perfil-a', sessoes: 3 }], tetoDoArco: 3 });
    const real = () => passoDoArco(p.carregado, 'arco-x13', { maquina: MAQUINA, lerReservas: reservadas(['RM-901']) });
    // RM-058, integração (D6): a baseline real do bloco com GO, fora da trava, antes do primeiro despacho.
    const r0 = real();
    assert.ok(r0.acao === 'aguardar' && r0.motivo === 'baseline-gravada', JSON.stringify(r0));
    const r1 = real();
    assert.ok(r1.acao === 'recusado' && r1.motivo === 'runtime.unavailable' && r1.reserva !== null, JSON.stringify(r1.acao));
    assert.match(r1.acao === 'recusado' ? r1.detalhe : '', /a sessão pode ter aberto \(99999999-0000-4000-8000-000000000001\)/);
    let estado = lerArco(p.dir, 'arco-x13')!;
    assert.deepEqual(estado.despachos.map(d => d.desfecho), ['recusado', 'pendente']);
    assert.equal(estado.consumo.arco, 1, 'a sessão que pode ter aberto conta no teto');
    const r2 = real();
    assert.ok(r2.acao === 'aguardar', JSON.stringify(r2.acao));
    assert.equal(r2.acao === 'aguardar' && r2.fila?.trabalhos[0].motivo, 'retomada', 'a thread com o despacho falho vai para a retomada da N4');
    assert.equal(Number(fs.readFileSync(path.join(claude.dir, 'n'), 'utf8').trim()), 1, 'o runtime abriu uma sessão só');
    estado = lerArco(p.dir, 'arco-x13')!;
    assert.equal(estado.despachos.length, 2, 'nenhuma reserva nova depois da sessão que pode ter aberto');
  } finally {
    if (codexAntes === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexAntes;
    p.limpar(); claude.restaurar(); fs.rmSync(codex, { recursive: true, force: true });
  }
});

test('X14: a recusa da reserva que é só do candidato deixa o passo seguir; a que vale para o arco para tudo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x14');
  try {
    const recusandoA = (motivo: 'noctum.orcamento.esgotado' | 'noctum.efeito.revogado'): NonNullable<OpcoesDoPasso['reservar']> =>
      (raiz, pedido, quando) => {
        if (pedido.trabalho === 'a') throw new RecusaDoArco(motivo, 'recusa SIMULADA da reserva do trabalho a');
        return reservarDespacho(raiz, pedido, quando);
      };
    abrirArco(p.dir, 'arco-x14', { trabalhos: AC });
    const r1 = passo(p, 'arco-x14', { reservar: recusandoA('noctum.orcamento.esgotado') });
    assert.ok(r1.acao === 'despachou' && r1.trabalho === 'c', JSON.stringify(r1.acao));
    // Outros itens, para os dois trabalhos estarem na fila de novo: a recusa do arco inteiro não deixa tentar o segundo.
    const DE: TrabalhoSimulado[] = [
      { id: 'a', item: 'RM-904', prioridade: 1, dependeDe: [], pedido: 'Fatia D SIMULADA.' },
      { id: 'c', item: 'RM-905', prioridade: 2, dependeDe: [], pedido: 'Fatia E SIMULADA.' },
    ];
    abrirArco(p.dir, 'arco-x14b', { trabalhos: DE });
    const threads = listarIds(p.dir).length;
    const r2 = passo(p, 'arco-x14b', { itens: ['RM-904', 'RM-905'], reservar: recusandoA('noctum.efeito.revogado') });
    assert.ok(r2.acao === 'recusado' && r2.trabalho === 'a' && r2.motivo === 'noctum.efeito.revogado', JSON.stringify(r2.acao));
    assert.equal(lerArco(p.dir, 'arco-x14b')!.despachos.length, 0);
    assert.equal(listarIds(p.dir).length, threads, 'nenhuma thread aberta');
  } finally { p.limpar(); }
});

test('X15: a reserva que abre a thread de um trabalho de pedido é só pelo GOAL e só quando nenhuma thread casa com ele', () => {
  const p = projetoTemporario('noctum-x15');
  try {
    const h = abrirArco(p.dir, 'arco-x15', { trabalhos: [AC[0]] });
    const base = { arco: 'arco-x15', envelopeSha256: h, trabalho: 'a', thread: null, runtime: 'claude-bg', conta: 'perfil-a', revisao: false };
    const recusa = (fase: 'GOAL' | 'PLAN', texto: RegExp) => assert.throws(() => reservarDespacho(p.dir, { ...base, fase }),
      (e: unknown) => e instanceof RecusaDoArco && e.motivo === 'noctum.despacho.fora-do-envelope' && texto.test(e.message));
    recusa('PLAN', /o trabalho a abre a thread pelo GOAL, não pelo PLAN/);
    const t = novaThread(p.carregado, { nome: 'ja aberta', modo: 'auto', roadmap: 'RM-901', pedido: PEDIDO.a }).thread;
    recusa('GOAL', new RegExp(`o trabalho a já tem a thread ${t.id}: o despacho vai por ela`));
    fs.writeFileSync(caminhoThread(p.dir, t.id), '{ ilegível');
    recusa('GOAL', /há thread ilegível no projeto, e ela pode ser a do trabalho a/);
    assert.equal(lerArco(p.dir, 'arco-x15')!.despachos.length, 0);
  } finally { p.limpar(); }
});

// ---------------------------------------------------------------------------
// RM-058 N4 (D8, D14 e D21 da ork-rm058n4): o passo com as decisões da supervisão e os alvos de runtime do envelope.
// ---------------------------------------------------------------------------

/** O despacho simulado que guarda o runtime, o modelo, o esforço, o perfil e a correlação que o passo mandou ao núcleo. */
function despachoQueGuarda(opcoes: OpcoesRun[]): NonNullable<OpcoesDoPasso['despachar']> {
  const simulado = despachoSimulado();
  return (carregado, threadId, o) => { opcoes.push(o); return simulado(carregado, threadId, o); };
}

test('X16: com os alvos da supervisão, a fase sai pelo runtime de fallback que o envelope admite, com o modelo dele; sem eles, não sai', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x16');
  try {
    abrirArco(p.dir, 'arco-x16', { trabalhos: [AC[0]], maquina: 2, contas: [{ conta: 'perfil-a', sessoes: 1 }, { conta: 'perfil-c', sessoes: 1 }],
      runtimes: [{ runtime: 'claude-bg', sessoes: 1 }, { runtime: 'codex', sessoes: 1 }] });
    // A conta do runtime do bloco saiu da seleção (a supervisão a tirou): só a do codex sobra.
    const perfis = () => [{ id: 'perfil-c', runtime: 'codex' }];
    const opcoes: OpcoesRun[] = [];
    const semAlvos = passo(p, 'arco-x16', { perfis, despachar: despachoQueGuarda(opcoes) });
    assert.ok(semAlvos.acao === 'aguardar' && semAlvos.motivo === 'capacidade.conta-nao-autorizada', JSON.stringify(semAlvos.acao));
    assert.equal(opcoes.length, 0);
    const vistos: string[] = [];
    const comAlvos = passo(p, 'arco-x16', { perfis, despachar: despachoQueGuarda(opcoes), alvos: (fase, doBloco) => {
      vistos.push(`${fase}:${doBloco}`);
      return [{ runtime: doBloco }, { runtime: 'codex', model: 'modelo-SIMULADO', effort: 'medium' }];
    } });
    assert.ok(comAlvos.acao === 'despachou' && comAlvos.runtime === 'codex' && comAlvos.conta === 'perfil-c', JSON.stringify(comAlvos.acao));
    assert.deepEqual(vistos, ['GOAL:claude-bg'], 'o passo pergunta os alvos com o runtime do bloco');
    assert.deepEqual([opcoes[0].runtime, opcoes[0].model, opcoes[0].effort, opcoes[0].perfil, opcoes[0].correlacao],
      ['codex', 'modelo-SIMULADO', 'medium', 'perfil-c', 'noctum:arco-x16']);
    assert.deepEqual(lerArco(p.dir, 'arco-x16')!.despachos.map(d => `${d.runtime}:${d.conta}:${d.desfecho}`), ['codex:perfil-c:concluido']);
  } finally { p.limpar(); }
});

test('X17: a retomada autorizada sai pelo passo, com a reserva e a correlação do arco; sem ela, o trabalho espera a N4', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x17');
  try {
    const t = novaThread(p.carregado, { nome: 'parou', modo: 'auto', roadmap: 'RM-901', pedido: PEDIDO.a }).thread;
    baselineSimulada(p.dir, t.id); // a thread chegou ao GO: o condutor já tinha gravado a baseline
    abrirArco(p.dir, 'arco-x17', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], thread: t.id }] });
    stopSemResultado(p.dir, t.id, 'GO', despacharNaThread(p.dir, t.id, 'GO', 171));
    const opcoes: OpcoesRun[] = [];
    const sem = passo(p, 'arco-x17', { despachar: despachoQueGuarda(opcoes) });
    assert.ok(sem.acao === 'aguardar', JSON.stringify(sem.acao));
    assert.equal(sem.acao === 'aguardar' && sem.fila?.trabalhos[0].motivo, 'fim-de-turno-sem-resultado');
    const com = passo(p, 'arco-x17', { despachar: despachoQueGuarda(opcoes),
      supervisao: { isolados: new Map(), retomadas: new Map([['a', { fase: 'GO' as const, tentativa: 1, motivo: 'fim-de-turno-sem-resultado' }]]) } });
    assert.ok(com.acao === 'despachou' && com.trabalho === 'a' && com.fase === 'GO', JSON.stringify(com.acao));
    assert.deepEqual([opcoes.length, opcoes[0].fase, opcoes[0].correlacao], [1, 'GO', 'noctum:arco-x17']);
    assert.deepEqual(lerArco(p.dir, 'arco-x17')!.despachos.map(d => `${d.trabalho}:${d.fase}:${d.desfecho}`), ['a:GO:concluido']);
  } finally { p.limpar(); }
});

test('X18: o trabalho isolado não é despachado, e o passo segue para o próximo candidato', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x18');
  try {
    abrirArco(p.dir, 'arco-x18', { trabalhos: AC, maquina: 2, contas: [{ conta: 'perfil-a', sessoes: 2 }] });
    const registro: string[] = [];
    const r = passo(p, 'arco-x18', { despachar: despachoSimulado(registro),
      supervisao: { isolados: new Map([['a', 'retomadas esgotadas (SIMULADO)']]), retomadas: new Map() } });
    assert.ok(r.acao === 'despachou' && r.trabalho === 'c', JSON.stringify(r.acao));
    assert.equal(r.acao === 'despachou' && r.fila.trabalhos.find(t => t.id === 'a')?.motivo, 'isolado');
    assert.equal(threadsDoItem(p, 'RM-901').length, 0, 'o isolado não abriu thread');
    assert.equal(registro.length, 1);
  } finally { p.limpar(); }
});
