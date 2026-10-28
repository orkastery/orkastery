/** RM-058, bloco B: a supervisão chama a porta entre máquinas. Tudo é SIMULADO e usa remotos locais de fixture. */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { exec } from '../src/util';
import { kernelDisponivel } from '../src/fila-pesada';
import { gravarNaSupervisao, Instancia } from '../src/noctum-supervisao';
import { passoConduzido, vigiarArco } from '../src/noctum-vigia';
import { abrirArco, prepararIngressoSimulado } from './noctum-apoio';
import { projetoTemporario } from './apoio';
import { condutorDaMaquinaSimulado, duasMaquinas } from './noctum-maquinas-apoio';
import { instancia, opcoesSimuladas } from './noctum-supervisao-apoio';
import { assumirAutoridade, bater, emitirOrdem, lerCoordenacao, responderOrdem } from '../src/noctum-coordenacao';
import { encerrarArco } from '../src/noctum-arco';
import { passoDaMaquina } from '../src/noctum-maquinas';
import { retomadaNaRede } from '../src/noctum-retomada-rede';
import { tiqueDoArco } from '../src/noctum-modo';
import { CONTRATO_REDE_DO_ARCO, RedeDoArco } from '../src/noctum-rede';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'c', item: 'RM-903', prioridade: 2, dependeDe: [], pedido: 'Fatia C SIMULADA.' },
];

function cenario(nome: string) {
  return duasMaquinas(nome, { trabalhos: TRABALHOS.map(t => ({ ...t })), maquina: 2, revisao: 0,
    contas: [{ conta: 'perfil-a', sessoes: 2 }], runtimes: [{ runtime: 'claude-bg', sessoes: 2 }],
    global: [{ conta: 'perfil-a', sessoes: 2 }] });
}

test('LM1: o condutor v3 passa pela máquina, aceita a ordem e faz um despacho com vaga global', { skip: semKernel }, () => {
  const m = cenario('noctum-lm1');
  try {
    const registro: string[] = [];
    const { quem, opcoes } = condutorDaMaquinaSimulado(m.a, m.arco, TRABALHOS, registro);
    const r = passoConduzido(m.a.carregado, m.arco, quem, opcoes);
    assert.equal(r.acao, 'despachou', JSON.stringify(r));
    assert.equal(r.maquina?.maquina, 'maquina-a');
    assert.equal(registro.length, 1);
  } finally { m.limpar(); }
});

test('LM2: o vigia sem condutor usa a mesma porta da máquina', { skip: semKernel }, () => {
  const m = cenario('noctum-lm2');
  try {
    const registro: string[] = [];
    const apoio = condutorDaMaquinaSimulado(m.a, m.arco, TRABALHOS, registro);
    const r = vigiarArco(m.a.carregado, m.arco, { ...apoio.opcoes, instancia: 'vigia-lm2-SIMULADO' });
    assert.equal(r.acao, 'tique', JSON.stringify(r));
    assert.equal(r.acao === 'tique' && r.condutor, 'assumido');
    assert.equal(r.acao === 'tique' && r.passo?.maquina?.maquina, 'maquina-a');
  } finally { m.limpar(); }
});

test('LM3: a máquina sem remoto espera a cadência, sem transformar a recusa em despacho', { skip: semKernel }, () => {
  const m = cenario('noctum-lm3');
  const isolado = fs.mkdtempSync(path.join(os.tmpdir(), 'noctum-lm3-'));
  try {
    assert.ok(exec('git', ['remote', 'set-url', 'origin', path.join(isolado, 'ausente.git')], m.a.dir).ok);
    const { quem, opcoes } = condutorDaMaquinaSimulado(m.a, m.arco, TRABALHOS, []);
    const r = passoConduzido(m.a.carregado, m.arco, quem, opcoes);
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.coordenacao.sem-remoto' && !!r.ate, JSON.stringify(r));
  } finally { fs.rmSync(isolado, { recursive: true, force: true }); m.limpar(); }
});

test('LM4: o v2 preserva o passo local e não ganha relatório de máquina', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-lm4');
  try {
    abrirArco(p.dir, 'arco-lm4', { trabalhos: [TRABALHOS[0]], contas: [{ conta: 'perfil-a', sessoes: 1 }] });
    const quem: Instancia = instancia('condutor', 4);
    const vigia = instancia('vigia', 4);
    gravarNaSupervisao(p.carregado, 'arco-lm4', [{ tipo: 'conducao_assumida', geracao: 1, quem, prova: 'SIMULADO' },
      { tipo: 'tique_iniciado', quem: vigia }, { tipo: 'tique_concluido', quem: vigia, resumo: 'SIMULADO' }]);
    const r = passoConduzido(p.carregado, 'arco-lm4', quem, opcoesSimuladas(p.dir, ['RM-901']));
    assert.equal(r.acao, 'despachou', JSON.stringify(r));
    assert.equal(r.maquina, undefined);
  } finally { p.limpar(); }
});

