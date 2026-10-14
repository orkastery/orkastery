/**
 * RM-058 (N3): a vez de integrar por destino, entre máquinas. Dois clones de um remoto bare de fixture integram branches
 * de trabalho SIMULADAS na `main` dele; nada toca remoto de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { exec } from '../src/util';
import { prepararIngressoSimulado, revogarArco } from './noctum-apoio';
import {
  atualizarBranch, branchDeTrabalho, duasMaquinas, DuasMaquinas, integradorPorAvanco, MaquinaDeTeste, maisUmCommit, provasSimuladas,
} from './noctum-maquinas-apoio';
import { RecusaDoArco } from '../src/noctum-envelope';
import * as transporte from '../src/noctum-transporte';
import {
  assumirAutoridade, bater, BATIDA_VENCIDA_MS, cancelarOrdem, chaveDoDestino, derivarCoordenacao, emitirOrdem, gravarNaCoordenacao, lerCoordenacao,
  planejarReconciliacao, registrosDosAbandonos, responderOrdem, revogarNaRede, situacaoDoTrabalho,
} from '../src/noctum-coordenacao';
import * as integracaoDoModulo from '../src/noctum-integracao';
import { integrarComVez, reconciliarIntegracao } from '../src/noctum-integracao';
import type { Integrador } from '../src/noctum-integracao';
import type { CandidatoDeIntegracao } from '../src/noctum-coordenacao';
import type { ManifestoCarregado } from '../src/manifest';
import { candidatoDaEntrega, integradorDaEntrega } from '../src/noctum-entrega';

prepararIngressoSimulado();

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 1, dependeDe: [], pedido: 'Fatia B SIMULADA.' },
];
const DESTINO = { repositorio: 'exemplo/produto', base: 'main' };

function cenario(nome: string, permissoes?: string[]): DuasMaquinas {
  const m = duasMaquinas(nome, { trabalhos: TRABALHOS.map(t => ({ ...t })), contas: [{ conta: 'perfil-a', sessoes: 2 }], permissoes });
  assumirAutoridade(m.a.carregado, m.arco, op(m.a));
  bater(m.b.carregado, m.arco, op(m.b));
  emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a));
  emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-b' }, op(m.a));
  responderOrdem(m.a.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.a));
  responderOrdem(m.b.carregado, m.arco, 'O-b-1', 'aceita', 'SIMULADO', op(m.b));
  return m;
}

const op = (m: MaquinaDeTeste, quando?: string) => ({ maquina: m.nome, ...(quando ? { quando } : {}) });
const mainNoRemoto = (m: DuasMaquinas) => exec('git', ['ls-remote', m.remoto, 'refs/heads/main'], m.a.dir).stdout.split(/\s+/)[0];

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

function candidato(c: { branch: string; fonte: string; base: string }, rotulo: string) {
  return { ...c, provas: provasSimuladas(rotulo) };
}

test('I1: um integrador por destino; quem chega com a vez ocupada espera', () => {
  const m = cenario('noctum-i1');
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    let doOutro = '';
    const feito = integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, (c) => {
      // Com a vez da A em curso, a B tenta integrar o dela no mesmo destino.
      doOutro = recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, integradorPorAvanco(m.b.dir), op(m.b)),
        'noctum.integracao.ocupada');
      return integradorPorAvanco(m.a.dir)(c);
    }, op(m.a));
    assert.match(doOutro, /está com a máquina maquina-a \(trabalho a\); espere ela soltar e repita as provas/);
    assert.equal(feito.merge, ca.fonte);
    assert.equal(mainNoRemoto(m), ca.fonte, 'a base do remoto foi para o merge da A');
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'entregue');
    assert.equal(estado.entregas.get('a')!.merge, ca.fonte);
    assert.deepEqual([...estado.vezes.values()].flat().map(v => [v.maquina, v.fim?.desfecho]), [['maquina-a', 'entregue']]);
  } finally { m.limpar(); }
});

test('I2: perdeu a corrida, a base mudou: o candidato é invalidado e as provas se repetem sobre a base nova', () => {
  const m = cenario('noctum-i2');
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a));
    const antes = mainNoRemoto(m);
    assert.match(recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, integradorPorAvanco(m.b.dir), op(m.b)),
      'noctum.integracao.base-mudou'), /o candidato foi invalidado; atualize, resolva os conflitos e repita as provas/);
    assert.equal(mainNoRemoto(m), antes, 'nada foi integrado com a prova velha');
    const vezes = [...lerCoordenacao(m.b.carregado, m.arco, op(m.b)).vezes.values()].flat();
    assert.deepEqual(vezes.map(v => [v.maquina, v.fim?.desfecho]), [['maquina-a', 'entregue'], ['maquina-b', 'invalidado']]);
    assert.match(vezes[1].fim!.motivo, /^base-mudou: /);
    // Atualizada sobre a base nova e com as provas refeitas, a B integra.
    const novo = candidato(atualizarBranch(m.b.dir, 'trabalho-b'), 'b-depois-da-base-nova');
    assert.equal(novo.base, antes);
    const feito = integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: novo }, integradorPorAvanco(m.b.dir), op(m.b));
    assert.equal(mainNoRemoto(m), feito.merge);
    assert.equal(exec('git', ['merge-base', '--is-ancestor', ca.fonte, feito.merge], m.b.dir).ok, true, 'a entrega da A continua na base');
  } finally { m.limpar(); }
});

test('I3: a fonte mudou depois das provas: o candidato é invalidado', () => {
  const m = cenario('noctum-i3');
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    maisUmCommit(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO, com mais uma mudança depois das provas\n');
    assert.match(recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a)),
      'noctum.integracao.fonte-mudou'), /as provas se repetem no SHA novo/);
    assert.equal(mainNoRemoto(m), ca.base);
    assert.equal([...lerCoordenacao(m.a.carregado, m.arco, op(m.a)).vezes.values()].flat()[0].fim!.desfecho, 'invalidado');
  } finally { m.limpar(); }
});

test('I4: um registro de entrega por trabalho: a segunda tentativa não integra', () => {
  const m = cenario('noctum-i4');
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a));
    let chamou = false;
    assert.match(recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, () => { chamou = true; return { merge: ca.fonte }; },
      op(m.a)), 'noctum.integracao.ja-entregue'), /já foi entregue neste arco/);
    assert.equal(chamou, false);
  } finally { m.limpar(); }
});

test('I5: o merge chegou à base e a máquina caiu antes do registro: a reconciliação registra sem integrar de novo', () => {
  const m = cenario('noctum-i5');
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    assert.match(recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, (c) => {
      integradorPorAvanco(m.a.dir)(c);
      throw new Error('SIMULADO: o processo caiu logo depois do push');
    }, op(m.a)), 'noctum.integracao.nao-provada'), /a vez fica até a reconciliação/);
    const merge = mainNoRemoto(m);
    assert.equal(merge, ca.fonte, 'o merge chegou');
    let estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.equal(estado.entregas.size, 0);
    assert.equal([...estado.vezes.values()].flat()[0].fim, null, 'a vez ficou com a A');
    // A B não integra no mesmo destino enquanto a vez da A está de pé.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, integradorPorAvanco(m.b.dir), op(m.b)),
      'noctum.integracao.ocupada');
    const r = reconciliarIntegracao(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual(r.registradas, [{ trabalho: 'a', merge }]);
    assert.equal(mainNoRemoto(m), merge, 'nada foi integrado de novo');
    estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'entregue');
    assert.equal(estado.entregas.get('a')!.merge, merge);
    assert.deepEqual(reconciliarIntegracao(m.a.carregado, m.arco, op(m.a)).registradas, [], 'a segunda reconciliação não registra de novo');
  } finally { m.limpar(); }
});

test('I6: a ordem cancelada depois da vez tomada desiste antes do merge; cancelada antes, nem toma a vez', () => {
  const m = cenario('noctum-i6');
  const original = transporte.cabecasNoRemoto;
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    // O cancelamento da autoridade chega entre a vez tomada e a conferência logo antes do merge.
    (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = (...args) => {
      cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO: cancelada no meio', op(m.a));
      (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original;
      return original(...args);
    };
    let chamou = false;
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, () => { chamou = true; return { merge: ca.fonte }; },
      op(m.a)), 'noctum.coordenacao.ordem-vencida');
    assert.equal(chamou, false, 'o efeito não aconteceu');
    assert.equal(mainNoRemoto(m), ca.base);
    assert.equal([...lerCoordenacao(m.a.carregado, m.arco, op(m.a)).vezes.values()].flat()[0].fim!.desfecho, 'desistiu');
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    cancelarOrdem(m.a.carregado, m.arco, 'O-b-1', 'SIMULADO: antes', op(m.a));
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, integradorPorAvanco(m.b.dir), op(m.b)),
      'noctum.coordenacao.ordem-vencida');
    assert.equal([...lerCoordenacao(m.a.carregado, m.arco, op(m.a)).vezes.values()].flat().length, 1, 'a B nem tomou a vez');
  } finally { (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original; m.limpar(); }
});

test('I7: destino sem merge no envelope não integra; o push que não se prova segura a vez até a reconciliação soltar', () => {
  const m = cenario('noctum-i7', ['push', 'pr']);
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a)),
      'noctum.efeito.fora-do-destino');
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: { ...DESTINO, base: 'outra' }, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a)),
      'noctum.efeito.fora-do-destino');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i7b');
  try {
    const ca = candidato(branchDeTrabalho(m2.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    // O integrador diz que fez, mas a base não foi a lugar nenhum.
    recusa(() => integrarComVez(m2.a.carregado, m2.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, () => ({ merge: ca.fonte }), op(m2.a)),
      'noctum.integracao.nao-provada');
    assert.equal([...lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)).vezes.values()].flat()[0].fim, null);
    const r = reconciliarIntegracao(m2.a.carregado, m2.arco, op(m2.a));
    assert.deepEqual([r.registradas, r.soltas.length], [[], 1]);
    const estado = lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a));
    assert.equal([...estado.vezes.values()].flat()[0].fim!.desfecho, 'desistiu');
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'em-execucao', 'nada foi entregue');
  } finally { m2.limpar(); }
});

test('I8: a revogação que chega entre a vez e o merge segura o efeito pela N1; a revogação no ramo nem deixa tomar a vez', () => {
  const m = cenario('noctum-i8');
  const original = transporte.cabecasNoRemoto;
  try {
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    // O dono revoga o arco na A entre a vez tomada e a conferência logo antes do merge.
    (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = (...args) => {
      revogarArco(m.a.dir, m.arco);
      (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original;
      return original(...args);
    };
    let chamou = false;
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, () => { chamou = true; return { merge: ca.fonte }; },
      op(m.a)), 'noctum.efeito.revogado');
    assert.equal(chamou, false, 'o efeito não aconteceu');
    assert.equal(mainNoRemoto(m), ca.base);
    assert.equal([...lerCoordenacao(m.b.carregado, m.arco, op(m.b)).vezes.values()].flat()[0].fim!.desfecho, 'desistiu');
    // S4 da revisão: com o arco revogado aqui, a A nem toma a vez de novo; a conferência da N1 vem antes.
    const vezesAntes = [...lerCoordenacao(m.a.carregado, m.arco, op(m.a)).vezes.values()].flat().length;
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a)),
      'noctum.efeito.revogado');
    assert.equal([...lerCoordenacao(m.a.carregado, m.arco, op(m.a)).vezes.values()].flat().length, vezesAntes);
    // A revogação vai ao ramo: a B, com o arco vigente aqui, não toma a vez.
    revogarNaRede(m.a.carregado, m.arco, op(m.a));
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, integradorPorAvanco(m.b.dir), op(m.b)),
      'noctum.coordenacao.revogada');
    assert.equal([...lerCoordenacao(m.b.carregado, m.arco, op(m.b)).vezes.values()].flat().length, 1, 'a B nem tomou a vez');
  } finally { (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original; m.limpar(); }
});

test('I9: a vez de quem não dá sinal é abandonada pela autoridade; o destino volta a andar, e a volta registra o merge que chegou', () => {
  const m = cenario('noctum-i9');
  try {
    // A B toma a vez, o merge chega à base e ela cai antes de registrar.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      integradorPorAvanco(m.b.dir)(c);
      throw new Error('SIMULADO: a B caiu logo depois do push');
    }, op(m.b)), 'noctum.integracao.nao-provada');
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a)),
      'noctum.integracao.ocupada');
    // Dezesseis minutos sem sinal da B: a autoridade abandona a vez, e o trabalho dela não muda de máquina.
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    const abandono = gravarNaCoordenacao(m.a.carregado, m.arco, op(m.a, tarde), (l) => {
      const novos = registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde);
      return { novos, resultado: novos.length };
    }).resultado;
    assert.equal(abandono, 1);
    let estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a, tarde));
    assert.equal(situacaoDoTrabalho(estado, 'b')!.estado, 'em-execucao');
    // O destino volta a andar: a A integra sobre a base nova, que já tem o merge da B.
    const feito = integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a, tarde));
    assert.equal(mainNoRemoto(m), feito.merge);
    // A B volta: a reconciliação registra a entrega do merge que chegou, sem integrar de novo e sem regravar o fim da vez.
    const r = reconciliarIntegracao(m.b.carregado, m.arco, op(m.b, tarde));
    assert.deepEqual(r.registradas.map(x => x.trabalho), ['b']);
    assert.equal(mainNoRemoto(m), feito.merge, 'nada foi integrado de novo');
    estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a, tarde));
    assert.deepEqual([situacaoDoTrabalho(estado, 'a')!.estado, situacaoDoTrabalho(estado, 'b')!.estado], ['entregue', 'entregue']);
    assert.deepEqual([...estado.vezes.values()].flat().map(v => [v.maquina, v.fim?.desfecho, v.fim?.por]),
      [['maquina-b', 'abandonada', 'maquina-a'], ['maquina-a', 'entregue', 'maquina-a']]);
    assert.deepEqual(reconciliarIntegracao(m.b.carregado, m.arco, op(m.b, tarde)).registradas, [], 'a segunda reconciliação não registra de novo');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i9b');
  try {
    // A vez abandonada sem merge na base: conferida a base, a ordem dela pode terminar.
    const cb = candidato(branchDeTrabalho(m2.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, () => {
      throw new Error('SIMULADO: a B caiu antes do push');
    }, op(m2.b)), 'noctum.integracao.nao-provada');
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    gravarNaCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde), (l) => ({ novos: registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde), resultado: null }));
    const r = reconciliarIntegracao(m2.b.carregado, m2.arco, op(m2.b, tarde));
    assert.deepEqual([r.registradas, r.abandonadasConferidas.length], [[], 1]);
  } finally { m2.limpar(); }
});

test('I10: o destino e o candidato de quem chama vão ao ramo só com os campos do contrato; a repetição depois de um merge incerto registra a entrega', () => {
  const m = cenario('noctum-i10');
  try {
    // B1 da rodada 2: a N5 passa o destino do envelope (com as permissões) e um candidato com campo a mais.
    const doEnvelope = { repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr', 'merge'] };
    const ca = { ...candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a'), rotulo: 'SIMULADO' };
    const feito = integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: doEnvelope, candidato: ca }, integradorPorAvanco(m.a.dir), op(m.a));
    assert.equal(feito.merge, ca.fonte);
    for (const quem of [m.a, m.b]) {
      const estado = lerCoordenacao(quem.carregado, m.arco, op(quem));
      assert.deepEqual(estado.entregas.get('a')!.destino, DESTINO);
      assert.deepEqual(Object.keys([...estado.vezes.values()].flat()[0].candidato).sort(), ['base', 'branch', 'fonte', 'provas']);
    }
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i10b');
  try {
    // A1 da rodada 2: o push do merge chega e o integrador estoura o prazo; a repetição do mesmo pedido acha a fonte na base.
    const cb = candidato(branchDeTrabalho(m2.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    let merges = 0;
    const integrar = (c: Parameters<ReturnType<typeof integradorPorAvanco>>[0]) => { merges++; return integradorPorAvanco(m2.b.dir)(c); };
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => { integrar(c); throw new Error('SIMULADO: prazo estourado'); },
      op(m2.b)), 'noctum.integracao.nao-provada');
    assert.equal(mainNoRemoto(m2), cb.fonte, 'o merge chegou');
    const feito = integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, integrar, op(m2.b));
    assert.deepEqual([feito.trabalho, feito.vez, feito.merge, merges], ['b', 1, cb.fonte, 1], 'registrou sem integrar de novo');
    const estado = lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a));
    assert.equal(situacaoDoTrabalho(estado, 'b')!.estado, 'entregue');
    assert.deepEqual([...estado.vezes.values()].flat().map(v => [v.n, v.fim?.desfecho]), [[1, 'entregue']]);
  } finally { m2.limpar(); }
});

/** O integrador de uma forja: o merge da fonte sobre a base de agora, sem a cerca da base provada (fora do contrato). */
function forja(dir: string) {
  return ({ remoto, destino, candidato: c }: { remoto: string; destino: { base: string }; candidato: { fonte: string } }) => {
    exec('git', ['fetch', '-q', remoto, `+refs/heads/${destino.base}:refs/remotes/origin/${destino.base}`], dir);
    exec('git', ['checkout', '-q', '-B', 'merge-da-forja', `refs/remotes/origin/${destino.base}`], dir);
    const r = exec('git', ['merge', '-q', '--no-ff', '--no-edit', c.fonte], dir);
    if (!r.ok) throw new Error(`merge falhou: ${r.stderr}`);
    const merge = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    const p = exec('git', ['push', '-q', remoto, `${merge}:refs/heads/${destino.base}`], dir);
    exec('git', ['checkout', '-q', 'main'], dir);
    if (!p.ok) throw new Error(`push recusado: ${p.stderr}`);
    return { merge };
  };
}

