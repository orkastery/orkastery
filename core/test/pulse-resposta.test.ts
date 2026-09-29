/**
 * I-41 (GO-FIX 1, B1, B2, B3 e A4): o caminho de volta, de ponta a ponta.
 *
 * Todas as identidades, chaves e canais deste arquivo são SIMULADOS em projetos temporários. O
 * envelope é o que o ingresso do Hermes assina: canal `hermes`, corpo `ork.hitl-answer/v2`,
 * endereço do pulse e o texto que o dono digitou.
 *
 * Regra de suíte seguida aqui: ninguém espera por ARTEFATO. Cada asserção lê o CONTEÚDO que a
 * anterior produziu (o texto devolvido, o evento no ledger, o estado gravado), e tudo roda no
 * mesmo processo, sem relógio de parede nem espera por arquivo que outro processo ainda escreve.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { assinaturaDaResposta, EnderecoAssinado, responderGate, RespostaHumana, prepararPedidoGate } from '../src/hitl-gates';
import { aprovacoesHumanas } from '../src/gates';
import { atoDaPausa, ehV2 } from '../src/hitl-contract';
import { dirThread, gravarThread, lerThread, novaThread } from '../src/thread';
import { lerLedger, registrar } from '../src/ledger';
import { ItemPulse, Pulse } from '../src/pulse';
import { varrerPulse } from '../src/pulse-delivery';
import { ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, lerConsentimento } from '../src/pulse-consentimento';
import { interpretarRespostaDoPulse, lerLoteServido, responderPeloPulse } from '../src/pulse-resposta';

const QUANDO = '2026-09-22T23:00:00.000Z';
const depois = (min: number) => new Date(Date.parse(QUANDO) + min * 60000).toISOString();
const chave = 'chave-SIMULADA-do-canal-hermes-nos-testes-000';
const NOMES = ['alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY_HERMES = chave;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  delete process.env.ORK_HITL_INGRESS_KEY_OPENCLAW;
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** O que o ingresso do Hermes produz quando o dono digita `texto` no Telegram. */
function dizer(texto: string, mensagem: string, quando: string, endereco = { alvo: ALVO_DO_PULSE, pedido: ENDERECO_DA_RESPOSTA }): RespostaHumana {
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42', mensagem, recebidoEm: quando };
  return { ...r, prova: assinaturaDaResposta(endereco.alvo, endereco.pedido, r, chave) };
}

/** Threads de verdade paradas no gate de GOAL do #Classic: cada uma espera o veredito do dono. */
function noGate(p: ProjetoDeTeste, n: number, modo: 'classic' | 'auto' = 'classic'): ItemPulse[] {
  return NOMES.slice(0, n).map((nome, i) => {
    const { thread: t } = novaThread(p.carregado, { nome: `${nome} ${modo}`, modo });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    return item(t.id, i);
  });
}

function item(thread: string, i: number, extra: Partial<ItemPulse> = {}): ItemPulse {
  return { id: `thread:${thread}:GOAL:human.pending:ledger`, classe: 'thread', motivo: 'human.pending', thread, fase: 'GOAL',
    sessionId: null, desdeEm: '2026-09-22T20:00:00.000Z', paradaHaMin: 180 - i, impacto: 1,
    pergunta: `bloco fechado em GOAL: espera o veredito humano sobre objetivo (${i})`, opcoes: [], recomendacao: '',
    comandoResposta: 'ork thread status', evidencia: [], fontes: ['monitor'], contextoLogs: [], ...extra };
}

const pulseCom = (itens: ItemPulse[], quando = QUANDO): Pulse => ({
  contrato: 'ork.pulse/v1', consultadoEm: quando, runtime: { ok: true, detalhe: '' },
  precisaDeHumanoAgora: itens, acoesAutomaticas: [],
  resumo: { humanos: itens.length, automaticas: 0, scores: 0, fasesOrfas: 0 },
});

