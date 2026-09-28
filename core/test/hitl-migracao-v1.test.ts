/**
 * `ork.hitl/v1` é lido PARA SEMPRE, e este arquivo é a prova.
 *
 * Os três pedidos abaixo não são fixtures inventadas: são os três pedidos reais cujos recibos
 * `human_gate` com `contrato: "ork.hitl/v1"` estão gravados em disco neste projeto, copiados do
 * ledger em 20/09/2026. Um foi respondido por elicitation MCP, um pelo envelope
 * `ork.hitl-answer/v2` e um pelo `ork.hitl-answer/v1`, ou seja, cobrem os três caminhos de
 * resposta que já existiram.
 *
 * Se alguém apertar a validação de v1, este arquivo quebra, e é por isso que ele existe. Um
 * leitor que deixe de entender v1 apaga história e quebra resposta pendente.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CONTRATO_HITL, CONTRATO_HITL_V2, CONTRATOS_DE_PEDIDO, ehContratoDePedido, ehV2, estadoDoPedido,
  PedidoHitl, validarPedidoHitl, validarPedidoHitlV1, validarPedidoHitlV2, vereditoDoGate,
} from '../src/hitl-contract';

/** Copiados do ledger real. Nenhum campo foi ajustado para passar no teste. */
const RECIBOS_GRAVADOS: { pedido: PedidoHitl; respondidoPor: string }[] = [
  {
    respondidoPor: 'ork.mcp-elicitation/v1',
    pedido: {
      contrato: 'ork.hitl/v1', id: '3482b0d2-7d10-4fef-a814-8a7e46f4e1dd', thread: 'ork-companybrai2',
      fase: 'PLAN', modo: 'maestro', alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
      pergunta: 'Qual é o veredito sobre premissas?',
      opcoes: [{ numero: 1, texto: 'Aprovar com as evidências apresentadas', acao: 'aprovar' },
        { numero: 2, texto: 'Solicitar revisão', acao: 'recusar' },
        { numero: 3, texto: 'Continuar esperando', acao: 'esperar' }],
      recomendacao: 'Confira artefatos, claims e riscos antes de responder.',
      criadoEm: '2026-09-16T22:34:43.835Z', prazo: '2026-09-16T23:34:43.835Z',
      acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'resumo',
    },
  },
  {
    respondidoPor: 'ork.hitl-answer/v2',
    pedido: {
      contrato: 'ork.hitl/v1', id: '7ef326a0-1c3a-403f-aaad-8350412bc8a7', thread: 'ork-i32bootstrap',
      fase: 'PLAN', modo: 'maestro', alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
      pergunta: 'Qual é o veredito sobre premissas?',
      opcoes: [{ numero: 1, texto: 'Aprovar com as evidências apresentadas', acao: 'aprovar' },
        { numero: 2, texto: 'Solicitar revisão', acao: 'recusar' },
        { numero: 3, texto: 'Continuar esperando', acao: 'esperar' }],
      recomendacao: 'Confira artefatos, claims e riscos antes de responder.',
      criadoEm: '2026-09-18T01:08:38.694Z', prazo: '2026-09-18T02:08:38.694Z',
      acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'resumo',
    },
  },
  {
    respondidoPor: 'ork.hitl-answer/v1',
    pedido: {
      contrato: 'ork.hitl/v1', id: '21ab2b72-5fa8-4af6-abe6-6b7bf3d1ee0f', thread: 'ork-i33rotacaoco',
      fase: 'PLAN', modo: 'maestro', alvo: { tipo: 'gate', sobre: 'premissas' }, motivo: 'human.pending',
      pergunta: 'Qual é o veredito sobre premissas?',
      opcoes: [{ numero: 1, texto: 'Aprovar com as evidências apresentadas', acao: 'aprovar' },
        { numero: 2, texto: 'Solicitar revisão', acao: 'recusar' },
        { numero: 3, texto: 'Continuar esperando', acao: 'esperar' }],
      recomendacao: 'Confira artefatos, claims e riscos antes de responder.',
      criadoEm: '2026-09-19T13:00:30.843Z', prazo: '2026-09-19T14:00:30.843Z',
      acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'resumo',
    },
  },
];

test('os três pedidos v1 com recibo gravado continuam válidos, pelo validador congelado', () => {
  assert.equal(RECIBOS_GRAVADOS.length, 3);
  for (const { pedido, respondidoPor } of RECIBOS_GRAVADOS) {
    assert.doesNotThrow(() => validarPedidoHitlV1(pedido), `${respondidoPor}: ${pedido.id}`);
    assert.doesNotThrow(() => validarPedidoHitl(pedido), `despachador recusou v1: ${pedido.id}`);
    assert.equal(pedido.contrato, CONTRATO_HITL);
    assert.equal(ehV2(pedido), false);
  }
  // Os três caminhos de resposta que já existiram estão cobertos.
  assert.deepEqual(RECIBOS_GRAVADOS.map(r => r.respondidoPor).sort(),
    ['ork.hitl-answer/v1', 'ork.hitl-answer/v2', 'ork.mcp-elicitation/v1']);
});

