/**
 * RM-058 (N3): o passo da máquina, que coordena pelo ramo e chama o passo da N2 com a ordem, a reserva e a vaga global.
 * Dois clones de um remoto bare de fixture; o despacho, as sessões e as contas são SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from '../src/util';
import { projetoTemporario } from './apoio';
import { abrirArco, autorizarPedido, prepararIngressoSimulado, revogarArco, TrabalhoSimulado } from './noctum-apoio';
import { commitar } from './apoio';
import { duasMaquinas, DuasMaquinas, entregarThread, MaquinaDeTeste, n2Simulada } from './noctum-maquinas-apoio';
import * as filaPesada from '../src/fila-pesada';
import { kernelDisponivel } from '../src/fila-pesada';
import { encerrarArco, lerArco, reservarDespacho } from '../src/noctum-arco';
import * as coordenacao from '../src/noctum-coordenacao';
import {
  assumirAutoridade, bater, BATIDA_VENCIDA_MS, cancelarOrdem, chaveDoDestino, derivarCoordenacao, emitirOrdem, gravarNaCoordenacao, lerCoordenacao,
  motivoDaReservaDeFora, registrosDosAbandonos, reservaDoItem, responderOrdem, situacaoDoTrabalho,
} from '../src/noctum-coordenacao';
import { BRANCH_DE_COORDENACAO } from '../src/noctum-transporte';
import { RecusaDoArco } from '../src/noctum-envelope';
import * as reservasDoRoadmap from '../src/roadmap-reservas';
import { pegarItem, soltarItem } from '../src/roadmap-reservas';
import { OpcoesDoPasso, passoDoArco } from '../src/noctum-execucao';
import { ResultadoRun } from '../src/phase';
import { passoDaMaquina, reconciliarMaquina, ResultadoDoPassoDaMaquina } from '../src/noctum-maquinas';
import { dirThread, gravarThread, lerThread, listarIds } from '../src/thread';
import { FatosDaFila, montarFila } from '../src/noctum-fila';
import { passageira } from '../src/noctum-vigia';
import { registrar } from '../src/ledger';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();

const TRABALHOS = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: 'Fatia B SIMULADA, depois da A.' },
  { id: 'c', item: 'RM-903', prioridade: 3, dependeDe: [], pedido: 'Fatia C SIMULADA.' },
];

/** As duas máquinas com a A como autoridade: quem roda o passo primeiro assume, e aqui é ela. */
function cenario(nome: string, global = 2, trabalhos: Array<Record<string, unknown>> = TRABALHOS, semPagina: string[] = []): DuasMaquinas {
  const m = duasMaquinas(nome, { trabalhos: trabalhos.map(t => ({ ...t })) as typeof TRABALHOS, maquina: 2, revisao: 0, semPagina,
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
  const isolado = fs.mkdtempSync(path.join(os.tmpdir(), 'noctum-m2-remoto-'));
  try {
    exec('git', ['remote', 'set-url', 'origin', path.join(isolado, 'nao-existe.git')], m.b.dir);
    const r = passo(m.b);
    assert.ok(r.acao === 'aguardar' && r.motivo === 'noctum.coordenacao.sem-remoto', JSON.stringify(r.acao === 'aguardar' ? r.motivo : r.acao));
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0);
    assert.equal(listarIds(m.b.dir).length, 0, 'nenhuma thread aberta');
    exec('git', ['remote', 'set-url', 'origin', m.remoto], m.b.dir);
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.batidas.has('maquina-b'), false, 'a B não gravou nada no ramo');
    assert.equal(estado.ordens.size, 0);
  } finally { fs.rmSync(isolado, { recursive: true, force: true }); m.limpar(); }
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
    assert.equal(reservaDoItem(m.a.carregado, m.arco, 'RM-901', { maquina: 'maquina-a' })!.minha, true);
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
    // S5 da revisão: a coordenação sem a reserva que toma a vaga global também não despacha.
    const semGancho = { trabalhos: new Set(['a']), entregues: new Map() } as unknown as NonNullable<Parameters<typeof passoDoArco>[2]>['coordenacao'];
    const r2 = passoDoArco(m.a.carregado, m.arco, { maquina: 'maquina-a', ...n2Simulada(), coordenacao: semGancho,
      lerReservas: () => ({ leitura: 'copia-local', reservas: TRABALHOS.map(t => ({ item: t.item, maquina: 'maquina-a', thread: null })) }) });
    assert.ok(r2.acao === 'aguardar' && r2.motivo === 'noctum.coordenacao.exige-passo-da-maquina', JSON.stringify(r2.acao));
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
    assert.equal(reservaDoItem(m.b.carregado, m.arco, 'RM-903', { maquina: 'maquina-b' })!.livre, true);
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(situacaoDoTrabalho(estado, 'c')!.estado, 'livre');
    assert.equal(estado.vagas.find(v => v.ordem === 'O-c-1')!.solta!.consumiu, true);
    // Com a prova, o trabalho muda de máquina.
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-a' }, { maquina: 'maquina-a' }), 'O-c-2');
  } finally { m.limpar(); }
});

