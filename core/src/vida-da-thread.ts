/**
 * RM-062 (F2): a sessao de cada thread, verificada no runtime, para as superficies que dizem "sigo".
 *
 * Incidente de 12/10/2026 (P2 da pagina da RM-062): com o despacho do GO da K7 morto e o daemon do
 * claude-bg fora do ar, o `ork roadmap status` disse "sigo ork-rm026k7conhe na fase GO". O "sigo" saia de
 * toda thread aberta com fase, ou do lease de conducao, que sobrevive a sessao morta ate a prova do fim.
 *
 * Agora so diz "sigo" quem tem sessao viva verificada no runtime: o `claude agents --json --all` de cada
 * conta e os rollouts do codex, pela mesma consulta do inventario da RM-056 (fantasma e a sessao sem
 * processo). Sessao fantasma, despacho falho ou nenhuma sessao viram "<thread> parada desde HH:MM:
 * <motivo>", com o ultimo sinal de vida que o ledger guarda.
 */
import { consultarContas } from './sessoes-contas';
import { raizDoEstado } from './estado-thread';
import { TIPOS_DE_EVENTO } from './ledger';
import { formatarHora } from './horario';
import { EventoLedger, Thread } from './types';

/** Uma sessao como o runtime a ve agora. */
export interface SessaoNoRuntime { sessionId: string; runtime: string; viva: boolean; fantasma: boolean; estado: string }

/** A leitura do runtime que a vida das threads usa, feita uma vez por relatorio. */
export interface LeituraDoRuntime {
  /** Os runtimes com alguma conta que respondeu: so neles a falta da sessao prova alguma coisa. */
  responderam: string[];
  /** O que falhou na consulta, para a linha dizer por que nao verificou. */
  falhas: string[];
  sessoes: SessaoNoRuntime[];
}

/** O que a vida de uma thread diz: viva, ou parada desde quando e por que. */
export interface VidaDaThread {
  viva: boolean;
  /** A sessao do despacho corrente da fase, quando ha. */
  sessionId: string | null;
  /** O ultimo sinal de vida no ledger (ISO), so quando nao esta viva. */
  desdeEm: string | null;
  motivo: string | null;
}