test('o que se derivava desses pedidos continua derivando igual', () => {
  for (const { pedido } of RECIBOS_GRAVADOS) {
    // Todos venceram sem resposta no prazo: expirar continua sendo `esperar`, não autorização.
    assert.equal(estadoDoPedido(pedido, '2026-09-20T19:00:00.000Z'), 'esperar');
    assert.equal(estadoDoPedido(pedido, pedido.criadoEm), 'aberto');
    const veredito = vereditoDoGate(pedido, pedido.opcoes[0]);
    assert.deepEqual(veredito, { fase: 'PLAN', sobre: 'premissas', estado: 'aprovado', opcao: 1 });
  }
});

test('o validador de v1 nunca aceita um v2, e o de v2 nunca aceita um v1', () => {
  const v1 = RECIBOS_GRAVADOS[0].pedido;
  assert.throws(() => validarPedidoHitlV2(v1), /contrato inválido/);
  const v2 = {
    contrato: 'ork.hitl/v2', id: 'novo', thread: 'ork-exemplo', fase: 'PLAN', modo: 'auto',
    criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'profunda', classe: 'decidido',
    decidido: 'A fila de score sai do pulse', porque: 'ninguém espera por ela para avançar',
    comoMudar: 'ork master --todas mostra a fila inteira',
    custoDeReverter: { agora: 'uma linha de configuração', depois: 'uma linha de configuração' },
    criterio: { tipo: 'medicao', referencia: 'ork pulse --sem-runtime --json' },
  };
  assert.doesNotThrow(() => validarPedidoHitlV2(v2));
  assert.throws(() => validarPedidoHitlV1(v2), /identificação, modo ou pergunta inválidos/);
});

test('v1 continua sendo recusado pelas mesmas mensagens de erro de antes', () => {
  const base = RECIBOS_GRAVADOS[0].pedido;
  const casos: [Partial<PedidoHitl>, RegExp][] = [
    [{ pergunta: '' }, /identificação, modo ou pergunta inválidos/],
    [{ prazo: base.criadoEm }, /prazo ou ação de expiração inválidos/],
    [{ acaoPadraoAoExpirar: 'aprovar' as never }, /prazo ou ação de expiração inválidos/],
    [{ alvo: { tipo: 'gate', sobre: '' } }, /alvo inválido/],
    [{ respostaAceita: { tipo: 'texto', maxCaracteres: 100 } }, /resposta aceita inválida/],
    [{ opcoes: [{ numero: 2, texto: 'fora de ordem', acao: 'aprovar' }] }, /opções devem ser numeradas/],
    [{ profundidade: 'profunda' }, /profundidade incompatível com o modo/],
  ];
  for (const [alteracao, erro] of casos) {
    assert.throws(() => validarPedidoHitlV1({ ...base, ...alteracao }), erro, JSON.stringify(alteracao));
  }
});

// ---------------------------------------------------------------------------
// T4c: os dois pontos que recusariam v2 passam a aceitar as duas versões.
// ---------------------------------------------------------------------------

test('quem confere autoria aceita as DUAS versões, e só elas', () => {
  // `formaDeAprovacao` (gates) e a regra de autoria (memória humana) comparavam o contrato do
  // evento com a string literal do v1. Um `human_gate` copia o contrato do pedido que respondeu,
  // então sob v2 a aprovação do próprio dono viraria autoria ambígua e deixaria de valer para
  // `retry` e `ship`. A lista é fechada: a promessa é ler v1 para sempre, não ler qualquer coisa.
  assert.deepEqual([...CONTRATOS_DE_PEDIDO], [CONTRATO_HITL, CONTRATO_HITL_V2]);
  for (const bom of CONTRATOS_DE_PEDIDO) assert.equal(ehContratoDePedido(bom), true, bom);
  for (const ruim of ['ork.hitl/v3', 'ork.hitl', 'ork.hitl/v1 ', 'ORK.HITL/V1',
    'ork.hitl-answer/v1', '', undefined, null, 1, {}]) {
    assert.equal(ehContratoDePedido(ruim), false, JSON.stringify(ruim ?? String(ruim)));
  }
});

test('os dois leitores de autoria usam a mesma lista, e não uma cópia cada um', () => {
  // Duas listas separadas divergem no dia em que uma terceira versão aparecer, e a divergência
  // sai silenciosa: `retry` aceitaria a aprovação e a memória a chamaria de ambígua.
  const fonte = (arquivo: string): string =>
    require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src', arquivo), 'utf8');
  for (const arquivo of ['gates.ts', 'memoria-humana.ts']) {
    assert.match(fonte(arquivo), /ehContratoDePedido\(e\.contrato\)/, arquivo);
    assert.equal(/contrato !== 'ork\.hitl\/v1'|contrato === 'ork\.hitl\/v1'/.test(fonte(arquivo)), false,
      `${arquivo} ainda compara o contrato com a string literal do v1`);
  }
});