test('M8: a reserva lida agora decide para onde a ordem vai: a de uma máquina do arco a leva para ela, e a de fora a segura', { skip: semKernel }, () => {
  const m = cenario('noctum-m8', 2, [
    { id: 'z', item: 'RM-909', prioridade: 1, dependeDe: [], pedido: 'Fatia Z SIMULADA.' },
    { id: 'y', item: 'RM-908', prioridade: 2, dependeDe: [], pedido: 'Fatia Y SIMULADA.' },
  ]);
  try {
    // O dono da A reservou o RM-909 à mão (vale para o arco da A, como na N2); uma pessoa de fora do arco tem o RM-908.
    pegarItem(m.a.dir, 'RM-909', { maquina: 'maquina-a', nota: 'à mão, SIMULADO' });
    pegarItem(m.b.dir, 'RM-908', { maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'SIMULADO' });
    passo(m.b);
    const ra = passo(m.a);
    assert.ok(ra.acao === 'passo' && ra.relatorio.ordensEmitidas.join() === 'O-z-1', JSON.stringify(ra.acao === 'passo' && ra.relatorio.ordensEmitidas));
    assert.equal(despachou(ra)?.trabalho, 'z');
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' }).ordens.get('O-z-1')!.maquina, 'maquina-a');
    // Solto o RM-908, o y sai no passo seguinte da autoridade, para a máquina com menos ordens vivas.
    soltarItem(m.b.dir, 'RM-908', { maquina: 'maquina-c', por: 'Pessoa SIMULADA' });
    const ra2 = passo(m.a);
    assert.ok(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas.join() === 'O-y-1', JSON.stringify(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas));
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).ordens.get('O-y-1')!.maquina, 'maquina-b');
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

test('M11: o trabalho com ordem não fica preso atrás de outro do mesmo item sem ordem desta máquina', { skip: semKernel }, () => {
  const m = cenario('noctum-m11', 2, [
    { id: 'p', item: 'RM-921', prioridade: 1, dependeDe: [], pedido: 'Fatia P SIMULADA.' },
    { id: 'q', item: 'RM-921', prioridade: 2, dependeDe: [], pedido: 'Fatia Q SIMULADA, do mesmo item.' },
  ]);
  try {
    passo(m.b);
    // A autoridade dá o p e o q à B, que aceita os dois; o p é cancelado antes de despachar.
    for (const t of ['p', 'q']) emitirOrdem(m.a.carregado, m.arco, { trabalho: t, maquina: 'maquina-b' }, { maquina: 'maquina-a' });
    for (const o of ['O-p-1', 'O-q-1']) responderOrdem(m.b.carregado, m.arco, o, 'aceita', 'SIMULADO', { maquina: 'maquina-b' });
    cancelarOrdem(m.a.carregado, m.arco, 'O-p-1', 'SIMULADO: o dono mudou de ideia', { maquina: 'maquina-a' });
    // O passo da B encerra o p e despacha o q, mesmo com o p na frente da fila e o item reservado por ela.
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reconciliacao!.encerradas.includes('O-p-1'));
    assert.equal(despachou(rb)?.trabalho, 'q', JSON.stringify(rb.acao === 'passo' ? rb.passo.acao : rb));
  } finally { m.limpar(); }
});

test('M12: a ordem que perdeu a reserva para alguém de fora termina sem o nome dele no ramo, espera a soltura e sai de novo', { skip: semKernel }, () => {
  const m = cenario('noctum-m12', 2, [{ id: 'z', item: 'RM-909', prioridade: 1, dependeDe: [], pedido: 'Fatia Z SIMULADA.' }]);
  try {
    passo(m.b);
    // A B aceita o z (um passo dela que caiu logo depois do aceite), e alguém de fora pega o RM-909 nesse meio tempo.
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'z', maquina: 'maquina-b' }, { maquina: 'maquina-a' });
    responderOrdem(m.b.carregado, m.arco, 'O-z-1', 'aceita', 'SIMULADO', { maquina: 'maquina-b' });
    pegarItem(m.a.dir, 'RM-909', { maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'nota SIMULADA de fora' });
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reservas.some(x => x.ordem === 'O-z-1' && x.motivo === 'noctum.reserva.de-outra-maquina'));
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.ordens.get('O-z-1')!.recibos.encerrada!.motivo, motivoDaReservaDeFora('RM-909'));
    // Nada do ramo, nem os commits, leva quem reservou, a máquina dele ou a nota.
    const ramo = exec('git', ['log', '-p', '--format=%an %ae %cn %ce %B', `refs/remotes/origin/${BRANCH_DE_COORDENACAO}`], m.a.dir).stdout;
    for (const pessoal of ['Pessoa SIMULADA', 'maquina-c', 'nota SIMULADA de fora']) assert.ok(!ramo.includes(pessoal), pessoal);
    // A autoridade espera a soltura, sem ordem nova; solta a reserva de fora, o z sai de novo e despacha.
    const ra = passo(m.a);
    assert.ok(ra.acao === 'passo' && ra.relatorio.ordensEmitidas.length === 0, JSON.stringify(ra.acao === 'passo' && ra.relatorio.ordensEmitidas));
    soltarItem(m.a.dir, 'RM-909', { maquina: 'maquina-c', por: 'Pessoa SIMULADA' });
    const ra2 = passo(m.a);
    assert.ok(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas.join() === 'O-z-2', JSON.stringify(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas));
    assert.equal(despachou(ra2)?.trabalho, 'z');
  } finally { m.limpar(); }
});

