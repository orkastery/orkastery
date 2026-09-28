import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  atoIrreversivelDoItem, classificarItem, contarClassificacoes, ItemClassificavel, JANELA_PADRAO_MIN,
} from '../src/hitl-classificacao';
import { ATOS_IRREVERSIVEIS, PedidoHitl, validarPedidoHitl } from '../src/hitl-contract';

const AGORA = '2026-09-20T19:00:00Z';

function pedido(sobre: string, prazo: string): PedidoHitl {
  const p: PedidoHitl = {
    contrato: 'ork.hitl/v1', id: `pedido-${sobre}`, thread: 'ork-exemplo', fase: 'PLAN', modo: 'auto',
    alvo: { tipo: 'gate', sobre }, motivo: 'human.pending', pergunta: 'Qual é o veredito?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Revisar', acao: 'recusar' }],
    recomendacao: 'Aprovar', criadoEm: new Date(Date.parse(prazo) - 60 * 60 * 1000).toISOString(),
    prazo, acaoPadraoAoExpirar: 'esperar',
    respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'resumo',
  };
  validarPedidoHitl(p);
  return p;
}

const item = (extra: Partial<ItemClassificavel>): ItemClassificavel => ({
  id: 'item', classe: 'thread', motivo: 'human.pending', thread: 'ork-exemplo', fase: 'PLAN',
  sessionId: null, ...extra,
});

test('BLOQUEANTE é estrutura: sessão ou fase parada esperando, e a nota de entrega não é bloqueio', () => {
  const opcoes = { quando: AGORA };
  const sessao = classificarItem(item({ classe: 'desconhecida', sessionId: '01a0b342-6324-74b3-b45c-1ce99d7e4e1e' }), opcoes);
  assert.equal(sessao.bloqueante, true);
  assert.match(sessao.porque.bloqueante, /sessão 01a0b342 está parada/);

  const fase = classificarItem(item({}), opcoes);
  assert.equal(fase.bloqueante, true);
  assert.match(fase.porque.bloqueante, /fase PLAN de ork-exemplo está parada/);

  // O score nasce DEPOIS do ship_done: ninguém espera por ele. Era ele que inflava a fila.
  const score = classificarItem(item({ classe: 'score_pendente', fase: 'MASTER', motivo: 'master.score-pendente' }), opcoes);
  assert.equal(score.bloqueante, false);
  assert.match(score.porque.bloqueante, /a entrega já aconteceu/);

  const solto = classificarItem(item({ thread: null, fase: null }), opcoes);
  assert.equal(solto.bloqueante, false);
});

test('URGENTE é relógio: vence dentro da janela da cadência, ou já venceu; antiguidade não basta', () => {
  const opcoes = { quando: AGORA };
  // Parado desde 08/09, doze dias, e mesmo assim NÃO urgente: não há prazo correndo.
  const antigo = classificarItem(item({}), opcoes);
  assert.equal(antigo.urgente, false);
  assert.match(antigo.porque.urgente, /não tem prazo correndo/);

  const vencido = classificarItem(item({ pedido: pedido('a', '2026-09-20T04:51:09.495Z') }), opcoes);
  assert.equal(vencido.urgente, true);
  assert.match(vencido.porque.urgente, /já venceu/);

  // Dentro da janela de uma hora: vence antes do próximo resumo, então não dá para esperar por ele.
  const dentro = classificarItem(item({ pedido: pedido('b', '2026-09-20T19:30:00Z') }), opcoes);
  assert.equal(dentro.urgente, true);

  // Depois da janela: o próximo resumo chega antes do prazo, então ele pode viajar nele.
  const fora = classificarItem(item({ pedido: pedido('c', '2026-09-20T21:00:00Z') }), opcoes);
  assert.equal(fora.urgente, false);

  // A janela é parâmetro da cadência, não constante escondida: com 8h, o mesmo item é urgente.
  assert.equal(classificarItem(item({ pedido: pedido('c', '2026-09-20T21:00:00Z') }),
    { quando: AGORA, janelaMin: 8 * 60 }).urgente, true);
  assert.equal(JANELA_PADRAO_MIN, 60);
});

test('CRÍTICO é natureza: só a lista congelada de atos irreversíveis acende a marca', () => {
  const opcoes = { quando: AGORA };
  assert.equal(classificarItem(item({}), opcoes).critico, false);

  const dinheiro = classificarItem(item({ motivo: 'cost.violation' }), opcoes);
  assert.equal(dinheiro.critico, true);
  assert.equal(dinheiro.ato, 'dinheiro');
  assert.match(dinheiro.porque.critico, /não se desfaz: dinheiro/);

  // Sob v2 quem declara é o pedido, e a declaração vence o mapa por motivo.
  const declarado = { ...pedido('d', '2026-09-20T21:00:00Z'), ato: 'apagar-dado' } as unknown as PedidoHitl;
  assert.equal(atoIrreversivelDoItem(item({ pedido: declarado })), 'apagar-dado');
  // Valor fora da lista congelada não vira ato por ser uma string: cai no mapa por motivo.
  const inventado = { ...pedido('e', '2026-09-20T21:00:00Z'), ato: 'mandar-email' } as unknown as PedidoHitl;
  assert.equal(atoIrreversivelDoItem(item({ pedido: inventado })), undefined);
  assert.deepEqual([...ATOS_IRREVERSIVEIS], ['dinheiro', 'publicacao-externa', 'apagar-dado', 'push-base-protegida']);
});

