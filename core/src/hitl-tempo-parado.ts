/**
 * RM-057 (fatia 2): o tempo parado por HITL de conducao, medido do ledger.
 *
 * A metrica principal da RM-057 e o tempo em que a fabrica fica parada esperando o dono numa
 * pergunta de conducao. A linha de base e a noite de 01 para 02/10/2026: mais de 10 h parada num
 * "confirmo" em texto livre. A meta e mediana de resposta abaixo de 5 min e nenhum pedido em texto
 * fora da excecao tecnica.
 *
 * O que conta como HITL de conducao: o pedido `ork.hitl/v2` de classe `pergunta` que o ork abriu
 * (`hitl_requested`). A decisao informada (`decidido`) nao para nada e fica fora; o v1 e a pergunta
 * nativa de uma sessao do host, com as opcoes do host, e tambem fica fora.
 *
 * Quando a espera acaba, na ordem em que o ledger prova:
 *
 *   respondido          o primeiro `human_gate` ou `session_answered` com o `pedidoId`;
 *   seguiu-recomendada  o prazo venceu e o pedido declara `seguir-recomendada` (ele se resolve so);
 *   substituido         um pedido novo para o mesmo alvo (o velho deixou de ser a pergunta);
 *   encerrado           a thread fechou (`master_done` ou `thread_closed_admin`) sem resposta;
 *   aberto              nada disso ainda: a espera corre ate o fim do periodo.
 *
 * Limite dito: o "confirmo" que um condutor pede na conversa, fora do ork, nao chega ao ledger e
 * nao entra aqui. Por isso o canario `fx-pedido-colado` e a regra nos adaptadores existem.
 *
 * Funcao pura sobre eventos: nao le disco nem relogio. Ausencia de pedido e zero pedidos, e a
 * mediana sem resposta e `null`, nunca zero inventado.
 */
import { alvoDoPedido, ehV2, PedidoHitlQualquer, PerguntaAoDono } from './hitl-contract';
import { EventoLedger } from './types';

/** A meta da RM-057: mediana de resposta abaixo de 5 minutos. */
export const META_DA_MEDIANA_DE_RESPOSTA_MS = 5 * 60_000;

const RESPOSTAS = ['human_gate', 'session_answered'];
const FECHAMENTOS_DA_THREAD = ['master_done', 'thread_closed_admin'];

export type FimDaEspera = 'respondido' | 'seguiu-recomendada' | 'substituido' | 'encerrado' | 'aberto';
/** `dependencia`: texto pela excecao tipada; `fora-da-excecao`: texto sem ela (historico ou desvio). */
export type FormaDaResposta = 'selecao' | 'dependencia' | 'fora-da-excecao';

export interface EsperaDeHitl {
  thread: string;
  pedidoId: string;
  fase: string;
  inicioMs: number;
  fimMs: number | null;
  fim: FimDaEspera;
  forma: FormaDaResposta;
}

export interface TempoParadoPorHitl {
  /** Perguntas de conducao abertas dentro do periodo. */
  pedidos: number;
  respondidos: number;
  /** Encerradas sem resposta do dono: substituidas, thread fechada ou recomendada seguida no prazo. */
  semResposta: number;
  abertos: number;
  /** Soma do tempo parado dentro do periodo, de toda pergunta que se sobrepoe a ele. */
  paradoMs: number;
  /** Mediana do tempo ate a resposta, das respondidas dentro do periodo. */
  medianaRespostaMs: number | null;
  maiorRespostaMs: number | null;
  metaMedianaMs: number;
  /** `null` sem resposta medida: sem amostra nao ha veredito. */
  dentroDaMeta: boolean | null;
  emTexto: { comDependenciaTecnica: number; foraDaExcecao: number };
}

function instante(valor: unknown): number | null {
  const t = typeof valor === 'string' ? Date.parse(valor) : NaN;
  return Number.isFinite(t) ? t : null;
}

function formaDaResposta(p: PerguntaAoDono): FormaDaResposta {
  const pedeTexto = p.tipoDeResposta === 'aberta' || p.respostaAceita?.tipo === 'texto';
  if (!pedeTexto) return 'selecao';
  return p.dependenciaTecnica ? 'dependencia' : 'fora-da-excecao';
}