test('M13: a revogação numa máquina vale na outra; a máquina tirada do arco fecha o que é dela e solta a reserva do item tirado', { skip: semKernel }, () => {
  const m = cenario('noctum-m13');
  try {
    passo(m.b);
    assert.equal(despachou(passo(m.a))?.trabalho, 'a');
    revogarArco(m.a.dir, m.arco);
    const ra = passo(m.a);
    assert.ok(ra.acao === 'aguardar' && ra.motivo === 'noctum.efeito.revogado', JSON.stringify(ra.acao === 'aguardar' ? ra.motivo : ra.acao));
    const rb = passo(m.b);
    assert.ok(rb.acao === 'aguardar' && rb.motivo === 'noctum.coordenacao.revogada', JSON.stringify(rb.acao === 'aguardar' ? rb.motivo : rb.acao));
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, 0, 'a B não despacha no arco revogado na A');
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' }).ordens.get('O-c-1')!.estado, 'emitida', 'nem aceita');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-m13b');
  try {
    passo(m2.b);
    passo(m2.a);
    passo(m2.a);
    assert.equal(despachou(passo(m2.b))?.trabalho, 'c');
    // O dono tira a B e o c do arco, nas duas máquinas; a sessão do c ainda vive na B.
    const emenda = { ...m2.pedido, maquinas: (m2.pedido.maquinas as Array<{ nome: string }>).filter(x => x.nome === 'maquina-a'),
      trabalhos: (m2.pedido.trabalhos as Array<{ id: string }>).filter(t => t.id !== 'c') };
    autorizarPedido(m2.a.dir, m2.arco, emenda);
    autorizarPedido(m2.b.dir, m2.arco, emenda);
    let rb = passo(m2.b);
    assert.ok(rb.acao === 'aguardar' && rb.motivo === 'noctum.coordenacao.fora-do-envelope' && /ela só fecha o que é dela/.test(rb.detalhe),
      JSON.stringify(rb.acao === 'aguardar' ? [rb.motivo, rb.detalhe] : rb.acao));
    assert.ok(rb.relatorio.reconciliacao!.aguardando.some(x => x.ordem === 'O-c-1'));
    // A sessão acabou: a B fecha a ordem da versão anterior, solta a vaga e a reserva, e continua fora.
    const threadC = listarIds(m2.b.dir).find(id => lerThread(m2.b.dir, id).roadmap === 'RM-903')!;
    registrar(dirThread(m2.b.dir, threadC), threadC, 'phase_result', { fase: 'GOAL', sessionId: sessaoDe(threadC), classificacao: 'fase_concluida', ok: true });
    rb = passo(m2.b);
    assert.ok(rb.acao === 'aguardar' && rb.motivo === 'noctum.coordenacao.fora-do-envelope');
    assert.ok(rb.relatorio.reconciliacao!.encerradas.includes('O-c-1'), JSON.stringify(rb.relatorio.reconciliacao));
    assert.ok(rb.relatorio.reservasSoltas.includes('RM-903'));
    assert.equal(reservaDoItem(m2.b.carregado, m2.arco, 'RM-903', { maquina: 'maquina-b' })!.livre, true);
    assert.equal(lerCoordenacao(m2.a.carregado, m2.arco, { maquina: 'maquina-a' }).vagas.find(v => v.ordem === 'O-c-1')!.solta!.consumiu, true);
    // S1 da rodada 2: o dono revoga o arco na B, que a emenda tirou; a revogação vai ao ramo mesmo assim e vale na A.
    revogarArco(m2.b.dir, m2.arco);
    rb = passo(m2.b);
    assert.ok(rb.acao === 'aguardar' && rb.motivo === 'noctum.efeito.revogado', JSON.stringify(rb.acao === 'aguardar' ? rb.motivo : rb.acao));
    assert.equal(lerCoordenacao(m2.a.carregado, m2.arco, { maquina: 'maquina-a' }).revogada?.por, 'maquina-b');
    const ra = passo(m2.a);
    assert.ok(ra.acao === 'aguardar' && ra.motivo === 'noctum.coordenacao.revogada', JSON.stringify(ra.acao === 'aguardar' ? ra.motivo : ra.acao));
  } finally { m2.limpar(); }
});

test('M14: o item que o roadmap de uma máquina não tem encerra a ordem dela sem despachar, e o trabalho vai para a outra', { skip: semKernel }, () => {
  const m = cenario('noctum-m14', 2, [{ id: 'k', item: 'RM-942', prioridade: 1, dependeDe: [], pedido: 'Fatia K SIMULADA.' }], ['RM-942']);
  try {
    // Só o checkout da B tem a página do item.
    commitar(m.b.dir, 'docs/roadmap/RM-942-simulado.md', '# RM-942 SIMULADO\n', 'roadmap: RM-942 só na B');
    passo(m.b);
    const ra = passo(m.a);
    assert.ok(ra.acao === 'passo' && ra.relatorio.reservas.some(x => x.ordem === 'O-k-1' && x.motivo === 'noctum.reserva.item-invalido'),
      JSON.stringify(ra.acao === 'passo' ? ra.relatorio.reservas : ra));
    assert.equal(lerArco(m.a.dir, m.arco)!.despachos.length, 0);
    let estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.ordens.get('O-k-1')!.recibos.encerrada!.motivo, 'noctum.reserva.item-invalido: o item RM-942 não está no roadmap desta máquina');
    // A A não recebe o k de novo nesta versão; a B recebe e despacha.
    const ra2 = passo(m.a);
    assert.ok(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas.join() === 'O-k-2', JSON.stringify(ra2.acao === 'passo' && ra2.relatorio.ordensEmitidas));
    estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.equal(estado.ordens.get('O-k-2')!.maquina, 'maquina-b');
    assert.equal(despachou(passo(m.b))?.trabalho, 'k');
  } finally { m.limpar(); }
});

