/**
 * I-50 (RM-039): a cadencia do resumo do pulse, trocada pelo dono com uma tag no canal.
 *
 * Todas as identidades, chaves e canais deste arquivo sao SIMULADOS em projetos temporarios. As
 * janelas sao conferidas no fuso do dono, fixado em Brasilia, e o relogio e sempre o `quando`
 * passado: nenhum teste espera pelo relogio de parede.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { definirFusoDoDono, formatarDataHoraRotulada } from '../src/horario';
import { DecisaoParaODono } from '../src/decisao-autonoma';
import { registrar } from '../src/ledger';
import { ItemPulse, Pulse } from '../src/pulse';
import { varrerPulse } from '../src/pulse-delivery';
import { ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, lerConsentimento } from '../src/pulse-consentimento';
import { interpretarRespostaDoPulse, responderPeloPulse } from '../src/pulse-resposta';
import { CADENCIA_PADRAO, CADENCIAS, extrairTagDoPulse, gravarCadencia, inicioDaProximaJanela, janelaAberta,
  janelaDoInstante, lerCadencia, lerUltimoResumo } from '../src/pulse-cadencia';
import { dirThread, novaThread } from '../src/thread';

const FUSO = 'America/Sao_Paulo';
/** Um instante dado na hora de Brasilia, em ISO. */
const brt = (hhmm: string, dia = '2026-09-27') => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const chave = 'chave-SIMULADA-do-canal-hermes-nos-testes-000';

function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY_HERMES = chave;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  delete process.env.ORK_HITL_INGRESS_KEY_OPENCLAW;
  definirFusoDoDono(FUSO);
  return () => {
    definirFusoDoDono(undefined);
    nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
  };
}

/** O que o ingresso do Hermes produz quando o dono digita `texto` no Telegram. */
function dizer(texto: string, mensagem: string, quando: string): RespostaHumana {
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42', mensagem, recebidoEm: quando };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, r, chave) };
}

/** Uma thread de verdade parada no gate de GOAL do #Classic: espera o veredito do dono. */
function noGate(p: ProjetoDeTeste, nome: string): ItemPulse {
  const { thread: t } = novaThread(p.carregado, { nome, modo: 'classic' });
  registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
  return { id: `thread:${t.id}:GOAL:human.pending:ledger`, classe: 'thread', motivo: 'human.pending', thread: t.id, fase: 'GOAL',
    sessionId: null, desdeEm: brt('06:00'), paradaHaMin: 180, impacto: 1,
    pergunta: `bloco fechado em GOAL: espera o veredito humano sobre objetivo (${nome})`, opcoes: [], recomendacao: '',
    comandoResposta: 'ork thread status', evidencia: [], fontes: ['monitor'], contextoLogs: [] };
}

/** Uma decisao tomada sem perguntar: noticia para o resumo, nunca pergunta. */
function decisao(id: string, thread: string): DecisaoParaODono {
  return { id, thread, fase: 'GO', em: brt('06:30'), decidido: `decisao simulada ${id}`, porque: 'fixture',
    comoMudar: 'ork decisao reverter', custoDeReverter: { agora: 'baixo', depois: 'baixo' }, quemDecidiu: 'agente simulado' };
}

const pulseCom = (itens: ItemPulse[], decisoes: DecisaoParaODono[], quando: string): Pulse => ({
  contrato: 'ork.pulse/v1', consultadoEm: quando, runtime: { ok: true, detalhe: '' },
  precisaDeHumanoAgora: itens, acoesAutomaticas: [], decisoes,
  resumo: { humanos: itens.length, automaticas: 0, scores: 0, fasesOrfas: 0 },
});