/** O integrador do contrato: o merge da fonte sobre a base provada, como primeiro pai, e push sem força. */
function mergeSobreAProvada(dir: string) {
  return ({ remoto, destino, candidato: c }: { remoto: string; destino: { base: string }; candidato: { base: string; fonte: string } }) => {
    exec('git', ['checkout', '-q', '--detach', c.base], dir);
    const r = exec('git', ['merge', '-q', '--no-ff', '--no-edit', c.fonte], dir);
    if (!r.ok) throw new Error(`merge falhou: ${r.stderr}`);
    const merge = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    const p = exec('git', ['push', '-q', remoto, `${merge}:refs/heads/${destino.base}`], dir);
    exec('git', ['checkout', '-q', 'main'], dir);
    if (!p.ok) throw new Error(`push recusado: ${p.stderr}`);
    return { merge };
  };
}

test('I11: a vez abandonada de uma máquina viva não vira entrega fora da base provada; a vez que muda de mão e a revogação na rede seguram o merge', () => {
  const m = cenario('noctum-i11');
  try {
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    let daA = '';
    // B-R2A-1 da rodada 2: a B está viva dentro do efeito (uma CI longa na forja); dezesseis minutos depois, a autoridade
    // abandona a vez dela e integra pelo contrato. A forja da B faz o merge sobre a base de agora.
    const motivo = recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      gravarNaCoordenacao(m.a.carregado, m.arco, op(m.a, tarde), (l) => ({ novos: registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde), resultado: null }));
      daA = integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, mergeSobreAProvada(m.a.dir), op(m.a, tarde)).merge;
      return forja(m.b.dir)(c);
    }, op(m.b)), 'noctum.integracao.base-nao-provada');
    assert.match(motivo, /chegou à base main por um merge fora da base provada/);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a, tarde));
    assert.deepEqual([...estado.entregas.keys()], ['a'], 'o merge da B fora da base provada não virou entrega');
    assert.equal(estado.entregas.get('a')!.merge, daA, 'a entrega da A leva o merge dela, provado pelo primeiro pai');
    assert.notEqual(daA, ca.fonte, 'a A integrou por merge, não por avanço');
    assert.deepEqual([...estado.vezes.values()].flat().map(v => [v.n, v.maquina, v.fim?.desfecho]), [[1, 'maquina-b', 'abandonada'], [2, 'maquina-a', 'entregue']]);
    assert.equal(situacaoDoTrabalho(estado, 'b')!.estado, 'em-execucao', 'o trabalho da B não fica livre para outra máquina');
    // Na volta, a reconciliação da B acha a fonte fora da base provada: nada vira entrega, e a ordem cancelada espera a inspeção.
    const rec = reconciliarIntegracao(m.b.carregado, m.arco, op(m.b, tarde));
    assert.deepEqual([rec.registradas, rec.semProva, rec.abandonadasConferidas], [[], [`${chaveDoDestino(DESTINO)}/1`], []]);
    cancelarOrdem(m.a.carregado, m.arco, 'O-b-1', 'SIMULADO: inspeção', op(m.a, tarde));
    const plano = planejarReconciliacao(lerCoordenacao(m.b.carregado, m.arco, op(m.b, tarde)), 'maquina-b', { arcoVigente: true, sessoesVivas: new Set(),
      threads: new Map(), despachos: new Map(), vezesConferidas: new Set(), vezesSemProva: new Set(rec.semProva) });
    assert.deepEqual(plano.encerradas, []);
    assert.match(plano.aguardando.find(x => x.ordem === 'O-b-1')!.porque, /fora da base provada, e o trabalho espera a inspeção/);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i11b');
  const original = transporte.cabecasNoRemoto;
  try {
    const cb = candidato(branchDeTrabalho(m2.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    const ca = candidato(branchDeTrabalho(m2.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    // A vez muda de mão entre a tomada e o merge: a autoridade abandona a da B e toma a seguinte para a A; a base não muda.
    (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = (...args) => {
      (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original;
      gravarNaCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde), (l) => ({ novos: [...registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde),
        { tipo: 'vez', chave: chaveDoDestino(DESTINO), n: 2, destino: { ...DESTINO }, ordem: 'O-a-1', trabalho: 'a', candidato: { ...ca } }], resultado: null }));
      return original(...args);
    };
    let chamou = false;
    assert.match(recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, () => { chamou = true; return { merge: cb.fonte }; },
      op(m2.b)), 'noctum.integracao.ocupada'), /a vez de integrar mudou de mão antes do merge/);
    assert.equal(chamou, false, 'o efeito não aconteceu');
    assert.equal(mainNoRemoto(m2), cb.base);
    // A revogação gravada no ramo por outra máquina entre a vez e o merge também segura o efeito.
    const cb2 = { ...cb, provas: provasSimuladas('b2') };
    (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = (...args) => {
      (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original;
      revogarArco(m2.a.dir, m2.arco);
      revogarNaRede(m2.a.carregado, m2.arco, op(m2.a, tarde));
      return original(...args);
    };
    gravarNaCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde), (l) => {
      const v = [...derivarCoordenacao(l).vezes.values()].flat().find(x => x.n === 2)!;
      return { novos: v.fim ? [] : [{ tipo: 'vez-fim', chave: v.chave, n: 2, desfecho: 'desistiu', motivo: 'SIMULADO', merge: null }], resultado: null };
    });
    assert.match(recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb2 }, () => { chamou = true; return { merge: cb.fonte }; },
      op(m2.b, tarde)), 'noctum.coordenacao.revogada'), /revogado na máquina maquina-a/);
    assert.equal(chamou, false, 'o efeito não aconteceu');
    assert.equal(mainNoRemoto(m2), cb.base);
  } finally { (transporte as { cabecasNoRemoto: typeof original }).cabecasNoRemoto = original; m2.limpar(); }
});

