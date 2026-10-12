/**
 * RM-059 (fatia F8, T8.1; DD2 do plano dos mods): a nota do MASTER pelo dialogo nativo do host.
 *
 * O caminho com prova da nota era o Telegram (`ork master pedir` + o codigo assinado pelo ingresso) e o terminal do
 * dono. A sessao do Claude Code nao tinha como pedir a nota com recibo: o `--por` de processo de host e recusado por
 * `exigirNotaSemHost`. Aqui a nota entra pelo MESMO ingresso local que o gate ja aceita: o servidor MCP pede ao
 * cliente um formulario (elicitation), o dono escolhe de 0 a 5 e escreve o porque, e o nucleo grava o MASTER com
 * `avaliadoPor` `dono (dialogo nativo)` (D12: uma identidade que o `autoriaHumana` de qualquer versao aceita), o host
 * no `canal` e o recibo assinado em `hitl-ingress-local/`.
 *
 * Quem chama passa so o `threadId`. A nota e o porque nunca chegam por argumento de ferramenta: chegam pela resposta
 * do formulario, que o callback do servidor recebe da propria conexao. O mod Ritual do MASTER (`ork-ritual`) so
 * aperta o botao que chama a ferramenta.
 *
 * Ordem das conferencias (D4 da thread ork-rm059ritual): nota humana ja registrada devolve `repetida` sem dialogo;
 * sem entrega, a recusa do nucleo; sem formulario no cliente, `master.nota.sem-dialogo` ANTES de qualquer escrita
 * (nem o pedido de nota nasce); so entao o pedido de nota do `ork master pedir` (o mesmo codigo do Telegram) e o
 * dialogo. A gravacao roda sob a trava da thread, como a resposta do Telegram (`responderNota`) e o aceite por omissao:
 * a nota humana que chegou no meio, por qualquer caminho, vence, e a omissao nunca troca a nota gravada aqui.
 *
 * LIMITE DITO: o recibo prova o caminho (esta conexao MCP, esta solicitacao, esta nota), nao a pessoa. A chave local e
 * legivel pelo mesmo usuario do sistema, entao quem ja roda como ele forja o recibo; e a mesma fronteira do gate pelo
 * ingresso local (`core/src/hitl-local.ts`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { lerThread } from './thread';
import { comLockHitl } from './hitl-gates';
import { exigirEntrega, provaDeEntrega } from './thread-close';
import { lerClaims } from './claims';
import { formatarDataHoraRotulada } from './horario';
import { AUTOR_DA_NOTA_NATIVA, indiceDaThread, notaHumanaRegistrada, registrarMaster } from './master';
import { CONTRATO_PEDIDO_DE_NOTA, pedirNota, PedidoDeNota } from './master-nota';
import { codigosEmUso } from './pulse-resposta';
import { CONTRATO_RECIBO_DA_NOTA, gravarEvidenciaLocalNota } from './hitl-local-receipt';

export const ERRO_SEM_DIALOGO = 'master.nota.sem-dialogo';
/** As notas que o formulario oferece, da melhor para a pior. */
export const NOTAS_DO_FORMULARIO = ['5', '4', '3', '2', '1', '0'] as const;
export const PORQUE_MINIMO = 3;
export const PORQUE_MAXIMO = 1000;
/** O mesmo teto do dialogo do gate pelo ingresso local. */
export const PRAZO_DO_DIALOGO_MS = 300000;

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const sha = (v: string): string => createHash('sha256').update(v).digest('hex');

/** O formulario que o dono ve: a nota como menu e o porque como texto, os dois obrigatorios. */
export interface EsquemaDaNota {
  type: 'object';
  properties: {
    nota: { type: 'string'; title: string; oneOf: { const: string; title: string }[] };
    porque: { type: 'string'; title: string; minLength: number; maxLength: number };
  };
  required: ['nota', 'porque'];
}