test('M15: sem a leitura das reservas a autoridade não distribui; antes de a janela abrir aqui, a máquina não responde a ordem', { skip: semKernel }, () => {
  const m = cenario('noctum-m15');
  const original = reservasDoRoadmap.listarReservas;
  try {
    passo(m.b);
    (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = () => { throw new Error('SIMULADO: o remoto das reservas não respondeu'); };
    const r = passo(m.a);
    assert.ok(r.acao !== 'uma-maquina' && r.relatorio.ordensEmitidas.length === 0, JSON.stringify(r.acao !== 'uma-maquina' ? r.relatorio.ordensEmitidas : r.acao));
    (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = original;
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).ordens.size, 0);
  } finally { (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = original; m.limpar(); }
  // A-R2A-3 da rodada 2: na borda da janela, o relógio da B atrás do da autoridade. A ordem do trabalho preso à B fica
  // emitida até a janela abrir lá, em vez de virar uma recusa que a exclui nesta versão do envelope.
  const m2 = duasMaquinas('noctum-m15b', { trabalhos: [{ id: 't1', item: 'RM-971', prioridade: 1, dependeDe: [], pedido: 'Fatia 1 SIMULADA.', maquina: 'maquina-b' }],
    maquina: 2, revisao: 0, contas: [{ conta: 'perfil-a', sessoes: 2 }], runtimes: [{ runtime: 'claude-bg', sessoes: 2 }], global: [{ conta: 'perfil-a', sessoes: 2 }] });
  try {
    const inicio = Date.parse((m2.pedido.janela as { inicio: string }).inicio);
    const em = (q: number) => new Date(inicio + q).toISOString();
    const de = (quem: MaquinaDeTeste, q: number) => passoDaMaquina(quem.carregado, m2.arco, { maquina: quem.nome, quando: em(q), n2: n2Simulada(registro) });
    coordenacao.bater(m2.b.carregado, m2.arco, { maquina: 'maquina-b', quando: em(-3000) });
    const ra = de(m2.a, 2000);
    assert.ok(ra.acao !== 'uma-maquina' && ra.relatorio.ordensEmitidas.includes('O-t1-1'));
    const antes = de(m2.b, -1000);
    assert.ok(antes.acao !== 'uma-maquina' && antes.relatorio.respostas.length === 0, JSON.stringify(antes.acao !== 'uma-maquina' ? antes.relatorio.respostas : antes.acao));
    assert.equal(lerCoordenacao(m2.a.carregado, m2.arco, { maquina: 'maquina-a', quando: em(3000) }).ordens.get('O-t1-1')!.estado, 'emitida');
    const depois = de(m2.b, 61_000);
    assert.ok(depois.acao !== 'uma-maquina' && depois.relatorio.respostas.some(x => x.ordem === 'O-t1-1' && x.recibo === 'aceita'),
      JSON.stringify(depois.acao !== 'uma-maquina' ? depois.relatorio.respostas : depois.acao));
  } finally { m2.limpar(); }
});

test('M16: o despacho idempotente, com a fase já correndo, solta a vaga global com consumo no passo seguinte, sem esperar sessão', { skip: semKernel }, () => {
  const m = cenario('noctum-m16');
  // A2 da rodada 2: o núcleo devolve idempotente, sem sessão nova; o desfecho local leva isso aos fatos da máquina.
  const idempotente = (() => ({ sessionId: null, idempotente: true, verificada: true, bloqueado: false, motivo: null }) as unknown as ResultadoRun) as
    NonNullable<OpcoesDoPasso['despachar']>;
  const passoIdempotente = (q: MaquinaDeTeste) => passoDaMaquina(q.carregado, m.arco, { maquina: q.nome, n2: { ...n2Simulada(registro), despachar: idempotente } });
  try {
    const r1 = passoIdempotente(m.a);
    const d1 = despachou(r1);
    assert.ok(d1 && d1.trabalho === 'a' && d1.idempotente === true, JSON.stringify(r1.acao === 'passo' ? r1.passo : r1));
    const vaga = `V-maquina-a-${d1.reserva}`;
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).vagas.find(v => v.vaga === vaga)!.solta, null);
    const r2 = passoIdempotente(m.a);
    assert.ok(r2.acao === 'passo' && r2.relatorio.reconciliacao!.soltas.includes(vaga), JSON.stringify(r2.acao === 'passo' ? r2.relatorio.reconciliacao : r2));
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).vagas.find(v => v.vaga === vaga)!.solta!.consumiu, true);
  } finally { m.limpar(); }
});

