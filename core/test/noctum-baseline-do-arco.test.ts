/**
 * RM-058, integração (T2 da ork-rm058integra, D6): a baseline do arco em todo runtime. O passo do arco não despacha o
 * bloco com GO sem `baseline_recorded`, nem no `claude-bg`; o condutor a grava fora da trava de despacho, e o vigia nunca.
 * Os nomes começam por BL. Arcos, itens, pedidos, contas, sessões e baselines são SIMULADOS: a baseline simulada só grava o
 * evento que o núcleo grava, sem rodar a suíte.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { abrirArco, prepararIngressoSimulado, threadDoTrabalho } from './noctum-apoio';
import { opcoesSimuladas } from './noctum-supervisao-apoio';
import { ErroDaFilaPesada, kernelDisponivel } from '../src/fila-pesada';
import { lerLedger, registrar, TIPOS_DE_EVENTO } from '../src/ledger';
import { lerArco } from '../src/noctum-arco';
import { baselineDoArcoPendente, OpcoesDoPasso, passoDoArco } from '../src/noctum-execucao';
import { ResultadoDoTique, vigiarArco } from '../src/noctum-vigia';
import { baselineDoDespachoNecessaria } from '../src/phase';
import { dirThread, lerThread } from '../src/thread';

prepararIngressoSimulado();

const ITEM = 'RM-951';

/** A thread #Auto do trabalho, com o pedido guardado, num arco vigente que a lista. */
function arcoComThread(p: ProjetoDeTeste, arco: string): string {
  const t = threadDoTrabalho(p.carregado, `${arco} trabalho`, ITEM, `Fatia SIMULADA do ${arco}.`);
  abrirArco(p.dir, arco, { trabalhos: [{ id: 'w1', item: ITEM, prioridade: 1, dependeDe: [], thread: t.id }] });
  return t.id;
}

const baselines = (p: ProjetoDeTeste, thread: string) =>
  lerLedger(dirThread(p.dir, thread)).filter(e => e.tipo === TIPOS_DE_EVENTO.baselineGravada).length;

/** A baseline SIMULADA do condutor: só o evento do núcleo, e a conta de quantas vezes rodou. */
function baselineSimulada(gravacoes: string[]): NonNullable<OpcoesDoPasso['gravarBaseline']> {
  return (carregado, thread) => {
    gravacoes.push(thread);
    registrar(dirThread(carregado.raiz, thread), thread, TIPOS_DE_EVENTO.baselineGravada, { commit: 'SIMULADO', comandos: [] });
  };
}

/** As dependências do passo, com o despacho simulado (a lista `registro` conta os despachos) e o perfil do envelope. */
function passo(p: ProjetoDeTeste, registro: string[], extra: Partial<OpcoesDoPasso> = {}): OpcoesDoPasso {
  assert.ok(kernelDisponivel(), 'o passo do arco exige /usr/bin/flock');
  return { ...opcoesSimuladas(p.dir, [ITEM], registro).passo, perfis: () => [{ id: 'perfil-a', runtime: 'claude-bg' }], ...extra };
}

test('BL1: o bloco com GO no claude-bg sem baseline devolve a reserva com baseline.pendente e não chama o despacho', () => {
  const p = projetoTemporario('bl1');
  try {
    const thread = arcoComThread(p, 'arco-bl1');
    const registro: string[] = [];
    // A fila pesada ocupada: a baseline não roda agora, e o passo espera por ela.
    const r = passoDoArco(p.carregado, 'arco-bl1', passo(p, registro, { gravarBaseline: (_k, t) => {
      throw new ErroDaFilaPesada({ contrato: 'ork.fila-pesada-recusa/v1', motivo: 'fila-pesada.ocupada', operacao: 'verify.baseline', thread: t,
        slots: 1, esperouMs: 0, ocupantes: [], texto: 'fila pesada SIMULADA ocupada' });
    } }));
    assert.equal(r.acao, 'aguardar', JSON.stringify(r));
    assert.ok(r.acao === 'aguardar' && r.motivo === 'baseline-pendente', JSON.stringify(r));
    assert.deepEqual(registro, [], 'nenhum despacho saiu');
    assert.equal(lerThread(p.dir, thread).modo, 'auto');
    const estado = lerArco(p.dir, 'arco-bl1')!;
    assert.deepEqual(estado.despachos.map(d => [d.fase, d.runtime, d.desfecho, d.motivo]), [['GOAL', 'claude-bg', 'recusado', 'baseline.pendente']]);
    assert.equal(estado.consumo.arco, 0, 'a reserva voltou ao orçamento');
    assert.equal(baselines(p, thread), 0);
  } finally { p.limpar(); }
});

