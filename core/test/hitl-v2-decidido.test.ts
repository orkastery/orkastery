import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { projetoTemporario } from './apoio';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { montarPulse } from '../src/pulse';
import { classificarDecisao, DecisaoInformada, SinaisDaDecisao } from '../src/hitl-contract';
import { registrarPedidoHitl, resolverCriterio } from '../src/hitl-gates';

const CRITERIO_BOM = { tipo: 'medicao' as const, referencia: 'ork pulse --sem-runtime --json' };

const sinais = (extra: Partial<SinaisDaDecisao> = {}): SinaisDaDecisao => ({
  criterio: CRITERIO_BOM, alternativasEstritamentePiores: true,
  reversivelAntesDaEntrega: true, erroBaratoEDetectavel: true, ...extra,
});

const decisao = (thread: string, extra: Partial<DecisaoInformada> = {}): DecisaoInformada => ({
  contrato: 'ork.hitl/v2', id: 'decidido-1', thread, fase: 'GOAL', modo: 'auto',
  criadoEm: '2026-09-20T19:00:00.000Z', profundidade: 'resumo', classe: 'decidido',
  decidido: 'O resumo do pulse passa a sair de hora em hora',
  porque: 'é a cadência que o dono pediu',
  comoMudar: 'a linha do crontab aceita qualquer cadência',
  custoDeReverter: { agora: 'uma linha de crontab', depois: 'uma linha de crontab' },
  criterio: CRITERIO_BOM, ...extra,
});

test('as quatro condições decidem, e falhar uma delas é pergunta', () => {
  assert.equal(classificarDecisao(sinais()).classe, 'decidido');
  assert.match(classificarDecisao(sinais()).motivo, /as quatro condições valem/);

  const tabela: [Partial<SinaisDaDecisao>, RegExp][] = [
    [{ criterio: undefined }, /não há critério escrito/],
    [{ criterio: { tipo: 'manifesto', referencia: '   ' } }, /não há critério escrito/],
    [{ alternativasEstritamentePiores: false }, /não são estritamente piores/],
    [{ reversivelAntesDaEntrega: false }, /não dá para desfazer antes da entrega/],
    [{ erroBaratoEDetectavel: false }, /errar não sai barato/],
  ];
  for (const [alteracao, motivo] of tabela) {
    const r = classificarDecisao(sinais(alteracao));
    assert.equal(r.classe, 'pergunta', JSON.stringify(alteracao));
    assert.match(r.motivo, motivo);
  }
});

test('as portas fechadas vêm antes das quatro condições: nenhuma evidência as abre', () => {
  for (const [porta, motivo] of [
    ['irreversivel', /o ato é irreversível/],
    ['gastaDinheiro', /gasta dinheiro/],
    ['mudaEscopoOuProduto', /muda escopo ou produto/],
  ] as [keyof SinaisDaDecisao, RegExp][]) {
    // Mesmo com as quatro condições perfeitas, a porta fechada manda.
    const r = classificarDecisao(sinais({ [porta]: true } as Partial<SinaisDaDecisao>));
    assert.equal(r.classe, 'pergunta', porta);
    assert.match(r.motivo, motivo);
  }
});

test('critério do manifesto resolve de verdade: chave que não existe é critério ausente', () => {
  const p = projetoTemporario('criterio-manifesto');
  try {
    const t = novaThread(p.carregado, { nome: 'decisão informada', modo: 'auto' }).thread;
    const comChave = decisao(t.id, { criterio: { tipo: 'manifesto', referencia: 'conduction.default_mode' } });
    assert.equal(resolverCriterio(p.dir, comChave).resolve, true);

    const semChave = decisao(t.id, { criterio: { tipo: 'manifesto', referencia: 'verify.inventada' } });
    const r = resolverCriterio(p.dir, semChave);
    assert.equal(r.resolve, false);
    assert.match(r.detalhe, /não tem a chave verify\.inventada/);

    // Chave que existe mas não tem valor vale o mesmo que chave ausente: critério que aponta
    // para nada é critério ausente. Este projeto de teste não declara `verify.build`.
    const vazia = decisao(t.id, { criterio: { tipo: 'manifesto', referencia: 'verify.build' } });
    const v = resolverCriterio(p.dir, vazia);
    assert.equal(v.resolve, false);
    assert.match(v.detalhe, /existe mas está vazia/);
  } finally { p.limpar(); }
});