test('M17: a fila conta a entrega e o fim sem entrega de outra máquina antes da thread local; o dependente não fica preso', { skip: semKernel }, () => {
  // B1 da rodada 3, na fila pura: o x foi entregue na B; a thread antiga do x, nesta máquina, foi fechada como superada.
  const quando = new Date().toISOString();
  const conteudo = { contrato: 'ork.noctum-envelope/v3', arco: 'arco-m17', janela: { inicio: quando, fim: new Date(Date.now() + 8 * 3600_000).toISOString(),
    fuso: 'America/Sao_Paulo' }, destinos: [], orcamento: { arco: { valor: 10, unidade: 'sessoes' }, porConta: [], porRuntime: [] }, relatorio: {},
  exclusoes: [], capacidade: { maquina: 2, revisao: 0, porConta: [], porRuntime: [] }, maquinas: [], capacidadeGlobal: { porConta: [] },
  trabalhos: [{ id: 'x', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia X SIMULADA.' },
    { id: 'y', item: 'RM-902', prioridade: 1, dependeDe: ['x'], pedido: 'Fatia Y SIMULADA, depois da X.' }] };
  const vazio = { threads: [], ilegivel: null, entregueEm: null, despachada: false, despachoFalho: false, pedidoGuardado: false, passo: null, espera: null, doDono: null };
  const fechada = { ...vazio, threads: [{ id: 'ork-rm901x', roadmap: 'RM-901', status: 'fechada', modo: 'auto', faseAtual: 'GO' }], pedidoGuardado: true, despachada: true };
  const fila = (x: object, coordenacao: object) => montarFila({ arco: 'arco-m17', quando, maquina: 'maquina-a',
    estado: { situacao: 'vigente', conteudo, envelopeSha256: 'e'.repeat(64), decisoes: [], despachos: [], autorizadoPor: { recebidoEm: quando } },
    reservas: { leitura: 'copia-local', porItem: new Map([['RM-902', { maquina: 'maquina-a', thread: null }]]) },
    porTrabalho: new Map([['x', x], ['y', vazio]]), threadsIlegiveis: [], modosPermitidos: ['auto'], coordenacao } as unknown as FatosDaFila);
  const entregue = fila(fechada, { trabalhos: new Set(['y']), entregues: new Map([['x', quando]]) });
  assert.deepEqual(entregue.trabalhos.map(t => [t.id, t.estado, t.motivo]), [['x', 'entregue', null], ['y', 'abrir', null]]);
  assert.deepEqual(entregue.decisao, { acao: 'despachar' });
  // S1 da rodada 3: o x encerrado sem entrega em outra máquina é terminal aqui, e o dependente também; a fila diz encerrar.
  const encerrado = fila(vazio, { trabalhos: new Set(['y']), entregues: new Map(), encerrados: new Set(['x']) });
  assert.deepEqual(encerrado.trabalhos.map(t => [t.id, t.estado, t.motivo]), [['x', 'encerrado-sem-entrega', null], ['y', 'bloqueado', 'dependencia-encerrada']]);
  assert.deepEqual(encerrado.decisao, { acao: 'encerrar', motivo: 'fila-vazia' });
  // Ponta a ponta: o x, preso à B, fecha sem entrega lá; o passo da A leva o encerrado da rede à fila e encerra.
  const m = cenario('noctum-m17', 2, [{ id: 'x', item: 'RM-971', prioridade: 1, dependeDe: [], pedido: 'Fatia X SIMULADA.', maquina: 'maquina-b' },
    { id: 'y', item: 'RM-972', prioridade: 2, dependeDe: ['x'], pedido: 'Fatia Y SIMULADA, depois da X.' }]);
  try {
    passo(m.b);
    const ra = passo(m.a);
    assert.ok(ra.acao === 'passo' && ra.relatorio.ordensEmitidas.includes('O-x-1'), JSON.stringify(ra.acao === 'passo' ? ra.relatorio.ordensEmitidas : ra.acao));
    assert.equal(despachou(passo(m.b))?.trabalho, 'x');
    const tx = listarIds(m.b.dir).map(id => lerThread(m.b.dir, id)).find(t => t.roadmap === 'RM-971')!;
    gravarThread(m.b.dir, { ...tx, status: 'fechada' });
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reconciliacao!.concluidas.includes('O-x-1'), JSON.stringify(rb.acao === 'passo' ? rb.relatorio.reconciliacao : rb));
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }), 'x')!.estado, 'encerrado');
    const ra2 = passo(m.a);
    assert.ok(ra2.acao === 'passo' && ra2.passo.acao === 'encerrar', JSON.stringify(ra2.acao === 'passo' ? ra2.passo.acao : ra2));
  } finally { m.limpar(); }
});

test('M18: no vigia da N4, a vaga global ocupada, o ramo sem leitura e a corrida perdida passam, como a vaga local', () => {
  // A1 da rodada 3: três recusas dessas, gravadas pelo gancho da vaga global, não isolam o trabalho do arco entre máquinas.
  for (const motivo of ['noctum.coordenacao.vaga-global', 'noctum.coordenacao.sem-remoto', 'noctum.coordenacao.concorrencia', 'concurrency.limite']) {
    assert.equal(passageira(motivo), true, motivo);
  }
  for (const motivo of ['noctum.coordenacao.revogada', 'noctum.orcamento.sem-medicao']) assert.equal(passageira(motivo), false, motivo);
});

