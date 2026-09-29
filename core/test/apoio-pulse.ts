/**
 * Apoio dos testes do caminho de volta do pulse (RM-048): projeto temporario, threads paradas no
 * gate e o envelope que o ingresso do Hermes assina. Tudo SIMULADO: chave, usuario, chat e canal.
 *
 * E o mesmo arranjo de `pulse-resposta.test.ts`, num lugar so, para que os testes novos do texto
 * livre e da linha estavel respondam pelo mesmo ingresso que o teste de ponta a ponta usa.
 */
import * as path from 'node:path';
import { projetoTemporario, ProjetoDeTeste } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { dirThread, novaThread } from '../src/thread';
import { registrar } from '../src/ledger';
import { ItemPulse, Pulse } from '../src/pulse';
import { varrerPulse } from '../src/pulse-delivery';
import { ALVO_DO_PULSE, ENDERECO_DA_RESPOSTA } from '../src/pulse-consentimento';
import { responderPeloPulse } from '../src/pulse-resposta';

export const QUANDO = '2026-09-22T23:00:00.000Z';
export const depois = (min: number) => new Date(Date.parse(QUANDO) + min * 60000).toISOString();
export const CHAVE_SIMULADA = 'chave-SIMULADA-do-canal-hermes-nos-testes-000';
const NOMES = ['alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

export function ambienteDoIngresso(): () => void {
  const nomes = ['ORK_HITL_INGRESS_KEY_HERMES', 'ORK_HITL_TELEGRAM_USERS', 'ORK_HITL_TELEGRAM_CHATS', 'ORK_HITL_INGRESS_KEY_OPENCLAW'];
  const antigos = nomes.map(n => process.env[n]);
  process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVE_SIMULADA;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
  delete process.env.ORK_HITL_INGRESS_KEY_OPENCLAW;
  return () => nomes.forEach((n, i) => { if (antigos[i] === undefined) delete process.env[n]; else process.env[n] = antigos[i]; });
}

/** O que o ingresso do Hermes produz quando o dono digita `texto` no Telegram. */
export function dizer(texto: string, mensagem: string, quando: string, endereco = { alvo: ALVO_DO_PULSE, pedido: ENDERECO_DA_RESPOSTA }): RespostaHumana {
  const r = { resposta: texto, canal: 'hermes' as const, origem: 'telegram' as const, por: 'telegram:42', mensagem, recebidoEm: quando };
  return { ...r, prova: assinaturaDaResposta(endereco.alvo, endereco.pedido, r, CHAVE_SIMULADA) };
}

export function itemDoGate(thread: string, i: number, extra: Partial<ItemPulse> = {}): ItemPulse {
  return { id: `thread:${thread}:GOAL:human.pending:ledger`, classe: 'thread', motivo: 'human.pending', thread, fase: 'GOAL',
    sessionId: null, desdeEm: '2026-09-22T20:00:00.000Z', paradaHaMin: 180 - i, impacto: 1,
    pergunta: `bloco fechado em GOAL: espera o veredito humano sobre objetivo (${i})`, opcoes: [], recomendacao: '',
    comandoResposta: 'ork thread status', evidencia: [], fontes: ['monitor'], contextoLogs: [], ...extra };
}

/** Threads de verdade paradas no gate de GOAL do #Classic: cada uma espera o veredito do dono. */
export function threadsNoGate(p: ProjetoDeTeste, n: number): ItemPulse[] {
  return NOMES.slice(0, n).map((nome, i) => {
    const { thread: t } = novaThread(p.carregado, { nome: `${nome} classic`, modo: 'classic' });
    registrar(dirThread(p.dir, t.id), t.id, 'phase_result', { fase: 'GOAL', evidencia: 'fixture simulada' });
    return itemDoGate(t.id, i);
  });
}

export const pulseCom = (itens: ItemPulse[], quando = QUANDO): Pulse => ({
  contrato: 'ork.pulse/v1', consultadoEm: quando, runtime: { ok: true, detalhe: '' },
  precisaDeHumanoAgora: itens, acoesAutomaticas: [],
  resumo: { humanos: itens.length, automaticas: 0, scores: 0, fasesOrfas: 0 },
});

export function cenarioDoPulse(nome: string, n: number) {
  const p = projetoTemporario(nome), restaurar = ambienteDoIngresso();
  const monitor = path.join(p.dir, '.orkastery', 'monitor');
  const itens = threadsNoGate(p, n);
  const mensagens: string[] = [];
  const varrer = (quando: string, lista = itens) => varrerPulse({ raiz: p.dir, consultar: () => pulseCom(lista, quando), quando,
    enviar: m => { mensagens.push(m); return true; } });
  const responder = (texto: string, mensagem: string, quando: string) =>
    responderPeloPulse(p.dir, dizer(texto, mensagem, quando), { quando, estadoDir: monitor });
  const limpar = () => { restaurar(); p.limpar(); };
  return { p, monitor, itens, mensagens, varrer, responder, limpar };
}