function cenario(nome: string, n: number) {
  const p = projetoTemporario(nome), restaurar = ambiente();
  const monitor = path.join(p.dir, '.orkastery', 'monitor');
  const itens = noGate(p, n);
  const mensagens: string[] = [];
  const varrer = (quando: string, lista = itens) => varrerPulse({ raiz: p.dir, consultar: () => pulseCom(lista, quando), quando,
    enviar: m => { mensagens.push(m); return true; } });
  const responder = (texto: string, mensagem: string, quando: string) =>
    responderPeloPulse(p.dir, dizer(texto, mensagem, quando), { quando, estadoDir: monitor });
  const limpar = () => { restaurar(); p.limpar(); };
  return { p, monitor, itens, mensagens, varrer, responder, limpar };
}

test('ponta a ponta: UM resumo, o sim pelo Telegram, o lote a-d, "1a 2c", e o ledger com prova', () => {
  const c = cenario('pulse-ponta', 3);
  try {
    // 1. UM resumo, com as perguntas que vão de fato sair e o código para responder.
    assert.equal(c.varrer(QUANDO).enviadas, 1);
    assert.equal(c.mensagens.length, 1);
    assert.match(c.mensagens[0], /Perguntas para você: 3/);
    assert.match(c.mensagens[0], /Posso te mandar as perguntas agora\?/);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    assert.match(c.mensagens[0], new RegExp(`Responda com ${codigo} a \\(sim\\) ou ${codigo} b \\(agora não\\)\\.`));

    // 2. O dono diz sim pelo Telegram. O lote é a resposta, com alternativas a-c e uma recomendada.
    const sim = c.responder(`${codigo} a`, 'telegram:-7:100', depois(5));
    assert.equal(sim.tipo, 'consentimento');
    assert.equal(sim.resposta, 'sim');
    assert.match(sim.mensagem, /^📋 Orkastery, 3 perguntas/);
    for (const n of [1, 2, 3]) assert.match(sim.mensagem, new RegExp(`^${n}\\. ork-`, 'm'));
    assert.match(sim.mensagem, /a\) Aprovar com as evidências apresentadas ✅ recomendada: a fase segue e o bloco avança/);
    assert.match(sim.mensagem, /c\) Continuar esperando/);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(sim.mensagem), false, 'identificador longo vazou para o dono');
    // O pedido de cada gate nasceu AGORA, em v2, com o prazo contado a partir do sim.
    const [t1, t2, t3] = c.itens.map(i => i.thread!);
    const pedidos = [t1, t2, t3].map(t => lerLedger(dirThread(c.p.dir, t)).filter(e => e.tipo === 'hitl_requested').at(-1)!.pedido as { contrato: string; criadoEm: string });
    for (const pedido of pedidos) {
      assert.equal(pedido.contrato, 'ork.hitl/v2');
      assert.equal(pedido.criadoEm, depois(5));
    }

    // 3. O dono responde "1a 2c". As duas respostas viram human_gate com prova, a terceira espera.
    const resposta = c.responder('1a 2c', 'telegram:-7:101', depois(8));
    assert.equal(resposta.tipo, 'lote');
    assert.deepEqual(resposta.registradas.map(r => [r.numero, r.letra, r.estado]), [[1, 'a', 'aprovado'], [2, 'c', 'aguardando']]);
    assert.match(resposta.mensagem, /1 → a\) Aprovar com as evidências apresentadas: a fase segue e o bloco avança\./);
    assert.match(resposta.mensagem, /2 → c\) Continuar esperando: nada muda; o item continua na fila\./);
    assert.match(resposta.mensagem, /Ainda sem resposta: 3\./);

    const numeroDa = (t: string) => lerLoteServido(c.p.dir, c.monitor).perguntas.find(q => q.thread === t)!.numero;
    const primeira = c.itens.map(i => i.thread!).find(t => numeroDa(t) === 1)!;
    const humano = lerLedger(dirThread(c.p.dir, primeira)).find(e => e.tipo === 'human_gate')!;
    assert.equal(humano.estado, 'aprovado');
    assert.equal(humano.origem, 'telegram');
    assert.equal(humano.canal, 'hermes');
    assert.equal(humano.contratoResposta, 'ork.hitl-answer/v2');
    assert.equal(humano.autorizadoPor, 'telegram:42');
    assert.equal(humano.mensagem, 'telegram:-7:101');
    assert.match(String(humano.recibo), /^[a-f0-9]{64}$/);
    assert.deepEqual({ ...(humano.enderecoAssinado as object), respostaDoDonoSha256: undefined },
      { alvo: 'pulse', endereco: 'resposta', contrato: 'ork.pulse-resposta/v1', numero: 1, letra: 'a', respostaDoDonoSha256: undefined });
    // A prova é a de sempre: retry e ship reconhecem a aprovação pelo recibo durável conferido.
    assert.equal(aprovacoesHumanas(c.p.dir, primeira).length, 1);
    assert.equal(humano.resposta, undefined, 'o corpo da resposta não é gravado');
  } finally { c.limpar(); }
});

