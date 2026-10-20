/**
 * RM-058 (N3): a coordenação entre máquinas sobre o ramo assinado. Duas "máquinas" são dois clones de um remoto bare de
 * fixture; contas, máquinas, itens e pedidos são SIMULADOS, e nada toca remoto, reserva ou raiz de verdade.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { autorizarPedido, prepararIngressoSimulado } from './noctum-apoio';
import { cloneDoRemoto, duasMaquinas, DuasMaquinas, gravarCru, MaquinaDeTeste } from './noctum-maquinas-apoio';
import { exigirManifesto } from '../src/manifest';
import { encerrarArco } from '../src/noctum-arco';
import { RecusaDoArco } from '../src/noctum-envelope';
import * as reservasDoRoadmap from '../src/roadmap-reservas';
import { pegarItem, soltarItem } from '../src/roadmap-reservas';
import { assinarDados, caminhoDoRegistro, DadosDoRegistro, gravarNoRamo, identidadeDaMaquina } from '../src/noctum-transporte';
import { reconciliarIntegracao } from '../src/noctum-integracao';
import {
  assumirAutoridade, bater, BATIDA_VENCIDA_MS, cancelarOrdem, cederAutoridade, concluirOrdem, distribuirOrdens, emitirOrdem,
  encerrarOrdem, entreguesNaRede, FatosLocaisDaMaquina, gravarNaCoordenacao, lerCoordenacao, motivoDaReservaDeFora, planejarReconciliacao,
  reconciliarCoordenacao, registrosDosAbandonos, reservaDoItem, respostaAOrdem, responderOrdem, revogarNaRede, seloDaGeracao, situacaoDoTrabalho,
  soltarReservaDoArco, soltarVagaGlobal, tomarReservaDoTrabalho, tomarVagaGlobal,
} from '../src/noctum-coordenacao';
import { passar, revogarArco } from './noctum-apoio';
import { chaveDoDestino } from '../src/noctum-coordenacao';

prepararIngressoSimulado();

type TrabalhoV3 = { id: string; item: string; prioridade: number; dependeDe: string[]; pedido?: string; thread?: string; maquina?: string };

const SIMPLES: TrabalhoV3[] = [
  { id: 'a', item: 'RM-901', prioridade: 1, dependeDe: [], pedido: 'Fatia A SIMULADA.' },
  { id: 'b', item: 'RM-902', prioridade: 2, dependeDe: ['a'], pedido: 'Fatia B SIMULADA, depois da A.' },
  { id: 'c', item: 'RM-903', prioridade: 3, dependeDe: [], pedido: 'Fatia C SIMULADA.', maquina: 'maquina-b' },
  { id: 'd', item: 'RM-904', prioridade: 4, dependeDe: [], pedido: 'Fatia D SIMULADA.' },
  { id: 'e', item: 'RM-904', prioridade: 5, dependeDe: [], pedido: 'Fatia E SIMULADA, do mesmo item da D.' },
];

function cenario(nome: string, o: { trabalhos?: TrabalhoV3[]; global?: number; teto?: number; maquina?: number; revisao?: number } = {}): DuasMaquinas {
  return duasMaquinas(nome, { trabalhos: (o.trabalhos ?? SIMPLES).map(t => ({ ...t })), maquina: o.maquina ?? 3, revisao: o.revisao ?? 0,
    contas: [{ conta: 'perfil-a', sessoes: 2 }], global: [{ conta: 'perfil-a', sessoes: o.global ?? 2 }], tetoDoArco: o.teto ?? 40 });
}

const op = (m: MaquinaDeTeste, quando?: string) => ({ maquina: m.nome, ...(quando ? { quando } : {}) });

function recusa(fn: () => unknown, motivo: string): string {
  try { fn(); } catch (e) {
    assert.ok(e instanceof RecusaDoArco, `esperava RecusaDoArco, veio ${String(e)}`);
    assert.equal(e.motivo, motivo, e.message);
    return e.message;
  }
  assert.fail(`esperava a recusa ${motivo}`);
}

const depois = (ms: number) => new Date(Date.now() + ms).toISOString();
/** Nenhuma reserva lida: o item que não está no mapa está livre. */
const LIVRES = new Map();

test('K1: a primeira máquina fica com a geração 1; a troca só vem por cessão ou tomada forçada com a batida vencida', () => {
  const m = cenario('noctum-k1');
  try {
    const g1 = assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual([g1.geracao, g1.maquina, g1.modo], [1, 'maquina-a', 'primeira']);
    const ponta = lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta;
    assert.equal(assumirAutoridade(m.a.carregado, m.arco, op(m.a)).geracao, 1, 'a própria é idempotente');
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta, ponta, 'e não grava nada');
    assert.match(recusa(() => assumirAutoridade(m.b.carregado, m.arco, op(m.b)), 'noctum.coordenacao.autoridade-ativa'),
      /a autoridade vigente é maquina-a, geração 1; troca só por cessão dela ou tomada forçada/);
    // S2 da revisão: a autoridade que acabou de assumir e nunca bateu deu sinal ao assumir; não cai à força logo depois.
    assert.match(recusa(() => assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b), forcar: { motivo: 'SIMULADO: a autoridade parou' } }),
      'noctum.coordenacao.autoridade-ativa'), /deu sinal há menos de 15 min/);
    bater(m.a.carregado, m.arco, op(m.a));
    assert.match(recusa(() => assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b), forcar: { motivo: 'SIMULADO: a autoridade parou' } }),
      'noctum.coordenacao.autoridade-ativa'), /deu sinal há menos de 15 min/);
    // Dezesseis minutos depois, sem batida nova da A: a tomada forçada passa, com o motivo e a última batida vista.
    const tarde = depois(BATIDA_VENCIDA_MS + 60_000);
    const g2 = assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b, tarde), forcar: { motivo: 'SIMULADO: a autoridade parou' } });
    assert.deepEqual([g2.geracao, g2.maquina, g2.modo], [2, 'maquina-b', 'forcada']);
    // A autoridade antiga que volta não emite nem cancela.
    bater(m.b.carregado, m.arco, op(m.b, tarde));
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a, tarde)),
      'noctum.coordenacao.geracao-vencida'), /a vigente é maquina-b, geração 2/);
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b, tarde));
    assert.deepEqual(estado.autoridades.map(x => [x.geracao, x.maquina, x.modo]), [[1, 'maquina-a', 'primeira'], [2, 'maquina-b', 'forcada']]);
  } finally { m.limpar(); }
  const c = cenario('noctum-k1b');
  try {
    assumirAutoridade(c.a.carregado, c.arco, op(c.a));
    recusa(() => cederAutoridade(c.b.carregado, c.arco, 'maquina-a', 'SIMULADO', op(c.b)), 'noctum.coordenacao.autoridade-ativa');
    recusa(() => cederAutoridade(c.a.carregado, c.arco, 'maquina-z', 'SIMULADO', op(c.a)), 'noctum.coordenacao.fora-do-envelope');
    cederAutoridade(c.a.carregado, c.arco, 'maquina-b', 'SIMULADO: a A vai desligar', op(c.a));
    const g2 = assumirAutoridade(c.b.carregado, c.arco, op(c.b));
    assert.deepEqual([g2.geracao, g2.maquina, g2.modo], [2, 'maquina-b', 'cessao']);
  } finally { c.limpar(); }
});

test('K2: só a autoridade emite; uma ordem viva por trabalho, máquina presa, batida recente, dependências e o mesmo item na mesma máquina', () => {
  const m = cenario('noctum-k2');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    recusa(() => emitirOrdem(m.b.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.b)), 'noctum.coordenacao.autoridade-ativa');
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.maquina-sem-batida'),
      /maquina-b não dá sinal há mais de 15 min/);
    bater(m.b.carregado, m.arco, op(m.b));
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva'),
      /o trabalho a está ordenado \(ordem O-a-1\)/);
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.dependencia-pendente'),
      /depende de a, ainda não entregue/);
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.fora-do-envelope'),
      /preso à máquina maquina-b/);
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'zz', maquina: 'maquina-a' }, op(m.a)), 'noctum.despacho.fora-do-envelope');
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-z' }, op(m.a)), 'noctum.coordenacao.fora-do-envelope');
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a));
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'e', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva'),
      /o item RM-904 está com a máquina maquina-b \(trabalho d\)/);
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'e', maquina: 'maquina-b' }, op(m.a)), 'O-e-1');
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.deepEqual([...estado.ordens.keys()].sort(), ['O-a-1', 'O-d-1', 'O-e-1']);
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'ordenado');
  } finally { m.limpar(); }
});

test('K3: a política distribui na ordem do dono, para a máquina com menos ordens vivas, até as vagas de execução', () => {
  const m = cenario('noctum-k3', { maquina: 2, revisao: 1, trabalhos: [
    { id: 'p1', item: 'RM-911', prioridade: 1, dependeDe: [], pedido: 'P1 SIMULADA.' },
    { id: 'p2', item: 'RM-912', prioridade: 1, dependeDe: [], pedido: 'P2 SIMULADA.' },
    { id: 'p3', item: 'RM-913', prioridade: 2, dependeDe: [], pedido: 'P3 SIMULADA.' },
    { id: 'p4', item: 'RM-914', prioridade: 3, dependeDe: ['p1'], pedido: 'P4 SIMULADA, depois da P1.' },
  ] });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    const quando = new Date().toISOString();
    // Sem a batida da B, só a própria autoridade recebe, e uma ordem só (2 slots, 1 de revisão).
    assert.deepEqual(distribuirOrdens(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'maquina-a', quando, LIVRES), [{ trabalho: 'p1', maquina: 'maquina-a' }]);
    bater(m.b.carregado, m.arco, op(m.b));
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual(distribuirOrdens(estado, 'maquina-a', quando, LIVRES),
      [{ trabalho: 'p1', maquina: 'maquina-a' }, { trabalho: 'p2', maquina: 'maquina-b' }], 'p3 espera uma vaga; p4 espera a p1');
    assert.deepEqual(distribuirOrdens(estado, 'maquina-b', quando, LIVRES), [], 'quem não é a autoridade não distribui');
    // A reserva lida agora decide: o item da p1 reservado pela B leva a p1 para ela; o da p2 reservado fora do arco segura a p2.
    const reservas = new Map([['RM-911', { maquina: 'maquina-b', atualizadaEm: quando }], ['RM-912', { maquina: 'maquina-c', atualizadaEm: quando }]]);
    assert.deepEqual(distribuirOrdens(estado, 'maquina-a', quando, reservas),
      [{ trabalho: 'p1', maquina: 'maquina-b' }, { trabalho: 'p3', maquina: 'maquina-a' }]);
  } finally { m.limpar(); }
});

