/** RM-058, bloco B: projeção somente leitura da rede. Tudo roda em remotos locais e máquinas simuladas. */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { exec } from '../src/util';
import { abrirArco, prepararIngressoSimulado } from './noctum-apoio';
import { duasMaquinas, gravarCru } from './noctum-maquinas-apoio';
import { projetoTemporario } from './apoio';
import {
  assumirAutoridade, bater, emitirOrdem, gravarNaCoordenacao, responderOrdem, tomarVagaGlobal,
} from '../src/noctum-coordenacao';
import { coordenacaoDaFila, lerRede } from '../src/noctum-rede';

prepararIngressoSimulado();

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: [], pedido: 'Fatia B SIMULADA.', maquina: 'maquina-b' },
];

function cenario(nome: string) {
  return duasMaquinas(nome, { trabalhos: TRABALHOS.map(t => ({ ...t })), maquina: 2, revisao: 0,
    contas: [{ conta: 'perfil-a', sessoes: 2 }], runtimes: [{ runtime: 'claude-bg', sessoes: 2 }],
    global: [{ conta: 'perfil-a', sessoes: 4 }] });
}

function comOrdemNaB(nome: string) {
  const m = cenario(nome);
  assumirAutoridade(m.a.carregado, m.arco, { maquina: m.a.nome });
  bater(m.b.carregado, m.arco, { maquina: m.b.nome });
  emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: m.b.nome }, { maquina: m.a.nome });
  responderOrdem(m.b.carregado, m.arco, 'O-b-1', 'aceita', 'SIMULADO: ordem aceita', { maquina: m.b.nome });
  return m;
}

test('NR1: projeta autoridade, sinais, ordens, vagas e consumo das duas máquinas', () => {
  const m = comOrdemNaB('noctum-nr1');
  try {
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-b-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, { maquina: m.b.nome });
    const r = lerRede(m.a.carregado, m.arco, { maquina: m.a.nome });
    assert.equal(r.lacuna, null);
    assert.deepEqual(r.autoridade && [r.autoridade.maquina, r.autoridade.geracao], ['maquina-a', 1]);
    assert.deepEqual(r.maquinas.map(x => [x.nome, x.ordensVivas, x.vagasAtivas, x.consumo]),
      [['maquina-a', [], [], 0], ['maquina-b', ['O-b-1'], ['V-maquina-b-1'], 1]]);
    assert.equal(r.maquinas.every(x => x.ultimoSinal && x.sinalRecente), true);
  } finally { m.limpar(); }
});

test('NR2: trabalho vivo só na outra máquina fica identificado pela ordem', () => {
  const m = comOrdemNaB('noctum-nr2');
  try {
    const t = lerRede(m.a.carregado, m.arco, { maquina: m.a.nome }).trabalhos.find(x => x.id === 'b')!;
    assert.deepEqual([t.estado, t.maquina, t.ordem?.ordem, t.ordem?.numero, t.maquinaPresa],
      ['em-execucao', 'maquina-b', 'O-b-1', 1, 'maquina-b']);
  } finally { m.limpar(); }
});

test('NR3: a entrega da outra máquina traz instante, máquina e merge', () => {
  const m = comOrdemNaB('noctum-nr3');
  try {
    gravarNaCoordenacao(m.b.carregado, m.arco, { maquina: m.b.nome }, () => ({ novos: [{ tipo: 'entrega', trabalho: 'b', ordem: 'O-b-1',
      destino: { repositorio: 'exemplo/produto', base: 'main' }, fonte: '1'.repeat(40), base: '2'.repeat(40), merge: '3'.repeat(40) }], resultado: null }));
    const t = lerRede(m.a.carregado, m.arco, { maquina: m.a.nome }).trabalhos.find(x => x.id === 'b')!;
    assert.deepEqual(t.entrega && [t.entrega.maquina, t.entrega.merge], ['maquina-b', '3'.repeat(40)]);
    assert.equal(t.estado, 'entregue');
  } finally { m.limpar(); }
});

test('NR4: remoto sem leitura dá lacuna tipada, nunca rede vazia íntegra', () => {
  const m = cenario('noctum-nr4');
  const isolado = fs.mkdtempSync(path.join(os.tmpdir(), 'noctum-nr4-'));
  try {
    assert.ok(exec('git', ['remote', 'set-url', 'origin', path.join(isolado, 'ausente.git')], m.a.dir).ok);
    const r = lerRede(m.a.carregado, m.arco, { maquina: m.a.nome });
    assert.equal(r.multimaquina, true);
    assert.equal(r.lacuna?.motivo, 'noctum.coordenacao.sem-remoto');
    assert.deepEqual([r.maquinas, r.trabalhos], [[], []]);
  } finally { fs.rmSync(isolado, { recursive: true, force: true }); m.limpar(); }
});

test('NR5: ramo adulterado dá lacuna tipada', () => {
  const m = cenario('noctum-nr5');
  try {
    assumirAutoridade(m.a.carregado, m.arco, { maquina: m.a.nome });
    gravarCru(m.a.dir, [{ caminho: `arcos/${m.arco}/fora-do-contrato.json`, conteudo: '{}\n' }]);
    const r = lerRede(m.b.carregado, m.arco, { maquina: m.b.nome });
    assert.equal(r.lacuna?.motivo, 'noctum.coordenacao.adulterado');
  } finally { m.limpar(); }
});

test('NR6: arco v2 não consulta o ramo', () => {
  const p = projetoTemporario('noctum-nr6');
  try {
    abrirArco(p.dir, 'arco-nr6', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'A SIMULADA.' }],
      maquina: 1, contas: [{ conta: 'perfil-a', sessoes: 1 }] });
    const r = lerRede(p.carregado, 'arco-nr6', { maquina: 'maquina-a', remoto: 'remoto-que-nao-existe' });
    assert.deepEqual([r.multimaquina, r.lacuna, r.maquinas], [false, null, []]);
  } finally { p.limpar(); }
});

test('NR7: projeta só as obrigações desta máquina no ramo', () => {
  const m = comOrdemNaB('noctum-nr7');
  try {
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-b-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 2 }, { maquina: m.b.nome });
    const a = lerRede(m.a.carregado, m.arco, { maquina: m.a.nome });
    const b = lerRede(m.b.carregado, m.arco, { maquina: m.b.nome });
    assert.deepEqual(a.obrigacoes, { ordens: [], vagas: [], vezes: [] });
    assert.deepEqual(b.obrigacoes, { ordens: ['O-b-1'], vagas: ['V-maquina-b-2'], vezes: [] });
  } finally { m.limpar(); }
});

test('NR8: coordenacaoDaFila separa ordem local, trabalho remoto e terminais', () => {
  const m = comOrdemNaB('noctum-nr8');
  try {
    const daA = coordenacaoDaFila(lerRede(m.a.carregado, m.arco, { maquina: m.a.nome }))!;
    const daB = coordenacaoDaFila(lerRede(m.b.carregado, m.arco, { maquina: m.b.nome }))!;
    assert.deepEqual([...daA.emOutraMaquina], ['b']);
    assert.deepEqual([...daA.trabalhos], []);
    assert.deepEqual([...daB.trabalhos], ['b']);
    assert.deepEqual(daB.ordens.get('b'), { ordem: 'O-b-1', numero: 1 });
  } finally { m.limpar(); }
});