test('resposta que não dá para cumprir recebe resposta útil, nunca silêncio nem exceção crua', () => {
  const c = cenario('pulse-recusas', 2);
  try {
    c.varrer(QUANDO);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    c.responder(`${codigo} a`, 'telegram:-7:200', depois(1));

    const nove = c.responder('9a', 'telegram:-7:201', depois(2));
    assert.equal(nove.registradas.length, 0);
    assert.match(nove.mensagem, /não há pergunta 9 aberta; as abertas são 1, 2\./);

    const letra = c.responder('1e', 'telegram:-7:202', depois(2));
    assert.match(letra.mensagem, /a pergunta 1 vai de a até c; "e" não é uma das alternativas\./);

    const dupla = c.responder('1a 1b', 'telegram:-7:203', depois(2));
    assert.match(dupla.mensagem, /você respondeu a pergunta 1 duas vezes \(1a e 1b\); mande de novo só a que vale\./);
    assert.equal(dupla.registradas.length, 0);

    // Nenhuma das recusas acima gravou veredito.
    for (const i of c.itens) assert.equal(lerLedger(dirThread(c.p.dir, i.thread!)).some(e => e.tipo === 'human_gate'), false);

    const certa = c.responder('1a', 'telegram:-7:204', depois(3));
    assert.equal(certa.registradas.length, 1);
    const mudou = c.responder('1b', 'telegram:-7:205', depois(4));
    assert.match(mudou.mensagem, /a pergunta 1 já foi respondida com a às \d{2}:\d{2}; a resposta não muda\./);
    const igual = c.responder('1a', 'telegram:-7:206', depois(4));
    assert.match(igual.mensagem, /1 → a\) Aprovar com as evidências apresentadas: já estava registrada\./);
    // Outra mensagem do dono com a mesma resposta é respondida; só a MESMA mensagem entregue de
    // novo pelo gateway conta como repetida, e aí o canal não reenvia nada.
    assert.equal(igual.repetida, false);
    assert.equal(c.responder('1a', 'telegram:-7:204', depois(4)).repetida, true);

    const nada = responderPeloPulse(c.p.dir, dizer('oi, tudo bem?', 'telegram:-7:207', depois(5)), { quando: depois(5), estadoDir: c.monitor });
    assert.equal(nada.tipo, 'nao-entendida');
    assert.match(nada.mensagem, /^Não entendi\./);
  } finally { c.limpar(); }
});