test('K4: o executor só responde a própria ordem; cancelada antes do aceite libera, depois isola até o fim confirmado', () => {
  const m = cenario('noctum-k4');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    recusa(() => responderOrdem(m.a.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.a)), 'noctum.coordenacao.ordem-vencida');
    // Cancelada antes do aceite: o trabalho fica livre na hora, e o aceite atrasado não passa.
    assert.equal(cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO: a B demorou', op(m.a)), 'cancelada-antes');
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'a')!.estado, 'livre');
    assert.match(recusa(() => responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b)), 'noctum.coordenacao.ordem-vencida'),
      /está cancelada-antes/);
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-2');
    assert.equal(responderOrdem(m.b.carregado, m.arco, 'O-a-2', 'aceita', 'SIMULADO', op(m.b)), 'aceita');
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'a')!.estado, 'em-execucao');
    // Cancelada depois do aceite: isolada, sem transferência, até o recibo do executor.
    assert.equal(cancelarOrdem(m.a.carregado, m.arco, 'O-a-2', 'SIMULADO: a B parou de bater', op(m.a)), 'isolada');
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'a')!.estado, 'isolado');
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva'),
      /o trabalho a está isolado/);
    recusa(() => encerrarOrdem(m.a.carregado, m.arco, 'O-a-2', { motivo: 'SIMULADO', checkpoint: {} }, op(m.a)), 'noctum.coordenacao.ordem-vencida');
    encerrarOrdem(m.b.carregado, m.arco, 'O-a-2', { motivo: 'cancelada pela autoridade', checkpoint: { thread: null } }, op(m.b));
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'a')!.estado, 'livre');
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a)), 'O-a-3', 'transferida com a prova');
    // A recusa também prova, e a mesma máquina não recebe de novo o que recusou nesta versão.
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-d-1', 'recusada', 'SIMULADO: sem a thread aqui', op(m.b));
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(situacaoDoTrabalho(estado, 'd')!.estado, 'livre');
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.maquina-recusou'),
      /maquina-b já recusou o trabalho d/);
    assert.ok(!distribuirOrdens(estado, 'maquina-a', new Date().toISOString(), LIVRES).some(x => x.trabalho === 'd' && x.maquina === 'maquina-b'));
    // Conclusão com entrega: o trabalho fica entregue na rede, e a dependência destrava.
    responderOrdem(m.a.carregado, m.arco, 'O-a-3', 'aceita', 'SIMULADO', op(m.a));
    concluirOrdem(m.a.carregado, m.arco, 'O-a-3', { resultado: 'entregue', thread: 'ork-simulada-a' }, op(m.a));
    const final = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.equal(situacaoDoTrabalho(final, 'a')!.estado, 'entregue');
    assert.ok(entreguesNaRede(final).has('a'));
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-b' }, op(m.a)), 'O-b-1', 'b dependia de a, entregue na outra máquina');
  } finally { m.limpar(); }
});

test('K5: ordem de outra versão do envelope é recusada pelo executor; o aceite exige o hash vigente aqui', () => {
  const m = cenario('noctum-k5');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    // A B autoriza uma emenda que a A ainda não autorizou: a ordem que a A emitiu é da versão anterior para a B.
    const emenda = { ...m.pedido, relatorio: { horario: '08:00', canal: 'telegram' } };
    autorizarPedido(m.b.dir, m.arco, emenda);
    // S7 da revisão: a resposta que o passo grava confere o hash antes de tudo, até com a thread e o arco em ordem.
    const daB = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.deepEqual(respostaAOrdem(daB, daB.ordens.get('O-a-1')!, 'maquina-b', { arcoVigente: true, threadsLocais: new Map() }),
      { recibo: 'recusada', motivo: 'noctum.efeito.hash-antigo: a ordem é de outra versão do envelope' });
    assert.match(recusa(() => responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b)), 'noctum.efeito.hash-antigo'),
      /é de outra versão do envelope/);
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'recusada', 'noctum.efeito.hash-antigo: a ordem é de outra versão do envelope', op(m.b));
    autorizarPedido(m.a.dir, m.arco, emenda);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(estado.ordens.get('O-a-1')!.estado, 'recusada');
    assert.equal(estado.vigente.envelopeSha256, lerCoordenacao(m.b.carregado, m.arco, op(m.b)).vigente.envelopeSha256);
  } finally { m.limpar(); }
});

test('K6: a reserva do item é tomada pelo executor da ordem aceita, revalidada, e nunca forçada; ela decide para onde a ordem vai', () => {
  const m = cenario('noctum-k6', { trabalhos: [...SIMPLES, { id: 'f', item: 'RM-906', prioridade: 6, dependeDe: [], pedido: 'Fatia F SIMULADA.' },
    { id: 'g', item: 'RM-907', prioridade: 7, dependeDe: [], pedido: 'Fatia G SIMULADA.' }] });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    recusa(() => tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-a-1', null, op(m.b)), 'noctum.coordenacao.ordem-vencida');
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    assert.deepEqual(tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-a-1', null, op(m.b)), { ok: true, acao: 'pegou' });
    assert.deepEqual(reservaDoItem(m.b.carregado, m.arco, 'RM-901', op(m.b)), { livre: false, minha: true, doArco: true });
    assert.equal(reservaDoItem(m.a.carregado, m.arco, 'RM-901', op(m.a))!.minha, false);
    assert.deepEqual(tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-a-1', null, op(m.b)), { ok: true, acao: 'revalidada' });
    // Aceita a ordem do d, o dono da A pega o RM-904 à mão antes da B: a B não força, e o detalhe não leva quem reservou.
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-d-1', 'aceita', 'SIMULADO', op(m.b));
    pegarItem(m.a.dir, 'RM-904', { maquina: 'maquina-a', nota: 'à mão, SIMULADO' });
    const r = tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-d-1', null, op(m.b));
    assert.deepEqual(r, { ok: false, motivo: 'noctum.reserva.de-outra-maquina', detalhe: 'o item RM-904 está com outra máquina ou pessoa' });
    // A reserva de fora do arco segura a ordem; a de uma máquina do arco a leva só para ela.
    pegarItem(m.a.dir, 'RM-906', { maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'SIMULADO' });
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'f', maquina: 'maquina-a' }, op(m.a)), 'noctum.reserva.de-outra-maquina'),
      /o item RM-906 está reservado fora do arco; a ordem espera a reserva ser solta/);
    pegarItem(m.a.dir, 'RM-907', { maquina: 'maquina-a', nota: 'à mão, SIMULADO' });
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'g', maquina: 'maquina-b' }, op(m.a)), 'noctum.reserva.de-outra-maquina'),
      /reservado pela máquina maquina-a do arco; a ordem vai para ela/);
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'g', maquina: 'maquina-a' }, op(m.a)), 'O-g-1');
    responderOrdem(m.a.carregado, m.arco, 'O-g-1', 'aceita', 'SIMULADO', op(m.a));
    // A reserva que o dono tomou à mão nesta máquina vale para o arco daqui, como na N2, e o arco nunca a solta.
    assert.deepEqual(tomarReservaDoTrabalho(m.a.carregado, m.arco, 'O-g-1', null, op(m.a)), { ok: true, acao: 'revalidada' });
    assert.equal(soltarReservaDoArco(m.a.carregado, m.arco, 'RM-907', op(m.a)), false, 'a do dono tem outra nota');
    // Só a reserva do arco, desta máquina, é solta, e só sem ordem viva dela no item (K27).
    assert.equal(soltarReservaDoArco(m.a.carregado, m.arco, 'RM-901', op(m.a)), false, 'a do RM-901 é da B');
    assert.equal(soltarReservaDoArco(m.b.carregado, m.arco, 'RM-901', op(m.b)), false, 'a O-a-1 está viva');
    encerrarOrdem(m.b.carregado, m.arco, 'O-a-1', { motivo: 'SIMULADO: fim', checkpoint: {} }, op(m.b));
    assert.equal(soltarReservaDoArco(m.b.carregado, m.arco, 'RM-901', op(m.b)), true);
    assert.equal(reservaDoItem(m.b.carregado, m.arco, 'RM-901', op(m.b))!.livre, true);
  } finally { m.limpar(); }
  // A revalidação com leitura nova depois de tomar: o pegar disse que tomou, mas outra pessoa ficou com o item.
  const m2 = cenario('noctum-k6b');
  const original = reservasDoRoadmap.pegarItem;
  try {
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    bater(m2.b.carregado, m2.arco, op(m2.b));
    emitirOrdem(m2.a.carregado, m2.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m2.a));
    responderOrdem(m2.b.carregado, m2.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m2.b));
    (reservasDoRoadmap as { pegarItem: typeof original }).pegarItem = (raiz, item) => {
      original(raiz, item, { maquina: 'maquina-c', por: 'Pessoa SIMULADA', nota: 'SIMULADO' });
      return { acao: 'pegou', item, reserva: null, commit: null, tentativas: 1 };
    };
    assert.deepEqual(tomarReservaDoTrabalho(m2.b.carregado, m2.arco, 'O-a-1', null, op(m2.b)),
      { ok: false, motivo: 'noctum.reserva.de-outra-maquina', detalhe: 'o item RM-901 está com outra máquina ou pessoa depois de tomar' });
  } finally { (reservasDoRoadmap as { pegarItem: typeof original }).pegarItem = original; m2.limpar(); }
});