test('a tag: sozinha na mensagem é resposta ao pulse; no meio da frase, continua conversa', () => {
  const casos: [string, string][] = [
    ['#OrkPulseOn', '#OrkPulseOn'], ['#orkpulseon-15m', '#OrkPulseOn-15m'], [' #OrkPulseOn-30m. ', '#OrkPulseOn-30m'],
    ['#OrkPulseOn-60m!', '#OrkPulseOn-60m'], ['#OrkPulseOff', '#OrkPulseOff'], ['#ORKPULSEOFF', '#OrkPulseOff'],
  ];
  for (const [texto, tag] of casos) {
    assert.equal(extrairTagDoPulse(texto), tag, texto);
    assert.deepEqual(interpretarRespostaDoPulse(texto), { forma: 'cadencia', tag }, texto);
  }
  for (const texto of ['#OrkPulseOff-15m', '#OrkPulseOn-45m', '#OrkPulseOnline', 'OrkPulseOn', '#OrkPulse', '#OrkPulseOn\n1a']) {
    assert.equal(interpretarRespostaDoPulse(texto).forma, 'desconhecida', texto);
  }
  for (const texto of ['#OrkPulseOff-15m', '#OrkPulseOn-45m', '#OrkPulseOnline', 'OrkPulseOn', '#OrkPulse']) {
    assert.equal(extrairTagDoPulse(texto), null, texto);
  }
  // Na conversa a tag e achada, mas a mensagem nao e resposta ao pulse: vai para o assistente.
  assert.equal(extrairTagDoPulse('pode deixar em #OrkPulseOff hoje'), '#OrkPulseOff');
  assert.equal(interpretarRespostaDoPulse('pode deixar em #OrkPulseOff hoje').forma, 'desconhecida');
});

test('as janelas são do fuso do dono: #OrkPulseOff vira às 08h, 16h e 00h de Brasília', () => {
  const off = CADENCIAS['#OrkPulseOff'];
  const j = (hhmm: string, dia?: string) => janelaDoInstante(off, brt(hhmm, dia), FUSO);
  assert.equal(j('08:00'), j('15:59'));
  assert.equal(j('16:00'), j('08:00') + 1);
  assert.equal(j('23:59'), j('16:00'));
  assert.equal(j('00:00', '2026-09-28'), j('16:00') + 1);
  assert.equal(j('07:59', '2026-09-28'), j('00:00', '2026-09-28'));
  assert.equal(j('07:59'), j('08:00') - 1);
  assert.equal(inicioDaProximaJanela(off, brt('07:30'), FUSO), brt('08:00'));
  assert.equal(inicioDaProximaJanela(off, brt('08:00'), FUSO), brt('16:00'));
  assert.equal(inicioDaProximaJanela(off, brt('20:10'), FUSO), brt('00:00', '2026-09-28'));

  assert.equal(inicioDaProximaJanela(CADENCIAS['#OrkPulseOn'], brt('09:05'), FUSO), brt('10:00'), '2h nas horas pares');
  assert.equal(inicioDaProximaJanela(CADENCIAS['#OrkPulseOn-60m'], brt('09:05'), FUSO), brt('10:00'));
  assert.equal(inicioDaProximaJanela(CADENCIAS['#OrkPulseOn-30m'], brt('09:05'), FUSO), brt('09:30'));
  const quinze = CADENCIAS['#OrkPulseOn-15m'];
  assert.equal(inicioDaProximaJanela(quinze, '2026-09-27T12:05:30.000Z', FUSO), brt('09:15'), 'sem segundos na hora dita ao dono');

  // Uma entrega por janela: a batida seguinte dentro da mesma janela nao entrega de novo.
  assert.equal(janelaAberta(quinze, null, brt('09:05'), FUSO), true, 'sem resumo anterior, entrega');
  assert.equal(janelaAberta(quinze, brt('09:01'), brt('09:14'), FUSO), false);
  assert.equal(janelaAberta(quinze, brt('09:01'), brt('09:15'), FUSO), true);
  assert.equal(janelaAberta(off, brt('08:03'), brt('15:45'), FUSO), false);
  assert.equal(janelaAberta(off, brt('08:03'), brt('16:00'), FUSO), true);
});

