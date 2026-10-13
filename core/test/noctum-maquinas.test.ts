/**
 * RM-058 (N3): o passo da máquina, que coordena pelo ramo e chama o passo da N2 com a ordem, a reserva e a vaga global.
 * Dois clones de um remoto bare de fixture; o despacho, as sessões e as contas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { exec } from '../src/util';
import { projetoTemporario } from './apoio';
import { abrirArco, prepararIngressoSimulado, TrabalhoSimulado } from './noctum-apoio';
import { duasMaquinas, DuasMaquinas, entregarThread, MaquinaDeTeste, n2Simulada } from './noctum-maquinas-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { lerArco } from '../src/noctum-arco';
import * as coordenacao from '../src/noctum-coordenacao';
import { assumirAutoridade, cancelarOrdem, emitirOrdem, lerCoordenacao, reservaDestaMaquina, responderOrdem, situacaoDoTrabalho } from '../src/noctum-coordenacao';
import { RecusaDoArco } from '../src/noctum-envelope';
import { pegarItem } from '../src/roadmap-reservas';
import { passoDoArco } from '../src/noctum-execucao';
import { passoDaMaquina, ResultadoDoPassoDaMaquina } from '../src/noctum-maquinas';
import { dirThread, lerThread, listarIds } from '../src/thread';
import { registrar } from '../src/ledger';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: 'Fatia B SIMULADA, depois da A.' },
  { id: 'c', item: 'RM-903', prioridade: 3, dependeDe: [], pedido: 'Fatia C SIMULADA.' },
];

/** As duas máquinas com a A como autoridade: quem roda o passo primeiro assume, e aqui é ela. */
function cenario(nome: string, global = 2, trabalhos: Array<Record<string, unknown>> = TRABALHOS): DuasMaquinas {
  const m = duasMaquinas(nome, { trabalhos: trabalhos.map(t => ({ ...t })) as typeof TRABALHOS, maquina: 2, revisao: 0,
    contas: [{ conta: 'perfil-a', sessoes: 2 }], runtimes: [{ runtime: 'claude-bg', sessoes: 2 }], global: [{ conta: 'perfil-a', sessoes: global }] });
  assumirAutoridade(m.a.carregado, m.arco, { maquina: 'maquina-a' });
  return m;
}

const registro: string[] = [];
const passo = (m: MaquinaDeTeste) => passoDaMaquina(m.carregado, 'arco-n3', { maquina: m.nome, n2: n2Simulada(registro) });
const despachou = (r: ResultadoDoPassoDaMaquina) => r.acao === 'passo' && r.passo.acao === 'despachou' ? r.passo : null;
const sessaoDe = (thread: string) => registro.filter(x => x.startsWith(`${thread}:`)).at(-1)!.split(':')[3];

test('M1: com o envelope v2, o passo da máquina é o passo da N2, como está', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-m1');
  try {
    abrirArco(p.dir, 'arco-m1', { trabalhos: TRABALHOS.slice(0, 1) as TrabalhoSimulado[] });
    const r = passoDaMaquina(p.carregado, 'arco-m1', { maquina: 'maquina-simulada', n2: { ...n2Simulada(),
      lerReservas: () => ({ leitura: 'copia-local', reservas: [{ item: 'RM-901', maquina: 'maquina-simulada', thread: null }] }) } });
    assert.equal(r.acao, 'uma-maquina');
    assert.equal(r.acao === 'uma-maquina' && r.passo.acao, 'despachou');
    assert.equal(lerArco(p.dir, 'arco-m1')!.despachos.length, 1);
  } finally { p.limpar(); }
});

test('M2: sem leitura nova do ramo, a máquina não grava, não despacha e espera', { skip: semKernel }, () => {
  const m = cenario('noctum-m2');
  try {
    exec('git', ['remote', 'set-url', 'origin', path.join(path.dirname(m.remoto), 'nao-existe.git')], m.b.dir);
    const r = passo(m.b);
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.coordenacao.sem-remoto', JSON.stringify(r.acao === 'aguardar' ? r.motivo : r.acao));
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0);
    assert.equal(listarIds(m.b.dir).length, 0, 'nenhuma thread aberta');
    exec('git', ['remote', 'set-url', 'origin', m.remoto], m.b.dir);
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.batidas.has('maquina-b'), false, 'a B não gravou nada no ramo');
    assert.equal(estado.ordens.size, 0);
  } finally { m.limpar(); }
});