test('K7: a vaga global soma as máquinas, no limite da conta e nos tetos do arco; a recusa antes do lançamento devolve', () => {
  const m = cenario('noctum-k7', { global: 1, teto: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-a' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    responderOrdem(m.a.carregado, m.arco, 'O-d-1', 'aceita', 'SIMULADO', op(m.a));
    const vagaB = tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b));
    assert.equal(vagaB, 'V-maquina-b-1');
    assert.equal(tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b)), vagaB, 'idempotente');
    assert.match(recusa(() => tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.a)),
      'noctum.coordenacao.vaga-global'), /1 sessão\(ões\) na conta perfil-a somando as máquinas, e o limite é 1 \(maquina-b\)/);
    recusa(() => tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 2 }, op(m.a)),
      'noctum.coordenacao.ordem-vencida');
    // A sessão da B acabou e consumiu: a vaga volta, o consumo não.
    soltarVagaGlobal(m.b.carregado, m.arco, vagaB, { consumiu: true, motivo: 'SIMULADO: a sessão acabou' }, op(m.b));
    assert.equal(tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.a)), 'V-maquina-a-1');
    soltarVagaGlobal(m.a.carregado, m.arco, 'V-maquina-a-1', { consumiu: true, motivo: 'SIMULADO' }, op(m.a));
    assert.match(recusa(() => tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 2 }, op(m.a)),
      'noctum.orcamento.esgotado'), /o teto do arco é de 2 sessoes e 2 já foram reservadas somando as máquinas/);
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.deepEqual(estado.consumo, { arco: 2, porConta: { 'perfil-a': 2 }, porRuntime: { 'claude-bg': 2 } });
    // O registro leva a posição da conta, nunca o nome.
    assert.equal(JSON.stringify(estado.vagas.map(v => v.vaga)), JSON.stringify(['V-maquina-a-1', 'V-maquina-b-1']));
    const lida = gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [], resultado: null })).leitura;
    assert.ok(lida.registros.filter(r => r.dados.tipo === 'vaga').every(r => r.dados.conta === 0 && !JSON.stringify(r.dados).includes('perfil-a')));
    // Vaga de ordem isolada não sai.
    cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO', op(m.a));
    recusa(() => tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 3 }, op(m.b)),
      'noctum.coordenacao.ordem-vencida');
  } finally { m.limpar(); }
});

test('K8: a reconciliação conclui pela thread local, encerra a vencida só sem sessão viva e solta a vaga pelo desfecho local', () => {
  const m = cenario('noctum-k8', { global: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    for (const t of ['a', 'd', 'c']) emitirOrdem(m.a.carregado, m.arco, { trabalho: t, maquina: 'maquina-b' }, op(m.a));
    for (const o of ['O-a-1', 'O-d-1', 'O-c-1']) responderOrdem(m.b.carregado, m.arco, o, 'aceita', 'SIMULADO', op(m.b));
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b));
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 2 }, op(m.b));
    cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO: a B parou', op(m.a));
    const fatos = (vivas: string[] | null, despachos: Array<[number, 'pendente' | 'concluido' | 'recusado', string | null]>,
      threads: Array<[string, boolean, boolean]> = []): FatosLocaisDaMaquina => ({
      arcoVigente: true, sessoesVivas: vivas === null ? null : new Set(vivas),
      despachos: new Map(despachos.map(([seq, desfecho, sessionId]) => [seq, { desfecho, sessionId }])),
      threads: new Map(threads.map(([trabalho, entregue, fechada]) => [trabalho, { id: `ork-${trabalho}`, entregue, fechada }])) });
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    // Sessão da O-a-1 ainda viva: a cancelada fica isolada, e nada é solto.
    let plano = planejarReconciliacao(estado, 'maquina-b', fatos(['s1', 's2'], [[1, 'concluido', 's1'], [2, 'concluido', 's2']]));
    assert.deepEqual([plano.encerradas, plano.soltas], [[], []]);
    assert.match(plano.aguardando[0].porque, /cancelada pela autoridade: SIMULADO: a B parou; 1 sessão\(ões\) dela ainda viva/);
    // Leitura de capacidade com lacuna: incerta é viva.
    assert.equal(planejarReconciliacao(estado, 'maquina-b', fatos(null, [[1, 'concluido', 's1'], [2, 'concluido', 's2']])).aguardando.length, 1);
    // Pendente fica, contada, até a N4.
    assert.equal(planejarReconciliacao(estado, 'maquina-b', fatos([], [[1, 'pendente', null], [2, 'concluido', 's2']])).encerradas.length, 0);
    // A sessão acabou: solta as duas vagas (com consumo), encerra a cancelada e conclui a D pela thread entregue.
    plano = reconciliarCoordenacao(m.b.carregado, m.arco, fatos([], [[1, 'concluido', 's1'], [2, 'concluido', 's2']], [['d', true, true]]), op(m.b));
    assert.deepEqual([plano.encerradas, plano.concluidas, [...plano.soltas].sort()], [['O-a-1'], ['O-d-1'], ['V-maquina-b-1', 'V-maquina-b-2']]);
    const depoisDela = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(situacaoDoTrabalho(depoisDela, 'a')!.estado, 'livre', 'o fim confirmado libera a transferência');
    assert.equal(situacaoDoTrabalho(depoisDela, 'd')!.estado, 'entregue');
    assert.equal(situacaoDoTrabalho(depoisDela, 'c')!.estado, 'em-execucao');
    assert.equal(depoisDela.vagas.filter(v => !v.solta).length, 0);
    assert.equal(depoisDela.consumo.arco, 2, 'as duas consumiram');
    assert.ok(plano.itensSemOrdemViva.includes('RM-901') && !plano.itensSemOrdemViva.includes('RM-903'));
    // A recusa antes do lançamento solta sem consumo.
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-c-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 3 }, op(m.b));
    reconciliarCoordenacao(m.b.carregado, m.arco, fatos([], [[3, 'recusado', null]]), op(m.b));
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).consumo.arco, 2);
  } finally { m.limpar(); }
});

test('K9: registro escrito pela máquina certa mas fora das regras reprova a leitura de todas', () => {
  const m = cenario('noctum-k9');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    // A B assina uma ordem, que só a autoridade emite.
    gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'ordem', ordem: 'O-d-1', trabalho: 'd', item: 'RM-904',
      maquina: 'maquina-b', geracao: 1, n: 1 }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'noctum.coordenacao.adulterado'),
      /O-d-1\.json assinada por quem não era a autoridade da geração 1/);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k9b');
  try {
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    emitirOrdem(m2.a.carregado, m2.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m2.a));
    // A própria autoridade, à mão, uma segunda ordem viva para o mesmo trabalho.
    gravarNoRamo(m2.a.carregado, m2.arco, op(m2.a), () => ({ novos: [{ tipo: 'ordem', ordem: 'O-a-2', trabalho: 'a', item: 'RM-901',
      maquina: 'maquina-a', geracao: 1, n: 2 }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m2.b.carregado, m2.arco, op(m2.b)), 'noctum.coordenacao.adulterado'), /o trabalho a tem duas ordens vivas/);
  } finally { m2.limpar(); }
});

test('K10: vaga de ordem não aceita reprova a leitura; o aceite do trabalho de thread exige a thread daqui, do item e em #Auto', () => {
  const m = cenario('noctum-k10', { trabalhos: [...SIMPLES, { id: 'h', item: 'RM-905', prioridade: 6, dependeDe: [], thread: 'ork-h-simulada',
    maquina: 'maquina-b' }] });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'h', maquina: 'maquina-b' }, op(m.a));
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    const o = estado.ordens.get('O-h-1')!;
    const fatos = (threads: Array<[string, string | null, string]>) => ({ arcoVigente: true,
      threadsLocais: new Map(threads.map(([id, roadmap, modo]) => [id, { roadmap, modo }])) });
    assert.match(respostaAOrdem(estado, o, 'maquina-b', fatos([])).motivo, /a thread ork-h-simulada não existe nesta máquina/);
    assert.match(respostaAOrdem(estado, o, 'maquina-b', fatos([['ork-h-simulada', 'RM-999', 'auto']])).motivo, /é do item RM-999, não do RM-905/);
    assert.match(respostaAOrdem(estado, o, 'maquina-b', fatos([['ork-h-simulada', 'RM-905', 'classic']])).motivo, /está em classic; o arco só conduz #Auto/);
    assert.deepEqual(respostaAOrdem(estado, o, 'maquina-b', fatos([['ork-h-simulada', 'RM-905', 'auto']])), { recibo: 'aceita', motivo: 'ordem aceita' });
    assert.equal(respostaAOrdem(estado, o, 'maquina-b', { ...fatos([['ork-h-simulada', 'RM-905', 'auto']]), arcoVigente: false }).recibo, 'recusada');
    // A B grava à mão uma vaga da ordem que ela não aceitou: nenhum efeito vem antes do aceite.
    gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'vaga', vaga: 'V-maquina-b-9', conta: 0, runtime: 'claude-bg',
      ordem: 'O-h-1', trabalho: 'h', reserva: 9 }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'noctum.coordenacao.adulterado'), /de uma ordem que ele não aceitou/);
  } finally { m.limpar(); }
});

