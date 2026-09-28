/**
 * I-43: os modos `#Look` e `#Ork` pararam de ser ESCRITOS e continuam sendo LIDOS.
 *
 * O que estes testes existem para travar, e que ja quebrou de verdade em outros
 * produtos quando alguem "limpou" uma lista: encolher o LEITOR junto com o ESCRITOR.
 * Um recibo `ork.hitl/v1` gravado em 02/09 com `modo: look` foi assinado com
 * `profundidade: profunda`. Se a lista de validacao encolher, esse recibo para de
 * validar EM SILENCIO, e o produto passa a negar o que ele mesmo emitiu.
 *
 * Por isso a divisao e por LISTA e nao por matriz: `MODOS` mantem as cinco entradas,
 * `ORDEM_DOS_MODOS` fica so com as vivas, e nada alem de `MODOS_LEGADOS` repete o
 * literal dos cinco.
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MODOS,
  MODOS_APOSENTADOS,
  MODOS_LEGADOS,
  ORDEM_DOS_MODOS,
  definicaoDoModo,
  extrairTagAposentadaDoPedido,
  extrairTagDoPedido,
  modoAposentado,
  parseModo,
  tabelaDeModos,
  tagDoModo,
} from '../src/modos';
import { PedidoHitl, profundidadeDoModo, validarPedidoHitl } from '../src/hitl-contract';
import { creationRequestSchema } from '../src/creation-operation-store';

test('ORDEM_DOS_MODOS so tem modo vivo; MODOS_LEGADOS mantem todos, inclusive os aposentados', () => {
  assert.deepEqual([...ORDEM_DOS_MODOS], ['classic', 'maestro', 'auto', 'fast']);
  assert.deepEqual([...MODOS_LEGADOS], ['look', 'ork', 'classic', 'maestro', 'auto', 'fast']);
  assert.deepEqual([...MODOS_APOSENTADOS], ['look', 'ork']);

  // A matriz NAO encolhe: e dela que sai a tag de uma thread de 02/09.
  assert.deepEqual(Object.keys(MODOS).sort(), [...MODOS_LEGADOS].sort());

  // Todo modo vivo e legado; nenhum modo vivo e aposentado.
  for (const vivo of ORDEM_DOS_MODOS) {
    assert.ok((MODOS_LEGADOS as readonly string[]).includes(vivo), `${vivo} sumiu de MODOS_LEGADOS`);
    assert.equal(modoAposentado(vivo), false, `${vivo} e vivo e nao pode estar aposentado`);
  }
  for (const morto of MODOS_APOSENTADOS) {
    assert.equal(modoAposentado(morto), true);
    assert.ok(!(ORDEM_DOS_MODOS as readonly string[]).includes(morto), `${morto} ainda e escrivel`);
  }
});

test('ESCRITOR: parseModo recusa modo aposentado, e nao o confunde com inexistente', () => {
  for (const morto of MODOS_APOSENTADOS) {
    assert.equal(parseModo(morto), null, `parseModo aceitou ${morto}`);
    assert.equal(parseModo(`#${morto}`), null);
    assert.equal(parseModo(`--modo ${morto}`), null);
  }
  for (const vivo of ORDEM_DOS_MODOS) assert.equal(parseModo(`#${vivo}`), vivo);

  // Aposentado e inexistente devolvem o mesmo `null` no portao de escrita; quem
  // distingue os dois e o manifesto, que e o unico com motivo para distinguir.
  assert.equal(parseModo('banana'), null);
  assert.equal(parseModo('default'), null);
});

test('ESCRITOR: a #TAG aposentada do pedido e RECONHECIDA, nunca ignorada', () => {
  // Ignorar em silencio e o pecado: um pedido `#Look` viraria `#Classic` sem aviso.
  assert.equal(extrairTagDoPedido('roda isso em #Look por favor'), null);
  assert.equal(extrairTagAposentadaDoPedido('roda isso em #Look por favor'), 'look');
  assert.equal(extrairTagAposentadaDoPedido('quero #Ork nesse aqui'), 'ork');

  // A primeira tag ganha, viva ou aposentada: recusar e diferente de pegar a proxima.
  assert.equal(extrairTagAposentadaDoPedido('#Look e depois #Auto'), 'look');
  assert.equal(extrairTagDoPedido('#Look e depois #Auto'), null);
  assert.equal(extrairTagDoPedido('#Auto e depois #Look'), 'auto');
  assert.equal(extrairTagAposentadaDoPedido('#Auto e depois #Look'), null);

  assert.equal(extrairTagDoPedido('pedido sem tag nenhuma'), null);
  assert.equal(extrairTagAposentadaDoPedido('pedido sem tag nenhuma'), null);
});

test('LEITOR: a tag e a definicao de thread legada continuam inteiras', () => {
  // `ork-smokeb0` (look, 02/09) e `ork-b2worktree`/`ork-b4adapt` (ork, 03/09) existem
  // em disco e precisam abrir com a tag certa, nao com `#?look`.
  assert.equal(tagDoModo('look'), '#Look');
  assert.equal(tagDoModo('ork'), '#Ork');
  assert.equal(definicaoDoModo('look').pausas, 6);
  assert.equal(definicaoDoModo('ork').pausas, 5);
  assert.equal(definicaoDoModo('look').blocos.length, 6);

  // O fallback de modo desconhecido segue intacto: ele e outro caso, e continua
  // carregando o valor cru para dizer o que arrumar.
  assert.equal(tagDoModo('default'), '#?default');
  assert.equal(tagDoModo(undefined), '#?');
});

test('LEITOR: recibo ork.hitl/v1 gravado em modo aposentado continua validando', () => {
  const base: PedidoHitl = { contrato: 'ork.hitl/v1', id: 'pedido-i43', thread: 'ork-smokeb0', fase: 'PLAN',
    modo: 'classic', alvo: { tipo: 'gate', sobre: 'plano' }, motivo: 'human.pending',
    pergunta: 'Aprovar este plano?',
    opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Revisar', acao: 'recusar' }],
    recomendacao: 'Revisar as evidencias.', criadoEm: '2026-09-02T12:00:00Z', prazo: '2026-09-02T13:00:00Z',
    acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
    profundidade: 'detalhada' };

  // O par gravado no recibo de `#Look`: profundidade PROFUNDA.
  assert.equal(profundidadeDoModo('look'), 'profunda');
  validarPedidoHitl({ ...base, modo: 'look', profundidade: 'profunda' });

  // O par gravado no recibo de `#Ork`: profundidade DETALHADA.
  assert.equal(profundidadeDoModo('ork'), 'detalhada');
  validarPedidoHitl({ ...base, modo: 'ork', profundidade: 'detalhada' });

  // A validacao segue derivando da lista, nao de um literal proprio: os cinco passam.
  for (const modo of MODOS_LEGADOS) {
    validarPedidoHitl({ ...base, modo, profundidade: profundidadeDoModo(modo) });
  }

  // E continua sendo um contrato: modo que nunca existiu reprova.
  assert.throws(() => validarPedidoHitl({ ...base, modo: 'default', profundidade: 'resumo' }));
});

test('LEITOR: operacao de criacao ja persistida em modo aposentado continua parseando', () => {
  const pedido = (mode: string) => ({ key: 'creation-i43-0001', action: 'create_entity' as const,
    entity: { kind: 'project' as const, id: 'proj-i43-legado', parentId: 'prod-i43-legado',
      title: 'projeto gravado antes da aposentadoria', acceptanceCriteria: ['entrega existe'] },
    expectedParentVersion: 1,
    request: 'trabalho gravado antes da aposentadoria', doneWhen: ['entrega existe'],
    workspaceIds: [], mode });

  for (const modo of MODOS_LEGADOS) assert.ok(creationRequestSchema.safeParse(pedido(modo)).success, modo);
  assert.equal(creationRequestSchema.safeParse(pedido('default')).success, false);
});

test('`ork modos` mostra so os vivos, e o numero vem da lista', () => {
  const tabela = tabelaDeModos();
  for (const morto of MODOS_APOSENTADOS) {
    assert.ok(!tabela.includes(MODOS[morto].tag), `a tabela ainda anuncia ${MODOS[morto].tag}`);
  }
  for (const vivo of ORDEM_DOS_MODOS) assert.ok(tabela.includes(MODOS[vivo].tag), `${vivo} sumiu da tabela`);
});