test('a prova não afrouxa: sem assinatura do canal, de outro endereço ou fora da janela, lança antes de ler o texto', () => {
  const c = cenario('pulse-prova', 1);
  try {
    c.varrer(QUANDO);
    const pedido = lerConsentimento(c.p.dir, c.monitor)!.pedido;
    const texto = `${pedido.codigo} a`;
    const falsos: [string, RespostaHumana, string][] = [
      ['prova forjada', { ...dizer(texto, 'telegram:-7:300', depois(1)), prova: '0'.repeat(64) }, depois(1)],
      ['texto trocado depois da assinatura', { ...dizer(`${pedido.codigo} b`, 'telegram:-7:301', depois(1)), resposta: texto }, depois(1)],
      ['assinado para uma thread e um pedido', dizer(texto, 'telegram:-7:302', depois(1), { alvo: c.itens[0].thread!, pedido: pedido.id }), depois(1)],
      ['fora da janela de 60 segundos', dizer(texto, 'telegram:-7:303', depois(1)), depois(3)],
    ];
    for (const [caso, envelope, quando] of falsos) {
      assert.throws(() => responderPeloPulse(c.p.dir, envelope, { quando, estadoDir: c.monitor }),
        /proveniência válida|não autenticada/, caso);
    }
    assert.equal(lerConsentimento(c.p.dir, c.monitor)!.respondido, undefined, 'envelope sem prova virou sim');
    assert.equal(lerLoteServido(c.p.dir, c.monitor).perguntas.length, 0);

    // Resposta derivada precisa ser o próprio envelope com outra letra; qualquer outro campo diverge.
    const r = c.responder(texto, 'telegram:-7:304', depois(2));
    assert.equal(r.resposta, 'sim');
    const servida = lerLoteServido(c.p.dir, c.monitor).perguntas[0];
    const envelope = dizer('1a', 'telegram:-7:305', depois(3));
    const assinado: EnderecoAssinado = { alvo: ALVO_DO_PULSE, endereco: ENDERECO_DA_RESPOSTA, envelope, rastro: {} };
    assert.throws(() => responderGate(c.p.dir, servida.thread, servida.pedidoId, { ...envelope, resposta: 'a', por: 'telegram:43' },
      depois(3), assinado), /diverge do envelope assinado/);
    // Um envelope legítimo assinado para OUTRO pedido não vira prova deste só porque a assinatura
    // bate com o endereço que ela cobre: fora do pulse, endereço assinado é recusado.
    const doOutro = dizer('a', 'telegram:-7:306', depois(3), { alvo: servida.thread, pedido: 'pedido-de-outro-gate' });
    assert.throws(() => responderGate(c.p.dir, servida.thread, servida.pedidoId, doOutro, depois(3),
      { alvo: servida.thread, endereco: 'pedido-de-outro-gate', envelope: doOutro, rastro: {} }), /fora do pulse/);
    assert.equal(lerLedger(dirThread(c.p.dir, servida.thread)).some(e => e.tipo === 'human_gate'), false);
  } finally { c.limpar(); }
});

test('o sim repetido devolve o MESMO lote, e a varredura nunca manda pergunta', () => {
  const c = cenario('pulse-repetido', 2);
  try {
    c.varrer(QUANDO);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    const um = c.responder(`${codigo} a`, 'telegram:-7:400', depois(1));
    const dois = c.responder(`${codigo} sim`, 'telegram:-7:401', depois(2));
    // O dono pediu de novo por outra mensagem: ele recebe o mesmo lote, não silêncio.
    assert.equal(dois.repetida, false);
    // A mesma mensagem entregue de novo pelo gateway é repetida: o canal não reenvia.
    assert.equal(c.responder(`${codigo} a`, 'telegram:-7:400', depois(1)).repetida, true);
    assert.equal(dois.mensagem.split('\n').filter(l => /^\d\. /.test(l)).join('|'), um.mensagem.split('\n').filter(l => /^\d\. /.test(l)).join('|'));
    assert.equal(lerLoteServido(c.p.dir, c.monitor).perguntas.length, 2, 'o sim repetido serviu outro lote');
    // Nada mudou: a varredura não manda nada, e em especial não manda pergunta.
    assert.equal(c.varrer(depois(10)).enviadas, 0);
    assert.equal(c.mensagens.length, 1);
    // "Agora não" depois do sim é recusado com o que já vale, em texto para o dono.
    const nao = c.responder(`${codigo} b`, 'telegram:-7:402', depois(11));
    assert.match(nao.mensagem, /Você já respondeu sim a este resumo às \d{2}:\d{2}/);
  } finally { c.limpar(); }
});

