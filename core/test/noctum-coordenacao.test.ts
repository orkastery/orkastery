/**
 * RM-058 (N3): a coordenação entre máquinas sobre o ramo assinado. Duas "máquinas" são dois clones de um remoto bare de
 * fixture; contas, máquinas, itens e pedidos são SIMULADOS, e nada toca remoto, reserva ou raiz de verdade.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { autorizarPedido, prepararIngressoSimulado } from './noctum-apoio';
import { duasMaquinas, DuasMaquinas, MaquinaDeTeste } from './noctum-maquinas-apoio';
import { RecusaDoArco } from '../src/noctum-envelope';
import { pegarItem } from '../src/roadmap-reservas';
import { gravarNoRamo } from '../src/noctum-transporte';
import {
  assumirAutoridade, bater, BATIDA_VENCIDA_MS, cancelarOrdem, cederAutoridade, concluirOrdem, distribuirOrdens, emitirOrdem,
  encerrarOrdem, entreguesNaRede, FatosLocaisDaMaquina, lerCoordenacao, planejarReconciliacao, reconciliarCoordenacao,
  reservaDestaMaquina, respostaAOrdem, responderOrdem, situacaoDoTrabalho, soltarReservaDoArco, soltarVagaGlobal, tomarReservaDoTrabalho,
  tomarVagaGlobal,
} from '../src/noctum-coordenacao';

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
    bater(m.a.carregado, m.arco, op(m.a));
    assert.match(recusa(() => assumirAutoridade(m.b.carregado, m.arco, { ...op(m.b), forcar: { motivo: 'SIMULADO: a autoridade parou' } }),
      'noctum.coordenacao.autoridade-ativa'), /bateu há menos de 15 min/);
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
      /maquina-b não bate há mais de 15 min/);
    bater(m.b.carregado, m.arco, op(m.b));
    assert.equal(emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a)), 'O-a-1');
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva'),
      /o trabalho a está ordenado \(ordem O-a-1\)/);
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'b', maquina: 'maquina-a' }, op(m.a)), 'noctum.coordenacao.ordem-viva'),
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
    assert.deepEqual(distribuirOrdens(lerCoordenacao(m.a.carregado, m.arco, op(m.a)), 'maquina-a', quando), [{ trabalho: 'p1', maquina: 'maquina-a' }]);
    bater(m.b.carregado, m.arco, op(m.b));
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.deepEqual(distribuirOrdens(estado, 'maquina-a', quando),
      [{ trabalho: 'p1', maquina: 'maquina-a' }, { trabalho: 'p2', maquina: 'maquina-b' }], 'p3 espera uma vaga; p4 espera a p1');
    assert.deepEqual(distribuirOrdens(estado, 'maquina-b', quando), [], 'quem não é a autoridade não distribui');
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
    assert.match(recusa(() => emitirOrdem(m.a.carregado, m.arco, { trabalho: 'd', maquina: 'maquina-b' }, op(m.a)), 'noctum.coordenacao.ordem-viva'),
      /maquina-b já recusou o trabalho d/);
    assert.ok(!distribuirOrdens(estado, 'maquina-a', new Date().toISOString()).some(x => x.trabalho === 'd' && x.maquina === 'maquina-b'));
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
    assert.match(recusa(() => responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b)), 'noctum.efeito.hash-antigo'),
      /é de outra versão do envelope/);
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'recusada', 'noctum.efeito.hash-antigo: a ordem é de outra versão do envelope', op(m.b));
    autorizarPedido(m.a.dir, m.arco, emenda);
    const estado = lerCoordenacao(m.a.carregado, m.arco, op(m.a));
    assert.equal(estado.ordens.get('O-a-1')!.estado, 'recusada');
    assert.equal(estado.vigente.envelopeSha256, lerCoordenacao(m.b.carregado, m.arco, op(m.b)).vigente.envelopeSha256);
  } finally { m.limpar(); }
});

test('K6: a reserva do item é tomada pelo executor da ordem aceita, revalidada, e nunca forçada sobre outra máquina', () => {
  const m = cenario('noctum-k6');
  try {
    assumirAutoridade(m.a.carregado, m.arco, op(m.a));
    bater(m.b.carregado, m.arco, op(m.b));
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'a', maquina: 'maquina-b' }, op(m.a));
    recusa(() => tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-a-1', null, op(m.b)), 'noctum.coordenacao.ordem-vencida');
    responderOrdem(m.b.carregado, m.arco, 'O-a-1', 'aceita', 'SIMULADO', op(m.b));
    assert.deepEqual(tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-a-1', null, op(m.b)), { ok: true, acao: 'pegou' });
    assert.deepEqual(reservaDestaMaquina(m.b.carregado, 'RM-901', op(m.b)), { minha: true, com: 'Builder B em maquina-b', nota: `noctum:${m.arco}` });
    assert.equal(reservaDestaMaquina(m.a.carregado, 'RM-901', op(m.a))!.minha, false);
    // O dono da A pegou o RM-903 à mão: a B, com a ordem dele, não força.
    pegarItem(m.a.dir, 'RM-903', { maquina: 'maquina-a', nota: 'à mão, SIMULADO' });
    emitirOrdem(m.a.carregado, m.arco, { trabalho: 'c', maquina: 'maquina-b' }, op(m.a));
    responderOrdem(m.b.carregado, m.arco, 'O-c-1', 'aceita', 'SIMULADO', op(m.b));
    const r = tomarReservaDoTrabalho(m.b.carregado, m.arco, 'O-c-1', null, op(m.b));
    assert.ok(!r.ok && r.motivo === 'noctum.reserva.de-outra-maquina' && /RM-903 esta com Teste Orkastery em maquina-a/.test(r.detalhe), JSON.stringify(r));
    // Só a reserva do arco, desta máquina, é solta.
    assert.equal(soltarReservaDoArco(m.a.carregado, m.arco, 'RM-903', op(m.a)), false, 'a da A tem outra nota');
    assert.equal(soltarReservaDoArco(m.a.carregado, m.arco, 'RM-901', op(m.a)), false, 'a do RM-901 é da B');
    assert.equal(soltarReservaDoArco(m.b.carregado, m.arco, 'RM-901', op(m.b)), true);
    assert.equal(reservaDestaMaquina(m.b.carregado, 'RM-901', op(m.b))!.com, null);
  } finally { m.limpar(); }
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