test('K11: a geração vencida não grava mais: o que a autoridade antiga grava depois da tomada reprova a leitura de todas', () => {
  const m = cenario('noctum-k11');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a));
    const tarde = depois(BATIDA_VENCIDA_MS + 60_000);
    assert.equal(assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b, tarde), forcar: { motivo: 'SIMULADO: a A sumiu' } }).geracao, 2);
    emitirOrdem(m.b.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.b, tarde));
    responderOrdem(m.b.carregado, m.arco, 'O-d-1', 'aceita', 'SIMULADO', op(m.b, tarde));
    recusa(() => cancelarOrdem(m.a.carregado, m.arco, 'O-d-1', 'SIMULADO', op(m.a, tarde)), 'noctum.coordenacao.geracao-vencida');
    // A A volta com um núcleo divergente e grava direto no ramo, com a geração 1 que já venceu.
    gravarNoRamo(m.a.carregado, m.arco, op(m.a, tarde), () => ({ novos: [{ tipo: 'cancelamento', ordem: 'O-d-1',
      motivo: 'SIMULADO: a autoridade vencida cancela', geracao: 1 }], resultado: null }));
    for (const quem of [m.a, m.b]) {
      assert.match(recusa(() => lerCoordenacao(quem.carregado, m.arco, op(quem, tarde)), 'noctum.coordenacao.adulterado'),
        /a geração 1 tem 2 registro\(s\) da autoridade, e a geração 2 selou 1: a autoridade vencida gravou depois de perder a vez/);
    }
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k11b');
  try {
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    const tarde = depois(BATIDA_VENCIDA_MS + 60_000);
    assumirAutoridade(m2.b.carregado, m2.arco, { ...op(m2.b, tarde), forcar: { motivo: 'SIMULADO: a A sumiu' } });
    gravarNoRamo(m2.a.carregado, m2.arco, op(m2.a, tarde), () => ({ novos: [{ tipo: 'ordem', ordem: 'O-d-1', trabalho: 'd', item: 'RM-904',
      maquina: 'maquina-a', geracao: 1, n: 1 }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m2.b.carregado, m2.arco, op(m2.b, tarde)), 'noctum.coordenacao.adulterado'),
      /a geração 1 tem 1 registro\(s\) da autoridade, e a geração 2 selou 0/);
  } finally { m2.limpar(); }
  const m3 = cenario('noctum-k11c');
  try {
    // O abandono da vez também é da geração: a autoridade vencida não solta a vez de ninguém.
    assumirAutoridade(m3.a.carregado, m3.arco, op(m3.a));
    bater(m3.b.carregado, m3.arco, op(m3.b));
    emitirOrdem(m3.a.carregado, m3.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m3.a));
    responderOrdem(m3.b.carregado, m3.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m3.b));
    const DESTINO = { repositorio: 'exemplo/produto', base: 'main' };
    gravarNaCoordenacao(m3.b.carregado, m3.arco, op(m3.b), () => ({ novos: [{ tipo: 'vez', chave: chaveDoDestino(DESTINO), n: 1, destino: DESTINO,
      ordem: 'O-a-1', trabalho: 'a', candidato: { branch: 'trabalho-a', fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) } }], resultado: null }));
    const tarde = depois(BATIDA_VENCIDA_MS + 60_000);
    assumirAutoridade(m3.b.carregado, m3.arco, { ...op(m3.b, tarde), forcar: { motivo: 'SIMULADO: a A sumiu' } });
    gravarNoRamo(m3.a.carregado, m3.arco, op(m3.a, tarde), () => ({ novos: [{ tipo: 'vez-fim', chave: chaveDoDestino(DESTINO), n: 1,
      desfecho: 'abandonada', geracao: 1, sinalDoDono: null, motivo: 'SIMULADO: a vencida abandona' }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m3.b.carregado, m3.arco, op(m3.b, tarde)), 'noctum.coordenacao.adulterado'),
      /a geração 1 tem 2 registro\(s\) da autoridade, e a geração 2 selou 1/);
  } finally { m3.limpar(); }
});

test('K12: cancelamento, recibo e entrega assinados por quem não pode assiná-los reprovam a leitura', () => {
  const comOrdem = (nome: string, aceita: boolean) => {
    const m = cenario(nome);
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    if (aceita) responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    return m;
  };
  const m = comOrdem('noctum-k12', true);
  try {
    gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'cancelamento', ordem: 'O-a-1', motivo: 'SIMULADO', geracao: 1 }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'noctum.coordenacao.adulterado'),
      /cancelamentos\/O-a-1\.json assinado por quem não era a autoridade da geração 1/);
  } finally { m.limpar(); }
  const m2 = comOrdem('noctum-k12b', false);
  try {
    gravarNoRamo(m2.a.carregado, m2.arco, op(m2.a), () => ({ novos: [{ tipo: 'recibo', ordem: 'O-a-1', recibo: 'aceita', motivo: 'SIMULADO' }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m2.b.carregado, m2.arco, op(m2.b)), 'noctum.coordenacao.adulterado'),
      /recibos\/O-a-1\/aceita\.json assinado por quem não é o executor da ordem/);
  } finally { m2.limpar(); }
  const m3 = comOrdem('noctum-k12c', true);
  try {
    gravarNoRamo(m3.a.carregado, m3.arco, op(m3.a), () => ({ novos: [{ tipo: 'entrega', trabalho: 'a', ordem: 'O-a-1',
      destino: { repositorio: 'exemplo/produto', base: 'main' }, fonte: '1'.repeat(40), base: '2'.repeat(40), merge: '3'.repeat(40) }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m3.b.carregado, m3.arco, op(m3.b)), 'noctum.coordenacao.adulterado'),
      /entregas\/a\.json de outra máquina, de outro trabalho ou de uma ordem que ela não aceitou/);
  } finally { m3.limpar(); }
});

test('K13: a revogação do dono numa máquina vai ao ramo e vale em todas: nada novo começa, e cada uma só fecha o que é dela', () => {
  const m = cenario('noctum-k13');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-a' }, op(m.a));
    responderOrdem(m.a.carregado, m.arco, 'O-d-1', 'aceita', 'SIMULADO', op(m.a));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'e', maquina: 'maquina-a' }, op(m.a));
    // Só a máquina em que o dono revogou grava a revogação no ramo, uma vez.
    recusa(() => revogarNaRede(m.b.carregado, m.arco, op(m.b)), 'noctum.envelope.invalido');
    revogarArco(m.b.dir, m.arco);
    assert.equal(revogarNaRede(m.b.carregado, m.arco, op(m.b)), true);
    assert.equal(revogarNaRede(m.b.carregado, m.arco, op(m.b)), false);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(estado.revogada!.por, 'maquina-b');
    // Na A, onde o arco segue vigente, nada novo sai: ordem, distribuição, aceite e vaga.
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.revogada'),
      /foi revogado na máquina maquina-b/);
    assert.deepEqual(distribuirOrdens(estado, 'maquina-a', new Date().toISOString(), LIVRES), []);
    assert.deepEqual(respostaAOrdem(estado, estado.ordens.get('O-e-1')!, 'maquina-a', { arcoVigente: true, threadsLocais: new Map() }),
      { recibo: 'recusada', motivo: 'noctum.coordenacao.revogada: o arco foi revogado na máquina maquina-b' });
    recusa(() => responderOrdem(m.a.carregado, m.arco, 'O-e-1', 'aceita', 'SIMULADO', op(m.a)), 'noctum.coordenacao.revogada');
    recusa(() => tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.a)),
      'noctum.coordenacao.revogada');
    // Fechar continua: o cancelamento e o fim da ordem aceita sem sessão viva, com o motivo da revogação.
    assert.equal(cancelarOrdem(m.a.carregado, m.arco, 'O-e-1', 'SIMULADO: o arco foi revogado', op(m.a)), 'cancelada-antes');
    const plano = reconciliarCoordenacao(m.a.carregado, m.arco, { arcoVigente: true, sessoesVivas: new Set(), despachos: new Map(), threads: new Map() }, op(m.a));
    assert.deepEqual(plano.encerradas, ['O-d-1']);
    assert.match(String(lerCoordenacao(m.b.carregado, m.arco, op(m.b)).ordens.get('O-d-1')!.recibos.encerrada!.motivo), /o arco foi revogado na máquina maquina-b/);
  } finally { m.limpar(); }
});

test('K14: a recusa pela reserva espera a reserva mudar; outra recusa e o item que o roadmap não tem excluem a máquina nesta versão', () => {
  const m = cenario('noctum-k14');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    // A B recusou o d pela reserva de fora, que já foi solta: o d sai de novo para ela.
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-d-1', 'recusada', motivoDaReservaDeFora('RM-904'), op(m.b));
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a)), 'O-d-2');
    // A reserva está na B, mas com outra pessoa: a B recusa, e a mesma reserva não recebe a ordem de novo.
    pegarItem(m.b.dir, 'RM-901', { maquina: 'maquina-b', por: 'Outra Pessoa SIMULADA', nota: 'SIMULADO' });
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'recusada', motivoDaReservaDeFora('RM-901'), op(m.b));
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'noctum.reserva.de-outra-maquina'),
      /a máquina maquina-b não pôde usar a reserva do item RM-901; a ordem espera a reserva mudar/);
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a)), 'noctum.reserva.de-outra-maquina'),
      /reservado pela máquina maquina-b do arco; a ordem vai para ela/);
    // A reserva mudou (solta e pega de novo): a ordem volta a sair.
    soltarItem(m.b.dir, 'RM-901', { maquina: 'maquina-b', por: 'Outra Pessoa SIMULADA' });
    passar(5);
    pegarItem(m.b.dir, 'RM-901', { maquina: 'maquina-b', por: 'Outra Pessoa SIMULADA', nota: 'SIMULADO' });
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-2');
    // A recusa por outro motivo exclui a máquina nesta versão.
    responderOrdem(m.b.carregado, m.arco, 'O-a-2', 'recusada', 'SIMULADO: sem a thread aqui', op(m.b));
    soltarItem(m.b.dir, 'RM-901', { maquina: 'maquina-b', por: 'Outra Pessoa SIMULADA' });
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.maquina-recusou');
    // O item que o roadmap da B não tem: o fim com item-invalido também exclui.
    responderOrdem(m.b.carregado, m.arco, 'O-d-2', 'aceita', 'SIMULADO', op(m.b));
    encerrarOrdem(m.b.carregado, m.arco, 'O-d-2', { motivo: 'noctum.reserva.item-invalido: o item RM-904 não está no roadmap desta máquina',
      checkpoint: { thread: null, vagasSoltas: [] } }, op(m.b));
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.maquina-recusou');
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-a' }, op(m.a)), 'O-d-3', 'a outra máquina recebe');
  } finally { m.limpar(); }
});