test('os três não são três nomes para a mesma coisa: cada par tem caso que os separa', () => {
  const opcoes = { quando: AGORA };
  const c = (i: ItemClassificavel) => classificarItem(i, opcoes);

  // bloqueante sem ser urgente nem crítico: a maioria do que está na fila hoje.
  const so_bloqueante = c(item({}));
  assert.deepEqual([so_bloqueante.bloqueante, so_bloqueante.urgente, so_bloqueante.critico], [true, false, false]);

  // urgente sem ser crítico.
  const urgente = c(item({ pedido: pedido('f', '2026-09-20T19:10:00Z') }));
  assert.deepEqual([urgente.urgente, urgente.critico], [true, false]);

  // crítico sem ser urgente: dinheiro em jogo, mas nenhum relógio correndo.
  const critico = c(item({ motivo: 'cost.violation' }));
  assert.deepEqual([critico.critico, critico.urgente], [true, false]);

  // nem bloqueante, nem urgente, nem crítico.
  const nenhum = c(item({ classe: 'score_pendente', fase: 'MASTER', motivo: 'master.score-pendente' }));
  assert.deepEqual([nenhum.bloqueante, nenhum.urgente, nenhum.critico], [false, false, false]);
});

test('urgente está contido em bloqueante sob v1, e a pergunta que avança sozinha separa os dois', () => {
  const opcoes = { quando: AGORA };
  // Sob v1 não existe item com prazo que não tenha sessão ou fase parada: o pulse só anexa
  // pedido a item com thread, e a fase fica presa esperando resposta.
  const v1 = classificarItem(item({ pedido: pedido('g', '2026-09-20T19:10:00Z') }), opcoes);
  assert.deepEqual([v1.urgente, v1.bloqueante], [true, true]);

  // Sob v2 a pergunta reversível com `seguir-recomendada` corre contra o relógio sem segurar
  // ninguém: a fase conclui com a recomendada quando o prazo vence. É o caso que separa os dois,
  // e ele é classificado corretamente hoje, antes de o contrato existir.
  const seguindo = classificarItem({
    id: 'v2', classe: 'decisao-em-voo', motivo: 'hitl.pergunta', thread: null, fase: null,
    sessionId: null, pedido: pedido('h', '2026-09-20T19:10:00Z'),
  }, opcoes);
  assert.deepEqual([seguindo.urgente, seguindo.bloqueante], [true, false]);
});

test('a contagem agrega uma vez por item e nomeia cada thread bloqueada uma vez só', () => {
  const itens: ItemClassificavel[] = [
    item({ id: '1', thread: 'ork-i31kg1contra', pedido: pedido('i', '2026-09-20T04:51:09.495Z') }),
    item({ id: '2', thread: 'ork-i31kg1contra', fase: null, motivo: 'claims.failed' }),
    item({ id: '3', thread: 'ork-i31kg1contra', fase: null, motivo: 'verify.failed' }),
    item({ id: '4', thread: 'ork-companybrai2', fase: 'SHIP', motivo: 'vaga.stale' }),
    item({ id: '5', classe: 'score_pendente', thread: 'ork-b2auditoria', fase: 'MASTER', motivo: 'master.score-pendente' }),
    item({ id: '6', thread: 'ork-i42modofastu', fase: null, motivo: 'cost.violation' }),
  ];
  const contagem = contarClassificacoes(itens, { quando: AGORA });
  assert.deepEqual(contagem, {
    total: 6, urgentes: 1, bloqueantes: 5, criticos: 1,
    threadsBloqueadas: ['ork-companybrai2', 'ork-i31kg1contra', 'ork-i42modofastu'],
  });
  // Três itens da mesma thread produzem UM nome, não três: é a repetição que enchia o canal.
  assert.equal(contagem.threadsBloqueadas.filter(t => t === 'ork-i31kg1contra').length, 1);
});

test('instante e janela inválidos são recusados em vez de virarem classificação silenciosa', () => {
  assert.throws(() => classificarItem(item({}), { quando: 'ontem' }), /instante de consulta inválido/);
  assert.throws(() => classificarItem(item({}), { quando: AGORA, janelaMin: 0 }), /janela da cadência inválida/);
});
