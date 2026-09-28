import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PedidoHitl, profundidadeDoModo, validarPedidoHitl, estadoDoPedido, validarRespostaHitl } from '../src/hitl-contract';
import { MODOS_LEGADOS } from '../src/modos';

const pedido = (): PedidoHitl => ({ contrato: 'ork.hitl/v1', id: 'pedido-1', thread: 'ork-simulado', fase: 'PLAN', modo: 'classic',
  alvo: { tipo: 'gate', sobre: 'plano' }, motivo: 'human.pending', pergunta: 'Aprovar este plano?',
  opcoes: [{ numero: 1, texto: 'Aprovar', acao: 'aprovar' }, { numero: 2, texto: 'Revisar', acao: 'recusar' }],
  recomendacao: 'Revisar as evidências.', criadoEm: '2026-09-07T12:00:00Z', prazo: '2026-09-07T13:00:00Z',
  acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 }, profundidade: 'detalhada' });

test('contrato simulado aceita os cinco modos com profundidade própria', () => {
  // I-43: a lista vem do domicílio único. Encolher `MODOS_LEGADOS` reprova aqui,
  // em vez de quebrar recibo histórico em silêncio.
  for (const modo of MODOS_LEGADOS) {
    validarPedidoHitl({ ...pedido(), modo, profundidade: profundidadeDoModo(modo) });
  }
  assert.equal(validarRespostaHitl(pedido(), '1', '2026-09-07T12:30:00Z')?.acao, 'aprovar');
});

test('cada campo obrigatório é validado; datas impossíveis e opções ambíguas são recusadas', () => {
  for (const chave of Object.keys(pedido())) {
    const p: Record<string, unknown> = { ...pedido() }; delete p[chave];
    assert.throws(() => validarPedidoHitl(p), chave);
  }
  for (const alteracao of [{ contrato: 'v2' }, { id: '../../fora' }, { prazo: '2026-02-30T13:00:00Z' },
    { prazo: pedido().criadoEm }, { alvo: { tipo: 'session', sessionId: 'id', runtime: 'pago' } },
    { respostaAceita: { tipo: 'texto', maxCaracteres: 100 } }, { profundidade: 'resumo' },
    { opcoes: [{ numero: 1, texto: 'sim', acao: 'aprovar' }, { numero: 1, texto: 'não', acao: 'recusar' }] },
    { opcoes: [{ numero: 1, texto: 'sim', acao: 'executar' }] }, { opcoes: [] }]) {
    assert.throws(() => validarPedidoHitl({ ...pedido(), ...alteracao }));
  }
});

test('limite exato de expiração espera ou escala e nunca aprova, em todos os modos', () => {
  for (const modo of ['look', 'ork', 'classic', 'maestro', 'auto'] as const) {
    for (const acaoPadraoAoExpirar of ['esperar', 'escalar'] as const) {
      const p = { ...pedido(), modo, acaoPadraoAoExpirar, profundidade: profundidadeDoModo(modo) };
      assert.equal(estadoDoPedido(p, p.prazo), acaoPadraoAoExpirar);
      assert.throws(() => validarRespostaHitl(p, '1', p.prazo));
    }
  }
  assert.throws(() => validarPedidoHitl({ ...pedido(), acaoPadraoAoExpirar: 'aprovar' }));
  for (const texto of ['sim', '01', '1 ou 2', '', '1\x00']) assert.throws(() => validarRespostaHitl(pedido(), texto, '2026-09-07T12:30:00Z'));
  assert.throws(() => estadoDoPedido(pedido(), 'inválido'));
  assert.throws(() => estadoDoPedido(pedido(), '2026-09-07T11:30:00Z'));
});