test('I12: a reconciliação grava o commit do merge provado, não a ponta da base; o avanço rápido que outro esconde espera a inspeção', () => {
  const m = cenario('noctum-i12');
  try {
    // S-R2A-4 da rodada 2: o merge da B sobre a base provada chega e ela cai; depois, um commit de fora entra na main.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    let daB = '';
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      daB = mergeSobreAProvada(m.b.dir)(c).merge;
      throw new Error('SIMULADO: a B caiu logo depois do push');
    }, op(m.b)), 'noctum.integracao.nao-provada');
    const deFora = branchDeTrabalho(m.a.dir, 'hotfix', 'h.txt', 'H SIMULADO\n');
    assert.ok(exec('git', ['push', '-q', 'origin', `${deFora.fonte}:refs/heads/main`], m.a.dir).ok);
    assert.equal(mainNoRemoto(m), deFora.fonte);
    const r = reconciliarIntegracao(m.b.carregado, m.arco, op(m.b));
    assert.deepEqual(r.registradas, [{ trabalho: 'b', merge: daB }]);
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).entregas.get('b')!.merge, daB, 'o merge da entrega é o da B, não a ponta da base');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i12b');
  try {
    // Limite dito: a B avança a base até a fonte dela e cai antes de registrar; a vez é abandonada, e a A avança a base até
    // a branch dela, que mesclou a main nova. A linha de primeiro pai da base passa pela branch da A, e a fonte da B, que
    // esteve na ponta, já não se prova: nada vira entrega nem é refeito, e o trabalho da B espera a inspeção.
    branchDeTrabalho(m2.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n');
    const cb = candidato(branchDeTrabalho(m2.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      integradorPorAvanco(m2.b.dir)(c);
      throw new Error('SIMULADO: a B caiu logo depois do push');
    }, op(m2.b)), 'noctum.integracao.nao-provada');
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    gravarNaCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde), (l) => ({ novos: registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde), resultado: null }));
    const ca = candidato(atualizarBranch(m2.a.dir, 'trabalho-a'), 'a');
    assert.equal(ca.base, cb.fonte, 'a A provou sobre a base com a fonte da B');
    assert.equal(integrarComVez(m2.a.carregado, m2.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m2.a.dir), op(m2.a, tarde)).merge, ca.fonte);
    const r = reconciliarIntegracao(m2.b.carregado, m2.arco, op(m2.b, tarde));
    assert.deepEqual([r.registradas, r.semProva], [[], [`${chaveDoDestino(DESTINO)}/1`]]);
    const estado = lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde));
    assert.deepEqual([[...estado.entregas.keys()], situacaoDoTrabalho(estado, 'b')!.estado], [['a'], 'em-execucao']);
    assert.equal(mainNoRemoto(m2), ca.fonte, 'nada foi integrado de novo');
  } finally { m2.limpar(); }
});