test('M3: a autoridade distribui, a máquina aceita, toma a reserva e a vaga global, e só despacha o que tem ordem dela', { skip: semKernel }, () => {
  const m = cenario('noctum-m3');
  try {
    const r1 = passo(m.a);
    const d1 = despachou(r1);
    assert.ok(d1 && d1.trabalho === 'a', JSON.stringify(r1.acao === 'passo' ? r1.passo.acao : r1));
    assert.ok(r1.acao === 'passo' && r1.relatorio.autoridade?.maquina === 'maquina-a');
    let estado = lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' });
    // Sem a batida da B, as duas vagas de execução da A ficam com o a e o c; o b espera o a.
    assert.deepEqual([...estado.ordens.values()].map(o => [o.ordem, o.maquina, o.estado]), [['O-a-1', 'maquina-a', 'aceita'], ['O-c-1', 'maquina-a', 'aceita']]);
    // A vaga leva o seq da reserva local, a linha dela no log do arco da A.
    const seq = lerArco(m.a.dir, m.arco)!.despachos[0].seq;
    assert.deepEqual(estado.vagas.map(v => [v.vaga, v.ordem, v.conta]), [[`V-maquina-a-${seq}`, 'O-a-1', 'perfil-a']]);
    assert.equal(reservaDestaMaquina(m.a.carregado, 'RM-901', { maquina: 'maquina-a' })!.minha, true);
    // A B bate e não recebe nada até a autoridade distribuir de novo; nada que não é dela despacha lá.
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.passo.acao !== 'despachou' && rb.relatorio.trabalhos.length === 0);
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0);
    const r2 = passo(m.a);
    assert.equal(despachou(r2)?.trabalho, 'c');
    estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.vagas.filter(v => !v.solta).length, 2);
    assert.equal(situacaoDoTrabalho(estado, 'b')!.estado, 'livre', 'o b espera a entrega do a');
  } finally { m.limpar(); }
});

test('M4: sem vaga global a máquina espera sem reservar; a vaga que outra máquina leva no meio recusa e devolve a reserva local', { skip: semKernel }, () => {
  const m = cenario('noctum-m4', 1);
  const original = coordenacao.tomarVagaGlobal;
  try {
    passo(m.b);
    // Com a batida da B, a distribuição dá o a à A (empate, a primeira do envelope) e o c à B; a A despacha o a.
    const r = passo(m.a);
    assert.equal(despachou(r)?.trabalho, 'a');
    assert.ok(r.acao === 'passo' && r.relatorio.ordensEmitidas.join() === 'O-a-1,O-c-1', JSON.stringify(r.acao === 'passo' && r.relatorio.ordensEmitidas));
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).ordens.get('O-c-1')!.maquina, 'maquina-b');
    // A única vaga da conta, somando as máquinas, está com a A: a B nem reserva.
    const rb = passo(m.b);
    assert.ok(rb.acao === 'aguardar' && rb.motivo === 'noctum.coordenacao.vaga-global', JSON.stringify(rb.acao === 'aguardar' ? rb.motivo : rb.acao));
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0);
    // A vaga solta; no meio do despacho da B, outra máquina a leva (a troca atômica recusa a B): a reserva local volta.
    const vagaA = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).vagas[0].vaga;
    coordenacao.soltarVagaGlobal(m.a.carregado, m.arco, vagaA, { consumiu: true, motivo: 'SIMULADO' }, { maquina: 'maquina-a' });
    (coordenacao as { tomarVagaGlobal: typeof original }).tomarVagaGlobal = () => {
      throw new RecusaDoArco('noctum.coordenacao.vaga-global', 'SIMULADO: a outra máquina levou a última vaga no meio');
    };
    const rb2 = passo(m.b);
    assert.ok(rb2.acao === 'passo' && rb2.passo.acao === 'recusado' && rb2.passo.motivo === 'noctum.coordenacao.vaga-global',
      JSON.stringify(rb2.acao === 'passo' ? [rb2.passo.acao, 'motivo' in rb2.passo ? rb2.passo.motivo : null] : rb2));
    assert.deepEqual(lerArco(m.b.dir, m.arco)!.despachos.map(d => [d.trabalho, d.desfecho, d.motivo]), [['c', 'recusado', 'noctum.coordenacao.vaga-global']]);
    assert.equal(lerArco(m.b.dir, m.arco)!.consumo.arco, 0, 'a reserva local voltou');
    const vagas = lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' }).vagas;
    assert.deepEqual(vagas.map(v => v.maquina), ['maquina-a'], 'nenhuma vaga global da B');
  } finally { (coordenacao as { tomarVagaGlobal: typeof original }).tomarVagaGlobal = original; m.limpar(); }
});

