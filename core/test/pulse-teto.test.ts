/**
 * A REGRA DURA desta entrega, com o número real do incidente.
 *
 * Em 20/09/2026 às 16:00 (horário de Brasília) o cron do pulse foi religado depois de ficar
 * parado desde 08/09. A varredura achou 75 itens e mandou 75 mensagens no Telegram do dono, em
 * minutos. `.orkastery/monitor/hitl.log` registrou `{"enviadas":75,"novas":75}` naquela linha.
 *
 * Este arquivo existe para que isso não volte a acontecer por regressão silenciosa. Se alguém
 * reintroduzir o laço que entrega por item, estes testes quebram.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { projetoTemporario } from './apoio';
import { assinaturaPulse, varrerPulse } from '../src/pulse-delivery';
import { ItemPulse, Pulse } from '../src/pulse';
import { ApresentacaoHitl } from '../src/hitl-presentation';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, lerConsentimento } from '../src/pulse-consentimento';
import { responderPeloPulse } from '../src/pulse-resposta';
import { dirThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';

const QUANDO = '2026-09-20T19:00:05.429Z'; // o instante exato da linha do hitl.log

const item = (n: number): ItemPulse => ({
  id: `thread:ork-thread${String(n % 18).padStart(2, '0')}:GO:human.pending:ledger`,
  classe: 'thread', motivo: 'human.pending', thread: `ork-thread${String(n % 18).padStart(2, '0')}`,
  fase: 'GO', sessionId: null, desdeEm: '2026-09-08T09:00:00Z', paradaHaMin: 17_400, impacto: 3,
  pergunta: `Pergunta ${n}?`, opcoes: [], recomendacao: 'Conferir antes de responder.',
  comandoResposta: 'ork thread status', evidencia: [], fontes: ['monitor'], contextoLogs: [],
});

const pulseCom = (itens: ItemPulse[]): Pulse => ({
  contrato: 'ork.pulse/v1', consultadoEm: QUANDO, runtime: { ok: true, detalhe: '' },
  precisaDeHumanoAgora: itens, acoesAutomaticas: [],
  resumo: { humanos: itens.length, automaticas: 0, scores: 0, fasesOrfas: 0 },
});

test('75 itens produzem 1 mensagem, não 75', () => {
  const p = projetoTemporario('pulse-teto-75');
  try {
    const itens = Array.from({ length: 75 }, (_, i) => item(i));
    const mensagens: string[] = [];
    const r = varrerPulse({
      raiz: p.dir, consultar: () => pulseCom(itens), quando: QUANDO,
      enviar: m => { mensagens.push(m); return true; },
    });
    assert.equal(r.code, 0);
    assert.equal(r.novas, 75, 'as 75 novidades continuam sendo contadas');
    assert.equal(r.enviadas, 1, `75 itens entregaram ${r.enviadas} mensagens`);
    assert.equal(mensagens.length, 1);
    // A mensagem diz 75 uma vez, como contagem, e não 75 vezes, como lista.
    assert.match(mensagens[0], /Esperando você: 75/);
    assert.equal(mensagens[0].split('\n').length <= 16, true, mensagens[0]);
    assert.equal(mensagens[0].includes('Pergunta 1?'), false, 'pergunta de item não vaza para o resumo');
  } finally { p.limpar(); }
});

test('o teto não é uma constante de 5: 200 itens também produzem 1 mensagem', () => {
  const p = projetoTemporario('pulse-teto-200');
  try {
    const itens = Array.from({ length: 200 }, (_, i) => item(i));
    let enviadas = 0;
    const r = varrerPulse({
      raiz: p.dir, consultar: () => pulseCom(itens), quando: QUANDO, enviar: () => { enviadas++; return true; },
    });
    assert.equal(r.enviadas, 1);
    assert.equal(enviadas, 1);
  } finally { p.limpar(); }
});

test('nada mudou, nada sai: o resumo não é um relógio que toca de hora em hora', () => {
  const p = projetoTemporario('pulse-teto-silencio');
  try {
    const itens = Array.from({ length: 12 }, (_, i) => item(i));
    const consultar = () => pulseCom(itens);
    const rodar = (quando: string) => varrerPulse({ raiz: p.dir, consultar, quando, enviar: () => true });
    assert.equal(rodar(QUANDO).enviadas, 1);
    assert.equal(rodar('2026-09-20T20:00:00.000Z').enviadas, 0, 'a hora passou, nada mudou');
    assert.equal(rodar('2026-09-20T21:00:00.000Z').enviadas, 0);
    // Item novo é notícia, e a notícia continua sendo UMA mensagem.
    itens.push(item(99));
    assert.equal(rodar('2026-09-20T22:00:00.000Z').enviadas, 1);
  } finally { p.limpar(); }
});

test('commit em qualquer worktree não reenvia item cuja pergunta não mudou', () => {
  const p = projetoTemporario('pulse-teto-assinatura');
  try {
    const base = item(1);
    const evidencia = (diff: string): ApresentacaoHitl =>
      ({ profundidade: 'detalhada', artefato: 'GOAL', claims: 'C1', riscos: 'nenhum', diff });
    const comDiff = { ...base, apresentacao: evidencia(' core/src/x.ts | 2 +-') };
    const outroDiff = { ...base, apresentacao: evidencia(' core/src/y.ts | 40 ++++') };
    // Era esta a fábrica de mensagens: o diff mudava a cada commit e todos os itens da thread
    // eram reenviados, mesmo com a pergunta idêntica.
    assert.equal(assinaturaPulse(comDiff), assinaturaPulse(outroDiff));

    let enviadas = 0;
    const enviar = () => { enviadas++; return true; };
    let atual = comDiff;
    const rodar = (quando: string) => varrerPulse({ raiz: p.dir, consultar: () => pulseCom([atual]), quando, enviar });
    assert.equal(rodar(QUANDO).enviadas, 1);
    atual = outroDiff;
    assert.equal(rodar('2026-09-20T20:00:00.000Z').enviadas, 0, 'commit novo não é novidade para o dono');
    atual = { ...outroDiff, pergunta: 'A pergunta mudou de verdade?' };
    assert.equal(rodar('2026-09-20T21:00:00.000Z').enviadas, 1);
    assert.equal(enviadas, 2);
  } finally { p.limpar(); }
});

test('envio que falha preserva a novidade dos 75 itens em vez de consumi-la', () => {
  const p = projetoTemporario('pulse-teto-falha');
  try {
    const itens = Array.from({ length: 75 }, (_, i) => item(i));
    const consultar = () => pulseCom(itens);
    assert.equal(varrerPulse({ raiz: p.dir, consultar, quando: QUANDO, enviar: () => false }).code, 1);
    // Transporte que não confirmou não consome novidade: o cache nem chega a ser escrito.
    const cache = path.join(p.dir, '.orkastery/monitor/pulse-avisado.json');
    assert.equal(fs.existsSync(cache), false);
    const r = varrerPulse({ raiz: p.dir, consultar, quando: QUANDO, enviar: () => true });
    assert.equal(r.novas, 75);
    assert.equal(r.enviadas, 1);
  } finally { p.limpar(); }
});

test('a linha do hitl.log separa novidade de mensagem, para o incidente ser legível depois', () => {
  const p = projetoTemporario('pulse-teto-log');
  try {
    const itens = Array.from({ length: 75 }, (_, i) => item(i));
    varrerPulse({ raiz: p.dir, consultar: () => pulseCom(itens), quando: QUANDO, enviar: () => true });
    const linha = JSON.parse(fs.readFileSync(path.join(p.dir, '.orkastery/monitor/hitl.log'), 'utf8').trim());
    // A linha de 20/09 dizia novas:75 e enviadas:75. Agora diz novas:75 e enviadas:1.
    assert.equal(linha.novas, 75);
    assert.equal(linha.enviadas, 1);
    assert.equal(linha.tipo, 'pulse_scan');
  } finally { p.limpar(); }
});

/** As duas camadas, na ordem que o dono desenhou. Identidades e provas SIMULADAS. */
const chave = 'chave-exclusivamente-simulada-nos-testes-000';
function ambiente(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY = chave;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** Threads de verdade paradas no gate de GOAL: cada uma espera o veredito do dono. */
function noGate(p: ReturnType<typeof projetoTemporario>, n: number): ItemPulse[] {
  return Array.from({ length: n }, (_, i) => {
    const { thread: t } = novaThread(p.carregado, { nome: `gate ${i}`, modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    return { ...item(i), id: `thread:${t.id}:GOAL:human.pending:ledger`, thread: t.id, fase: 'GOAL' };
  });
}

const dizer = (texto: string, mensagem: string, quando: string): RespostaHumana => {
  const bruto = { resposta: texto, origem: 'telegram' as const, por: 'telegram:42', mensagem, recebidoEm: quando };
  return { ...bruto, prova: assinaturaDaResposta(ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA, bruto, chave) };
};

test('camada 2 só sai depois do sim, como resposta a ele, e um sim serve um lote só', () => {
  const p = projetoTemporario('pulse-duas-camadas'), restaurar = ambiente();
  try {
    const itens = noGate(p, 8);
    const mensagens: string[] = [];
    const rodar = (quando: string) => varrerPulse({
      raiz: p.dir, consultar: () => pulseCom(itens), quando, enviar: m => { mensagens.push(m); return true; },
    });

    // Varredura 1: só a camada 1. As oito perguntas existem e NÃO saem.
    assert.equal(rodar(QUANDO).enviadas, 1);
    assert.match(mensagens[0], /Perguntas para você: 8/);
    assert.match(mensagens[0], /Posso te mandar as perguntas agora\?/);
    assert.equal(mensagens[0].includes('veredito sobre'), false, 'pergunta saiu sem consentimento');

    // O dono responde "a" pelo código curto, com proveniência provada: o lote é a resposta.
    const monitor = path.join(p.dir, '.orkastery', 'monitor');
    const codigo = lerConsentimento(p.dir, monitor)!.pedido.codigo;
    const r = responderPeloPulse(p.dir, dizer(`${codigo} a`, 'telegram:-7:8', QUANDO), { quando: QUANDO, estadoDir: monitor });
    assert.equal(r.resposta, 'sim');
    assert.match(r.mensagem, /^📋 Orkastery, 5 perguntas/);
    assert.match(r.mensagem, /Faltam 3\. Para receber as próximas, responda [2-9A-HJKMNP-TV-Z]{4} a\./);

    // Varreduras seguintes: nada mudou, e as perguntas servidas não viram notícia. Nada sai.
    assert.equal(rodar('2026-09-20T19:05:00.000Z').enviadas, 0, 'um sim virou canal aberto');
    assert.equal(rodar('2026-09-20T19:10:00.000Z').enviadas, 0);
    assert.equal(mensagens.length, 1, 'a varredura nunca manda pergunta, só o resumo');
  } finally { restaurar(); p.limpar(); }
});
