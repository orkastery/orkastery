/**
 * RM-058 (N3): a vez de integrar por destino, entre máquinas. Dois clones de um remoto bare de fixture integram branches
 * de trabalho SIMULADAS na `main` dele; nada toca remoto de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { exec } from '../src/util';
import { prepararIngressoSimulado, revogarArco } from './noctum-apoio';
import {
  atualizarBranch, branchDeTrabalho, duasMaquinas, DuasMaquinas, integradorPorAvanco, MaquinaDeTeste, maisUmCommit, provasSimuladas,
} from './noctum-maquinas-apoio';
import { RecusaDoArco } from '../src/noctum-envelope';
import * as transporte from '../src/noctum-transporte';
import {
  assumirAutoridade, bater, BATIDA_VENCIDA_MS, cancelarOrdem, derivarCoordenacao, emitirOrdem, gravarNaCoordenacao, lerCoordenacao,
  registrosDosAbandonos, responderOrdem, revogarNaRede, situacaoDoTrabalho,
} from '../src/noctum-coordenacao';
import { integrarComVez, reconciliarIntegracao } from '../src/noctum-integracao';

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
