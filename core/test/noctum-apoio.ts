/**
 * RM-058 (N2): o apoio comum dos testes da fila e do passo do arco. Chaves, provas, contas e pedidos são SIMULADOS.
 * A janela do arco vem do relógio real (o CI roda em outro dia), e o ingresso é o envelope assinado do Telegram, como na N1.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { semAutoridadeHitlNoAmbiente } from './apoio';
import { assinaturaDaResposta, RespostaHumana } from '../src/hitl-gates';
import { ALVO_DO_NOCTUM, autorizarPeloIngresso, enderecoDoArco, proporEnvelope, revogarPeloIngresso, TEXTO_DE_REVOGACAO,
  textoDeAutorizacao } from '../src/noctum-arco';
import { CONTRATO_ENVELOPE_V2 } from '../src/noctum-envelope';
import { registrarConducaoDaSessao } from '../src/conducao';
import { registrar } from '../src/ledger';
import { ManifestoCarregado } from '../src/manifest';
import { dirThread, novaThread } from '../src/thread';
import { Fase } from '../src/types';

const CHAVE = 'chave-do-hermes-SIMULADA-somente-nos-testes-0000';

/** Liga o ingresso simulado do Telegram neste processo de teste, sem herdar autoridade HITL do host. */
export function prepararIngressoSimulado(): void {
  semAutoridadeHitlNoAmbiente();
  process.env.ORK_HITL_INGRESS_KEY_HERMES = CHAVE;
  process.env.ORK_HITL_TELEGRAM_USERS = '42';
  process.env.ORK_HITL_TELEGRAM_CHATS = '-7';
}

let mensagens = 0;
function assinado(arco: string, resposta: string, recebidoEm: string): RespostaHumana {
  mensagens += 1;
  const r = { resposta, origem: 'telegram' as const, canal: 'hermes' as const, por: 'telegram:42',
    mensagem: `telegram:-7:n2-${process.pid}-${mensagens}`, recebidoEm };
  return { ...r, prova: assinaturaDaResposta(ALVO_DO_NOCTUM, enderecoDoArco(arco), r, CHAVE) };
}

export interface TrabalhoSimulado {
  id: string; item: string; prioridade: number; dependeDe: string[]; thread?: string; pedido?: string;
}

export interface OpcoesDoArco {
  trabalhos: TrabalhoSimulado[];
  maquina?: number;
  revisao?: number;
  contas?: Array<{ conta: string; sessoes: number }>;
  runtimes?: Array<{ runtime: string; sessoes: number }>;
  tetoDoArco?: number;
  /** Desloca a janela: `-8` a põe toda no passado; `+2` ainda não começou. Em horas. */
  deslocamentoH?: number;
}

/** O pedido de abertura `v2`, com a janela de 8 h em volta de agora. */
export function pedidoV2(arco: string, o: OpcoesDoArco): Record<string, unknown> {
  const agora = Date.now() + (o.deslocamentoH ?? 0) * 3600_000;
  const contas = o.contas ?? [{ conta: 'perfil-a', sessoes: 2 }];
  const runtimes = o.runtimes ?? [{ runtime: 'claude-bg', sessoes: 3 }];
  const teto = o.tetoDoArco ?? 40;
  return {
    contrato: CONTRATO_ENVELOPE_V2, arco,
    janela: { inicio: new Date(agora - 3600_000).toISOString(), fim: new Date(agora + 7 * 3600_000).toISOString(), fuso: 'America/Sao_Paulo' },
    destinos: [{ repositorio: 'exemplo/produto', base: 'main', permissoes: ['push', 'pr'] }],
    orcamento: {
      arco: { valor: teto, unidade: 'sessoes' },
      porConta: contas.map(c => ({ conta: c.conta, teto: { valor: Math.min(20, teto), unidade: 'sessoes' } })),
      porRuntime: runtimes.map(r => ({ runtime: r.runtime, teto: { valor: Math.min(30, teto), unidade: 'sessoes' } })),
    },
    relatorio: { horario: '07:30', canal: 'telegram' },
    trabalhos: o.trabalhos,
    capacidade: { maquina: o.maquina ?? 3, porConta: contas, porRuntime: runtimes, revisao: o.revisao ?? 0 },
  };
}