test('K15: só a autoridade abandona a vez de outra máquina sem sinal; a ordem com vez abandonada espera a base ser conferida', () => {
  const DESTINO = { repositorio: 'exemplo/produto', base: 'main' };
  const vez = (ordem: string, trabalho: string) => ({ tipo: 'vez' as const, chave: chaveDoDestino(DESTINO), n: 1, destino: DESTINO, ordem, trabalho,
    candidato: { branch: `trabalho-${trabalho}`, fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) } });
  const m = cenario('noctum-k15');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    gravarNaCoordenacao(m.b.carregado, m.arco, op(m.b), () => ({ novos: [vez('O-a-1', 'a')], resultado: null }));
    const agora = new Date().toISOString(), tarde = depois(BATIDA_VENCIDA_MS + 60_000);
    const fatos = (conferidas: string[]): FatosLocaisDaMaquina => ({ arcoVigente: true, sessoesVivas: new Set(), despachos: new Map(),
      threads: new Map(), vezesConferidas: new Set(conferidas) });
    // Cancelada com a vez de integrar ativa, a ordem espera: o merge pode ter chegado à base.
    cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO: a B sumiu', op(m.a));
    let estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.match(planejarReconciliacao(estado, 'maquina-b', fatos([])).aguardando[0].porque, /a vez de integrar dela está ativa/);
    assert.deepEqual(registrosDosAbandonos(estado, 'maquina-a', agora), [], 'a B deu sinal agora, com a vez');
    assert.deepEqual(registrosDosAbandonos(estado, 'maquina-b', tarde), [], 'quem não é a autoridade não abandona');
    const abandonos = registrosDosAbandonos(estado, 'maquina-a', tarde);
    assert.equal(abandonos.length, 1);
    gravarNaCoordenacao(m.a.carregado, m.arco, op(m.a, tarde), () => ({ novos: abandonos, resultado: null }));
    estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b, tarde));
    const v = [...estado.vezes.values()].flat()[0];
    assert.deepEqual([v.fim!.desfecho, v.fim!.por], ['abandonada', 'maquina-a']);
    assert.equal(situacaoDoTrabalho(estado, 'a')!.estado, 'isolado', 'o trabalho não muda de máquina');
    assert.match(planejarReconciliacao(estado, 'maquina-b', fatos([])).aguardando[0].porque, /foi abandonada pela autoridade, e o merge pode ter chegado à base/);
    assert.deepEqual(planejarReconciliacao(estado, 'maquina-b', fatos([`${v.chave}/1`])).encerradas, ['O-a-1']);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k15b');
  try {
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    bater(m2.b.carregado, m2.arco, op(m2.b));
    emitirOrdem(m2.a.carregado, m2.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m2.a));
    responderOrdem(m2.a.carregado, m2.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m2.a));
    gravarNaCoordenacao(m2.a.carregado, m2.arco, op(m2.a), () => ({ novos: [vez('O-a-1', 'a')], resultado: null }));
    // A B, que não é a autoridade, abandona a vez da A à mão.
    gravarNoRamo(m2.b.carregado, m2.arco, op(m2.b), () => ({ novos: [{ tipo: 'vez-fim', chave: chaveDoDestino(DESTINO), n: 1, desfecho: 'abandonada',
      geracao: 1, sinalDoDono: null, motivo: 'SIMULADO' }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)), 'noctum.coordenacao.adulterado'),
      /0001\.fim\.json assinado por quem não era a autoridade da geração 1/);
  } finally { m2.limpar(); }
  const m3 = cenario('noctum-k15c');
  try {
    assumirAutoridade(m3.a.carregado, m3.arco, op(m3.a));
    emitirOrdem(m3.a.carregado, m3.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m3.a));
    responderOrdem(m3.a.carregado, m3.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m3.a));
    gravarNaCoordenacao(m3.a.carregado, m3.arco, op(m3.a), () => ({ novos: [vez('O-a-1', 'a')], resultado: null }));
    // A autoridade abandona a própria vez: o abandono é só da vez de outra máquina.
    gravarNoRamo(m3.a.carregado, m3.arco, op(m3.a), () => ({ novos: [{ tipo: 'vez-fim', chave: chaveDoDestino(DESTINO), n: 1, desfecho: 'abandonada',
      geracao: 1, sinalDoDono: null, motivo: 'SIMULADO' }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m3.b.carregado, m3.arco, op(m3.b)), 'noctum.coordenacao.adulterado'),
      /o abandono é da vez de outra máquina, sem merge/);
  } finally { m3.limpar(); }
});

test('K16: a máquina que uma emenda tirou do arco ainda fecha o que é dela, e a reserva do item tirado do envelope é solta', () => {
  const m = cenario('noctum-k16');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-d-1', 'aceita', 'SIMULADO', op(m.b));
    // O dono tira a B e os trabalhos c, d e e do arco, e autoriza a emenda nas duas máquinas.
    const emenda = { ...m.pedido, maquinas: (m.pedido.maquinas as Array<{ nome: string }>).filter(x => x.nome === 'maquina-a'),
      trabalhos: (m.pedido.trabalhos as Array<{ id: string }>).filter(t => t.id === 'a' || t.id === 'b') };
    autorizarPedido(m.a.dir, m.arco, emenda);
    autorizarPedido(m.b.dir, m.arco, emenda);
    recusa(() => bater(m.b.carregado, m.arco, op(m.b)), 'noctum.coordenacao.fora-do-envelope');
    // A ordem da versão anterior termina com o recibo da B, assinado sob a versão em que ela estava.
    const plano = reconciliarCoordenacao(m.b.carregado, m.arco, { arcoVigente: true, sessoesVivas: new Set(), despachos: new Map(), threads: new Map() }, op(m.b));
    assert.deepEqual(plano.encerradas, ['O-d-1']);
    assert.ok(plano.itensSemOrdemViva.includes('RM-904'), 'o item tirado do envelope entra na soltura');
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(estado.ordens.get('O-d-1')!.estado, 'encerrada');
    assert.notEqual(estado.ordens.get('O-d-1')!.recibos.encerrada!.envelopeSha256, estado.vigente.envelopeSha256);
  } finally { m.limpar(); }
});

test('K17: quem grava confere com a régua de quem lê; checkpoint fechado, ordem e vaga idempotentes e a vaga do despacho idempotente solta', () => {
  const m = cenario('noctum-k17', { global: 2 });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    // S3 da rodada 2: repetir a mesma ordem para a mesma máquina devolve a que entrou, sem gravar de novo.
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    const ponta = lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta;
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta, ponta, 'a repetição não gravou');
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    // B1 da rodada 2: o checkpoint fora do esquema, a thread longa e o registro que o leitor reprovaria ficam aqui.
    const antes = lerCoordenacao(m.b.carregado, m.arco, op(m.b)).ponta;
    assert.match(recusa(() => encerrarOrdem(m.b.carregado, m.arco, 'O-a-1', { motivo: 'SIMULADO',
      checkpoint: { thread: null, sessionId: 'sessao-SIMULADA' } as never }, op(m.b)), 'noctum.envelope.invalido'), /sessão, caminho e texto livre não vão ao ramo/);
    recusa(() => encerrarOrdem(m.b.carregado, m.arco, 'O-a-1', { motivo: 'SIMULADO',
      checkpoint: { thread: null, vagasSoltas: Array.from({ length: 65 }, (_, i) => `V-maquina-b-${i + 1}`) } }, op(m.b)), 'noctum.envelope.invalido');
    recusa(() => concluirOrdem(m.b.carregado, m.arco, 'O-a-1', { resultado: 'entregue', thread: 'x'.repeat(81) }, op(m.b)), 'noctum.envelope.invalido');
    assert.match(recusa(() => gravarNaCoordenacao(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'entrega', trabalho: 'a', ordem: 'O-a-1',
      destino: { repositorio: 'exemplo/produto', base: 'main', permissoes: ['merge'] }, fonte: 'a'.repeat(40), base: 'b'.repeat(40), merge: 'c'.repeat(40) }],
      resultado: null })), 'noctum.envelope.invalido'), /as máquinas reprovariam .*destino fora do formato.*nada foi ao ramo/);
    // O leitor também fecha o checkpoint: o recibo com sessão, que um núcleo divergente gravaria, as máquinas reprovam.
    assert.match(recusa(() => gravarNaCoordenacao(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'recibo', ordem: 'O-a-1', recibo: 'encerrada',
      motivo: 'SIMULADO', checkpoint: { thread: null, sessionId: 'sessao-SIMULADA' } }], resultado: null })), 'noctum.envelope.invalido'), /checkpoint fora do formato/);
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta, antes, 'nada foi ao ramo');
    // S2 da rodada 2: a vaga já solta com o mesmo seq local não volta como tomada.
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b));
    soltarVagaGlobal(m.b.carregado, m.arco, 'V-maquina-b-1', { consumiu: false, motivo: 'SIMULADO' }, op(m.b));
    assert.match(recusa(() => tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b)),
      'noctum.coordenacao.concorrencia'), /já foi tomada e solta; o seq local 1 se repetiu/);
    // A2 da rodada 2: o despacho idempotente não abriu sessão; a vaga dele é solta com consumo, e a cancelada encerra.
    tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 2 }, op(m.b));
    cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO: a B parou', op(m.a));
    const fatos = (idempotente: boolean): FatosLocaisDaMaquina => ({ arcoVigente: true, sessoesVivas: new Set(), threads: new Map(),
      despachos: new Map([[1, { desfecho: 'recusado', sessionId: null }], [2, { desfecho: 'concluido', sessionId: null, idempotente }]]) });
    const estado = lerCoordenacao(m.b.carregado, m.arco, op(m.b));
    assert.equal(planejarReconciliacao(estado, 'maquina-b', fatos(false)).aguardando.length, 1, 'sem sessão conhecida e sem ser idempotente, incerta é viva');
    const plano = reconciliarCoordenacao(m.b.carregado, m.arco, fatos(true), op(m.b));
    assert.deepEqual([plano.encerradas, plano.soltas], [['O-a-1'], ['V-maquina-b-2']]);
    const depoisDela = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(situacaoDoTrabalho(depoisDela, 'a')!.estado, 'livre');
    assert.equal(depoisDela.vagas.find(v => v.vaga === 'V-maquina-b-2')!.solta!.consumiu, true);
    assert.deepEqual(depoisDela.ordens.get('O-a-1')!.recibos.encerrada!.checkpoint, { thread: null, vagasSoltas: ['V-maquina-b-2'] });
  } finally { m.limpar(); }
});

test('K18: sem a leitura das reservas agora, nenhuma ordem sai', () => {
  const m = cenario('noctum-k18');
  const original = reservasDoRoadmap.listarReservas;
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = () => { throw new Error('SIMULADO: o remoto das reservas não respondeu'); };
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.sem-remoto'),
      /as reservas não se leram agora; sem elas, nenhuma ordem sai/);
    (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = original;
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ordens.size, 0);
  } finally { (reservasDoRoadmap as { listarReservas: typeof original }).listarReservas = original; m.limpar(); }
});

test('K19: a distribuição automática não devolve o trabalho à máquina cuja ordem dele a autoridade cancelou; a emissão explícita escolhe', () => {
  const m = cenario('noctum-k19', { trabalhos: [{ id: 'x', item: 'RM-981', prioridade: 1, dependeDe: [], pedido: 'Fatia X SIMULADA.' }] });
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    assert.deepEqual(distribuirOrdens(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'maquina-a', depois(0), LIVRES), [{ trabalho: 'x', maquina: 'maquina-a' }]);
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'x', maquina: 'maquina-a' }, op(m.a));
    responderOrdem(m.a.carregado, m.arco, 'O-x-1', 'aceita', 'SIMULADO', op(m.a));
    // A2 da rodada 3: a N4 tira o x da A pela interface: cancela, a sessão para, e a A confirma o fim.
    cancelarOrdem(m.a.carregado, m.arco, 'O-x-1', 'SIMULADO: retomada em outra máquina', op(m.a));
    encerrarOrdem(m.a.carregado, m.arco, 'O-x-1', { motivo: 'SIMULADO: a sessão parou', checkpoint: { thread: null, vagasSoltas: [] } }, op(m.a));
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(situacaoDoTrabalho(estado, 'x')!.estado, 'livre');
    assert.deepEqual(distribuirOrdens(estado, 'maquina-a', depois(0), LIVRES), [{ trabalho: 'x', maquina: 'maquina-b' }], 'a retomada vai para a outra máquina');
    // A emissão explícita, a da N4, escolhe a máquina, inclusive a mesma.
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'x', maquina: 'maquina-a' }, op(m.a)), 'O-x-2');
  } finally { m.limpar(); }
});