test('BL2: o condutor grava a baseline uma vez, fora da trava, e o passo seguinte confere o envelope e despacha', () => {
  const p = projetoTemporario('bl2');
  try {
    const thread = arcoComThread(p, 'arco-bl2');
    const registro: string[] = [], gravacoes: string[] = [];
    const opcoes = passo(p, registro, { gravarBaseline: baselineSimulada(gravacoes) });
    const r1 = passoDoArco(p.carregado, 'arco-bl2', opcoes);
    assert.ok(r1.acao === 'aguardar' && r1.motivo === 'baseline-gravada', JSON.stringify(r1));
    assert.deepEqual(gravacoes, [thread]);
    assert.deepEqual(registro, []);
    const r2 = passoDoArco(p.carregado, 'arco-bl2', opcoes);
    assert.ok(r2.acao === 'despachou' && r2.thread === thread && r2.fase === 'GOAL', JSON.stringify(r2));
    assert.equal(registro.length, 1);
    assert.deepEqual(gravacoes, [thread], 'a baseline não roda de novo');
    assert.equal(baselines(p, thread), 1);
    assert.deepEqual(lerArco(p.dir, 'arco-bl2')!.despachos.map(d => d.desfecho), ['recusado', 'concluido']);
  } finally { p.limpar(); }
});

test('BL3: o tique do vigia, sem condutor, nunca grava a baseline e deixa o motivo para o condutor', () => {
  const p = projetoTemporario('bl3');
  try {
    const thread = arcoComThread(p, 'arco-bl3');
    const registro: string[] = [];
    const r = vigiarArco(p.carregado, 'arco-bl3', opcoesSimuladas(p.dir, [ITEM], registro));
    assert.equal(r.acao, 'tique', JSON.stringify(r));
    const t = r as ResultadoDoTique;
    assert.equal(t.condutor, 'assumido');
    assert.ok(t.passo?.acao === 'aguardar' && t.passo.motivo === 'baseline-pendente', JSON.stringify(t.passo));
    assert.match(t.passo?.acao === 'aguardar' ? t.passo.detalhe : '', /fica para o condutor do arco/);
    assert.deepEqual(registro, []);
    assert.equal(baselines(p, thread), 0, 'o vigia não gravou a baseline');
  } finally { p.limpar(); }
});

test('BL4: a thread com baseline_recorded despacha direto, sem gravar outra', () => {
  const p = projetoTemporario('bl4');
  try {
    const thread = arcoComThread(p, 'arco-bl4');
    registrar(dirThread(p.dir, thread), thread, TIPOS_DE_EVENTO.baselineGravada, { commit: 'SIMULADO', comandos: [] });
    const registro: string[] = [], gravacoes: string[] = [];
    const r = passoDoArco(p.carregado, 'arco-bl4', passo(p, registro, { gravarBaseline: baselineSimulada(gravacoes) }));
    assert.ok(r.acao === 'despachou' && r.thread === thread, JSON.stringify(r));
    assert.deepEqual(gravacoes, []);
    assert.equal(registro.length, 1);
  } finally { p.limpar(); }
});

test('BL5: o CHECK de revisão, sem GO no resto do bloco, não pede baseline; GOAL e GO pedem', () => {
  const p = projetoTemporario('bl5');
  try {
    const thread = lerThread(p.dir, arcoComThread(p, 'arco-bl5'));
    assert.deepEqual(thread.blocos.map(b => b.fases.join('-')), ['GOAL-PLAN-GO-CHECK-SHIP-MASTER']);
    assert.equal(baselineDoArcoPendente(p.dir, thread, 'CHECK'), false);
    assert.equal(baselineDoArcoPendente(p.dir, thread, 'SHIP'), false);
    assert.equal(baselineDoArcoPendente(p.dir, thread, 'GOAL'), true);
    assert.equal(baselineDoArcoPendente(p.dir, thread, 'GO'), true);
    registrar(dirThread(p.dir, thread.id), thread.id, TIPOS_DE_EVENTO.baselineGravada, { commit: 'SIMULADO', comandos: [] });
    assert.equal(baselineDoArcoPendente(p.dir, thread, 'GO'), false);
  } finally { p.limpar(); }
});

test('BL6: fora do arco, o despacho segue pedindo a baseline só no codex: no claude-bg, baselineDoDespachoNecessaria é falso', () => {
  const p = projetoTemporario('bl6');
  try {
    const thread = lerThread(p.dir, arcoComThread(p, 'arco-bl6'));
    assert.equal(p.carregado.manifesto.runtime.adapter, 'claude-bg');
    assert.equal(baselineDoDespachoNecessaria(p.carregado, thread.id, { fase: 'GOAL', prompt: 'pedido SIMULADO' }), false);
    assert.equal(baselineDoArcoPendente(p.dir, thread, 'GOAL'), true, 'no arco, a mesma thread pede a baseline');
  } finally { p.limpar(); }
});