test('gate que o dono já recebeu não toca resumo sozinho, e volta entre as perguntas quando há novidade', () => {
  const c = cenario('pulse-ja-servido', 2);
  try {
    c.varrer(QUANDO);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    c.responder(`${codigo} a`, 'telegram:-7:800', depois(1));
    // "2c": continuar esperando. O gate segue esperando o dono, e ele já viu a pergunta.
    const r = c.responder('2c', 'telegram:-7:801', depois(2));
    assert.deepEqual(r.registradas.map(x => [x.numero, x.estado]), [[2, 'aguardando']]);
    // A pergunta 1 vence sem resposta. Nenhum dos dois toca resumo sozinho: o dono já os viu.
    assert.equal(c.varrer(depois(70)).enviadas, 0, 'gate já oferecido voltou a tocar sozinho');
    // RM-048 (D4): o código usado reenvia a pergunta ainda sem resposta, mesmo depois do prazo de
    // uma hora: o número dela continua valendo, e a resposta vai ao pedido renovado.
    const velho = c.responder(`${codigo} a`, 'telegram:-7:802', depois(71));
    assert.match(velho.mensagem, /^1\. ork-/m);
    assert.equal(/^2\. ork-/m.test(velho.mensagem), false, 'a respondida não volta');
    // Novidade de verdade (um item novo) traz o resumo, e os dois gates voltam entre as perguntas.
    const { thread: nova } = novaThread(c.p.carregado, { nome: 'india classic', modo: 'classic' });
    registrar(dirThread(c.p.dir, nova.id), nova.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    const novo = item(nova.id, 9);
    const mensagens: string[] = [];
    const r2 = varrerPulse({ raiz: c.p.dir, consultar: () => pulseCom([...c.itens, novo], depois(72)), quando: depois(72),
      enviar: m => { mensagens.push(m); return true; } });
    assert.equal(r2.enviadas, 1);
    assert.match(mensagens[0], /Perguntas para você: 3/);
  } finally { c.limpar(); }
});

test('B3: o que nunca vai sair não é contado como pergunta, e o resumo sem pergunta não pede licença', () => {
  const p = projetoTemporario('pulse-b3-zero'), restaurar = ambiente();
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    // Uma thread #Auto não pausa, uma nota de entrega não é gate, e uma thread que não existe mais
    // é história: nenhum dos três vira pergunta.
    const auto = noGate(p, 1, 'auto');
    const score: ItemPulse = { ...item('ork-entregue', 9), id: 'score:ork-entregue', classe: 'score_pendente', motivo: 'master.score-pendente', fase: 'MASTER' };
    const sumida = item('ork-sumida', 8);
    const mensagens: string[] = [];
    const r = varrerPulse({ raiz: p.dir, consultar: () => pulseCom([...auto, score, sumida]), quando: QUANDO,
      enviar: m => { mensagens.push(m); return true; } });
    assert.equal(r.enviadas, 1);
    assert.match(mensagens[0], /Esperando você: 3/);
    assert.match(mensagens[0], /Perguntas para você: 0/);
    assert.match(mensagens[0], /Nada aqui pede resposta sua por este canal agora\./);
    assert.equal(mensagens[0].includes('Posso te mandar'), false, 'pediu licença para mandar zero perguntas');
    assert.equal(lerConsentimento(p.dir, monitor), undefined, 'sem pergunta, não há código para responder');
  } finally { restaurar(); p.limpar(); }
});

