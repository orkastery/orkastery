/**
 * RM-048 (item 2, D2 e D3): a resposta em linguagem natural registra quando e inequivoca.
 *
 * Decisao do dono (28/09): "aprovo", "sim", "pode seguir", "a", "1" e "1. B, 2. A" registram;
 * ambigua volta como pergunta com as opcoes reais, nunca como veredito chutado; com mais de um
 * pedido aberto na mesma thread, texto livre nao registra. Aqui se prova cada um pelo ledger
 * (`human_gate` com a prova do ingresso, ou nenhum) e pelo texto que volta ao dono.
 *
 * O envelope e sempre o que o ingresso do Hermes assina (SIMULADO): a regra do texto livre so
 * roda depois da mesma `autenticarResposta` de sempre.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cenarioDoPulse, depois, dizer, QUANDO } from './apoio-pulse';
import { abrirPedidoGate, prepararPedidoGate, registrarPedidoHitl } from '../src/hitl-gates';
import { aprovacoesHumanas } from '../src/gates';
import { PerguntaAoDono } from '../src/hitl-contract';
import { JANELA_DO_TEXTO_LIVRE_MIN, resolverTrecho, lerTrecho } from '../src/hitl-texto-livre';
import { dirThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { lerConsentimento } from '../src/pulse-consentimento';
import { atualizarEscuta, lerLoteServido, responderPeloPulse } from '../src/pulse-resposta';

const humanos = (dir: string, t: string) => lerLedger(dirThread(dir, t)).filter(e => e.tipo === 'human_gate');
const ACOES_DO_GATE = ['aprovar', 'recusar', 'esperar'], LETRAS = ['a', 'b', 'c'];

/** Resumo, sim e lote servido: devolve o cenario com as perguntas na mao do dono. */
function comLote(nome: string, n: number) {
  const c = cenarioDoPulse(nome, n);
  c.varrer(QUANDO);
  const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
  c.responder(`${codigo} a`, 'telegram:-7:1', depois(1));
  return c;
}

test('a regra é fechada: uma palavra casa uma ação, e "não" num gate é ambíguo', () => {
  const r = (t: string) => resolverTrecho(lerTrecho(t)!, ACOES_DO_GATE, LETRAS);
  for (const t of ['aprovo', 'Sim', 'pode seguir', 'ok', 'de acordo']) assert.deepEqual(r(t), { tipo: 'escolha', indice: 0 }, t);
  for (const t of ['revisar', 'refazer', 'recuso']) assert.deepEqual(r(t), { tipo: 'escolha', indice: 1 }, t);
  for (const t of ['esperar', 'depois', 'mais tarde']) assert.deepEqual(r(t), { tipo: 'escolha', indice: 2 }, t);
  assert.deepEqual(r('não'), { tipo: 'ambigua', indices: [1, 2] });
  assert.deepEqual(r('b'), { tipo: 'escolha', indice: 1 });
  assert.deepEqual(r('3'), { tipo: 'escolha', indice: 2 });
  assert.equal(lerTrecho('talvez'), null, 'fora do vocabulário não é resposta');
  assert.equal(lerTrecho('I-31. Aprovar'), null);
});

test('"aprovo", "pode seguir", "a" e "1", logo depois da pergunta, registram com a prova de sempre', () => {
  for (const [i, palavra] of ['aprovo', 'pode seguir', 'a', '1'].entries()) {
    const c = comLote(`livre-${i}`, 1);
    try {
      const t = c.itens[0].thread!;
      const r = c.responder(palavra, `telegram:-7:${10 + i}`, depois(5));
      assert.deepEqual(r.registradas.map(x => [x.numero, x.letra, x.estado]), [[1, 'a', 'aprovado']], `${palavra}: ${r.mensagem}`);
      const [h] = humanos(c.p.dir, t);
      assert.equal(h.autorizadoPor, 'telegram:42');
      assert.equal((h.enderecoAssinado as Record<string, unknown>).numero, 1);
      assert.ok((h.enderecoAssinado as Record<string, unknown>).textoLivre, 'o rastro diz que veio de texto livre');
      assert.equal(aprovacoesHumanas(c.p.dir, t).length, 1);
    } finally { c.limpar(); }
  }
});

test('"sim" ao resumo recém-enviado libera o lote, como "<código> a"', () => {
  const c = cenarioDoPulse('livre-resumo', 1);
  try {
    c.varrer(QUANDO);
    const r = c.responder('sim', 'telegram:-7:20', depois(2));
    assert.equal(r.resposta, 'sim', r.mensagem);
    assert.match(r.mensagem, /^📋 Orkastery, 1 pergunta/);
  } finally { c.limpar(); }
});

