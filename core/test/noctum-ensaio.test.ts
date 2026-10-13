/**
 * RM-058 (N3): o aceite da tabela de fatias, como ensaio. Duas máquinas são duas raízes de estado (dois clones de um remoto
 * bare de fixture) e dois processos na mesma máquina; o despacho, as sessões, as contas e os itens são SIMULADOS. Prova um
 * vencedor por item, o limite global por conta e um integrador por destino; que queda, partição e retorno do executor
 * antigo não duplicam escrita nem entrega; e que base alterada invalida o candidato. Nada toca remoto de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from '../src/util';
import { prepararIngressoSimulado } from './noctum-apoio';
import {
  atualizarBranch, branchDeTrabalho, duasMaquinas, DuasMaquinas, integradorPorAvanco, n2Simulada, provasSimuladas,
} from './noctum-maquinas-apoio';
import { kernelDisponivel } from '../src/fila-pesada';
import { registrar } from '../src/ledger';
import { lerArco } from '../src/noctum-arco';
import {
  assumirAutoridade, BATIDA_VENCIDA_MS, cancelarOrdem, emitirOrdem, lerCoordenacao, reservaDestaMaquina, responderOrdem, situacaoDoTrabalho,
} from '../src/noctum-coordenacao';
import { integrarComVez } from '../src/noctum-integracao';
import { passoDaMaquina } from '../src/noctum-maquinas';
import { BRANCH_DE_COORDENACAO } from '../src/noctum-transporte';
import { RecusaDoArco } from '../src/noctum-envelope';
import { dirThread, lerThread, listarIds } from '../src/thread';

prepararIngressoSimulado();
const semKernel = !kernelDisponivel();
const EXECUTOR = path.join(__dirname, 'noctum-ensaio-executor.js');
const DESTINO = { repositorio: 'exemplo/produto', base: 'main' };

type Trabalho = { id: string; item: string; prioridade: number; dependeDe: string[]; pedido: string; maquina?: string };
const trabalhos = (n: number): Trabalho[] => Array.from({ length: n }, (_, i) =>
  ({ id: `t${i + 1}`, item: `RM-${921 + i}`, prioridade: 1, dependeDe: [], pedido: `Fatia ${i + 1} SIMULADA do ensaio.` }));

function cenario(nome: string, o: { n?: number; global?: number; lista?: Trabalho[] } = {}): DuasMaquinas {
  return duasMaquinas(nome, { trabalhos: (o.lista ?? trabalhos(o.n ?? 3)).map(t => ({ ...t })), maquina: 2, revisao: 0,
    contas: [{ conta: 'perfil-a', sessoes: 2 }], runtimes: [{ runtime: 'claude-bg', sessoes: 2 }], global: [{ conta: 'perfil-a', sessoes: o.global ?? 2 }] });
}

interface Saida { codigo: number | null; sinal: string | null; json: Record<string, unknown> | null; erro: string }

/** Um processo filho que é uma das máquinas do ensaio. */
function rodar(pedido: Record<string, unknown>): Promise<Saida> {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [EXECUTOR, JSON.stringify(pedido)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    filho.stdout.on('data', (d) => { saida += String(d); });
    filho.stderr.on('data', (d) => { erro += String(d); });
    filho.once('exit', (codigo, sinal) => {
      let json: Record<string, unknown> | null = null;
      try { json = saida ? JSON.parse(saida) as Record<string, unknown> : null; } catch { json = null; }
      resolve({ codigo, sinal, json, erro });
    });
  });
}

