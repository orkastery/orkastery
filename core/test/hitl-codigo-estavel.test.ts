/**
 * RM-048 (item 3, D4 e D5): a linha que o dono recebe nao vence em uma hora.
 *
 * Em 27/09 o pedido 5fdcb00b (codigo DE6H) virou 3b2c4b61 (codigo SNS5) em menos de quatro horas:
 * o prazo de uma hora vencia, o gate era reaberto com identificador e codigo novos, e a linha que
 * o dono tinha na mao virava po. Aqui se prova, pelo ledger e pelo texto devolvido:
 *  - o gate reaberto no mesmo contexto mantem o codigo, e so muda de codigo quando a pergunta muda;
 *  - "1a" e "<codigo> a" depois do prazo registram no pedido renovado, com a prova de sempre e o
 *    `renovadoDe` no rastro;
 *  - pergunta que mudou, contexto que mudou e codigo em duas threads nunca recebem a letra;
 *  - o "sim" ao resumo mais recente vale depois do prazo;
 *  - "<codigo> detalhes" devolve a evidencia sem registrar nada.
 *
 * Chave, usuario, chat e threads SIMULADOS.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cenarioDoPulse, depois, QUANDO } from './apoio-pulse';
import { abrirPedidoGate, prepararPedidoGate, registrarPedidoHitl } from '../src/hitl-gates';
import { aprovacoesHumanas } from '../src/gates';
import { PerguntaAoDono } from '../src/hitl-contract';
import { dirThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { lerConsentimento } from '../src/pulse-consentimento';
import { lerLoteServido } from '../src/pulse-resposta';

const humanos = (dir: string, t: string) => lerLedger(dirThread(dir, t)).filter(e => e.tipo === 'human_gate');

test('o gate reaberto no mesmo contexto mantém o código; a pergunta que muda ganha outro', () => {
  const c = cenarioDoPulse('estavel-codigo', 1);
  try {
    const t = c.itens[0].thread!;
    const a = abrirPedidoGate(c.p.dir, t, 'human.pending', QUANDO) as PerguntaAoDono;
    const b = abrirPedidoGate(c.p.dir, t, 'human.pending', depois(61)) as PerguntaAoDono;
    assert.notEqual(b.id, a.id, 'venceu: o pedido é outro');
    assert.equal(b.codigo, a.codigo, 'a linha que o dono recebeu continua a mesma');
    // O parecer da fase muda a recomendada: é outra pergunta, e outro código.
    registrar(dirThread(c.p.dir, t), t, 'phase_result', { fase: 'GOAL', motivo: 'claims.failed', evidencia: 'fixture simulada' });
    const d = abrirPedidoGate(c.p.dir, t, 'human.pending', depois(125)) as PerguntaAoDono;
    assert.notEqual(d.codigo, a.codigo);
    assert.equal(d.alternativas.find(x => x.recomendada)!.letra, 'b');
  } finally { c.limpar(); }
});

test('"1a" depois do prazo de uma hora registra no pedido renovado, com a prova de sempre', () => {
  const c = cenarioDoPulse('estavel-lote', 1);
  try {
    c.varrer(QUANDO);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    c.responder(`${codigo} a`, 'telegram:-7:100', depois(5));
    const servida = lerLoteServido(c.p.dir, c.monitor).perguntas[0];
    // 75 minutos depois do lote: o pedido servido venceu, o número não.
    const r = c.responder('1a', 'telegram:-7:101', depois(80));
    assert.deepEqual(r.registradas.map(x => [x.numero, x.letra, x.estado]), [[1, 'a', 'aprovado']], r.mensagem);
    const [h] = humanos(c.p.dir, servida.thread);
    assert.notEqual(h.pedidoId, servida.pedidoId, 'a resposta foi ao pedido renovado');
    const rastro = h.enderecoAssinado as Record<string, unknown>;
    assert.equal(rastro.renovadoDe, servida.pedidoId);
    assert.equal(rastro.numero, 1);
    assert.equal(h.autorizadoPor, 'telegram:42');
    assert.equal(aprovacoesHumanas(c.p.dir, servida.thread).length, 1, 'retry e ship reconhecem pelo recibo durável');
  } finally { c.limpar(); }
});

test('pergunta que mudou depois de sair não recebe a letra velha', () => {
  const c = cenarioDoPulse('estavel-mudou', 1);
  try {
    c.varrer(QUANDO);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    c.responder(`${codigo} a`, 'telegram:-7:200', depois(5));
    const t = c.itens[0].thread!;
    registrar(dirThread(c.p.dir, t), t, 'phase_result', { fase: 'GOAL', motivo: 'claims.failed', evidencia: 'fixture simulada' });
    const r = c.responder('1a', 'telegram:-7:201', depois(80));
    assert.equal(r.registradas.length, 0);
    assert.match(r.mensagem, /a pergunta 1 mudou desde que saiu; nada foi registrado/);
    assert.equal(humanos(c.p.dir, t).length, 0);
  } finally { c.limpar(); }
});

test('"<código> a" responde ao gate pelo código curto, sem número de lote nem UUID', () => {
  const c = cenarioDoPulse('estavel-por-codigo', 1);
  try {
    const t = c.itens[0].thread!;
    const pedido = abrirPedidoGate(c.p.dir, t, 'human.pending', QUANDO) as PerguntaAoDono;
    const r = c.responder(`${pedido.codigo} a`, 'telegram:-7:300', depois(1));
    assert.equal(r.tipo, 'codigo');
    assert.deepEqual(r.registradas.map(x => x.estado), ['aprovado'], r.mensagem);
    assert.match(r.mensagem, new RegExp(`^✅ ${pedido.codigo} → a\\) Aprovar com as evidências apresentadas: a fase segue e o bloco avança\\.$`));
    const [h] = humanos(c.p.dir, t);
    assert.equal(h.pedidoId, pedido.id);
    assert.equal((h.enderecoAssinado as Record<string, unknown>).codigo, pedido.codigo);
    assert.equal(aprovacoesHumanas(c.p.dir, t).length, 1);
    // Respondido, a resposta não muda: outra letra pelo mesmo código é recusada com o que vale.
    const outra = c.responder(`${pedido.codigo} b`, 'telegram:-7:301', depois(2));
    assert.match(outra.mensagem, new RegExp(`${pedido.codigo} já foi respondido \\(aprovado\\)`));
    assert.equal(humanos(c.p.dir, t).length, 1);
  } finally { c.limpar(); }
});

test('o código vale depois do prazo e depois de "continuar esperando", sempre no pedido renovado', () => {
  const c = cenarioDoPulse('estavel-codigo-tarde', 1);
  try {
    const t = c.itens[0].thread!;
    const pedido = abrirPedidoGate(c.p.dir, t, 'human.pending', QUANDO) as PerguntaAoDono;
    const espera = c.responder(`${pedido.codigo} c`, 'telegram:-7:400', depois(1));
    assert.deepEqual(espera.registradas.map(x => x.estado), ['aguardando']);
    // Três horas depois, a mesma linha: o gate ainda espera, a pergunta é a mesma.
    const aprova = c.responder(`${pedido.codigo} a`, 'telegram:-7:401', depois(180));
    assert.deepEqual(aprova.registradas.map(x => x.estado), ['aprovado'], aprova.mensagem);
    const h = humanos(c.p.dir, t);
    assert.equal(h.length, 2);
    assert.notEqual(h[1].pedidoId, pedido.id);
    assert.equal((h[1].enderecoAssinado as Record<string, unknown>).renovadoDe, pedido.id);
  } finally { c.limpar(); }
});

test('A2 e A3 do CHECK: a linha velha não desfaz veredito definitivo, e a mesma mensagem é repetida', () => {
  const c = cenarioDoPulse('estavel-definitivo', 1);
  try {
    c.varrer(QUANDO);
    const consentimento = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    c.responder(`${consentimento} a`, 'telegram:-7:700', depois(5));
    const t = c.itens[0].thread!;
    const servida = lerLoteServido(c.p.dir, c.monitor).perguntas[0];
    const codigo = (lerLedger(dirThread(c.p.dir, t)).find(e => e.tipo === 'hitl_requested' &&
      (e.pedido as { id: string }).id === servida.pedidoId)!.pedido as PerguntaAoDono).codigo;
    // Depois do prazo, o dono aprova pelo código: vai ao pedido renovado.
    const aprova = c.responder(`${codigo} a`, 'telegram:-7:701', depois(80));
    assert.deepEqual(aprova.registradas.map(x => x.estado), ['aprovado'], aprova.mensagem);
    // O número velho do lote não vira "recusado" em cima do aprovado.
    const velho = c.responder('1b', 'telegram:-7:702', depois(81));
    assert.equal(velho.registradas.length, 0, velho.mensagem);
    assert.deepEqual(humanos(c.p.dir, t).map(h => h.estado), ['aprovado']);
    // A mesma mensagem entregue de novo pelo gateway é repetida, sem pedido novo.
    const pedidosAntes = lerLedger(dirThread(c.p.dir, t)).filter(e => e.tipo === 'hitl_requested').length;
    const de = c.responder(`${codigo} a`, 'telegram:-7:701', depois(81));
    assert.equal(de.repetida, true, de.mensagem);
    assert.equal(lerLedger(dirThread(c.p.dir, t)).filter(e => e.tipo === 'hitl_requested').length, pedidosAntes);
  } finally { c.limpar(); }
});

test('código em duas threads, desconhecido ou de contexto velho nunca registra', () => {
  const c = cenarioDoPulse('estavel-colisao', 2);
  try {
    const [ta, tb] = c.itens.map(i => i.thread!);
    const a = abrirPedidoGate(c.p.dir, ta, 'human.pending', QUANDO) as PerguntaAoDono;
    const preparado = prepararPedidoGate(c.p.dir, tb, 'human.pending', QUANDO);
    assert.ok('novo' in preparado);
    registrarPedidoHitl(c.p.dir, { ...preparado.novo, codigo: a.codigo });
    const dupla = c.responder(`${a.codigo} a`, 'telegram:-7:500', depois(1));
    assert.match(dupla.mensagem, new RegExp(`O código ${a.codigo} está em 2 threads`));
    assert.equal(humanos(c.p.dir, ta).length + humanos(c.p.dir, tb).length, 0);

    const nenhum = c.responder('Z9Z9 a', 'telegram:-7:501', depois(1));
    assert.match(nenhum.mensagem, /Não reconheço o código Z9Z9/);

  } finally { c.limpar(); }
});

test('um despacho novo muda o contexto: o código de antes já não espera ninguém', () => {
  const c = cenarioDoPulse('estavel-contexto', 1);
  try {
    const t = c.itens[0].thread!;
    const a = abrirPedidoGate(c.p.dir, t, 'human.pending', QUANDO) as PerguntaAoDono;
    registrar(dirThread(c.p.dir, t), t, 'phase_dispatch', { fase: 'GOAL', sessionId: 'sessao-SIMULADA-nova' });
    const velho = c.responder(`${a.codigo} a`, 'telegram:-7:502', depois(2));
    assert.equal(velho.registradas.length, 0, velho.mensagem);
    assert.match(velho.mensagem, new RegExp(`${a.codigo} já não espera você`));
    assert.equal(humanos(c.p.dir, t).length, 0);
  } finally { c.limpar(); }
});

test('o sim ao resumo mais recente vale depois do prazo, e "<código> detalhes" não registra', () => {
  const c = cenarioDoPulse('estavel-resumo', 1);
  try {
    c.varrer(QUANDO);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    const sim = c.responder(`${codigo} a`, 'telegram:-7:600', depois(90));
    assert.equal(sim.resposta, 'sim', sim.mensagem);
    assert.match(sim.mensagem, /^📋 Orkastery, 1 pergunta/);
    const t = c.itens[0].thread!;
    const pedido = lerLedger(dirThread(c.p.dir, t)).filter(e => e.tipo === 'hitl_requested').at(-1)!.pedido as PerguntaAoDono;
    const detalhe = c.responder(`${pedido.codigo} detalhes`, 'telegram:-7:601', depois(91));
    assert.match(detalhe.mensagem, new RegExp(`^🔎 Evidências de ${pedido.codigo} \\(${t} · GOAL\\)`));
    assert.match(detalhe.mensagem, /Claims:/);
    assert.equal(humanos(c.p.dir, t).length, 0);
  } finally { c.limpar(); }
});