test('K20: o motivo de quem chama a interface vai ao ramo, que pode ser público, só sem caminho, e-mail, id de sessão ou segredo', () => {
  const m = cenario('noctum-k20');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    const antes = lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta;
    // A3 da rodada 3: o caminho, o e-mail, o id de sessão e o segredo nomeado ficam aqui, sem eco na mensagem.
    for (const s of ['/home/fulano/projeto/.env', 'falar com fulano@exemplo.com', 'sessao 11111111-2222-4333-8444-555555555555',
      'TOKEN=SIMULADO-abc123', 'senha: SIMULADA', '~/segredos/chave.pem']) {
      const motivo = `SIMULADO: ${s}`;
      const chamadas: Array<() => unknown> = [
        () => cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', motivo, op(m.a)),
        () => responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'recusada', motivo, op(m.b)),
        () => cederAutoridade(m.a.carregado, m.arco, 'maquina-b', motivo, op(m.a)),
        () => assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b), forcar: { motivo } }),
        () => encerrarOrdem(m.b.carregado, m.arco, 'O-a-1', { motivo, checkpoint: { thread: null, vagasSoltas: [] } }, op(m.b)),
        () => soltarVagaGlobal(m.b.carregado, m.arco, 'V-maquina-b-1', { consumiu: false, motivo }, op(m.b)),
      ];
      for (const chamar of chamadas) {
        const msg = recusa(chamar, 'noctum.envelope.invalido');
        assert.match(msg, /o motivo vai ao ramo de coordenação, que pode ser público, e traz um /);
        assert.ok(!/fulano|abc123|11111111|SIMULADA|segredos/.test(msg), msg);
      }
    }
    assert.equal(lerCoordenacao(m.a.carregado, m.arco, op(m.a)).ponta, antes, 'nada foi ao ramo');
    // O motivo tipado, só com ids e o nome do repositório, passa.
    assert.equal(cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'noctum.efeito.fora-do-destino: merge em exemplo/produto, base main', op(m.a)),
      'cancelada-antes');
    assert.equal(lerCoordenacao(m.b.carregado, m.arco, op(m.b)).ordens.get('O-a-1')!.cancelada!.motivo,
      'noctum.efeito.fora-do-destino: merge em exemplo/produto, base main');
  } finally { m.limpar(); }
});

test('K21: a repetição da ordem só devolve a que entrou quando é da mesma geração da autoridade', () => {
  const m = cenario('noctum-k21');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    // S-R3A-3 da rodada 3: a B toma a autoridade à força (a A parou) e pede a mesma ordem; ela é da geração anterior.
    const tarde = depois(BATIDA_VENCIDA_MS + 60_000);
    assert.equal(assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b, tarde), forcar: { motivo: 'SIMULADO: a A parou' } }).geracao, 2);
    assert.match(recusa(() => emitirOrdem(m.b.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.b, tarde)), 'noctum.coordenacao.ordem-viva'),
      /o trabalho a está ordenado \(ordem O-a-1\)/);
  } finally { m.limpar(); }
});

test('K22: o trabalho preso à máquina cuja ordem a autoridade cancelou espera a emissão explícita; depois de uma emenda, a máquina volta à distribuição', () => {
  const m = cenario('noctum-k22', { trabalhos: [{ id: 'x', item: 'RM-981', prioridade: 1, dependeDe: [], pedido: 'Fatia X SIMULADA.', maquina: 'maquina-a' }] });
  try {
    // S-R3C-3 da R3-C: o x é preso à A; cancelado e encerrado lá, a distribuição não o devolve à A nem o leva à B.
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'x', maquina: 'maquina-a' }, op(m.a));
    responderOrdem(m.a.carregado, m.arco, 'O-x-1', 'aceita', 'SIMULADO', op(m.a));
    cancelarOrdem(m.a.carregado, m.arco, 'O-x-1', 'SIMULADO: retomada', op(m.a));
    encerrarOrdem(m.a.carregado, m.arco, 'O-x-1', { motivo: 'SIMULADO: a sessão parou', checkpoint: { thread: null, vagasSoltas: [] } }, op(m.a));
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(situacaoDoTrabalho(estado, 'x')!.estado, 'livre');
    assert.deepEqual(distribuirOrdens(estado, 'maquina-a', depois(0), LIVRES), [], 'o trabalho preso espera a emissão explícita');
    recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'x', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.fora-do-envelope');
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'x', maquina: 'maquina-a' }, op(m.a)), 'O-x-2', 'a emissão explícita, a da N4');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k22b', { trabalhos: [{ id: 'x', item: 'RM-981', prioridade: 1, dependeDe: [], pedido: 'Fatia X SIMULADA.' }] });
  try {
    // S-R3C-6 da R3-C: a exclusão da máquina cancelada vale só na versão do cancelamento. A B nunca bate, e a A é a única
    // candidata: fora da distribuição na versão 1, ela volta depois da emenda autorizada nas duas máquinas.
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    emitirOrdem(m2.a.carregado, m2.arco, { trabalho: 'x', maquina: 'maquina-a' }, op(m2.a));
    responderOrdem(m2.a.carregado, m2.arco, 'O-x-1', 'aceita', 'SIMULADO', op(m2.a));
    cancelarOrdem(m2.a.carregado, m2.arco, 'O-x-1', 'SIMULADO: retomada', op(m2.a));
    encerrarOrdem(m2.a.carregado, m2.arco, 'O-x-1', { motivo: 'SIMULADO: a sessão parou', checkpoint: { thread: null, vagasSoltas: [] } }, op(m2.a));
    assert.deepEqual(distribuirOrdens(lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)), 'maquina-a', depois(0), LIVRES), []);
    const emenda = { ...m2.pedido, relatorio: { horario: '08:00', canal: 'telegram' } };
    autorizarPedido(m2.b.dir, m2.arco, emenda);
    autorizarPedido(m2.a.dir, m2.arco, emenda);
    assert.deepEqual(distribuirOrdens(lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)), 'maquina-a', depois(0), LIVRES), [{ trabalho: 'x', maquina: 'maquina-a' }]);
  } finally { m2.limpar(); }
});

test('K23: o arco que o fechamento da N6 encerrou nesta máquina não começa nada novo aqui, e o recusa com o motivo dele; a soma entre máquinas só mede sessões', () => {
  const m = cenario('noctum-k23');
  try {
    // Merge com a N6: o encerramento é terminal como a revogação, e a recusa diz isso, e não que a janela ainda vai abrir.
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    encerrarArco(m.b.dir, m.arco, { motivo: 'fila-vazia', detalhe: 'SIMULADO' });
    assert.match(recusa(() => responderOrdem(m.b.carregado, m.arco, 'O-c-1', 'aceita', 'SIMULADO', op(m.b)), 'noctum.efeito.encerrado'), /fila-vazia/);
    recusa(() => tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b)),
      'noctum.efeito.encerrado');
    recusa(() => assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b), forcar: { motivo: 'SIMULADO: retomada' } }), 'noctum.efeito.encerrado');
    // O que é dela ainda fecha: a recusa da ordem emitida e o fim confirmado da aceita.
    assert.equal(responderOrdem(m.b.carregado, m.arco, 'O-c-1', 'recusada', 'SIMULADO: o arco fechou aqui', op(m.b)), 'recusada');
    encerrarOrdem(m.b.carregado, m.arco, 'O-a-1', { motivo: 'SIMULADO: o arco fechou aqui', checkpoint: { thread: null, vagasSoltas: [] } }, op(m.b));
    assert.equal(situacaoDoTrabalho(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'a')!.estado, 'livre');
    // O encerramento é desta máquina: na A, ainda vigente, a autoridade segue emitindo.
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-a' }, op(m.a)), 'O-d-1');
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k23b');
  try {
    // A medição da N6 das outras unidades é local: com o teto do arco em tokens, a vaga global recusa, sem chamar de zero o
    // consumo que ela não soma.
    const emenda = { ...m2.pedido, orcamento: { ...(m2.pedido.orcamento as Record<string, unknown>), arco: { valor: 100000, unidade: 'tokens' } } };
    autorizarPedido(m2.b.dir, m2.arco, emenda);
    autorizarPedido(m2.a.dir, m2.arco, emenda);
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    emitirOrdem(m2.a.carregado, m2.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m2.a));
    responderOrdem(m2.a.carregado, m2.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m2.a));
    assert.match(recusa(() => tomarVagaGlobal(m2.a.carregado, m2.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m2.a)),
      'noctum.orcamento.sem-medicao'), /a soma entre máquinas só mede sessoes/);
  } finally { m2.limpar(); }
});