const curto = (texto: unknown, teto = 100): string => {
  const limpo = String(texto ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
};

/** `claude agents` e os rollouts do codex de todas as contas desta maquina. Falha vira falha, nunca "sem sessao". */
export function lerRuntime(raiz: string): LeituraDoRuntime {
  try {
    const r = consultarContas(raizDoEstado(raiz), { todas: true });
    const responderam = new Set<string>(), falhas: string[] = [];
    for (const f of r.fontes) {
      if (f.origem.startsWith('perfis de conta')) { if (!f.ok) falhas.push(curto(f.detalhe, 120)); continue; }
      const runtime = f.origem.startsWith('claude agents') ? 'claude-bg' : 'codex';
      if (f.ok) responderam.add(runtime);
      else falhas.push(`${f.origem}: ${curto(f.detalhe, 120)}`);
    }
    return { responderam: [...responderam], falhas, sessoes: r.sessoes.map((s) => ({ sessionId: s.sessionId, runtime: s.runtime,
      viva: s.viva, fantasma: s.fantasma, estado: String(s.state ?? s.status ?? '').trim().toLowerCase() })) };
  } catch (e) {
    return { responderam: [], falhas: [curto((e as Error).message, 160)], sessoes: [] };
  }
}

/** O motivo tipado com o detalhe, sem repetir o motivo quando o detalhe ja comeca por ele. */
function motivoComDetalhe(e: EventoLedger): string {
  const motivo = typeof e.motivo === 'string' ? e.motivo : '';
  const detalhe = typeof e.detalhe === 'string' ? e.detalhe : typeof e.erro === 'string' ? e.erro : '';
  return !detalhe ? motivo || 'sem detalhe' : !motivo || detalhe.startsWith(motivo) ? detalhe : `${motivo}: ${detalhe}`;
}

function motivoDaFalha(e: EventoLedger, sessionId: string | null): string {
  const daFase = typeof e.fase === 'string' && e.fase ? ` de ${e.fase}` : '';
  if (sessionId && e.sessionId === sessionId) return `sessão ${sessionId.slice(0, 8)} caiu (${curto(e.motivo, 40)})`;
  return `despacho${daFase} falhou (${curto(motivoComDetalhe(e), 90)})`;
}

/**
 * A vida da thread: a sessao do despacho mais recente, de qualquer fase (o despacho de GO que falha deixa a thread
 * em GOAL), e a falha do runtime depois dele. `leitura` so e chamada quando ha sessao a conferir: thread sem
 * despacho nao custa consulta ao runtime.
 */
export function vidaDaThread(t: Thread, eventos: readonly EventoLedger[], leitura: () => LeituraDoRuntime): VidaDaThread {
  const fase = t.faseAtual;
  const parada = (desdeEm: string | null | undefined, motivo: string, sessionId: string | null = null): VidaDaThread =>
    ({ viva: false, sessionId, desdeEm: desdeEm ?? null, motivo });
  const ultimoSinal = eventos.at(-1)?.ts ?? t.atualizadaEm ?? t.criadaEm ?? null;
  let iDespacho = -1;
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.tipo === TIPOS_DE_EVENTO.faseDespachada && typeof e.sessionId === 'string' && e.sessionId) { iDespacho = i; break; }
  }
  const despacho = iDespacho >= 0 ? eventos[iDespacho] : null;
  const registrada = (t.sessoes ?? []).at(-1) ?? null;
  const sessionId = despacho ? String(despacho.sessionId) : registrada?.sessionId ?? null;
  const runtime = (typeof despacho?.runtime === 'string' && despacho.runtime) || registrada?.runtime || 'claude-bg';
  // A falha que vale e a de depois do despacho corrente: a de antes ja foi superada por ele.
  const falha = eventos.slice(iDespacho + 1).reverse().find((e) => e.tipo === TIPOS_DE_EVENTO.despachoFalhou ||
    (e.tipo === TIPOS_DE_EVENTO.gateBloqueado && typeof e.motivo === 'string' && e.motivo.startsWith('runtime.'))) ?? null;
  if (!sessionId) {
    return falha ? parada(falha.ts, motivoDaFalha(falha, null)) : parada(ultimoSinal, `nenhuma sessão despachada na fase ${fase}`);
  }
  const l = leitura();
  const s = l.sessoes.find((x) => x.runtime === runtime && (x.sessionId === sessionId || x.sessionId.startsWith(sessionId)));
  if (s?.viva) return { viva: true, sessionId, desdeEm: null, motivo: null };
  if (falha) return parada(falha.ts, motivoDaFalha(falha, sessionId), sessionId);
  const id = sessionId.slice(0, 8);
  const daSessao = [...eventos].reverse().find((e) => e.sessionId === sessionId)?.ts ?? despacho?.ts ?? ultimoSinal;
  if (!l.responderam.includes(runtime)) {
    return parada(daSessao, `runtime ${runtime} sem resposta${l.falhas.length ? ` (${curto(l.falhas[0], 80)})` : ''}; a sessão ${id} não foi verificada`, sessionId);
  }
  if (!s) return parada(daSessao, `sessão ${id} não aparece no runtime`, sessionId);
  if (s.fantasma) return parada(daSessao, `sessão ${id} sem processo (fantasma)`, sessionId);
  return parada(daSessao, `sessão ${id} encerrada (${s.estado || 'sem estado'})`, sessionId);
}

/** "parada desde HH:MM: <motivo>", no fuso do dono; sem o instante, so o motivo. */
export function paradaDesde(v: Pick<VidaDaThread, 'desdeEm' | 'motivo'>, opcoes: { agora?: string; fuso?: string } = {}): string {
  const desde = v.desdeEm && Number.isFinite(Date.parse(v.desdeEm)) ? ` desde ${formatarHora(v.desdeEm, opcoes)}` : '';
  return `parada${desde}: ${v.motivo ?? 'sem sessão viva verificada no runtime'}`;
}

/** "<thread> parada desde HH:MM: <motivo>": a linha que substitui o "sigo" quando a sessao nao esta viva. */
export function textoDaParada(thread: string, v: Pick<VidaDaThread, 'desdeEm' | 'motivo'>,
  opcoes: { agora?: string; fuso?: string } = {}): string {
  return `${thread} ${paradaDesde(v, opcoes)}`;
}

/**
 * A vida que vem no retrato de outra maquina (`ork/fabrica-estado`): so vale com os tipos certos. Retrato
 * antigo, sem o campo, ou com o campo fora do formato, nao diz nada (`undefined`), e a linha nao diz "sigo".
 */
export function vidaDoRetrato(bruto: unknown): VidaDaThread | undefined {
  if (!bruto || typeof bruto !== 'object') return undefined;
  const v = bruto as Record<string, unknown>;
  const textoOuNulo = (x: unknown): x is string | null => x === null || typeof x === 'string';
  if (typeof v.viva !== 'boolean' || !textoOuNulo(v.desdeEm) || !textoOuNulo(v.motivo)) return undefined;
  return { viva: v.viva, sessionId: null, desdeEm: v.desdeEm, motivo: v.motivo === null ? null : curto(v.motivo, 120) };
}