test('M19: a máquina em que a N6 encerrou o arco para de bater, encerra a ordem aceita sem sessão e recusa a que chega; a autoridade encerrada perde a vez para a tomada forçada', { skip: semKernel }, () => {
  const em = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  const recusa = (fn: () => unknown, motivo: string): void => {
    assert.throws(fn, (e: unknown) => e instanceof RecusaDoArco && e.motivo === motivo);
  };
  const m = cenario('noctum-m19');
  try {
    // A2 e A3 da revisão do merge com a N6: a B tem uma ordem aceita, sem sessão, e outra só emitida quando o arco fecha nela.
    coordenacao.bater(m.b.carregado, m.arco, { maquina: 'maquina-b' });
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, { maquina: 'maquina-a' });
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-b' }, { maquina: 'maquina-a' });
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', { maquina: 'maquina-b' });
    const batida = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' }).batidas.get('maquina-b');
    encerrarArco(m.b.dir, m.arco, { motivo: 'fila-vazia', detalhe: 'SIMULADO' });
    assert.equal(passo(m.b).acao, 'passo');
    const estado = lerCoordenacao(m.a.carregado, m.arco, { maquina: 'maquina-a' });
    assert.deepEqual([...estado.ordens.values()].map(o => [o.ordem, o.estado]), [['O-a-1', 'encerrada'], ['O-c-1', 'recusada']]);
    assert.match(String(estado.ordens.get('O-c-1')!.recibos.recusada!.motivo), /^noctum\.efeito\.encerrado: /);
    assert.deepEqual(estado.batidas.get('maquina-b'), batida, 'a B parou de bater');
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'livre', 'o trabalho da ordem encerrada pode mudar de máquina');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-m19b');
  try {
    // A autoridade A encerrada para de bater: enquanto o sinal dela vale, a tomada forçada recusa; vencido, a B a toma.
    coordenacao.bater(m2.b.carregado, m2.arco, { maquina: 'maquina-b' });
    encerrarArco(m2.a.dir, m2.arco, { motivo: 'custo', detalhe: 'SIMULADO' });
    passoDaMaquina(m2.a.carregado, m2.arco, { maquina: 'maquina-a', n2: n2Simulada(registro) });
    recusa(() => assumirAutoridade(m2.b.carregado, m2.arco, { maquina: 'maquina-b', forcar: { motivo: 'SIMULADO: a autoridade parou' } }),
      'noctum.coordenacao.autoridade-ativa');
    passoDaMaquina(m2.a.carregado, m2.arco, { maquina: 'maquina-a', quando: em(16), n2: n2Simulada(registro) });
    coordenacao.bater(m2.b.carregado, m2.arco, { maquina: 'maquina-b', quando: em(16) });
    const g2 = assumirAutoridade(m2.b.carregado, m2.arco, { maquina: 'maquina-b', quando: em(16), forcar: { motivo: 'SIMULADO: a autoridade encerrou' } });
    assert.deepEqual([g2.geracao, g2.maquina, g2.modo], [2, 'maquina-b', 'forcada']);
  } finally { m2.limpar(); }
});

test('M20: a reserva tomada por fora não encerra a ordem cuja sessão já está em execução', { skip: semKernel }, () => {
  const m = cenario('noctum-m20');
  try {
    passo(m.b);
    assert.equal(despachou(passo(m.a))?.trabalho, 'a');
    assert.equal(despachou(passo(m.b))?.trabalho, 'c');
    pegarItem(m.a.dir, 'RM-903', {
      maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'tomada forçada SIMULADA', forcar: true, motivo: 'SIMULADO: conferir a guarda da sessão viva',
    });
    // A B perde a reserva do item, mas a sessão do c já está em execução, com a vaga dela: a ordem fica, e o c não muda de máquina.
    const rb = passo(m.b);
    assert.ok(rb.acao === 'passo' && rb.relatorio.reservas.some(x => x.ordem === 'O-c-1' && !x.ok && x.motivo === 'noctum.reserva.de-outra-maquina'),
      JSON.stringify(rb.acao === 'passo' ? rb.relatorio.reservas : rb));
    const estado = lerCoordenacao(m.b.carregado, m.arco, { maquina: 'maquina-b' });
    assert.equal(estado.ordens.get('O-c-1')!.estado, 'aceita');
    assert.equal(situacaoDoTrabalho(estado, 'c')!.estado, 'em-execucao');
    assert.equal(estado.vagas.some(v => v.ordem === 'O-c-1' && v.solta === null), true);
  } finally { m.limpar(); }
});