function chaveDoAlvo(p: PedidoHitlQualquer): string {
  try { const alvo = alvoDoPedido(p); if (alvo) return JSON.stringify(alvo); } catch { /* sem alvo legivel */ }
  return `pedido:${String(p.id)}`;
}

/** As esperas de uma thread, em ordem de abertura. Le so o ledger dela. */
export function esperasDeHitl(thread: string, eventos: readonly EventoLedger[]): EsperaDeHitl[] {
  const esperas: (EsperaDeHitl & { alvo: string; prazoMs: number | null; seguir: boolean })[] = [];
  const vistos = new Set<string>();
  for (const e of eventos) {
    if (e.tipo !== 'hitl_requested') continue;
    const p = e.pedido as PedidoHitlQualquer | undefined;
    if (!p || typeof p !== 'object' || !ehV2(p) || p.classe !== 'pergunta' || vistos.has(String(p.id))) continue;
    const inicioMs = instante(p.criadoEm) ?? instante(e.ts);
    if (inicioMs === null) continue;
    vistos.add(String(p.id));
    esperas.push({ thread, pedidoId: String(p.id), fase: String(p.fase), inicioMs, fimMs: null, fim: 'aberto',
      forma: formaDaResposta(p), alvo: chaveDoAlvo(p), prazoMs: instante(p.prazo),
      seguir: p.acaoPadraoAoExpirar === 'seguir-recomendada' });
  }
  const fechar = (x: EsperaDeHitl, fimMs: number, fim: FimDaEspera) => {
    if (x.fimMs === null || fimMs < x.fimMs) { x.fimMs = Math.max(fimMs, x.inicioMs); x.fim = fim; }
  };
  for (const x of esperas) {
    const resposta = eventos.find(e => RESPOSTAS.includes(e.tipo) && String(e.pedidoId) === x.pedidoId && instante(e.ts) !== null);
    if (resposta) fechar(x, instante(resposta.ts)!, 'respondido');
    if (x.seguir && x.prazoMs !== null) fechar(x, x.prazoMs, 'seguiu-recomendada');
    const novo = esperas.find(y => y !== x && y.alvo === x.alvo && y.inicioMs > x.inicioMs);
    if (novo) fechar(x, novo.inicioMs, 'substituido');
    const fechou = eventos.find(e => FECHAMENTOS_DA_THREAD.includes(e.tipo) && (instante(e.ts) ?? -Infinity) >= x.inicioMs);
    if (fechou) fechar(x, instante(fechou.ts)!, 'encerrado');
  }
  return esperas.map(({ alvo: _a, prazoMs: _p, seguir: _s, ...x }) => x);
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b), m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Resume as esperas de todas as threads no periodo `[desdeMs, ateMs)`. */
export function resumirTempoParado(esperas: readonly EsperaDeHitl[], desdeMs: number, ateMs: number): TempoParadoPorHitl {
  let pedidos = 0, respondidos = 0, semResposta = 0, abertos = 0, paradoMs = 0, comDependencia = 0, foraDaExcecao = 0;
  const respostas: number[] = [];
  for (const x of esperas) {
    const fim = x.fimMs ?? ateMs;
    const a = Math.max(x.inicioMs, desdeMs), b = Math.min(fim, ateMs);
    if (b > a) paradoMs += b - a;
    if (x.inicioMs >= desdeMs && x.inicioMs < ateMs) {
      pedidos++;
      if (x.forma === 'dependencia') comDependencia++;
      if (x.forma === 'fora-da-excecao') foraDaExcecao++;
    }
    if (x.fimMs === null || x.fimMs >= ateMs) { if (x.inicioMs < ateMs) abertos++; continue; }
    if (x.fimMs < desdeMs) continue;
    if (x.fim === 'respondido') { respondidos++; respostas.push(x.fimMs - x.inicioMs); } else semResposta++;
  }
  const med = mediana(respostas);
  return {
    pedidos, respondidos, semResposta, abertos, paradoMs,
    medianaRespostaMs: med, maiorRespostaMs: respostas.length ? Math.max(...respostas) : null,
    metaMedianaMs: META_DA_MEDIANA_DE_RESPOSTA_MS, dentroDaMeta: med === null ? null : med < META_DA_MEDIANA_DE_RESPOSTA_MS,
    emTexto: { comDependenciaTecnica: comDependencia, foraDaExcecao },
  };
}