test('K24: a chave que a emenda aposentou não fecha a ordem da chave nova; a raiz nova fecha a da antiga, e a antiga volta sem tocar na nova', () => {
  const opA = { maquina: 'maquina-a' }, opB = { maquina: 'maquina-b' };
  // A emenda troca a chave da maquina-a pela de outra raiz de estado (o clone C), autorizada na B e na C.
  const trocar = (m: DuasMaquinas, nome: string) => {
    const c = cloneDoRemoto(m.remoto, nome, 'Builder C');
    const emenda = { ...m.pedido, maquinas: (m.pedido.maquinas as Array<{ nome: string; chave: string }>).map(x =>
      x.nome === 'maquina-a' ? identidadeDaMaquina(c, 'maquina-a') : x) };
    autorizarPedido(m.b.dir, m.arco, emenda);
    autorizarPedido(c, m.arco, m.pedido);
    autorizarPedido(c, m.arco, emenda);
    return { c, carregadoC: exigirManifesto(c), emenda };
  };
  // A raiz antiga assina à mão, sob a versão antiga, cada registro preso à ordem que a chave nova aceitou: as máquinas reprovam.
  const destino = { repositorio: 'exemplo/produto', base: 'main' };
  const candidato = { branch: 'trabalho-a', fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) };
  const hostis: Array<[string, (ordem: string) => Record<string, unknown>]> = [
    ['recibo', ordem => ({ tipo: 'recibo', ordem, recibo: 'encerrada', motivo: 'SIMULADO', checkpoint: { thread: null, vagasSoltas: [] } })],
    ['entrega', ordem => ({ tipo: 'entrega', trabalho: 'a', ordem, destino, fonte: '1'.repeat(40), base: '2'.repeat(40), merge: '3'.repeat(40) })],
    ['vaga', ordem => ({ tipo: 'vaga', vaga: 'V-maquina-a-9', conta: 0, runtime: 'claude-bg', ordem, trabalho: 'a', reserva: 9 })],
    ['vaga-solta', () => ({ tipo: 'vaga-solta', vaga: 'V-maquina-a-1', consumiu: false, motivo: 'SIMULADO' })],
    ['vez', ordem => ({ tipo: 'vez', chave: chaveDoDestino(destino), n: 2, destino, ordem, trabalho: 'a', candidato })],
    ['vez-fim', () => ({ tipo: 'vez-fim', chave: chaveDoDestino(destino), n: 1, desfecho: 'desistiu', motivo: 'SIMULADO', merge: null })],
  ];
  for (const [tipo, campos] of hostis) {
    const m = cenario(`noctum-k24-${tipo}`);
    let c1 = '';
    try {
      const t = trocar(m, `noctum-k24-${tipo}-c`);
      c1 = t.c;
      assumirAutoridade(m.b.carregado, m.arco, opB);
      bater(t.carregadoC, m.arco, opA);
      const ordem = emitirOrdem(m.b.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, opB);
      responderOrdem(t.carregadoC, m.arco, ordem, 'aceita', 'SIMULADO', opA);
      tomarVagaGlobal(t.carregadoC, m.arco, { ordem, conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, opA);
      gravarNaCoordenacao(t.carregadoC, m.arco, opA, () => ({ novos: [{ tipo: 'vez', chave: chaveDoDestino(destino), n: 1, destino, ordem,
        trabalho: 'a', candidato }], resultado: null }));
      const dados = { contrato: 'ork.noctum-coordenacao/v1' as const, arco: m.arco, envelopeSha256: m.hash, por: 'maquina-a',
        em: new Date().toISOString(), ...campos(ordem) } as DadosDoRegistro;
      gravarCru(m.a.dir, [{ caminho: caminhoDoRegistro(dados), conteudo: JSON.stringify({ dados, assinatura: assinarDados(m.a.dir, dados) }) + '\n' }]);
      assert.match(recusa(() => lerCoordenacao(m.b.carregado, m.arco, opB), 'noctum.coordenacao.adulterado'),
        /assinado sob uma versão anterior à da ordem O-a-1, por uma chave diferente da que o envelope dela dá ao executor maquina-a/, tipo);
    } finally { m.limpar(); if (c1) fs.rmSync(path.dirname(c1), { recursive: true, force: true }); }
  }
  const m2 = cenario('noctum-k24b');
  let c2 = '';
  try {
    assumirAutoridade(m2.b.carregado, m2.arco, opB);
    bater(m2.a.carregado, m2.arco, opA);
    emitirOrdem(m2.b.carregado, m2.arco, { trabalho: 'a', maquina: 'maquina-a' }, opB);
    emitirOrdem(m2.b.carregado, m2.arco, { trabalho: 'd', maquina: 'maquina-a' }, opB);
    responderOrdem(m2.a.carregado, m2.arco, 'O-a-1', 'aceita', 'SIMULADO', opA);
    responderOrdem(m2.a.carregado, m2.arco, 'O-d-1', 'aceita', 'SIMULADO', opA);
    tomarVagaGlobal(m2.a.carregado, m2.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, opA);
    const t2 = trocar(m2, 'noctum-k24b-c');
    c2 = t2.c;
    // A sucessão: sob a versão nova, a raiz que a emenda pôs no lugar fecha a ordem sem vaga que a chave antiga aceitou. A vaga
    // da chave antiga tem o despacho no log da raiz antiga: o `seq` 1 recusado da raiz nova não é ela, e a ordem dela espera.
    const plano = reconciliarCoordenacao(t2.carregadoC, m2.arco, { arcoVigente: true, sessoesVivas: new Set(), threads: new Map(),
      despachos: new Map([[1, { desfecho: 'recusado' as const, sessionId: null }]]) }, opA);
    assert.deepEqual([plano.encerradas, plano.soltas, plano.aguardando.map(x => x.ordem)], [['O-a-1'], [], ['O-d-1']]);
    // Pela interface da N4 também: a raiz nova não prova a parada da sessão da vaga antiga nem a solta.
    assert.match(recusa(() => encerrarOrdem(t2.carregadoC, m2.arco, 'O-d-1', { motivo: 'SIMULADO: retomada', checkpoint: {} }, opA),
      'noctum.coordenacao.ordem-vencida'), /a vaga V-maquina-a-1 da ordem O-d-1 é de outra chave da máquina maquina-a/);
    assert.match(recusa(() => soltarVagaGlobal(t2.carregadoC, m2.arco, 'V-maquina-a-1', { consumiu: false, motivo: 'SIMULADO' }, opA),
      'noctum.coordenacao.ordem-vencida'), /a vaga V-maquina-a-1 é de outra chave da máquina maquina-a; só a raiz dela a solta/);
    // A conclusão também tira a última ordem viva do item (N1 da terceira passada): pela interface e pelo plano, com a thread
    // local terminada, a raiz nova espera a vaga da chave antiga.
    assert.match(recusa(() => concluirOrdem(t2.carregadoC, m2.arco, 'O-d-1', { resultado: 'entregue', thread: null }, opA),
      'noctum.coordenacao.ordem-vencida'), /a vaga V-maquina-a-1 da ordem O-d-1 é de outra chave da máquina maquina-a/);
    const planoComThread = () => planejarReconciliacao(lerCoordenacao(t2.carregadoC, m2.arco, opA), 'maquina-a', { arcoVigente: true,
      sessoesVivas: new Set(), threads: new Map([['d', { id: 'thread-d', entregue: true, fechada: true }]]), despachos: new Map(),
      chave: identidadeDaMaquina(t2.c, 'maquina-a').chave });
    const comThread = planoComThread();
    assert.deepEqual([comThread.concluidas, comThread.aguardando.map(x => x.ordem)], [[], ['O-d-1']]);
    const e = lerCoordenacao(m2.b.carregado, m2.arco, opB);
    assert.deepEqual([e.ordens.get('O-a-1')!.estado, situacaoDoTrabalho(e, 'a')!.estado, e.ordens.get('O-d-1')!.estado,
      e.vagas.find(v => v.vaga === 'V-maquina-a-1')!.solta], ['encerrada', 'livre', 'aceita', null]);
    // A raiz antiga volta com a emenda autorizada, prova a parada da sessão e solta a vaga dela; aí a raiz nova fecha a ordem.
    autorizarPedido(m2.a.dir, m2.arco, t2.emenda);
    soltarVagaGlobal(m2.a.carregado, m2.arco, 'V-maquina-a-1', { consumiu: false, motivo: 'SIMULADO: a sessão da raiz antiga parou' }, opA);
    // Com a vaga antiga solta, o plano da raiz nova já conclui pela thread local (S1 da quarta passada).
    const soltaAVaga = planoComThread();
    assert.deepEqual([soltaAVaga.concluidas, soltaAVaga.aguardando.map(x => x.ordem)], [['O-d-1'], []]);
    encerrarOrdem(t2.carregadoC, m2.arco, 'O-d-1', { motivo: 'SIMULADO: retomada', checkpoint: {} }, opA);
    const depois = lerCoordenacao(m2.b.carregado, m2.arco, opB);
    assert.deepEqual([depois.ordens.get('O-d-1')!.estado, situacaoDoTrabalho(depois, 'd')!.estado,
      depois.vagas.find(v => v.vaga === 'V-maquina-a-1')!.solta !== null], ['encerrada', 'livre', true]);
  } finally { m2.limpar(); if (c2) fs.rmSync(path.dirname(c2), { recursive: true, force: true }); }
  const m3 = cenario('noctum-k24c');
  let c3 = '';
  try {
    assumirAutoridade(m3.b.carregado, m3.arco, opB);
    bater(m3.a.carregado, m3.arco, opA);
    emitirOrdem(m3.b.carregado, m3.arco, { trabalho: 'a', maquina: 'maquina-a' }, opB);
    responderOrdem(m3.a.carregado, m3.arco, 'O-a-1', 'aceita', 'SIMULADO', opA);
    const t3 = trocar(m3, 'noctum-k24c-c');
    c3 = t3.c;
    autorizarPedido(m3.a.dir, m3.arco, t3.emenda);
    bater(t3.carregadoC, m3.arco, opA);
    emitirOrdem(m3.b.carregado, m3.arco, { trabalho: 'd', maquina: 'maquina-a' }, opB);
    emitirOrdem(m3.b.carregado, m3.arco, { trabalho: 'e', maquina: 'maquina-a' }, opB);
    responderOrdem(t3.carregadoC, m3.arco, 'O-d-1', 'aceita', 'SIMULADO', opA);
    responderOrdem(t3.carregadoC, m3.arco, 'O-e-1', 'aceita', 'SIMULADO', opA);
    const destino = { repositorio: 'exemplo/produto', base: 'main' };
    gravarNaCoordenacao(t3.carregadoC, m3.arco, opA, () => ({ novos: [{ tipo: 'vez', chave: chaveDoDestino(destino), n: 1, destino,
      ordem: 'O-d-1', trabalho: 'd', candidato: { branch: 'trabalho-d', fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) } }],
    resultado: null }));
    cancelarOrdem(m3.b.carregado, m3.arco, 'O-d-1', 'SIMULADO: retomada', opB);
    cancelarOrdem(m3.b.carregado, m3.arco, 'O-e-1', 'SIMULADO: retomada', opB);
    // A raiz antiga volta com a emenda autorizada: fecha, sob a versão antiga, a ordem dela e deixa as ordens e a vez da chave
    // nova para a raiz nova. Pelo nome só, ela tentaria fechar a O-e-1 (cancelada, sem vez nem vaga) e resolver a vez da
    // O-d-1, e as máquinas reprovariam a gravação inteira.
    assert.deepEqual(reconciliarIntegracao(m3.a.carregado, m3.arco, opA),
      { registradas: [], soltas: [], emCurso: [], semProva: [], abandonadasConferidas: [] });
    const plano = reconciliarCoordenacao(m3.a.carregado, m3.arco, { arcoVigente: true, sessoesVivas: new Set(), threads: new Map(),
      despachos: new Map() }, opA);
    assert.deepEqual(plano.encerradas, ['O-a-1']);
    // Pela interface da N4, a recusa diz que a ordem é de outra chave da máquina.
    assert.match(recusa(() => encerrarOrdem(m3.a.carregado, m3.arco, 'O-e-1', { motivo: 'SIMULADO', checkpoint: {} }, opA),
      'noctum.coordenacao.ordem-vencida'), /a ordem O-e-1 é de outra chave da máquina maquina-a/);
    assert.match(recusa(() => concluirOrdem(m3.a.carregado, m3.arco, 'O-e-1', { resultado: 'encerrado-sem-entrega', thread: null }, opA),
      'noctum.coordenacao.ordem-vencida'), /a ordem O-e-1 é de outra chave da máquina maquina-a/);
    const e = lerCoordenacao(m3.b.carregado, m3.arco, opB);
    assert.deepEqual([e.ordens.get('O-a-1')!.estado, e.ordens.get('O-d-1')!.estado, e.ordens.get('O-e-1')!.estado,
      [...e.vezes.values()].flat()[0].fim], ['encerrada', 'isolada', 'isolada', null]);
    // A raiz nova resolve a vez dela pela base: a fonte que nem existe neste clone, depois de buscar a base, não está nela.
    assert.deepEqual(reconciliarIntegracao(t3.carregadoC, m3.arco, opA).soltas, [`${chaveDoDestino(destino)}/1`]);
  } finally { m3.limpar(); if (c3) fs.rmSync(path.dirname(c3), { recursive: true, force: true }); }
});