test('I13: a forja que leva a fonte à base fora da cerca, com a vez ainda da máquina, termina a vez sem prova; a ordem cancelada espera a inspeção', () => {
  const m = cenario('noctum-i13');
  try {
    // B-R2A-1 da rodada 2, com a vez viva: um commit de fora entra na main durante o efeito, e a forja da B faz o merge sobre
    // a main de agora. Nada vira entrega, a vez termina sem-prova e o destino volta a andar.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    const motivo = recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      const deFora = branchDeTrabalho(m.a.dir, 'hotfix', 'h.txt', 'H SIMULADO\n');
      assert.ok(exec('git', ['push', '-q', 'origin', `${deFora.fonte}:refs/heads/main`], m.a.dir).ok);
      return forja(m.b.dir)(c);
    }, op(m.b)), 'noctum.integracao.base-nao-provada');
    assert.match(motivo, /nada foi registrado como entrega, e o trabalho espera a inspeção do dono, sem ser refeito/);
    let estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual([...estado.vezes.values()].flat().map(v => [v.n, v.fim?.desfecho]), [[1, 'sem-prova']]);
    assert.deepEqual([estado.entregas.size, situacaoDoTrabalho(estado, 'b')!.estado], [0, 'em-execucao']);
    // A autoridade cancela a ordem; sem prova, a reconciliação da B não a encerra, e o trabalho não muda de máquina.
    cancelarOrdem(m.a.carregado, m.arco, 'O-b-1', 'SIMULADO: inspeção', op(m.a));
    const plano = planejarReconciliacao(lerCoordenacao(m.b.carregado, m.arco, op(m.b)), 'maquina-b', { arcoVigente: true, sessoesVivas: new Set(),
      threads: new Map(), despachos: new Map() });
    assert.deepEqual(plano.encerradas, []);
    assert.match(plano.aguardando.find(x => x.ordem === 'O-b-1')!.porque, /fora da base provada, e o trabalho espera a inspeção/);
    estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(situacaoDoTrabalho(estado, 'b')!.estado, 'isolado');
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva');
  } finally { m.limpar(); }
});