/** Os dois processos começam juntos, pelo arquivo de sinal. */
async function juntos(m: DuasMaquinas, a: Record<string, unknown>, b: Record<string, unknown>): Promise<[Saida, Saida]> {
  const sinal = path.join(path.dirname(m.remoto), `sinal-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const corrida = Promise.all([rodar({ ...a, sinal }), rodar({ ...b, sinal })]);
  fs.writeFileSync(sinal, '');
  return corrida as Promise<[Saida, Saida]>;
}

const base = (m: DuasMaquinas, quem: 'a' | 'b') => ({ dir: m[quem].dir, maquina: m[quem].nome, arco: m.arco });
const op = (m: DuasMaquinas, quem: 'a' | 'b', quando?: string) => ({ maquina: m[quem].nome, ...(quando ? { quando } : {}) });
const mainNoRemoto = (m: DuasMaquinas) => exec('git', ['ls-remote', m.remoto, 'refs/heads/main'], m.a.dir).stdout.split(/\s+/)[0];
const threadsDoItem = (dir: string, item: string) => listarIds(dir).map(id => lerThread(dir, id)).filter(t => t.roadmap === item);

/**
 * Refaz a história do ramo commit a commit e devolve o maior número de vagas ativas da conta ao mesmo tempo. A vaga é
 * ativa do commit que a acrescenta até o que acrescenta a soltura dela.
 */
function picoDeVagas(m: DuasMaquinas): number {
  const remota = `refs/remotes/origin/${BRANCH_DE_COORDENACAO}`;
  exec('git', ['fetch', '-q', 'origin', `+refs/heads/${BRANCH_DE_COORDENACAO}:${remota}`], m.a.dir);
  const commits = exec('git', ['rev-list', '--reverse', remota], m.a.dir).stdout.split('\n').filter(Boolean);
  let pico = 0;
  for (const c of commits) {
    const nomes = exec('git', ['ls-tree', '-r', '--name-only', c, '--', `arcos/${m.arco}/vagas/`], m.a.dir).stdout.split('\n').filter(Boolean);
    const soltas = new Set(nomes.filter(n => n.endsWith('.solta.json')).map(n => n.replace(/[.]solta[.]json$/, '.json')));
    pico = Math.max(pico, nomes.filter(n => !n.endsWith('.solta.json') && !soltas.has(n)).length);
  }
  return pico;
}

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

test('R1: dois processos disputam a autoridade do arco: um fica com a geração 1, o outro é recusado', { skip: semKernel }, async () => {
  const m = cenario('noctum-r1');
  try {
    const [a, b] = await juntos(m, { ...base(m, 'a'), modo: 'assumir' }, { ...base(m, 'b'), modo: 'assumir' });
    const saidas = [a.json, b.json].map(j => j?.geracao === 1 ? 'g1' : String(j?.recusa)).sort();
    assert.deepEqual(saidas, ['g1', 'noctum.coordenacao.autoridade-ativa'], JSON.stringify([a, b]));
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.equal(estado.autoridades.length, 1);
  } finally { m.limpar(); }
});

test('R2: dois executores ao mesmo tempo entregam tudo, com uma máquina por item e nunca acima do limite global da conta', { skip: semKernel }, async () => {
  const m = cenario('noctum-r2', { n: 4, global: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m, 'a'));
    // A B bate antes, para a primeira distribuição já contar com ela.
    passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada() });
    const [a, b] = await juntos(m, { ...base(m, 'a'), modo: 'passos', passos: 25 }, { ...base(m, 'b'), modo: 'passos', passos: 25 });
    assert.ok(a.codigo === 0 && b.codigo === 0, `${a.erro}\n${b.erro}`);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.deepEqual([...estado.trabalhos.values()].map(t => t.estado), ['entregue', 'entregue', 'entregue', 'entregue'],
      JSON.stringify({ a: a.json, b: b.json }));
    // Um vencedor por item: cada item tem uma thread, numa máquina só, e um despacho só.
    for (const t of trabalhos(4)) {
      const ondeA = threadsDoItem(m.a.dir, t.item).length, ondeB = threadsDoItem(m.b.dir, t.item).length;
      assert.equal(ondeA + ondeB, 1, `${t.item}: ${ondeA} thread(s) na A e ${ondeB} na B`);
    }
    const despachosA = lerArco(m.a.dir, m.arco)!.despachos.filter(d => d.desfecho === 'concluido').map(d => d.trabalho);
    const despachosB = lerArco(m.b.dir, m.arco)!.despachos.filter(d => d.desfecho === 'concluido').map(d => d.trabalho);
    assert.deepEqual([...despachosA, ...despachosB].sort(), ['t1', 't2', 't3', 't4'], 'cada trabalho despachou uma vez, numa máquina');
    assert.ok(despachosA.length >= 1 && despachosB.length >= 1, `as duas máquinas trabalharam: A ${despachosA} e B ${despachosB}`);
    // O limite global da conta, refazendo o ramo commit a commit: nunca mais de 2 vagas ativas, somando as máquinas.
    const pico = picoDeVagas(m);
    assert.ok(pico >= 1 && pico <= 2, `pico de ${pico} vagas`);
    assert.equal(estado.consumo.arco, 4, 'quatro sessões consumidas no teto do arco, somando as máquinas');
    // E cada ordem que viveu terminou com prova: nenhuma ficou viva nem isolada.
    assert.ok([...estado.ordens.values()].every(o => o.estado === 'concluida'), JSON.stringify([...estado.ordens.values()].map(o => [o.ordem, o.estado])));
  } finally { m.limpar(); }
});

test('R3: dois integradores no mesmo destino: um entrega primeiro; o outro espera ou tem o candidato invalidado pela base nova', { skip: semKernel }, async () => {
  const m = cenario('noctum-r3', { n: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m, 'a'));
    passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada() });
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 't1', maquina: 'maquina-a' }, op(m, 'a'));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 't2', maquina: 'maquina-b' }, op(m, 'a'));
    responderOrdem(m.a.carregado, m.arco, 'O-t1-1', 'aceita', 'SIMULADO', op(m, 'a'));
    responderOrdem(m.b.carregado, m.arco, 'O-t2-1', 'aceita', 'SIMULADO', op(m, 'b'));
    const ca = { ...branchDeTrabalho(m.a.dir, 'trabalho-t1', 't1.txt', 'T1 SIMULADO\n'), provas: provasSimuladas('t1') };
    const cb = { ...branchDeTrabalho(m.b.dir, 'trabalho-t2', 't2.txt', 'T2 SIMULADO\n'), provas: provasSimuladas('t2') };
    assert.equal(ca.base, cb.base, 'os dois candidatos foram provados sobre a mesma base');
    const [a, b] = await juntos(m,
      { ...base(m, 'a'), modo: 'integrar', integracao: { ordem: 'O-t1-1', destino: DESTINO, candidato: ca } },
      { ...base(m, 'b'), modo: 'integrar', integracao: { ordem: 'O-t2-1', destino: DESTINO, candidato: cb } });
    const feitos = [a, b].filter(s => s.json?.feito);
    const perdeu = [a, b].find(s => !s.json?.feito)!;
    assert.equal(feitos.length, 1, JSON.stringify([a.json, b.json]));
    assert.ok(['noctum.integracao.ocupada', 'noctum.integracao.base-mudou'].includes(String(perdeu.json?.recusa)), JSON.stringify(perdeu.json));
    const vencedor = feitos[0] === a ? { m: 'a' as const, c: ca, o: 'O-t1-1' } : { m: 'b' as const, c: cb, o: 'O-t2-1' };
    const outro = vencedor.m === 'a' ? { m: 'b' as const, c: cb, o: 'O-t2-1', branch: 'trabalho-t2' } : { m: 'a' as const, c: ca, o: 'O-t1-1', branch: 'trabalho-t1' };
    assert.equal(mainNoRemoto(m), vencedor.c.fonte);
    // Base alterada invalida o candidato antigo do perdedor, qualquer que tenha sido a ordem da corrida.
    recusa(() => integrarComVez(m[outro.m].carregado, m.arco, { ordem: outro.o, destino: DESTINO, candidato: outro.c }, integradorPorAvanco(m[outro.m].dir),
      op(m, outro.m)), 'noctum.integracao.base-mudou');
    // Atualizado e com as provas refeitas, ele entrega.
    const novo = { ...atualizarBranch(m[outro.m].dir, outro.branch), provas: provasSimuladas(`${outro.o}-de-novo`) };
    const feito = integrarComVez(m[outro.m].carregado, m.arco, { ordem: outro.o, destino: DESTINO, candidato: novo }, integradorPorAvanco(m[outro.m].dir), op(m, outro.m));
    assert.equal(mainNoRemoto(m), feito.merge);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.deepEqual([...estado.entregas.keys()].sort(), ['t1', 't2']);
    const vezes = [...estado.vezes.values()].flat();
    assert.equal(vezes.filter(v => v.fim?.desfecho === 'entregue').length, 2, 'uma entrega por trabalho');
    assert.ok(vezes.some(v => v.fim?.desfecho === 'invalidado' && /^base-mudou/.test(v.fim.motivo)));
  } finally { m.limpar(); }
});

test('R4: o executor cai com a sessão de pé: o item fica isolado e os outros seguem; na volta ele confirma o fim e não despacha de novo', { skip: semKernel }, async () => {
  const m = cenario('noctum-r4', { lista: [
    { id: 't1', item: 'RM-931', prioridade: 1, dependeDe: [], pedido: 'Fatia 1 SIMULADA, da B.', maquina: 'maquina-b' },
    { id: 't2', item: 'RM-932', prioridade: 2, dependeDe: [], pedido: 'Fatia 2 SIMULADA, da A.', maquina: 'maquina-a' },
  ] });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m, 'a'));
    passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada() });
    passoDaMaquina(m.a.carregado, m.arco, { ...op(m, 'a'), n2: n2Simulada() });
    const marca = path.join(path.dirname(m.remoto), 'marca-r4');
    const caiu = await rodar({ ...base(m, 'b'), modo: 'despachar-e-cair', marca });
    assert.equal(caiu.sinal, 'SIGKILL');
    assert.deepEqual(JSON.parse(fs.readFileSync(marca, 'utf8')), ['despachou', 't1'], 'a B despachou o t1 antes de cair');
    // A autoridade cancela a ordem da B: sem prova de que ela parou, o t1 fica isolado e não muda de máquina.
    assert.equal(cancelarOrdem(m.a.carregado, m.arco, 'O-t1-1', 'SIMULADO: a B parou de bater', op(m, 'a')), 'isolada');
    let estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.equal(situacaoDoTrabalho(estado, 't1')!.estado, 'isolado');
    assert.equal(estado.vagas.filter(v => !v.solta && v.maquina === 'maquina-b').length, 1, 'a vaga da máquina caída continua contando');
    // O outro item segue na A, e o t1 não vai para lá.
    const ra = passoDaMaquina(m.a.carregado, m.arco, { ...op(m, 'a'), n2: n2Simulada() });
    // As duas vagas da conta, somando as máquinas, estão com a sessão do t2 e a da B que caiu: a A espera a vaga, sem ordem nova.
    assert.ok(ra.acao !== 'uma-maquina' && !ra.relatorio.ordensEmitidas.length, 'nenhuma ordem nova para o t1');
    assert.ok(ra.acao === 'aguardar' && ra.motivo === 'noctum.coordenacao.vaga-global', JSON.stringify(ra.acao));
    assert.equal(threadsDoItem(m.a.dir, 'RM-932').length, 1, 'o t2 andou na A');
    assert.ok(lerArco(m.a.dir, m.arco)!.despachos.some(d => d.trabalho === 't2' && d.desfecho === 'concluido'));
    assert.equal(threadsDoItem(m.a.dir, 'RM-931').length, 0, 'o t1 não foi para a A');
    // A sessão da B acabou enquanto ela estava fora (o resultado da fase no ledger dela); a B volta e reconcilia.
    const thread = threadsDoItem(m.b.dir, 'RM-931')[0];
    const sessao = String(lerArco(m.b.dir, m.arco)!.despachos.find(d => d.trabalho === 't1')!.sessionId);
    registrar(dirThread(m.b.dir, thread.id), thread.id, 'phase_result', { fase: 'GOAL', sessionId: sessao, classificacao: 'fase_concluida', ok: true });
    const despachosAntes = lerArco(m.b.dir, m.arco)!.despachos.length;
    const rb = passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada() });
    assert.ok(rb.acao === 'passo' && rb.relatorio.reconciliacao!.encerradas.includes('O-t1-1'), JSON.stringify(rb.acao === 'passo' ? rb.relatorio : rb));
    assert.equal(lerArco(m.b.dir, m.arco)!.despachos.length, despachosAntes, 'a B não despachou de novo o que lhe tiraram');
    assert.equal(reservaDestaMaquina(m.b.carregado, 'RM-931', op(m, 'b'))!.com, null, 'a reserva voltou');
    estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.equal(situacaoDoTrabalho(estado, 't1')!.estado, 'livre', 'com a prova, o t1 pode mudar de máquina');
  } finally { m.limpar(); }
});

test('R5: o executor partido não grava nem despacha; na volta rejeita a ordem vencida e não despacha de novo', { skip: semKernel }, () => {
  const m = cenario('noctum-r5', { lista: [
    { id: 't1', item: 'RM-941', prioridade: 1, dependeDe: [], pedido: 'Fatia 1 SIMULADA, da B.', maquina: 'maquina-b' },
  ] });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m, 'a'));
    const registro: string[] = [];
    passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada(registro) });
    passoDaMaquina(m.a.carregado, m.arco, { ...op(m, 'a'), n2: n2Simulada() });
    const r1 = passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada(registro) });
    assert.ok(r1.acao === 'passo' && r1.passo.acao === 'despachou', JSON.stringify(r1.acao));
    // A partição: a B perde o remoto; a autoridade cancela a ordem dela nesse meio tempo.
    exec('git', ['remote', 'set-url', 'origin', path.join(path.dirname(m.remoto), 'fora-do-ar.git')], m.b.dir);
    cancelarOrdem(m.a.carregado, m.arco, 'O-t1-1', 'SIMULADO: a B sumiu da rede', op(m, 'a'));
    const batidaAntes = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a')).batidas.get('maquina-b');
    const partida = passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada(registro) });
    assert.ok(partida.acao === 'aguardar' && partida.motivo === 'noctum.coordenacao.sem-remoto');
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m, 'a')).batidas.get('maquina-b'), batidaAntes, 'a B partida não gravou nada');
    // A volta: a sessão acabou sem entrega enquanto a B estava fora; ela rejeita a ordem vencida com o recibo e não despacha
    // o t1 de novo.
    exec('git', ['remote', 'set-url', 'origin', m.remoto], m.b.dir);
    const thread = threadsDoItem(m.b.dir, 'RM-941')[0];
    registrar(dirThread(m.b.dir, thread.id), thread.id, 'phase_result', { fase: 'GOAL', sessionId: registro[0].split(':')[3],
      classificacao: 'fase_concluida', ok: true });
    const r2 = passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada(registro) });
    assert.ok(r2.acao === 'passo' && r2.relatorio.reconciliacao!.encerradas.includes('O-t1-1'), JSON.stringify(r2.acao === 'passo' ? r2.relatorio : r2));
    assert.ok(r2.acao === 'passo' && r2.passo.acao !== 'despachou');
    assert.equal(registro.length, 1, 'um despacho só, em toda a história');
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.equal(estado.ordens.get('O-t1-1')!.estado, 'encerrada');
    assert.match(String(estado.ordens.get('O-t1-1')!.recibos.encerrada!.motivo), /cancelada pela autoridade: SIMULADO: a B sumiu da rede/);
    assert.equal(situacaoDoTrabalho(estado, 't1')!.estado, 'livre');
  } finally { m.limpar(); }
});

test('R6: o merge chega à base e o integrador cai antes do registro: na volta a entrega é registrada sem integrar de novo', { skip: semKernel }, async () => {
  const m = cenario('noctum-r6', { n: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m, 'a'));
    passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada() });
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 't1', maquina: 'maquina-b' }, op(m, 'a'));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 't2', maquina: 'maquina-a' }, op(m, 'a'));
    responderOrdem(m.b.carregado, m.arco, 'O-t1-1', 'aceita', 'SIMULADO', op(m, 'b'));
    responderOrdem(m.a.carregado, m.arco, 'O-t2-1', 'aceita', 'SIMULADO', op(m, 'a'));
    const cb = { ...branchDeTrabalho(m.b.dir, 'trabalho-t1', 't1.txt', 'T1 SIMULADO\n'), provas: provasSimuladas('t1') };
    // A A prova o candidato dela sobre a mesma base, antes do merge da B.
    const ca = { ...branchDeTrabalho(m.a.dir, 'trabalho-t2', 't2.txt', 'T2 SIMULADO\n'), provas: provasSimuladas('t2') };
    assert.equal(ca.base, cb.base);
    const caiu = await rodar({ ...base(m, 'b'), modo: 'integrar-e-cair', integracao: { ordem: 'O-t1-1', destino: DESTINO, candidato: cb } });
    assert.equal(caiu.sinal, 'SIGKILL');
    const merge = mainNoRemoto(m);
    assert.equal(merge, cb.fonte, 'o merge chegou à base');
    // A outra máquina não integra no destino com a vez da B de pé.
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-t2-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m, 'a')),
      'noctum.integracao.ocupada');
    // A B volta: a reconciliação acha a fonte na base e registra a entrega, sem integrar de novo.
    const rb = passoDaMaquina(m.b.carregado, m.arco, { ...op(m, 'b'), n2: n2Simulada() });
    assert.ok(rb.acao === 'passo' && rb.relatorio.integracao!.registradas.some(x => x.trabalho === 't1' && x.merge === merge));
    assert.equal(mainNoRemoto(m), merge, 'nada foi integrado de novo');
    let estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.equal(situacaoDoTrabalho(estado, 't1')!.estado, 'entregue');
    assert.equal(estado.entregas.get('t1')!.merge, merge);
    // A A, que provou sobre a base velha, tem o candidato invalidado, atualiza e entrega.
    recusa(() => integrarComVez(m.a.carregado, m.arco, { ordem: 'O-t2-1', destino: DESTINO, candidato: ca }, integradorPorAvanco(m.a.dir), op(m, 'a')),
      'noctum.integracao.base-mudou');
    const novo = { ...atualizarBranch(m.a.dir, 'trabalho-t2'), provas: provasSimuladas('t2-de-novo') };
    integrarComVez(m.a.carregado, m.arco, { ordem: 'O-t2-1', destino: DESTINO, candidato: novo }, integradorPorAvanco(m.a.dir), op(m, 'a'));
    estado = lerCoordenacao(m.a.carregado, m.arco, op(m, 'a'));
    assert.deepEqual([...estado.entregas.keys()].sort(), ['t1', 't2']);
    assert.equal([...estado.vezes.values()].flat().filter(v => v.fim?.desfecho === 'entregue' && v.trabalho === 't1').length, 1, 'o t1 entregou uma vez');
  } finally { m.limpar(); }
});

test('R7: a autoridade antiga, partida, perde a vez para a tomada forçada e na volta não emite mais nada', { skip: semKernel }, () => {
  const m = cenario('noctum-r7', { n: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m, 'a'));
    passoDaMaquina(m.a.carregado, m.arco, { ...op(m, 'a'), n2: n2Simulada() });
    exec('git', ['remote', 'set-url', 'origin', path.join(path.dirname(m.remoto), 'fora-do-ar.git')], m.a.dir);
    const tarde = new Date(Date.now() + BATIDA_VENCIDA_MS + 60_000).toISOString();
    const g2 = assumirAutoridade(m.b.carregado, m.arco, { ...op(m, 'b', tarde), forcar: { motivo: 'SIMULADO: a autoridade sumiu' } });
    assert.equal(g2.geracao, 2);
    exec('git', ['remote', 'set-url', 'origin', m.remoto], m.a.dir);
    const ordensAntes = lerCoordenacao(m.b.carregado, m.arco, op(m, 'b', tarde)).ordens.size;
    const ra = passoDaMaquina(m.a.carregado, m.arco, { ...op(m, 'a', tarde), n2: n2Simulada() });
    assert.ok(ra.acao === 'passo' && ra.relatorio.ordensEmitidas.length === 0 && ra.relatorio.autoridade?.maquina === 'maquina-b');
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 't2', maquina: 'maquina-a' }, op(m, 'a', tarde)), 'noctum.coordenacao.geracao-vencida');
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, op(m, 'b', tarde)).ordens.size, ordensAntes, 'a antiga não emitiu nada');
  } finally { m.limpar(); }
});