test('M5: a entrega numa máquina destrava a dependência na outra, sem thread dela ali', { skip: semKernel }, () => {
  // O b, que depende do a, fica preso à B; o a anda na A.
  const m = cenario('noctum-m5', 2, TRABALHOS.map(t => t.id === 'b' ? { ...t, maquina: 'maquina-b' } : t));
  try {
    passo(m.b);
    assert.equal(despachou(passo(m.a))?.trabalho, 'a');
    const threadA = listarIds(m.a.dir).find(id => lerThread(m.a.dir, id).roadmap === 'RM-901')!;
    entregarThread(m.a.dir, threadA, sessaoDe(threadA));
    // A reconciliação da A conclui a ordem do a pela thread entregue e solta a vaga; a distribuição dá o b à B.
    const r = passo(m.a);
    assert.ok(r.acao === 'passo' && r.relatorio.reconciliacao!.concluidas.includes('O-a-1'));
    let estado = lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' });
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'entregue');
    const rb = passo(m.b);
    assert.equal(despachou(rb)?.trabalho, 'b', JSON.stringify(rb.acao === 'passo' ? rb.passo.acao : rb));
    assert.equal(listarIds(m.b.dir).some(id => lerThread(m.b.dir, id).roadmap === 'RM-901'), false, 'a B não tem thread do a');
    estado = lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' });
    assert.equal(estado.vagas.find(v => v.ordem === 'O-a-1')!.solta!.consumiu, true);
  } finally { m.limpar(); }
});

test('M6: o passo da N2 sozinho não despacha um arco de várias máquinas', { skip: semKernel }, () => {
  const m = cenario('noctum-m6');
  try {
    const r = passoDoArco(m.a.carregado, m.arco, { maquina: 'maquina-a', ...n2Simulada(),
      lerReservas: () => ({ leitura: 'copia-local', reservas: TRABALHOS.map(t => ({ item: t.item, maquina: 'maquina-a', thread: null })) }) });
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.coordenacao.exige-passo-da-maquina', JSON.stringify(r.acao));
    assert.equal(lerArco(m.a.dir, m.arco)!.despachos.length, 0);
  } finally { m.limpar(); }
});

test('M7: a ordem cancelada com a sessão acabada vira fim confirmado, solta a vaga e a reserva, e o trabalho muda de máquina', { skip: semKernel }, () => {
  const m = cenario('noctum-m7');
  try {
    passo(m.b);
    passo(m.a);
    passo(m.a);
    assert.equal(despachou(passo(m.b))?.trabalho, 'c', 'a segunda distribuição deu o c à B');
    cancelarOrdem(m.a.carregado, m.arco, 'O-c-1', 'SIMULADO: a B vai sair', { maquina: 'maquina-a' });
    // A sessão da B ainda vive: o c fica isolado, e nada muda de máquina.
    let rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reconciliacao!.aguardando.some(x => x.ordem === 'O-c-1'));
    passo(m.a);
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }), 'c')!.estado, 'isolado');
    // A sessão acabou sem entrega: a B confirma o fim, solta a vaga e a reserva.
    const threadC = listarIds(m.b.dir).find(id => lerThread(m.b.dir, id).roadmap === 'RM-903')!;
    registrar(dirThread(m.b.dir, threadC), threadC, 'phase_result', { fase: 'GOAL', sessionId: sessaoDe(threadC), classificacao: 'fase_concluida', ok: true });
    rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reconciliacao!.encerradas.includes('O-c-1'), JSON.stringify(rb.acao === 'passo' ? rb.relatorio.reconciliacao : rb));
    assert.ok(rb.acao === 'passo' && rb.relatorio.reservasSoltas.includes('RM-903'));
    assert.equal(reservaDestaMaquina(m.b.carregado, 'RM-903', { maquina: 'maquina-b' })!.com, null);
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(situacaoDoTrabalho(estado, 'c')!.estado, 'livre');
    assert.equal(estado.vagas.find(v => v.ordem === 'O-c-1')!.solta!.consumiu, true);
    // Com a prova, o trabalho muda de máquina.
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-a' }, { maquina: 'maquina-a' }), 'O-c-2');
  } finally { m.limpar(); }
});

test('M8: o item que outra máquina ou pessoa reservou é recusado de saída, e a ordem não volta para quem recusou', { skip: semKernel }, () => {
  const m = cenario('noctum-m8', 2, [{ id: 'z', item: 'RM-909', prioridade: 1, dependeDe: [], pedido: 'Fatia Z SIMULADA.' }]);
  try {
    // O dono da A reservou o RM-909 à mão, e a autoridade dá a ordem do z à B (direto, pelo teste).
    pegarItem(m.a.dir, 'RM-909', { maquina: 'maquina-a', nota: 'à mão, SIMULADO' });
    passo(m.b);
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'z', maquina: 'maquina-b' }, { maquina: 'maquina-a' });
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.respostas.some(x => x.ordem === 'O-z-1' && x.recibo === 'recusada' &&
      /^noctum.reserva.de-outra-maquina/.test(x.motivo)), JSON.stringify(rb.acao === 'passo' ? rb.relatorio.respostas : rb));
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0);
    // A autoridade não devolve a ordem para a B; a A, que tem a reserva, aceita e despacha.
    const ra = passo(m.a);
    assert.ok(ra.acao === 'passo' && ra.relatorio.ordensEmitidas.join() === 'O-z-2', JSON.stringify(ra.acao === 'passo' && ra.relatorio.ordensEmitidas));
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.ordens.get('O-z-2')!.maquina, 'maquina-a');
    assert.equal(despachou(ra)?.trabalho, 'z');
  } finally { m.limpar(); }
});