test('cadência gravada: sem tag vale a padrão, e arquivo adulterado também', () => {
  const p = projetoTemporario('pulse-cadencia-arquivo');
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    assert.equal(lerCadencia(p.dir, monitor).tag, CADENCIA_PADRAO);
    assert.equal(lerCadencia(p.dir, monitor).gravada, null);
    gravarCadencia(p.dir, '#OrkPulseOn', { por: 'terminal:dono', canal: 'terminal', em: brt('09:00') }, monitor);
    const arquivo = path.join(monitor, 'pulse-cadencia.json');
    assert.equal(fs.statSync(arquivo).mode & 0o777, 0o600);
    assert.equal(lerCadencia(p.dir, monitor).janelaMin, 120);
    assert.throws(() => gravarCadencia(p.dir, '#OrkPulseOn-45m' as never, { por: 'x', canal: 'terminal' }, monitor), /tag desconhecida/);
    assert.throws(() => gravarCadencia(p.dir, '#OrkPulseOn', { por: '  ', canal: 'terminal' }, monitor), /quem trocou/);
    fs.writeFileSync(arquivo, JSON.stringify({ contrato: 'ork.pulse-cadencia/v1', tag: '#OrkPulseOn-1m' }));
    assert.equal(lerCadencia(p.dir, monitor).tag, CADENCIA_PADRAO, 'tag fora da lista nunca vira cadência');
  } finally { p.limpar(); }
});

test('a batida do cron: pergunta nova sai na hora, o resto espera a janela e continua não vista', () => {
  const p = projetoTemporario('pulse-cadencia-batida'), restaurar = ambiente();
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    gravarCadencia(p.dir, '#OrkPulseOn', { por: 'telegram:42', canal: 'hermes', em: brt('08:00') }, monitor);
    const primeira = noGate(p, 'alfa');
    const mensagens: string[] = [];
    const bater = (quando: string, itens: ItemPulse[], decisoes: DecisaoParaODono[]) => varrerPulse({ raiz: p.dir,
      consultar: () => pulseCom(itens, decisoes, quando), quando, comCadencia: true,
      enviar: m => { mensagens.push(m); return true; } });

    // 09:05: a primeira pergunta. Sai na hora, e o resumo conta como o desta janela (08h-10h).
    assert.equal(bater(brt('09:05'), [primeira], []).enviadas, 1);
    assert.equal(lerUltimoResumo(p.dir, monitor), brt('09:05'));

    // 09:20: so uma decisao informada. Nao e pergunta: espera a janela das 10h.
    const d1 = decisao('d1', primeira.thread!);
    const adiada = bater(brt('09:20'), [primeira], [d1]);
    assert.equal(adiada.enviadas, 0);
    assert.match(adiada.detalhe, /guardada para a janela seguinte da cadencia #OrkPulseOn/);

    // 09:35: uma pergunta nova nao espera janela nenhuma, e leva junto a decisao que esperava.
    const segunda = noGate(p, 'bravo');
    assert.equal(bater(brt('09:35'), [primeira, segunda], [d1]).enviadas, 1);
    assert.equal(mensagens.length, 2);

    // 09:50: outra decisao, de novo so na janela seguinte; 10:00 a janela virou e ela sai.
    const d2 = decisao('d2', segunda.thread!);
    assert.equal(bater(brt('09:50'), [primeira, segunda], [d1, d2]).enviadas, 0);
    assert.equal(bater(brt('10:00'), [primeira, segunda], [d1, d2]).enviadas, 1);
    assert.equal(mensagens.length, 3);

    // 10:15: nada novo, nada sai; o log diz por que.
    assert.equal(bater(brt('10:15'), [primeira, segunda], [d1, d2]).detalhe, 'sem novidade');

    // Sem a cadencia (chamada direta, terminal, testes antigos), a novidade sai na hora, como antes.
    const d3 = decisao('d3', segunda.thread!);
    assert.equal(varrerPulse({ raiz: p.dir, consultar: () => pulseCom([primeira, segunda], [d1, d2, d3], brt('10:20')),
      quando: brt('10:20'), enviar: m => { mensagens.push(m); return true; } }).enviadas, 1);
  } finally { restaurar(); p.limpar(); }
});