/**
 * O integrador fora do contrato que, com o push do merge recusado, mescla a base nova no merge e empurra de novo, sem força.
 * `noMeio` roda entre o merge e o primeiro push: é quando a base anda. Com `mente`, ele devolve o merge sobre a base provada,
 * e não o commit que empurrou por cima.
 */
function mergeEPull(dir: string, noMeio: () => void, mente = false) {
  return ({ remoto, destino, candidato: c }: { remoto: string; destino: { base: string }; candidato: { base: string; fonte: string } }) => {
    exec('git', ['checkout', '-q', '--detach', c.base], dir);
    if (!exec('git', ['merge', '-q', '--no-ff', '--no-edit', c.fonte], dir).ok) throw new Error('merge falhou');
    const merge = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    noMeio();
    const primeiro = exec('git', ['push', '-q', remoto, `${merge}:refs/heads/${destino.base}`], dir);
    exec('git', ['fetch', '-q', remoto, `+refs/heads/${destino.base}:refs/remotes/origin/${destino.base}`], dir);
    if (primeiro.ok || !exec('git', ['merge', '-q', '--no-ff', '--no-edit', `refs/remotes/origin/${destino.base}`], dir).ok) throw new Error('SIMULADO: o roteiro esperava o push recusado');
    const porCima = exec('git', ['rev-parse', 'HEAD'], dir).stdout.trim();
    const segundo = exec('git', ['push', '-q', remoto, `${porCima}:refs/heads/${destino.base}`], dir);
    exec('git', ['checkout', '-q', 'main'], dir);
    if (!segundo.ok) throw new Error('segundo push recusado');
    return { merge: mente ? merge : porCima };
  };
}