test('critério do ledger resolve de verdade, por índice e por identificador do evento', () => {
  const p = projetoTemporario('criterio-ledger');
  try {
    const t = novaThread(p.carregado, { nome: 'decisão informada', modo: 'auto' }).thread;
    // GO-FIX 1 (D11): decisão autônoma nova só é gravada com o rastro tipado.
    const evento = registrar(dirThread(p.dir, t.id), t.id, 'autonomous_decision', { fase: 'GOAL', decisao: 'fixture',
      quemDecidiu: 'fixture SIMULADA', evidencia: 'fixture SIMULADA', razao: 'fixture SIMULADA' });
    const porId = decisao(t.id, { criterio: { tipo: 'ledger', referencia: String(evento.eventId) } });
    assert.equal(resolverCriterio(p.dir, porId).resolve, true);

    const n = lerLedger(dirThread(p.dir, t.id)).length;
    const porIndice = decisao(t.id, { criterio: { tipo: 'ledger', referencia: `${t.id}#evento:${n}` } });
    assert.equal(resolverCriterio(p.dir, porIndice).resolve, true);

    const inexistente = decisao(t.id, { criterio: { tipo: 'ledger', referencia: `${t.id}#evento:${n + 99}` } });
    assert.equal(resolverCriterio(p.dir, inexistente).resolve, false);
    const idInventado = decisao(t.id, { criterio: { tipo: 'ledger', referencia: 'nao-existe-este-evento' } });
    assert.equal(resolverCriterio(p.dir, idInventado).resolve, false);
  } finally { p.limpar(); }
});

test('o buraco de `medicao` está dito: a validação impede citar nada, não citar mentira', () => {
  const p = projetoTemporario('criterio-medicao');
  try {
    const t = novaThread(p.carregado, { nome: 'decisão informada', modo: 'auto' }).thread;
    // Um comando que não prova nada RESOLVE aqui, de propósito, e o detalhe diz quem reprova.
    const mentira = decisao(t.id, { criterio: { tipo: 'medicao', referencia: 'true # não prova nada' } });
    const r = resolverCriterio(p.dir, mentira);
    assert.equal(r.resolve, true);
    assert.match(r.detalhe, /quem executa e reprova é o CHECK/);
  } finally { p.limpar(); }
});

test('decisão informada com critério que não resolve não chega a ser registrada', () => {
  const p = projetoTemporario('decidido-recusa');
  try {
    const t = novaThread(p.carregado, { nome: 'decisão informada', modo: 'auto' }).thread;
    const ruim = decisao(t.id, { criterio: { tipo: 'manifesto', referencia: 'nada.disso.existe' } });
    assert.throws(() => registrarPedidoHitl(p.dir, ruim), /critério não resolve/);
    assert.equal(lerLedger(dirThread(p.dir, t.id)).some(e => e.tipo === 'hitl_requested'), false);

    const boa = decisao(t.id, { criterio: { tipo: 'manifesto', referencia: 'conduction.default_mode' } });
    assert.doesNotThrow(() => registrarPedidoHitl(p.dir, boa));
    assert.equal(lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'hitl_requested').length, 1);
  } finally { p.limpar(); }
});

test('decisão informada não entra na fila do dono nem gera gate_blocked', () => {
  const p = projetoTemporario('decidido-nao-bloqueia');
  try {
    const t = novaThread(p.carregado, { nome: 'decisão informada', modo: 'auto' }).thread;
    registrarPedidoHitl(p.dir, decisao(t.id, { criterio: { tipo: 'manifesto', referencia: 'conduction.default_mode' } }));
    const eventos = lerLedger(dirThread(p.dir, t.id));
    // Registrar um fato consumado não bloqueia nada: nenhum gate_blocked nasce dele.
    assert.equal(eventos.some(e => e.tipo === 'gate_blocked'), false);

    const pulse = montarPulse(p.carregado, { consulta: { ok: true, sessoes: [], detalhe: 'SIMULADO' } });
    const daThread = pulse.precisaDeHumanoAgora.filter(i => i.thread === t.id);
    assert.deepEqual(daThread.map(i => i.pedido?.id).filter(Boolean), [],
      'um `decidido` apareceu como coisa que precisa do dono agora');
  } finally { p.limpar(); }
});