export interface ApresentacaoDaNota { thread: string; mensagem: string; esquema: EsquemaDaNota }
export interface RespostaDaNota { action: 'accept' | 'decline' | 'cancel'; content?: unknown }
export interface ResultadoDaNotaLocal {
  ok: boolean;
  threadId: string;
  estado: 'registrada' | 'pendente';
  /** A thread ja tinha nota humana: nada foi pedido nem gravado. */
  repetida: boolean;
  score?: number;
}

export function esquemaDaNota(): EsquemaDaNota {
  const rotulo: Record<string, string> = { '5': '5 · a melhor', '0': '0 · a pior' };
  return {
    type: 'object',
    properties: {
      nota: { type: 'string', title: 'Nota de 0 a 5', oneOf: NOTAS_DO_FORMULARIO.map((n) => ({ const: n, title: rotulo[n] ?? n })) },
      porque: { type: 'string', title: 'Por quê (vira lição do próximo GOAL)', minLength: PORQUE_MINIMO, maxLength: PORQUE_MAXIMO },
    },
    required: ['nota', 'porque'],
  };
}

/** A mensagem do formulario: a entrega, o que vale agora, o indice derivado do ledger e as claims por estado. */
export function apresentarPedidoDaNota(raiz: string, threadId: string): ApresentacaoDaNota {
  const t = lerThread(raiz, threadId);
  const entrega = provaDeEntrega(raiz, threadId);
  const indice = indiceDaThread(raiz, threadId);
  const ultimas = new Map<string, string>();
  for (const c of lerClaims(raiz, threadId)) ultimas.set(c.id, c.estado);
  const contar = (estado: string) => [...ultimas.values()].filter((e) => e === estado).length;
  const parcelas = indice.parcelas.length
    ? indice.parcelas.map((p) => `${p.evento} x${p.ocorrencias}`).join(', ')
    : 'sem desconto';
  const agora = t.score?.regime === 'omissao' ? `aceita por omissão com ${t.score.valor}/5`
    : t.score_proposto ? `proposta de ${t.score_proposto.valor}/5 esperando você` : 'sem nota';
  const quando = entrega?.tipo === 'ship'
    ? `Entregue em ${formatarDataHoraRotulada(entrega.ts)}${entrega.mergeSha ? ` (merge ${entrega.mergeSha.slice(0, 8)})` : ''}.`
    : entrega ? `Entregue pelo artefato ${entrega.arquivo}.` : 'Sem entrega registrada.';
  return {
    thread: threadId,
    mensagem: [
      `Nota do MASTER da ${t.id} (${t.nome.slice(0, 80)})`,
      `${quando} Agora: ${agora}.`,
      `Índice derivado do ledger: ${indice.valor} de ${indice.base} (${parcelas}).`,
      `Claims: ${contar('verificado')} verificadas, ${contar('reprovado')} reprovadas, ${contar('pendente')} pendentes.`,
      'Dê de 0 a 5 e diga por quê. A sua nota sobrescreve a aceita por omissão.',
    ].join('\n'),
    esquema: esquemaDaNota(),
  };
}

/** A resposta aceita, conferida campo a campo: so `nota` e `porque`, nos limites do formulario. */
export function lerRespostaDaNota(content: unknown): { score: number; justificativa: string } {
  const c = content as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).sort().join(',') !== 'nota,porque' ||
      typeof c.nota !== 'string' || !(NOTAS_DO_FORMULARIO as readonly string[]).includes(c.nota) ||
      typeof c.porque !== 'string' || c.porque.trim().length < PORQUE_MINIMO || c.porque.length > PORQUE_MAXIMO) {
    throw new Error('master.nota.resposta-invalida: a resposta do formulário não é uma nota de 0 a 5 com o porquê');
  }
  return { score: Number(c.nota), justificativa: c.porque.trim() };
}

/**
 * O ingresso da nota numa conexao MCP. O `elicitar` e o `temFormulario` vem do servidor, nunca dos argumentos da
 * ferramenta; o `connectionId` e o mesmo do ingresso local do gate nesta conexao.
 */