test('K25: o leitor reprova duas vezes ativas, recibos contraditórios e cessão sem a cessão anterior', () => {
  const destino = { repositorio: 'exemplo/produto', base: 'main' };
  const candidato = { branch: 'trabalho-a', fonte: '1'.repeat(40), base: '2'.repeat(40), provas: 'a'.repeat(64) };
  const m = cenario('noctum-k25a');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a));
    responderOrdem(m.a.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.a));
    gravarNoRamo(m.a.carregado, m.arco, op(m.a), () => ({ novos: [1, 2].map(n => ({ tipo: 'vez' as const,
      chave: chaveDoDestino(destino), n, destino, ordem: 'O-a-1', trabalho: 'a', candidato })), resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m.b.carregado, m.arco, op(m.b)), 'noctum.coordenacao.adulterado'), /tem duas vezes ativas/);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k25b');
  try {
    assumirAutoridade(m2.a.carregado, m2.arco, op(m2.a));
    bater(m2.b.carregado, m2.arco, op(m2.b));
    emitirOrdem(m2.a.carregado, m2.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m2.a));
    responderOrdem(m2.b.carregado, m2.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m2.b));
    gravarNoRamo(m2.b.carregado, m2.arco, op(m2.b), () =>
      ({ novos: [{ tipo: 'recibo', ordem: 'O-a-1', recibo: 'recusada', motivo: 'SIMULADO' }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m2.a.carregado, m2.arco, op(m2.a)), 'noctum.coordenacao.adulterado'), /os recibos da ordem O-a-1 se contradizem/);
  } finally { m2.limpar(); }
  const m3 = cenario('noctum-k25c');
  try {
    assumirAutoridade(m3.a.carregado, m3.arco, op(m3.a));
    gravarNoRamo(m3.b.carregado, m3.arco, op(m3.b), () => ({ novos: [{ tipo: 'autoridade', geracao: 2, modo: 'cessao',
      motivo: 'SIMULADO: cessão forjada', anterior: { geracao: 1, maquina: 'maquina-a' }, selo: seloDaGeracao([]) }], resultado: null }));
    assert.match(recusa(() => lerCoordenacao(m3.a.carregado, m3.arco, op(m3.a)), 'noctum.coordenacao.adulterado'),
      /a geração 2 diz cessão sem a cessão da 1 para maquina-b/);
  } finally { m3.limpar(); }
});

test('K26: os tetos da conta e do runtime somam as máquinas independentemente do teto do arco', () => {
  const preparar = (m: DuasMaquinas, porConta: number, porRuntime: number) => {
    const orcamento = m.pedido.orcamento as Record<string, unknown>;
    const emenda = { ...m.pedido, orcamento: { ...orcamento, arco: { valor: 40, unidade: 'sessoes' },
      porConta: [{ conta: 'perfil-a', teto: { valor: porConta, unidade: 'sessoes' } }],
      porRuntime: [{ runtime: 'claude-bg', teto: { valor: porRuntime, unidade: 'sessoes' } }] } };
    autorizarPedido(m.b.dir, m.arco, emenda);
    autorizarPedido(m.a.dir, m.arco, emenda);
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.a.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-d-1', 'aceita', 'SIMULADO', op(m.b));
    tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.a));
  };
  const m = cenario('noctum-k26a', { global: 2 });
  try {
    preparar(m, 1, 10);
    assert.match(recusa(() => tomarVagaGlobal(m.b.carregado, m.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.b)),
      'noctum.orcamento.esgotado'), /o teto da conta perfil-a é de 1 sessoes/);
  } finally { m.limpar(); }
  const m2 = cenario('noctum-k26b', { global: 2 });
  try {
    preparar(m2, 10, 1);
    assert.match(recusa(() => tomarVagaGlobal(m2.b.carregado, m2.arco, { ordem: 'O-d-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m2.b)),
      'noctum.orcamento.esgotado'), /o teto do runtime claude-bg é de 1 sessoes/);
  } finally { m2.limpar(); }
});

test('K27: a soltura da reserva do arco relê a coordenação: o item que ganhou ordem viva depois do plano fica reservado', () => {
  const m = cenario('noctum-k27');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    cancelarOrdem(m.a.carregado, m.arco, 'O-a-1', 'SIMULADO: antes do aceite', op(m.a));
    // A sonda D do CHECK de 15/10: o plano da B diz o item sem ordem viva; antes da soltura, a ordem nova chega e é aceita.
    const plano = reconciliarCoordenacao(m.b.carregado, m.arco, { arcoVigente: true, sessoesVivas: new Set(), threads: new Map(),
      despachos: new Map() }, op(m.b));
    assert.deepEqual(plano.itensSemOrdemViva, ['RM-901']);
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-2');
    responderOrdem(m.b.carregado, m.arco, 'O-a-2', 'aceita', 'SIMULADO', op(m.b));
    assert.deepEqual(tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-a-2', null, op(m.b)), { ok: true, acao: 'pegou' });
    assert.equal(soltarReservaDoArco(m.b.carregado, m.arco, 'RM-901', op(m.b)), false, 'a O-a-2 está viva');
    assert.deepEqual(reservaDoItem(m.b.carregado, m.arco, 'RM-901', op(m.b)), { livre: false, minha: true, doArco: true });
  } finally { m.limpar(); }
});

test('K28: o leitor reprova a vaga solta por outra máquina, gerações e ordens não contíguas, o resultado fora da conclusão, o fim de vez que não existe e a ordem para a máquina errada', () => {
  const destino = { repositorio: 'exemplo/produto', base: 'main' };
  // Cada caso grava pelo transporte, sem a régua de quem grava, o que um núcleo divergente gravaria, e a outra máquina lê.
  const casos: Array<[string, (m: DuasMaquinas) => void, RegExp]> = [
    ['vaga-solta', (m) => {
      emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a));
      responderOrdem(m.a.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.a));
      tomarVagaGlobal(m.a.carregado, m.arco, { ordem: 'O-a-1', conta: 'perfil-a', runtime: 'claude-bg', reserva: 1 }, op(m.a));
      gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'vaga-solta', vaga: 'V-maquina-a-1', consumiu: false, motivo: 'SIMULADO' }],
        resultado: null }));
    }, /de uma vaga que não existe ou não é de quem solta/],
    ['geracoes', (m) => {
      gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'autoridade', geracao: 3, modo: 'forcada', motivo: 'SIMULADO',
        anterior: { geracao: 2, maquina: 'maquina-a' }, selo: seloDaGeracao([]), batidaDaAnterior: null }], resultado: null }));
    }, /as gerações da autoridade não são contíguas \(falta a 2\)/],
    ['resultado', (m) => {
      emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
      responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
      gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'recibo', ordem: 'O-a-1', recibo: 'encerrada', motivo: 'SIMULADO',
        resultado: 'entregue' }], resultado: null }));
    }, /só a conclusão traz resultado, e sempre/],
    ['vez', (m) => {
      gravarNoRamo(m.b.carregado, m.arco, op(m.b), () => ({ novos: [{ tipo: 'vez-fim', chave: chaveDoDestino(destino), n: 1, desfecho: 'desistiu',
        motivo: 'SIMULADO', merge: null }], resultado: null }));
    }, /de uma vez que não existe/],
    ['ordens', (m) => {
      gravarNoRamo(m.a.carregado, m.arco, op(m.a), () => ({ novos: [{ tipo: 'ordem', ordem: 'O-a-2', trabalho: 'a', item: 'RM-901',
        maquina: 'maquina-a', geracao: 1, n: 2 }], resultado: null }));
    }, /as ordens do trabalho a não são contíguas/],
    ['maquina', (m) => {
      gravarNoRamo(m.a.carregado, m.arco, op(m.a), () => ({ novos: [{ tipo: 'ordem', ordem: 'O-c-1', trabalho: 'c', item: 'RM-903',
        maquina: 'maquina-a', geracao: 1, n: 1 }], resultado: null }));
    }, /para uma máquina que o envelope dela não admite nesse trabalho/],
  ];
  for (const [nome, gravar, esperado] of casos) {
    const m = cenario(`noctum-k28-${nome}`);
    try {
      assumirAutoridade(m.a.carregado, m.arco, op(m.a));
      bater(m.b.carregado, m.arco, op(m.b));
      gravar(m);
      assert.match(recusa(() => lerCoordenacao(m.b.carregado, m.arco, op(m.b)), 'noctum.coordenacao.adulterado'), esperado, nome);
    } finally { m.limpar(); }
  }
});