test('cadência curta não encurta o prazo do dono para responder ao resumo', () => {
  const p = projetoTemporario('pulse-cadencia-prazo'), restaurar = ambiente();
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    gravarCadencia(p.dir, '#OrkPulseOn-15m', { por: 'telegram:42', canal: 'hermes', em: brt('08:00') }, monitor);
    const item = noGate(p, 'charlie');
    varrerPulse({ raiz: p.dir, consultar: () => pulseCom([item], [], brt('09:05')), quando: brt('09:05'), comCadencia: true,
      enviar: () => true });
    assert.equal(lerConsentimento(p.dir, monitor)!.pedido.prazo, brt('10:05'), 'o mínimo de 60 min continua valendo');
  } finally { restaurar(); p.limpar(); }
});

test('a tag chega pelo ingresso autenticado, grava quem mandou e responde no fuso do dono', () => {
  const p = projetoTemporario('pulse-cadencia-tag'), restaurar = ambiente();
  try {
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    const quando = brt('09:05');
    const r = responderPeloPulse(p.dir, dizer('#OrkPulseOff', 'telegram:-7:300', quando), { quando, estadoDir: monitor });
    assert.equal(r.tipo, 'cadencia');
    assert.equal(r.cadencia, '#OrkPulseOff');
    assert.equal(r.repetida, false);
    assert.match(r.mensagem, /de 8 em 8 horas, as 08h, 16h e 00h/);
    assert.match(r.mensagem, /Pergunta para você continua saindo na hora/);
    assert.ok(r.mensagem.includes(formatarDataHoraRotulada(brt('16:00'))), r.mensagem);

    const gravada = lerCadencia(p.dir, monitor).gravada!;
    assert.deepEqual({ tag: gravada.tag, por: gravada.por, canal: gravada.canal, em: gravada.em },
      { tag: '#OrkPulseOff', por: 'telegram:42', canal: 'hermes', em: quando });

    // Mandar a mesma tag de novo e inofensivo, e o recibo diz que ja era essa.
    const depois = brt('09:06');
    assert.equal(responderPeloPulse(p.dir, dizer('#orkpulseoff', 'telegram:-7:301', depois), { quando: depois, estadoDir: monitor }).repetida, true);

    // Sem prova de origem, nada muda: a cadencia so troca pelo dono.
    const forjada = { ...dizer('#OrkPulseOn-15m', 'telegram:-7:302', depois), prova: '0'.repeat(64) };
    assert.throws(() => responderPeloPulse(p.dir, forjada, { quando: depois, estadoDir: monitor }));
    assert.equal(lerCadencia(p.dir, monitor).tag, '#OrkPulseOff');
  } finally { restaurar(); p.limpar(); }
});

test('CLI: ork pulse cadencia mostra a vigente e troca pela tag, com ou sem #', () => {
  const p = projetoTemporario('pulse-cadencia-cli');
  try {
    const ork = path.resolve(__dirname, '../../dist/index.js');
    const rodar = (...argv: string[]) => spawnSync(process.execPath, [ork, 'pulse', 'cadencia', ...argv],
      { cwd: p.dir, encoding: 'utf8', env: { ...process.env }, timeout: 60000 });
    const antes = rodar('--json');
    assert.equal(antes.status, 0, antes.stderr);
    assert.equal(JSON.parse(antes.stdout).tag, CADENCIA_PADRAO);

    const troca = rodar('OrkPulseOn-30m', '--por', 'dono-simulado');
    assert.equal(troca.status, 0, troca.stderr);
    assert.match(troca.stdout, /de 30 em 30 minutos \(#OrkPulseOn-30m\)/);
    assert.match(troca.stdout, /Trocada por dono-simulado \(terminal\)/);
    const depois = JSON.parse(rodar('--json').stdout);
    assert.equal(depois.tag, '#OrkPulseOn-30m');
    assert.equal(depois.gravada.por, 'dono-simulado');

    const errada = rodar('#OrkPulseOn-45m');
    assert.notEqual(errada.status, 0);
    assert.match(errada.stderr, /tag desconhecida/);
    assert.equal(JSON.parse(rodar('--json').stdout).tag, '#OrkPulseOn-30m', 'tag errada nao troca nada');
  } finally { p.limpar(); }
});