test('I14: o merge da base nova por cima de um push recusado não vira entrega, nem pelo commit devolvido, nem pela história, nem na repetição', () => {
  const m = cenario('noctum-i14');
  try {
    // B-R3A-1 da rodada 3, com a vez ainda da B: um commit de fora entra na main durante o efeito, e o integrador mescla e
    // empurra de novo. O commit devolvido não é o merge provado: a vez termina sem prova, e nada vira entrega.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    const motivo = recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, mergeEPull(m.b.dir, () => {
      const deFora = branchDeTrabalho(m.a.dir, 'hotfix', 'h.txt', 'H SIMULADO\n');
      assert.ok(exec('git', ['push', '-q', 'origin', `${deFora.fonte}:refs/heads/main`], m.a.dir).ok);
    }), op(m.b)), 'noctum.integracao.base-nao-provada');
    assert.match(motivo, /o commit que o integrador devolveu não é o merge provado/);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual([estado.entregas.size, [...estado.vezes.values()].flat().map(v => v.fim?.desfecho)], [0, ['sem-prova']]);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i14b');
  try {
    // Com a vez da B abandonada, a A integra no meio pelo contrato; a B mescla a base nova e empurra de novo.
    const cb = candidato(branchDeTrabalho(m2.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    const ca = candidato(branchDeTrabalho(m2.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    let daA = '';
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, mergeEPull(m2.b.dir, () => {
      gravarNaCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde), (l) => ({ novos: registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde), resultado: null }));
      daA = integrarComVez(m2.a.carregado, m2.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, mergeSobreAProvada(m2.a.dir), op(m2.a, tarde)).merge;
    }), op(m2.b)), 'noctum.integracao.base-nao-provada');
    // Na volta, a reconciliação refaz a prova pela história: o merge da B não está na linha da entrega da A.
    const rec = reconciliarIntegracao(m2.b.carregado, m2.arco, op(m2.b, tarde));
    assert.deepEqual([rec.registradas, rec.semProva], [[], [`${chaveDoDestino(DESTINO)}/1`]]);
    // A repetição do pedido toma outra vez e também não se prova, sem integrar de novo.
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, () => assert.fail('não integra de novo'),
      op(m2.b, tarde)), 'noctum.integracao.base-nao-provada');
    const estado = lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a, tarde));
    assert.deepEqual([[...estado.entregas.keys()], estado.entregas.get('a')!.merge], [['a'], daA]);
    assert.deepEqual([...estado.vezes.values()].flat().map(v => [v.n, v.maquina, v.fim?.desfecho]),
      [[1, 'maquina-b', 'abandonada'], [2, 'maquina-a', 'entregue'], [3, 'maquina-b', 'sem-prova']]);
    assert.equal(situacaoDoTrabalho(estado, 'b')!.estado, 'em-execucao');
  } finally { m2.limpar(); }
  const m3 = cenario('noctum-i14c');
  try {
    // O integrador que mente e devolve o merge sobre a base provada: as entregas do destino, relidas depois do efeito, têm a
    // da A, e o merge da B não está na linha dela.
    const cb = candidato(branchDeTrabalho(m3.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    const ca = candidato(branchDeTrabalho(m3.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    recusa(() => integrarComVez(m3.b.carregado, m3.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, mergeEPull(m3.b.dir, () => {
      gravarNaCoordenacao(m3.a.carregado, m3.arco, op(m3.a, tarde), (l) => ({ novos: registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde), resultado: null }));
      integrarComVez(m3.a.carregado, m3.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, mergeSobreAProvada(m3.a.dir), op(m3.a, tarde));
    }, true), op(m3.b)), 'noctum.integracao.base-nao-provada');
    assert.deepEqual([...lerCoordenacao(m3.a.carregado, m3.arco, op(m3.a, tarde)).entregas.keys()], ['a']);
  } finally { m3.limpar(); }
});

test('I15: a repetição que acha a fonte da forja na base não deixa o trabalho ser refeito; o avanço rápido exige a fonte com a base provada', () => {
  const m = cenario('noctum-i15');
  try {
    // A-R3A-1 da rodada 3: a forja leva a fonte à main por cima de um commit de fora e estoura o prazo; a N5 repete o pedido.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      const deFora = branchDeTrabalho(m.a.dir, 'hotfix', 'h.txt', 'H SIMULADO\n');
      assert.ok(exec('git', ['push', '-q', 'origin', `${deFora.fonte}:refs/heads/main`], m.a.dir).ok);
      forja(m.b.dir)(c);
      throw new Error('SIMULADO: a forja estourou o prazo depois do merge');
    }, op(m.b)), 'noctum.integracao.nao-provada');
    let chamou = false;
    recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, () => { chamou = true; return { merge: cb.fonte }; },
      op(m.b)), 'noctum.integracao.base-nao-provada');
    assert.equal(chamou, false, 'a repetição não integra de novo');
    assert.deepEqual([...lerCoordenacao(m.a.carregado, m.arco, op(m.a)).vezes.values()].flat().map(v => v.fim?.desfecho), ['sem-prova']);
    cancelarOrdem(m.a.carregado, m.arco, 'O-b-1', 'SIMULADO: inspeção', op(m.a));
    const plano = planejarReconciliacao(lerCoordenacao(m.b.carregado, m.arco, op(m.b)), 'maquina-b', { arcoVigente: true, sessoesVivas: new Set(),
      threads: new Map(), despachos: new Map() });
    assert.deepEqual(plano.encerradas, []);
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i15b');
  try {
    // S-R3A-3 da rodada 3: a fonte na linha de primeiro pai da main, com a base provada num commit lateral que ela não contém,
    // não se prova: seria uma entrega registrada sem integração nenhuma.
    const lateral = branchDeTrabalho(m2.b.dir, 'lateral', 'l.txt', 'L SIMULADO\n');
    const f = branchDeTrabalho(m2.a.dir, 'hotfix', 'h.txt', 'H SIMULADO\n');
    assert.ok(exec('git', ['push', '-q', 'origin', `${f.fonte}:refs/heads/main`], m2.a.dir).ok);
    let chamou = false;
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO,
      candidato: { branch: 'hotfix', fonte: f.fonte, base: lateral.fonte, provas: provasSimuladas('lateral') } },
    () => { chamou = true; return { merge: f.fonte }; }, op(m2.b)), 'noctum.integracao.base-nao-provada');
    assert.equal(chamou, false);
    assert.equal(lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)).entregas.size, 0);
  } finally { m2.limpar(); }
});