test('B3: pedido v1 vencido de um gate que ainda espera volta, no sim, como pergunta v2 nova', () => {
  const p = projetoTemporario('pulse-b3-v1'), restaurar = ambiente();
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    const [comV1] = noGate(p, 1);
    const t = lerThread(p.dir, comV1.thread!);
    // O pedido real de ork-i31kg1contra em 20/09: v1, recomendação genérica, prazo de uma hora.
    const v1 = { contrato: 'ork.hitl/v1', id: 'e2f66a29-366a-402e-b567-e9f271556f8d', thread: t.id, fase: 'GOAL', modo: t.modo,
      alvo: { tipo: 'gate', sobre: 'objetivo' }, motivo: 'human.pending', pergunta: 'Qual é o veredito sobre objetivo?',
      opcoes: [{ numero: 1, texto: 'Aprovar com as evidências apresentadas', acao: 'aprovar' },
        { numero: 2, texto: 'Solicitar revisão', acao: 'recusar' }, { numero: 3, texto: 'Continuar esperando', acao: 'esperar' }],
      recomendacao: 'Confira artefatos, claims e riscos antes de responder.', criadoEm: '2026-09-20T03:51:09.495Z',
      prazo: '2026-09-20T04:51:09.495Z', acaoPadraoAoExpirar: 'esperar', respostaAceita: { tipo: 'opcao', maxCaracteres: 100 },
      profundidade: 'detalhada' };
    registrar(dirThread(p.dir, t.id), t.id, 'hitl_requested', { fase: 'GOAL', pedido: v1, contexto: 'antigo' });
    const itens = [{ ...comV1, pedido: v1 as unknown as ItemPulse['pedido'] }];
    const mensagens: string[] = [];
    varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens), quando: QUANDO, enviar: m => { mensagens.push(m); return true; } });
    assert.match(mensagens[0], /Perguntas para você: 1/);
    const codigo = lerConsentimento(p.dir, monitor)!.pedido.codigo;
    const sim = responderPeloPulse(p.dir, dizer(`${codigo} a`, 'telegram:-7:500', depois(1)), { quando: depois(1), estadoDir: monitor });
    assert.match(sim.mensagem, /^📋 Orkastery, 1 pergunta/);
    const novo = lerLedger(dirThread(p.dir, t.id)).filter(e => e.tipo === 'hitl_requested').at(-1)!.pedido as { id: string; contrato: string };
    assert.notEqual(novo.id, v1.id);
    assert.equal(novo.contrato, 'ork.hitl/v2');
  } finally { restaurar(); p.limpar(); }
});

test('A4: servido um lote, o resto sai com um código novo, e os números continuam', () => {
  const c = cenario('pulse-a4', 7);
  try {
    c.varrer(QUANDO);
    assert.match(c.mensagens[0], /Perguntas para você: 7/);
    const codigo = lerConsentimento(c.p.dir, c.monitor)!.pedido.codigo;
    const primeiro = c.responder(`${codigo} a`, 'telegram:-7:600', depois(1));
    assert.match(primeiro.mensagem, /^📋 Orkastery, 5 perguntas/);
    const proximo = /Faltam 2\. Para receber as próximas, responda ([2-9A-HJKMNP-TV-Z]{4}) a\./.exec(primeiro.mensagem);
    assert.ok(proximo, primeiro.mensagem);
    assert.notEqual(proximo[1], codigo);
    // O resto não espera algum item mudar: um código, e ele chega.
    const segundo = c.responder(`${proximo[1]} a`, 'telegram:-7:601', depois(2));
    assert.match(segundo.mensagem, /^📋 Orkastery, 2 perguntas/);
    assert.match(segundo.mensagem, /^6\. ork-/m);
    assert.match(segundo.mensagem, /^7\. ork-/m);
    const resposta = c.responder('6a 7b', 'telegram:-7:602', depois(3));
    assert.deepEqual(resposta.registradas.map(r => [r.numero, r.estado]), [[6, 'aprovado'], [7, 'recusado']]);
    // Tudo servido e nada mudou: a varredura continua quieta.
    assert.equal(c.varrer(depois(10)).enviadas, 0);
  } finally { c.limpar(); }
});

