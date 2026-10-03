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
 * Funcoes puras sobre eventos: nao leem disco nem relogio. Ausencia de pedido e zero pedidos, e a
 * mediana sem resposta e `null`, nunca zero inventado. A unica leitura de disco e
 * `lerHitlDeConducaoAgora`, que so junta os ledgers e entrega a conta as funcoes puras.
 *
 * Fatia 3: o mesmo tempo parado chega ao `ork pulse` e ao `ork roadmap status`, com as perguntas
 * abertas agora (ha quanto tempo cada uma espera) e a mediana dos ultimos 7 dias.
 */
import { alvoDoPedido, ehV2, PedidoHitlQualquer, PerguntaAoDono } from './hitl-contract';
import { duracaoRelativa, formatarHora } from './horario';
import { lerLedger } from './ledger';
import { dirThread, listarIds } from './thread';
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

/** RM-057 (fatia 3): a janela da mediana que o pulse e o status mostram. */
export const JANELA_DA_MEDIANA_MS = 7 * 24 * 60 * 60_000;

/** Uma pergunta de conducao aberta agora, com ha quanto tempo ela para a thread. */
export interface PerguntaParada {
  thread: string;
  pedidoId: string;
  fase: string;
  desdeEm: string;
  paradaHaMin: number;
}

/**
 * O retrato que o pulse e o status levam: as abertas agora, da mais antiga para a mais nova, e o
 * resumo dos ultimos 7 dias na mesma forma do `hitlDeConducao` do `ork ledger stats`.
 */
export interface HitlDeConducaoAgora {
  abertas: PerguntaParada[];
  seteDias: TempoParadoPorHitl;
  /** Alguma aberta passou da meta de 5 min, ou a mediana dos 7 dias esta acima dela. */
  acimaDaMeta: boolean;
}

/** O retrato num instante. Pura: `quando` e o relogio de quem chama. */
export function hitlDeConducaoAgora(esperas: readonly EsperaDeHitl[], quando: string): HitlDeConducaoAgora {
  const agoraMs = Date.parse(quando);
  const abertas = esperas
    .filter(x => x.inicioMs <= agoraMs && (x.fimMs === null || x.fimMs > agoraMs))
    .sort((a, b) => a.inicioMs - b.inicioMs || a.thread.localeCompare(b.thread))
    .map(x => ({ thread: x.thread, pedidoId: x.pedidoId, fase: x.fase, desdeEm: new Date(x.inicioMs).toISOString(),
      paradaHaMin: Math.floor((agoraMs - x.inicioMs) / 60_000) }));
  const seteDias = resumirTempoParado(esperas, agoraMs - JANELA_DA_MEDIANA_MS, agoraMs);
  const abertaAcima = abertas.some(a => (agoraMs - Date.parse(a.desdeEm)) > META_DA_MEDIANA_DE_RESPOSTA_MS);
  return { abertas, seteDias, acimaDaMeta: abertaAcima || seteDias.dentroDaMeta === false };
}

/** Junta os ledgers de todas as threads do projeto e devolve o retrato. Ledger ilegivel fica de fora. */
export function lerHitlDeConducaoAgora(raiz: string, quando: string): HitlDeConducaoAgora {
  const esperas: EsperaDeHitl[] = [];
  for (const id of listarIds(raiz)) {
    try { esperas.push(...esperasDeHitl(id, lerLedger(dirThread(raiz, id)))); } catch { /* ledger ilegivel nao para o pulse */ }
  }
  return hitlDeConducaoAgora(esperas, quando);
}

const emMinutos = (ms: number): string => `${(ms / 60_000).toFixed(1)} min`;

/** "mediana de 7 dias 3.0 min (dentro da meta de 5 min)", ou sem resposta medida. */
export function textoDaMediana(h: HitlDeConducaoAgora): string {
  const s = h.seteDias;
  if (s.medianaRespostaMs === null) return 'mediana de 7 dias sem resposta medida';
  return `mediana de 7 dias ${emMinutos(s.medianaRespostaMs)} (${s.dentroDaMeta ? 'dentro' : 'acima'} da meta de 5 min, ` +
    `${s.respondidos} resposta(s))`;
}

/** "<thread> (<fase>) parada ha 12min, desde 01:02": a hora no fuso do dono (RM-035). */
export function linhaDaPerguntaParada(p: PerguntaParada, opcoes: { agora: string; fuso?: string }): string {
  return `${p.thread} (${p.fase}) parada há ${duracaoRelativa(p.paradaHaMin)}, desde ${formatarHora(p.desdeEm, opcoes)}`;
}

/**
 * A linha unica do resumo do pulse, so quando passou da meta: quantas abertas, a mais antiga e a
 * mediana. Abaixo da meta, nada: o resumo nao ganha uma linha que nao pede atencao.
 */
export function linhaDoHitlAcimaDaMeta(h: HitlDeConducaoAgora | undefined, opcoes: { agora: string; fuso?: string }): string | null {
  if (!h || !h.acimaDaMeta) return null;
  const velha = h.abertas[0];
  const abertas = h.abertas.length
    ? `${h.abertas.length} pergunta(s) de condução aberta(s), a mais antiga ${linhaDaPerguntaParada(velha, opcoes)}; `
    : 'nenhuma pergunta de condução aberta; ';
  return `HITL de condução acima da meta de 5 min: ${abertas}${textoDaMediana(h)}.`;
}
