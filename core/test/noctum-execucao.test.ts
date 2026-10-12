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
import { abrirArco, concluirFase, entregar, gravarArtefato, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { passoDoArco, OpcoesDoPasso, ResultadoDoPasso } from '../src/noctum-execucao';
import { lerArco } from '../src/noctum-arco';
import { registrarConducaoDaSessao } from '../src/conducao';
import { kernelDisponivel } from '../src/fila-pesada';
import { registrar } from '../src/ledger';
import { ResultadoRun } from '../src/phase';
import { dirThread, lerThread, listarIds, novaThread } from '../src/thread';

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

const semWorktree: NonNullable<OpcoesDoPasso['abrirThread']> = (carregado, o) => novaThread(carregado, { ...o, criarWorktree: false }).thread;

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
    const r1 = real();
    assert.equal(r1.acao, 'despachou', JSON.stringify(r1.acao === 'aguardar' || r1.acao === 'recusado' ? r1 : r1.acao));
    assert.ok(r1.acao === 'despachou');
    assert.equal(r1.trabalho, 'a');
    assert.equal(r1.conta, 'perfil-a');
    assert.match(String(r1.sessionId), /^99999999-0000-4000-8000-/, 'a sessão veio do runtime pelo phase run');
    const ta = lerThread(p.dir, r1.thread);
    assert.equal(ta.roadmap, 'RM-901');
    assert.ok(ta.worktree, 'a thread aberta pelo arco tem worktree');
    const estado = lerArco(p.dir, 'arco-x1')!;
    assert.equal(estado.despachos.length, 1);
    assert.equal(estado.despachos[0].desfecho, 'concluido');
    assert.equal(estado.consumo.arco, 1);
    // A segue em curso e B depende dela: nada a despachar, o passo espera a cadência.
    const r2 = real();
    assert.equal(r2.acao, 'aguardar');
    assert.ok(r2.acao === 'aguardar' && r2.motivo === 'em-curso');
    // A sessão de A faz o bloco e A é entregue: B entra.
    gravarArtefato(p.dir, ta.id, 'check.md');
    concluirFase(p.dir, ta.id, 'GOAL', String(r1.sessionId));
    entregar(p.dir, ta.id);
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
        abrirThread: (k, o) => novaThread(k, { ...o, criarWorktree: false }).thread,
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

test('X5: o despacho que o núcleo recusa devolve a sessão ao orçamento e diz o motivo', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x5');
  try {
    abrirArco(p.dir, 'arco-x5', { trabalhos: AC });
    const recusou = passo(p, 'arco-x5', { despachar: () => ({ sessionId: null, bloqueado: true, motivo: 'concurrency.limite',
      erro: 'concurrency.limite: SIMULADO' }) as unknown as ResultadoRun });
    assert.ok(recusou.acao === 'recusado' && recusou.motivo === 'concurrency.limite', JSON.stringify(recusou.acao));
    const estado = lerArco(p.dir, 'arco-x5')!;
    assert.equal(estado.despachos[0].desfecho, 'recusado');
    assert.equal(estado.consumo.arco, 0, 'a recusa devolveu a sessão');
  } finally { p.limpar(); }
});

test('X6: a queda entre abrir a thread e despachar não duplica a thread: o passo seguinte acha a dela pelo pedido', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-x6');
  try {
    abrirArco(p.dir, 'arco-x6', { trabalhos: AC });
    assert.throws(() => passo(p, 'arco-x6', { despachar: () => { throw new Error('queda SIMULADA do processo'); } }), /queda SIMULADA/);
    assert.equal(threadsDoItem(p, 'RM-901').length, 1);
    const registro: string[] = [];
    const r = passo(p, 'arco-x6', { despachar: despachoSimulado(registro) });
    assert.ok(r.acao === 'despachou' && r.trabalho === 'a', JSON.stringify(r.acao));
    assert.equal(threadsDoItem(p, 'RM-901').length, 1, 'a mesma thread, não uma segunda');
    assert.equal(registro.length, 1);
    const estado = lerArco(p.dir, 'arco-x6')!;
    assert.deepEqual(estado.despachos.map(d => d.desfecho), ['recusado', 'concluido']);
    assert.equal(estado.consumo.arco, 1);
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
