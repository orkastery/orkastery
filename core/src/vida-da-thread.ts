/**
 * RM-063 (F2): a sessao de cada thread, verificada no runtime, para as superficies que dizem "sigo".
 *
 * Incidente de 12/10/2026 (P2 da pagina da RM-063): com o despacho do GO da K7 morto e o daemon do
 * claude-bg fora do ar, o `ork roadmap status` disse "sigo ork-rm026k7conhe na fase GO". O "sigo" saia de
 * toda thread aberta com fase, ou do lease de conducao, que sobrevive a sessao morta ate a prova do fim.
 *
 * Agora so diz "sigo" quem tem sessao viva verificada no runtime: o `claude agents --json --all` de cada
 * conta e os rollouts do codex, pela mesma consulta do inventario da RM-056 (fantasma e a sessao sem
 * processo). Sessao fantasma, despacho falho ou nenhuma sessao viram "<thread> parada desde HH:MM:
 * <motivo>", com o ultimo sinal de vida que o ledger guarda.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { consultarContas, contasDeSessoes } from './sessoes-contas';
import { raizDoEstado } from './estado-thread';
import { TIPOS_DE_EVENTO } from './ledger';
import { formatarHora } from './horario';
import { ROADMAP_PT_BR } from './locale-roadmap';
import { EventoLedger, Thread } from './types';

/** Uma sessao como o runtime a ve agora. `atividadeEm`: a ultima escrita no rollout (so codex), em ms. */
export interface SessaoNoRuntime {
  sessionId: string; runtime: string; viva: boolean; fantasma: boolean; estado: string;
  perfil?: string | null; atividadeEm?: number | null;
}

/** O prazo do `claude agents` na leitura da vida: o status nao espera um daemon travado por minutos. */
export const PRAZO_DA_LEITURA_MS = 20_000;

/** A chave de uma conta que respondeu: o runtime, e o perfil quando a conta e de um perfil do store. */
export const chaveDaConta = (runtime: string, perfil: string | null | undefined): string => `${runtime}:${perfil ?? ''}`;

/** A leitura do runtime que a vida das threads usa, feita uma vez por relatorio. */
export interface LeituraDoRuntime {
  /**
   * O que respondeu: o runtime (`claude-bg`, `codex`) e cada conta (`claude-bg:<perfil>`, `claude-bg:` para a do
   * processo). So onde a conta respondeu a falta da sessao prova alguma coisa.
   */
  responderam: string[];
  /** O que falhou na consulta, para a linha dizer por que nao verificou. */
  falhas: string[];
  sessoes: SessaoNoRuntime[];
}

/** Por que a thread parou, pelo tipo: e o que o texto de cada lingua monta (`motivoDaParada` do catalogo `roadmap`). */
export type CausaDaParada =
  | { tipo: 'semAtividade'; sessao: string; minutos: number }
  | { tipo: 'retratoVelho'; minutos: number }
  | { tipo: 'nenhumaSessao'; fase: string }
  | { tipo: 'despachoFalhou'; fase: string | null; detalhe: string }
  | { tipo: 'sessaoCaiu'; sessao: string; motivo: string }
  | { tipo: 'runtimeSemResposta'; runtime: string; detalhe: string | null; sessao: string }
  | { tipo: 'naoAparece'; sessao: string }
  | { tipo: 'fantasma'; sessao: string }
  | { tipo: 'encerrada'; sessao: string; estado: string }
  | { tipo: 'naoLida'; detalhe: string };

/** O motivo de uma causa, no catalogo pedido (pt-BR por padrao: e o que vai ao `--json` e ao retrato). */
export function motivoDaCausa(c: CausaDaParada, m: typeof ROADMAP_PT_BR.motivoDaParada = ROADMAP_PT_BR.motivoDaParada): string {
  switch (c.tipo) {
    case 'nenhumaSessao': return m.nenhumaSessao(c.fase);
    case 'despachoFalhou': return m.despachoFalhou(c.fase, c.detalhe);
    case 'sessaoCaiu': return m.sessaoCaiu(c.sessao, c.motivo);
    case 'runtimeSemResposta': return m.runtimeSemResposta(c.runtime, c.detalhe, c.sessao);
    case 'naoAparece': return m.naoAparece(c.sessao);
    case 'fantasma': return m.fantasma(c.sessao);
    case 'encerrada': return m.encerrada(c.sessao, c.estado);
    case 'naoLida': return m.naoLida(c.detalhe);
    case 'semAtividade': return m.semAtividade(c.sessao, c.minutos);
    case 'retratoVelho': return m.retratoVelho(c.minutos);
  }
}