export function criarIngressoDaNota(
  raiz: string,
  origem: { host: 'claude-code' | 'codex'; connectionId: string },
  elicitar: (apresentacao: ApresentacaoDaNota, signal: AbortSignal) => Promise<RespostaDaNota>,
  temFormulario: () => boolean,
): { solicitar: (threadId: string, signal?: AbortSignal) => Promise<ResultadoDaNotaLocal>; fechar: () => void } {
  if (!['claude-code', 'codex'].includes(origem.host) || !ID.test(origem.connectionId)) throw new Error('master.nota.origem-invalida');
  const conexao = { ...origem }, ativos = new Map<string, AbortController>();
  let fechada = false;
  const pendente = (threadId: string): ResultadoDaNotaLocal => ({ ok: false, threadId, estado: 'pendente', repetida: false });
  return {
    fechar() { fechada = true; for (const c of ativos.values()) c.abort(); },
    async solicitar(threadId, signal) {
      if (fechada) throw new Error('master.nota.conexao-fechada');
      if (!ID.test(threadId)) throw new Error('master.nota.identificador-invalido');
      if (signal?.aborted) return pendente(threadId);
      const t = lerThread(raiz, threadId);
      if (notaHumanaRegistrada(t)) return { ok: true, threadId, estado: 'registrada', repetida: true, score: t.score!.valor };
      exigirEntrega(raiz, threadId);
      if (!temFormulario()) {
        throw new Error(`${ERRO_SEM_DIALOGO}: este cliente MCP não abre formulário; peça a nota pelo Telegram com ork master pedir ${threadId}`);
      }
      if (ativos.has(threadId)) throw new Error('master.nota.em-curso: o diálogo da nota desta thread já está aberto nesta sessão');
      const controller = new AbortController();
      ativos.set(threadId, controller);
      const abortar = () => controller.abort();
      signal?.addEventListener('abort', abortar, { once: true });
      const timer = setTimeout(abortar, PRAZO_DO_DIALOGO_MS);
      try {
        const pedido: PedidoDeNota = pedirNota(raiz, threadId, { codigosEmUso: codigosEmUso(raiz) });
        const apresentacao = apresentarPedidoDaNota(raiz, threadId);
        const requestId = randomUUID();
        const cancelar = new Promise<RespostaDaNota>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve({ action: 'cancel' }), { once: true }));
        const resposta = await Promise.race([elicitar(apresentacao, controller.signal), cancelar]);
        if (fechada || controller.signal.aborted || resposta?.action !== 'accept') return pendente(threadId);
        const nota = lerRespostaDaNota(resposta.content);
        const recebidoEm = new Date().toISOString();
        return comLockHitl(raiz, threadId, (): ResultadoDaNotaLocal => {
          const atual = lerThread(raiz, threadId);
          if (notaHumanaRegistrada(atual)) return { ok: true, threadId, estado: 'registrada', repetida: true, score: atual.score!.valor };
          const recibo = gravarEvidenciaLocalNota(raiz, { thread: threadId, pedidoId: pedido.pedidoId, host: conexao.host,
            connectionId: conexao.connectionId, requestId, recebidoEm, score: nota.score, justificativaSha256: sha(nota.justificativa) });
          registrarMaster(raiz, threadId, {
            score: nota.score, justificativa: nota.justificativa, por: AUTOR_DA_NOTA_NATIVA, refazer: !!atual.score,
            prova: {
              origem: 'mcp-local', canal: conexao.host, contratoResposta: CONTRATO_RECIBO_DA_NOTA, conexao: conexao.connectionId,
              solicitacao: requestId, recebidoEm, recibo: recibo.recibo, evidencia: recibo.arquivo, evidenciaSha256: recibo.sha256,
              notaPedida: { contrato: CONTRATO_PEDIDO_DE_NOTA, pedidoId: pedido.pedidoId, codigo: pedido.codigo },
            },
          });
          return { ok: true, threadId, estado: 'registrada', repetida: false, score: nota.score };
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortar);
        ativos.delete(threadId);
      }
    },
  };
}