test('M9: a conta sem vaga global sai da escolha da N2, e o despacho sai pela outra conta do envelope', { skip: semKernel }, () => {
  const m = duasMaquinas('noctum-m9', { trabalhos: [
    { id: 'p', item: 'RM-951', prioridade: 1, dependeDe: [], pedido: 'Fatia P SIMULADA.', maquina: 'maquina-a' },
    { id: 'q', item: 'RM-952', prioridade: 1, dependeDe: [], pedido: 'Fatia Q SIMULADA.', maquina: 'maquina-b' },
  ], maquina: 2, revisao: 0, contas: [{ conta: 'perfil-a', sessoes: 2 }, { conta: 'perfil-b', sessoes: 2 }],
  runtimes: [{ runtime: 'claude-bg', sessoes: 2 }], global: [{ conta: 'perfil-a', sessoes: 1 }, { conta: 'perfil-b', sessoes: 1 }] });
  const duas = () => [{ id: 'perfil-a', runtime: 'claude-bg' }, { id: 'perfil-b', runtime: 'claude-bg' }];
  const passoCom = (q: MaquinaDeTeste) => passoDaMaquina(q.carregado, m.arco, { maquina: q.nome, n2: { ...n2Simulada(registro), perfis: duas } });
  try {
    assumirAutoridade(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    passoCom(m.b);
    // A A despacha o p pela perfil-a, a primeira do envelope com a mesma folga, e leva a única vaga global dela.
    const ra = passoCom(m.a);
    assert.ok(despachou(ra)?.trabalho === 'p' && despachou(ra)?.conta === 'perfil-a', JSON.stringify(ra.acao === 'passo' ? ra.passo : ra));
    // A B não insiste na perfil-a, que não tem vaga somando as máquinas: sai pela perfil-b.
    const rb = passoCom(m.b);
    assert.ok(despachou(rb)?.trabalho === 'q' && despachou(rb)?.conta === 'perfil-b', JSON.stringify(rb.acao === 'passo' ? rb.passo : rb));
    assert.deepEqual(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).vagas.map(v => [v.maquina, v.conta]).sort(),
      [['maquina-a', 'perfil-a'], ['maquina-b', 'perfil-b']]);
  } finally { m.limpar(); }
});

test('M10: a ordem encerrada porque o item estava com outra pessoa não volta para a mesma máquina, mesmo com menos ordens vivas', { skip: semKernel }, () => {
  const m = cenario('noctum-m10', 2, [
    { id: 'w', item: 'RM-910', prioridade: 1, dependeDe: [], pedido: 'Fatia W SIMULADA, da A.', maquina: 'maquina-a' },
    { id: 'z', item: 'RM-909', prioridade: 2, dependeDe: [], pedido: 'Fatia Z SIMULADA.' },
  ]);
  try {
    passo(m.b);
    // A A fica com o w; o z vai para a B, que tem menos ordens vivas.
    const ra = passo(m.a);
    assert.ok(ra.acao === 'passo' && ra.relatorio.ordensEmitidas.join() === 'O-w-1,O-z-1', JSON.stringify(ra.acao === 'passo' && ra.relatorio.ordensEmitidas));
    // A B aceita o z (um passo dela que caiu logo depois do aceite), e o dono da A pega o RM-909 à mão nesse meio tempo.
    responderOrdem(m.b.carregado, m.arco, 'O-z-1', 'aceita', 'SIMULADO', { maquina: 'maquina-b' });
    pegarItem(m.a.dir, 'RM-909', { maquina: 'maquina-a', nota: 'à mão, SIMULADO' });
    // No passo seguinte, a B não consegue a reserva e encerra a ordem que nunca despachou.
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reservas.some(x => x.ordem === 'O-z-1' && !x.ok && x.motivo === 'noctum.reserva.de-outra-maquina'),
      JSON.stringify(rb.acao === 'passo' ? rb.relatorio.reservas : rb));
    let estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.ordens.get('O-z-1')!.estado, 'encerrada');
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0);
    // A B tem menos ordens vivas, mas o z não volta para ela: vai para a A, que tem a reserva.
    const ra2 = passo(m.a);
    assert.ok(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas.join() === 'O-z-2', JSON.stringify(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas));
    estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.ordens.get('O-z-2')!.maquina, 'maquina-a');
  } finally { m.limpar(); }
});