test('A1: a pausa que libera push na base protegida é contada como sem volta', () => {
  assert.equal(atoDaPausa('human.pending', 'evidencias, com autorizacao antecipada de push'), 'push-base-protegida');
  assert.equal(atoDaPausa('human.pending', 'push'), 'push-base-protegida');
  assert.equal(atoDaPausa('human.pending', 'premissas'), undefined);
  assert.equal(atoDaPausa('cost.violation', ''), 'dinheiro');
  assert.equal(atoDaPausa('policy.violation', 'push'), undefined, 'escalação não herda o assunto da pausa');

  const p = projetoTemporario('pulse-a1'), restaurar = ambiente();
  try {
    const { thread: t } = novaThread(p.carregado, { nome: 'push classic', modo: 'classic' });
    t.faseAtual = 'CHECK'; gravarThread(p.dir, t);
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'CHECK', evidencia: 'fixture simulada' });
    const preparado = prepararPedidoGate(p.dir, t.id, 'human.pending', QUANDO);
    assert.ok('novo' in preparado);
    assert.equal(ehV2(preparado.novo) && preparado.novo.irreversivel, true);
    assert.equal(preparado.novo.ato, 'push-base-protegida');
    const mensagens: string[] = [];
    varrerPulse({ raiz: p.dir, consultar: () => pulseCom([{ ...item(t.id, 0), id: `thread:${t.id}:CHECK:human.pending:ledger`, fase: 'CHECK' }]),
      quando: QUANDO, enviar: m => { mensagens.push(m); return true; } });
    assert.match(mensagens[0], /🔒 Sem volta depois de feito: 1/);
  } finally { restaurar(); p.limpar(); }
});

test('a forma da resposta: o que é resposta ao resumo, o que é resposta ao lote e o que é conversa', () => {
  for (const lote of ['1a 2c', '1a, 2c', '1 a', '10b', '1A', ' 3c. ', '1a;2b']) {
    assert.equal(interpretarRespostaDoPulse(lote).forma, 'lote', lote);
  }
  assert.deepEqual(interpretarRespostaDoPulse('1a 2C').forma === 'lote' && interpretarRespostaDoPulse('1a 2C'),
    { forma: 'lote', escolhas: [{ numero: 1, letra: 'a' }, { numero: 2, letra: 'c' }] });
  for (const resumo of ['P4EJ a', 'p4ej sim', 'K3F9 agora não', '  X7YZ b']) {
    assert.equal(interpretarRespostaDoPulse(resumo).forma, 'consentimento', resumo);
  }
  // Conversa comum continua sendo conversa: palavra de quatro letras não tem dígito.
  for (const conversa of ['HMMM ok', 'oi tudo bem', 'BORA ver isso', '1ab', 'bora 2', '', 'P4EJ', '1a\n2b', 'x'.repeat(201), '7XYZ b']) {
    assert.equal(interpretarRespostaDoPulse(conversa).forma, 'desconhecida', conversa);
  }
});

test('CLI: ork pulse responder lê o envelope do stdin e devolve o texto que o canal repassa', () => {
  const p = projetoTemporario('pulse-cli'), restaurar = ambiente();
  try {
    const itens = noGate(p, 1);
    const agora = new Date().toISOString();
    varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens, agora), quando: agora, enviar: () => true });
    const codigo = lerConsentimento(p.dir)!.pedido.codigo;
    const envelope = dizer(`${codigo} a`, 'telegram:-7:700', new Date().toISOString());
    const ork = path.resolve(__dirname, '../../dist/index.js');
    const r = spawnSync(process.execPath, [ork, 'pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes',
      '--por', envelope.por, '--mensagem', envelope.mensagem], { cwd: p.dir, input: JSON.stringify(envelope), encoding: 'utf8',
      env: { ...process.env }, timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const saida = JSON.parse(r.stdout);
    assert.equal(saida.contrato, 'ork.pulse-resposta/v1');
    assert.equal(saida.ok, true);
    assert.equal(saida.resposta, 'sim');
    assert.match(saida.mensagem, /^📋 Orkastery, 1 pergunta/);
    // argv que diverge do envelope é recusado antes de qualquer conferência, como no gate answer.
    const divergente = spawnSync(process.execPath, [ork, 'pulse', 'responder', '--resposta-stdin', '--origem', 'telegram', '--canal', 'hermes',
      '--por', 'telegram:43', '--mensagem', envelope.mensagem], { cwd: p.dir, input: JSON.stringify(envelope), encoding: 'utf8',
      env: { ...process.env }, timeout: 60000 });
    assert.notEqual(divergente.status, 0);
    assert.match(divergente.stderr, /proveniência em argv diverge do envelope/);
  } finally { restaurar(); p.limpar(); }
});