/** Propõe e autoriza o envelope pelo ingresso assinado, agora. Devolve o hash vigente. */
export function abrirArco(raiz: string, arco: string, o: OpcoesDoArco): string {
  return autorizarPedido(raiz, arco, pedidoV2(arco, o));
}

/** Propõe e autoriza qualquer pedido de abertura (a v1 da N1, inclusive), agora. */
export function autorizarPedido(raiz: string, arco: string, pedido: Record<string, unknown>): string {
  const agora = new Date().toISOString();
  const { envelopeSha256 } = proporEnvelope(raiz, pedido, agora);
  autorizarPeloIngresso(raiz, arco, envelopeSha256, assinado(arco, textoDeAutorizacao(envelopeSha256), agora), agora);
  return envelopeSha256;
}

/** Espera alguns milissegundos: dois eventos seguidos do ledger precisam de instantes diferentes. */
export function passar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function revogarArco(raiz: string, arco: string): void {
  const agora = new Date().toISOString();
  revogarPeloIngresso(raiz, arco, assinado(arco, TEXTO_DE_REVOGACAO, agora), agora);
}

/** A thread de um trabalho, como o arco ou o dono a criaria: #Auto, com o item e o pedido guardado. */
export function threadDoTrabalho(carregado: ManifestoCarregado, nome: string, item: string, pedido: string) {
  return novaThread(carregado, { nome, modo: 'auto', roadmap: item, pedido }).thread;
}

/** O despacho de uma fase, como o `phase run` deixa: o `phase_dispatch` e a condução da sessão. */
export function despachar(raiz: string, threadId: string, fase: Fase, n: number, conduzindo = true): { sessionId: string; despachoEm: string } {
  const sessionId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const despachoEm = new Date().toISOString();
  if (conduzindo) {
    assert.equal(registrarConducaoDaSessao(raiz, threadId, { canal: 'cli', operacao: 'phase.run', fase, prazoMs: 3600_000 },
      { sessionId, runtime: 'claude-bg', perfil: 'perfil-a' }), true);
  }
  registrar(dirThread(raiz, threadId), threadId, 'phase_dispatch', { fase, sessionId, runtime: 'claude-bg', pausaAoFim: false });
  return { sessionId, despachoEm };
}

/** O resultado da fase com a prova do ork: o turno da sessão acabou e a fase concluiu. */
export function concluirFase(raiz: string, threadId: string, fase: Fase, sessionId: string): void {
  registrar(dirThread(raiz, threadId), threadId, 'phase_result', { fase, sessionId, classificacao: 'fase_concluida', ok: true });
}

/** O Stop do hook sem resultado depois: o turno acabou e a fase não deu resultado. */
export function stopSemResultado(raiz: string, threadId: string, fase: Fase, d: { sessionId: string; despachoEm: string }): void {
  registrar(dirThread(raiz, threadId), threadId, 'runtime_stop', { fase, sessionId: d.sessionId, runtime: 'claude-bg',
    despachoEm: d.despachoEm, fonte: 'ork sessions event', sensor: 'stop',
    sensorEventId: createHash('sha256').update(`${threadId}-${d.sessionId}`).digest('hex') });
}

/**
 * O artefato de fase gravado pela sessão do bloco, depois do despacho. A data de modificação vem do relógio grosso do
 * kernel, alguns milissegundos atrás do relógio do processo: a espera curta garante o "depois" que a sessão real tem de
 * sobra (ela grava minutos depois do despacho).
 */
export function gravarArtefato(raiz: string, threadId: string, arquivo: 'goal.md' | 'plan.md' | 'check.md'): void {
  passar(25);
  const docs = path.join(dirThread(raiz, threadId), 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, arquivo), `# ${arquivo} SIMULADO\n`);
}

export function entregar(raiz: string, threadId: string): void {
  registrar(dirThread(raiz, threadId), threadId, 'ship_done', { origem: 'pr', pr: 1, simulado: true });
}