test('I16: o commit devolvido aparado e em minúsculas é o merge; o que não é commit termina a vez com o motivo verdadeiro; a fonte igual à base é o avanço rápido vazio', () => {
  const m = cenario('noctum-i16');
  try {
    // S-R3C-1 da R3-C: o integrador honesto que devolve a saída do git sem aparar, em maiúsculas, entrega o mesmo merge.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    let daB = '';
    const feito = integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      daB = mergeSobreAProvada(m.b.dir)(c).merge;
      return { merge: `${daB.toUpperCase()}\n` };
    }, op(m.b));
    assert.equal(feito.merge, daB);
    // O nome de uma ref não é o commit que chegou: a vez termina sem prova, e o motivo não acusa a fonte de chegar por fora.
    const ca = candidato(branchDeTrabalho(m.a.dir, 'trabalho-a', 'a.txt', 'A SIMULADO\n'), 'a');
    const motivo = recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-a-1', destino: DESTINO, candidato: ca }, (c) => {
      mergeSobreAProvada(m.a.dir)(c);
      return { merge: 'HEAD' };
    }, op(m.a)), 'noctum.integracao.base-nao-provada');
    assert.match(motivo, /o integrador não devolveu um commit que se resolva neste clone/);
    assert.doesNotMatch(motivo, /fora da base provada/);
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.deepEqual([...estado.entregas.keys()], ['b']);
    assert.equal(estado.entregas.get('b')!.merge, daB);
    const vezes = [...estado.vezes.values()].flat();
    assert.deepEqual(vezes.map(v => [v.trabalho, v.fim?.desfecho]), [['b', 'entregue'], ['a', 'sem-prova']]);
    assert.match(vezes[1].fim!.motivo, /não devolveu um commit/);
    assert.doesNotMatch(vezes[1].fim!.motivo, /fora da base provada/);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-i16b');
  try {
    // S-R3C-8 da R3-C: a branch sem commit próprio (a fonte é a base provada) não tem o que integrar; a entrega fica com a
    // base, como a branch já incorporada do `ork ship`, e o motivo não se contradiz.
    const base = mainNoRemoto(m2);
    assert.ok(exec('git', ['push', '-q', 'origin', `${base}:refs/heads/trabalho-b`], m2.b.dir).ok);
    const cb = candidato({ branch: 'trabalho-b', fonte: base, base }, 'b');
    const feito = integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, mergeSobreAProvada(m2.b.dir), op(m2.b));
    assert.equal(feito.merge, base);
    assert.equal(mainNoRemoto(m2), base, 'a base não mudou');
    const estado = lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a));
    assert.deepEqual([estado.entregas.get('b')!.merge, situacaoDoTrabalho(estado, 'b')!.estado], [base, 'entregue']);
    assert.deepEqual([...estado.vezes.values()].flat().map(v => v.fim?.desfecho), ['entregue']);
  } finally { m2.limpar(); }
});