test('M21: a reconciliação exportada usa a trava do passo: recusa outra reconciliação e o passo em curso desta máquina', { skip: semKernel }, () => {
  const original = reservasDoRoadmap.listarReservas;
  // Dentro da primeira leitura das reservas de quem já segura a trava da máquina, a reconciliação exportada é tentada.
  const tentarDentro = (m: DuasMaquinas, segurando: () => unknown): unknown => {
    let concorrencia: unknown = null;
    let sondou = false;
    (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = (raiz, opcoes) => {
      if (!sondou) {
        sondou = true;
        try { reconciliarMaquina(m.b.carregado, m.arco, { maquina: 'maquina-b' }); } catch (e) { concorrencia = e; }
      }
      return original(raiz, opcoes);
    };
    try { segurando(); } finally { (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = original; }
    return concorrencia;
  };
  const quem: Array<[string, (m: DuasMaquinas) => unknown]> = [
    ['reconciliacao', m => reconciliarMaquina(m.b.carregado, m.arco, { maquina: 'maquina-b' })],
    ['passo', m => passo(m.b)],
  ];
  for (const [nome, segurando] of quem) {
    const m = cenario(`noctum-m21-${nome}`);
    try {
      const e = tentarDentro(m, () => segurando(m));
      assert.ok(e instanceof RecusaDoArco && e.motivo === 'noctum.coordenacao.concorrencia', `${nome}: ${String(e)}`);
    } finally { m.limpar(); }
  }
  // Sem /usr/bin/flock não há a trava (a tentativa também não a dá), e a recusa diz a causa, em vez de culpar outro passo.
  const m = cenario('noctum-m21-sem-flock');
  const kernel = filaPesada.kernelDisponivel, travar = filaPesada.tentarTravaExclusiva;
  try {
    (filaPesada as { kernelDisponivel: typeof kernel }).kernelDisponivel = () => false;
    (filaPesada as { tentarTravaExclusiva: typeof travar }).tentarTravaExclusiva = () => null;
    assert.throws(() => reconciliarMaquina(m.b.carregado, m.arco, { maquina: 'maquina-b' }),
      (e: unknown) => e instanceof RecusaDoArco && e.motivo === 'noctum.coordenacao.concorrencia' && /sem \/usr\/bin\/flock/.test(e.message));
  } finally {
    (filaPesada as { kernelDisponivel: typeof kernel }).kernelDisponivel = kernel;
    (filaPesada as { tentarTravaExclusiva: typeof travar }).tentarTravaExclusiva = travar;
    m.limpar();
  }
});

test('M22: a ordem que perdeu a reserva com a vez de integrar sem prova espera, e o passo segue com a outra ordem', { skip: semKernel }, () => {
  const m = cenario('noctum-m22', 2, [
    { id: 'c', item: 'RM-903', prioridade: 1, dependeDe: [], pedido: 'Fatia C SIMULADA.' },
    { id: 'a', item: 'RM-901', prioridade: 2, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  ]);
  const opA = { maquina: 'maquina-a' }, opB = { maquina: 'maquina-b' };
  try {
    bater(m.b.carregado, m.arco, opB);
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-b' }, opA);
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, opA);
    responderOrdem(m.b.carregado, m.arco, 'O-c-1', 'aceita', 'SIMULADO', opB);
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', opB);
    // A vez de integrar do c terminou sem prova (a fonte chegou à base fora da cerca), sem vaga nenhuma da ordem.
    const destino = { repositorio: 'exemplo/produto', base: 'main' };
    const candidato = { branch: 'trabalho-c', fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) };
    gravarNaCoordenacao(m.b.carregado, m.arco, opB, () => ({ novos: [{ tipo: 'vez', chave: chaveDoDestino(destino), n: 1, destino, ordem: 'O-c-1',
      trabalho: 'c', candidato }], resultado: null }));
    gravarNaCoordenacao(m.b.carregado, m.arco, opB, () => ({ novos: [{ tipo: 'vez-fim', chave: chaveDoDestino(destino), n: 1, desfecho: 'sem-prova',
      motivo: 'base-nao-provada: SIMULADO', merge: null }], resultado: null }));
    pegarItem(m.a.dir, 'RM-903', { maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'tomada forçada SIMULADA', forcar: true,
      motivo: 'SIMULADO: reserva tomada por fora' });
    // O fim da ordem do c é recusado (o trabalho espera a inspeção do dono), e o passo segue: o a despacha.
    const rb = passo(m.b);
    assert.equal(despachou(rb)?.trabalho, 'a', JSON.stringify(rb.acao === 'aguardar' ? [rb.motivo, rb.detalhe] : rb.acao));
    assert.ok(rb.acao === 'passo' && rb.relatorio.reservas.some(x => x.ordem === 'O-c-1' && x.motivo === 'noctum.reserva.de-outra-maquina'));
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, opB).ordens.get('O-c-1')!.estado, 'aceita');
  } finally { m.limpar(); }
});