test('LM5: o trabalho isolado pela supervisão não sai no v3', { skip: semKernel }, () => {
  const m = cenario('noctum-lm5');
  try {
    const registro: string[] = [];
    const { quem, opcoes } = condutorDaMaquinaSimulado(m.a, m.arco, TRABALHOS, registro);
    gravarNaSupervisao(m.a.carregado, m.arco, [{ tipo: 'isolado', trabalho: 'a', thread: null, motivo: 'erro-repetido', detalhe: 'SIMULADO' }]);
    const r = passoConduzido(m.a.carregado, m.arco, quem, opcoes);
    assert.equal(r.acao === 'despachou' ? r.trabalho : null, 'c', JSON.stringify(r));
  } finally { m.limpar(); }
});

test('LM6: duas ordens aceitas produzem no máximo um despacho por passo', { skip: semKernel }, () => {
  const m = cenario('noctum-lm6');
  try {
    const registro: string[] = [];
    const { quem, opcoes } = condutorDaMaquinaSimulado(m.a, m.arco, TRABALHOS, registro);
    const r1 = passoConduzido(m.a.carregado, m.arco, quem, opcoes);
    assert.equal(registro.length, r1.acao === 'despachou' ? 1 : 0);
    const r2 = passoConduzido(m.a.carregado, m.arco, quem, opcoes);
    assert.equal(registro.length <= 2, true);
    assert.notEqual(r1.acao === 'despachou' && r2.acao === 'despachou' ? r1.trabalho : null,
      r1.acao === 'despachou' && r2.acao === 'despachou' ? r2.trabalho : null);
  } finally { m.limpar(); }
});

test('LM7: máquina encerrada recusa ordem emitida, encerra a aceita sem sessão e não bate', { skip: semKernel }, () => {
  const m = cenario('noctum-lm7');
  try {
    assumirAutoridade(m.a.carregado, m.arco, { maquina: m.a.nome });
    bater(m.b.carregado, m.arco, { maquina: m.b.nome });
    const aceita = emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: m.b.nome }, { maquina: m.a.nome });
    responderOrdem(m.b.carregado, m.arco, aceita, 'aceita', 'SIMULADO', { maquina: m.b.nome });
    const emitida = emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: m.b.nome }, { maquina: m.a.nome });
    const antes = lerCoordenacao(m.a.carregado, m.arco, { maquina: m.a.nome }).batidas.get(m.b.nome);
    encerrarArco(m.b.dir, m.arco, { motivo: 'hora', detalhe: 'SIMULADO: fim local' });
    passoDaMaquina(m.b.carregado, m.arco, { maquina: m.b.nome, consultarSessoes: () => ({ sessoes: [], fontes: [], contas: [] }) });
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: m.a.nome });
    assert.equal(estado.ordens.get(aceita)!.estado, 'encerrada');
    assert.equal(estado.ordens.get(emitida)!.estado, 'recusada');
    assert.equal(estado.batidas.get(m.b.nome), antes, 'o passo terminal não grava batida');
  } finally { m.limpar(); }
});

test('LM8: autoridade encerrada cede a vez e a outra máquina assume', { skip: semKernel }, () => {
  const m = cenario('noctum-lm8');
  try {
    assumirAutoridade(m.b.carregado, m.arco, { maquina: m.b.nome });
    bater(m.a.carregado, m.arco, { maquina: m.a.nome });
    encerrarArco(m.b.dir, m.arco, { motivo: 'hora', detalhe: 'SIMULADO: fim local' });
    const cedeu = retomadaNaRede(m.b.carregado, m.arco, { maquina: m.b.nome });
    assert.match(cedeu.acoes.join(','), /autoridade-cedida:maquina-a/);
    const assumiu = retomadaNaRede(m.a.carregado, m.arco, { maquina: m.a.nome });
    assert.match(assumiu.acoes.join(','), /autoridade-assumida-por-cessao/);
  } finally { m.limpar(); }
});

test('LM9: tique terminal não fica quieto enquanto há obrigação desta máquina na rede', { skip: semKernel }, () => {
  const m = cenario('noctum-lm9');
  try {
    encerrarArco(m.a.dir, m.arco, { motivo: 'hora', detalhe: 'SIMULADO: fim local' });
    const projecao: RedeDoArco = { contrato: CONTRATO_REDE_DO_ARCO, arco: m.arco, multimaquina: true, maquina: m.a.nome,
      envelopeSha256: m.hash, lidaEm: new Date().toISOString(), autoridade: null, revogada: null, maquinas: [], trabalhos: [],
      consumo: { arco: 0, porConta: {}, porRuntime: {} }, obrigacoes: { ordens: ['O-a-1'], vagas: [], vezes: [] }, lacuna: null };
    let tiques = 0;
    tiqueDoArco(m.a.carregado, m.arco, { maquina: m.a.nome, projecaoDaRede: projecao,
      vigia: () => { tiques += 1; return { acao: 'sem-arco', detalhe: 'SIMULADO' }; },
      enviar: () => ({ estado: 'confirmado', referencia: null }) });
    assert.equal(tiques, 1);
  } finally { m.limpar(); }
});