test('"1. B, 2. A" responde as duas perguntas numa mensagem, e a palavra numerada também vale', () => {
  const c = comLote('livre-lista', 3);
  try {
    const r = c.responder('1. B, 2. A', 'telegram:-7:30', depois(5));
    assert.deepEqual(r.registradas.map(x => [x.numero, x.letra, x.estado]), [[1, 'b', 'recusado'], [2, 'a', 'aprovado']], r.mensagem);
    const outra = c.responder('3 aprovo', 'telegram:-7:31', depois(6));
    assert.deepEqual(outra.registradas.map(x => [x.numero, x.letra]), [[3, 'a']], outra.mensagem);
  } finally { c.limpar(); }
});

test('ambíguo volta como pergunta com as opções reais, e nada é registrado', () => {
  const c = comLote('livre-ambigua', 2);
  try {
    // Duas perguntas abertas: "aprovo" sozinho não diz qual.
    const duas = c.responder('aprovo', 'telegram:-7:40', depois(5));
    assert.equal(duas.registradas.length, 0);
    assert.match(duas.mensagem, /Há 2 perguntas esperando você, e uma palavra só não diz qual; nada foi registrado\./);
    assert.match(duas.mensagem, /1 com a letra \(ork-/);
    // "não" para um gate serve para revisar e para esperar: volta com as letras de verdade.
    const nao = c.responder('1 não', 'telegram:-7:41', depois(6));
    assert.equal(nao.registradas.length, 0);
    assert.match(nao.mensagem, /mais de uma alternativa; mande uma: 1a \(Aprovar com as evidências apresentadas\), 1b \(Solicitar revisão\), 1c \(Continuar esperando\)\./);
    for (const i of c.itens) assert.equal(humanos(c.p.dir, i.thread!).length, 0);
  } finally { c.limpar(); }
});

test('com mais de um pedido aberto na mesma thread, palavra não registra; a letra continua valendo', () => {
  const c = comLote('livre-varios', 1);
  try {
    const t = c.itens[0].thread!;
    const servida = lerLoteServido(c.p.dir, c.monitor).perguntas[0];
    const gate = lerLedger(dirThread(c.p.dir, t)).find(e => e.tipo === 'hitl_requested' && (e.pedido as { id: string }).id === servida.pedidoId)!
      .pedido as PerguntaAoDono;
    registrarPedidoHitl(c.p.dir, { ...gate, id: 'sessao-SIMULADA-pergunta', codigo: 'K7M2',
      alvo: { tipo: 'session', sessionId: 'sessao-SIMULADA', runtime: 'claude-bg' } });
    const palavra = c.responder('aprovo', 'telegram:-7:50', depois(5));
    assert.equal(palavra.registradas.length, 0);
    assert.match(palavra.mensagem, /Há 2 perguntas esperando você, e uma palavra só não diz qual; nada foi registrado\./);
    // A letra solta também não diz a qual dos dois pedidos se refere.
    const solta = c.responder('a', 'telegram:-7:52', depois(5));
    assert.equal(solta.registradas.length, 0);
    const numerada = c.responder('1 aprovo', 'telegram:-7:53', depois(5));
    assert.equal(numerada.registradas.length, 0);
    assert.match(numerada.mensagem, /tem 2 pedidos abertos; resposta por palavra não registra/);
    const letra = c.responder('1a', 'telegram:-7:51', depois(6));
    assert.deepEqual(letra.registradas.map(x => x.estado), ['aprovado'], letra.mensagem);
  } finally { c.limpar(); }
});

test('B1 do CHECK: palavra solta não cai numa pergunta de outra thread quando há um gate aberto fora do lote', () => {
  const c = comLote('livre-outra-thread', 1);
  try {
    const y = c.itens[0].thread!;
    // Um gate de OUTRA thread mostrado pelo `gate request --formato`, fora do lote.
    const { thread: x } = novaThread(c.p.carregado, { nome: 'xray classic', modo: 'classic' });
    registrar(dirThread(c.p.dir, x.id), x.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const gate = abrirPedidoGate(c.p.dir, x.id, 'human.pending', depois(2)) as PerguntaAoDono;
    const r = c.responder('aprovo', 'telegram:-7:55', depois(3));
    assert.equal(r.registradas.length, 0, r.mensagem);
    assert.match(r.mensagem, /Há 2 perguntas esperando você/);
    assert.match(r.mensagem, new RegExp(`${gate.codigo} a`));
    assert.equal(humanos(c.p.dir, y).length + humanos(c.p.dir, x.id).length, 0);
  } finally { c.limpar(); }
});

test('palavra solta nunca registra ato sem volta; número e letra registram', () => {
  const c = cenarioDoPulse('livre-sem-volta', 1);
  try {
    const t = c.itens[0].thread!;
    const preparado = prepararPedidoGate(c.p.dir, t, 'human.pending', QUANDO);
    assert.ok('novo' in preparado);
    registrarPedidoHitl(c.p.dir, { ...preparado.novo, irreversivel: true, ato: 'push-base-protegida' });
    c.varrer(QUANDO);
    c.responder(`${lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo} a`, 'telegram:-7:60', depois(1));
    const palavra = c.responder('aprovo', 'telegram:-7:61', depois(2));
    assert.equal(palavra.registradas.length, 0);
    assert.match(palavra.mensagem, /A pergunta 1 é sem volta; palavra solta não registra\./);
    assert.equal(humanos(c.p.dir, t).length, 0);
    const letra = c.responder('1a', 'telegram:-7:62', depois(3));
    assert.deepEqual(letra.registradas.map(x => x.estado), ['aprovado'], letra.mensagem);
  } finally { c.limpar(); }
});

test('a palavra solta vale na janela curta; depois dela, só número ou código', () => {
  const c = comLote('livre-janela', 1);
  try {
    const t = c.itens[0].thread!;
    const tarde = depois(1 + JANELA_DO_TEXTO_LIVRE_MIN + 1);
    const r = c.responder('aprovo', 'telegram:-7:70', tarde);
    assert.equal(r.registradas.length, 0);
    assert.match(r.mensagem, /A pergunta que espera você não acabou de sair por aqui; palavra solta não registra\. Responda: 1 com a letra/);
    assert.equal(humanos(c.p.dir, t).length, 0);
    const numero = c.responder('1a', 'telegram:-7:71', depois(1 + JANELA_DO_TEXTO_LIVRE_MIN + 2));
    assert.deepEqual(numero.registradas.map(x => x.estado), ['aprovado'], numero.mensagem);
  } finally { c.limpar(); }
});

test('"<código> aprovo" responde ao gate; "<código> não" e "1 detalhes" não registram', () => {
  const c = cenarioDoPulse('livre-codigo', 1);
  try {
    const t = c.itens[0].thread!;
    const pedido = abrirPedidoGate(c.p.dir, t, 'human.pending', QUANDO) as PerguntaAoDono;
    const nao = c.responder(`${pedido.codigo} não`, 'telegram:-7:80', depois(1));
    assert.match(nao.mensagem, /serve para mais de uma alternativa/);
    assert.equal(humanos(c.p.dir, t).length, 0);
    const sim = c.responder(`${pedido.codigo} aprovo`, 'telegram:-7:81', depois(2));
    assert.deepEqual(sim.registradas.map(x => x.estado), ['aprovado'], sim.mensagem);
    assert.equal((humanos(c.p.dir, t)[0].enderecoAssinado as Record<string, unknown>).textoLivre, 'aprovo');
  } finally { c.limpar(); }
  const d = comLote('livre-detalhe', 1);
  try {
    const r = d.responder('1 detalhes', 'telegram:-7:90', depois(5));
    assert.match(r.mensagem, /^🔎 Evidências de 1 \(ork-/);
    assert.equal(humanos(d.p.dir, d.itens[0].thread!).length, 0);
  } finally { d.limpar(); }
});

test('a janela de escuta acompanha o que espera o dono, e a prova vem antes de qualquer leitura', () => {
  const c = comLote('livre-escuta', 1);
  try {
    const aberta = atualizarEscuta(c.p.dir, depois(2), c.monitor);
    assert.ok(aberta.livreAte && Date.parse(aberta.livreAte) > Date.parse(depois(2)));
    // Envelope forjado não chega a ser lido como "aprovo".
    const forjado = { ...dizer('aprovo', 'telegram:-7:95', depois(3)), prova: '0'.repeat(64) };
    assert.throws(() => responderPeloPulse(c.p.dir, forjado, { quando: depois(3), estadoDir: c.monitor }), /proveniência válida|não autenticada/);
    assert.equal(humanos(c.p.dir, c.itens[0].thread!).length, 0);
    c.responder('aprovo', 'telegram:-7:96', depois(4));
    assert.equal(atualizarEscuta(c.p.dir, depois(5), c.monitor).livreAte, null, 'respondida, a janela fecha');
  } finally { c.limpar(); }
});