test('M23: a ordem que perdeu a reserva com a vez de integrar abandonada também espera, e a recusa de outro motivo no fim dela para o passo', { skip: semKernel }, () => {
  const opA = { maquina: 'maquina-a' }, opB = { maquina: 'maquina-b' };
  const destino = { repositorio: 'exemplo/produto', base: 'main' };
  // As ordens do c e do a aceitas pela B, a vez de integrar do c tomada (quando pedida) e a reserva do item dele tomada por fora.
  const preparar = (nome: string, vez: ((m: DuasMaquinas) => void) | null): DuasMaquinas => {
    const m = cenario(nome, 2, [
      { id: 'c', item: 'RM-903', prioridade: 1, dependeDe: [], pedido: 'Fatia C SIMULADA.' },
      { id: 'a', item: 'RM-901', prioridade: 2, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
    ]);
    try {
      bater(m.b.carregado, m.arco, opB);
      emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-b' }, opA);
      emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, opA);
      responderOrdem(m.b.carregado, m.arco, 'O-c-1', 'aceita', 'SIMULADO', opB);
      responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', opB);
      if (vez) {
        const candidato = { branch: 'trabalho-c', fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) };
        gravarNaCoordenacao(m.b.carregado, m.arco, opB, () => ({ novos: [{ tipo: 'vez', chave: chaveDoDestino(destino), n: 1, destino, ordem: 'O-c-1',
          trabalho: 'c', candidato }], resultado: null }));
        vez(m);
      }
      pegarItem(m.a.dir, 'RM-903', { maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'tomada forçada SIMULADA', forcar: true,
        motivo: 'SIMULADO: reserva tomada por fora' });
      return m;
    } catch (e) { m.limpar(); throw e; }
  };
  // A vez abandonada pela autoridade (o caminho do I9): o fim da ordem do c é recusado com nao-provada, e o passo segue com o a.
  const m = preparar('noctum-m23', (x) => {
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    gravarNaCoordenacao(x.a.carregado, x.arco, { ...opA, quando: tarde }, (l) =>
      ({ novos: registrosDosAbandonos(derivarCoordenacao(l), 'maquina-a', tarde), resultado: null }));
  });
  try {
    const rb = passo(m.b);
    assert.equal(despachou(rb)?.trabalho, 'a', JSON.stringify(rb.acao === 'aguardar' ? [rb.motivo, rb.detalhe] : rb.acao));
    const e = lerCoordenacao(m.b.carregado, m.arco, opB);
    assert.deepEqual([[...e.vezes.values()].flat().map(v => v.fim?.desfecho), e.ordens.get('O-c-1')!.estado], [['abandonada'], 'aceita']);
  } finally { m.limpar(); }
  // Uma recusa de outro motivo no fim da ordem (o ramo que não se grava agora) para o passo, sem despachar.
  const m2 = preparar('noctum-m23b', null);
  const encerrar = coordenacao.encerrarOrdem;
  try {
    (coordenacao as { encerrarOrdem: typeof encerrar }).encerrarOrdem = () => {
      throw new RecusaDoArco('noctum.coordenacao.sem-remoto', 'SIMULADO: o ramo de coordenação não se gravou agora');
    };
    const rb = passo(m2.b);
    assert.ok(rb.acao === 'aguardar' && rb.motivo === 'noctum.coordenacao.sem-remoto', JSON.stringify(rb.acao === 'aguardar' ? rb.motivo : rb.acao));
    assert.equal(lerCoordenacao(m2.b.carregado, m2.arco, opB).ordens.get('O-c-1')!.estado, 'aceita');
  } finally { (coordenacao as { encerrarOrdem: typeof encerrar }).encerrarOrdem = encerrar; m2.limpar(); }
});

function passoComNumero(p: ReturnType<typeof projetoTemporario>, arco: string, trabalho: string, item: string, numero: number) {
  const n2 = n2Simulada([]);
  return passoDoArco(p.carregado, arco, { ...n2, maquina: 'maquina-a',
    lerReservas: () => ({ leitura: 'copia-local' as const, reservas: [{ item, maquina: 'maquina-a', thread: null }] }),
    coordenacao: { trabalhos: new Set([trabalho]), entregues: new Map(), encerrados: new Set(), emOutraMaquina: new Set(),
      ordens: new Map([[trabalho, { ordem: `O-${trabalho}-${numero}`, numero }]]), reservar: reservarDespacho } });
}

test('M24: o passo da máquina passa a ordem aceita à N2', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-m24');
  try {
    abrirArco(p.dir, 'arco-m24', { trabalhos: [{ id: 'x', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'X SIMULADA.' }] });
    const r = passoComNumero(p, 'arco-m24', 'x', 'RM-901', 4);
    assert.equal(r.acao, 'despachou');
    const th = listarIds(p.dir).map(id => lerThread(p.dir, id))[0];
    assert.equal(th.assunto.endsWith('o4'), true);
  } finally { p.limpar(); }
});

test('M25: a thread da ordem n nasce com o número no assunto', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-m25');
  try {
    abrirArco(p.dir, 'arco-m25', { trabalhos: [{ id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'A SIMULADA.' }] });
    passoComNumero(p, 'arco-m25', 'a', 'RM-901', 7);
    assert.equal(lerThread(p.dir, listarIds(p.dir)[0]).assunto, 'rm901ao7');
  } finally { p.limpar(); }
});

test('M26: o trabalho de id longo é cortado sem perder o sufixo da ordem', { skip: semKernel }, () => {
  const p = projetoTemporario('noctum-m26');
  try {
    const trabalho = 'trabalho-com-id-longo';
    abrirArco(p.dir, 'arco-m26', { trabalhos: [{ id: trabalho, item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'LONGO SIMULADO.' }] });
    passoComNumero(p, 'arco-m26', trabalho, 'RM-901', 12);
    const assunto = lerThread(p.dir, listarIds(p.dir)[0]).assunto;
    assert.equal(assunto.length <= 12 && assunto.endsWith('o12'), true, assunto);
  } finally { p.limpar(); }
});

test('M27: uma ordem nova do mesmo trabalho abre outra thread e outra branch', { skip: semKernel }, () => {
  const antiga = projetoTemporario('noctum-m27-antiga');
  const nova = projetoTemporario('noctum-m27-nova');
  try {
    const trabalho = [{ id: 'x', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'X SIMULADA.' }];
    abrirArco(antiga.dir, 'arco-m27', { trabalhos: trabalho });
    abrirArco(nova.dir, 'arco-m27', { trabalhos: trabalho });
    passoComNumero(antiga, 'arco-m27', 'x', 'RM-901', 1);
    passoComNumero(nova, 'arco-m27', 'x', 'RM-901', 2);
    const threads = [lerThread(antiga.dir, listarIds(antiga.dir)[0]), lerThread(nova.dir, listarIds(nova.dir)[0])]
      .sort((a, b) => a.assunto.localeCompare(b.assunto));
    assert.deepEqual(threads.map(t => t.assunto), ['rm901xo1', 'rm901xo2']);
    assert.notEqual(threads[0].id, threads[1].id);
  } finally { antiga.limpar(); nova.limpar(); }
});