/**
 * O que a vida de uma thread diz: viva, ou parada desde quando e por que. `motivo` e o texto pt-BR (contrato do
 * `--json` e do retrato); `causa`, o tipo, para o texto em outra lingua. Sem `motivo`, nada foi verificado (o
 * retrato de outra maquina que nao publica a sessao).
 */
export interface VidaDaThread {
  viva: boolean;
  /** A sessao do despacho corrente da fase, quando ha. */
  sessionId: string | null;
  /** O ultimo sinal de vida no ledger (ISO), so quando nao esta viva. */
  desdeEm: string | null;
  motivo: string | null;
  causa?: CausaDaParada;
}

const curto = (texto: unknown, teto = 100): string => {
  const limpo = String(texto ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return limpo.length > teto ? `${limpo.slice(0, teto - 3)}...` : limpo;
};

/**
 * `claude agents` e os rollouts do codex de cada conta desta maquina (a do processo e cada perfil do store), conta a
 * conta: o que uma conta nao respondeu nao vira "a sessao nao aparece". Falha vira falha, nunca "sem sessao".
 */
export function lerRuntime(raiz: string, prazoMs: number = PRAZO_DA_LEITURA_MS): LeituraDoRuntime {
  const responderam = new Set<string>(), falhas: string[] = [], sessoes: SessaoNoRuntime[] = [];
  try {
    const canonica = raizDoEstado(raiz);
    const { contas, fontes } = contasDeSessoes(canonica);
    for (const f of fontes) if (!f.ok) falhas.push(curto(f.detalhe, 120));
    for (const conta of contas) {
      const r = consultarContas(canonica, { todas: true, contas: [conta], prazoMs });
      if (r.fontes.some((f) => f.ok)) {
        responderam.add(conta.runtime);
        responderam.add(chaveDaConta(conta.runtime, conta.perfil?.id ?? null));
      } else falhas.push(...r.fontes.filter((f) => !f.ok).map((f) => `${f.origem}: ${curto(f.detalhe, 120)}`));
      for (const s of r.sessoes) {
        sessoes.push({ sessionId: s.sessionId, runtime: s.runtime, viva: s.viva, fantasma: s.fantasma,
          estado: String(s.state ?? s.status ?? '').trim().toLowerCase(), perfil: s.perfil,
          atividadeEm: typeof s.atividadeEm === 'number' ? s.atividadeEm : null });
      }
    }
  } catch (e) {
    falhas.push(curto((e as Error).message, 160));
  }
  return { responderam: [...responderam], falhas, sessoes };
}

/** O motivo tipado com o detalhe, sem repetir o motivo quando o detalhe ja comeca por ele. */
function motivoComDetalhe(e: EventoLedger): string {
  const motivo = typeof e.motivo === 'string' ? e.motivo : '';
  const detalhe = typeof e.detalhe === 'string' ? e.detalhe : typeof e.erro === 'string' ? e.erro : '';
  return !detalhe ? motivo || 'sem detalhe' : !motivo || detalhe.startsWith(motivo) ? detalhe : `${motivo}: ${detalhe}`;
}

function causaDaFalha(e: EventoLedger, sessionId: string | null): CausaDaParada {
  if (sessionId && e.sessionId === sessionId) return { tipo: 'sessaoCaiu', sessao: sessionId.slice(0, 8), motivo: curto(e.motivo, 40) };
  return { tipo: 'despachoFalhou', fase: typeof e.fase === 'string' && e.fase ? e.fase : null, detalhe: curto(motivoComDetalhe(e), 90) };
}

/** Eventos que o proprio `ork` grava sobre a sessao: nao sao sinal de vida dela. */
const SO_DO_ORK = /^(conducao_|retry_|despacho_idempotente$)/;

/**
 * A vida da thread: a sessao do despacho mais recente, de qualquer fase (o despacho de GO que falha deixa a thread
 * em GOAL), e a falha do runtime depois dele. `leitura` so e chamada quando ha sessao a conferir: thread sem
 * despacho nao custa consulta ao runtime.
 */
export function vidaDaThread(t: Thread, eventos: readonly EventoLedger[], leitura: () => LeituraDoRuntime,
  agoraMs: number = Date.now()): VidaDaThread {
  const fase = t.faseAtual;
  const parada = (desdeEm: string | null | undefined, causa: CausaDaParada, sessionId: string | null = null): VidaDaThread =>
    ({ viva: false, sessionId, desdeEm: desdeEm ?? null, motivo: motivoDaCausa(causa), causa });
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
  const perfilDoDespacho = (despacho?.perfil as { id?: unknown } | undefined)?.id ??
    (registrada as { perfil?: { id?: unknown } } | null)?.perfil?.id;
  const perfil = typeof perfilDoDespacho === 'string' && perfilDoDespacho ? perfilDoDespacho : null;
  // A falha que vale e a de depois do despacho corrente (a de antes ja foi superada por ele), e que nada superou depois:
  // o gate liberado do mesmo motivo ou da mesma sessao, ou a fase que terminou bem.
  const depois = eventos.slice(iDespacho + 1);
  const falha = [...depois.entries()].reverse().find(([k, e]) => (e.tipo === TIPOS_DE_EVENTO.despachoFalhou ||
    (e.tipo === TIPOS_DE_EVENTO.gateBloqueado && typeof e.motivo === 'string' && e.motivo.startsWith('runtime.'))) &&
    !depois.slice(k + 1).some((p) => (p.tipo === TIPOS_DE_EVENTO.gateLiberado && (p.motivo === e.motivo ||
      (!!e.sessionId && p.sessionId === e.sessionId))) || (p.tipo === 'phase_result' && p.ok === true)))?.[1] ?? null;
  if (!sessionId) {
    return falha ? parada(falha.ts, causaDaFalha(falha, null)) : parada(ultimoSinal, { tipo: 'nenhumaSessao', fase });
  }
  const l = leitura();
  const s = l.sessoes.find((x) => x.runtime === runtime && (x.sessionId === sessionId || x.sessionId.startsWith(sessionId)));
  if (s?.viva) return { viva: true, sessionId, desdeEm: null, motivo: null };
  if (falha) return parada(falha.ts, causaDaFalha(falha, sessionId), sessionId);
  const id = sessionId.slice(0, 8);
  const daSessao = [...eventos].reverse().find((e) => e.sessionId === sessionId && !SO_DO_ORK.test(e.tipo))?.ts ?? despacho?.ts ?? ultimoSinal;
  // A conta do despacho precisa ter respondido: a do perfil, ou qualquer uma do runtime quando o despacho nao teve perfil.
  if (!l.responderam.includes(perfil ? chaveDaConta(runtime, perfil) : runtime)) {
    return parada(daSessao, { tipo: 'runtimeSemResposta', runtime, detalhe: l.falhas.length ? curto(l.falhas[0], 80) : null, sessao: id }, sessionId);
  }
  if (!s) return parada(daSessao, { tipo: 'naoAparece', sessao: id }, sessionId);
  if (s.fantasma) return parada(daSessao, { tipo: 'fantasma', sessao: id }, sessionId);
  // O codex so conta como vivo com atividade recente no rollout: sem ela e sem estado final, e silencio, nao fim.
  if (s.runtime === 'codex' && s.estado !== 'completed' && typeof s.atividadeEm === 'number') {
    return parada(new Date(s.atividadeEm).toISOString(),
      { tipo: 'semAtividade', sessao: id, minutos: Math.max(0, Math.floor((agoraMs - s.atividadeEm) / 60000)) }, sessionId);
  }
  return parada(daSessao, { tipo: 'encerrada', sessao: id, estado: s.estado || 'sem estado' }, sessionId);
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
 * RM-063 (F3, GO-FIX): ha sessao viva trabalhando na thread? Pelo sessionId conhecido ou pela worktree dela (o
 * adaptador que falha ou lanca depois de abrir a sessao nao devolve o id). E a prova que o `ork retry run` pede antes
 * de redespachar: sem ela, a fase pode ganhar uma segunda sessao na mesma worktree. `respondeu: false` quando o
 * runtime nao respondeu: sem prova, nada e redespachado.
 */
export function sessaoVivaNaThread(raiz: string, thread: Pick<Thread, 'worktree'>, ids: readonly string[],
  consultar: () => ReturnType<typeof consultarContas> = () => consultarContas(raizDoEstado(raiz), { todas: false, prazoMs: PRAZO_DA_LEITURA_MS })):
  { respondeu: boolean; sessionId: string | null; detalhe: string | null } {
  let r: ReturnType<typeof consultarContas>;
  try { r = consultar(); } catch (e) { return { respondeu: false, sessionId: null, detalhe: curto((e as Error).message, 120) }; }
  const falha = r.fontes.find((f) => f.origem.startsWith('claude agents') && !f.ok);
  if (falha) return { respondeu: false, sessionId: null, detalhe: curto(`${f(falha.origem)}: ${falha.detalhe}`, 160) };
  const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const worktree = thread.worktree ? real(thread.worktree) : null;
  const naWorktree = (cwd: unknown): boolean => typeof cwd === 'string' && !!worktree &&
    (real(cwd) === worktree || real(cwd).startsWith(worktree + path.sep));
  const viva = r.sessoes.find((s) => s.viva && (ids.some((id) => id && (s.sessionId === id || s.sessionId.startsWith(id))) || naWorktree(s.cwd)));
  return { respondeu: true, sessionId: viva?.sessionId ?? null, detalhe: null };
}

const f = (origem: string): string => origem.replace(/\s+/g, ' ');

/** A vida de quem nao foi verificado: o retrato de outra maquina que nao publica a sessao. */
export const VIDA_NAO_VERIFICADA: VidaDaThread = Object.freeze({ viva: false, sessionId: null, desdeEm: null, motivo: null });

/**
 * A vida que vem no retrato de outra maquina (`ork/fabrica-estado`): so vale com os tipos certos. Retrato
 * antigo, sem o campo, ou com o campo fora do formato, vira "nao verificada", e a linha nao diz "sigo".
 */
export function vidaDoRetrato(bruto: unknown, publicadoEm?: string, quando?: string): VidaDaThread {
  if (!bruto || typeof bruto !== 'object') return VIDA_NAO_VERIFICADA;
  const v = bruto as Record<string, unknown>;
  const textoOuNulo = (x: unknown): x is string | null => x === null || typeof x === 'string';
  if (typeof v.viva !== 'boolean' || !textoOuNulo(v.desdeEm) || !textoOuNulo(v.motivo)) return VIDA_NAO_VERIFICADA;
  // A sessao viva de um retrato velho nao e "sigo": a maquina que morreu depois de publicar seguiria "viva" para sempre.
  const idadeMs = publicadoEm && quando ? Date.parse(quando) - Date.parse(publicadoEm) : NaN;
  if (v.viva && Number.isFinite(idadeMs) && idadeMs > VALIDADE_DA_VIDA_NO_RETRATO_MS) {
    const causa: CausaDaParada = { tipo: 'retratoVelho', minutos: Math.floor(idadeMs / 60000) };
    return { viva: false, sessionId: null, desdeEm: publicadoEm ?? null, motivo: motivoDaCausa(causa), causa };
  }
  // Parada sem motivo publicado nao vira "nao verificada": a outra maquina disse que a sessao nao esta viva.
  const motivo = v.motivo === null ? (v.viva ? null : 'sem sessão viva') : curto(v.motivo, 120);
  return { viva: v.viva, sessionId: null, desdeEm: v.desdeEm, motivo };
}

/**
 * Ate quando a sessao viva de um retrato publicado vale: o retrato igual so volta ao remoto de hora em hora
 * (`PULSACAO_MS` da fabrica), mais uma batida do pulse de folga.
 */
export const VALIDADE_DA_VIDA_NO_RETRATO_MS = 75 * 60 * 1000;