test('I17: a prova lê a história de mais de 1 MiB; com o buffer estourado ela não sabe, e a vez espera a reconciliação', () => {
  const m = cenario('noctum-i17');
  const integracao = integracaoDoModulo as { BUFFER_DA_HISTORIA: number };
  const buffer = integracao.BUFFER_DA_HISTORIA;
  try {
    // S-R3C-5 da R3-C: com o buffer da prova menor que a saída do git, a prova não sabe; o motivo diz isso, e a vez fica.
    const cb = candidato(branchDeTrabalho(m.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    let daB = '';
    integracao.BUFFER_DA_HISTORIA = 16;
    const motivo = recusa(() => integrarComVez(m.b.carregado, m.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      daB = mergeSobreAProvada(m.b.dir)(c).merge;
      return { merge: daB };
    }, op(m.b)), 'noctum.integracao.nao-provada');
    assert.match(motivo, /ou a história dela não se leram \(rede, buffer ou prazo\): a prova não sabe/);
    let estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual([estado.entregas.size, [...estado.vezes.values()].flat().map(v => v.fim)], [0, [null]], 'a vez fica ativa');
    integracao.BUFFER_DA_HISTORIA = buffer;
    assert.deepEqual(reconciliarIntegracao(m.b.carregado, m.arco, op(m.b)).registradas, [{ trabalho: 'b', merge: daB }]);
  } finally { integracao.BUFFER_DA_HISTORIA = buffer; m.limpar(); }
  const m2 = cenario('noctum-i17b');
  try {
    // S-R3A-2 da rodada 3: o merge da B chega e ela cai; depois, 12 000 merges de uma branch lateral entram em cima dele, e a
    // saída do git da prova passa de 1 MiB, o buffer padrão do spawnSync. A reconciliação prova o merge pela história inteira.
    const cb = candidato(branchDeTrabalho(m2.b.dir, 'trabalho-b', 'b.txt', 'B SIMULADO\n'), 'b');
    let daB = '';
    recusa(() => integrarComVez(m2.b.carregado, m2.arco, { ordem: 'O-b-1', destino: DESTINO, candidato: cb }, (c) => {
      daB = mergeSobreAProvada(m2.b.dir)(c).merge;
      throw new Error('SIMULADO: a B caiu logo depois do push');
    }, op(m2.b)), 'noctum.integracao.nao-provada');
    const linhas = ['commit refs/heads/lateral', 'committer SIMULADO <simulado@exemplo.invalid> 1700000000 +0000', 'data 1', 'S', `from ${cb.base}`, ''];
    for (let i = 1; i <= 12000; i++) {
      linhas.push('commit refs/heads/longa', `committer SIMULADO <simulado@exemplo.invalid> ${1700000000 + i} +0000`, `data ${String(i).length}`, String(i));
      if (i === 1) linhas.push(`from ${daB}`);
      linhas.push('merge refs/heads/lateral', '');
    }
    assert.equal(spawnSync('git', ['fast-import', '--quiet'], { cwd: m2.b.dir, input: linhas.join('\n') + '\n', encoding: 'utf8' }).status, 0);
    assert.ok(exec('git', ['push', '-q', 'origin', 'refs/heads/longa:refs/heads/main'], m2.b.dir).ok);
    const saida = spawnSync('git', ['rev-list', '--ancestry-path', '--parents', `${cb.base}..refs/heads/longa`],
      { cwd: m2.b.dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.ok(saida.status === 0 && saida.stdout.length > 1024 * 1024, `a saída do git da prova tem ${saida.stdout.length} bytes`);
    assert.deepEqual(reconciliarIntegracao(m2.b.carregado, m2.arco, op(m2.b)).registradas, [{ trabalho: 'b', merge: daB }]);
    assert.equal(lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)).entregas.get('b')!.merge, daB);
  } finally { m2.limpar(); }
});

test('I18: a interface da N5 tem a forma que integrarComVez recebe: o integrador e o candidato só com os quatro campos do contrato', () => {
  // Merge com a N5: o tsc confere aqui que integradorDaEntrega dá um Integrador e que candidatoDaEntrega dá o candidato do
  // contrato; se a forma de um dos lados mudar, o build dos testes falha antes de a vez entre máquinas ser ligada à entrega.
  const integrador: (carregado: ManifestoCarregado, arco: string, thread: string) => Integrador = integradorDaEntrega;
  const candidato: (provas: Parameters<typeof candidatoDaEntrega>[0]) => CandidatoDeIntegracao | null = candidatoDaEntrega;
  assert.equal(typeof integrador, 'function');
  const provas = { ok: true, branch: 'ork/simulada', fonte: 'f'.repeat(40), base: { sha: 'b'.repeat(40) }, sha256: 'c'.repeat(64), extra: 'SIMULADO' };
  assert.deepEqual(candidato(provas as unknown as Parameters<typeof candidatoDaEntrega>[0]),
    { branch: 'ork/simulada', fonte: 'f'.repeat(40), base: 'b'.repeat(40), provas: 'c'.repeat(64) });
  assert.equal(candidato({ ...provas, ok: false } as unknown as Parameters<typeof candidatoDaEntrega>[0]), null, 'sem as provas, nada vai à vez');
});
